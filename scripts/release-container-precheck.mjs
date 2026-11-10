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

const newestFirst = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at);

const trustedRunChecks = (sha) => [
  (run) => run.head_sha === sha,
  (run) => run.path === BUILD_CHECK_WORKFLOW,
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

/**
 * @param {{sha: string, runs: object[] | null, jobsByRun: Record<string, object[]> | null}} input
 *        runs: workflow runs of docker-build-check.yml; jobsByRun: jobs keyed by run id
 */
export function classifyContainerPrecheck({ sha, runs, jobsByRun }) {
  if (!SHA.test(String(sha ?? ''))) return failure('the candidate is not a 40-hex commit SHA');
  const run = latestTrustedRun(sha, runs);
  if (!run) {
    return failure(`no push or dispatch run of ${BUILD_CHECK_WORKFLOW} on main for ${sha}`);
  }
  const problem = runProblem(run) ?? jobProblem(run, jobsByRun?.[run.id]);
  if (problem) return failure(problem);
  return { ok: true, reason: 'PASS', runId: run.id, url: run.html_url ?? null };
}

function ghJson(path) {
  try {
    return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
  } catch {
    return null;
  }
}

function main(sha) {
  const listed = ghJson(
    `repos/${REPOSITORY}/actions/workflows/docker-build-check.yml/runs?head_sha=${sha}&per_page=100`,
  );
  const runs = listed?.workflow_runs ?? null;
  // Only the newest trusted run decides, so only its jobs are fetched.
  const latest = latestTrustedRun(sha, runs);
  const jobsByRun = latest
    ? {
        [latest.id]:
          ghJson(`repos/${REPOSITORY}/actions/runs/${latest.id}/jobs?per_page=100`)?.jobs ?? null,
      }
    : {};
  const result = classifyContainerPrecheck({ sha, runs, jobsByRun });
  const where = result.url ? ` (${result.url})` : '';
  process.stdout.write(
    `container-precheck: ${result.ok ? 'PASS' : 'FAIL'} ${sha} — ${result.reason}${where}\n`,
  );
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
