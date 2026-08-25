import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// QNBS-v3: import.meta.url isn't always a file: URL under Vitest's transform; cwd is the repo root there.
function resolveProjectRoot() {
  try {
    return resolve(fileURLToPath(new URL('..', import.meta.url)));
  } catch {
    return process.cwd();
  }
}
const projectRoot = resolveProjectRoot();
const fingerprintRelativePath = 'node_modules/.worldscript-deps-fingerprint';

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

export function dependencyFiles(root = projectRoot) {
  const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((file) =>
    join(root, file),
  );
  const packagesDirectory = join(root, 'packages');
  if (existsSync(packagesDirectory)) {
    for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(join(packagesDirectory, entry.name, 'package.json'));
    }
  }
  files.push(...walkFiles(join(root, 'patches')));
  return files.filter((file) => existsSync(file)).sort();
}

// QNBS-v3: byte-safe CRLF->LF normalization; a latin1 round-trip preserves every byte value 0-255.
function normalizeLineEndings(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return Buffer.from(buffer.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

// QNBS-v3: shared by both the filesystem and git-ref fingerprint paths so they can never drift.
function hashManifests(entries) {
  const hash = createHash('sha256');
  for (const [relativePath, content] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(`${relativePath}\0`);
    // QNBS-v3: normalizes a core.autocrlf checkout vs. the LF-stored git blob to the same bytes.
    hash.update(normalizeLineEndings(content));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function calculateDependencyFingerprint(root = projectRoot) {
  const entries = dependencyFiles(root).map((file) => [
    relative(root, file).replaceAll('\\', '/'),
    readFileSync(file),
  ]);
  return hashManifests(entries);
}

// QNBS-v3: -z avoids path C-quoting; exported so verify-exact-tree.mjs reuses this, not a second parser.
export function listTreeFiles(sha, cwd) {
  const result = spawnSync('git', ['ls-tree', '-r', '--full-tree', '--name-only', '-z', sha], {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean);
}

// QNBS-v3: diagnostic-only; mirrors dependencyFiles' inclusion rules against a commit, not disk.
export function dependencyFilesFromRef(sha, root = projectRoot, dependencies = {}) {
  const listTree = dependencies.listTree ?? ((ref) => listTreeFiles(ref, root));
  const allPaths = listTree(sha);
  if (allPaths === null) return null;
  const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
  const packagePattern = /^packages\/[^/]+\/package\.json$/;
  return allPaths
    .filter(
      (path) => rootFiles.has(path) || path.startsWith('patches/') || packagePattern.test(path),
    )
    .sort();
}

// QNBS-v3: no encoding -- raw Buffer stdout, matching readFileSync's raw bytes for invalid UTF-8 safety.
function defaultReadFileAtRef(sha, relativePath, cwd) {
  const result = spawnSync('git', ['show', `${sha}:${relativePath}`], {
    cwd,
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

// QNBS-v3: diagnostic-only; reads localSha's committed manifests via git objects, no worktree.
export function calculateDependencyFingerprintFromRef(sha, root = projectRoot, dependencies = {}) {
  const listFiles = dependencies.dependencyFilesFromRef ?? (() => dependencyFilesFromRef(sha, root, dependencies));
  const files = listFiles(sha);
  if (files === null) return null;
  const readContent = dependencies.readFileAtRef ?? ((path) => defaultReadFileAtRef(sha, path, root));
  const entries = [];
  for (const relativePath of files) {
    const content = readContent(relativePath);
    if (content === null) return null;
    entries.push([relativePath, content]);
  }
  return hashManifests(entries);
}

// QNBS-v3: diagnostic-only signal; never throws, so it cannot corrupt canonical evidence validity.
export function computeDependencyState(sha, root = projectRoot, dependencies = {}) {
  try {
    const readStored = dependencies.readStoredFingerprint ?? (() => readStoredFingerprint(root));
    const storedFingerprint = readStored();
    // QNBS-v3: no baseline reconciled yet on this machine -- an honest unknown, not "no comparison".
    if (!storedFingerprint) return 'UNKNOWN';
    const fingerprintFromRef =
      dependencies.calculateDependencyFingerprintFromRef ??
      ((ref) => calculateDependencyFingerprintFromRef(ref, root, dependencies));
    const refFingerprint = fingerprintFromRef(sha);
    if (refFingerprint === null) return 'UNKNOWN';
    return refFingerprint === storedFingerprint ? 'MATCHES' : 'DIVERGED';
  } catch {
    return 'UNKNOWN';
  }
}

export function fingerprintPath(root = projectRoot) {
  return join(root, fingerprintRelativePath);
}

export function readStoredFingerprint(root = projectRoot) {
  const file = fingerprintPath(root);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

export function writeStoredFingerprint(
  root = projectRoot,
  fingerprint = calculateDependencyFingerprint(root),
) {
  const file = fingerprintPath(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(file, `${fingerprint}\n`, 'utf8');
}

export function verifyDependencyState(root = projectRoot) {
  if (!existsSync(join(root, 'node_modules'))) {
    throw new Error('node_modules is missing. Install dependencies before running local hooks.');
  }
  const stored = readStoredFingerprint(root);
  if (!stored) {
    throw new Error(
      'Dependency state has not been reconciled. Run: node scripts/dependency-state.mjs reconcile',
    );
  }
  const current = calculateDependencyFingerprint(root);
  if (stored !== current) {
    throw new Error(
      'Dependency manifests changed since the last reconciliation. Run: node scripts/dependency-state.mjs reconcile',
    );
  }
  return current;
}

function reconcile(root = projectRoot) {
  const nodeModules = join(root, 'node_modules');
  mkdirSync(nodeModules, { recursive: true });
  const lockPath = join(nodeModules, '.worldscript-deps-reconcile.lock');
  let lockHandle;
  try {
    lockHandle = openSync(lockPath, 'wx');
  } catch {
    throw new Error('Another dependency reconciliation is already running; wait for it to finish.');
  }

  try {
    console.log('[deps] Reconciling with pnpm install --frozen-lockfile …');
    const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
    else {
      const fingerprint = calculateDependencyFingerprint(root);
      writeStoredFingerprint(root, fingerprint);
      console.log(
        `[deps] Reconciliation complete; fingerprint ${fingerprint.slice(0, 12)}… stored.`,
      );
    }
  } finally {
    closeSync(lockHandle);
    unlinkSync(lockPath);
  }
}

export function main(command = process.argv[2]) {
  try {
    if (command === 'verify') {
      const fingerprint = verifyDependencyState();
      console.log(`[deps] Dependency fingerprint is valid (${fingerprint.slice(0, 12)}…).`);
    } else if (command === 'reconcile') reconcile();
    else {
      console.error('Usage: node scripts/dependency-state.mjs <verify|reconcile>');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`[deps] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
