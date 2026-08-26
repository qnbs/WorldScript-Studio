import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { classifyFile } from './ci-prepush-classifier.mjs';

// QNBS-v3: a distinct, stricter gate from CLAUDE.md's ~100-file CodeAnt-visibility rule (different purpose).
const TIERS = {
  target: { files: 8, lines: 400, commits: 6 },
  hard: { files: 20, lines: 1200, commits: 10 },
  docsGovernance: { files: 15, lines: 2400, commits: 8 },
  absolute: { files: 30, lines: 3000, commits: 15 },
};

function runGit(args, dependencies = {}) {
  const spawn = dependencies.spawnSync ?? spawnSync;
  const result = spawn('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

export function getChangedFilesNumstat(base, head, dependencies = {}) {
  return runGit(['diff', '--no-renames', '--numstat', `${base}...${head}`], dependencies);
}

export function getCommitCount(base, head, dependencies = {}) {
  const output = runGit(['rev-list', '--count', `${base}..${head}`], dependencies);
  if (output === null) return null;
  const count = Number.parseInt(output.trim(), 10);
  return Number.isFinite(count) ? count : null;
}

// QNBS-v3: binary files report "-\t-\tpath" in numstat — treated as 0 meaningful lines, not NaN.
export function parseNumstat(numstatOutput) {
  const rows = [];
  for (const line of numstatOutput.split('\n')) {
    if (!line.trim()) continue;
    const [added, removed, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    rows.push({
      path,
      added: added === '-' ? 0 : Number.parseInt(added, 10),
      removed: removed === '-' ? 0 : Number.parseInt(removed, 10),
    });
  }
  return rows;
}

// QNBS-v3: zeroes generated/non-code diffs so e.g. a locale bundle rebuild can't trip this gate.
export function computeMeaningfulLines(rows) {
  let total = 0;
  for (const row of rows) {
    if (row.path.split('/').pop() === 'pnpm-lock.yaml') continue;
    if (classifyFile(row.path) === 'NON_CODE_ONLY') continue;
    total += row.added + row.removed;
  }
  return total;
}

export function isAllDocs(rows) {
  if (rows.length === 0) return false;
  return rows.every((row) => classifyFile(row.path) === 'DOCS');
}

// QNBS-v3: absolute is a fixed ceiling; docsGovernance replaces hard (not target) for all-DOCS PRs.
export function selectSeverity({ fileCount, lineCount, commitCount, allDocs }) {
  const overAbsolute =
    fileCount > TIERS.absolute.files ||
    lineCount > TIERS.absolute.lines ||
    commitCount > TIERS.absolute.commits;
  if (overAbsolute) return { tier: 'absolute', blocking: true, limits: TIERS.absolute };

  const midTier = allDocs ? 'docsGovernance' : 'hard';
  const midLimits = TIERS[midTier];
  const overMid =
    fileCount > midLimits.files || lineCount > midLimits.lines || commitCount > midLimits.commits;
  if (overMid) return { tier: midTier, blocking: false, limits: midLimits };

  const overTarget =
    fileCount > TIERS.target.files ||
    lineCount > TIERS.target.lines ||
    commitCount > TIERS.target.commits;
  if (overTarget) return { tier: 'target', blocking: false, limits: TIERS.target };

  return { tier: 'ok', blocking: false, limits: TIERS.target };
}

export function formatReport({ fileCount, lineCount, commitCount, allDocs, severity }) {
  const { tier, blocking, limits } = severity;
  if (tier === 'ok') {
    return `PR size within target: ${fileCount} files, ${lineCount} meaningful lines, ${commitCount} commits (limit: ≤${limits.files}/≤${limits.lines}/≤${limits.commits}).`;
  }
  const kind = blocking ? 'exceeds the absolute ceiling' : `is over the ${tier} tier`;
  const profile = allDocs ? 'docs/governance' : 'normal';
  return `PR size ${kind} (${profile} profile): ${fileCount} files, ${lineCount} meaningful lines, ${commitCount} commits — limit ≤${limits.files} files / ≤${limits.lines} lines / ≤${limits.commits} commits. ${blocking ? 'Split this PR into smaller, independently reviewable PRs before merge.' : 'Consider splitting into smaller, independently reviewable PRs.'}`;
}

export function evaluatePrSize(base, head, dependencies = {}) {
  const numstat = getChangedFilesNumstat(base, head, dependencies);
  const commitCount = getCommitCount(base, head, dependencies);
  if (numstat === null || commitCount === null) {
    return { ok: false, error: 'could not resolve diff/commit range via git' };
  }
  const rows = parseNumstat(numstat);
  const fileCount = rows.length;
  const lineCount = computeMeaningfulLines(rows);
  const allDocs = isAllDocs(rows);
  const severity = selectSeverity({ fileCount, lineCount, commitCount, allDocs });
  return {
    ok: true,
    fileCount,
    lineCount,
    commitCount,
    allDocs,
    severity,
    report: formatReport({ fileCount, lineCount, commitCount, allDocs, severity }),
  };
}

export function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('Usage: node scripts/check-pr-size.mjs <base-sha> <head-sha>');
    process.exitCode = 1;
    return;
  }
  const result = evaluatePrSize(base, head);
  if (!result.ok) {
    console.error(`[check-pr-size] ${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check-pr-size] ${result.report}`);
  if (result.severity.blocking) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
