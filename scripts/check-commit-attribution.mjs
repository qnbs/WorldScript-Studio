#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Rejects AI/model/session attribution in commit messages and PR text (maintainer policy: repo
 * history records the code change, not the agent session — see AGENTS.md).
 *
 * Run: node scripts/check-commit-attribution.mjs --file <commit-msg-file>
 *      node scripts/check-commit-attribution.mjs --message "<text>"
 *      node scripts/check-commit-attribution.mjs <base-sha> <head-sha>   # scans every commit in range
 */
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// QNBS-v3: anchored so legitimate prose ("Claude provider", "Anthropic API docs") never matches.
export const FORBIDDEN_ATTRIBUTION_PATTERNS = [
  { name: 'claude-session-trailer', regex: /^Claude-Session:/im },
  { name: 'claude-session-url', regex: /claude\.ai\/code\/session_/i },
  { name: 'claude-com-session-url', regex: /claude\.com\/[^\s]*session_/i },
  // QNBS-v3: covers Anthropic too, not just Claude, matching AGENTS.md's Claude/Anthropic wording.
  { name: 'co-authored-by-claude', regex: /^Co-Authored-By:\s*(?:Claude|Anthropic)\b/im },
  // QNBS-v3: trailer-scoped so prose merely discussing the address (e.g. documenting this guard) isn't rejected.
  {
    name: 'anthropic-noreply-email',
    regex: /^(?:Co-Authored-By|Signed-off-by):.*noreply@anthropic\.com/im,
  },
  // QNBS-v3: end-anchored to the actual footer shape so prose discussing/quoting it isn't rejected.
  {
    name: 'generated-by-claude-footer',
    regex:
      /^(?:🤖\s*)?(?:Generated|Addressed)\s+(?:with|by)\s+(?:\[Claude Code\]\([^)]*\)|Claude Code|Anthropic)\s*$/im,
  },
  { name: 'copilot-claude-co-author', regex: /^Co-Authored-By:\s*GitHub Copilot \(Claude/im },
];

export function checkAttributionText(text) {
  const matches = FORBIDDEN_ATTRIBUTION_PATTERNS.filter((p) => p.regex.test(text ?? '')).map(
    (p) => p.name,
  );
  return { ok: matches.length === 0, matches };
}

const SHA_LINE = /^[0-9a-f]{40}$/i;

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout;
}

// QNBS-v3: a clean tag annotation can still target an attributed commit — check both objects.
function checkTagAndTarget(sha) {
  if (!SHA_LINE.test(sha)) throw new Error(`--tag requires a full commit/tag SHA, got: ${sha}`);
  const tagText = runGit(['cat-file', '-p', sha]);
  const tagResult = checkAttributionText(tagText);
  const type = runGit(['cat-file', '-t', sha]).trim();
  if (type !== 'tag') return tagResult;
  const targetSha = tagText.match(/^object ([0-9a-f]{40})$/m)?.[1];
  if (!targetSha || runGit(['cat-file', '-t', targetSha]).trim() !== 'commit') return tagResult;
  const commitResult = checkAttributionText(runGit(['show', '-s', '--format=%B', targetSha]));
  return {
    ok: tagResult.ok && commitResult.ok,
    matches: [...new Set([...tagResult.matches, ...commitResult.matches])],
  };
}

function checkRange(base, head) {
  const shas = runGit(['rev-list', '--reverse', `${base}..${head}`])
    .split(/\r?\n/)
    .filter(Boolean);
  const failures = [];
  for (const sha of shas) {
    // QNBS-v3: fail closed on any unexpected rev-list output shape before it reaches a git arg.
    if (!SHA_LINE.test(sha)) throw new Error(`unexpected non-SHA line from git rev-list: ${sha}`);
    const message = runGit(['show', '-s', '--format=%B', sha]);
    const result = checkAttributionText(message);
    if (!result.ok) failures.push({ sha, matches: result.matches });
  }
  return failures;
}

function usageError(message) {
  console.error(`[check-commit-attribution] ${message}`);
  console.error(
    'usage: node scripts/check-commit-attribution.mjs --file <path> | --message <text> | <base-sha> <head-sha>',
  );
  process.exitCode = 2;
}

function reportResult(result, label) {
  if (result.ok) {
    console.log('[check-commit-attribution] OK');
    return;
  }
  console.error(
    `[check-commit-attribution] ${label}forbidden pattern(s) ${result.matches.join(', ')} — remove AI/session attribution (see AGENTS.md).`,
  );
  process.exitCode = 1;
}

function runFileMode(filePath) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(
      `[check-commit-attribution] cannot read ${filePath}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exitCode = 1;
    return;
  }
  reportResult(checkAttributionText(text), `${filePath}: `);
}

function runRangeMode(base, head) {
  let failures;
  try {
    failures = checkRange(base, head);
  } catch (error) {
    console.error(
      `[check-commit-attribution] ${error instanceof Error ? error.message : 'range check failed'}`,
    );
    process.exitCode = 1;
    return;
  }
  if (failures.length === 0) {
    console.log(`[check-commit-attribution] OK — 0 forbidden patterns in ${base}..${head}`);
    return;
  }
  for (const f of failures) {
    console.error(
      `[check-commit-attribution] ${f.sha.slice(0, 12)}: forbidden pattern(s) ${f.matches.join(', ')}`,
    );
  }
  console.error(
    '[check-commit-attribution] FAIL — remove AI/model/session attribution from the listed commits (see AGENTS.md).',
  );
  process.exitCode = 1;
}

function dispatchFileMode(args, fileIndex) {
  const filePath = args[fileIndex + 1];
  if (!filePath) return usageError('--file requires a path argument');
  return runFileMode(filePath);
}

function dispatchMessageMode(args, messageIndex) {
  const text = args[messageIndex + 1];
  if (text === undefined) return usageError('--message requires a text argument');
  return reportResult(checkAttributionText(text), '');
}

function dispatchRangeMode(args) {
  const [base, head] = args;
  if (!base || !head)
    return usageError('requires --file, --message, --tag, or <base-sha> <head-sha>');
  return runRangeMode(base, head);
}

function dispatchTagMode(args, tagIndex) {
  const sha = args[tagIndex + 1];
  if (!sha) return usageError('--tag requires a SHA argument');
  let result;
  try {
    result = checkTagAndTarget(sha);
  } catch (error) {
    console.error(
      `[check-commit-attribution] ${error instanceof Error ? error.message : 'tag check failed'}`,
    );
    process.exitCode = 1;
    return;
  }
  return reportResult(result, `${sha.slice(0, 12)}: `);
}

export function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const messageIndex = args.indexOf('--message');
  const tagIndex = args.indexOf('--tag');
  if (fileIndex >= 0) return dispatchFileMode(args, fileIndex);
  if (messageIndex >= 0) return dispatchMessageMode(args, messageIndex);
  if (tagIndex >= 0) return dispatchTagMode(args, tagIndex);
  return dispatchRangeMode(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
