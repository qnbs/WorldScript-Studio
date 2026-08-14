#!/usr/bin/env node
/**
 * Sync version from package.json → src-tauri/Cargo.toml, src-tauri/tauri.conf.json,
 * src-tauri/Cargo.lock (the workspace package's own locked entry), and AGENTS.md.
 * QNBS-v3: Prevents version drift between web (package.json) and desktop builds/docs — a stale
 * Cargo.lock entry fails `cargo check --locked` in CI's rust-check gate, and a stale AGENTS.md
 * `Version:` field is agent-facing documentation drift (found by review-loop bots on PR #364).
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
const cargoLockPath = path.join(root, 'src-tauri', 'Cargo.lock');
const agentsPath = path.join(root, 'AGENTS.md');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version || typeof version !== 'string') {
  console.error('[sync-tauri-version] package.json version missing');
  process.exit(1);
}

let changed = false;

function syncFile(filePath, pattern, replacement) {
  const content = fs.readFileSync(filePath, 'utf8');
  const next = content.replace(pattern, replacement);
  if (next !== content) {
    fs.writeFileSync(filePath, next);
    console.log(`[sync-tauri-version] ${filePath} → ${version}`);
    changed = true;
  }
}

// --- Cargo.toml ---
syncFile(cargoPath, /^version = "[^"]+"/m, `version = "${version}"`);

// --- tauri.conf.json ---
syncFile(tauriConfPath, /"version":\s*"[^"]+"/, `"version": "${version}"`);

// --- Cargo.lock (the workspace package's own locked entry, not registry deps) ---
syncFile(cargoLockPath, /(name = "worldscript-studio"\nversion = )"[^"]+"/, `$1"${version}"`);

// --- AGENTS.md ---
syncFile(agentsPath, /(\*\*Version:\*\* `)[^`]+(`)/, `$1${version}$2`);

if (!changed) {
  console.log('[sync-tauri-version] Already in sync.');
}
