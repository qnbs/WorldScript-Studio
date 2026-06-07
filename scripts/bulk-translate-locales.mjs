#!/usr/bin/env node
/**
 * Bulk Locale Translation Script
 *
 * Translates English locale files to target languages using the free
 * Google Translate endpoint (unofficial, rate-limited).
 *
 * Usage:
 *   node scripts/bulk-translate-locales.mjs --lang=ja --files=common,portal
 *   node scripts/bulk-translate-locales.mjs --lang=ja,zh,pt,el --all
 *
 * Rate limits: ~100 requests/minute recommended to avoid IP blocks.
 * For production-scale translation, use Google Cloud Translation API
 * with an API key (set GOOGLE_TRANSLATE_API_KEY env var).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUPPORTED_LANGS = {
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
  pt: 'Portuguese',
  el: 'Greek',
};

const FREE_ENDPOINT =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={{tl}}&dt=t&q={{q}}';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateFree(text, targetLang) {
  const url = FREE_ENDPOINT.replace('{{tl}}', targetLang).replace(
    '{{q}}',
    encodeURIComponent(text),
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  // Response format: [[[translated, original, ...], ...], ...]
  if (Array.isArray(data) && data[0] && data[0][0]) {
    return data[0].map((item) => item[0]).join('');
  }
  throw new Error('Unexpected response format');
}

async function translateWithRetry(text, targetLang, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await translateFree(text, targetLang);
      return result;
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
  return text;
}

function flatten(obj, prefix = '') {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') result[key] = v;
    else if (typeof v === 'object' && v !== null) Object.assign(result, flatten(v, key));
  }
  return result;
}

function unflatten(flat) {
  const result = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let curr = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!curr[parts[i]]) curr[parts[i]] = {};
      curr = curr[parts[i]];
    }
    curr[parts[parts.length - 1]] = value;
  }
  return result;
}

async function translateFile(enPath, outPath, targetLang, delayMs = 600) {
  const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const flatEn = flatten(enData);
  const existing = fs.existsSync(outPath)
    ? flatten(JSON.parse(fs.readFileSync(outPath, 'utf8')))
    : {};

  const toTranslate = {};
  for (const [k, v] of Object.entries(flatEn)) {
    if (existing[k] && existing[k] !== v) {
      // Already translated (different from EN)
      toTranslate[k] = existing[k];
    } else {
      toTranslate[k] = v;
    }
  }

  const translated = { ...existing };
  const keys = Object.keys(toTranslate).filter((k) => toTranslate[k] === flatEn[k]);

  console.log(`  Translating ${keys.length} keys for ${targetLang}...`);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const original = flatEn[key];
    try {
      const result = await translateWithRetry(original, targetLang);
      translated[key] = result;
      process.stdout.write(`  ${i + 1}/${keys.length} ${key.slice(0, 40)}\r`);
    } catch (err) {
      console.error(`\n  Failed: ${key} = "${original}" — ${err.message}`);
      translated[key] = original; // fallback to EN
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  const outData = unflatten(translated);
  fs.writeFileSync(outPath, JSON.stringify(outData, null, 2) + '\n');
  console.log(`\n  Written: ${outPath}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { lang: [], files: [], all: false, delay: 600 };
  for (const arg of args) {
    if (arg.startsWith('--lang=')) opts.lang = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--files=')) opts.files = arg.slice(8).split(',').filter(Boolean);
    else if (arg === '--all') opts.all = true;
    else if (arg.startsWith('--delay=')) opts.delay = Number.parseInt(arg.slice(8), 10);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  if (opts.lang.length === 0) {
    console.error(
      'Usage: node bulk-translate-locales.mjs --lang=ja [--files=common,portal] [--all]',
    );
    console.error('Supported languages:', Object.keys(SUPPORTED_LANGS).join(', '));
    process.exit(1);
  }

  const enDir = path.join(ROOT, 'locales', 'en');
  const enFiles = fs
    .readdirSync(enDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const filesToProcess = opts.all
    ? enFiles
    : opts.files.length > 0
      ? opts.files.map((f) => (f.endsWith('.json') ? f : `${f}.json`))
      : enFiles;

  for (const lang of opts.lang) {
    if (!SUPPORTED_LANGS[lang]) {
      console.warn(`Skipping unsupported language: ${lang}`);
      continue;
    }
    console.log(`\n🌐 ${SUPPORTED_LANGS[lang]} (${lang})`);
    const outDir = path.join(ROOT, 'locales', lang);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const file of filesToProcess) {
      const enPath = path.join(enDir, file);
      if (!fs.existsSync(enPath)) {
        console.warn(`  Source missing: ${enPath}`);
        continue;
      }
      const outPath = path.join(outDir, file);
      await translateFile(enPath, outPath, lang, opts.delay);
    }
  }

  console.log('\n✅ Done. Run `pnpm run i18n:check` to validate parity.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
