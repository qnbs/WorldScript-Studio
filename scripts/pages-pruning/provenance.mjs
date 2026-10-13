import { newestSuccess, proofKey, refuse } from './evidence.mjs';
import { READ_ATTEMPTS, read } from './github.mjs';
import {
  ACTIONS_BOT,
  actorKey,
  creatorLogin,
  isPagesStatus,
  jobIdentity,
  MAX_BATCH,
  owned,
  publicationOrder,
  REPOSITORY,
  ROOT,
} from './policy.mjs';

export const SLOT_DEPTH = 4;
export const EXAMINE_LIMIT = 20;
// A proof reads the run and the job, each at its full retry count.
const PROOF_COST = 2 * READ_ATTEMPTS;
// QNBS-v3: ci.yml publishes Pages from every non-pull_request event on main, and its only such triggers are push and workflow_dispatch; a test keeps this set bound to the workflow file.
export const PUBLISH_EVENTS = new Set(['push', 'workflow_dispatch']);
const UNKNOWN = 'unknown-publication';

function runFacts(run, record, identity) {
  return [
    run.id === identity.run,
    run.repository?.full_name === REPOSITORY,
    run.head_repository?.full_name === REPOSITORY,
    run.name === 'CI / CD',
    run.path === '.github/workflows/ci.yml',
    PUBLISH_EVENTS.has(run.event),
    run.head_branch === 'main',
    run.head_sha === record.sha,
    run.status === 'completed',
    run.conclusion === 'success',
  ];
}

function jobFacts(job, run, identity) {
  const deployed = job.steps?.some(
    (step) => step.name === 'Deploy to GitHub Pages' && step.conclusion === 'success',
  );
  return [
    job.id === identity.job,
    job.run_id === run.id,
    job.name === '🚀 Deploy to GitHub Pages',
    job.status === 'completed',
    job.conclusion === 'success',
    deployed === true,
  ];
}

// QNBS-v3: log_url is caller-written, so the record and its success status must both be authored by the principal that triggered the referenced run, matched by account id and login (a missing id never matches); a GITHUB_TOKEN writer is always github-actions[bot].
function actorFacts(record, success, run) {
  const actors = new Set([actorKey(run.actor), actorKey(run.triggering_actor)]);
  actors.delete(null);
  return [
    actors.size > 0,
    actors.has(actorKey(record.creator)),
    actors.has(actorKey(success.creator)),
    creatorLogin(record.creator) !== ACTIONS_BOT,
    creatorLogin(success.creator) !== ACTIONS_BOT,
  ];
}

// QNBS-v3: the proof covers the record shape the classifier requires, so a record it would call unknown ownership can neither occupy a publication slot nor be declared proven.
const shapeFacts = (record, success) => [owned(record), isPagesStatus(success)];

async function fetchEvidence(ctx, identity) {
  try {
    const { data: run } = await read(ctx, `${ROOT}/actions/runs/${identity.run}`);
    const { data: job } = await read(ctx, `${ROOT}/actions/jobs/${identity.job}`);
    return { run, job };
  } catch (error) {
    if (error.status === 404) refuse(UNKNOWN);
    throw error;
  }
}

export async function provePublication(ctx, record) {
  const success = newestSuccess(record);
  const identity = jobIdentity(success);
  if (!identity) refuse(UNKNOWN);
  const { run, job } = await fetchEvidence(ctx, identity);
  const facts = [
    ...shapeFacts(record, success),
    ...runFacts(run, record, identity),
    ...jobFacts(job, run, identity),
    ...actorFacts(record, success, run),
  ];
  if (!facts.every(Boolean)) refuse(UNKNOWN);
}

export async function ensureProven(ctx, record) {
  const key = proofKey(record);
  if (ctx.proven.get(record.id) === key) return;
  await provePublication(ctx, record);
  ctx.proven.set(record.id, key);
}

// QNBS-v3: at a write boundary the run and job are read again, so evidence that was deleted or became unreadable since classification protects the record instead of authorizing the write on a cached proof.
export async function reprove(ctx, record) {
  ctx.proven.delete(record.id);
  await ensureProven(ctx, record);
}

async function proves(ctx, record) {
  try {
    await ensureProven(ctx, record);
    return true;
  } catch (error) {
    if (error.reason === UNKNOWN) return false;
    throw error;
  }
}

// QNBS-v3: both publication slots are proven before any candidate is classified; an unproved newer status is protected and never consumes the rollback slot.
export async function proveSlots(ctx, records) {
  const ordered = publicationOrder(records)
    .slice(0, SLOT_DEPTH + 1)
    .map((entry) => entry.record);
  const [head, ...older] = ordered;
  if (!head || !(await proves(ctx, head))) refuse('unproved-current');
  const unproved = [];
  for (const record of older) {
    if (await proves(ctx, record)) {
      // QNBS-v3: only the order up to the rollback slot is authority; older records are candidates that later deletions may remove.
      const order = [head.id, ...unproved, record.id];
      return { current: head.id, rollback: record.id, unproved, order };
    }
    unproved.push(record.id);
  }
  return refuse('no-proven-rollback');
}

const hasRoomToProve = (ctx, floor) => ctx.used + floor + PROOF_COST <= ctx.limit;

// QNBS-v3: every examined candidate gets causal proof, so the manifest never reports an unexamined record as a candidate; an unprovable record is protected and does not count against EXAMINE_LIMIT, so permanently unprovable newest records cannot hide older provable ones, and the scan ends early only when the budget left would no longer fund one more proof plus the floor kept for the mutation phase.
export async function examineCandidates(ctx, candidates, slots, floor = 0) {
  const proven = [];
  let examined = 0;
  for (const record of candidates) {
    if (proven.length >= EXAMINE_LIMIT || !hasRoomToProve(ctx, floor)) break;
    examined += 1;
    if (await proves(ctx, record)) proven.push(record);
    else slots.unproved.push(record.id);
  }
  return {
    proven,
    batch: proven.slice(0, MAX_BATCH),
    unexamined: candidates.slice(examined),
  };
}
