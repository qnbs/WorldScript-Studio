#!/usr/bin/env node
// QNBS-v3: PR1 i18n — non-gating translation-quality report. The parity gate (check-i18n-keys.mjs)
// only checks KEY coverage and the placeholder unit test only checks interpolation; neither tells you
// how *translated* a locale actually is. This surfaces, per non-English locale: coverage (share of
// string values that differ from the English source), placeholder-integrity issues, length outliers
// (truncation/overflow risk), and glossary-term count. Read-only; exits 0 by default, `--strict`
// exits 1 if any placeholder-integrity issue is found. Output is a Markdown table (the basis for the
// PR4 status dashboard, docs/i18n/TRANSLATION_STATUS.md).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocales, getModules, REF_LANG } from './i18n-locales.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const strict = process.argv.includes('--strict');

function load(lang, mod) {
  const p = join(ROOT, 'locales', lang, `${mod}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

function loadGlossary() {
  const p = join(ROOT, 'locales', 'translation-glossary.json');
  if (!existsSync(p)) return {};
  const g = JSON.parse(readFileSync(p, 'utf8'));
  return Object.fromEntries(Object.entries(g).filter(([k]) => k !== '_meta'));
}

const PLACEHOLDER = /\{\{\s*([\p{L}\d_]+)\s*\}\}/gu;
function tokens(s) {
  const out = new Set();
  if (typeof s !== 'string') return out;
  for (const m of s.matchAll(PLACEHOLDER)) out.add(m[1]);
  return out;
}
function sameTokens(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

const langs = getLocales().filter((l) => l !== REF_LANG);
// QNBS-v3: exclude 'help' — this is a UI-coverage report; help.json is intentionally English fallback
// for non-Production locales, so including it would understate real UI coverage (CodeAnt).
const modules = getModules().filter((m) => m !== 'help');
const glossary = loadGlossary();

let placeholderIssues = 0;
const rows = [];

for (const lang of langs) {
  let total = 0;
  let untranslated = 0;
  let phIssues = 0;
  let lenOutliers = 0;
  for (const mod of modules) {
    const en = load(REF_LANG, mod);
    const loc = load(lang, mod);
    for (const [k, enVal] of Object.entries(en)) {
      if (typeof enVal !== 'string') continue;
      total++;
      const locVal = loc[k];
      // QNBS-v3: a missing/non-string localized value is untranslated — count it, don't skip it, or
      // coverage is overstated (same correctness fix as the status dashboard).
      if (typeof locVal !== 'string') {
        untranslated++;
        continue;
      }
      // Approximate "untranslated" = value identical to the English source (brand/technical terms
      // that are legitimately identical inflate this slightly; it is a guide, not a gate).
      if (locVal === enVal && enVal.trim().length > 2) untranslated++;
      if (!sameTokens(tokens(enVal), tokens(locVal))) {
        phIssues++;
        placeholderIssues++;
      }
      // Only flag OVER-length translations (UI overflow/truncation risk). A shorter translation is not
      // a problem — and CJK is legitimately far more compact than English, so a lower bound would just
      // flag every ja/zh string as a false positive.
      if (enVal.length > 12 && locVal.length > enVal.length * 2.5) {
        lenOutliers++;
      }
    }
  }
  const pct = total ? Math.round(((total - untranslated) / total) * 100) : 0;
  const glossaryTerms = glossary[lang] ? Object.keys(glossary[lang]).length : 0;
  rows.push({ lang, total, pct, untranslated, phIssues, lenOutliers, glossaryTerms });
}

console.log(
  '| Locale | Coverage | Untranslated | Placeholder issues | Length outliers | Glossary terms |',
);
console.log(
  '|--------|---------:|-------------:|-------------------:|----------------:|---------------:|',
);
for (const r of rows) {
  console.log(
    `| ${r.lang} | ${r.pct}% | ${r.untranslated} | ${r.phIssues} | ${r.lenOutliers} | ${r.glossaryTerms} |`,
  );
}
console.log(
  `\n${rows.length} non-English locales · reference = ${REF_LANG} · ${modules.length} modules`,
);
if (placeholderIssues > 0) {
  console.log(
    `\n⚠ ${placeholderIssues} placeholder-integrity issue(s) — tests/unit/i18nPlaceholders.test.ts is the hard CI gate.`,
  );
}
if (strict && placeholderIssues > 0) process.exit(1);
