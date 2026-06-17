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

// QNBS-v3: ar/he promoted into the parity gate (RTL Beta) — key coverage is now enforced.
// Translation *quality* is still Beta (help.json bodies remain English fallback by design).
// QNBS-v3: ja/zh/pt/el are Phase 3 beta stubs — English placeholders until human review completes.
// QNBS-v3: Phase X — fi/sv/hu/is/eu (LTR) + fa (RTL) added to the parity gate.
const LANGS = [
  'en',
  'de',
  'fr',
  'es',
  'it',
  'ar',
  'he',
  'ja',
  'zh',
  'pt',
  'el',
  'fi',
  'sv',
  'hu',
  'is',
  'eu',
  'fa',
];
const MODULES = [
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
  'objects',
  'mindmap',
  'characterInterviews',
  'lora',
  'copilot',
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
const quality = process.argv.includes('--quality');

// Patterns for values that are legitimately the same across languages
const SKIP_PATTERNS = [
  /^(PDF|DOCX?|HTML|RTF|EPUB|JSON|CSV|TXT|ZIP|PNG|JPG|SVG|MD)(\s|$|\s*\()/i,
  /^(Gemini|OpenAI|Ollama|Claude|GPT|API|URL|HTTP|HTTPS|WebRTC|WebSocket|Yjs|IndexedDB|LZ-String|AES-256|CRDT|PWA|Tauri|GitHub|Google\s|Discord|LM Studio|vLLM|WebLLM|Dropbox|OneDrive|iCloud|WorldScript)/i,
  /^Ctrl\+|^Alt\+|^Shift\+|^Meta\+|^\+\s/,
  /^\d+(\.\d+)?(\s*(KB|MB|GB|px|ms|s|%))?$/,
  /^v\d+\.\d+/,
  /^(OK|ID|UI|UX|AI|LLM|NLP|P2P|E2E|CI|CD|PR|QA|Top P|Sans-Serif|Serif|Monospace|Passphrase|Version|Status|Screen reader|Board|Offline|Logline)$/i,
  /^(Protanopia|Deuteranopia|Tritanopia|Adapter|Navigator|Inspector|Editor|General|Final|Format|Motivation|Notes|Description|Synopsis|Culture|Suggestions|Collaboration|Notifications|Community|Snapshot|Branch|Versions|Section|Style)$/i,
  /^https?:\/\//,
  /^[A-Za-z]+([A-Z][a-z]+)+$/, // camelCase product names
  /^(Anime|Genre|Thriller|Fantasy|Horror|Romance|Mystery|Space Opera|Finale|Climax|Debate|Showdown|Suspense|Commercial|Rebellion|Emotional|Navigation)$/i,
  /^(en|de|fr|es|it|ja|zh|ko|pt|ru)$/,
  /^wss?:\/\//,
  /~\{\{time\}\}/,
  /Lorem ipsum/,
  /^\{\{.*\}\}\s*—\s*/,
  /^URL\s*\(/,
  /^\+\s*(Snapshot|Branch|Segment)/,
];

function isLegitimatelySame(val) {
  if (!val || typeof val !== 'string' || val.length < 2) return true;
  return SKIP_PATTERNS.some((p) => p.test(val.trim()));
}

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
  console.error(`[i18n] Locale key mismatch vs reference "${REF}":\n`);
  for (const r of report) {
    console.error(`  ${r.lang} (${r.type}, ${r.keys.length}):`);
    for (const k of r.keys.slice(0, 40)) console.error(`    - ${k}`);
    if (r.keys.length > 40) console.error(`    ... and ${r.keys.length - 40} more`);
  }
  console.error(
    '\nFix: add keys or run `node scripts/check-i18n-keys.mjs --fix` (copies EN strings).',
  );
  process.exit(1);
}

console.log(`[i18n] OK — ${LANGS.length} locales match ${refSet.size} keys (reference: ${REF}).`);

if (quality) {
  // Quality mode: report likely-untranslated strings (same value as EN, not a known technical term)
  console.log('\n[i18n:quality] Scanning for likely-untranslated strings...\n');
  let totalGaps = 0;
  for (const lang of LANGS) {
    if (lang === REF) continue;
    const langData = loadModuleData(lang);
    const gaps = [];
    for (const mod of MODULES) {
      const enMod = refData[mod];
      const langMod = langData[mod];
      for (const [key, enVal] of Object.entries(enMod)) {
        if (typeof enVal !== 'string') continue;
        const langVal = langMod[key];
        if (langVal === enVal && !isLegitimatelySame(enVal)) {
          gaps.push({ mod, key, val: enVal });
        }
      }
    }
    const byMod = {};
    for (const g of gaps) {
      if (!byMod[g.mod]) byMod[g.mod] = [];
      byMod[g.mod].push(g);
    }
    totalGaps += gaps.length;
    if (gaps.length === 0) {
      console.log(`  ${lang}: ✓ no obvious gaps`);
    } else {
      console.log(`  ${lang}: ${gaps.length} likely untranslated`);
      for (const [mod, items] of Object.entries(byMod).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`    ${mod}: ${items.length}`);
      }
    }
  }
  console.log(`\n[i18n:quality] Total likely-untranslated: ${totalGaps}`);
  console.log(
    '[i18n:quality] Run `node scripts/check-i18n-keys.mjs --quality` to recheck after fixing.',
  );
}
