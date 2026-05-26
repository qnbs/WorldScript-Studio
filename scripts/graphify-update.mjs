#!/usr/bin/env node
/**
 * Solo-repo Graphify update: refresh graphify-out in place, no committed history artifacts.
 * - Regenerates graph.json / graph.html locally (gitignored)
 * - Keeps GRAPH_REPORT.md as the only committed agent-facing snapshot
 * See docs/graphify.md and docs/REPO-HOUSEKEEPING.md
 *
 * Heavy (~3k nodes). Skip with GRAPHIFY_SKIP=1. Low-end: close other apps first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.GRAPHIFY_SKIP === '1') {
  console.log('[graphify-update] Skipped (GRAPHIFY_SKIP=1).');
  process.exit(0);
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const outDir = join(root, 'graphify-out');

/** Ephemeral graphify outputs — never commit (solo policy). */
const EPHEMERAL = ['manifest.json', 'cost.json', 'transcripts', 'wiki', 'obsidian'];

for (const name of EPHEMERAL) {
  const p = join(outDir, name);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

const cli = join(root, 'scripts', 'graphify-cli.mjs');
const result = spawnSync(process.execPath, [cli, 'update', '.'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  '[graphify-update] Done. Local: graphify-out/graph.json + graph.html (gitignored). Commit only GRAPH_REPORT.md after review.',
);
