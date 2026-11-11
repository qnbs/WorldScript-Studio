#!/usr/bin/env node
// QNBS-v3 (#1223, #1219): read-only pre-tag gate. Push a v* tag only when the exact candidate commit has a successful no-push container build from docker-build-check.yml, which also checks DOMPurify inside the built image. The latest build-check run for that commit decides: missing, still running, skipped, cancelled or failed is a FAIL, never a PASS.
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const REPOSITORY = 'qnbs/WorldScript-Studio';
export const BUILD_CHECK_WORKFLOW = '.github/workflows/docker-build-check.yml';
export const BUILD_CHECK_JOB = '🐳 Container build check (no push)';

export const DEFAULT_BRANCH = 'main';
// QNBS-v3 (#1225 review): only push and dispatch runs on main count, because a pull_request run takes its workflow definition from the PR merge ref and could keep the job name while dropping the build.
export const TRUSTED_EVENTS = Object.freeze(['push', 'workflow_dispatch']);

const SHA = /^[0-9a-f]{40}$/;
const failure = (reason) => ({ ok: false, reason, runId: null, url: null });

// A rerun keeps created_at but starts a new attempt, so the newest attempt decides.
const attemptStart = (run) => Date.parse(run.run_started_at ?? run.created_at);
const newestFirst = (a, b) => attemptStart(b) - attemptStart(a);

// The runs API reports the bare workflow path; a `@refs/heads/main` suffix is accepted as the same workflow on main.
const workflowPathOf = (run) => String(run.path ?? '').replace(/@refs\/heads\/main$/, '');

const trustedRunChecks = (sha) => [
  (run) => run.head_sha === sha,
  (run) => workflowPathOf(run) === BUILD_CHECK_WORKFLOW,
  (run) => TRUSTED_EVENTS.includes(run.event),
  (run) => run.head_branch === DEFAULT_BRANCH,
];

/** The newest push or dispatch run of the build check on main for exactly this commit, or null. */
export function latestTrustedRun(sha, runs) {
  const checks = trustedRunChecks(sha);
  const matching = (runs ?? []).filter((run) => checks.every((check) => check(run)));
  return [...matching].sort(newestFirst)[0] ?? null;
}

function runProblem(run) {
  if (run.status !== 'completed') return `latest run ${run.id} is ${run.status}`;
  if (run.conclusion !== 'success') return `latest run ${run.id} concluded ${run.conclusion}`;
  return null;
}

function jobProblem(run, jobs) {
  const job = (jobs ?? []).find((entry) => entry.name === BUILD_CHECK_JOB);
  if (!job) return `latest run ${run.id} has no "${BUILD_CHECK_JOB}" job`;
  if (job.conclusion !== 'success') return `job "${BUILD_CHECK_JOB}" concluded ${job.conclusion}`;
  return null;
}

// QNBS-v3 (#1223 follow-up a): the newest run can decide only when every run of the commit was fetched, so a list beyond one page or without a count fails closed instead of crediting an older success.
function runListProblem(runs, totalCount) {
  if (!Array.isArray(runs)) return 'the run list is unreadable';
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) return 'the run list has no total_count';
  if (totalCount !== runs.length) {
    return `the run list is incomplete: ${runs.length} of ${totalCount} runs fetched`;
  }
  return null;
}

/**
 * @param {{sha: string, runs: object[] | null, totalCount: number | null, jobsByRun: Record<string, object[]> | null}} input
 *        runs: workflow runs of docker-build-check.yml; totalCount: the API's total_count for
 *        that list; jobsByRun: jobs keyed by run id
 */
export function classifyContainerPrecheck({ sha, runs, totalCount, jobsByRun }) {
  if (!SHA.test(String(sha ?? ''))) return failure('the candidate is not a 40-hex commit SHA');
  const incomplete = runListProblem(runs, totalCount);
  if (incomplete) return failure(incomplete);
  const run = latestTrustedRun(sha, runs);
  if (!run) {
    return failure(`no push or dispatch run of ${BUILD_CHECK_WORKFLOW} on main for ${sha}`);
  }
  const problem = runProblem(run) ?? jobProblem(run, jobsByRun?.[run.id]);
  if (problem) return failure(problem);
  return { ok: true, reason: 'PASS', runId: run.id, url: run.html_url ?? null };
}

// QNBS-v3 (#1219): at tag time the build check of the merge can still be queued or running; waiting for it (bounded) keeps a correctly sequenced tag from failing on timing alone, and the same classifier still decides.
/** True while there is no trusted run for the commit yet or its newest trusted run has not completed. */
export function isPending(sha, runs) {
  const run = latestTrustedRun(sha, runs);
  return run === null || run.status !== 'completed';
}

/** `[--wait-seconds N] <sha>`; waitSeconds is NaN when the value is not a non-negative integer. */
export function parseArgs(argv) {
  const args = [...(argv ?? [])];
  const flag = args.indexOf('--wait-seconds');
  if (flag < 0) return { sha: args[0], waitSeconds: 0 };
  // Digits only: Number('') is 0 and Number('1e3') is 1000, so neither may pass as a wait.
  const raw = String(args[flag + 1] ?? '');
  args.splice(flag, 2);
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return { sha: args[0], waitSeconds: Number.isSafeInteger(value) ? value : Number.NaN };
}

const POLL_SECONDS = 30;
const GH_TIMEOUT_MS = 60_000;

/** Seconds to sleep before the next poll: the poll interval, but never past the deadline. */
export function nextSleepSeconds(deadline, now) {
  return Math.max(0, Math.min(POLL_SECONDS, (deadline - now) / 1000));
}
const sleep = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));

function ghJson(path) {
  try {
    // A stalled request must not outlive the wait: it counts as unreadable and is retried until the deadline.
    return JSON.parse(
      execFileSync('gh', ['api', path], { encoding: 'utf8', timeout: GH_TIMEOUT_MS }),
    );
  } catch {
    return null;
  }
}

function readRuns(sha) {
  const listed = ghJson(
    `repos/${REPOSITORY}/actions/workflows/docker-build-check.yml/runs?head_sha=${sha}&per_page=100`,
  );
  return { runs: listed?.workflow_runs ?? null, totalCount: listed?.total_count ?? null };
}

function report(sha, result) {
  const where = result.url ? ` (${result.url})` : '';
  process.stdout.write(
    `container-precheck: ${result.ok ? 'PASS' : 'FAIL'} ${sha} — ${result.reason}${where}\n`,
  );
  process.exitCode = result.ok ? 0 : 1;
}

async function main(argv) {
  const { sha, waitSeconds } = parseArgs(argv);
  if (Number.isNaN(waitSeconds)) {
    report(sha, failure('--wait-seconds needs a non-negative integer'));
    return;
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let state = readRuns(sha);
  const keepWaiting = () =>
    SHA.test(String(sha ?? '')) && isPending(sha, state.runs) && Date.now() < deadline;
  while (keepWaiting()) {
    process.stdout.write(`container-precheck: waiting for the build check of ${sha}\n`);
    await sleep(nextSleepSeconds(deadline, Date.now()));
    state = readRuns(sha);
  }
  // Only the newest trusted run decides, so only its jobs are fetched.
  const latest = latestTrustedRun(sha, state.runs);
  const jobsByRun = latest
    ? {
        [latest.id]:
          ghJson(`repos/${REPOSITORY}/actions/runs/${latest.id}/jobs?per_page=100`)?.jobs ?? null,
      }
    : {};
  report(sha, classifyContainerPrecheck({ sha, ...state, jobsByRun }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
