#!/usr/bin/env node
/**
 * Bulk Locale Translation Script — P1-5 i18n Beta
 *
 * Translates English locale files to target languages using the free
 * Google Translate endpoint (unofficial, rate-limited).
 *
 * Features:
 *   - Glossary lookup before API call (locales/translation-glossary.json)
 *   - Checkpointing (translation-progress.json) for resumable runs
 *   - Preserves flat key structure (matches EN locale format)
 *   - Idempotent: skips already-translated keys on re-run
 *   - Placeholder-safe: {{count}}, {{name}}, etc. are preserved
 *
 * Usage:
 *   node scripts/bulk-translate-locales.mjs --lang=ja --files=common
 *   node scripts/bulk-translate-locales.mjs --lang=ja,zh,pt,el --all --delay=400
 *   node scripts/bulk-translate-locales.mjs --lang=pt --files=common --checkpoint=progress.json
 *
 * Rate limits: ~100 requests/minute recommended. Use --delay=400–600.
 * For production scale, set GOOGLE_TRANSLATE_API_KEY for official API.
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
  // QNBS-v3: Phase X — Google `tl` codes map 1:1 (fa = Persian).
  fi: 'Finnish',
  sv: 'Swedish',
  hu: 'Hungarian',
  is: 'Icelandic',
  eu: 'Basque',
  fa: 'Persian',
};

const FREE_ENDPOINT =
  'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={{tl}}&dt=t&q={{q}}';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// QNBS-v3: Placeholder masking — the free MT endpoint mangles `{{name}}` tokens (translates the
// word inside, drops braces, reorders). Replace each with an order-indexed sentinel using unusual
// math brackets (U+27E6/U+27E7) that survive MT, then restore afterward. Restore is whitespace-
// tolerant because MT sometimes pads the sentinel (e.g. "⟦ 0 ⟧").
function maskPlaceholders(text) {
  const tokens = [];
  const masked = text.replace(/\{\{.*?\}\}/g, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `⟦${idx}⟧`;
  });
  return { masked, tokens };
}

// QNBS-v3: Modules excluded from `--all`. help.json is long-form rich HTML; the free MT endpoint
// mangles tag-dense markup even with sentinel masking (dropped/duplicated tags → unbalanced HTML
// rendered by HelpView), so per policy it stays English fallback for Beta locales and is only
// translated by human review. Still translatable explicitly via `--files=help` if ever needed.
const ALL_SKIP = new Set(['help.json']);

function restorePlaceholders(text, tokens) {
  let result = text;
  for (let i = 0; i < tokens.length; i++) {
    result = result.replace(new RegExp(`⟦\\s*${i}\\s*⟧`, 'g'), tokens[i]);
  }
  return result;
}

function loadGlossary() {
  const glossaryPath = path.join(ROOT, 'locales', 'translation-glossary.json');
  if (!fs.existsSync(glossaryPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  } catch {
    return {};
  }
}

function glossaryTranslate(text, lang, glossary) {
  const langGlossary = glossary[lang];
  if (!langGlossary) return null;

  // QNBS-v3: EXACT full-string match only. The previous whole-word partial substitution was a
  // correctness footgun: a non-null partial result skipped the MT step entirely, leaving the rest
  // of a multi-word string in English (e.g. "Export your project…" → "Exportálás your project…").
  // Exact labels still anchor here; everything else flows to MT in full. Cross-module term
  // consistency is enforced via the glossary + native review, not by mangling sentences.
  if (langGlossary[text] !== undefined) return langGlossary[text];
  return null;
}

function loadCheckpoint(lang, file) {
  const cpPath = path.join(ROOT, `.translation-progress-${lang}-${file}.json`);
  if (!fs.existsSync(cpPath)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(cpPath, 'utf8'));
    return new Set(data.done || []);
  } catch {
    return new Set();
  }
}

function saveCheckpoint(lang, file, doneSet) {
  const cpPath = path.join(ROOT, `.translation-progress-${lang}-${file}.json`);
  fs.writeFileSync(
    cpPath,
    JSON.stringify({ done: Array.from(doneSet), updated: new Date().toISOString() }, null, 2) +
      '\n',
  );
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
  if (Array.isArray(data) && data[0]?.[0]) {
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

async function translateFile(enPath, outPath, targetLang, delayMs = 600, dryRun = false) {
  const glossary = loadGlossary();
  const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

  const fileBase = path.basename(enPath, '.json');
  const checkpoint = loadCheckpoint(targetLang, fileBase);

  // Build list of keys to translate
  const keysToTranslate = [];
  for (const [key, value] of Object.entries(enData)) {
    if (typeof value !== 'string') continue;
    if (checkpoint.has(key)) continue;
    if (existing[key] && existing[key] !== value) continue; // already translated
    keysToTranslate.push(key);
  }

  if (keysToTranslate.length === 0) {
    console.log(`  All ${Object.keys(enData).length} keys already translated.`);
    return;
  }

  // QNBS-v3: --dry-run — report counts only; no network calls, no writes.
  if (dryRun) {
    const glossaryHits = keysToTranslate.filter(
      (k) => glossaryTranslate(enData[k], targetLang, glossary) !== null,
    ).length;
    console.log(
      `  [dry-run] ${fileBase}: ${keysToTranslate.length}/${Object.keys(enData).length} to translate · ${glossaryHits} glossary hit(s) · ${keysToTranslate.length - glossaryHits} via MT`,
    );
    return;
  }

  console.log(
    `  Translating ${keysToTranslate.length}/${Object.keys(enData).length} keys for ${targetLang}...`,
  );

  const translated = { ...existing };
  const done = new Set(checkpoint);

  for (let i = 0; i < keysToTranslate.length; i++) {
    const key = keysToTranslate[i];
    const original = enData[key];

    // Try glossary first
    let result = glossaryTranslate(original, targetLang, glossary);

    if (!result) {
      // QNBS-v3: mask {{placeholders}} before MT so the engine can't translate/drop them.
      const { masked, tokens } = maskPlaceholders(original);
      try {
        const translatedMasked = await translateWithRetry(masked, targetLang);
        result = restorePlaceholders(translatedMasked, tokens);
      } catch (err) {
        console.error(`\n  Failed: ${key} = "${original}" — ${err.message}`);
        result = original; // fallback to EN
      }
    }

    translated[key] = result;
    done.add(key);
    process.stdout.write(`  ${i + 1}/${keysToTranslate.length} ${key.slice(0, 40)}\r`);

    // Save checkpoint every 10 keys
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(outPath, JSON.stringify(translated, Object.keys(enData).sort(), 2) + '\n');
      saveCheckpoint(targetLang, fileBase, done);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  // Final write with keys in same order as EN
  fs.writeFileSync(outPath, JSON.stringify(translated, Object.keys(enData).sort(), 2) + '\n');
  saveCheckpoint(targetLang, fileBase, done);
  console.log(`\n  Written: ${outPath}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { lang: [], files: [], all: false, delay: 600, dryRun: false };
  for (const arg of args) {
    if (arg.startsWith('--lang=')) opts.lang = arg.slice(7).split(',').filter(Boolean);
    else if (arg.startsWith('--files=')) opts.files = arg.slice(8).split(',').filter(Boolean);
    else if (arg === '--all') opts.all = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--delay=')) opts.delay = Number.parseInt(arg.slice(8), 10);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  if (opts.lang.length === 0) {
    console.error(
      'Usage: node bulk-translate-locales.mjs --lang=ja [--files=common,portal] [--all] [--delay=400] [--dry-run]',
    );
    console.error('Supported languages:', Object.keys(SUPPORTED_LANGS).join(', '));
    process.exit(1);
  }

  if (opts.dryRun) console.log('🔍 Dry run — no network calls, no writes.\n');

  const enDir = path.join(ROOT, 'locales', 'en');
  const enFiles = fs
    .readdirSync(enDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  const filesToProcess = opts.all
    ? enFiles.filter((f) => !ALL_SKIP.has(f))
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
      await translateFile(enPath, outPath, lang, opts.delay, opts.dryRun);
    }
  }

  console.log('\n✅ Done. Run `pnpm run i18n:check` to validate parity.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
