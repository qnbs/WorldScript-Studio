#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyReleaseTagBoundary,
  getLatestReleasedVersion,
  getMergeAdmissionCommitRecords,
  getTaggedVersions,
  scanMergeAdmissionTruth,
  scanReleaseTruth,
} from './check-doc-metrics.mjs';

const root = process.env.WORLDSCRIPT_REPOSITORY_ROOT
  ? resolve(process.env.WORLDSCRIPT_REPOSITORY_ROOT)
  : join(fileURLToPath(new URL('.', import.meta.url)), '..');

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// QNBS-v3: fail closed unless the checked-out GitHub merge ref is exactly the event's current base/head merge tree; a stale or detached checkout must never masquerade as merge proof.
export function validateMergeRef({
  currentHead,
  firstParent,
  secondParent,
  baseSha,
  headSha,
  computedTree,
  actualTree,
  githubSha = currentHead,
}) {
  const findings = [];
  if (currentHead !== githubSha) {
    findings.push(
      `merge admission — checkout ${currentHead} does not match GITHUB_SHA ${githubSha}`,
    );
  }
  if (firstParent !== baseSha || secondParent !== headSha) {
    findings.push(
      `merge admission — checkout parents ${firstParent}, ${secondParent} do not match event base/head ${baseSha}, ${headSha}`,
    );
  }
  if (computedTree !== actualTree) {
    findings.push(
      `merge admission — checked-out tree ${actualTree} differs from git merge-tree result ${computedTree}`,
    );
  }
  return findings;
}

// QNBS-v3: admission is valid only for the current base; strict branch protection supports but does not implement this invariant.
export function validateCurrentBase({ eventBaseSha, currentMainSha }) {
  const findings = [];
  if (!eventBaseSha) {
    findings.push('merge admission — pull-request base SHA is unavailable');
  }
  if (!currentMainSha) {
    findings.push('merge admission — current origin/main SHA is unavailable');
  } else if (eventBaseSha !== currentMainSha) {
    findings.push(
      `merge admission — event base ${eventBaseSha} is stale; current origin/main is ${currentMainSha}`,
    );
  }
  return findings;
}

// QNBS-v3: the cheap required PR CHANGELOG guard owns admission so title edits never re-trigger ci.yml.
const ADMISSION_WORKFLOW_PATH = '.github/workflows/pr-changelog-reference.yml';

const CANONICAL_ADMISSION_RUN = [
  'set -euo pipefail',
  'git fetch --no-tags origin "refs/heads/main:refs/remotes/origin/main"',
  'mkdir -p /tmp/base-scripts',
  'if git show "$BASE_SHA:scripts/check-merge-admission.mjs" > /tmp/base-scripts/check-merge-admission.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/check-doc-metrics.mjs" > /tmp/base-scripts/check-doc-metrics.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/i18n-locales.mjs" > /tmp/base-scripts/i18n-locales.mjs 2>/dev/null \\',
  '&& git show "$BASE_SHA:scripts/test-metrics.mjs" > /tmp/base-scripts/test-metrics.mjs 2>/dev/null; then',
  'CHECKER=/tmp/base-scripts/check-merge-admission.mjs',
  'WORLDSCRIPT_REPOSITORY_ROOT="$GITHUB_WORKSPACE" node "$CHECKER"',
  'else',
  'if [ "$PR_NUMBER" = "857" ]; then',
  'echo "::notice::merge-admission evaluator is absent on the base ref; using the bounded PR #857 bootstrap once."',
  'test "$(sha256sum scripts/check-merge-admission.mjs | awk \'{print $1}\')" = "<sha256>"',
  'test "$(sha256sum scripts/check-doc-metrics.mjs | awk \'{print $1}\')" = "<sha256>"',
  'test "$(sha256sum scripts/i18n-locales.mjs | awk \'{print $1}\')" = "<sha256>"',
  'test "$(sha256sum scripts/test-metrics.mjs | awk \'{print $1}\')" = "<sha256>"',
  'node scripts/check-merge-admission.mjs',
  'else',
  'echo "::error::trusted merge-admission evaluator is absent outside the introducing transition"',
  'exit 1',
  'fi',
  'fi',
];

function extractAdmissionRun(workflowText) {
  const stepStart = workflowText.indexOf('      - name: Main-context merge admission proof');
  if (stepStart < 0) return null;
  const nextStep = workflowText.indexOf('\n      - ', stepStart + 1);
  const step = workflowText.slice(stepStart, nextStep < 0 ? workflowText.length : nextStep);
  const runStart = step.indexOf('\n        run: |\n');
  if (runStart < 0) return null;
  return step
    .slice(runStart + '\n        run: |\n'.length)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeAdmissionDigestLines(lines) {
  return lines.map((line) =>
    line.replace(
      /^(test "\$\(sha256sum scripts\/(?:check-merge-admission|check-doc-metrics|i18n-locales|test-metrics)\.mjs \| awk '\{print \$1\}'\)" = )"[0-9a-f]{64}"$/,
      '$1"<sha256>"',
    ),
  );
}

// QNBS-v3: trusted-base loading prevents PR-controlled early exits and bootstrap-path widening.
export function validateAdmissionWorkflow(workflowText) {
  const findings = [];
  if (!workflowText.includes('types: [opened, edited, synchronize, reopened]')) {
    findings.push('merge admission — the guard must rerun for title edits and source changes');
  }
  if (!workflowText.includes('PR_NUMBER: $' + '{{ github.event.pull_request.number }}')) {
    findings.push('merge admission — bootstrap PR identity is not event-bound');
  }
  const actualRun = extractAdmissionRun(workflowText);
  if (!actualRun) {
    findings.push('merge admission — canonical admission run is missing');
  } else if (
    normalizeAdmissionDigestLines(actualRun).join('\n') !== CANONICAL_ADMISSION_RUN.join('\n')
  ) {
    findings.push(
      'merge admission — canonical trusted evaluator run changed; refusing an unreviewed control-flow variant',
    );
  }
  return findings;
}

function fail(message) {
  process.stderr.write(`[merge-admission] FAIL — ${message}\n`);
  process.exit(1);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

const REQUIRED_PULL_REQUEST_FIELDS = [
  [(pr) => Number.isSafeInteger(pr.number), 'a safe number'],
  [(pr) => Boolean(pr.base?.sha), 'the base SHA'],
  [(pr) => Boolean(pr.head?.sha), 'the head SHA'],
  [(pr) => typeof pr.title === 'string', 'the title'],
];

function parsePullRequestEvent(event) {
  const pr = event?.pull_request;
  if (!pr) throw new Error('pull_request event is missing the pull_request object');
  const missing = REQUIRED_PULL_REQUEST_FIELDS.find(([isValid]) => !isValid(pr));
  if (missing) throw new Error(`pull_request event is missing ${missing[1]}`);
  return pr;
}

function readPullRequest(eventPath) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required for pull-request merge proof');
  try {
    return parsePullRequestEvent(JSON.parse(readFileSync(eventPath, 'utf8')));
  } catch (error) {
    throw new Error(`cannot read event payload: ${formatError(error)}`);
  }
}

function readMergeState(pr) {
  try {
    return {
      currentHead: git(['rev-parse', 'HEAD']),
      firstParent: git(['rev-parse', 'HEAD^1']),
      secondParent: git(['rev-parse', 'HEAD^2']),
      computedTree: git(['merge-tree', '--write-tree', pr.base.sha, pr.head.sha]),
      actualTree: git(['rev-parse', 'HEAD^{tree}']),
    };
  } catch (error) {
    throw new Error(`cannot prove current merge ref: ${formatError(error)}`);
  }
}

function collectReleaseFindings(pr, mergeState) {
  let workflowText;
  try {
    workflowText = readFileSync(join(root, ADMISSION_WORKFLOW_PATH), 'utf8');
  } catch (error) {
    return [`merge admission — admission workflow is unavailable: ${formatError(error)}`];
  }
  const workflowFindings = validateAdmissionWorkflow(workflowText);
  if (workflowFindings.length > 0) return workflowFindings;

  let currentMainSha;
  try {
    currentMainSha = git(['rev-parse', '--verify', 'refs/remotes/origin/main']);
  } catch (error) {
    return [`merge admission — current origin/main SHA is unavailable: ${formatError(error)}`];
  }
  const baseFindings = validateCurrentBase({
    eventBaseSha: pr.base.sha,
    currentMainSha,
  });
  if (baseFindings.length > 0) return baseFindings;

  const refFindings = validateMergeRef({
    ...mergeState,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    githubSha: process.env['GITHUB_SHA'] ?? mergeState.currentHead,
  });
  if (refFindings.length > 0) return refFindings;

  const boundary = classifyReleaseTagBoundary({
    repositoryRoot: root,
    head: pr.base.sha,
    context: 'main',
  });
  if (boundary.code !== 'ANCESTOR') return [boundary.finding];
  const records = getMergeAdmissionCommitRecords(pr.base.sha, pr.head.sha, root);
  if (!records) return ['CHANGELOG.md — HISTORY_UNAVAILABLE'];
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const taggedVersions = getTaggedVersions(root);
  return [
    ...scanReleaseTruth(changelog, packageVersion, taggedVersions),
    ...scanMergeAdmissionTruth({
      changelog,
      packageVersion,
      taggedVersions,
      ...records,
      prNumber: pr.number,
      prTitle: pr.title,
      prHeadLabel: String(pr.head.label ?? pr.head.ref ?? 'head').replace(':', '/'),
    }),
  ];
}

function main() {
  try {
    const pr = readPullRequest(process.env['GITHUB_EVENT_PATH']);
    const findings = collectReleaseFindings(pr, readMergeState(pr));
    if (findings.length > 0) throw new Error(findings.join('; '));
    process.stdout.write(
      `[merge-admission] OK — PR #${pr.number} merge tree and logical release truth match current base ${pr.base.sha}. Latest release: v${getLatestReleasedVersion() ?? 'unknown'}.\n`,
    );
  } catch (error) {
    fail(formatError(error));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
