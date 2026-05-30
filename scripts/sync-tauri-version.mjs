#!/usr/bin/env node
/**
 * Sync Tauri version from package.json → src-tauri/Cargo.toml + src-tauri/tauri.conf.json
 * QNBS-v3: Prevents version drift between web (package.json) and desktop builds.
 * Run via predev / prebuild hooks or manually:
 *   node scripts/sync-tauri-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const pkgPath = path.join(root, 'package.json');
const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version || typeof version !== 'string') {
  console.error('[sync-tauri-version] package.json version missing');
  process.exit(1);
}

let changed = false;

// --- Cargo.toml ---
const cargo = fs.readFileSync(cargoPath, 'utf8');
const cargoRe = /^version = "[^"]+"/m;
const cargoNew = cargo.replace(cargoRe, `version = "${version}"`);
if (cargoNew !== cargo) {
  fs.writeFileSync(cargoPath, cargoNew);
  console.log(`[sync-tauri-version] ${cargoPath} → ${version}`);
  changed = true;
}

// --- tauri.conf.json ---
const tauriConf = fs.readFileSync(tauriConfPath, 'utf8');
const tauriRe = /"version":\s*"[^"]+"/;
const tauriNew = tauriConf.replace(tauriRe, `"version": "${version}"`);
if (tauriNew !== tauriConf) {
  fs.writeFileSync(tauriConfPath, tauriNew);
  console.log(`[sync-tauri-version] ${tauriConfPath} → ${version}`);
  changed = true;
}

if (!changed) {
  console.log('[sync-tauri-version] Already in sync.');
}
