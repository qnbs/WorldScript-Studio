import {
  anyOf,
  fingerprint,
  latestStatus,
  listKey,
  refuse,
  timestamp,
  validId,
} from './evidence.mjs';
import { createContext, inventory, listRecords, loadStatuses, read, write } from './github.mjs';
import {
  admission,
  DESTRUCTIVE_WRITES_ADMITTED,
  MAX_BATCH,
  planPruning,
  publicationOrder,
  ROOT,
  SITE,
} from './policy.mjs';
import { ensureProven, proveSlots, selectBatch } from './provenance.mjs';

const CANDIDATE_CEILING = 40;
const RATE_RESERVE = 100;
const API_FAILURES = new Set([403, 404, 409, 429, 500, 502, 503, 504]);

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

function report(run, records, plan) {
  const { result } = run;
  result.classified = records.length;
  result.protected = plan.protectedRecords.length;
  result.candidate = plan.candidates.length;
  result.current = plan.current;
  result.rollback = plan.rollback;
  result.manifest = [
    ...plan.protectedRecords.map((entry) => ({ ...entry, disposition: 'protected' })),
    ...plan.candidates.map((entry) => ({ id: entry.id, disposition: 'candidate', reasons: [] })),
  ];
  for (const entry of plan.protectedRecords) for (const key of entry.reasons) run.reason(key);
}

function finishDryRun(run, plan, records) {
  run.result.skipped = plan.candidates.length;
  if (run.result.skipped) run.reason('dry-run', run.result.skipped);
  run.result.followUpRequired = records.length > 3;
  run.finalized = true;
}

async function prepare(ctx, holds, records, first) {
  if (first.candidates.length === 0) return { plan: first, slots: null, batch: [] };
  const slots = await proveSlots(ctx, records);
  const batch = await selectBatch(ctx, planPruning(records, holds, { slots }).candidates, slots);
  return { plan: planPruning(records, holds, { slots }), slots, batch };
}

function reusableStatuses(before, item, focus) {
  if (!before || focus.has(item.id)) return null;
  return listKey(item) === listKey(before) ? before.statuses : null;
}

async function refresh(ctx, state, focusId) {
  const previous = new Map(state.records.map((record) => [record.id, record]));
  const focus = new Set([focusId, state.slots.current, state.slots.rollback]);
  const fresh = [];
  for (const item of await listRecords(ctx)) {
    const kept = reusableStatuses(previous.get(item.id), item, focus);
    fresh.push({ ...item, statuses: kept ?? (await loadStatuses(ctx, item)) });
  }
  return fresh;
}

function assertStable(state, fresh, next) {
  const order = publicationOrder(fresh)
    .slice(0, state.slots.order.length)
    .map((entry) => entry.record.id);
  if (next.blocked || order.join() !== state.slots.order.join()) refuse('current-moved');
}

async function assertMainUnchanged(ctx) {
  const { data } = await read(ctx, `${ROOT}/branches/main`);
  if (data.commit?.sha !== ctx.authority.sha) refuse('main-moved');
}

// QNBS-v3: holds are immutable at the executing main SHA; every write re-reads the list plus the candidate and both publication slots, and unchanged other records are trusted only while their list key is identical.
async function revalidate(ctx, holds, state, candidate, expected) {
  const fresh = await refresh(ctx, state, candidate.id);
  const next = planPruning(fresh, holds, { slots: state.slots });
  assertStable(state, fresh, next);
  state.records = fresh;
  const record = fresh.find((item) => item.id === candidate.id);
  const candidateStillEligible = next.candidates.some((item) => item.id === candidate.id);
  if (!record || !candidateStillEligible) return null;
  if (fingerprint(record) !== expected) return null;
  for (const id of [state.slots.current, state.slots.rollback])
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
async function retire(ctx, run, holds, state, candidate) {
  let fresh = await revalidate(ctx, holds, state, candidate, fingerprint(candidate));
  if (!fresh) return skip(run, 'stale-candidate');
  run.result.attempted += 1;
  if (latestStatus(fresh).state !== 'inactive') {
    fresh.statuses.push(await inactivate(ctx, fresh));
    run.result.inactivated += 1;
    fresh = await revalidate(ctx, holds, state, candidate, fingerprint(fresh));
    if (!fresh) return skip(run, 'status-moved');
  }
  await write(ctx, `DELETE ${ROOT}/deployments/${candidate.id}`);
  run.result.deleted += 1;
  state.records = state.records.filter((record) => record.id !== candidate.id);
}

function affordable(ctx) {
  const room = ctx.used + CANDIDATE_CEILING <= ctx.limit;
  const rate = ctx.remaining === null || ctx.remaining >= RATE_RESERVE + CANDIDATE_CEILING;
  return room && rate;
}

async function mutate(ctx, run, holds, state) {
  for (const candidate of run.batch) {
    if (!affordable(ctx)) {
      run.reason('budget-limit', run.batch.length - run.considered);
      return;
    }
    run.considered += 1;
    await retire(ctx, run, holds, state, candidate);
  }
}

async function execute(ctx, run, holds) {
  if (run.result.mode === 'refused') refuse('untrusted-trigger');
  const records = await inventory(ctx);
  run.result.queried = records.length;
  const first = planPruning(records, holds);
  if (first.blocked) {
    report(run, records, first);
    refuse('unproved-current-or-unsettled');
  }
  const { plan, slots, batch } = await prepare(ctx, holds, records, first);
  run.batch = batch;
  report(run, records, plan);
  if (run.result.mode !== 'delete') return finishDryRun(run, plan, records);
  await mutate(ctx, run, holds, { records, slots });
  run.result.followUpRequired = records.length - run.result.deleted > 3;
  if (plan.candidates.length > MAX_BATCH)
    run.reason('batch-limit', plan.candidates.length - MAX_BATCH);
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
