#!/usr/bin/env node
/**
 * Keeps `public/sw.js` APP_VERSION in sync with root package.json (single source of truth).
 * Run via predev/prebuild — idempotent if already aligned.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
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
