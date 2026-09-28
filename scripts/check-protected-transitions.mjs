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
// QNBS-v3: the trust workflow is protected too, so a later PR cannot silently drop the verifier call; the base checker (an immutable root) cannot require that line itself.
export const PROTECTED_PATHS = Object.freeze([
  ...EVALUATOR_PATHS,
  VERIFIER_PATH,
  TRUST_WORKFLOW_PATH,
  MANIFEST_PATH,
]);

const AUTHORIZABLE_PATHS = new Set([...EVALUATOR_PATHS, VERIFIER_PATH, TRUST_WORKFLOW_PATH]);
const PROTECTED_SET = new Set(PROTECTED_PATHS);
const CONTROL_PATHS = new Set([MANIFEST_PATH, VERIFIER_PATH, TRUST_WORKFLOW_PATH]);
const REGULAR_FILE_MODE = '100644';
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g;
const OPAQUE_LOADERS = [
  [/\bimport\s*\(\s*(?!["'])/, 'non-literal dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\bcreateRequire\b/, 'createRequire'],
];

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function createGit(cwd) {
  return (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function hasExactKeys(value, keys) {
  return (
    value !== null && typeof value === 'object' && Object.keys(value).sort().join(',') === keys
  );
}

const TRANSITION_RULES = [
  (entry) => hasExactKeys(entry, 'from,path,to'),
  (entry) => AUTHORIZABLE_PATHS.has(entry.path),
  (entry) => DIGEST.test(entry.from) && DIGEST.test(entry.to),
  (entry) => entry.from !== entry.to,
];

const MANIFEST_RULES = [
  (manifest) => hasExactKeys(manifest, 'transitions,version'),
  (manifest) => manifest.version === 1,
  (manifest) => Array.isArray(manifest.transitions),
];

function isValidTransition(entry) {
  return TRANSITION_RULES.every((rule) => rule(entry));
}

function parseJson(text) {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'protected-transition manifest is not valid JSON' };
  }
}

function transitionListError(transitions) {
  const invalid = transitions.find((entry) => !isValidTransition(entry));
  if (invalid !== undefined)
    return `invalid protected transition entry: ${JSON.stringify(invalid)}`;
  const paths = transitions.map((entry) => entry.path);
  return new Set(paths).size === paths.length
    ? null
    : 'protected-transition manifest lists a path more than once';
}

// QNBS-v3: strict schema, exact paths only (no globs), one entry per path; anything else fails closed.
export function parseManifest(text) {
  const parsed = parseJson(text);
  if (parsed.error) return parsed;
  if (!MANIFEST_RULES.every((rule) => rule(parsed.value))) {
    return { error: 'protected-transition manifest must be {"version":1,"transitions":[...]}' };
  }
  const error = transitionListError(parsed.value.transitions);
  return error ? { error } : { transitions: parsed.value.transitions };
}

function mixesControlWithEvaluator(changedPaths) {
  const touchesControl = changedPaths.some(
    (path) => CONTROL_PATHS.has(path) && path !== MANIFEST_PATH,
  );
  return touchesControl && changedPaths.some((path) => EVALUATOR_PATHS.includes(path));
}

function checkControlIsolation(changes) {
  const changedPaths = changes.map((change) => change.path);
  if (changedPaths.includes(MANIFEST_PATH) && changedPaths.length !== 1) {
    return ['the protected-transition manifest must change alone, in its own PR'];
  }
  return mixesControlWithEvaluator(changedPaths)
    ? ['the verifier or trust workflow must not change in the same PR as an evaluator']
    : [];
}

function editShapeFinding(change) {
  if (change.status !== 'M') return `status ${change.status} is not an in-place edit`;
  const regular = change.oldMode === REGULAR_FILE_MODE && change.newMode === REGULAR_FILE_MODE;
  return regular ? null : `mode ${change.oldMode}→${change.newMode} is not a regular file edit`;
}

function digestFinding(entry, change, readBlob) {
  const fromDigest = sha256(readBlob(change.oldBlob));
  if (entry.from !== fromDigest) {
    return `authorization is stale (base digest ${fromDigest}, authorized from ${entry.from})`;
  }
  const toDigest = sha256(readBlob(change.newBlob));
  return entry.to === toDigest
    ? null
    : `head digest ${toDigest} differs from the authorized ${entry.to}`;
}

function authorizationFinding(change, transitions, readBlob) {
  const shape = editShapeFinding(change);
  if (shape) return shape;
  const entry = transitions.find((candidate) => candidate.path === change.path);
  if (entry === undefined) return 'no base-owned transition authorizes this change';
  return digestFinding(entry, change, readBlob);
}

function checkAuthorizedChange(change, transitions, readBlob) {
  const finding = authorizationFinding(change, transitions, readBlob);
  return finding ? [`${change.path}: ${finding}`] : [];
}

function checkManifestOnlyChange(change, readBlob) {
  if (change.status !== 'M' || change.newMode !== REGULAR_FILE_MODE) {
    return [`${MANIFEST_PATH}: must be edited in place as a regular file`];
  }
  const { error } = parseManifest(readBlob(change.newBlob).toString('utf8'));
  return error ? [`${MANIFEST_PATH} (head): ${error}`] : [];
}

// QNBS-v3: the evaluator graph may load only node: builtins and protected relative modules; bare packages and opaque loaders fail closed because the verifier cannot pin what they resolve to.
function scanImports(path, source) {
  const relatives = [];
  const violations = OPAQUE_LOADERS.filter(([pattern]) => pattern.exec(source) !== null).map(
    ([, label]) => `${path} uses ${label}`,
  );
  for (const [, specifier = ''] of source.matchAll(IMPORT_SPECIFIER)) {
    if (specifier.startsWith('.')) {
      relatives.push(posix.normalize(posix.join(posix.dirname(path), specifier)));
    } else if (!specifier.startsWith('node:')) {
      violations.push(`${path} imports non-builtin '${specifier}'`);
    }
  }
  return { relatives, violations };
}

export function evaluatorImportClosure(readHeadFile, entry = EVALUATOR_ENTRY) {
  const seen = new Set();
  const violations = [];
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const source = readHeadFile(current);
    if (source === null) continue;
    const scanned = scanImports(current, source);
    pending.push(...scanned.relatives);
    violations.push(...scanned.violations);
  }
  return { files: [...seen], violations };
}

function checkProtectedChange(change, parsed, readBlob) {
  if (change.path === MANIFEST_PATH) return checkManifestOnlyChange(change, readBlob);
  return parsed.error ? [] : checkAuthorizedChange(change, parsed.transitions, readBlob);
}

function checkClosure(readHeadFile) {
  const { files, violations } = evaluatorImportClosure(readHeadFile);
  const unguarded = files.filter((path) => !EVALUATOR_PATHS.includes(path));
  const findings = violations.map((violation) => `evaluator graph: ${violation}`);
  if (unguarded.length > 0) {
    findings.push(`evaluator import closure reaches unprotected files: ${unguarded.join(', ')}`);
  }
  return findings;
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
    findings.push(...checkProtectedChange(change, parsed, readBlob));
  }
  findings.push(...checkClosure(readHeadFile));
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
