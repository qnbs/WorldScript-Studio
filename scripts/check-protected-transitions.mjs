#!/usr/bin/env node
// QNBS-v3: base-owned verifier for the merge-admission evaluator graph; it runs from the trusted base checkout under pull_request_target and reads the PR only as git data.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_PATH = '.github/governance/protected-transitions.json';
export const VERIFIER_PATH = 'scripts/check-protected-transitions.mjs';
export const TRUST_WORKFLOW_PATH = '.github/workflows/reviewer-governance-trust.yml';
export const EVALUATOR_ENTRY = 'scripts/check-merge-admission.mjs';
export const EVALUATOR_PATHS = Object.freeze([
  'scripts/check-merge-admission.mjs',
  'scripts/check-doc-metrics.mjs',
  'scripts/i18n-locales.mjs',
  'scripts/test-metrics.mjs',
]);
export const PROTECTED_PATHS = Object.freeze([...EVALUATOR_PATHS, VERIFIER_PATH, MANIFEST_PATH]);

const AUTHORIZABLE_PATHS = new Set([...EVALUATOR_PATHS, VERIFIER_PATH]);
const PROTECTED_SET = new Set(PROTECTED_PATHS);
const CONTROL_PATHS = new Set([MANIFEST_PATH, VERIFIER_PATH, TRUST_WORKFLOW_PATH]);
const REGULAR_FILE_MODE = '100644';
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const RELATIVE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g;

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createGit(cwd) {
  return (args) =>
    execFileSync('git', args, { cwd, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
}

// QNBS-v3: --raw -z gives modes, blob ids, status and path per entry; --no-renames makes a rename a delete plus an add, so neither side can slip through as a move.
export function parseRawDiff(raw) {
  const fields = raw.toString('utf8').split('\0');
  const changes = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const header = fields[index];
    if (!header?.startsWith(':')) break;
    const [oldMode, newMode, oldBlob, newBlob, status] = header.slice(1).split(' ');
    changes.push({ oldMode, newMode, oldBlob, newBlob, status, path: fields[index + 1] });
  }
  return changes;
}

function isValidTransition(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    Object.keys(entry).sort().join(',') === 'from,path,to' &&
    AUTHORIZABLE_PATHS.has(entry.path) &&
    DIGEST.test(entry.from) &&
    DIGEST.test(entry.to) &&
    entry.from !== entry.to
  );
}

// QNBS-v3: strict schema, exact paths only (no globs), one entry per path; anything else fails closed.
export function parseManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return { error: 'protected-transition manifest is not valid JSON' };
  }
  const shapeOk =
    manifest !== null &&
    typeof manifest === 'object' &&
    Object.keys(manifest).sort().join(',') === 'transitions,version' &&
    manifest.version === 1 &&
    Array.isArray(manifest.transitions);
  if (!shapeOk)
    return { error: 'protected-transition manifest must be {"version":1,"transitions":[...]}' };
  const invalid = manifest.transitions.find((entry) => !isValidTransition(entry));
  if (invalid !== undefined) {
    return { error: `invalid protected transition entry: ${JSON.stringify(invalid)}` };
  }
  const paths = manifest.transitions.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) {
    return { error: 'protected-transition manifest lists a path more than once' };
  }
  return { transitions: manifest.transitions };
}

function checkControlIsolation(changes) {
  const changedPaths = changes.map((change) => change.path);
  if (changedPaths.includes(MANIFEST_PATH) && changedPaths.length !== 1) {
    return ['the protected-transition manifest must change alone, in its own PR'];
  }
  const touchesControl = changedPaths.some(
    (path) => CONTROL_PATHS.has(path) && path !== MANIFEST_PATH,
  );
  const touchesEvaluator = changedPaths.some((path) => EVALUATOR_PATHS.includes(path));
  return touchesControl && touchesEvaluator
    ? ['the verifier or trust workflow must not change in the same PR as an evaluator']
    : [];
}

function checkAuthorizedChange(change, transitions, readBlob) {
  const where = `${change.path}:`;
  if (change.status !== 'M') return [`${where} status ${change.status} is not an in-place edit`];
  if (change.oldMode !== REGULAR_FILE_MODE || change.newMode !== REGULAR_FILE_MODE) {
    return [`${where} mode ${change.oldMode}→${change.newMode} is not a regular file edit`];
  }
  const entry = transitions.find((candidate) => candidate.path === change.path);
  if (entry === undefined) return [`${where} no base-owned transition authorizes this change`];
  const fromDigest = sha256(readBlob(change.oldBlob));
  const toDigest = sha256(readBlob(change.newBlob));
  if (entry.from !== fromDigest) {
    return [
      `${where} authorization is stale (base digest ${fromDigest}, authorized from ${entry.from})`,
    ];
  }
  if (entry.to !== toDigest) {
    return [`${where} head digest ${toDigest} differs from the authorized ${entry.to}`];
  }
  return [];
}

function checkManifestOnlyChange(change, readBlob) {
  if (change.status !== 'M' || change.newMode !== REGULAR_FILE_MODE) {
    return [`${MANIFEST_PATH}: must be edited in place as a regular file`];
  }
  const { error } = parseManifest(readBlob(change.newBlob).toString('utf8'));
  return error ? [`${MANIFEST_PATH} (head): ${error}`] : [];
}

// QNBS-v3: follow every relative import form from the entry evaluator at the PR head; a dependency outside the protected set would be an unguarded authority.
export function evaluatorImportClosure(readHeadFile, entry = EVALUATOR_ENTRY) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = readHeadFile(current);
    if (source === null) continue;
    for (const [, specifier = ''] of source.matchAll(RELATIVE_IMPORT)) {
      pending.push(posix.normalize(posix.join(posix.dirname(current), specifier)));
    }
  }
  return [...seen];
}

export function evaluateProtectedTransitions({
  changes,
  baseManifestText,
  readBlob,
  readHeadFile,
}) {
  const findings = [...checkControlIsolation(changes)];
  const parsed = baseManifestText === null ? { transitions: [] } : parseManifest(baseManifestText);
  if (parsed.error) findings.push(`${MANIFEST_PATH} (base): ${parsed.error}`);
  for (const change of changes.filter((candidate) => PROTECTED_SET.has(candidate.path))) {
    if (change.path === MANIFEST_PATH) {
      findings.push(...checkManifestOnlyChange(change, readBlob));
    } else if (!parsed.error) {
      findings.push(...checkAuthorizedChange(change, parsed.transitions, readBlob));
    }
  }
  const unguarded = evaluatorImportClosure(readHeadFile).filter(
    (path) => !EVALUATOR_PATHS.includes(path),
  );
  if (unguarded.length > 0) {
    findings.push(`evaluator import closure reaches unprotected files: ${unguarded.join(', ')}`);
  }
  return findings;
}

function readOptional(git, commit, path) {
  try {
    return git(['show', `${commit}:${path}`]).toString('utf8');
  } catch {
    return null;
  }
}

export function verifyProtectedTransitions({ baseSha, headSha, cwd = process.cwd() }) {
  if (!COMMIT.test(baseSha ?? '') || !COMMIT.test(headSha ?? '')) {
    return ['base and head must be full 40-character commit ids'];
  }
  const git = createGit(cwd);
  return evaluateProtectedTransitions({
    changes: parseRawDiff(
      git(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', baseSha, headSha]),
    ),
    baseManifestText: readOptional(git, baseSha, MANIFEST_PATH),
    readBlob: (blob) => git(['cat-file', 'blob', blob]),
    readHeadFile: (path) => readOptional(git, headSha, path),
  });
}

function main() {
  const [baseSha, headSha] = process.argv.slice(2);
  const findings = verifyProtectedTransitions({ baseSha, headSha });
  if (findings.length > 0) {
    for (const finding of findings) process.stderr.write(`[protected-transitions] ${finding}\n`);
    process.exit(1);
  }
  process.stdout.write(
    '[protected-transitions] OK — evaluator graph unchanged or exactly authorized by the base manifest.\n',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
