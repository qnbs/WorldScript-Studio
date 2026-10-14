import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertFunds,
  createContext,
  funds,
  REQUEST_LIMIT,
} from '../../../scripts/pages-pruning/github.mjs';
import { EXAMINE_LIMIT, PUBLISH_EVENTS } from '../../../scripts/pages-pruning/provenance.mjs';
import {
  candidateCeiling,
  EXTRA_RELOADS,
  finishCeiling,
} from '../../../scripts/pages-pruning/reconcile.mjs';
import {
  admission,
  DESTRUCTIVE_WRITES_ADMITTED,
  planPruning,
  runAction,
  TOKEN_ARGS,
  validateHolds,
} from '../../../scripts/prune-pages-deployments.mjs';
import {
  apiError,
  authority,
  client,
  date,
  execute,
  executeDestructive,
  headerlessError,
  holds,
  job as jobFixture,
  jobUrl,
  linkHeader,
  PRINCIPAL,
  publication,
  REPO_ID,
  ROOT,
  reads,
  reconcileShipped,
  record,
  records,
  status,
  writes,
} from './support/pagesPruningFixture.mjs';

const BOT = { login: 'github-actions[bot]', id: 41898282 };
const CURSOR = { login: 'cursor[bot]', id: 9002 };
const candidates = (result) =>
  result.manifest.filter((item) => item.disposition === 'candidate').map((item) => item.id);
const disposition = (result, id) => result.manifest.find((item) => item.id === id);
const nonSuccess = (item, state = 'failure') => {
  item.statuses = [status(item.id, { state })];
  return item;
};
// A history with failed publications between the current and the previous good one.
const gapped = () => {
  const input = records(8);
  for (const id of [5, 6, 7]) nonSuccess(input[id - 1]);
  return input;
};
const forgedSuccess = (input, id, at) =>
  input[id - 1].statuses.push(status(id, { id: 700 + id, created_at: date(at), creator: BOT }));

for (const count of [0, 1, 2, 3, 4, 20])
  test(`plans ${count} records with newest-three retention`, () => {
    const plan = planPruning(records(count), holds);
    assert.equal(plan.candidates.length, Math.max(0, count - 3));
    assert.equal(plan.protectedRecords.length, Math.min(count, 3));
  });

test('ties rank by deployment ID regardless of inventory ordering', () => {
  const input = records(5)
    .reverse()
    .map((item) => ({ ...item, created_at: date(1) }));
  assert.deepEqual(
    planPruning(input, holds).candidates.map((item) => item.id),
    [2, 1],
  );
});

test('protects current and prior successful publication outside newest three', () => {
  const input = records(6);
  input[0].statuses[0].created_at = date(90);
  input[1].statuses[0].created_at = date(89);
  const plan = planPruning(input, holds);
  assert.equal(plan.current, 1);
  assert.deepEqual(
    plan.candidates.map((item) => item.id),
    [3],
  );
});

test('protects explicit rollback and evidence IDs', () => {
  assert.deepEqual(
    planPruning(records(6), { rollback: [2], evidence: [1] }).candidates.map((item) => item.id),
    [3],
  );
});

for (const environment of ['Production', 'Preview', 'vercel', 'unknown', '', undefined])
  test(`preserves other environment ${environment}`, () => {
    const input = records(5);
    input[0].environment = environment;
    assert.ok(
      planPruning(input, holds)
        .protectedRecords.find((item) => item.id === 1)
        .reasons.includes('other-environment'),
    );
  });

for (const change of [
  { performed_via_github_app: { id: 15368, slug: 'other' } },
  { performed_via_github_app: { id: 1, slug: 'vercel' } },
  { creator: null },
  { creator: { login: '' } },
  { creator: BOT },
  { ref: 'feature' },
  { task: 'other' },
  { sha: 'unknown' },
  { transient_environment: true },
  { production_environment: true },
])
  test(`preserves unknown ownership ${JSON.stringify(change)}`, () => {
    const input = records(5);
    Object.assign(input[0], change);
    assert.ok(!planPruning(input, holds).candidates.some((item) => item.id === 1));
  });

test('accepts bot-triggered records that carry no GitHub App identity', () => {
  const input = records(5);
  input[0].performed_via_github_app = null;
  input[0].creator = { login: 'cursor[bot]' };
  assert.ok(planPruning(input, holds).candidates.some((item) => item.id === 1));
});

test('refuses malformed, duplicate or incomplete inventories and holds', () => {
  assert.throws(() => planPruning(records(5), holds, { complete: false }), /incomplete/);
  assert.throws(() => planPruning([record(1), record(1)], holds), /invalid-inventory/);
  assert.throws(
    () => planPruning([{ ...record(1), created_at: 'invalid' }], holds),
    /invalid-inventory/,
  );
  assert.throws(
    () => planPruning([{ ...record(1), statuses: undefined }], holds),
    /incomplete-statuses/,
  );
  assert.throws(() => planPruning(records(5), { rollback: [] }), /invalid-holds/);
  assert.throws(() => planPruning(records(5), { rollback: [], evidence: ['1'] }), /invalid-holds/);
  for (const bad of [null, [], 'holds', { rollback: [], evidence: [], extra: [] }])
    assert.throws(() => validateHolds(bad), /invalid-holds/);
});

for (const state of ['queued', 'pending', 'waiting', 'in_progress', 'unknown'])
  test(`refuses unsettled status ${state}`, () => {
    const input = records(5);
    input[0].statuses.push({ ...input[0].statuses[0], id: 999, state, created_at: date(99) });
    assert.equal(planPruning(input, holds).blocked, true);
  });

test('refuses normalized malformed dates and cross-record status ID collisions', () => {
  for (const created_at of ['2026-02-31T00:00:00Z', '2026-01-01T24:00:00Z', 'Jan 1 2026Z']) {
    assert.throws(() => planPruning([{ ...record(1), created_at }], holds), /invalid-inventory/);
  }
  const input = records(4);
  input[0].statuses[0].id = input[1].statuses[0].id;
  assert.throws(() => planPruning(input, holds), /invalid-statuses/);
});

test('contradictory status environment is unknown ownership and preserved', () => {
  const input = records(5);
  input[0].statuses[0].environment = 'Production';
  assert.ok(!planPruning(input, holds).candidates.some((item) => item.id === 1));
});

for (const eventName of ['workflow_run', 'pull_request', 'pull_request_target', 'push', 'unknown'])
  test(`rejects trigger ${eventName} with zero API writes`, async () => {
    const github = client(records(5));
    const result = await execute(github, { authority: { ...authority, eventName } });
    assert.equal(result.failed, 1);
    assert.equal(github.calls.length, 0);
  });

for (const change of [
  { repository: 'fork/WorldScript-Studio' },
  { ref: 'refs/tags/v1.30' },
  { ref: 'refs/pull/1/merge' },
  { sha: 'unknown' },
  { workflowRef: 'other@refs/heads/main' },
  { eventName: 'constructor' },
  { eventName: 'toString' },
])
  test(`rejects execution authority ${JSON.stringify(change)}`, () => {
    assert.equal(admission({ ...authority, ...change }), 'refused');
  });

test('dispatch always performs a zero-write dry-run, regardless of caller payload', async () => {
  const github = client(records(5));
  const result = await executeDestructive(github, {
    authority: { ...authority, eventName: 'workflow_dispatch', inputs: { delete: true } },
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.candidate, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(writes(github), []);
});

test('an explicit dry-run stays read-only even when the destructive gate is open', async () => {
  const github = client(records(5));
  const result = await executeDestructive(github, { dryRun: true });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.deleted, 0);
  assert.deepEqual(writes(github), []);
});

test('the shipped destructive gate admits a scheduled main run, and only that, to write', async () => {
  assert.equal(DESTRUCTIVE_WRITES_ADMITTED, true);
  const scheduled = client(records(5));
  const result = await reconcileShipped(scheduled);
  assert.equal(result.mode, 'delete');
  assert.equal(result.deleted, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.reasons['destructive-gate-closed'], undefined);
  assert.equal(writes(scheduled).length, 4);
  // The same code stays read-only for a dispatch, for the explicit dry-run and for an untrusted trigger.
  for (const options of [
    { authority: { ...authority, eventName: 'workflow_dispatch' } },
    { dryRun: true },
  ]) {
    const readOnly = client(records(5));
    const dry = await reconcileShipped(readOnly, options);
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.deleted, 0);
    assert.deepEqual(writes(readOnly), []);
  }
});

test('the gate constant is the only switch: closed, a scheduled run is read-only and says so', async () => {
  const github = client(records(5));
  const result = await reconcileShipped(github, { destructive: false });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.candidate, 2);
  assert.equal(result.deleted, 0);
  assert.equal(result.reasons['destructive-gate-closed'], 1);
  assert.deepEqual(writes(github), []);
});

const workflowSource = (name) =>
  readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8');

test('the workflow token carries deployments:write only while the destructive gate is open', () => {
  const grantsWrite = /^\s+deployments:\s*write\s*$/m.test(workflowSource('prune-deployments.yml'));
  assert.equal(grantsWrite, DESTRUCTIVE_WRITES_ADMITTED);
});

test('only the Pages publisher and the gated pruner can write deployment records in this repository', () => {
  const directory = new URL('../../../.github/workflows/', import.meta.url);
  const names = readdirSync(directory).filter((name) => name.endsWith('.yml'));
  const using = (pattern) => names.filter((name) => pattern.test(workflowSource(name))).sort();
  assert.deepEqual(
    using(/^\s+deployments:\s*write\s*$/m),
    DESTRUCTIVE_WRITES_ADMITTED ? ['prune-deployments.yml'] : [],
  );
  assert.deepEqual(using(/^\s+pages:\s*write\s*$/m), ['ci.yml']);
  assert.deepEqual(using(/actions\/deploy-pages@/), ['ci.yml']);
  assert.deepEqual(using(/createDeployment(Status)?\b|deployments\/\$\{[^}]+\}\/statuses/), []);
});

test('real workflow admits only main schedule and read-only dispatch with serialized writer', () => {
  const source = workflowSource('prune-deployments.yml');
  assert.ok(!source.includes('workflow_run:'));
  assert.ok(!source.includes('inputs:'));
  assert.ok(source.includes("cron: '0 3 * * *'"));
  assert.ok(source.includes('cancel-in-progress: false'));
  assert.ok(source.includes("github.repository == 'qnbs/WorldScript-Studio'"));
  assert.ok(source.includes("github.ref == 'refs/heads/main'"));
  assert.ok(source.includes(`ref: \${{ github.sha }}`));
  assert.ok(source.includes('persist-credentials: false'));
  assert.ok(source.includes('retries: 0'));
});

// The jobs of a workflow file keyed by their two-space-indented id.
const jobsOf = (source) => {
  const parts = source.slice(source.indexOf('\njobs:\n')).split(/^ {2}([a-z][\w-]*):$/m);
  return Object.fromEntries(
    parts
      .slice(1)
      .map((part, index, all) => (index % 2 === 0 ? [part, all[index + 1]] : null))
      .filter(Boolean),
  );
};

test('only the scheduled job holds deployments:write, the dispatched plan job is read-only', () => {
  const jobs = jobsOf(workflowSource('prune-deployments.yml'));
  assert.deepEqual(Object.keys(jobs).sort(), ['plan', 'prune']);
  assert.match(jobs.prune, /github\.event_name == 'schedule'/);
  assert.match(jobs.prune, /^\s+deployments:\s*write\s*$/m);
  assert.match(jobs.plan, /github\.event_name == 'workflow_dispatch'/);
  assert.match(jobs.plan, /^\s+deployments:\s*read\s*$/m);
  assert.ok(!/deployments:\s*write/.test(jobs.plan));
  assert.ok(!/schedule/.test(jobs.plan.replace(/github\.event_name == 'workflow_dispatch'/, '')));
});

test('inactivates then revalidates before deletion; repeated run is idempotent', async () => {
  const github = client(records(5));
  const first = await executeDestructive(github);
  assert.equal(first.failed, 0);
  assert.equal(first.deleted, 2);
  assert.equal(first.inactivated, 2);
  const second = await executeDestructive(github);
  assert.equal(second.deleted, 0);
  assert.equal(writes(github).length, 4);
  const routes = github.calls.map((call) => call.route);
  for (const id of [1, 2]) {
    const start = routes.indexOf(`POST ${ROOT}/deployments/${id}/statuses`);
    const end = routes.indexOf(`DELETE ${ROOT}/deployments/${id}`);
    assert.ok(start < end);
    assert.ok(routes.slice(start + 1, end).includes(`GET ${ROOT}/deployments/${id}/statuses`));
  }
});

test('already inactive candidates require no POST', async () => {
  const input = records(4);
  input[0].statuses.push({
    ...input[0].statuses[0],
    id: 900,
    created_at: date(900),
    state: 'inactive',
  });
  const github = client(input);
  const result = await executeDestructive(github);
  assert.equal(result.deleted, 1);
  assert.equal(writes(github).length, 1);
});

const unrecognizedInactive = {
  'an author that is missing': { creator: null },
  'an author without an account id': { creator: { login: 'maintainer' } },
  'a site that is not the Pages site': { environment_url: 'https://elsewhere.example/' },
  'no site at all': { environment_url: undefined },
};
for (const [name, change] of Object.entries(unrecognizedInactive))
  test(`an inactive latest status with ${name} is replaced by this run's own status before DELETE`, async () => {
    const input = records(4);
    input[0].statuses.push({
      ...input[0].statuses[0],
      id: 900,
      created_at: date(900),
      state: 'inactive',
      ...change,
    });
    const github = client(input);
    const result = await executeDestructive(github);
    assert.equal(result.deleted, 1);
    assert.equal(result.inactivated, 1);
    assert.deepEqual(
      writes(github).map((call) => call.route),
      [`POST ${ROOT}/deployments/1/statuses`, `DELETE ${ROOT}/deployments/1`],
    );
    // The new status carries the proven success status's job link, never the unrecognised one's.
    assert.equal(writes(github)[0].parameters.log_url, jobUrl(1));
  });

for (const code of [403, 404, 409, 429, 500, 503])
  test(`failed inactivation ${code} never reaches DELETE or retries writes`, async () => {
    const github = client(records(4), (route) => {
      if (route.startsWith('POST ')) throw apiError(code, '1');
    });
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.equal(result.deleted, 0);
    assert.deepEqual(
      writes(github).map((call) => call.route),
      [`POST ${ROOT}/deployments/1/statuses`],
    );
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  });

for (const code of [404, 409, 429, 500, 503])
  test(`failed DELETE ${code} is non-success and never blindly retried`, async () => {
    const github = client(records(4), (route) => {
      if (route.startsWith('DELETE ')) throw apiError(code);
    });
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.equal(result.inactivated, 1);
    assert.equal(result.deleted, 0);
    assert.equal(writes(github).filter((call) => call.route.startsWith('DELETE ')).length, 1);
  });

test('a malformed inactivation response never reaches DELETE', async () => {
  const github = client(records(4), (route) =>
    route.startsWith('POST ')
      ? { data: { id: 'x', state: 'success', created_at: 'now' }, headers: {} }
      : undefined,
  );
  const result = await executeDestructive(github);
  assert.equal(result.reasons['invalid-inactivation-response'], 1);
  assert.equal(writes(github).filter((call) => call.route.startsWith('DELETE ')).length, 0);
});

test('bounded reads exhaust retries without writes', async () => {
  const github = client(records(4), () => {
    throw apiError(503);
  });
  assert.equal((await executeDestructive(github)).failed, 1);
  assert.equal(github.calls.length, 3);
  assert.deepEqual(writes(github), []);
});

test('bounded transient read retry succeeds; long 429 Retry-After fails closed', async () => {
  const github = client(records(4), (_route, _parameters, _state, calls) => {
    if (calls.length === 1) throw apiError(503);
  });
  assert.equal((await executeDestructive(github)).deleted, 1);
  const limited = client(records(4), () => {
    throw apiError(429, '60');
  });
  assert.equal((await executeDestructive(limited)).failed, 1);
  assert.equal(limited.calls.length, 1);
});

test('truncated pagination cannot authorize writes', async () => {
  const github = client(records(4), (route) =>
    route.includes('?environment=') ? { data: records(100), headers: {} } : undefined,
  );
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['pagination-limit'], 1);
  assert.deepEqual(writes(github), []);
});

test('a failed later inventory page is failure, never a partial clean result', async () => {
  const github = client(records(4), (route, parameters) => {
    if (!route.includes('?environment=')) return;
    if (parameters.page === 2) throw apiError(404);
    return { data: [record(1)], headers: linkHeader(`${ROOT}/deployments`, 2) };
  });
  assert.equal((await executeDestructive(github)).failed, 1);
  assert.deepEqual(writes(github), []);
});

test('exactly full terminal page is probed for completeness in zero-write dry-run', async () => {
  const github = client(records(100));
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 0);
  assert.equal(result.queried, 100);
  assert.ok(
    github.calls.some((call) => call.route.includes('?environment=') && call.parameters.page === 2),
  );
  assert.deepEqual(writes(github), []);
});

const paged = (input, headers) =>
  client(input, (route, parameters, state) => {
    if (!route.includes('?environment=')) return;
    const first = parameters.page === 1;
    return {
      data: structuredClone(first ? state.slice(0, 2) : state.slice(2)),
      headers: first ? headers : {},
    };
  });

for (const [name, path] of [
  ['repository path', `${ROOT}/deployments`],
  ['repository id path', `/repositories/${REPO_ID}/deployments`],
])
  test(`a complete multi-page inventory accepts the ${name} next link`, async () => {
    const github = paged(records(5), linkHeader(path, 2));
    const result = await executeDestructive(github);
    assert.equal(result.failed, 0);
    assert.equal(result.deleted, 2);
    const lookups = reads(github, /^GET \/repos\/qnbs\/WorldScript-Studio$/).length;
    assert.equal(lookups, path.startsWith('/repositories') ? 1 : 0);
  });

const query = 'environment=github-pages&per_page=100';
const unsafeLinks = {
  'a different repository id': `https://api.github.com/repositories/9999/deployments?${query}&page=2`,
  'a foreign origin': `https://example.test/repositories/${REPO_ID}/deployments?${query}&page=2`,
  'a foreign repository path': `https://api.github.com/repos/other/Repo/deployments?${query}&page=2`,
  'the wrong next page': `https://api.github.com${ROOT}/deployments?${query}&page=3`,
  'an extra query parameter': `https://api.github.com${ROOT}/deployments?${query}&page=2&state=active`,
  'a different environment': `https://api.github.com${ROOT}/deployments?environment=Production&per_page=100&page=2`,
  'a duplicated parameter': `https://api.github.com${ROOT}/deployments?${query}&page=2&page=2`,
  'a malformed url': '::not a url::',
};
for (const [name, href] of Object.entries(unsafeLinks))
  test(`refuses a next link with ${name} and never writes`, async () => {
    const github = paged(records(5), { link: `<${href}>; rel="next"` });
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.equal(result.reasons['invalid-pagination-link'], 1);
    assert.deepEqual(writes(github), []);
  });

test('refuses a repository id lookup that names another repository', async () => {
  const github = client(records(5), (route, _parameters, state) => {
    if (route === `GET ${ROOT}`)
      return { data: { id: REPO_ID, full_name: 'other/Repo' }, headers: {} };
    if (route.includes('?environment='))
      return {
        data: structuredClone(state.slice(0, 2)),
        headers: linkHeader(`/repositories/${REPO_ID}/deployments`, 2),
      };
  });
  const result = await executeDestructive(github);
  assert.equal(result.reasons['unknown-repository'], 1);
  assert.deepEqual(writes(github), []);
});

test('status history over several pages loads completely under the repository id path', async () => {
  const input = records(5);
  const older = Array.from({ length: 149 }, (_, index) =>
    status(3, {
      id: 5000 + index,
      state: 'queued',
      created_at: new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString(),
    }),
  );
  input[2].statuses = [...older, status(3)];
  const github = client(input, (route, parameters, state) => {
    if (route !== `GET ${ROOT}/deployments/3/statuses`) return;
    const first = parameters.page === 1;
    return {
      data: structuredClone(state[2].statuses.slice(first ? 0 : 100, first ? 100 : 200)),
      headers: first
        ? {
            link: `<https://api.github.com/repositories/${REPO_ID}/deployments/3/statuses?page=2&per_page=100>; rel="next"`,
          }
        : {},
    };
  });
  const result = await execute(github);
  assert.equal(result.failed, 0);
  assert.ok(reads(github, /deployments\/3\/statuses$/).some((call) => call.parameters.page === 2));
});

test('an unproved success between current and a known-good rollback never consumes the rollback slot', async () => {
  const input = gapped();
  forgedSuccess(input, 2, 4.5);
  const shapeOnly = planPruning(input, holds);
  assert.ok(
    shapeOnly.candidates.some((item) => item.id === 4),
    'the shape-only plan alone would expose the genuine rollback',
  );
  const result = await execute(client(input));
  assert.equal(result.failed, 0);
  assert.equal(result.current, 8);
  assert.equal(result.rollback, 4);
  assert.equal(disposition(result, 4).disposition, 'protected');
  assert.ok(disposition(result, 2).reasons.includes('unproved-publication'));
  assert.deepEqual(candidates(result), [3, 1]);
});

test('refuses when no rollback publication can be proven', async () => {
  const github = client(records(6), (route) =>
    route.includes('/actions/runs/') && !route.endsWith('/1006')
      ? { data: publication(1, { head_branch: 'feature' }), headers: {} }
      : undefined,
  );
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['no-proven-rollback'], 1);
  assert.deepEqual(writes(github), []);
});

const runChanges = [
  { event: 'pull_request' },
  { event: 'schedule' },
  { event: 'repository_dispatch' },
  { event: 'release' },
  { head_branch: 'v1.30' },
  { head_repository: { full_name: 'fork/repo' } },
  { conclusion: 'failure' },
  { conclusion: 'cancelled' },
  { path: '.github/workflows/other.yml' },
  { path: '.github/workflows/ci.yml@refs/heads/feature' },
  { path: '.github/workflows/ci.yml@other' },
  { path: '.github/workflows/ci.yml.evil' },
  { path: undefined },
  { actor: { login: 'intruder', id: 7 }, triggering_actor: { login: 'intruder', id: 7 } },
  { actor: { login: 'maintainer' }, triggering_actor: { login: 'maintainer' } },
  { actor: { login: 'maintainer', id: 1 }, triggering_actor: { login: 'maintainer', id: 1 } },
  { actor: null, triggering_actor: null },
];
for (const change of runChanges)
  test(`rejects publication evidence ${JSON.stringify(change)}`, async () => {
    const github = client(records(4), (route) =>
      route.includes('/actions/runs/')
        ? {
            data: { ...publication(Number(route.split('/').at(-1)) - 1000), ...change },
            headers: {},
          }
        : undefined,
    );
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.equal(result.reasons['unproved-current'], 1);
    assert.deepEqual(writes(github), []);
  });

for (const change of [
  { conclusion: 'failure' },
  { name: 'Other job' },
  { steps: [] },
  { run_id: 1 },
  { head_sha: 'f'.repeat(40) },
  { head_sha: undefined },
])
  test(`rejects job evidence ${JSON.stringify(change)}`, async () => {
    const github = client(records(4), (route) =>
      route.includes('/actions/jobs/')
        ? { data: { ...jobFixture(Number(route.split('/').at(-1))), ...change }, headers: {} }
        : undefined,
    );
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.deepEqual(writes(github), []);
  });

const forgeries = {
  'a status authored by the Actions bot': (item) => {
    item.statuses[0].creator = BOT;
  },
  'a status authored by another principal': (item) => {
    item.statuses[0].creator = { login: 'intruder' };
  },
  'a status author without an account id': (item) => {
    item.statuses[0].creator = { login: PRINCIPAL.login };
  },
  'a status author whose account id differs from the run actor': (item) => {
    item.statuses[0].creator = { login: PRINCIPAL.login, id: PRINCIPAL.id + 1 };
  },
  'a deployment author without an account id': (item) => {
    item.creator = { login: PRINCIPAL.login };
  },
  'a deployment author whose account id differs from the run actor': (item) => {
    item.creator = { login: PRINCIPAL.login, id: PRINCIPAL.id + 1 };
  },
  'a status without an author': (item) => {
    delete item.statuses[0].creator;
  },
  'a deployment authored by another principal': (item) => {
    item.creator = { login: 'intruder' };
  },
  'a log_url naming another legitimate publication job': (item) => {
    item.statuses[0].log_url = jobUrl(5);
  },
};
for (const [name, forge] of Object.entries(forgeries))
  test(`a candidate with ${name} is protected and never deleted`, async () => {
    const input = records(5);
    forge(input[0]);
    const github = client(input);
    const result = await executeDestructive(github);
    assert.equal(result.failed, 0);
    assert.equal(result.deleted, 1);
    assert.equal(result.reasons['unproved-publication'], 1);
    assert.deepEqual(
      github.state.map((item) => item.id),
      [1, 3, 4, 5],
    );
  });

test('evidence that disappears after classification protects the record at the write boundary', async () => {
  let looked = 0;
  const github = client(records(5), (route) => {
    if (route.endsWith('/actions/runs/1002') && ++looked > 1) throw apiError(404);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['unknown-publication'], 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(writes(github), []);
  assert.equal(looked, 2, 'classification read the run once and the write boundary read it again');
});

for (const [remaining, outcome] of [
  ['120', 'is not issued'],
  ['5000', 'is issued'],
])
  test(`the inactive-status POST ${outcome} at ${remaining} live requests left`, async () => {
    const github = client(records(4), (route) => {
      if (route.endsWith('/branches/main'))
        return {
          data: { commit: { sha: authority.sha } },
          headers: { 'x-ratelimit-remaining': remaining },
        };
    });
    const result = await executeDestructive(github);
    assert.equal(result.failed, 0);
    assert.equal(result.deleted, remaining === '5000' ? 1 : 0);
    assert.equal(writes(github).length, remaining === '5000' ? 2 : 0);
    if (remaining !== '5000') assert.ok(result.reasons['budget-limit'] > 0);
  });

const notAPagesPublication = {
  'a record of another ref': (item) => {
    item.ref = 'feature';
  },
  'a success status for another site': (item) => {
    item.statuses[0].environment_url = 'https://elsewhere.example/';
  },
};
for (const [name, spoil] of Object.entries(notAPagesPublication))
  test(`${name} cannot take the rollback slot or protect the real previous publication from deletion`, async () => {
    const input = gapped();
    spoil(input[3]);
    const github = client(input);
    const result = await executeDestructive(github);
    assert.equal(result.failed, 0);
    assert.equal(result.rollback, 3);
    assert.equal(result.reasons['unproved-publication'], 1);
    assert.ok(
      github.state.some((item) => item.id === 3),
      'the real rollback is kept',
    );
    assert.ok(
      github.state.some((item) => item.id === 4),
      'the spoiled record is never deleted',
    );
  });

test('a status this run just created must come back as a recognised inactive Pages status', async () => {
  const github = client(records(4), (route, parameters, state) => {
    if (!route.startsWith('POST ')) return undefined;
    const item = state.find((entry) => entry.id === 1);
    const created = { ...parameters, id: 9999, created_at: date(900) };
    item.statuses.push(created);
    item.updated_at = created.created_at;
    return { data: created, headers: {} };
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 0);
  assert.equal(result.reasons['inactive-status-unrecognized'], 1);
  assert.deepEqual(
    writes(github).map((call) => call.route),
    [`POST ${ROOT}/deployments/1/statuses`],
  );
});

test('an already inactive candidate is not deleted when the live allowance is below the reserve', async () => {
  const lowAllowance = (remaining) =>
    client(
      (() => {
        const input = records(4);
        input[0].statuses.push({
          ...input[0].statuses[0],
          id: 900,
          created_at: date(900),
          state: 'inactive',
        });
        return input;
      })(),
      (route) =>
        route.endsWith('/branches/main')
          ? {
              data: { commit: { sha: authority.sha } },
              headers: { 'x-ratelimit-remaining': remaining },
            }
          : undefined,
    );
  const low = lowAllowance('90');
  const refused = await executeDestructive(low);
  assert.equal(refused.failed, 0);
  assert.equal(refused.deleted, 0);
  assert.ok(refused.reasons['budget-limit'] > 0);
  assert.deepEqual(writes(low), []);
  const high = lowAllowance('5000');
  assert.equal((await executeDestructive(high)).deleted, 1);
});

test('the proof scan stops when the live allowance cannot cover another proof and one candidate', async () => {
  const github = client(records(20), undefined, { 'x-ratelimit-remaining': '120' });
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 0);
  assert.equal(result.candidate, 0);
  assert.ok(result.reasons.unexamined > 0);
});

test('a failed slot proof still reports the whole inventory as protected or unexamined', async () => {
  const github = client(records(6), (route) => {
    if (route.includes('/actions/runs/')) throw apiError(404);
  });
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['unproved-current'], 1);
  assert.equal(result.classified, 6);
  assert.equal(result.manifest.length, 6);
  assert.equal(disposition(result, 1).disposition, 'unexamined');
  assert.deepEqual(writes(github), []);
});

for (const path of ['.github/workflows/ci.yml@refs/heads/main', '.github/workflows/ci.yml@main'])
  test(`a ref-qualified workflow path ${path} still proves the publication`, async () => {
    const github = client(records(4), (route) =>
      route.includes('/actions/runs/')
        ? {
            data: { ...publication(Number(route.split('/').at(-1)) - 1000), path },
            headers: {},
          }
        : undefined,
    );
    const result = await executeDestructive(github);
    assert.equal(result.failed, 0);
    assert.equal(result.deleted, 1);
  });

test('rate-limit headers of a failed read lower the live allowance used by the proof scan', async () => {
  const github = client(records(20), (route) => {
    if (!route.endsWith('/actions/runs/1017')) return undefined;
    throw Object.assign(apiError(404), {
      response: { headers: { 'x-ratelimit-remaining': '120' } },
    });
  });
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 0);
  assert.equal(result.candidate, 0);
  assert.equal(result.reasons['unproved-publication'], 1);
  assert.equal(result.reasons.unexamined, 16);
});

const budgetRefusal = () => Object.assign(new Error('budget'), { reason: 'request-budget' });

test('a budget refusal before the first write of a candidate is the graceful stop, not a failure', async () => {
  const github = client(records(4), (route) => {
    if (route.endsWith('/branches/main')) throw budgetRefusal();
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 0);
  assert.ok(result.reasons['budget-limit'] > 0);
  assert.equal(result.followUpRequired, true);
  assert.deepEqual(writes(github), []);
});

test('the same budget refusal after the inactive-status POST stays a failure', async () => {
  let mains = 0;
  const github = client(records(4), (route) => {
    if (route.endsWith('/branches/main') && ++mains === 2) throw budgetRefusal();
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['request-budget'], 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(
    writes(github).map((call) => call.route),
    [`POST ${ROOT}/deployments/1/statuses`],
  );
});

test('an unknown allowance funds nothing and the write boundary names the exact reason', () => {
  const ctx = createContext({ github: {}, authority });
  ctx.remaining = null;
  assert.equal(funds(ctx, 1), false);
  assert.throws(() => assertFunds(ctx, 1), /rate-unknown/);
  ctx.remaining = 100;
  assert.equal(funds(ctx, 1), false);
  assert.throws(() => assertFunds(ctx, 1), /rate-reserve/);
  ctx.remaining = 101;
  assert.equal(funds(ctx, 1), true);
  assert.doesNotThrow(() => assertFunds(ctx, 1));
  ctx.remaining = 5000;
  ctx.used = ctx.limit;
  assert.equal(funds(ctx, 1), false);
  assert.throws(() => assertFunds(ctx, 1), /request-budget/);
});

test('an allowance that the last read before the first write does not report funds no write', async () => {
  const github = client(records(4), (route) => {
    if (route.endsWith('/branches/main'))
      return {
        data: { commit: { sha: authority.sha } },
        headers: { 'x-ratelimit-remaining': undefined },
      };
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 0);
  assert.ok(result.reasons['budget-limit'] > 0);
  assert.equal(result.followUpRequired, true);
  assert.deepEqual(writes(github), []);
});

for (const [remaining, reason] of [
  ['100', 'rate-reserve'],
  [undefined, 'rate-unknown'],
])
  test(`the DELETE is funded again after the inactive-status POST: allowance ${remaining ?? 'missing'} stops it as ${reason}`, async () => {
    let mains = 0;
    const github = client(records(4), (route) => {
      if (route.endsWith('/branches/main') && ++mains === 2)
        return {
          data: { commit: { sha: authority.sha } },
          headers: { 'x-ratelimit-remaining': remaining },
        };
    });
    const result = await executeDestructive(github);
    assert.equal(result.failed, 1);
    assert.equal(result.reasons[reason], 1);
    assert.equal(result.deleted, 0);
    assert.equal(result.inactivated, 1);
    assert.deepEqual(
      writes(github).map((call) => call.route),
      [`POST ${ROOT}/deployments/1/statuses`],
    );
    // The record stays inactive and is retired by a later pass without another POST.
    const next = await executeDestructive(client(github.state));
    assert.equal(next.failed, 0);
    assert.equal(next.deleted, 1);
  });

test('a publication that lands between the two write boundaries stops the DELETE and the run', async () => {
  let lists = 0;
  const github = client(records(6), (route, _parameters, state) => {
    // The third list read is the revalidation that follows the inactive-status POST.
    if (route.includes('?environment=') && ++lists === 3) state.push(record(99));
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['current-moved'], 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(
    writes(github).map((call) => call.route),
    [`POST ${ROOT}/deployments/3/statuses`],
  );
});

// The allowance falls by one per call, like the real counter.
const countdown = (start) => (calls) => ({ 'x-ratelimit-remaining': String(start - calls) });

test('inventory reads stop before the live allowance drops below the CI reserve', async () => {
  const github = client(records(150), undefined, countdown(120));
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['rate-reserve'], 1);
  // The 20th response reports 100 left, which is the reserve; no 21st request is sent.
  assert.equal(github.calls.length, 20);
  assert.equal(result.requests, 20);
  assert.equal(result.candidate, 0);
  assert.deepEqual(writes(github), []);
});

for (const [remaining, completes] of [
  ['101', true],
  ['100', false],
])
  test(`an allowance of ${remaining} ${completes ? 'lets the read-only pass finish' : 'is refused after the first request'}`, async () => {
    const github = client(records(6), undefined, { 'x-ratelimit-remaining': remaining });
    const result = await execute(github, { dryRun: true });
    assert.equal(result.failed, completes ? 0 : 1);
    assert.equal(result.reasons['rate-reserve'], completes ? undefined : 1);
    if (!completes) assert.equal(github.calls.length, 1);
    assert.deepEqual(writes(github), []);
  });

test('a response without a rate header stops the run after the first request', async () => {
  const github = client(records(4), undefined, { 'x-ratelimit-remaining': undefined });
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['rate-unknown'], 1);
  assert.equal(github.calls.length, 1);
});

test('a later response without a rate header does not leave a stale allowance behind', async () => {
  const github = client(records(4), undefined, (calls) =>
    calls === 1 ? {} : { 'x-ratelimit-remaining': undefined },
  );
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['rate-unknown'], 1);
  assert.equal(github.calls.length, 2);
});

// The first candidate's publication run (not a slot) is the read that fails.
const firstCandidateRun = (slotRuns, fail) => {
  let failed = false;
  return (route) => {
    const run = /\/actions\/runs\/(\d+)$/.exec(route);
    if (!run || slotRuns.includes(Number(run[1])) || failed) return undefined;
    failed = true;
    throw fail();
  };
};

test('a header-less error that ends a read leaves the allowance unknown, so no later write is funded', async () => {
  const control = client(
    records(6),
    firstCandidateRun([1005, 1006], () => apiError(404)),
  );
  assert.equal((await executeDestructive(control)).deleted, 2);
  const github = client(
    records(6),
    firstCandidateRun([1005, 1006], () => headerlessError(404)),
  );
  const result = await executeDestructive(github);
  assert.equal(result.deleted, 0);
  assert.deepEqual(writes(github), []);
});

test('a header-less error on a read that is retried keeps the allowance until the retry answers', async () => {
  const seen = new Set();
  const github = client(records(6), (route, parameters) => {
    const key = `${route}${JSON.stringify(parameters)}`;
    if (!route.startsWith('GET ') || !route.includes('/actions/') || seen.has(key)) return;
    seen.add(key);
    throw headerlessError(503);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 3);
});

test('a throttled response lowers the allowance before any retry can be sent', async () => {
  const github = client(records(4), () => {
    throw Object.assign(apiError(429, '0'), {
      response: { headers: { 'retry-after': '0', 'x-ratelimit-remaining': '50' } },
    });
  });
  const result = await execute(github, { dryRun: true });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['rate-reserve'], 1);
  assert.equal(github.calls.length, 1);
});

test('a candidate whose publication run no longer exists is protected', async () => {
  const github = client(records(5), (route) => {
    if (route.endsWith('/actions/runs/1001')) throw apiError(404);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.reasons['unproved-publication'], 1);
  assert.ok(github.state.some((item) => item.id === 1));
});

test('a bot-triggered record is retired when its run actor matches the record authors', async () => {
  const input = records(5);
  input[0].performed_via_github_app = null;
  input[0].creator = CURSOR;
  input[0].statuses[0].creator = CURSOR;
  const github = client(input, (route) =>
    route.endsWith('/actions/runs/1001')
      ? {
          data: publication(1, {
            actor: CURSOR,
            triggering_actor: CURSOR,
          }),
          headers: {},
        }
      : undefined,
  );
  const result = await executeDestructive(github);
  assert.equal(result.deleted, 2);
  assert.deepEqual(
    github.state.map((item) => item.id),
    [3, 4, 5],
  );
});

test('main moving invalidates hold and executable authority before mutation', async () => {
  const github = client(records(4), (route) =>
    route.endsWith('/branches/main')
      ? { data: { commit: { sha: 'b'.repeat(40) } }, headers: {} }
      : undefined,
  );
  assert.equal((await executeDestructive(github)).reasons['main-moved'], 1);
  assert.deepEqual(writes(github), []);
});

test('candidate SHA drift stops the run with zero writes instead of deleting its neighbours', async () => {
  let lists = 0;
  // The candidates of eight records are retired newest first; the second list read is the first revalidation.
  const github = client(records(8), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 2) state[4].sha = 'b'.repeat(40);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['candidate-moved'], 1);
  assert.equal(result.deleted, 0);
  assert.deepEqual(writes(github), []);
});

test('a candidate that vanished is skipped and the run goes on with the next one', async () => {
  let lists = 0;
  const github = client(records(6), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 2) state.splice(2, 1);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.deleted, 2);
  assert.deepEqual(
    github.state.map((item) => item.id),
    [4, 5, 6],
  );
});

test('status promotion after inactivation prevents deletion', async () => {
  let lists = 0;
  const github = client(records(4), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 3)
      state[0].statuses.push({ ...state[0].statuses[0], id: 99999, created_at: date(99999) });
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.deleted, 0);
  assert.equal(writes(github).length, 1);
});

test('a record whose list key changed is re-read and a new publication head stops the run', async () => {
  let lists = 0;
  const github = client(records(8), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 2) {
      state[1].statuses.push(status(2, { id: 5555, created_at: date(500) }));
      state[1].updated_at = date(500);
    }
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['current-moved'], 1);
  assert.deepEqual(writes(github), []);
});

test('more changed unfocused records than a refresh can afford stop the run before any write', async () => {
  let lists = 0;
  const github = client(records(10), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 2)
      for (const item of state.slice(0, EXTRA_RELOADS + 1)) item.updated_at = date(500);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['inventory-churn'], 1);
  assert.deepEqual(writes(github), []);
  // The refusal comes before any history of the changed records is read again.
  assert.equal(statusReads(github), 10);
});

test('as many changed unfocused records as a refresh can afford are reloaded and the run goes on', async () => {
  let lists = 0;
  const github = client(records(10), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++lists === 2)
      for (const item of state.slice(0, EXTRA_RELOADS)) item.updated_at = date(500);
  });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 7);
});

for (const [name, extra] of [
  ['a successful', record(99)],
  ['an in-flight', record(99, { statuses: [status(99, { state: 'in_progress' })] })],
])
  test(`${name} publication appearing during the run stops before any write`, async () => {
    let lists = 0;
    const github = client(records(6), (route, _parameters, state) => {
      if (route.includes('?environment=') && ++lists === 2) state.push(structuredClone(extra));
    });
    const result = await executeDestructive(github);
    assert.equal(result.reasons['current-moved'], 1);
    assert.deepEqual(writes(github), []);
  });

const arrivals = [
  (size) => record(size + 1),
  (size) => nonSuccess(record(size + 1)),
  (size) => nonSuccess(record(size + 1), 'in_progress'),
];
const withFailures = (size) => {
  const input = records(size);
  for (const item of input) if (item.id % 3 === 0) nonSuccess(item);
  return input;
};
test('a stale snapshot never turns a genuine candidate into a protected record after a new publication', () => {
  for (const size of [4, 6, 9, 14])
    for (const build of [records, withFailures])
      for (const arrive of arrivals) {
        const stale = build(size);
        const fresh = [...stale, arrive(size)];
        const before = planPruning(stale, holds).candidates.map((item) => item.id);
        const after = new Set(planPruning(fresh, holds).candidates.map((item) => item.id));
        for (const id of before) assert.ok(after.has(id), `record ${id} of ${size}`);
      }
});

test('mixed partial outcomes report confirmed deletion and subsequent failure', async () => {
  const github = client(records(6), (route) => {
    if (route === `POST ${ROOT}/deployments/2/statuses`) throw apiError(409);
  });
  const result = await executeDestructive(github);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.followUpRequired, true);
  assert.ok(github.state.some((item) => item.id === 2));
});

test('caps each invocation at ten records and reports remaining backlog', async () => {
  const github = client(records(20));
  const result = await executeDestructive(github);
  assert.equal(result.deleted, 10);
  assert.equal(result.attempted, 10);
  assert.equal(result.followUpRequired, true);
  assert.equal(result.skipped, 7);
  assert.equal(result.reasons['batch-limit'], 7);
});

const statusReads = (github) => reads(github, /\/statuses$/).length;
for (const [count, bound] of [
  [6, 100],
  [50, 370],
  [100, 420],
])
  test(`request volume stays bounded for ${count} records`, async () => {
    const github = client(records(count));
    const result = await executeDestructive(github);
    const expected = Math.min(10, count - 3);
    assert.equal(result.failed, 0);
    assert.equal(result.deleted, expected);
    assert.equal(result.requests, github.calls.length);
    assert.ok(result.requests <= bound, `${result.requests} requests for ${count} records`);
    assert.ok(result.requests < REQUEST_LIMIT);
    // Inventory reads every history once; each write then re-reads only the candidate and both slots, twice.
    assert.equal(statusReads(github), count + 6 * expected);
  });

test('a request budget that cannot fund another candidate stops gracefully before writes', async () => {
  const github = client(records(100));
  const result = await executeDestructive(github, { limit: 160 });
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 0);
  assert.ok(result.reasons['budget-limit'] > 0);
  assert.ok(result.reasons.unexamined > 0);
  assert.equal(result.followUpRequired, true);
  assert.deepEqual(writes(github), []);
});

test('an inventory larger than the request budget fails closed without writes', async () => {
  const github = client(records(100));
  const result = await executeDestructive(github, { limit: 50 });
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['request-budget'], 1);
  assert.equal(result.requests, 50);
  assert.deepEqual(writes(github), []);
});

test('the per-candidate cost ceiling grows with the observed inventory depth', () => {
  assert.equal(candidateCeiling({ observed: { list: 1, status: 1 } }), 42);
  const deep = candidateCeiling({ observed: { list: 4, status: 5 } });
  assert.equal(deep, 96);
  assert.ok(deep > 40, 'a fixed 40-request allowance would under-reserve this inventory');
});

const deepHistory = (input) => {
  const item = input.at(-1);
  const older = Array.from({ length: 449 }, (_, index) =>
    status(item.id, {
      id: 7000 + index,
      state: 'queued',
      created_at: new Date(Date.UTC(2025, 0, 1) + index * 1000).toISOString(),
    }),
  );
  item.statuses.push(...older);
  return input;
};

test('a candidate pass is reserved at the observed inventory depth before any write', async () => {
  const dry = await execute(client(deepHistory(records(14))), { dryRun: true });
  const ceiling = candidateCeiling({ observed: { list: 1, status: 5 } });
  assert.equal(ceiling, 90);
  const short = client(deepHistory(records(14)));
  const refused = await executeDestructive(short, { limit: dry.requests + ceiling - 1 });
  assert.equal(refused.failed, 0);
  assert.ok(refused.reasons['budget-limit'] > 0);
  assert.deepEqual(writes(short), []);
  // First revalidation: list page, candidate and rollback histories, five current-record pages, main read, three re-proofs.
  const preWrite = 1 + 1 + 5 + 1 + 1 + 6;
  const funded = client(deepHistory(records(14)));
  const done = await executeDestructive(funded, {
    limit: dry.requests + preWrite + finishCeiling({ observed: { list: 1, status: 5 } }),
  });
  assert.equal(done.failed, 0);
  assert.equal(done.deleted, 1);
});

test('the reservation covers the POST, every later read at its full retry count and the DELETE', () => {
  assert.equal(finishCeiling({ observed: { list: 1, status: 1 } }), 71);
  assert.equal(finishCeiling({ observed: { list: 4, status: 5 } }), 152);
});

test('the POST is only issued when everything after it fits the budget even with retried reads', async () => {
  const dry = await execute(client(records(8)), { dryRun: true });
  // First revalidation: list page, three focused histories, main read, three re-proofs.
  const preWrite = 5 + 6;
  const finish = finishCeiling({ observed: { list: 1, status: 1 } });
  const short = client(records(8));
  const refused = await executeDestructive(short, { limit: dry.requests + preWrite + finish - 1 });
  assert.equal(refused.failed, 0);
  assert.ok(refused.reasons['budget-limit'] > 0);
  assert.deepEqual(writes(short), []);
  let posted = false;
  const seen = new Set();
  const flaky = client(records(8), (route, parameters) => {
    if (route.startsWith('POST ')) posted = true;
    if (!posted || !route.startsWith('GET ')) return;
    const key = `${route}${JSON.stringify(parameters)}`;
    if (seen.has(key)) return;
    seen.add(key);
    throw apiError(503);
  });
  const done = await executeDestructive(flaky, { limit: dry.requests + preWrite + finish });
  assert.equal(done.failed, 0);
  assert.equal(done.deleted, 1);
});

test('the CI inventory describes the reconciliation triggers and authority', () => {
  const audit = readFileSync(new URL('../../../.github/CI-AUDIT.md', import.meta.url), 'utf8');
  const row = audit.split('\n').find((line) => line.includes('workflows/prune-deployments.yml'));
  assert.ok(row, 'CI-AUDIT.md lists the pruning workflow');
  assert.match(row, /daily cron/);
  assert.match(row, /no `workflow_run`/);
  assert.match(row, /GitHub Pages deployment records only/);
  assert.ok(!/ALL environments/.test(row));
});

test('records beyond the examination limit are reported as unexamined, never as candidates', async () => {
  const input = records(40);
  input[0].statuses[0].creator = BOT;
  const github = client(input);
  const result = await execute(github);
  assert.equal(result.failed, 0);
  assert.equal(result.candidate, EXAMINE_LIMIT);
  assert.equal(result.reasons.unexamined, 17);
  assert.equal(disposition(result, 1).disposition, 'unexamined');
  assert.equal(candidates(result).length, EXAMINE_LIMIT);
  assert.ok(!candidates(result).includes(1));
  // Slots take two proofs; each examined candidate takes one; nothing else is fetched.
  assert.equal(reads(github, /\/actions\/runs\//).length, 2 + EXAMINE_LIMIT);
});

test('unprovable newest records do not hide older provable candidates', async () => {
  const input = records(40);
  for (const id of Array.from({ length: 22 }, (_, index) => 16 + index)) {
    input[id - 1].statuses[0].creator = BOT;
  }
  const github = client(input);
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.reasons['unproved-publication'], 22);
  assert.equal(result.candidate, 15);
  assert.equal(result.reasons.unexamined, undefined);
  assert.equal(result.deleted, 10);
  assert.ok(
    github.state.some((item) => item.id === 20),
    'an unprovable record is never deleted',
  );
});

test('the scan keeps the budget floor of one candidate for the mutation phase', async () => {
  const github = client(records(100));
  const dry = await execute(github, { dryRun: true, limit: 140 });
  assert.equal(dry.failed, 0);
  assert.equal(dry.candidate, 0);
  assert.ok(dry.reasons.unexamined > 0);
  assert.deepEqual(reads(github, /\/actions\/runs\//).length, 2);
});

test('every candidate within the examination limit is proven even beyond the deletion batch', async () => {
  const input = records(20);
  forgedSuccess(input, 1, 1.5);
  const result = await execute(client(input));
  assert.equal(result.failed, 0);
  assert.equal(result.reasons['unproved-publication'], 1);
  assert.ok(!candidates(result).includes(1));
  assert.equal(result.candidate, 16);
});

test('manual CI dispatch publications on main are proven like push publications', async () => {
  const github = client(records(5), (route) =>
    route.includes('/actions/runs/')
      ? {
          data: publication(Number(route.split('/').at(-1)) - 1000, { event: 'workflow_dispatch' }),
          headers: {},
        }
      : undefined,
  );
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 2);
});

test('the proven publication events are exactly the non-pull_request events ci.yml publishes from', () => {
  const ci = workflowSource('ci.yml');
  const triggers = ci.slice(ci.indexOf('\non:'), ci.indexOf('\npermissions:'));
  const declared = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)]
    .map((match) => match[1])
    .filter((name) => name !== 'pull_request')
    .sort();
  assert.deepEqual([...PUBLISH_EVENTS].sort(), declared);
  assert.match(ci, /github\.event_name != 'pull_request'/);
  assert.match(ci, /github\.ref == 'refs\/heads\/main'/);
});

test('a low live rate-limit allowance stops before the next candidate', async () => {
  const github = client(records(30), undefined, { 'x-ratelimit-remaining': '120' });
  const result = await executeDestructive(github);
  assert.equal(result.failed, 0);
  assert.equal(result.deleted, 0);
  assert.ok((result.reasons['budget-limit'] ?? 0) + (result.reasons.unexamined ?? 0) > 0);
  assert.deepEqual(writes(github), []);
});

const summaryStub = (blocks) => ({
  addHeading() {
    return this;
  },
  addCodeBlock(value) {
    blocks.push(JSON.parse(value));
    return this;
  },
  async write() {},
});
const actionContext = {
  repo: { owner: 'qnbs', repo: 'WorldScript-Studio' },
  eventName: 'schedule',
  ref: authority.ref,
  sha: authority.sha,
};

test('Actions summary reports a failure without provider or author metadata', async () => {
  const blocks = [];
  const logs = [];
  const failures = [];
  const github = client(records(4), (route) => {
    if (route.includes('/actions/runs/')) throw apiError(503);
  });
  await runAction({
    github,
    holds,
    workflowRef: authority.workflowRef,
    context: actionContext,
    core: {
      summary: summaryStub(blocks),
      info: (value) => logs.push(value),
      setFailed: (value) => failures.push(value),
    },
  });
  assert.equal(blocks[0].failed, 1);
  assert.equal(blocks[0].deleted, 0);
  assert.equal(failures.length, 1);
  assert.ok(!JSON.stringify([blocks, logs, failures]).includes('PRIVATE'));
  assert.ok(!JSON.stringify(blocks).includes('log_url'));
});

test('Actions warns when the backlog exceeds one bounded pass', async () => {
  const warnings = [];
  await runAction({
    github: {},
    holds,
    workflowRef: authority.workflowRef,
    context: actionContext,
    reconcile: async () => ({ manifest: [], reasons: { 'batch-limit': 3 }, failed: 0 }),
    core: {
      summary: summaryStub([]),
      info: () => {},
      warning: (value) => warnings.push(value),
      setFailed: () => assert.fail('a backlog is not a failure'),
    },
  });
  assert.equal(warnings.length, 1);
});

test('the local CLI asks for the github.com token explicitly, whatever GH_HOST says', () => {
  assert.deepEqual(TOKEN_ARGS, ['auth', 'token', '--hostname', 'github.com']);
});

test('the local CLI refuses every mode except --dry-run before any network access', () => {
  const script = fileURLToPath(
    new URL('../../../scripts/prune-pages-deployments.mjs', import.meta.url),
  );
  for (const flag of ['--delete', '--execute', '']) {
    const result = spawnSync(process.execPath, flag ? [script, flag] : [script], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Read-only Pages inventory failed/);
  }
});

test('a blocked run still lists every eligible record in the manifest as unexamined', async () => {
  const input = records(4);
  input[3].statuses.push(status(4, { id: 999, state: 'in_progress', created_at: date(99) }));
  const result = await execute(client(input));
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['unproved-current-or-unsettled'], 1);
  assert.equal(result.classified, 4);
  assert.equal(result.manifest.length, 4);
  assert.equal(disposition(result, 1).disposition, 'unexamined');
  assert.deepEqual(disposition(result, 1).reasons, ['blocked-before-proof']);
  assert.deepEqual(candidates(result), []);
});
