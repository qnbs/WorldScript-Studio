#!/usr/bin/env node
/**
 * Bundle-budget gate (audit finding F-8 — single source of truth).
 *
 * Two independent ceilings, both measured on RAW (uncompressed) per-file KB under dist/assets:
 *   --max-kb       (default 6500): any NON-entry JS chunk (`lib-*`, vendor, lazy views).
 *   --max-entry-kb (default 4000): the `index-*` entry chunk only.
 *
 * The package.json `bundle:budget` script passes these same values explicitly — defaults and
 * invocation are kept in lockstep so there is ONE budget, not two. Do not diverge them.
 *
 * Headroom at 2026-06-09 (main CI build, run 27241741348):
 *   - entry `index-*.js` ≈ 496 KB  → ~3 500 KB under the 4000 ceiling (entry is small; the ceiling
 *     is generous on purpose — local-AI views are lazy-loaded, not in the entry).
 *   - largest chunk `lib-*.js` ≈ 6 054 KB → ~446 KB under the 6500 ceiling. This vendor bundle
 *     (@mlc-ai/web-llm + onnxruntime-web + transformers) is the real constraint; the 6500 ceiling
 *     catches an accidental >446 KB regression there while still passing today.
 * Run after `pnpm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'dist', 'assets');

const argv = process.argv.slice(2);
let maxKb = 6500;
let maxEntryKb = 4000;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--max-kb' && argv[i + 1]) {
    maxKb = Number(argv[i + 1]);
    i++;
  }
  if (argv[i] === '--max-entry-kb' && argv[i + 1]) {
    maxEntryKb = Number(argv[i + 1]);
    i++;
  }
}

if (!fs.existsSync(assetsDir)) {
  console.warn('[bundle:budget] dist/assets not found — skipping (run build first).');
  process.exit(0);
}

const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
let failed = false;
for (const f of files) {
  const full = path.join(assetsDir, f);
  const kb = fs.statSync(full).size / 1024;
  // QNBS-v3: Only index-* is the real entry point; lib-* are vendor chunks checked against maxKb
  if (f.startsWith('index-') && kb > maxEntryKb) {
    console.error(
      `[bundle:budget] Entry chunk exceeds ${maxEntryKb} KB: ${f} (${kb.toFixed(1)} KB)`,
    );
    failed = true;
  } else if (kb > maxKb) {
    console.error(`[bundle:budget] Chunk exceeds ${maxKb} KB: ${f} (${kb.toFixed(1)} KB)`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`[bundle:budget] OK — ${files.length} JS chunks ≤ ${maxKb} KB.`);
