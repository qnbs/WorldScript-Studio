import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runRetention } from '../../../scripts/vercel-retention/apply.mjs';
import {
  assertTrustedSource,
  main,
  parseMode,
  report,
} from '../../../scripts/vercel-retention/cli.mjs';
import { acquireLock } from '../../../scripts/vercel-retention/lock.mjs';
import { removeAlias, removeDeployment } from '../../../scripts/vercel-retention/provider.mjs';
import { MAX_DELETIONS } from '../../../scripts/vercel-retention/scope.mjs';
import {
  MAIN,
  makeDeps,
  preview,
  production,
  SECRET,
  standardWorld,
} from './support/vercelRetentionFixture.mjs';

const OTHER = 'c'.repeat(40);
const dry = (world) => runRetention(makeDeps(world), 'dry-run');
const reconcile = (world) => runRetention(makeDeps(world), 'reconcile');
const stop = async (action) => {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
};
const ids = (world) => world.deployments.map((deployment) => deployment.uid);

test('dry-run classifies the inventory and issues no write', async () => {
  const world = standardWorld();
  const summary = await dry(world);
  assert.equal(summary.anchor, MAIN);
  assert.equal(summary.productionId, 'dpl_prod');
  assert.equal(summary.protectedProduction, 2);
  assert.equal(summary.rollbackCandidates, 1);
  assert.equal(summary.safe, 4);
  assert.equal(summary.protectedPreviews, 4);
  assert.equal(summary.unknown, 0);
  assert.equal(summary.writeAttempts, 0);
  assert.deepEqual(world.writes, []);
});

test('reconcile deletes only the proven SAFE previews and proves the rest afterwards', async () => {
  const world = standardWorld();
  const summary = await reconcile(world);
  assert.deepEqual(summary.deleted, ['dpl_prev12', 'dpl_prev11', 'dpl_prev2', 'dpl_prev1']);
  assert.deepEqual(summary.postproof, {
    protectedPresent: '6/6',
    deletedAbsent: true,
    canonicalAliasesBound: true,
    productionReady: true,
    httpProduction: '200',
  });
  for (const kept of ['dpl_prod', 'dpl_old', 'dpl_prev3', 'dpl_prev4', 'dpl_prev5', 'dpl_prev21'])
    assert.ok(ids(world).includes(kept), kept);
  const alias = world.writes.findIndex((entry) => entry.startsWith('alias remove'));
  const removal = world.writes.findIndex((entry) => entry.startsWith('remove dpl_prev12'));
  assert.ok(alias >= 0 && alias < removal, 'the branch alias goes before its deployment');
  assert.ok(world.writes.every((entry) => !entry.includes('worldscript-studio.vercel.app')));
});

test('a repeated pass at the same main is idempotent and writes nothing', async () => {
  const world = standardWorld();
  await reconcile(world);
  world.writes.length = 0;
  const second = await reconcile(world);
  assert.deepEqual(second.deleted, []);
  assert.equal(second.writeAttempts, 0);
  assert.deepEqual(world.writes, []);
});

test('a complete inventory with nothing to delete is a valid terminal pass', async () => {
  const world = standardWorld();
  world.deployments = world.deployments.filter(
    (d) => !['dpl_prev1', 'dpl_prev2', 'dpl_prev11', 'dpl_prev12'].includes(d.uid),
  );
  const summary = await reconcile(world);
  assert.equal(summary.safe, 0);
  assert.equal(summary.writeAttempts, 0);
  assert.equal(summary.postproof.deletedAbsent, true);
});

test('a main that moves while the snapshot is read stops before any write', async () => {
  const world = standardWorld();
  let reads = 0;
  world.main = () => (++reads === 1 ? MAIN : OTHER);
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'main-moved-during-read');
  assert.deepEqual(world.writes, []);
});

test('a main that moves before the first write stops without writing on the old SHA', async () => {
  const world = standardWorld();
  let reads = 0;
  world.main = () => (++reads <= 2 ? MAIN : OTHER);
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'main-moved');
  assert.deepEqual(world.writes, []);
});

test('a main that advances after the first deletion stops the pass', async () => {
  const world = standardWorld();
  let reads = 0;
  world.main = () => (++reads <= 4 ? MAIN : OTHER);
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'main-moved');
  assert.deepEqual(error.summary.deleted, ['dpl_prev12']);
  assert.equal(world.writes.length, 2);
});

const badRuns = {
  'a missing required run': (runs) => runs.filter((run) => run.name !== 'CodeQL SAST'),
  'a failed run': (runs) => runs.map((run) => ({ ...run, conclusion: 'failure' })),
  'a skipped run': (runs) => runs.map((run) => ({ ...run, conclusion: 'skipped' })),
  'a cancelled run': (runs) => runs.map((run) => ({ ...run, conclusion: 'cancelled' })),
  'a run still in progress': (runs) =>
    runs.map((run) => ({ ...run, status: 'in_progress', conclusion: '' })),
  'a failed push rerun next to a success': (runs) => [
    ...runs,
    { ...runs[0], conclusion: 'failure' },
  ],
  'only a manual dispatch run': (runs) =>
    runs.map((run) => ({ ...run, event: 'workflow_dispatch' })),
  'only a tag push run': (runs) => runs.map((run) => ({ ...run, headBranch: 'v1.30.0' })),
  'a run for another commit': (runs) => runs.map((run) => ({ ...run, headSha: OTHER })),
};
for (const [name, change] of Object.entries(badRuns))
  test(`stops with ${name} on the exact main SHA, in both modes`, async () => {
    for (const run of [dry, reconcile]) {
      const world = standardWorld();
      world.runs = change(world.runs);
      const error = await stop(() => run(world));
      assert.match(error.reason, /^gate-not-green:/);
      assert.deepEqual(world.writes, []);
    }
  });

test('a failing manual run next to the green push runs does not outvote them', async () => {
  const world = standardWorld();
  world.runs = [
    ...world.runs,
    { ...world.runs[0], event: 'workflow_dispatch', conclusion: 'failure' },
  ];
  const summary = await dry(world);
  assert.equal(summary.safe, 4);
});

test('a run list as long as the request limit is treated as possibly truncated', async () => {
  const world = standardWorld();
  world.runs = Array.from({ length: 200 }, () => ({ ...world.runs[0] }));
  assert.equal((await stop(() => reconcile(world))).reason, 'runs-incomplete');
  assert.deepEqual(world.writes, []);
});

const badProduction = {
  'production on another commit': (world) => {
    world.deployments[0].meta.githubCommitSha = 'd'.repeat(40);
    return 'production-not-ready-on-main';
  },
  'production that is not READY': (world) => {
    world.deployments[0].readyState = 'BUILDING';
    return 'production-not-ready-on-main';
  },
  'a canonical alias bound elsewhere': (world) => {
    world.aliases[0].deploymentId = 'dpl_old';
    return 'canonical-aliases-not-bound';
  },
  'a missing canonical alias': (world) => {
    world.aliases.splice(0, 1);
    return 'canonical-aliases-not-bound';
  },
  'a failing canonical host': (world) => {
    world.http = '500';
    return 'canonical-http-failed';
  },
};
for (const [name, change] of Object.entries(badProduction))
  test(`stops with ${name} before any write`, async () => {
    const world = standardWorld();
    const expected = change(world);
    const error = await stop(() => reconcile(world));
    assert.equal(error.reason, expected);
    assert.deepEqual(world.writes, []);
  });

test('a paginated inventory is read completely', async () => {
  const world = standardWorld();
  world.pageSize = 2;
  const summary = await dry(world);
  assert.equal(summary.safe, 4);
  assert.equal(summary.protectedProduction, 2);
});

test('pagination that never ends stops instead of acting on a partial inventory', async () => {
  const world = standardWorld();
  world.endless = true;
  assert.equal((await stop(() => reconcile(world))).reason, 'provider-pagination-limit');
  assert.deepEqual(world.writes, []);
});

test('a failing provider read stops with a fixed reason and leaks no error text', async () => {
  const world = standardWorld();
  world.hooks.failReads = true;
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'provider-read-failed');
  assert.ok(!JSON.stringify([error.message, error.summary]).includes(SECRET));
  assert.deepEqual(world.writes, []);
});

const badProjects = {
  'another project name': (project) => ({ ...project, name: 'other' }),
  'another team': (project) => ({ ...project, accountId: 'team_other' }),
  'another repository': (project) => ({ ...project, link: { org: 'qnbs', repo: 'Other' } }),
  'no repository link': (project) => ({ ...project, link: undefined }),
};
for (const [name, change] of Object.entries(badProjects))
  test(`stops for ${name}`, async () => {
    const world = standardWorld();
    world.project = change(world.project);
    const error = await stop(() => reconcile(world));
    assert.match(error.reason, /^(project-mismatch|repository-unconfirmed)$/);
    assert.deepEqual(world.writes, []);
  });

test('Production-class deployments are never classified or touched', async () => {
  const world = standardWorld();
  world.deployments.push(
    production('dpl_promoted', 'e'.repeat(40), { created: 3000, target: null }),
  );
  world.deployments.push(
    preview(31, {
      isRollbackCandidate: true,
      meta: { githubPrId: '7', githubCommitRef: 'fix/gone' },
    }),
  );
  const summary = await reconcile(world);
  assert.equal(summary.protectedProduction, 4);
  assert.ok(ids(world).includes('dpl_promoted') && ids(world).includes('dpl_prev31'));
});

for (const available of [1, 2, 3, 5])
  test(`an open PR with ${available} previews keeps min(3, available) of them`, async () => {
    const world = standardWorld();
    world.deployments = world.deployments.filter((d) => d.target === 'production');
    world.aliases = world.aliases.filter((a) => a.deploymentId === 'dpl_prod');
    for (let n = 1; n <= available; n++) world.deployments.push(preview(n));
    world.prs = [{ number: 9, headRefName: 'feat/open', headRefOid: 'f'.repeat(40) }];
    const summary = await dry(world);
    assert.equal(summary.protectedPreviews, Math.min(3, available));
    assert.equal(summary.safe, available - Math.min(3, available));
  });

test('an older generation whose commit is an open PR head stays protected', async () => {
  const world = standardWorld();
  world.prs[0].headRefOid = preview(1).meta.githubCommitSha;
  const summary = await reconcile(world);
  assert.ok(!summary.deleted.includes('dpl_prev1'));
});

const unclear = {
  'a building state': { readyState: 'BUILDING' },
  'a queued state': { readyState: 'QUEUED' },
  'an initializing state': { readyState: 'INITIALIZING' },
  'a missing state': { readyState: undefined },
  'an unknown rollback flag': { isRollbackCandidate: undefined },
  'a missing branch': { meta: { githubCommitRef: undefined } },
  'a foreign organisation': { meta: { githubOrg: 'other' } },
  'a foreign project': { projectId: 'prj_other' },
  'a missing creation time': { created: undefined },
};
for (const [name, change] of Object.entries(unclear))
  test(`${name} is UNKNOWN and is never deleted`, async () => {
    const world = standardWorld();
    const target = world.deployments.find((d) => d.uid === 'dpl_prev11');
    Object.assign(target, { ...change, meta: { ...target.meta, ...change.meta } });
    const summary = await reconcile(world);
    assert.equal(summary.unknown, 1);
    assert.ok(!summary.deleted.includes('dpl_prev11'));
    assert.ok(ids(world).includes('dpl_prev11'));
  });

test('a preview carrying a canonical alias is protected', async () => {
  const world = standardWorld();
  world.aliases.push({
    alias: 'worldscript-studio.vercel.app',
    deploymentId: 'dpl_prev11',
    created: 300,
  });
  const summary = await dry(world);
  assert.equal(summary.safe, 3);
});

test('a verdict that changes before deletion only defers the ID', async () => {
  const world = standardWorld();
  let lists = 0;
  world.hooks.onRead = (live, args) => {
    if (args[0] === 'pr' && ++lists === 2) {
      live.prs.push({ number: 7, headRefName: 'fix/gone', headRefOid: 'e'.repeat(40) });
      live.branches.add('fix/gone');
    }
  };
  const summary = await reconcile(world);
  assert.deepEqual(summary.deleted, ['dpl_prev2', 'dpl_prev1']);
  assert.deepEqual(summary.reclassified, ['dpl_prev12', 'dpl_prev11']);
  assert.ok(world.writes.every((entry) => !entry.startsWith('alias remove')));
});

test('a refused deletion stops the pass and is never retried', async () => {
  const world = standardWorld();
  world.removeFault.dpl_prev12 = 'throw-before';
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'delete-failed');
  assert.equal(world.writes.length, 2);
  assert.ok(!JSON.stringify([error.message, error.summary]).includes(SECRET));
});

test('an ambiguous deletion that did land is confirmed by re-reading, not retried', async () => {
  const world = standardWorld();
  world.removeFault.dpl_prev1 = 'throw-after';
  const summary = await reconcile(world);
  assert.deepEqual(summary.deleted, ['dpl_prev12', 'dpl_prev11', 'dpl_prev2', 'dpl_prev1']);
  assert.equal(world.writes.filter((entry) => entry.includes('dpl_prev1 ')).length, 1);
});

test('a deletion that silently does nothing is an unconfirmed stop', async () => {
  const world = standardWorld();
  world.removeFault.dpl_prev1 = 'skip';
  assert.equal((await stop(() => reconcile(world))).reason, 'delete-not-confirmed');
});

test('a failed alias removal stops before its deployment is touched', async () => {
  const world = standardWorld();
  world.removeFault['worldscript-studio-git-fix-gone-qnbs-projects.vercel.app'] = 'alias-fail';
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'alias-remove-failed');
  assert.ok(ids(world).includes('dpl_prev12'));
});

test('a pass deletes at most the batch limit and reports the rest as deferred', async () => {
  const world = standardWorld();
  for (let n = 100; n < 100 + MAX_DELETIONS + 5; n++)
    world.deployments.push(preview(n, { meta: { githubPrId: '7', githubCommitRef: 'fix/gone' } }));
  const summary = await reconcile(world);
  assert.equal(summary.safe, 4 + MAX_DELETIONS + 5);
  assert.equal(summary.deleted.length, MAX_DELETIONS);
  assert.equal(summary.deferred, summary.safe - MAX_DELETIONS);
});

test('summaries and stops never contain creator metadata or provider error text', async () => {
  const world = standardWorld();
  const summary = await reconcile(world);
  assert.ok(!JSON.stringify(summary).includes(SECRET));
  assert.ok(!JSON.stringify(summary).includes('email'));
});

const dirty = (source) => makeDeps(Object.assign(standardWorld(), source));
test('a modified, unmerged or divergent runner never mutates', async () => {
  assert.throws(
    () => assertTrustedSource(dirty({ dirty: ' M scripts/vercel-retention/apply.mjs\n' })),
    { reason: 'runner-source-modified' },
  );
  assert.throws(() => assertTrustedSource(dirty({ differs: true })), {
    reason: 'runner-source-differs-from-main',
  });
  const changed = standardWorld();
  const deps = makeDeps(changed);
  deps.packageJson = () =>
    JSON.stringify({ scripts: { 'vercel:retention:reconcile': 'node other.mjs' } });
  assert.throws(() => assertTrustedSource(deps), { reason: 'package-script-differs-from-main' });
  assert.doesNotThrow(() => assertTrustedSource(dirty({})));
});

test('reconcile from an untrusted checkout performs no provider call at all', async () => {
  const world = standardWorld();
  world.differs = true;
  const error = await stop(() => main(['reconcile'], makeDeps(world), { log() {} }));
  assert.equal(error.reason, 'runner-source-differs-from-main');
  assert.ok(world.calls.every((call) => !call.startsWith('vercel')));
});

test('the entry points take no arguments', async () => {
  for (const argv of [
    [],
    ['--execute'],
    ['reconcile', 'extra'],
    ['dry-run', '--x'],
    ['delete'],
    [''],
  ])
    assert.throws(() => parseMode(argv), { reason: 'invalid-arguments' });
  assert.equal(parseMode(['dry-run']), 'dry-run');
  assert.equal(parseMode(['reconcile']), 'reconcile');
});

test('the package scripts are the two fixed commands without arguments or wildcards', () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(
    scripts['vercel:retention:dry-run'],
    'node scripts/vercel-retention/cli.mjs dry-run',
  );
  assert.equal(
    scripts['vercel:retention:reconcile'],
    'node scripts/vercel-retention/cli.mjs reconcile',
  );
});

test('the command line refuses an unknown mode before touching any tool', () => {
  const cli = fileURLToPath(new URL('../../../scripts/vercel-retention/cli.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--execute'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /RETENTION_STOP: invalid-arguments/);
});

test('mutations accept only an exact deployment ID or alias host and always pass --safe', () => {
  const seen = [];
  const deps = { vercel: (args) => seen.push(args) };
  for (const bad of ['worldscript-studio', 'dpl_x; rm -rf', '', 'dpl_', '*'])
    assert.throws(() => removeDeployment(deps, bad), { reason: 'invalid-deployment-id' });
  for (const bad of ['evil.com', 'a.vercel.app/x', '', '*.vercel.app'])
    assert.throws(() => removeAlias(deps, bad), { reason: 'invalid-alias-host' });
  assert.deepEqual(seen, []);
  removeDeployment(deps, 'dpl_abc123');
  assert.deepEqual(seen[0], [
    'remove',
    'dpl_abc123',
    '--safe',
    '--yes',
    '--scope',
    'qnbs-projects',
  ]);
});

const mutateOne = (change) => {
  const world = standardWorld();
  const target = world.deployments.find((deployment) => deployment.uid === 'dpl_prev11');
  change(target, world);
  return world;
};

test('a preview without a commit SHA is UNKNOWN because it cannot be compared with main or PR heads', async () => {
  for (const sha of [undefined, '', 'abc', 'g'.repeat(40)]) {
    const world = mutateOne((target) => {
      target.meta.githubCommitSha = sha;
    });
    const summary = await reconcile(world);
    assert.equal(summary.unknown, 1);
    assert.ok(!summary.deleted.includes('dpl_prev11'));
  }
});

test('an open-PR preview without a creation time cannot displace a dated one from the newest three', async () => {
  const world = standardWorld();
  world.deployments.push(preview(7, { created: undefined }));
  const summary = await dry(world);
  const manifest = Object.fromEntries(summary.manifest.map((row) => [row.id, row.verdict]));
  assert.equal(manifest.dpl_prev7, 'UNKNOWN');
  for (const kept of ['dpl_prev3', 'dpl_prev4', 'dpl_prev5'])
    assert.equal(manifest[kept], 'PROTECTED');
});

test('a deployment rolling to Production is Production-class and never touched', async () => {
  const world = mutateOne((target) => {
    target.readySubstate = 'ROLLING';
  });
  const summary = await reconcile(world);
  assert.equal(summary.protectedProduction, 3);
  assert.ok(ids(world).includes('dpl_prev11'));
});

test('a preview named in the reviewed hold file is kept as review evidence', async () => {
  const world = standardWorld();
  world.holdFile = { review: ['dpl_prev1'] };
  const summary = await reconcile(world);
  assert.ok(!summary.deleted.includes('dpl_prev1'));
  assert.equal(summary.manifest.find((row) => row.id === 'dpl_prev1').reasons[0], 'explicit-hold');
});

for (const bad of [
  null,
  [],
  { review: 'dpl_a' },
  { review: ['dpl_ok', 'prod'] },
  { review: [], extra: [] },
])
  test(`a malformed hold file ${JSON.stringify(bad)} stops the run`, async () => {
    const world = standardWorld();
    world.holdFile = bad;
    assert.equal((await stop(() => dry(world))).reason, 'invalid-holds');
  });

test('a provider page without pagination metadata is malformed, not the final page', async () => {
  const world = standardWorld();
  const deps = makeDeps(world);
  const original = deps.vercel;
  deps.vercel = (args) => {
    const text = original(args);
    return args[1]?.startsWith('/v4/aliases')
      ? JSON.stringify({ aliases: JSON.parse(text).aliases })
      : text;
  };
  const error = await stop(() => runRetention(deps, 'dry-run'));
  assert.equal(error.reason, 'invalid-provider-response');
});

test('the dry-run reports one manifest line per preview with its verdict and reasons', async () => {
  const lines = [];
  await main(['dry-run'], makeDeps(standardWorld()), { log: (line) => lines.push(line) });
  const manifest = lines.filter((line) => line.startsWith('RETENTION_MANIFEST'));
  assert.equal(manifest.length, 8);
  assert.ok(manifest.some((line) => line.includes('dpl_prev1 | SAFE')));
  assert.ok(
    manifest.some(
      (line) => line.includes('dpl_prev5 | PROTECTED') && line.includes('open-pr-newest-three'),
    ),
  );
  const summary = lines.find((line) => line.startsWith('RETENTION_SUMMARY'));
  assert.ok(!summary.includes('"manifest"'));
  assert.ok(![...lines].join('\n').includes(SECRET));
});

test('the post-proof stops when Production itself stops being READY during the pass', async () => {
  const world = standardWorld();
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1')
      live.deployments.find((d) => d.uid === 'dpl_prod').readyState = 'ERROR';
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.equal(error.summary.postproof.productionReady, false);
});

test('a second concurrent reconcile stops before reading anything, and the lock is always released', async () => {
  const world = standardWorld();
  const first = reconcile(world);
  const second = await stop(() => reconcile(world));
  assert.equal(second.reason, 'retention-already-running');
  await first;
  assert.equal(world.locked, false);
  const failing = standardWorld();
  failing.http = '500';
  await stop(() => reconcile(failing));
  assert.equal(failing.locked, false);
  assert.equal(failing.released, 1);
});

test('the real lock excludes a live holder, recovers a dead one and releases cleanly', () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'vr-lock-')), 'held');
  const release = acquireLock(directory);
  assert.throws(() => acquireLock(directory), { reason: 'retention-already-running' });
  release();
  assert.equal(existsSync(directory), false);
  const dead = acquireLock(directory);
  writeFileSync(join(directory, 'pid'), '2147483646');
  const recovered = acquireLock(directory);
  recovered();
  dead();
});

test('the entry file loads only built-ins and the lock before the source check', () => {
  const source = readFileSync(
    new URL('../../../scripts/vercel-retention/cli.mjs', import.meta.url),
    'utf8',
  );
  const staticImports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(staticImports.sort(), [
    './lock.mjs',
    'node:child_process',
    'node:fs',
    'node:url',
  ]);
  assert.match(source, /await import\('\.\/apply\.mjs'\)/);
});

test('report prints the manifest rows before a single summary line', () => {
  const lines = [];
  report(
    { log: (line) => lines.push(line) },
    {
      manifest: [
        {
          id: 'dpl_x',
          verdict: 'SAFE',
          branch: null,
          pr: null,
          sha: '',
          aliases: 0,
          lifecycle: 'orphan',
          reasons: [],
        },
      ],
      mode: 'dry-run',
    },
  );
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /^RETENTION_MANIFEST dpl_x \| SAFE \| - \| PR - \| - \| aliases=0 \| orphan \| -$/,
  );
});
