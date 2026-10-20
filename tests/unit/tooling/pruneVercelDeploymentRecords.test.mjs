import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admission,
  planRecords,
  reconcileVercelRecords,
  WORKFLOW,
} from '../../../scripts/prune-vercel-deployment-records.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const MAIN = sha(999);
let nextId = 1;
function record(environment, day, { creator = 'vercel[bot]', commit = sha(nextId) } = {}) {
  const id = nextId++;
  return {
    id,
    environment,
    sha: commit,
    created_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
    creator: { login: creator },
  };
}
const days = (environment, count, from = 1) =>
  Array.from({ length: count }, (_, i) => record(environment, from + i));

// A route table instead of branching keeps every scenario a small data override.
function fakeGithub({ records, overrides = {}, remaining = 4000 }) {
  const calls = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const routes = {
    'GET /repos/{owner}/{repo}/deployments': (p) => (p.page === 1 ? records : []),
    'GET /repos/{owner}/{repo}/pulls': () => [],
    'GET /repos/{owner}/{repo}/commits/{ref}': () => ({ sha: MAIN }),
    'GET /repos/{owner}/{repo}/deployments/{deployment_id}': (p) => byId.get(p.deployment_id),
    'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': () => [{ state: 'success' }],
    'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': () => ({
      state: 'inactive',
    }),
    'DELETE /repos/{owner}/{repo}/deployments/{deployment_id}': () => null,
    ...overrides,
  };
  return {
    calls,
    async request(route, params) {
      calls.push([route, params.deployment_id ?? null]);
      const data = routes[route](params, calls);
      return { data, headers: { 'x-ratelimit-remaining': String(remaining) } };
    },
  };
}

const writesOf = (github) => github.calls.filter(([route]) => !route.startsWith('GET '));
const schedule = {
  repository: 'qnbs/WorldScript-Studio',
  ref: 'refs/heads/main',
  eventName: 'schedule',
  sha: MAIN,
  workflowRef: WORKFLOW,
};

test('keeps the newest ten per environment and leaves other environments and creators alone', () => {
  const production = days('Production', 14);
  const preview = days('Preview', 12);
  const outOfScope = [
    record('github-pages', 1, { creator: 'qnbs' }),
    record('Production', 1, { creator: 'other' }),
  ];
  const { kept, candidates } = planRecords({
    records: [...production, ...preview, ...outOfScope],
    mainSha: MAIN,
    openHeads: new Set(),
  });
  assert.equal(kept.length, 20);
  const expected = [...production.slice(0, 4), ...preview.slice(0, 2)].map((r) => r.id);
  assert.deepEqual(new Set(candidates.map((r) => r.id)), new Set(expected));
  assert.ok(candidates.every((r, i) => i === 0 || r.created_at >= candidates[i - 1].created_at));
  for (const r of outOfScope) assert.ok(!candidates.includes(r) && !kept.includes(r));
});

test('protects the current main commit and the Preview records of open PR heads', () => {
  const openHead = sha(4242);
  const old = [
    record('Production', 1, { commit: MAIN }),
    record('Preview', 1, { commit: openHead }),
  ];
  const { candidates } = planRecords({
    records: [...old, ...days('Production', 10, 5), ...days('Preview', 10, 5)],
    mainSha: MAIN,
    openHeads: new Set([openHead]),
  });
  assert.deepEqual(candidates, []);
});

test('refuses the whole plan when an in-scope record is malformed', () => {
  const bad = { ...record('Preview', 1), sha: 'not-a-sha' };
  assert.throws(
    () => planRecords({ records: [bad], mainSha: MAIN, openHeads: new Set() }),
    /record-malformed/,
  );
});

test('binds writes to the scheduled trusted workflow on a full commit of this repository', () => {
  assert.deepEqual(admission(schedule), { writes: true });
  assert.deepEqual(admission({ ...schedule, eventName: 'workflow_dispatch' }), { writes: false });
  assert.throws(() => admission({ ...schedule, repository: 'fork/x' }), /repository-unexpected/);
  assert.throws(() => admission({ ...schedule, ref: 'refs/heads/feature' }), /ref-unexpected/);
  assert.throws(
    () => admission({ ...schedule, workflowRef: `${WORKFLOW}x` }),
    /workflow-unexpected/,
  );
  assert.throws(() => admission({ ...schedule, sha: 'abc' }), /sha-invalid/);
});

test('a dispatched run plans without any write', async () => {
  const github = fakeGithub({ records: days('Production', 13) });
  const summary = await reconcileVercelRecords({
    github,
    authority: { ...schedule, eventName: 'workflow_dispatch' },
  });
  assert.equal(summary.candidates, 3);
  assert.deepEqual(writesOf(github), []);
});

test('inactivates only active records, proves the inactive status, deletes oldest first within the batch limit', async () => {
  const records = days('Production', 14);
  const [first, second] = records;
  const inactive = new Set([second.id]);
  const github = fakeGithub({
    records,
    overrides: {
      'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': (p) => [
        { state: inactive.has(p.deployment_id) ? 'inactive' : 'success' },
      ],
      'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': (p) => {
        inactive.add(p.deployment_id);
        return { state: 'inactive' };
      },
    },
  });
  const summary = await reconcileVercelRecords({ github, authority: schedule, maxDeletes: 2 });
  assert.deepEqual(summary.deleted, [first.id, second.id]);
  assert.equal(summary.reason, 'batch-limit');
  assert.deepEqual(writesOf(github), [
    ['POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses', first.id],
    ['DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', first.id],
    ['DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', second.id],
  ]);
});

const stopsWithoutWrites = async (reason, options) => {
  const github = fakeGithub(options);
  const summary = await reconcileVercelRecords({ github, authority: schedule });
  assert.equal(summary.failed, true);
  assert.equal(summary.reason, reason);
  assert.deepEqual(writesOf(github), []);
};

test('stops without writing when a record changed between inventory and delete', async () => {
  const records = days('Preview', 12);
  await stopsWithoutWrites('record-changed', {
    records,
    overrides: {
      'GET /repos/{owner}/{repo}/deployments/{deployment_id}': () => ({
        ...records[0],
        sha: sha(1),
      }),
    },
  });
});

test('stops when a candidate became an open PR head before its delete', async () => {
  const records = days('Preview', 12);
  let reads = 0;
  await stopsWithoutWrites('protection-changed', {
    records,
    overrides: {
      'GET /repos/{owner}/{repo}/pulls': () =>
        reads++ === 0 ? [] : [{ head: { sha: records[0].sha } }],
    },
  });
});

test('stops when main moves during the run, and refuses at the start when main already moved', async () => {
  let reads = 0;
  await stopsWithoutWrites('main-moved', {
    records: days('Production', 12),
    overrides: {
      'GET /repos/{owner}/{repo}/commits/{ref}': () => ({ sha: reads++ === 0 ? MAIN : sha(7) }),
    },
  });
  const github = fakeGithub({
    records: days('Production', 12),
    overrides: { 'GET /repos/{owner}/{repo}/commits/{ref}': () => ({ sha: sha(7) }) },
  });
  await assert.rejects(reconcileVercelRecords({ github, authority: schedule }), /main-moved/);
});

test('refuses incomplete open-PR data instead of dropping it from the protection set', async () => {
  const github = fakeGithub({
    records: days('Preview', 12),
    overrides: { 'GET /repos/{owner}/{repo}/pulls': () => [{ head: {} }] },
  });
  await assert.rejects(
    reconcileVercelRecords({ github, authority: schedule }),
    /pull-head-malformed/,
  );
  assert.deepEqual(writesOf(github), []);
});

test('never deletes without a recognized, proven inactive status', async () => {
  const unknownState = {
    'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': () => [{ state: 'weird' }],
  };
  await stopsWithoutWrites('status-unrecognized', {
    records: days('Production', 11),
    overrides: unknownState,
  });
  const github = fakeGithub({
    records: days('Production', 11),
    overrides: {
      'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses': () => ({
        state: 'success',
      }),
    },
  });
  const summary = await reconcileVercelRecords({ github, authority: schedule });
  assert.equal(summary.reason, 'inactive-status-unrecognized');
  assert.ok(!writesOf(github).some(([route]) => route.startsWith('DELETE ')));
  // The POST answers `inactive`, but a re-read still shows the old state: no DELETE.
  const unproven = fakeGithub({ records: days('Production', 11) });
  const result = await reconcileVercelRecords({ github: unproven, authority: schedule });
  assert.equal(result.reason, 'inactive-status-unproven');
  assert.ok(!writesOf(unproven).some(([route]) => route.startsWith('DELETE ')));
});

test('keeps the shared rate reserve: no write when the live allowance is low', async () => {
  const github = fakeGithub({ records: days('Production', 12), remaining: 105 });
  const summary = await reconcileVercelRecords({ github, authority: schedule });
  assert.equal(summary.failed, false);
  assert.equal(summary.reason, 'budget-limit');
  assert.deepEqual(writesOf(github), []);
});
