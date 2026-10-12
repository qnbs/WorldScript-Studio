import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  admission,
  planPruning,
  REPOSITORY,
  reconcilePages,
  runAction,
} from '../../../scripts/prune-pages-deployments.mjs';

const ROOT = `/repos/${REPOSITORY}`;
const SITE = 'https://qnbs.github.io/WorldScript-Studio/';
const date = (id) => new Date(Date.UTC(2026, 0, 1) + id * 1000).toISOString();
const authority = {
  repository: REPOSITORY,
  ref: 'refs/heads/main',
  sha: 'a'.repeat(40),
  workflowRef: `${REPOSITORY}/.github/workflows/prune-deployments.yml@refs/heads/main`,
  eventName: 'schedule',
};
const holds = { rollback: [], evidence: [] };
function record(id) {
  return {
    id,
    created_at: date(id),
    sha: id.toString(16).padStart(40, '0'),
    environment: 'github-pages',
    ref: 'main',
    task: 'deploy',
    transient_environment: false,
    production_environment: false,
    performed_via_github_app: { id: 15368, slug: 'github-actions' },
    statuses: [
      {
        id: 100 + id,
        created_at: date(id),
        state: 'success',
        environment: 'github-pages',
        environment_url: SITE,
        log_url: `https://github.com/${REPOSITORY}/actions/runs/${1000 + id}/job/${2000 + id}`,
      },
    ],
  };
}
const records = (count) => Array.from({ length: count }, (_, index) => record(index + 1));
const publication = (id) => ({
  id: 1000 + id,
  repository: { full_name: REPOSITORY },
  head_repository: { full_name: REPOSITORY },
  name: 'CI / CD',
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: record(id).sha,
  status: 'completed',
  conclusion: 'success',
});
const apiError = (status, retryAfter) =>
  Object.assign(new Error('PRIVATE provider detail'), {
    status,
    response: { headers: { 'retry-after': retryAfter } },
  });
function client(initial, intercept = () => undefined) {
  const state = structuredClone(initial);
  const calls = [];
  let statusId = 10000;
  return {
    state,
    calls,
    request: async (route, parameters = {}) => {
      calls.push({ route, parameters });
      const override = await intercept(route, parameters, state, calls);
      if (override) return override;
      const response = (data) => ({ data: structuredClone(data), headers: {} });
      if (route === `GET ${ROOT}/pages`)
        return response({ build_type: 'workflow', html_url: SITE });
      if (route === `GET ${ROOT}/branches/main`)
        return response({ commit: { sha: authority.sha } });
      if (route === `GET ${ROOT}/deployments?environment=github-pages`)
        return response(
          state
            .slice((parameters.page - 1) * 100, parameters.page * 100)
            .map(({ statuses, ...item }) => item),
        );
      const deployment = /\/deployments\/(\d+)(\/statuses)?$/.exec(route);
      if (deployment) {
        const item = state.find((value) => value.id === Number(deployment[1]));
        if (!item) throw apiError(404);
        if (route.startsWith('GET '))
          return response(item.statuses.slice((parameters.page - 1) * 100, parameters.page * 100));
        if (route.startsWith('POST ')) {
          assert.equal(parameters.auto_inactive, false);
          const status = { ...parameters, id: statusId++, created_at: date(statusId) };
          item.statuses.push(status);
          return response(status);
        }
        assert.equal([...item.statuses].sort((a, b) => b.id - a.id)[0].state, 'inactive');
        state.splice(state.indexOf(item), 1);
        return response(undefined);
      }
      const runId = /\/actions\/runs\/(\d+)$/.exec(route);
      if (runId) {
        const id = Number(runId[1]) - 1000;
        return response(publication(id));
      }
      const jobId = /\/actions\/jobs\/(\d+)$/.exec(route);
      if (jobId)
        return response({
          id: Number(jobId[1]),
          run_id: Number(jobId[1]) - 1000,
          name: '🚀 Deploy to GitHub Pages',
          status: 'completed',
          conclusion: 'success',
          steps: [{ name: 'Deploy to GitHub Pages', conclusion: 'success' }],
        });
      throw new Error(`Unexpected fixture route ${route}`);
    },
  };
}
const writes = (github) => github.calls.filter((call) => !call.route.startsWith('GET '));
const execute = (github, options = {}) =>
  reconcilePages({ github, authority, holds, pause: async () => {}, ...options });

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
  { performed_via_github_app: null },
  { performed_via_github_app: { id: 15368, slug: 'other' } },
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

test('refuses malformed, duplicate or incomplete inventories and holds', () => {
  assert.throws(() => planPruning(records(5), holds, false), /incomplete/);
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
});

for (const state of ['queued', 'pending', 'waiting', 'in_progress', 'unknown'])
  test(`refuses unsettled status ${state}`, () => {
    const input = records(5);
    input[0].statuses.push({ ...input[0].statuses[0], id: 999, state, created_at: date(99) });
    assert.equal(planPruning(input, holds).blocked, true);
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
])
  test(`rejects execution authority ${JSON.stringify(change)}`, () => {
    assert.equal(admission({ ...authority, ...change }), 'refused');
  });

test('dispatch always performs a zero-write dry-run, regardless of caller payload', async () => {
  const github = client(records(5));
  const result = await execute(github, {
    authority: { ...authority, eventName: 'workflow_dispatch', inputs: { delete: true } },
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.candidate, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(writes(github), []);
});

test('inactivates then revalidates before deletion; repeated run is idempotent', async () => {
  const github = client(records(5));
  const first = await execute(github);
  assert.equal(first.failed, 0);
  assert.equal(first.deleted, 2);
  assert.equal(first.inactivated, 2);
  const second = await execute(github);
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
  const result = await execute(github);
  assert.equal(result.deleted, 1);
  assert.equal(writes(github).length, 1);
});

for (const status of [404, 409, 429, 500, 503])
  test(`failed inactivation ${status} never reaches DELETE or retries writes`, async () => {
    const github = client(records(4), (route) => {
      if (route.startsWith('POST ')) throw apiError(status, '1');
    });
    const result = await execute(github);
    assert.equal(result.failed, 1);
    assert.equal(result.deleted, 0);
    assert.deepEqual(
      writes(github).map((call) => call.route),
      [`POST ${ROOT}/deployments/1/statuses`],
    );
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  });

for (const status of [404, 409, 429, 500, 503])
  test(`failed DELETE ${status} is non-success and never blindly retried`, async () => {
    const github = client(records(4), (route) => {
      if (route.startsWith('DELETE ')) throw apiError(status);
    });
    const result = await execute(github);
    assert.equal(result.failed, 1);
    assert.equal(result.inactivated, 1);
    assert.equal(result.deleted, 0);
    assert.equal(writes(github).filter((call) => call.route.startsWith('DELETE ')).length, 1);
  });

test('bounded reads exhaust retries without writes', async () => {
  const github = client(records(4), () => {
    throw apiError(503);
  });
  assert.equal((await execute(github)).failed, 1);
  assert.equal(github.calls.length, 3);
  assert.deepEqual(writes(github), []);
});

test('bounded transient read retry succeeds; long 429 Retry-After fails closed', async () => {
  const github = client(records(4), (_route, _parameters, _state, calls) => {
    if (calls.length === 1) throw apiError(503);
  });
  assert.equal((await execute(github)).deleted, 1);
  const limited = client(records(4), () => {
    throw apiError(429, '60');
  });
  assert.equal((await execute(limited)).failed, 1);
  assert.equal(limited.calls.length, 1);
});

test('truncated pagination cannot authorize writes', async () => {
  const github = client(records(4), (route) =>
    route.includes('?environment=') ? { data: records(100), headers: {} } : undefined,
  );
  const result = await execute(github);
  assert.equal(result.failed, 1);
  assert.equal(result.reasons['pagination-limit'], 1);
  assert.deepEqual(writes(github), []);
});

test('a failed later inventory page is failure, never a partial clean result', async () => {
  const github = client(records(4), (route, parameters) => {
    if (!route.includes('?environment=')) return;
    if (parameters.page === 2) throw apiError(404);
    return {
      data: [record(1)],
      headers: {
        link: `<https://api.github.com${ROOT}/deployments?environment=github-pages&per_page=100&page=2>; rel="next"`,
      },
    };
  });
  assert.equal((await execute(github)).failed, 1);
  assert.deepEqual(writes(github), []);
});

for (const change of [
  { event: 'pull_request' },
  { event: 'workflow_dispatch' },
  { head_branch: 'v1.30' },
  { head_repository: { full_name: 'fork/repo' } },
  { conclusion: 'failure' },
  { conclusion: 'cancelled' },
  { path: '.github/workflows/other.yml' },
])
  test(`rejects publication evidence ${JSON.stringify(change)}`, async () => {
    const github = client(records(4), (route) =>
      route.includes('/actions/runs/')
        ? {
            data: { ...publication(Number(route.split('/').at(-1)) - 1000), ...change },
            headers: {},
          }
        : undefined,
    );
    const result = await execute(github);
    assert.equal(result.failed, 1);
    assert.deepEqual(writes(github), []);
  });

test('main moving invalidates hold and executable authority before mutation', async () => {
  const github = client(records(4), (route) =>
    route.endsWith('/branches/main')
      ? { data: { commit: { sha: 'b'.repeat(40) } }, headers: {} }
      : undefined,
  );
  assert.equal((await execute(github)).reasons['main-moved'], 1);
  assert.deepEqual(writes(github), []);
});

test('candidate SHA drift is skipped with zero writes', async () => {
  let inventories = 0;
  const github = client(records(4), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++inventories === 2) state[0].sha = 'b'.repeat(40);
  });
  const result = await execute(github);
  assert.equal(result.skipped, 1);
  assert.deepEqual(writes(github), []);
});

test('status promotion after inactivation prevents deletion', async () => {
  let inventories = 0;
  const github = client(records(4), (route, _parameters, state) => {
    if (route.includes('?environment=') && ++inventories === 3)
      state[0].statuses.push({ ...state[0].statuses[0], id: 99999, created_at: date(99999) });
  });
  const result = await execute(github);
  assert.equal(result.failed, 1);
  assert.equal(result.deleted, 0);
  assert.equal(writes(github).length, 1);
});

test('mixed partial outcomes report confirmed deletion and subsequent failure', async () => {
  const github = client(records(6), (route) => {
    if (route === `POST ${ROOT}/deployments/2/statuses`) throw apiError(409);
  });
  const result = await execute(github);
  assert.equal(result.deleted, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.followUpRequired, true);
  assert.ok(github.state.some((item) => item.id === 2));
});

test('caps each invocation at ten records and reports remaining backlog', async () => {
  const github = client(records(20));
  const result = await execute(github);
  assert.equal(result.deleted, 10);
  assert.equal(result.attempted, 10);
  assert.equal(result.followUpRequired, true);
  assert.equal(result.skipped, 7);
  assert.equal(result.reasons['batch-limit'], 7);
});

test('real workflow admits only main schedule and read-only dispatch with serialized writer', () => {
  const source = readFileSync(
    new URL('../../../.github/workflows/prune-deployments.yml', import.meta.url),
    'utf8',
  );
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

test('complete multi-page inventory makes stable progress', async () => {
  const github = client(records(5), (route, parameters, state) => {
    if (!route.includes('?environment=')) return;
    return parameters.page === 1
      ? {
          data: structuredClone(state.slice(0, 2)),
          headers: {
            link: `<https://api.github.com${ROOT}/deployments?environment=github-pages&per_page=100&page=2>; rel="next"`,
          },
        }
      : { data: structuredClone(state.slice(2)), headers: {} };
  });
  assert.equal((await execute(github)).deleted, 2);
});

test('contradictory status environment is unknown ownership and preserved', () => {
  const input = records(5);
  input[0].statuses[0].environment = 'Production';
  assert.ok(!planPruning(input, holds).candidates.some((item) => item.id === 1));
});

test('Actions summary reports a partial failure without provider or author metadata', async () => {
  const blocks = [];
  const logs = [];
  const failures = [];
  const summary = {
    addHeading() {
      return this;
    },
    addCodeBlock(value) {
      blocks.push(JSON.parse(value));
      return this;
    },
    async write() {},
  };
  const github = client(records(4), (route) => {
    if (route.startsWith('POST ')) throw apiError(409);
  });
  await runAction({
    github,
    holds,
    workflowRef: authority.workflowRef,
    core: {
      summary,
      info: (value) => logs.push(value),
      setFailed: (value) => failures.push(value),
    },
    context: {
      repo: { owner: 'qnbs', repo: 'WorldScript-Studio' },
      eventName: 'schedule',
      ref: authority.ref,
      sha: authority.sha,
    },
  });
  assert.equal(blocks[0].attempted, 1);
  assert.equal(blocks[0].deleted, 0);
  assert.equal(blocks[0].failed, 1);
  assert.equal(blocks[0].followUpRequired, true);
  assert.equal(failures.length, 1);
  assert.ok(!JSON.stringify([blocks, logs, failures]).includes('PRIVATE'));
  assert.ok(!JSON.stringify(blocks).includes('log_url'));
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

test('refuses normalized malformed dates and cross-record status ID collisions', () => {
  for (const created_at of ['2026-02-31T00:00:00Z', '2026-01-01T24:00:00Z', 'Jan 1 2026Z']) {
    assert.throws(() => planPruning([{ ...record(1), created_at }], holds), /invalid-inventory/);
  }
  const input = records(4);
  input[0].statuses[0].id = input[1].statuses[0].id;
  assert.throws(() => planPruning(input, holds), /invalid-statuses/);
});
