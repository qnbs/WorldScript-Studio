import {
  anyOf,
  fingerprint,
  latestStatus,
  listKey,
  newestSuccess,
  refuse,
  timestamp,
  validId,
} from './evidence.mjs';
import {
  createContext,
  funds,
  inventory,
  listRecords,
  loadStatuses,
  READ_ATTEMPTS,
  read,
  write,
} from './github.mjs';
import {
  actorKey,
  admission,
  DESTRUCTIVE_WRITES_ADMITTED,
  isPagesStatus,
  planPruning,
  publicationOrder,
  ROOT,
  SITE,
} from './policy.mjs';
import { examineCandidates, proveSlots, reprove } from './provenance.mjs';

const API_FAILURES = new Set([403, 404, 409, 429, 500, 502, 503, 504]);

// QNBS-v3: a refresh reloads the three focused histories and at most EXTRA_RELOADS others whose list key changed, so its cost has a ceiling; more churn than that stops the run.
const FOCUSED_RELOADS = 3;
export const EXTRA_RELOADS = 3;
const RELOADS = FOCUSED_RELOADS + EXTRA_RELOADS;

// Re-reading the run and the job of the candidate and of both slots at one write boundary.
const REPROOF = 6;
const DELETE_COST = 1;

// QNBS-v3: one candidate costs two full refreshes (list pages, every reloadable history that may grow by a page, the main read, the re-proof of both slots and the candidate) and the POST and DELETE.
export function candidateCeiling(ctx) {
  const { list, status } = ctx.observed;
  return 2 * (list + RELOADS * (status + 1) + 1 + REPROOF) + 2;
}

// QNBS-v3: reads may be retried, so everything after the inactive-status POST is reserved at READ_ATTEMPTS per read plus the DELETE, and the POST is only issued when that worst case still fits the budget.
export function finishCeiling(ctx) {
  const { list, status } = ctx.observed;
  const reads = list + RELOADS * (status + 1) + 1 + REPROOF + 3;
  return READ_ATTEMPTS * reads + 1;
}

function newRun(authority, mode) {
  const result = {
    trigger: authority.eventName,
    mode,
    queried: 0,
    classified: 0,
    protected: 0,
    candidate: 0,
    attempted: 0,
    inactivated: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    requests: 0,
    reasons: {},
    current: null,
    rollback: null,
    manifest: [],
    followUpRequired: false,
  };
  const reason = (key, count = 1) => {
    result.reasons[key] = (result.reasons[key] ?? 0) + count;
  };
  return { result, reason, considered: 0, batch: [], finalized: false };
}

function resolveMode(admitted, dryRun, destructive) {
  if (admitted === 'refused') return 'refused';
  return anyOf(dryRun, admitted !== 'delete', !destructive) ? 'dry-run' : 'delete';
}

// QNBS-v3: only records that received causal proof are reported as candidates; structurally eligible but unexamined records are listed separately and never counted as safe.
function report(run, records, prepared, why = 'unexamined-batch-limit') {
  const { plan, proven, unexamined } = prepared;
  const { result } = run;
  result.classified = records.length;
  result.protected = plan.protectedRecords.length;
  result.candidate = proven.length;
  result.current = plan.current;
  result.rollback = plan.rollback;
  result.manifest = [
    ...plan.protectedRecords.map((entry) => ({ ...entry, disposition: 'protected' })),
    ...unexamined.map((entry) => ({
      id: entry.id,
      disposition: 'unexamined',
      reasons: [why],
    })),
    ...proven.map((entry) => ({ id: entry.id, disposition: 'candidate', reasons: [] })),
  ];
  for (const entry of plan.protectedRecords) for (const key of entry.reasons) run.reason(key);
  if (unexamined.length) run.reason('unexamined', unexamined.length);
}

function finishDryRun(run, records) {
  run.result.skipped = run.result.candidate;
  if (run.result.skipped) run.reason('dry-run', run.result.skipped);
  run.result.followUpRequired = records.length > 3;
  run.finalized = true;
}

async function prepare(ctx, holds, records, first) {
  const none = { plan: first, slots: null, batch: [], proven: [], unexamined: [] };
  if (first.candidates.length === 0) return none;
  const slots = await proveSlots(ctx, records);
  const examined = await examineCandidates(
    ctx,
    planPruning(records, holds, { slots }).candidates,
    slots,
    candidateCeiling(ctx),
  );
  return { plan: planPruning(records, holds, { slots }), slots, ...examined };
}

// QNBS-v3: a run that stops before every eligible record is proven still lists them, as unexamined, so the manifest never silently drops records the counts include.
function reportUnexamined(run, records, first) {
  report(
    run,
    records,
    { plan: first, proven: [], unexamined: first.candidates },
    'blocked-before-proof',
  );
}

async function prepareOrReport(ctx, run, holds, records, first) {
  try {
    return await prepare(ctx, holds, records, first);
  } catch (error) {
    reportUnexamined(run, records, first);
    throw error;
  }
}

function reusableStatuses(before, item, focus) {
  if (!before || focus.has(item.id)) return null;
  return listKey(item) === listKey(before) ? before.statuses : null;
}

// QNBS-v3: the list is read first and the number of unfocused records whose history must be reloaded is checked against EXTRA_RELOADS before any history is read, so a moving inventory stops the run inside the reads the ceilings reserved.
async function refresh(session, focusId) {
  const previous = new Map(session.records.map((record) => [record.id, record]));
  const focus = new Set([focusId, session.slots.current, session.slots.rollback]);
  const items = await listRecords(session.ctx);
  const kept = items.map((item) => reusableStatuses(previous.get(item.id), item, focus));
  const churned = items.filter((item, index) => kept[index] === null && !focus.has(item.id));
  if (churned.length > EXTRA_RELOADS) refuse('inventory-churn');
  const fresh = [];
  for (const [index, item] of items.entries())
    fresh.push({ ...item, statuses: kept[index] ?? (await loadStatuses(session.ctx, item)) });
  return fresh;
}

function assertStable(session, fresh, next) {
  const order = publicationOrder(fresh)
    .slice(0, session.slots.order.length)
    .map((entry) => entry.record.id);
  if (next.blocked || order.join() !== session.slots.order.join()) refuse('current-moved');
}

async function assertMainUnchanged(ctx) {
  const { data } = await read(ctx, `${ROOT}/branches/main`);
  if (data.commit?.sha !== ctx.authority.sha) refuse('main-moved');
}

// QNBS-v3: holds are immutable at the executing main SHA; every write re-reads the list plus the candidate and both publication slots, and unchanged other records are trusted only while their list key is identical.
async function revalidate(session, candidate, expected) {
  const { ctx, holds, slots } = session;
  const fresh = await refresh(session, candidate.id);
  const next = planPruning(fresh, holds, { slots });
  assertStable(session, fresh, next);
  session.records = fresh;
  const record = fresh.find((item) => item.id === candidate.id);
  const candidateStillEligible = next.candidates.some((item) => item.id === candidate.id);
  if (!record || !candidateStillEligible) return null;
  if (fingerprint(record) !== expected) return null;
  for (const id of [slots.current, slots.rollback])
    await reprove(ctx, fresh.find((item) => item.id === id) ?? refuse('current-moved'));
  await reprove(ctx, record);
  await assertMainUnchanged(ctx);
  return record;
}

async function inactivate(ctx, record) {
  const { data } = await write(ctx, `POST ${ROOT}/deployments/${record.id}/statuses`, {
    state: 'inactive',
    environment: 'github-pages',
    environment_url: SITE,
    log_url: newestSuccess(record).log_url,
    auto_inactive: false,
  });
  if (anyOf(!validId(data.id), data.state !== 'inactive', !timestamp(data.created_at)))
    refuse('invalid-inactivation-response');
  return data;
}

function skip(run, reason) {
  run.result.skipped += 1;
  run.reason(reason);
}

// QNBS-v3: the POST is skipped only for an inactive Pages status with an identified author; any other latest status, including an inactive one of unknown origin, gets this run's own inactive status before the DELETE, so deletion authority never rests on unvalidated status metadata.
const isSettledInactive = (status) =>
  [status?.state === 'inactive', isPagesStatus(status), actorKey(status?.creator) !== null].every(
    Boolean,
  );

// QNBS-v3: the status this run just created must come back from the API as a recognised inactive Pages status before the DELETE, so malformed or incompatible status data keeps the record.
async function settle(session, candidate, fresh) {
  const { ctx, run } = session;
  fresh.statuses.push(await inactivate(ctx, fresh));
  run.result.inactivated += 1;
  const next = await revalidate(session, candidate, fingerprint(fresh));
  if (!next) return { skip: 'status-moved' };
  return isSettledInactive(latestStatus(next)) ? {} : { skip: 'inactive-status-unrecognized' };
}

// QNBS-v3: a failed or ambiguous inactivation never reaches DELETE, and writes are never retried against an assumed inventory.
async function retire(session, candidate) {
  const { ctx, run } = session;
  const fresh = await revalidate(session, candidate, fingerprint(candidate));
  if (!fresh) return skip(run, 'stale-candidate');
  const needsPost = !isSettledInactive(latestStatus(fresh));
  if (!funds(ctx, needsPost ? finishCeiling(ctx) : DELETE_COST)) return 'budget';
  run.result.attempted += 1;
  if (needsPost) {
    const settled = await settle(session, candidate, fresh);
    if (settled.skip) return skip(run, settled.skip);
  }
  await write(ctx, `DELETE ${ROOT}/deployments/${candidate.id}`);
  run.result.deleted += 1;
  session.records = session.records.filter((record) => record.id !== candidate.id);
}

const affordable = (ctx) => funds(ctx, candidateCeiling(ctx));

async function mutate(session) {
  const { ctx, run } = session;
  for (const candidate of run.batch) {
    if (!affordable(ctx)) {
      run.reason('budget-limit', run.batch.length - run.considered);
      return;
    }
    run.considered += 1;
    if ((await retire(session, candidate)) === 'budget') {
      run.considered -= 1;
      run.reason('budget-limit', run.batch.length - run.considered);
      return;
    }
  }
}

async function execute(ctx, run, holds) {
  if (run.result.mode === 'refused') refuse('untrusted-trigger');
  const records = await inventory(ctx);
  run.result.queried = records.length;
  const first = planPruning(records, holds);
  if (first.blocked) {
    reportUnexamined(run, records, first);
    refuse('unproved-current-or-unsettled');
  }
  const prepared = await prepareOrReport(ctx, run, holds, records, first);
  run.batch = prepared.batch;
  report(run, records, prepared);
  if (run.result.mode !== 'delete') return finishDryRun(run, records);
  await mutate({ ctx, run, holds, records, slots: prepared.slots });
  run.result.followUpRequired = records.length - run.result.deleted > 3;
  const backlog = prepared.proven.length - prepared.batch.length;
  if (backlog > 0) run.reason('batch-limit', backlog);
}

function failureReason(error) {
  if (error.reason) return error.reason;
  return API_FAILURES.has(error.status) ? `api-${error.status}` : 'api-or-inventory-error';
}

export async function reconcilePages({
  github,
  authority,
  holds,
  dryRun = false,
  destructive = DESTRUCTIVE_WRITES_ADMITTED,
  pause,
  limit,
}) {
  const admitted = admission(authority);
  const run = newRun(authority, resolveMode(admitted, dryRun, destructive));
  const gateClosed = [admitted === 'delete', !dryRun, !destructive].every(Boolean);
  if (gateClosed) run.reason('destructive-gate-closed');
  const ctx = createContext({ github, authority, pause, limit });
  try {
    await execute(ctx, run, holds);
  } catch (error) {
    run.result.failed += 1;
    run.result.followUpRequired = true;
    run.reason(failureReason(error));
    if (run.result.candidate > run.considered)
      run.reason('aborted-batch', run.result.candidate - run.considered);
  }
  if (!run.finalized) run.result.skipped += run.result.candidate - run.considered;
  run.result.requests = ctx.used;
  return run.result;
}
