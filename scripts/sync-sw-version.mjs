#!/usr/bin/env node
/**
 * Keeps `public/sw.js` APP_VERSION and `src-tauri/tauri.conf.json` version in sync
 * with root package.json (single source of truth). Run via predev/prebuild —
 * idempotent if already aligned.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

// QNBS-v3: sync service-worker APP_VERSION so PWA cache busts on every release.
const swPath = join(root, 'public', 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const next = sw.replace(
  /const APP_VERSION\s*=\s*'[^']*'\s*;/,
  `const APP_VERSION   = '${version}';`,
);
if (next !== sw) {
  writeFileSync(swPath, next);
  process.stdout.write(`[sync-sw-version] public/sw.js → APP_VERSION = ${version}\n`);
}

// QNBS-v3: keep Tauri bundle version aligned with package.json — drift shipped wrong
// desktop version metadata (1.17.0 vs 1.19.0). Same idempotent auto-fix as sw.js.
const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
const tauriConf = readFileSync(tauriConfPath, 'utf8');
const nextTauri = tauriConf.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
if (nextTauri !== tauriConf) {
  writeFileSync(tauriConfPath, nextTauri);
  process.stdout.write(`[sync-sw-version] src-tauri/tauri.conf.json → version = ${version}\n`);
}
