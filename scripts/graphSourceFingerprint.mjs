#!/usr/bin/env node
/**
 * Worktree-aware, deterministic content fingerprint for the dual-graph tooling.
 *
 * Freshness must never be keyed on a git commit SHA: a squash merge changes the SHA on
 * content-equivalent code (PR_HEAD_SHA != SQUASH_MERGE_SHA), and a `git ls-tree <ref>` based
 * fingerprint only sees committed blobs, missing real, not-yet-committed working-tree edits.
 * This module hashes the *current on-disk bytes* of every tracked-or-untracked-but-not-ignored
 * source path (excluding generated graph output), so it reflects genuine current state.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Generated graph output — never part of the fingerprint (reports must never self-reference). */
const EXCLUDED_PREFIXES = ['graphify-out/', '.codegraph/'];
// QNBS-v3: bounded retries make freshness fail closed instead of hashing a moving source tree.
const SNAPSHOT_ATTEMPTS = 3;

function isExcluded(relPath) {
  return EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function parseNulRecords(output) {
  return output
    .toString('utf8')
    .split('\0')
    .filter((record) => record.length > 0);
}

/** @param {string} output @param {string} expectedVersion */
export function matchesExactVersion(output, expectedVersion) {
  const escaped = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^0-9])${escaped}(?![0-9A-Za-z.-])`).test(output);
}

/** @param {string} cwd @returns {string[]} sorted, deduplicated repo-relative paths: tracked ∪ untracked-not-ignored. */
export function listSourcePaths(cwd = ROOT) {
  const tracked = parseNulRecords(
    execFileSync('git', ['ls-files', '--cached', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  );
  const untracked = parseNulRecords(
    execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  );
  const all = new Set([...tracked, ...untracked]);
  return [...all].filter((p) => !isExcluded(p)).sort();
}

function listTrackedEntries(cwd) {
  const entries = new Map();
  for (const record of parseNulRecords(
    execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  )) {
    const separator = record.indexOf('\t');
    if (separator < 0) throw new Error('git ls-files returned an invalid staged path record');
    const metadata = record.slice(0, separator).split(' ');
    const mode = metadata[0];
    const relPath = record.slice(separator + 1);
    if (!/^(?:100\d{3}|120000|160000)$/.test(mode)) {
      throw new Error(`invalid tracked file mode ${mode} for ${relPath}`);
    }
    entries.set(relPath, mode);
  }
  return entries;
}

function enumerateSourcePaths(cwd) {
  const trackedEntries = listTrackedEntries(cwd);
  return {
    paths: listSourcePaths(cwd).filter((relPath) => trackedEntries.get(relPath) !== '160000'),
    tracked: new Set(trackedEntries.keys()),
    modes: trackedEntries,
  };
}

function isText(bytes) {
  if (bytes.includes(0)) return false;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const encoded = new TextEncoder().encode(text);
    return (
      encoded.length === bytes.length && encoded.every((value, index) => value === bytes[index])
    );
  } catch {
    return false;
  }
}

function hashBytes(bytes) {
  const content = isText(bytes)
    ? Buffer.from(new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n'), 'utf8')
    : bytes;
  return createHash('sha256').update(content).digest('hex');
}

function hashDeletion(relPath) {
  return createHash('sha256').update(`deleted:${relPath}`).digest('hex');
}

function hashSymlink(target) {
  return createHash('sha256').update(`symlink:${target}`).digest('hex');
}

function fileSignature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function readSnapshot(cwd, enumeration) {
  const lines = [];
  for (const relPath of enumeration.paths) {
    const absolutePath = join(cwd, relPath);
    const mode = enumeration.modes.get(relPath) ?? '100644';
    let before;
    try {
      before = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && enumeration.tracked.has(relPath)) {
        lines.push(`${mode}:${hashDeletion(relPath)}:${relPath}`);
        continue;
      }
      throw new Error(`source path disappeared during fingerprinting: ${relPath}`);
    }
    if (before.isSymbolicLink()) {
      const target = readlinkSync(absolutePath, 'utf8');
      let after;
      try {
        after = lstatSync(absolutePath);
      } catch {
        throw new Error(`source path disappeared after reading symlink: ${relPath}`);
      }
      if (fileSignature(before) !== fileSignature(after)) {
        throw new Error(`source symlink changed while being fingerprinted: ${relPath}`);
      }
      lines.push(`${mode}:${hashSymlink(target)}:${relPath}`);
      continue;
    }
    if (!before.isFile()) throw new Error(`source path is not a regular file: ${relPath}`);
    let bytes;
    try {
      bytes = readFileSync(absolutePath);
    } catch (error) {
      throw new Error(
        `failed to read ${relPath} during fingerprinting: ${error?.message ?? String(error)}`,
      );
    }
    let after;
    try {
      after = lstatSync(absolutePath);
    } catch {
      throw new Error(`source path disappeared after reading: ${relPath}`);
    }
    if (fileSignature(before) !== fileSignature(after)) {
      throw new Error(`source path changed while being fingerprinted: ${relPath}`);
    }
    lines.push(`${mode}:${hashBytes(bytes)}:${relPath}`);
  }
  return lines;
}

/**
 * Deterministic SHA-256 over sorted `mode:sha256(content):path` lines for the current source.
 * Git-normalized modes capture executable-bit semantics without hashing platform stat bits.
 * @param {string} cwd
 */
export function computeSourceFingerprint(cwd = ROOT) {
  let lastError;
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    try {
      const firstEnumeration = enumerateSourcePaths(cwd);
      const first = readSnapshot(cwd, firstEnumeration);
      const secondEnumeration = enumerateSourcePaths(cwd);
      if (firstEnumeration.paths.join('\0') !== secondEnumeration.paths.join('\0')) {
        throw new Error('source path set changed while fingerprinting');
      }
      const second = readSnapshot(cwd, secondEnumeration);
      if (first.join('\n') !== second.join('\n')) {
        throw new Error('source content changed while fingerprinting');
      }
      const digest = createHash('sha256').update(second.join('\n')).digest('hex');
      return `sha256:${digest}`;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `[graphSourceFingerprint] UNSTABLE_SOURCE — could not capture a stable source snapshot after ${SNAPSHOT_ATTEMPTS} attempts: ${lastError?.message ?? String(lastError)}`,
  );
}

function parsePorcelainZ(output) {
  const records = parseNulRecords(output);
  const mutations = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) throw new Error('git status returned an invalid porcelain record');
    const status = record.slice(0, 2);
    const paths = [record.slice(3)];
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      const related = records[++index];
      if (related == null)
        throw new Error('git status rename/copy record is missing its peer path');
      paths.push(related);
    }
    mutations.push(paths);
  }
  return mutations;
}

/**
 * Git status restricted to relevant source paths; NUL records preserve exact rename endpoints.
 * @param {string} cwd
 * @returns {{clean: boolean, dirtyPaths: string[]}}
 */
export function checkCleanState(cwd = ROOT) {
  const statusOutput = execFileSync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd, encoding: 'buffer' },
  );
  const dirtyPaths = [
    ...new Set(
      parsePorcelainZ(statusOutput)
        .filter((paths) => paths.some((relPath) => !isExcluded(relPath)))
        .flat(),
    ),
  ];
  return { clean: dirtyPaths.length === 0, dirtyPaths };
}

/** Standard metadata block embedded in both committed reports — no timestamp, no commit SHA. */
export function buildMetadataBlock({
  tool,
  toolVersion,
  generationMode,
  reportSchemaVersion,
  cwd = ROOT,
  fingerprint,
}) {
  const validatedFingerprint = fingerprint ?? computeSourceFingerprint(cwd);
  return [
    `Report schema: ${reportSchemaVersion}`,
    `Source fingerprint: ${validatedFingerprint}`,
    `Tool: ${tool}`,
    `Tool version: ${toolVersion}`,
    `Generation mode: ${generationMode}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { clean, dirtyPaths } = checkCleanState();
  console.log(`Source fingerprint: ${computeSourceFingerprint()}`);
  console.log(clean ? 'Clean state: YES' : `Clean state: NO (dirty: ${dirtyPaths.join(', ')})`);
}
