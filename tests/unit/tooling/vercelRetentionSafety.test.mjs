import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runRetention } from '../../../scripts/vercel-retention/apply.mjs';
import { main } from '../../../scripts/vercel-retention/cli.mjs';
import { acquireLock, reclaim } from '../../../scripts/vercel-retention/lock.mjs';
import { listDeployments } from '../../../scripts/vercel-retention/provider.mjs';
import {
  aliasEntry,
  MAIN,
  makeDeps,
  preview,
  production,
  standardWorld,
  withRetentionRuntime,
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
const verdicts = (summary) => Object.fromEntries(summary.manifest.map((row) => [row.id, row]));
const find = (world, id) => world.deployments.find((deployment) => deployment.uid === id);

for (const [name, record] of Object.entries({
  'a string number': { number: '9', headRefName: 'feat/open', headRefOid: 'a'.repeat(40) },
  'a missing head commit': { number: 9, headRefName: 'feat/open', headRefOid: undefined },
  'a short head commit': { number: 9, headRefName: 'feat/open', headRefOid: 'abc' },
  'an empty head branch': { number: 9, headRefName: '', headRefOid: 'a'.repeat(40) },
  'a null record': null,
}))
  test(`an open-PR snapshot with ${name} refuses the whole run`, async () => {
    const world = standardWorld();
    world.prs.push(record);
    assert.equal((await stop(() => reconcile(world))).reason, 'open-prs-malformed');
    assert.deepEqual(world.writes, []);
  });

for (const [name, change] of Object.entries({
  'an alias without the deployment link': (world) => {
    world.aliases[3].deploymentId = undefined;
  },
  'an alias with a malformed link': (world) => {
    world.aliases[3].deploymentId = 'prev5';
  },
  'an alias without a host': (world) => {
    world.aliases[3].alias = undefined;
  },
  'a deployment without an id': (world) => {
    world.deployments[3].uid = undefined;
  },
}))
  test(`${name} refuses the inventory before any classification`, async () => {
    const world = standardWorld();
    change(world);
    assert.equal((await stop(() => reconcile(world))).reason, 'invalid-provider-response');
    assert.deepEqual(world.writes, []);
  });

test('a redirect alias that states a null deployment link is a valid record', async () => {
  const world = standardWorld();
  world.aliases.push(aliasEntry('redirect.vercel.app', null, 300));
  assert.equal((await dry(world)).safe, 4);
});

for (const [name, change] of Object.entries({
  'a custom target': { target: 'staging' },
  'a custom environment': { customEnvironmentId: 'env_staging' },
}))
  test(`${name} is UNKNOWN and is never deleted`, async () => {
    const world = standardWorld();
    Object.assign(find(world, 'dpl_prev11'), change);
    const summary = await reconcile(world);
    assert.deepEqual(verdicts(summary).dpl_prev11.reasons, ['target-unrecognized']);
    assert.ok(find(world, 'dpl_prev11'));
  });

test('the literal preview target is an ordinary Preview', async () => {
  const world = standardWorld();
  find(world, 'dpl_prev11').target = 'preview';
  assert.equal((await dry(world)).safe, 4);
});

test('the branch alias of an open fork PR is protected although its ref is not in origin', async () => {
  const world = standardWorld();
  world.branches.delete('feat/open');
  world.aliases.push(aliasEntry('worldscript-studio-feat-open-old.vercel.app', 'dpl_prev1', 250));
  const summary = await reconcile(world);
  assert.equal(verdicts(summary).dpl_prev1.verdict, 'PROTECTED');
  assert.ok(verdicts(summary).dpl_prev1.reasons.includes('active-branch-alias'));
  const touched = world.writes.filter(
    (entry) => entry.includes('feat-open-old') || entry.split(' ')[1] === 'dpl_prev1',
  );
  assert.deepEqual(touched, []);
});

test('an alias read twice with different content means the inventory moved and is refused', async () => {
  const world = standardWorld();
  world.pageSize = 4;
  world.aliases.push(aliasEntry(world.aliases[3].alias, 'dpl_prev4', world.aliases[3].createdAt));
  const error = await stop(() => dry(world));
  assert.equal(error.reason, 'provider-inventory-inconsistent');
});

for (const state of ['ERROR', 'CANCELED']) {
  test(`a ${state} Preview of a closed PR is kept while its branch still exists`, async () => {
    const world = standardWorld();
    world.branches.add('fix/gone');
    world.aliases = world.aliases.filter((entry) => entry.deploymentId !== 'dpl_prev12');
    find(world, 'dpl_prev11').readyState = state;
    const summary = await reconcile(world);
    assert.deepEqual(verdicts(summary).dpl_prev11.reasons, ['failed-preview-needed']);
    assert.ok(find(world, 'dpl_prev11'));
  });

  test(`a ${state} Preview of a closed PR is deleted once its branch is gone`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').readyState = state;
    const summary = await reconcile(world);
    assert.ok(summary.deleted.includes('dpl_prev11'));
  });
}

test('a main that advances between the last deletion and the post-proof is refused', async () => {
  const world = standardWorld();
  let reads = 0;
  world.main = () => (++reads <= 10 ? MAIN : OTHER);
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'main-moved');
  assert.equal(error.summary.deleted.length, 4);
  assert.equal(error.summary.postproof, null);
});

for (const [name, change] of Object.entries({
  disappears: (world) => {
    world.aliases = world.aliases.filter((entry) => entry.deploymentId !== 'dpl_prev5');
  },
  'is rebound to another deployment': (world) => {
    world.aliases.find((entry) => entry.deploymentId === 'dpl_prev5').deploymentId = 'dpl_prev4';
  },
}))
  test(`the post-proof catches a kept preview's branch alias that ${name} during the wave`, async () => {
    const world = standardWorld();
    world.hooks.onWrite = (live, args) => {
      if (args[1] === 'dpl_prev1') change(live);
    };
    const error = await stop(() => reconcile(world));
    assert.equal(error.reason, 'postproof-failed');
    assert.equal(error.summary.postproof.protectedAliasesBound, false);
    assert.equal(error.summary.postproof.canonicalAliasesBound, true);
  });

test('a deployment that became protected during the pass must still be there at the post-proof', async () => {
  const world = standardWorld();
  let lists = 0;
  world.hooks.onRead = (live, args) => {
    if (args[0] === 'pr' && ++lists === 2) {
      live.prs.push({ number: 7, headRefName: 'fix/gone', headRefOid: 'e'.repeat(40) });
      live.branches.add('fix/gone');
    }
  };
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev2')
      live.deployments = live.deployments.filter((d) => d.uid !== 'dpl_prev11');
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.deepEqual(error.summary.reclassified, ['dpl_prev12', 'dpl_prev11']);
  assert.match(error.summary.postproof.protectedPresent, /^\d+\/\d+$/);
  const [present, required] = error.summary.postproof.protectedPresent.split('/').map(Number);
  assert.equal(required - present, 1);
});

test('a deferred ID keeps its live alias binding under the post-proof', async () => {
  const world = standardWorld();
  let lists = 0;
  world.hooks.onRead = (live, args) => {
    if (args[0] === 'pr' && ++lists === 2) {
      live.prs.push({ number: 7, headRefName: 'fix/gone', headRefOid: 'e'.repeat(40) });
      live.branches.add('fix/gone');
    }
  };
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev2')
      live.aliases = live.aliases.filter((entry) => entry.deploymentId !== 'dpl_prev12');
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.ok(find(world, 'dpl_prev12'));
  assert.equal(error.summary.postproof.protectedAliasesBound, false);
});

test('a kept preview that stops being READY during the wave fails the post-proof', async () => {
  const world = standardWorld();
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1') find(live, 'dpl_prev5').readyState = 'ERROR';
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.equal(error.summary.postproof.previewStatesHeld, false);
});

test('a kept preview that was still building is not held to a state it had not settled into', async () => {
  const world = standardWorld();
  find(world, 'dpl_prev5').readyState = 'BUILDING';
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1') find(live, 'dpl_prev5').readyState = 'READY';
  };
  assert.equal((await reconcile(world)).postproof.previewStatesHeld, true);
});

test('a promotion that starts during the wave is not declared complete over', async () => {
  const world = standardWorld();
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1')
      live.deployments.push(
        production('dpl_rolling', 'e'.repeat(40), {
          created: 6000,
          target: null,
          readySubstate: 'ROLLING',
        }),
      );
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.equal(error.summary.postproof.productionSetStable, false);
  assert.equal(error.summary.postproof.canonicalAliasesBound, true);
});

test('an alias removal that threw after the provider acted is settled by re-reading, not retried', async () => {
  const world = standardWorld();
  const host = 'worldscript-studio-git-fix-gone-qnbs-projects.vercel.app';
  world.removeFault[host] = 'alias-throw-after';
  const summary = await reconcile(world);
  assert.ok(summary.deleted.includes('dpl_prev12'));
  assert.equal(world.writes.filter((entry) => entry.includes(host)).length, 1);
});

for (const [name, cursor] of [
  ['a negative cursor', -5],
  ['a zero cursor', 0],
  ['a fractional cursor', 1.5],
  ['a textual cursor', '1000'],
  ['a cursor below the oldest record of its own page', 3],
])
  test(`${name} refuses the inventory instead of being followed`, async () => {
    const world = standardWorld();
    world.pageSize = 4;
    const deps = makeDeps(world);
    const original = deps.vercel;
    deps.vercel = (args) => {
      const text = original(args);
      if (!args[1]?.startsWith('/v6/deployments')) return text;
      const body = JSON.parse(text);
      if (body.pagination.next !== null) body.pagination.next = cursor;
      return JSON.stringify(body);
    };
    const error = await stop(() => runRetention(deps, 'dry-run'));
    assert.equal(error.reason, 'invalid-provider-response');
  });

for (const id of [9, '09', 'bogus', 0, 'x1', -3])
  test(`a deployment with the PR identifier ${JSON.stringify(id)} is UNKNOWN, not "closed or merged"`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').meta.githubPrId = id;
    const summary = await reconcile(world);
    const row = verdicts(summary).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.ok(row.reasons.includes('pr-id-malformed'));
    assert.ok(find(world, 'dpl_prev11'));
  });

for (const [name, change] of Object.entries({
  'another project': (deployment) => {
    deployment.projectId = 'prj_other';
  },
  'another repository': (deployment) => {
    deployment.meta.githubRepo = 'Other';
  },
  'another organisation': (deployment) => {
    deployment.meta.githubOrg = 'other';
  },
}))
  test(`a Production deployment of ${name} never authorizes a write`, async () => {
    const world = standardWorld();
    change(find(world, 'dpl_prod'));
    for (const run of [dry, reconcile])
      assert.equal((await stop(() => run(world))).reason, 'production-not-ready-on-main');
    assert.deepEqual(world.writes, []);
  });

for (const url of [
  'https://github.com/someone/WorldScript-Studio.git',
  'git@github.com:qnbs/WorldScript-Studio-fork.git',
  'https://example.com/qnbs/WorldScript-Studio.git',
  '',
])
  test(`an origin of ${JSON.stringify(url)} stops before any provider call`, async () => {
    const world = standardWorld();
    world.origin = url;
    assert.equal((await stop(() => reconcile(world))).reason, 'origin-unexpected');
    assert.ok(world.calls.every((call) => !call.startsWith('vercel')));
  });

for (const url of [
  'git@github.com:qnbs/WorldScript-Studio.git',
  'https://github.com/qnbs/WorldScript-Studio.git',
  'https://github.com/qnbs/WorldScript-Studio',
  'ssh://git@github.com/qnbs/WorldScript-Studio.git',
])
  test(`the origin ${url} is the expected repository`, async () => {
    const world = standardWorld();
    world.origin = `${url}\n`;
    assert.equal((await dry(world)).safe, 4);
  });

for (const ref of [42, true, {}, ['feat/open']])
  test(`a branch reference of ${JSON.stringify(ref)} is UNKNOWN, not "branch gone"`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').meta.githubCommitRef = ref;
    const row = verdicts(await reconcile(world)).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.ok(row.reasons.includes('branch-unknown'));
    assert.ok(find(world, 'dpl_prev11'));
  });

for (const host of ['preview.example.com', 'a.b.vercel.app', 'UPPER.vercel.app'])
  test(`a preview with the alias host ${host} that the removal would refuse is UNKNOWN up front`, async () => {
    const world = standardWorld();
    world.aliases.push(aliasEntry(host, 'dpl_prev11', 260));
    const summary = await reconcile(world);
    const row = verdicts(summary).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.ok(row.reasons.includes('alias-host-unsupported'));
    assert.ok(find(world, 'dpl_prev11'));
    assert.ok(summary.deleted.includes('dpl_prev12'));
  });

test('a rollback candidate that loses its flag during the wave fails the post-proof', async () => {
  const world = standardWorld();
  world.deployments.push(
    preview(31, {
      isRollbackCandidate: true,
      meta: { githubPrId: '7', githubCommitRef: 'fix/gone' },
    }),
  );
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1') find(live, 'dpl_prev31').isRollbackCandidate = false;
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.equal(error.summary.postproof.productionSetStable, false);
});

test('a PR that reopens after its previews were deleted fails the post-proof', async () => {
  const world = standardWorld();
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev2') {
      live.prs.push({ number: 7, headRefName: 'fix/gone', headRefOid: 'e'.repeat(40) });
      live.branches.add('fix/gone');
    }
  };
  const error = await stop(() => reconcile(world));
  assert.equal(error.reason, 'postproof-failed');
  assert.equal(error.summary.postproof.deletionsStillSafe, false);
  assert.deepEqual(error.summary.deleted, ['dpl_prev12', 'dpl_prev11', 'dpl_prev2', 'dpl_prev1']);
});

test('deletions that stay safe under the final snapshot pass the post-proof', async () => {
  const proof = (await reconcile(standardWorld())).postproof;
  assert.equal(proof.deletionsStillSafe, true);
  assert.equal(proof.productionSetStable, true);
});

test('a new preview that appears during the wave does not affect the proof of what the pass touched', async () => {
  const world = standardWorld();
  world.hooks.onWrite = (live, args) => {
    if (args[1] === 'dpl_prev1') live.deployments.push(preview(60, { created: 9000 }));
  };
  assert.equal((await reconcile(world)).stop, null);
});

for (const id of [0, false, ''])
  test(`a custom environment id of ${JSON.stringify(id)} is present, not absent, and makes the preview UNKNOWN`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').customEnvironmentId = id;
    const row = verdicts(await reconcile(world)).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.deepEqual(row.reasons, ['target-unrecognized']);
  });

for (const substate of ['STAGED', undefined, null])
  test(`the substate ${String(substate)} is an ordinary Preview`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').readySubstate = substate;
    assert.ok((await reconcile(world)).deleted.includes('dpl_prev11'));
  });

for (const substate of ['PROMOTING', 'ROLLED_BACK', '', 'staged'])
  test(`the substate ${JSON.stringify(substate)} is not recognized and is never deleted`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').readySubstate = substate;
    const row = verdicts(await reconcile(world)).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.deepEqual(row.reasons, ['substate-unrecognized']);
    assert.ok(find(world, 'dpl_prev11'));
  });

for (const created of [-1, 0, 1.5, 1e20, Date.now() + 10 * 86_400_000, '1000'])
  test(`a creation time of ${String(created)} is not a plausible instant and is never deleted`, async () => {
    const world = standardWorld();
    find(world, 'dpl_prev11').created = created;
    const row = verdicts(await reconcile(world)).dpl_prev11;
    assert.equal(row.verdict, 'UNKNOWN');
    assert.deepEqual(row.reasons, ['created-unknown']);
    assert.equal(row.created, '-');
  });

test('custom-environment and unrecognized deployments cannot take a retained slot of an open PR', async () => {
  const world = standardWorld();
  world.deployments.push(
    preview(71, { target: 'staging', created: 2001 }),
    preview(72, { customEnvironmentId: 'env_x', created: 2002 }),
    preview(73, { readySubstate: 'PROMOTING', created: 2003 }),
  );
  const rows = verdicts(await dry(world));
  for (const kept of ['dpl_prev3', 'dpl_prev4', 'dpl_prev5'])
    assert.equal(rows[kept].verdict, 'PROTECTED', kept);
  for (const odd of ['dpl_prev71', 'dpl_prev72', 'dpl_prev73'])
    assert.equal(rows[odd].verdict, 'UNKNOWN', odd);
});

for (const [name, change] of Object.entries({
  'another commit': (deployment) => {
    deployment.meta.githubCommitSha = 'd'.repeat(40);
  },
  'another project': (deployment) => {
    deployment.projectId = 'prj_other';
  },
  'another repository': (deployment) => {
    deployment.meta.githubRepo = 'Other';
  },
}))
  test(`the post-proof applies the full Production predicate: ${name}`, async () => {
    const world = standardWorld();
    world.hooks.onWrite = (live, args) => {
      if (args[1] === 'dpl_prev1') change(find(live, 'dpl_prod'));
    };
    const error = await stop(() => reconcile(world));
    assert.equal(error.reason, 'postproof-failed');
    assert.equal(error.summary.postproof.productionReady, false);
  });

test('reconcile prints the whole manifest before its first write, then one summary line', async () => {
  const world = standardWorld();
  const lines = [];
  let seenAtFirstWrite = null;
  world.hooks.onWrite = () => {
    seenAtFirstWrite ??= [...lines];
  };
  await withRetentionRuntime(() =>
    main(['reconcile'], makeDeps(world), { log: (line) => lines.push(line) }),
  );
  assert.equal(seenAtFirstWrite.length, 8);
  assert.ok(seenAtFirstWrite.every((line) => line.startsWith('RETENTION_MANIFEST ')));
  assert.equal(lines.filter((line) => line.startsWith('RETENTION_SUMMARY')).length, 1);
  assert.ok(lines.at(-1).startsWith('RETENTION_SUMMARY'));
});

test('a manifest row shows the state, target, age and alias hosts the gates looked at', async () => {
  const lines = [];
  await withRetentionRuntime(() =>
    main(['dry-run'], makeDeps(standardWorld()), { log: (line) => lines.push(line) }),
  );
  const row = lines.find((line) => line.includes('dpl_prev12 | SAFE'));
  assert.match(row, /\| READY\/preview \| 1970-01-01T00:00:01\.012Z \|/);
  assert.match(row, /aliases=worldscript-studio-git-fix-gone-qnbs-projects\.vercel\.app/);
  assert.match(
    lines.find((line) => line.includes('dpl_prev3 | PROTECTED')),
    /aliases=- /,
  );
});

test('records that share the page-boundary timestamp are read, not skipped', async () => {
  const world = standardWorld();
  world.deployments.push(preview(43, { created: 1003 }));
  world.pageSize = 8;
  const listed = await listDeployments(makeDeps(world));
  assert.equal(listed.length, 11);
  assert.ok(listed.some((deployment) => deployment.uid === 'dpl_prev43'));
});

test('a tie group larger than a page stops as stalled instead of passing as complete', async () => {
  const world = standardWorld();
  world.deployments = [1, 2, 3].map((n) => preview(n, { created: 500 }));
  world.pageSize = 2;
  const error = await stop(() => listDeployments(makeDeps(world)));
  assert.equal(error.reason, 'provider-pagination-stalled');
});

test('a provider that repeats the same page forever stops as stalled', async () => {
  const world = standardWorld();
  world.endless = 'same';
  assert.equal((await stop(() => dry(world))).reason, 'provider-pagination-stalled');
});

const lockPath = () => join(mkdtempSync(join(tmpdir(), 'vr-lock-')), 'held.lock');
const DEAD_PID = '2147483646';

test('the real lock excludes a live holder and releases cleanly', () => {
  const path = lockPath();
  const release = acquireLock(path);
  assert.equal(readFileSync(path, 'utf8'), String(process.pid));
  assert.throws(() => acquireLock(path), { reason: 'retention-already-running' });
  release();
  assert.equal(existsSync(path), false);
  acquireLock(path)();
});

test('the real lock leaves no private or stale file behind in any outcome', () => {
  const path = lockPath();
  const directory = join(path, '..');
  const release = acquireLock(path);
  assert.deepEqual(readdirSync(directory), ['held.lock']);
  assert.throws(() => acquireLock(path), { reason: 'retention-already-running' });
  assert.deepEqual(readdirSync(directory), ['held.lock']);
  release();
  writeFileSync(path, DEAD_PID);
  acquireLock(path)();
  assert.deepEqual(readdirSync(directory), []);
});

test('the real lock recovers a dead holder exactly once', () => {
  const path = lockPath();
  writeFileSync(path, DEAD_PID);
  const release = acquireLock(path);
  assert.equal(readFileSync(path, 'utf8'), String(process.pid));
  assert.throws(() => acquireLock(path), { reason: 'retention-already-running' });
  release();
});

for (const content of ['', 'not-a-pid', '0', '-4', '1.5'])
  test(`a lock file holding ${JSON.stringify(content)} is not taken over`, () => {
    const path = lockPath();
    writeFileSync(path, content);
    assert.throws(() => acquireLock(path), { reason: 'retention-lock-unreadable' });
    assert.equal(readFileSync(path, 'utf8'), content);
  });

test('a release never removes a lock that now belongs to another process', () => {
  const path = lockPath();
  const release = acquireLock(path);
  writeFileSync(path, String(process.ppid));
  release();
  assert.equal(readFileSync(path, 'utf8'), String(process.ppid));
});

test('a stale lock that was replaced by a live holder is put back untouched', () => {
  const path = lockPath();
  writeFileSync(path, String(process.ppid));
  reclaim(path, Number(DEAD_PID));
  assert.equal(readFileSync(path, 'utf8'), String(process.ppid));
  assert.deepEqual(readdirSync(join(path, '..')), ['held.lock']);
});

test('a failed put-back keeps the displaced lock and stops instead of deleting it', () => {
  const path = lockPath();
  writeFileSync(path, String(process.ppid));
  assert.throws(() => reclaim(path, Number(DEAD_PID), () => false), {
    reason: 'retention-already-running',
  });
  const left = readdirSync(join(path, '..'));
  assert.equal(left.length, 1);
  assert.match(left[0], /^held\.lock\.stale\./);
  assert.equal(readFileSync(join(path, '..', left[0]), 'utf8'), String(process.ppid));
});

test('reclaiming the dead holder that was observed removes it', () => {
  const path = lockPath();
  writeFileSync(path, DEAD_PID);
  reclaim(path, Number(DEAD_PID));
  assert.deepEqual(readdirSync(join(path, '..')), []);
});
