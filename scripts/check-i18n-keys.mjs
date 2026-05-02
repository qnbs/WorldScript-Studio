#!/usr/bin/env node
/**
 * Fails if locale modules do not share the exact same key set as the reference locale (default: en).
 * Run: node scripts/check-i18n-keys.mjs
 * Optional: node scripts/check-i18n-keys.mjs --fix   (fill missing keys from reference into other langs)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

const LANGS = ['en', 'de', 'fr', 'es', 'it'];
const MODULES = [
  'common',
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

const REF = 'en';

function loadBundleKeys(lang) {
  const keys = new Set();
  for (const mod of MODULES) {
    const p = join(root, 'locales', lang, `${mod}.json`);
    if (!existsSync(p)) {
      throw new Error(`Missing file: locales/${lang}/${mod}.json`);
    }
    const data = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of Object.keys(data)) keys.add(k);
  }
  return keys;
}

function loadModuleData(lang) {
  const byMod = {};
  for (const mod of MODULES) {
    const p = join(root, 'locales', lang, `${mod}.json`);
    byMod[mod] = JSON.parse(readFileSync(p, 'utf8'));
  }
  return byMod;
}

function writeModuleData(lang, byMod) {
  for (const mod of MODULES) {
    const p = join(root, 'locales', lang, `${mod}.json`);
    const obj = byMod[mod];
    const sorted = Object.keys(obj)
      .sort()
      .reduce((acc, k) => {
        acc[k] = obj[k];
        return acc;
      }, {});
    writeFileSync(p, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  }
}

function buildKeyModuleMap() {
  const map = new Map();
  for (const mod of MODULES) {
    const p = join(root, 'locales', REF, `${mod}.json`);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of Object.keys(j)) map.set(k, mod);
  }
  return map;
}

const fix = process.argv.includes('--fix');

const refSet = loadBundleKeys(REF);
const keyModule = buildKeyModuleMap();
const refData = loadModuleData(REF);

const report = [];

for (const lang of LANGS) {
  if (lang === REF) continue;
  const s = loadBundleKeys(lang);
  const missing = [...refSet].filter((k) => !s.has(k));
  const extra = [...s].filter((k) => !refSet.has(k));
  if (missing.length) {
    report.push({ lang, type: 'missing', keys: missing });
  }
  if (extra.length) {
    report.push({ lang, type: 'extra', keys: extra });
  }
}

if (fix) {
  for (const lang of LANGS) {
    if (lang === REF) continue;
    const s = loadBundleKeys(lang);
    const missing = [...refSet].filter((k) => !s.has(k));
    const extra = [...s].filter((k) => !refSet.has(k));
    if (missing.length === 0 && extra.length === 0) continue;

    const byMod = loadModuleData(lang);
    for (const k of refSet) {
      const mod = keyModule.get(k);
      if (!mod) {
        console.error(`[i18n] Internal: no module for key "${k}"`);
        process.exit(1);
      }
      if (byMod[mod][k] === undefined) {
        byMod[mod][k] = refData[mod][k];
        console.log(`[i18n:fix] ${lang}/${mod}.json + ${k}`);
      }
    }
    for (const mod of MODULES) {
      for (const k of Object.keys(byMod[mod])) {
        if (!refSet.has(k)) delete byMod[mod][k];
      }
    }
    writeModuleData(lang, byMod);
  }
  console.log('[i18n:fix] Done. Re-run without --fix to verify.');
  process.exit(0);
}

if (report.length) {
  console.error('[i18n] Locale key mismatch vs reference "' + REF + '":\n');
  for (const r of report) {
    console.error(`  ${r.lang} (${r.type}, ${r.keys.length}):`);
    for (const k of r.keys.slice(0, 40)) console.error(`    - ${k}`);
    if (r.keys.length > 40) console.error(`    ... and ${r.keys.length - 40} more`);
  }
  console.error('\nFix: add keys or run `node scripts/check-i18n-keys.mjs --fix` (copies EN strings).');
  process.exit(1);
}

console.log(`[i18n] OK — ${LANGS.length} locales match ${refSet.size} keys (reference: ${REF}).`);
