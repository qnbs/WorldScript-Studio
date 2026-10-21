// Bounded retention for the GitHub deployment records that Vercel for GitHub creates
// (environments `Production` and `Preview`, creator `vercel[bot]`). Vercel adds one record per
// deployment and has no setting to stop it. This keeps the newest records per environment, the
// record of the current `main` commit and every Preview record of an open PR head. `github-pages`
// and every other environment or creator are never candidates. Writes happen only on the
// scheduled run of the trusted workflow on the commit that is still `main`; a dispatched run plans.

export const REPOSITORY = 'qnbs/WorldScript-Studio';
export const WORKFLOW = `${REPOSITORY}/.github/workflows/prune-deployments.yml@refs/heads/main`;
// Three per environment (owner decision 2026-10-21, was ten): enough for a rollback view; open PR heads and `main` are kept on top.
export const KEEP_PER_ENVIRONMENT = 3;
export const MAX_DELETES_PER_RUN = 40;
export const ENVIRONMENTS = Object.freeze(['Production', 'Preview']);
export const CREATOR = 'vercel[bot]';
// The Pages step before this one stops at the same reserve; a candidate costs at most this many
// requests (record, main, open PRs, status, POST, status re-read, DELETE).
export const RATE_RESERVE = 100;
export const CANDIDATE_COST = 8;
const MAX_PAGES = 20;
const STATES = new Set([
  'error',
  'failure',
  'inactive',
  'in_progress',
  'queued',
  'pending',
  'success',
]);

export function refuse(reason) {
  throw Object.assign(new Error(reason), { reason });
}

const isSha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function validRecord(record) {
  return [
    Number.isSafeInteger(record?.id),
    isSha(record?.sha),
    !Number.isNaN(Date.parse(record?.created_at)),
    typeof record?.creator?.login === 'string',
  ].every(Boolean);
}

const inScope = (record, environment) =>
  record?.environment === environment && record?.creator?.login === CREATOR;

const newestFirst = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;
const oldestFirst = (a, b) => newestFirst(b, a);

function isProtected(record, index, protection, keep) {
  if (index < keep || record.sha === protection.mainSha) return true;
  return record.environment === 'Preview' && protection.openHeads.has(record.sha);
}

// Pure classification. A malformed record anywhere in scope refuses the whole plan.
export function planRecords({ records, mainSha, openHeads, keep = KEEP_PER_ENVIRONMENT }) {
  if (!isSha(mainSha)) refuse('main-sha-invalid');
  const protection = { mainSha, openHeads };
  const kept = [];
  const candidates = [];
  for (const environment of ENVIRONMENTS) {
    const scoped = records.filter((record) => inScope(record, environment));
    if (!scoped.every(validRecord)) refuse('record-malformed');
    scoped.sort(newestFirst).forEach((record, index) => {
      (isProtected(record, index, protection, keep) ? kept : candidates).push(record);
    });
  }
  return { kept, candidates: candidates.sort(oldestFirst) };
}

export function admission({ repository, ref, eventName, sha, workflowRef }) {
  const checks = [
    [repository === REPOSITORY, 'repository-unexpected'],
    [ref === 'refs/heads/main', 'ref-unexpected'],
    [workflowRef === WORKFLOW, 'workflow-unexpected'],
    [isSha(sha), 'sha-invalid'],
  ];
  for (const [ok, reason] of checks) if (!ok) refuse(reason);
  return { writes: eventName === 'schedule' };
}

// Every request reports the live allowance; a response without it cannot fund a write.
async function call(ctx, route, params = {}) {
  const response = await ctx.github.request(route, { ...ctx.base, ...params });
  const remaining = Number(response?.headers?.['x-ratelimit-remaining']);
  ctx.remaining = Number.isFinite(remaining) ? remaining : null;
  return response?.data;
}

async function readAll(ctx, route, params = {}) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await call(ctx, route, { ...params, per_page: 100, page });
    if (!Array.isArray(data)) refuse('inventory-malformed');
    all.push(...data);
    if (data.length < 100) return all;
  }
  return refuse('inventory-too-large');
}

// The protection inputs: the live `main` commit and every open PR head, all validated.
export async function readProtection(ctx) {
  const head = await call(ctx, 'GET /repos/{owner}/{repo}/commits/{ref}', { ref: 'main' });
  if (!isSha(head?.sha)) refuse('main-sha-invalid');
  const pulls = await readAll(ctx, 'GET /repos/{owner}/{repo}/pulls', { state: 'open' });
  const heads = pulls.map((pull) => pull?.head?.sha);
  if (!heads.every(isSha)) refuse('pull-head-malformed');
  return { mainSha: head.sha, openHeads: new Set(heads) };
}

function assertBound(protection, authority) {
  if (protection.mainSha !== authority.sha) refuse('main-moved');
}

function assertStillCandidate(record, protection) {
  if (isProtected(record, Number.POSITIVE_INFINITY, protection, 0)) refuse('protection-changed');
}

async function readState(ctx, id) {
  const statuses = await call(
    ctx,
    'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
    {
      deployment_id: id,
      per_page: 1,
    },
  );
  if (!Array.isArray(statuses)) refuse('status-malformed');
  if (statuses.length === 0) return 'none';
  if (!STATES.has(statuses[0]?.state)) refuse('status-unrecognized');
  return statuses[0].state;
}

async function ensureInactive(ctx, id) {
  if ((await readState(ctx, id)) === 'inactive') return;
  const created = await call(
    ctx,
    'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses',
    {
      deployment_id: id,
      state: 'inactive',
    },
  );
  if (created?.state !== 'inactive') refuse('inactive-status-unrecognized');
  if ((await readState(ctx, id)) !== 'inactive') refuse('inactive-status-unproven');
}

async function assertSameRecord(ctx, record) {
  const current = await call(ctx, 'GET /repos/{owner}/{repo}/deployments/{deployment_id}', {
    deployment_id: record.id,
  });
  const same = [
    current?.environment === record.environment,
    current?.sha === record.sha,
    current?.creator?.login === CREATOR,
  ].every(Boolean);
  if (!same) refuse('record-changed');
}

// One candidate: identity, fresh protection and a proven inactive status before the DELETE.
async function retire(ctx, record) {
  await assertSameRecord(ctx, record);
  const protection = await readProtection(ctx);
  assertBound(protection, ctx.authority);
  assertStillCandidate(record, protection);
  await ensureInactive(ctx, record.id);
  await call(ctx, 'DELETE /repos/{owner}/{repo}/deployments/{deployment_id}', {
    deployment_id: record.id,
  });
}

const funded = (ctx) => ctx.remaining !== null && ctx.remaining >= RATE_RESERVE + CANDIDATE_COST;

async function retireBatch(ctx, candidates, summary) {
  for (const record of candidates.slice(0, ctx.maxDeletes)) {
    if (!funded(ctx)) return 'budget-limit';
    try {
      await retire(ctx, record);
      summary.deleted.push(record.id);
    } catch (error) {
      summary.failed = true;
      return error?.reason ?? 'request-failed';
    }
  }
  return candidates.length > ctx.maxDeletes ? 'batch-limit' : null;
}

export async function reconcileVercelRecords({
  github,
  authority,
  maxDeletes = MAX_DELETES_PER_RUN,
}) {
  const { writes } = admission(authority);
  const [owner, repo] = REPOSITORY.split('/');
  const ctx = { github, base: { owner, repo }, remaining: null, authority, maxDeletes };
  const records = await readAll(ctx, 'GET /repos/{owner}/{repo}/deployments');
  const protection = await readProtection(ctx);
  if (writes) assertBound(protection, authority);
  const { kept, candidates } = planRecords({ records, ...protection });
  const summary = {
    writes,
    inventory: records.length,
    kept: kept.length,
    candidates: candidates.length,
    deleted: [],
    failed: false,
    reason: null,
  };
  if (writes) summary.reason = await retireBatch(ctx, candidates, summary);
  return summary;
}

export async function runAction({
  github,
  context,
  core,
  workflowRef,
  reconcile = reconcileVercelRecords,
}) {
  const summary = await reconcile({
    github,
    authority: {
      repository: `${context.repo.owner}/${context.repo.repo}`,
      ref: context.ref,
      eventName: context.eventName,
      sha: context.sha,
      workflowRef,
    },
  });
  core.info(JSON.stringify(summary));
  await core.summary
    .addHeading('Vercel GitHub deployment record retention')
    .addCodeBlock(JSON.stringify(summary, null, 2), 'json')
    .write();
  if (summary.failed) core.setFailed(`Vercel record retention stopped: ${summary.reason}`);
}
