#!/usr/bin/env node
/**
 * Bundle-budget gate (audit finding F-8 — single source of truth).
 *
 * Differentiated ceilings, measured on RAW (uncompressed) per-file KB under dist/assets:
 *   --max-entry-kb (default 2500): the `index-*` entry chunk.
 *   --max-vendor-kb (default 6200): vendor JS, including local-AI runtime bundles.
 *   --max-chunk-kb (default 2500): other JS chunks.
 *   --max-wasm-kb (default 30000): individual WASM modules.
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
let maxEntryKb = 2500;
let maxVendorKb = 6200;
let maxChunkKb = 2500;
let maxWasmKb = 30000;
function parseThreshold(flag, rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim() === '' || rawValue.startsWith('--')) {
    console.error(`[bundle:budget] ${flag} requires a non-negative finite number.`);
    process.exit(1);
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`[bundle:budget] ${flag} requires a non-negative finite number.`);
    process.exit(1);
  }
  return value;
}
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--max-entry-kb') {
    maxEntryKb = parseThreshold(argv[i], argv[i + 1]);
    i++;
  }
  if (argv[i] === '--max-vendor-kb') {
    maxVendorKb = parseThreshold(argv[i], argv[i + 1]);
    i++;
  }
  if (argv[i] === '--max-chunk-kb') {
    maxChunkKb = parseThreshold(argv[i], argv[i + 1]);
    i++;
  }
  if (argv[i] === '--max-wasm-kb') {
    maxWasmKb = parseThreshold(argv[i], argv[i + 1]);
    i++;
  }
}

if (!fs.existsSync(assetsDir)) {
  console.warn('[bundle:budget] dist/assets not found — skipping (run build first).');
  process.exit(0);
}

const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js') || f.endsWith('.wasm'));
let failed = false;
for (const f of files) {
  const full = path.join(assetsDir, f);
  const kb = fs.statSync(full).size / 1024;
  if (f.endsWith('.wasm') && kb > maxWasmKb) {
    console.error(
      `[bundle:budget] WASM module exceeds ${maxWasmKb} KB: ${f} (${kb.toFixed(1)} KB)`,
    );
    failed = true;
  } else if (f.startsWith('index-') && kb > maxEntryKb) {
    console.error(
      `[bundle:budget] Entry chunk exceeds ${maxEntryKb} KB: ${f} (${kb.toFixed(1)} KB)`,
    );
    failed = true;
  } else if (f.startsWith('vendor-') || f.includes('-vendor')) {
    if (kb > maxVendorKb) {
      console.error(
        `[bundle:budget] Vendor chunk exceeds ${maxVendorKb} KB: ${f} (${kb.toFixed(1)} KB)`,
      );
      failed = true;
    }
  } else if (f.endsWith('.js') && kb > maxChunkKb) {
    console.error(`[bundle:budget] JS chunk exceeds ${maxChunkKb} KB: ${f} (${kb.toFixed(1)} KB)`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`[bundle:budget] OK — ${files.length} JS/WASM assets within differentiated limits.`);
