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
  { name: 'claude-com-session-url', regex: /claude\.com\/[^\s]*\/session_/i },
  { name: 'co-authored-by-claude', regex: /^Co-Authored-By:\s*Claude\b/im },
  { name: 'anthropic-noreply-email', regex: /noreply@anthropic\.com/i },
  { name: 'generated-by-claude-footer', regex: /^🤖\s*(Generated|Addressed)\s+.*Claude/im },
  { name: 'copilot-claude-co-author', regex: /^Co-Authored-By:\s*GitHub Copilot \(Claude/im },
];

export function checkAttributionText(text) {
  const matches = FORBIDDEN_ATTRIBUTION_PATTERNS.filter((p) => p.regex.test(text ?? '')).map(
    (p) => p.name,
  );
  return { ok: matches.length === 0, matches };
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
  return result.stdout;
}

function checkRange(base, head) {
  const shas = runGit(['rev-list', '--reverse', `${base}..${head}`])
    .split(/\r?\n/)
    .filter(Boolean);
  const failures = [];
  for (const sha of shas) {
    const message = runGit(['show', '-s', '--format=%B', sha]);
    const result = checkAttributionText(message);
    if (!result.ok) failures.push({ sha, matches: result.matches });
  }
  return failures;
}

export function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const messageIndex = args.indexOf('--message');

  if (fileIndex >= 0) {
    const filePath = args[fileIndex + 1];
    const result = checkAttributionText(readFileSync(filePath, 'utf8'));
    if (!result.ok) {
      console.error(
        `[check-commit-attribution] ${filePath}: forbidden pattern(s) ${result.matches.join(', ')} — remove AI/session attribution (see AGENTS.md).`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('[check-commit-attribution] OK');
    return;
  }

  if (messageIndex >= 0) {
    const result = checkAttributionText(args[messageIndex + 1]);
    if (!result.ok) {
      console.error(
        `[check-commit-attribution] forbidden pattern(s) ${result.matches.join(', ')} — remove AI/session attribution (see AGENTS.md).`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('[check-commit-attribution] OK');
    return;
  }

  const [base, head] = args;
  if (!base || !head) {
    console.error(
      'usage: node scripts/check-commit-attribution.mjs --file <path> | --message <text> | <base-sha> <head-sha>',
    );
    process.exitCode = 2;
    return;
  }
  const failures = checkRange(base, head);
  if (failures.length > 0) {
    for (const f of failures) {
      console.error(
        `[check-commit-attribution] ${f.sha.slice(0, 12)}: forbidden pattern(s) ${f.matches.join(', ')}`,
      );
    }
    console.error(
      '[check-commit-attribution] FAIL — remove AI/model/session attribution from the listed commits (see AGENTS.md).',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`[check-commit-attribution] OK — 0 forbidden patterns in ${base}..${head}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
