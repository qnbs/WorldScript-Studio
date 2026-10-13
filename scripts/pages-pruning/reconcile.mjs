import {
  anyOf,
  fingerprint,
  latestStatus,
  listKey,
  refuse,
  timestamp,
  validId,
} from './evidence.mjs';
import {
  createContext,
  inventory,
  listRecords,
  loadStatuses,
  READ_ATTEMPTS,
  read,
  write,
} from './github.mjs';
import {
  admission,
  DESTRUCTIVE_WRITES_ADMITTED,
  planPruning,
  publicationOrder,
  ROOT,
  SITE,
} from './policy.mjs';
import { ensureProven, examineCandidates, proveSlots } from './provenance.mjs';

const RATE_RESERVE = 100;
const API_FAILURES = new Set([403, 404, 409, 429, 500, 502, 503, 504]);

// QNBS-v3: one candidate costs two full refreshes (list pages, three focused histories that may grow by a page, the main read), the POST and DELETE, and a worst-case re-proof of both slots and the candidate.
export function candidateCeiling(ctx) {
  const { list, status } = ctx.observed;
  return 2 * (list + 3 * (status + 1) + 1) + 2 + 6;
}

// QNBS-v3: reads may be retried, so everything after the inactive-status POST is reserved at READ_ATTEMPTS per read plus the DELETE, and the POST is only issued when that worst case still fits the budget.
export function finishCeiling(ctx) {
  const { list, status } = ctx.observed;
  const reads = list + 3 * (status + 1) + 1 + 6 + 3;
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
function report(run, records, prepared) {
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
      reasons: ['unexamined-batch-limit'],
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
  );
  return { plan: planPruning(records, holds, { slots }), slots, ...examined };
}

function reusableStatuses(before, item, focus) {
  if (!before || focus.has(item.id)) return null;
  return listKey(item) === listKey(before) ? before.statuses : null;
}

async function refresh(session, focusId) {
  const previous = new Map(session.records.map((record) => [record.id, record]));
  const focus = new Set([focusId, session.slots.current, session.slots.rollback]);
  const fresh = [];
  for (const item of await listRecords(session.ctx)) {
    const kept = reusableStatuses(previous.get(item.id), item, focus);
    fresh.push({ ...item, statuses: kept ?? (await loadStatuses(session.ctx, item)) });
  }
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
    await ensureProven(ctx, fresh.find((item) => item.id === id) ?? refuse('current-moved'));
  await ensureProven(ctx, record);
  await assertMainUnchanged(ctx);
  return record;
}

async function inactivate(ctx, record) {
  const { data } = await write(ctx, `POST ${ROOT}/deployments/${record.id}/statuses`, {
    state: 'inactive',
    environment: 'github-pages',
    environment_url: SITE,
    log_url: latestStatus(record).log_url,
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

// QNBS-v3: a failed or ambiguous inactivation never reaches DELETE, and writes are never retried against an assumed inventory.
async function retire(session, candidate) {
  const { ctx, run } = session;
  let fresh = await revalidate(session, candidate, fingerprint(candidate));
  if (!fresh) return skip(run, 'stale-candidate');
  const needsPost = latestStatus(fresh).state !== 'inactive';
  if (needsPost && ctx.used + finishCeiling(ctx) > ctx.limit) return 'budget';
  run.result.attempted += 1;
  if (needsPost) {
    fresh.statuses.push(await inactivate(ctx, fresh));
    run.result.inactivated += 1;
    fresh = await revalidate(session, candidate, fingerprint(fresh));
    if (!fresh) return skip(run, 'status-moved');
  }
  await write(ctx, `DELETE ${ROOT}/deployments/${candidate.id}`);
  run.result.deleted += 1;
  session.records = session.records.filter((record) => record.id !== candidate.id);
}

function affordable(ctx) {
  const ceiling = candidateCeiling(ctx);
  const room = ctx.used + ceiling <= ctx.limit;
  const rate = ctx.remaining === null || ctx.remaining >= RATE_RESERVE + ceiling;
  return room && rate;
}

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
    report(run, records, { plan: first, proven: [], unexamined: [] });
    refuse('unproved-current-or-unsettled');
  }
  const prepared = await prepare(ctx, holds, records, first);
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
