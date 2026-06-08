#!/usr/bin/env node
/**
 * Fail CI if any emitted JS chunk under dist/assets exceeds --max-kb (default 7000),
 * and if the main entry chunk exceeds --max-entry-kb (default 4500).
 * Local ML stacks (@mlc-ai/web-llm, onnxruntime-web, @xenova/transformers) routinely emit multi‑MB
 * vendor chunks; keep this ceiling above that bundle while still catching accidental regressions.
 * Run after `pnpm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'dist', 'assets');

const argv = process.argv.slice(2);
let maxKb = 7000;
let maxEntryKb = 4500;
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
