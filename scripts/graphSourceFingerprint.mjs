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
import { lstatSync, readFileSync } from 'node:fs';
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

/** @param {string} cwd @returns {string[]} sorted, deduplicated repo-relative paths: tracked ∪ untracked-not-ignored. */
export function listSourcePaths(cwd = ROOT) {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--exclude-standard'], {
    cwd,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter(Boolean);
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter(Boolean);
  const all = new Set([...tracked, ...untracked]);
  return [...all].filter((p) => !isExcluded(p)).sort();
}

function listTrackedPaths(cwd) {
  return execFileSync('git', ['ls-files', '--cached', '--exclude-standard', '-z'], {
    cwd,
    encoding: 'buffer',
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function enumerateSourcePaths(cwd) {
  return { paths: listSourcePaths(cwd), tracked: new Set(listTrackedPaths(cwd)) };
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

function fileSignature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.mode}`;
}

function readSnapshot(cwd, enumeration) {
  const lines = [];
  for (const relPath of enumeration.paths) {
    const absolutePath = join(cwd, relPath);
    let before;
    try {
      before = lstatSync(absolutePath);
    } catch (error) {
      if (error?.code === 'ENOENT' && enumeration.tracked.has(relPath)) {
        lines.push(`${hashDeletion(relPath)}:${relPath}`);
        continue;
      }
      throw new Error(`source path disappeared during fingerprinting: ${relPath}`);
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
    lines.push(`${hashBytes(bytes)}:${relPath}`);
  }
  return lines;
}

/**
 * Deterministic SHA-256 over sorted `sha256(content):path` lines for the current on-disk bytes
 * of every source path. Never hashes commit metadata, branch name, or wall-clock time.
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

/**
 * Git status restricted to relevant (non-excluded) source paths, for the clean-state gate that
 * `graphs:report` requires before writing a committed report.
 * @param {string} cwd
 * @returns {{clean: boolean, dirtyPaths: string[]}}
 */
export function checkCleanState(cwd = ROOT) {
  const statusOutput = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf-8',
  });
  const dirtyPaths = statusOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((relPath) => !isExcluded(relPath));
  return { clean: dirtyPaths.length === 0, dirtyPaths };
}

/** Standard metadata block embedded in both committed reports — no timestamp, no commit SHA. */
export function buildMetadataBlock({
  tool,
  toolVersion,
  generationMode,
  reportSchemaVersion,
  cwd = ROOT,
}) {
  const fingerprint = computeSourceFingerprint(cwd);
  return [
    `Report schema: ${reportSchemaVersion}`,
    `Source fingerprint: ${fingerprint}`,
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
