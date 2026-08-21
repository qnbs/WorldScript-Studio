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

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
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

export function calculateDependencyFingerprint(root = projectRoot) {
  const hash = createHash('sha256');
  for (const file of dependencyFiles(root)) {
    hash.update(`${relative(root, file).replaceAll('\\', '/')}\0`);
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
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
