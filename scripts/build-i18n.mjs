#!/usr/bin/env node
/**
 * Build-time i18n bundler
 *
 * Merges all 14 per-module JSON files for each language into a single
 * `bundle.json` written to `public/locales/<lang>/bundle.json`.
 *
 * This reduces the boot-time fetch count from 70 (5 langs × 14 modules)
 * to at most 2 (active language + EN fallback).
 *
 * Run automatically via the `prebuild` npm hook, or manually:
 *   node scripts/build-i18n.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const langs = ['en', 'de', 'fr', 'es', 'it'];
const modules = [
  'common',
  'tour',
  'sidebar',
  'portal',
  'dashboard',
  'manuscript',
  'writer',
  'templates',
  'tags',
  'outline',
  'characters',
  'worlds',
  'export',
  'settings',
  'help',
];

let totalKeys = 0;

for (const lang of langs) {
  const bundle = {};

  for (const mod of modules) {
    const srcPath = join(root, 'locales', lang, `${mod}.json`);
    if (!existsSync(srcPath)) {
      console.warn(`[build-i18n] Missing: locales/${lang}/${mod}.json — skipping`);
      continue;
    }
    const data = JSON.parse(readFileSync(srcPath, 'utf8'));
    Object.assign(bundle, data);
  }

  const outDir = join(root, 'public', 'locales', lang);
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, 'bundle.json');
  writeFileSync(outPath, JSON.stringify(bundle), 'utf8');

  const keys = Object.keys(bundle).length;
  totalKeys += keys;
  console.log(`[build-i18n] ${lang}: ${keys} keys → public/locales/${lang}/bundle.json`);
}

console.log(`[build-i18n] Done. ${totalKeys} total keys across ${langs.length} bundles.`);
