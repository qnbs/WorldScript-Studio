import assert from 'node:assert/strict';
import test from 'node:test';
import {
  admission,
  planRecords,
  reconcileVercelRecords,
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

function fakeGithub({ records, openHeads = [], statuses = {}, changed = new Set() }) {
  const calls = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  return {
    calls,
    async request(route, params = {}) {
      calls.push([route, params.deployment_id ?? null]);
      if (route === 'GET /repos/{owner}/{repo}/deployments')
        return { data: params.page === 1 ? records : [] };
      if (route === 'GET /repos/{owner}/{repo}/pulls')
        return { data: params.page === 1 ? openHeads.map((s) => ({ head: { sha: s } })) : [] };
      if (route === 'GET /repos/{owner}/{repo}/commits/{ref}') return { data: { sha: MAIN } };
      if (route === 'GET /repos/{owner}/{repo}/deployments/{deployment_id}') {
        const r = byId.get(params.deployment_id);
        return { data: changed.has(r.id) ? { ...r, sha: sha(12345) } : r };
      }
      if (route === 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses')
        return { data: [{ state: statuses[params.deployment_id] ?? 'success' }] };
      if (route.startsWith('POST ') || route.startsWith('DELETE ')) return { data: null };
      throw new Error(`unexpected route ${route}`);
    },
  };
}

const schedule = {
  repository: 'qnbs/WorldScript-Studio',
  ref: 'refs/heads/main',
  eventName: 'schedule',
};

test('keeps the newest ten per environment and leaves other environments and creators alone', () => {
  const production = Array.from({ length: 14 }, (_, i) => record('Production', i + 1));
  const preview = Array.from({ length: 12 }, (_, i) => record('Preview', i + 1));
  const outOfScope = [
    record('github-pages', 1, { creator: 'qnbs' }),
    record('Production', 1, { creator: 'someone-else' }),
  ];
  const { kept, candidates } = planRecords({
    records: [...production, ...preview, ...outOfScope],
    mainSha: MAIN,
    openHeads: new Set(),
  });
  assert.equal(kept.length, 20);
  assert.deepEqual(
    candidates.map((r) => r.id),
    [...production.slice(0, 4), ...preview.slice(0, 2)]
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
      .map((r) => r.id),
  );
  for (const r of outOfScope) assert.ok(!candidates.includes(r) && !kept.includes(r));
});

test('protects the current main commit and the Preview records of open PR heads', () => {
  const old = record('Production', 1, { commit: MAIN });
  const openHead = sha(4242);
  const oldPreview = record('Preview', 1, { commit: openHead });
  const newer = [
    ...Array.from({ length: 10 }, (_, i) => record('Production', i + 5)),
    ...Array.from({ length: 10 }, (_, i) => record('Preview', i + 5)),
  ];
  const { candidates } = planRecords({
    records: [old, oldPreview, ...newer],
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

test('admits writes only for the scheduled run on main of this repository', () => {
  assert.deepEqual(admission(schedule), { writes: true });
  assert.deepEqual(admission({ ...schedule, eventName: 'workflow_dispatch' }), { writes: false });
  assert.throws(
    () => admission({ ...schedule, repository: 'fork/WorldScript-Studio' }),
    /repository-unexpected/,
  );
  assert.throws(() => admission({ ...schedule, ref: 'refs/heads/feature' }), /ref-unexpected/);
});

test('a dispatched run plans without any write', async () => {
  const records = Array.from({ length: 13 }, (_, i) => record('Production', i + 1));
  const github = fakeGithub({ records });
  const summary = await reconcileVercelRecords({
    github,
    authority: { ...schedule, eventName: 'workflow_dispatch' },
  });
  assert.equal(summary.candidates, 3);
  assert.deepEqual(summary.deleted, []);
  assert.ok(github.calls.every(([route]) => route.startsWith('GET ')));
});

test('the scheduled run inactivates only active records, then deletes, oldest first, within the batch limit', async () => {
  const records = Array.from({ length: 14 }, (_, i) => record('Production', i + 1));
  const [first, second] = records;
  const github = fakeGithub({ records, statuses: { [second.id]: 'inactive' } });
  const summary = await reconcileVercelRecords({ github, authority: schedule, maxDeletes: 2 });
  assert.deepEqual(summary.deleted, [first.id, second.id]);
  assert.equal(summary.reason, 'batch-limit');
  const writes = github.calls.filter(([route]) => !route.startsWith('GET '));
  assert.deepEqual(writes, [
    ['POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses', first.id],
    ['DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', first.id],
    ['DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', second.id],
  ]);
});

test('stops without writing when a record changed between inventory and delete', async () => {
  const records = Array.from({ length: 12 }, (_, i) => record('Preview', i + 1));
  const github = fakeGithub({ records, changed: new Set([records[0].id]) });
  const summary = await reconcileVercelRecords({ github, authority: schedule });
  assert.equal(summary.failed, true);
  assert.equal(summary.reason, 'record-changed');
  assert.deepEqual(summary.deleted, []);
  assert.ok(github.calls.every(([route]) => route.startsWith('GET ')));
});
