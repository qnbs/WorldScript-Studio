#!/usr/bin/env node
/**
 * Bundle-budget gate (audit finding F-8 — single source of truth).
 *
 * Differentiated ceilings are measured on RAW (uncompressed) per-file KB under dist/assets and
 * loaded from config/bundle-budget.json. The CLI flags remain diagnostic overrides; the package
 * gate and current documentation use the checked-in configuration as their authority.
 * Run after `pnpm run build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'dist', 'assets');
const budgetConfigPath = path.join(root, 'config', 'bundle-budget.json');

function readBudgetConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(budgetConfigPath, 'utf8'));
    for (const key of ['entryKb', 'vendorKb', 'chunkKb', 'wasmKb']) {
      if (!Number.isFinite(config[key]) || config[key] < 0) {
        throw new Error(`${key} must be a non-negative finite number`);
      }
    }
    return config;
  } catch (error) {
    console.error(
      `[bundle:budget] Invalid ${path.relative(root, budgetConfigPath)}: ${error.message}`,
    );
    process.exit(1);
  }
}

const argv = process.argv.slice(2);
const configuredBudget = readBudgetConfig();
let maxEntryKb = configuredBudget.entryKb;
let maxVendorKb = configuredBudget.vendorKb;
let maxChunkKb = configuredBudget.chunkKb;
let maxWasmKb = configuredBudget.wasmKb;
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
