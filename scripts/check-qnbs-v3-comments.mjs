#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * QNBS-v3 one-physical-line comment policy (AGENTS.md).
 *
 * Diff-aware: only newly added `QNBS-v3:` rationale lines are checked, so untouched historical
 * violations never become a new blocker. Reports only — never rewrites source.
 *
 * Run: node scripts/check-qnbs-v3-comments.mjs --staged   (pre-commit: git diff --cached)
 *      node scripts/check-qnbs-v3-comments.mjs --range <ref>  (ci:prepush: git diff <ref>...HEAD)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { isMainModule } from './ci-prepush-range-resolver.mjs';

// QNBS-v3: mirrors the historical "codify a pre-commit self-check for the QNBS-v3 one-line rule" glob.
const GOVERNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.css',
  '.rs',
  '.cpp',
  '.yml',
  '.yaml',
]);

const LINE_COMMENT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.rs', '.cpp']);
const HASH_COMMENT_EXTENSIONS = new Set(['.yml', '.yaml']);
const BLOCK_COMMENT_EXTENSIONS = new Set(['.css']);

// QNBS-v3: a continuation line that itself opens a distinct directive is not a prose continuation.
const INDEPENDENT_DIRECTIVE = /^(QNBS-v3:|eslint-disable|biome-ignore|TODO|FIXME|NOTE:|@ts-)/;

export function extensionOf(filePath) {
  const match = /\.[^./\\]+$/.exec(filePath);
  return match ? match[0].toLowerCase() : '';
}

export function isGovernedPath(filePath) {
  return GOVERNED_EXTENSIONS.has(extensionOf(filePath));
}

// QNBS-v3: workflow/composite-action YAML is source; other YAML is config, per AGENTS.md.
export function isWorkflowYamlPath(filePath) {
  return filePath.startsWith('.github/workflows/') || filePath.startsWith('.github/actions/');
}

export function commentStyleFor(filePath) {
  const ext = extensionOf(filePath);
  if (LINE_COMMENT_EXTENSIONS.has(ext)) return 'line-slash';
  if (HASH_COMMENT_EXTENSIONS.has(ext)) return 'line-hash';
  if (BLOCK_COMMENT_EXTENSIONS.has(ext)) return 'block-css';
  return null;
}

function splitLines(content) {
  // QNBS-v3: split first, strip \r per line — handles LF, CRLF and a trailing partial line alike.
  return content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

// QNBS-v3: unified diff with -U0 carries only hunk headers, enough to compute new-file added lines.
export function parseAddedLineNumbers(diffText) {
  const added = new Set();
  const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  let newLine = 0;
  let inHunk = false;
  for (const rawLine of diffText.split('\n')) {
    const hunkMatch = hunkHeader.exec(rawLine);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      added.add(newLine);
      newLine += 1;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      // removed line: does not consume a new-file line number
    } else if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file" — not a content line
    } else {
      newLine += 1;
    }
  }
  return added;
}

function lineCommentBody(line, token) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(token)) return null;
  return trimmed.slice(token.length).trim();
}

/**
 * Finds one-physical-line violations among newly added QNBS-v3 marker lines.
 * `lines` is the full current file content (0-indexed array); `addedLineNumbers` are 1-indexed
 * line numbers in that same content that the diff reports as added.
 */
export function findLineCommentViolations(lines, addedLineNumbers, token) {
  const violations = [];
  for (const lineNo of addedLineNumbers) {
    const line = lines[lineNo - 1];
    if (line === undefined) continue;
    const body = lineCommentBody(line, token);
    if (body === null || !body.startsWith('QNBS-v3:')) continue;
    const next = lines[lineNo];
    if (next === undefined) continue;
    const nextBody = lineCommentBody(next, token);
    if (nextBody === null) continue;
    if (INDEPENDENT_DIRECTIVE.test(nextBody)) continue;
    violations.push({
      line: lineNo,
      reason:
        'QNBS-v3 rationale continues onto a following comment line; keep it one physical line.',
    });
  }
  return violations;
}

export function findBlockCommentViolations(lines, addedLineNumbers) {
  const violations = [];
  for (const lineNo of addedLineNumbers) {
    const line = lines[lineNo - 1];
    if (line === undefined) continue;
    const openIndex = line.indexOf('/*');
    if (openIndex === -1) continue;
    const afterOpen = line.slice(openIndex + 2).trim();
    if (!afterOpen.startsWith('QNBS-v3:')) continue;
    const closeIndex = line.indexOf('*/', openIndex + 2);
    if (closeIndex !== -1) continue;
    violations.push({
      line: lineNo,
      reason: 'QNBS-v3 rationale block comment does not close on the same physical line.',
    });
  }
  return violations;
}

export function findYamlConfigMarkerViolations(lines, addedLineNumbers, filePath) {
  if (isWorkflowYamlPath(filePath)) return [];
  const violations = [];
  for (const lineNo of addedLineNumbers) {
    const line = lines[lineNo - 1];
    if (line === undefined) continue;
    const body = lineCommentBody(line, '#');
    if (body === null || !body.startsWith('QNBS-v3:')) continue;
    violations.push({
      line: lineNo,
      reason:
        'QNBS-v3 rationale in non-workflow YAML config; this repository records config rationale in commit history, not inline.',
    });
  }
  return violations;
}

export function checkFileContent(filePath, currentContent, diffText) {
  const style = commentStyleFor(filePath);
  if (!style) return [];
  const addedLineNumbers = parseAddedLineNumbers(diffText);
  if (addedLineNumbers.size === 0) return [];
  const lines = splitLines(currentContent);
  if (style === 'line-slash') return findLineCommentViolations(lines, addedLineNumbers, '//');
  if (style === 'block-css') return findBlockCommentViolations(lines, addedLineNumbers);
  // line-hash (yml/yaml): the physical-line rule and the workflow-vs-config rule are independent.
  return [
    ...findLineCommentViolations(lines, addedLineNumbers, '#'),
    ...findYamlConfigMarkerViolations(lines, addedLineNumbers, filePath),
  ];
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result;
}

function changedFiles(mode, ref, cwd) {
  const diffArgs =
    mode === 'staged'
      ? ['diff', '--cached', '--no-renames', '--name-only', '-z']
      : ['diff', `${ref}...HEAD`, '--no-renames', '--name-only', '-z'];
  const result = git(diffArgs, cwd);
  if (result.status !== 0) return null;
  return (result.stdout ?? '').split('\0').filter(Boolean);
}

function diffFor(mode, ref, file, cwd) {
  const diffArgs =
    mode === 'staged'
      ? ['diff', '--cached', '--no-renames', '--unified=0', '--', file]
      : ['diff', `${ref}...HEAD`, '--no-renames', '--unified=0', '--', file];
  const result = git(diffArgs, cwd);
  if (result.status !== 0) return null;
  return result.stdout ?? '';
}

export function runCheck({ mode, ref, cwd = process.cwd(), readFile = readFileSync } = {}) {
  const files = changedFiles(mode, ref, cwd);
  // QNBS-v3: fail closed — an unresolvable diff must not silently pass as "nothing changed".
  if (files === null) return { ok: false, failedClosed: true, violations: [] };
  const governed = files.filter(isGovernedPath);
  const violations = [];
  for (const file of governed) {
    const diffText = diffFor(mode, ref, file, cwd);
    if (diffText === null) return { ok: false, failedClosed: true, violations: [] };
    let content;
    try {
      content = readFile(resolve(cwd, file), 'utf8');
    } catch {
      continue; // deleted file — nothing to check in the new tree
    }
    for (const violation of checkFileContent(file, content, diffText)) {
      violations.push({ file, ...violation });
    }
  }
  return { ok: violations.length === 0, failedClosed: false, violations };
}

export function resolveUpstreamRef(cwd) {
  const upstream = git(['rev-parse', '--verify', '@{upstream}'], cwd);
  if (upstream.status === 0) return (upstream.stdout ?? '').trim();
  // QNBS-v3: mirrors pr-budget.mjs's own PR_BUDGET_BASE escape hatch for a branch's first push.
  if (process.env.PR_BUDGET_BASE) return process.env.PR_BUDGET_BASE;
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const rangeIndex = args.indexOf('--range');
  const requestedRange = rangeIndex >= 0;
  let ref =
    requestedRange && args[rangeIndex + 1] && !args[rangeIndex + 1].startsWith('--')
      ? args[rangeIndex + 1]
      : undefined;
  if (!staged && !requestedRange) {
    console.error('[qnbs-v3] usage: --staged | --range [ref]');
    process.exit(2);
  }
  if (requestedRange && !ref) {
    ref = resolveUpstreamRef(process.cwd());
    if (!ref) {
      console.error('[qnbs-v3] could not resolve @{upstream} for --range; failing closed.');
      process.exit(1);
    }
  }
  const result = runCheck({ mode: staged ? 'staged' : 'range', ref });
  if (result.failedClosed) {
    console.error('[qnbs-v3] could not resolve the diff for this check; failing closed.');
    process.exit(1);
  }
  if (result.ok) {
    console.log('[qnbs-v3] OK — no new multi-line QNBS-v3 markers.');
    process.exit(0);
  }
  console.error('[qnbs-v3] one-physical-line QNBS-v3 policy violated:');
  for (const v of result.violations) console.error(`  ${v.file}:${v.line} — ${v.reason}`);
  console.error(
    '[qnbs-v3] shorten the rationale to one physical line; this check never rewrites source.',
  );
  process.exit(1);
}

if (isMainModule(process.argv[1], import.meta.url)) await main();
