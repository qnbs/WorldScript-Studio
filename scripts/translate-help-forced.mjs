#!/usr/bin/env node
/**
 * Force-translate specific stale help keys to all target locales.
 * Unlike bulk-translate-locales.mjs, this OVERWRITES existing translations
 * for the listed keys regardless of current content.
 *
 * Usage: node scripts/translate-help-forced.mjs [--lang=de,fr] [--delay=600]
 *        node scripts/translate-help-forced.mjs --all
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Google Translate language codes (ISO 639-1 with exceptions)
const LANG_CODES = {
  de: 'de',
  fr: 'fr',
  es: 'es',
  it: 'it',
  ja: 'ja',
  zh: 'zh-CN',
  pt: 'pt',
  el: 'el',
  ar: 'ar',
  he: 'iw',
};

// Keys to force-translate (changed/rewritten in EN)
const STALE_KEYS = [
  'help.settingsGuide.flags.title',
  'help.settingsGuide.overview.content',
  'help.docs.privacySecurity.content',
  'help.docs.featureFlags.content',
  'help.gettingStarted.desktop.content',
  'help.faq.privacy.content',
  'help.faq.api.content',
  'help.management.export.content',
  'help.settingsGuide.flags.content',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateText(text, targetLangCode, retries = 3) {
  // Use POST to avoid URL length limits for long HTML content
  const url = 'https://translate.googleapis.com/translate_a/single';
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: targetLangCode,
    dt: 't',
    q: text,
  });
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.[0]) {
        return data[0].map((item) => item[0]).join('');
      }
      throw new Error('Unexpected response format');
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
  return text;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { langs: [], delay: 600, all: false };
  for (const arg of args) {
    if (arg.startsWith('--lang=')) opts.langs = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--delay=')) opts.delay = parseInt(arg.slice(8), 10);
    else if (arg === '--all') opts.all = true;
  }
  if (opts.all) opts.langs = Object.keys(LANG_CODES);
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (opts.langs.length === 0) {
    console.error('Usage: node translate-help-forced.mjs --lang=de,fr [--delay=600] OR --all');
    process.exit(1);
  }

  const enPath = path.join(ROOT, 'locales', 'en', 'help.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

  for (const lang of opts.langs) {
    const code = LANG_CODES[lang];
    if (!code) {
      console.warn(`Unsupported: ${lang}`);
      continue;
    }

    const outPath = path.join(ROOT, 'locales', lang, 'help.json');
    const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

    console.log(`\n🌐 ${lang} (${code})`);
    let count = 0;

    for (const key of STALE_KEYS) {
      const enVal = en[key];
      if (!enVal) {
        console.warn(`  MISSING in EN: ${key}`);
        continue;
      }

      process.stdout.write(`  [${count + 1}/${STALE_KEYS.length}] ${key.slice(0, 50)}...`);
      try {
        const translated = await translateText(enVal, code);
        existing[key] = translated;
        count++;
        process.stdout.write(' ✓\n');
      } catch (err) {
        process.stdout.write(` ✗ (${err.message}) — kept EN\n`);
        existing[key] = enVal; // fallback to EN
      }

      if (opts.delay > 0) await sleep(opts.delay);
    }

    // Write back preserving key order from EN file
    const enKeys = Object.keys(en);
    const sorted = {};
    for (const k of enKeys) {
      if (existing[k] !== undefined) sorted[k] = existing[k];
    }
    for (const k of Object.keys(existing)) {
      if (!sorted[k]) sorted[k] = existing[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`  ✅ Written ${outPath} (${count}/${STALE_KEYS.length} translated)`);
  }

  console.log('\n✅ Done. Run `pnpm run i18n:bundle` to rebuild bundles.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
