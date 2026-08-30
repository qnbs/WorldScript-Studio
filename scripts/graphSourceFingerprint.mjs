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

/** Generated graph output and linked worktrees — never part of the fingerprint. */
const EXCLUDED_PREFIXES = ['graphify-out/', '.codegraph/', '.worktrees/'];
// QNBS-v3: bounded retries make freshness fail closed instead of hashing a moving source tree.
const SNAPSHOT_ATTEMPTS = 3;

function isExcluded(relPath) {
  const comparable = Buffer.isBuffer(relPath) ? relPath.toString('utf8') : relPath;
  return EXCLUDED_PREFIXES.some((prefix) => comparable.startsWith(prefix));
}

function parseNulRecords(output) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output);
  const records = [];
  let start = 0;
  for (let end = 0; end <= bytes.length; end += 1) {
    if (end !== bytes.length && bytes[end] !== 0) continue;
    if (end > start) records.push(bytes.subarray(start, end));
    start = end + 1;
  }
  return records;
}

function decodeGitPath(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // QNBS-v3: retain undecodable Git pathname bytes so filesystem lookup cannot turn them into a deletion.
    return Buffer.from(bytes);
  }
}

function pathBytes(relPath) {
  return Buffer.isBuffer(relPath) ? relPath : Buffer.from(relPath, 'utf8');
}

function pathIdentity(relPath) {
  return pathBytes(relPath).toString('hex');
}

function pathLabel(relPath) {
  return Buffer.isBuffer(relPath) ? `path bytes 0x${relPath.toString('hex')}` : relPath;
}

function pathForFingerprint(relPath) {
  const bytes = pathBytes(relPath);
  // QNBS-v3: length-prefix raw path bytes so newline and delimiter bytes cannot collide.
  return `${bytes.length}:${bytes.toString('hex')}`;
}

function compareGitPaths(left, right) {
  return Buffer.compare(pathBytes(left), pathBytes(right));
}

function absolutePathFor(cwd, relPath) {
  return Buffer.isBuffer(relPath)
    ? Buffer.concat([Buffer.from(`${cwd}/`), relPath])
    : join(cwd, relPath);
}

function listSparsePaths(cwd) {
  return parseNulRecords(
    execFileSync('git', ['ls-files', '-v', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  )
    .filter((record) => record.subarray(0, 2).toString('ascii') === 'S ')
    .map((record) => decodeGitPath(record.subarray(2)));
}

function listAssumeUnchangedPaths(cwd) {
  return parseNulRecords(
    execFileSync('git', ['ls-files', '-v', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  )
    .filter((record) => record.length > 1 && record[0] >= 0x61 && record[0] <= 0x7a)
    .map((record) => decodeGitPath(record.subarray(2)));
}

/** @param {string} output @param {string} expectedVersion */
export function matchesExactVersion(output, expectedVersion) {
  // QNBS-v3: compare the first declared CLI line so later warnings cannot satisfy a version pin.
  const declared = String(output).trimStart().split(/\r?\n/, 1)[0].trim();
  return declared === expectedVersion || declared === `graphify ${expectedVersion}`;
}

/** @param {string} cwd @returns {string[]} sorted, deduplicated repo-relative paths: tracked ∪ untracked-not-ignored. */
export function listSourcePaths(cwd = ROOT) {
  const tracked = parseNulRecords(
    execFileSync('git', ['ls-files', '--cached', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  ).map(decodeGitPath);
  const untracked = parseNulRecords(
    execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  ).map(decodeGitPath);
  const all = new Map();
  for (const path of [...tracked, ...untracked]) all.set(pathIdentity(path), path);
  return [...all.values()].filter((p) => !isExcluded(p)).sort(compareGitPaths);
}

function listTrackedEntries(cwd) {
  const entries = new Map();
  for (const record of parseNulRecords(
    execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd,
      encoding: 'buffer',
    }),
  )) {
    const separator = record.indexOf(9);
    if (separator < 0) throw new Error('git ls-files returned an invalid staged path record');
    const metadata = record.subarray(0, separator).toString('ascii').split(' ');
    const mode = metadata[0];
    const objectId = metadata[1];
    const relPath = decodeGitPath(record.subarray(separator + 1));
    if (!/^(?:100\d{3}|120000|160000)$/.test(mode)) {
      throw new Error(`invalid tracked file mode ${mode} for ${pathLabel(relPath)}`);
    }
    if (!/^[0-9a-f]+$/.test(objectId ?? '')) {
      throw new Error(`invalid tracked object id for ${pathLabel(relPath)}`);
    }
    entries.set(pathIdentity(relPath), { mode, objectId });
  }
  return entries;
}

function enumerateSourcePaths(cwd) {
  const sparsePaths = listSparsePaths(cwd).filter((relPath) => !isExcluded(relPath));
  const assumeUnchangedPaths = listAssumeUnchangedPaths(cwd).filter(
    (relPath) => !isExcluded(relPath),
  );
  if (sparsePaths.length > 0) {
    throw new Error(
      `SPARSE_CHECKOUT_UNSUPPORTED — tracked source paths are absent from this checkout: ${sparsePaths.map(pathLabel).join(', ')}`,
    );
  }
  if (assumeUnchangedPaths.length > 0) {
    throw new Error(
      `SOURCE_INDEX_FLAGS_UNSUPPORTED — tracked source paths have hidden worktree state: ${assumeUnchangedPaths.map(pathLabel).join(', ')}`,
    );
  }
  const trackedEntries = listTrackedEntries(cwd);
  return {
    paths: listSourcePaths(cwd),
    tracked: new Set(trackedEntries.keys()),
    entries: trackedEntries,
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
  return createHash('sha256').update('deleted:').update(pathBytes(relPath)).digest('hex');
}

function hashSymlink(target) {
  // QNBS-v3: raw symlink target bytes preserve source identity for non-UTF-8 link targets.
  return createHash('sha256').update('symlink:').update(pathBytes(target)).digest('hex');
}

function hashGitlink(objectId) {
  return createHash('sha256').update(`gitlink:${objectId}`).digest('hex');
}

function fileSignature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

function readSnapshot(cwd, enumeration) {
  const lines = [];
  for (const relPath of enumeration.paths) {
    const absolutePath = absolutePathFor(cwd, relPath);
    const label = pathLabel(relPath);
    const entry = enumeration.entries.get(pathIdentity(relPath)) ?? {
      mode: '100644',
      objectId: null,
    };
    const mode = entry.mode;
    if (mode === '160000') {
      // QNBS-v3: hash the Gitlink object identity without depending on a submodule worktree.
      lines.push(`${mode}:${hashGitlink(entry.objectId)}:${pathForFingerprint(relPath)}`);
      continue;
    }
    let before;
    try {
      before = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && enumeration.tracked.has(pathIdentity(relPath))) {
        lines.push(`${mode}:${hashDeletion(relPath)}:${pathForFingerprint(relPath)}`);
        continue;
      }
      throw new Error(`source path disappeared during fingerprinting: ${label}`);
    }
    if (before.isSymbolicLink()) {
      // QNBS-v3: hash the link target itself so symlink identity is portable and target-sensitive.
      const target = readlinkSync(absolutePath, { encoding: 'buffer' });
      let after;
      try {
        after = lstatSync(absolutePath);
      } catch {
        throw new Error(`source path disappeared after reading symlink: ${label}`);
      }
      if (fileSignature(before) !== fileSignature(after)) {
        throw new Error(`source symlink changed while being fingerprinted: ${label}`);
      }
      lines.push(`${mode}:${hashSymlink(target)}:${pathForFingerprint(relPath)}`);
      continue;
    }
    if (mode === '120000') {
      let target;
      try {
        target = readFileSync(absolutePath);
      } catch (error) {
        throw new Error(
          `failed to read materialized symlink ${label} during fingerprinting: ${error?.message ?? String(error)}`,
        );
      }
      let after;
      try {
        after = lstatSync(absolutePath);
      } catch {
        throw new Error(`source path disappeared after reading materialized symlink: ${label}`);
      }
      if (fileSignature(before) !== fileSignature(after)) {
        throw new Error(`materialized symlink changed while being fingerprinted: ${label}`);
      }
      // QNBS-v3: core.symlinks=false materializes mode-120000 links as target text.
      lines.push(`${mode}:${hashSymlink(target)}:${pathForFingerprint(relPath)}`);
      continue;
    }
    if (!before.isFile()) throw new Error(`source path is not a regular file: ${label}`);
    let bytes;
    try {
      bytes = readFileSync(absolutePath);
    } catch (error) {
      throw new Error(
        `failed to read ${label} during fingerprinting: ${error?.message ?? String(error)}`,
      );
    }
    let after;
    try {
      after = lstatSync(absolutePath);
    } catch {
      throw new Error(`source path disappeared after reading: ${label}`);
    }
    if (fileSignature(before) !== fileSignature(after)) {
      throw new Error(`source path changed while being fingerprinted: ${label}`);
    }
    lines.push(`${mode}:${hashBytes(bytes)}:${pathForFingerprint(relPath)}`);
  }
  return lines;
}

/**
 * Deterministic SHA-256 over sorted `mode:sha256(content):path` lines for the current source.
 * Git-normalized modes capture executable-bit semantics without hashing platform stat bits.
 * @param {string} cwd
 */
export function computeSourceFingerprint(cwd = ROOT) {
  // QNBS-v3: compare two bounded snapshots so reports never combine evidence from moving inputs.
  let lastError;
  for (let attempt = 1; attempt <= SNAPSHOT_ATTEMPTS; attempt += 1) {
    try {
      const firstEnumeration = enumerateSourcePaths(cwd);
      const first = readSnapshot(cwd, firstEnumeration);
      const secondEnumeration = enumerateSourcePaths(cwd);
      if (
        firstEnumeration.paths.length !== secondEnumeration.paths.length ||
        firstEnumeration.paths.some(
          (path, index) => pathIdentity(path) !== pathIdentity(secondEnumeration.paths[index]),
        )
      ) {
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
    const status = record.subarray(0, 2).toString('ascii');
    const paths = [decodeGitPath(record.subarray(3))];
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') {
      const related = records[++index];
      if (related == null)
        throw new Error('git status rename/copy record is missing its peer path');
      paths.push(decodeGitPath(related));
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
        .flat()
        .map(pathLabel),
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
