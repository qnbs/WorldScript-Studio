#!/usr/bin/env node
/**
 * QNBS-v3 one-physical-line comment policy (AGENTS.md).
 *
 * Diff-aware: a multi-line QNBS-v3 marker run only counts if at least one of its lines was
 * touched by the diff, so untouched historical violations never become a new blocker. Reads
 * content from the exact revision the diff was computed against (the index for --staged, HEAD
 * for --range) so a partially staged or working-tree-ahead-of-HEAD file can't desync line
 * numbers from content. Reports only — never rewrites source.
 *
 * Run: node scripts/check-qnbs-v3-comments.mjs --staged   (pre-commit: git diff --cached)
 *      node scripts/check-qnbs-v3-comments.mjs --range <ref>  (ci:prepush: git diff <ref>...HEAD)
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { defaultResolveUpstream, isMainModule } from './ci-prepush-range-resolver.mjs';

// QNBS-v3: mirrors the historical "codify a pre-commit self-check for the QNBS-v3 one-line rule" glob.
const GOVERNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.rs',
  '.cpp',
  '.yml',
  '.yaml',
]);

const LINE_COMMENT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.rs',
  '.cpp',
]);
const HASH_COMMENT_EXTENSIONS = new Set(['.yml', '.yaml']);
const BLOCK_COMMENT_EXTENSIONS = new Set(['.css']);

// QNBS-v3: also matches the established tagged form, e.g. 'QNBS-v3 (CodeAnt #342): ...'.
const QNBS_MARKER_SOURCE = 'QNBS-v3(?:\\s*\\([^)]*\\))?:';
const QNBS_MARKER_START = new RegExp(`^${QNBS_MARKER_SOURCE}`);
const QNBS_MARKER_ANYWHERE = new RegExp(QNBS_MARKER_SOURCE);

// QNBS-v3: a continuation line that itself opens a distinct directive is not a prose continuation.
const INDEPENDENT_DIRECTIVE = new RegExp(
  `^(${QNBS_MARKER_SOURCE}|eslint-disable|biome-ignore|TODO|FIXME|NOTE:|@ts-)`,
);

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
    // QNBS-v3: this gate alone already excludes the file-header lines that precede the first @@.
    if (!inHunk) continue;
    if (rawLine.startsWith('+')) {
      added.add(newLine);
      newLine += 1;
    } else if (rawLine.startsWith('-')) {
      // removed line: does not consume a new-file line number
    } else if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file" — not a content line
    } else {
      newLine += 1;
    }
  }
  return added;
}

// QNBS-v3: strict form — used for continuation lines, which must be pure comments, never trailing.
function lineCommentBody(line, token) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(token)) return null;
  return trimmed.slice(token.length).trim();
}

// QNBS-v3: finds token outside quotes so a trailing `code; // QNBS-v3: ...` marker is seen too.
function findUnquotedTokenIndex(line, token, quoteChars) {
  let inQuote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '\\' && (inQuote !== "'" || token === '//')) i += 1;
      else if (ch === inQuote) inQuote = null;
      continue;
    }
    if (quoteChars.includes(ch)) inQuote = ch;
    else if (line.startsWith(token, i)) return i;
  }
  return -1;
}

// QNBS-v3: permissive form — also matches this repo's trailing-comment convention (code; // ...).
function commentBodyAnywhere(line, token, quoteChars) {
  const idx = findUnquotedTokenIndex(line, token, quoteChars);
  return idx === -1 ? null : line.slice(idx + token.length).trim();
}

function runTouchesAdded(startLine, endLine, addedLineNumbers) {
  for (let n = startLine; n <= endLine; n += 1) {
    if (addedLineNumbers.has(n)) return true;
  }
  return false;
}

// QNBS-v3: isolated so the marker scan below stays a flat "is this a marker? handle the run" pass.
function findCommentRunEnd(lines, start, token) {
  let end = start;
  while (end + 1 < lines.length) {
    const nextBody = lineCommentBody(lines[end + 1], token);
    if (nextBody === null || INDEPENDENT_DIRECTIVE.test(nextBody)) break;
    end += 1;
  }
  return end;
}

const QUOTE_CHARS_BY_TOKEN = { '//': `'"\``, '#': `'"` };

/**
 * Finds one-physical-line violations for QNBS-v3 marker runs. Walks the whole file (not just
 * added lines) so a violation is caught whether the *marker* line was newly added, an existing
 * marker gained a *new continuation* line, or both — then only reports a run that the diff
 * actually touched, so an untouched historical multi-line marker stays unblocked. The marker
 * itself may be a trailing comment after code (this repo's existing convention); a continuation
 * line may not — it must be a pure, standalone comment line.
 */
export function findLineCommentViolations(lines, addedLineNumbers, token) {
  const violations = [];
  const quoteChars = QUOTE_CHARS_BY_TOKEN[token] ?? `'"`;
  let i = 0;
  while (i < lines.length) {
    const body = commentBodyAnywhere(lines[i], token, quoteChars);
    if (!body || !QNBS_MARKER_START.test(body)) {
      i += 1;
      continue;
    }
    const end = findCommentRunEnd(lines, i, token);
    if (end > i && runTouchesAdded(i + 1, end + 1, addedLineNumbers)) {
      violations.push({
        line: i + 1,
        reason:
          'QNBS-v3 rationale continues onto a following comment line; keep it one physical line.',
      });
    }
    i = end + 1;
  }
  return violations;
}

// QNBS-v3: isolated so the block scan below stays a flat "is this a marker run? handle it" pass.
function findBlockCommentExtent(lines, i, openIndex) {
  let end = i;
  let closeIndex = lines[i].indexOf('*/', openIndex + 2);
  while (closeIndex === -1 && end + 1 < lines.length) {
    end += 1;
    closeIndex = lines[end].indexOf('*/');
  }
  return { end, closeIndex };
}

// QNBS-v3: the marker may follow decorative prefix text (e.g. index.css), not only right after '/*'.
function blockCommentHasMarker(lines, i, openIndex, end, closeIndex) {
  const openLineText =
    closeIndex !== -1 && end === i
      ? lines[i].slice(openIndex + 2, closeIndex)
      : lines[i].slice(openIndex + 2);
  const middleLines = end > i + 1 ? lines.slice(i + 1, end) : [];
  const closeLineText =
    end > i ? (closeIndex === -1 ? lines[end] : lines[end].slice(0, closeIndex)) : '';
  return [openLineText, ...middleLines, closeLineText].some((text) =>
    QNBS_MARKER_ANYWHERE.test(text),
  );
}

// QNBS-v3: walks whole /* */ runs so an unchanged opener with an added continuation is caught too.
export function findBlockCommentViolations(lines, addedLineNumbers) {
  const violations = [];
  let i = 0;
  while (i < lines.length) {
    const openIndex = lines[i].indexOf('/*');
    if (openIndex === -1) {
      i += 1;
      continue;
    }
    const { end, closeIndex } = findBlockCommentExtent(lines, i, openIndex);
    if (!blockCommentHasMarker(lines, i, openIndex, end, closeIndex)) {
      i += 1;
      continue;
    }
    if ((end > i || closeIndex === -1) && runTouchesAdded(i + 1, end + 1, addedLineNumbers)) {
      violations.push({
        line: i + 1,
        reason: 'QNBS-v3 rationale block comment does not close on the same physical line.',
      });
    }
    i = end + 1;
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
    if (body === null || !QNBS_MARKER_START.test(body)) continue;
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

// QNBS-v3: LC_ALL=C keeps git's stderr diagnostics in English regardless of system locale.
function git(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
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

// QNBS-v3: content comes from the diff's own revision (index or HEAD), never the working tree.
function readVersioned(mode, file, cwd) {
  const spec = mode === 'staged' ? `:${file}` : `HEAD:${file}`;
  const result = git(['show', spec], cwd);
  if (result.status === 0) return { content: result.stdout ?? '', missing: false, error: false };
  const stderr = result.stderr ?? '';
  if (/does not exist|exists on disk, but not in/i.test(stderr)) {
    return { content: null, missing: true, error: false };
  }
  return { content: null, missing: false, error: true };
}

export function runCheck({ mode, ref, cwd = process.cwd() } = {}) {
  const files = changedFiles(mode, ref, cwd);
  // QNBS-v3: fail closed — an unresolvable diff must not silently pass as "nothing changed".
  if (files === null) return { ok: false, failedClosed: true, violations: [] };
  const governed = files.filter(isGovernedPath);
  const violations = [];
  for (const file of governed) {
    const diffText = diffFor(mode, ref, file, cwd);
    if (diffText === null) return { ok: false, failedClosed: true, violations: [] };
    const versioned = readVersioned(mode, file, cwd);
    if (versioned.missing) continue; // deleted in this revision — nothing to check
    // QNBS-v3: only a confirmed deletion is safe to skip; any other read failure fails closed.
    if (versioned.error) return { ok: false, failedClosed: true, violations: [] };
    for (const violation of checkFileContent(file, versioned.content, diffText)) {
      violations.push({ file, ...violation });
    }
  }
  return { ok: violations.length === 0, failedClosed: false, violations };
}

export function resolveUpstreamRef(cwd) {
  const upstream = git(['rev-parse', '--verify', '@{upstream}'], cwd);
  if (upstream.status === 0) return (upstream.stdout ?? '').trim();
  // QNBS-v3: mirrors pr-budget.mjs's own PR_BUDGET_BASE escape hatch for a branch's first push.
  const base = process.env.PR_BUDGET_BASE?.trim();
  return base ? base : null;
}

function resolveModeAndRef(args) {
  const rangeIndex = args.indexOf('--range');
  const requestedRange = rangeIndex >= 0;
  // QNBS-v3: no flags means "check my current staged change" — same as explicit --staged.
  const mode = requestedRange ? 'range' : 'staged';
  const explicitRef =
    requestedRange && args[rangeIndex + 1] && !args[rangeIndex + 1].startsWith('--')
      ? args[rangeIndex + 1]
      : undefined;
  if (!requestedRange || explicitRef) return { mode, ref: explicitRef };
  // QNBS-v3: fall back to this module's own PR_BUDGET_BASE resolver only when the shared one fails.
  const ref = defaultResolveUpstream() ?? resolveUpstreamRef(process.cwd());
  return { mode, ref };
}

async function main() {
  const { mode, ref } = resolveModeAndRef(process.argv.slice(2));
  if (mode === 'range' && !ref) {
    console.error('[qnbs-v3] could not resolve @{upstream} for --range; failing closed.');
    process.exit(1);
  }
  const result = runCheck({ mode, ref });
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
