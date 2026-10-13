import { newestSuccess, proofKey, refuse } from './evidence.mjs';
import { read } from './github.mjs';
import {
  ACTIONS_BOT,
  creatorLogin,
  jobIdentity,
  MAX_BATCH,
  publicationOrder,
  REPOSITORY,
  ROOT,
} from './policy.mjs';

export const SLOT_DEPTH = 4;
export const EXAMINE_LIMIT = 20;
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

// QNBS-v3: log_url is caller-written, so the record and its success status must both be authored by the principal that triggered the referenced run; a GITHUB_TOKEN writer is always github-actions[bot].
function actorFacts(record, success, run) {
  const actors = new Set([creatorLogin(run.actor), creatorLogin(run.triggering_actor)]);
  actors.delete(null);
  const deployer = creatorLogin(record.creator);
  const publisher = creatorLogin(success.creator);
  return [
    actors.size > 0,
    actors.has(deployer),
    actors.has(publisher),
    deployer !== ACTIONS_BOT,
    publisher !== ACTIONS_BOT,
  ];
}

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

// QNBS-v3: every examined candidate gets causal proof, so the manifest never reports an unexamined record as a candidate; the remainder is explicitly unexamined, and an unprovable record is protected instead of stalling the batch.
export async function examineCandidates(ctx, candidates, slots) {
  const proven = [];
  for (const record of candidates.slice(0, EXAMINE_LIMIT)) {
    if (await proves(ctx, record)) proven.push(record);
    else slots.unproved.push(record.id);
  }
  return {
    proven,
    batch: proven.slice(0, MAX_BATCH),
    unexamined: candidates.slice(EXAMINE_LIMIT),
  };
}
