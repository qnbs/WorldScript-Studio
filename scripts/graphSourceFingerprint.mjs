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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Generated graph output — never part of the fingerprint (reports must never self-reference). */
const EXCLUDED_PREFIXES = ['graphify-out/', '.codegraph/'];

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

/**
 * Deterministic SHA-256 over sorted `sha256(content):path` lines for the current on-disk bytes
 * of every source path. Never hashes commit metadata, branch name, or wall-clock time.
 * @param {string} cwd
 */
export function computeSourceFingerprint(cwd = ROOT) {
  const paths = listSourcePaths(cwd);
  const lines = paths.map((relPath) => {
    const bytes = readFileSync(join(cwd, relPath));
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    return `${contentHash}:${relPath}`;
  });
  const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
  return `sha256:${digest}`;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const { clean, dirtyPaths } = checkCleanState();
  console.log(`Source fingerprint: ${computeSourceFingerprint()}`);
  console.log(clean ? 'Clean state: YES' : `Clean state: NO (dirty: ${dirtyPaths.join(', ')})`);
}
