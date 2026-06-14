// @vitest-environment node
/**
 * i18n placeholder-syntax guard.
 * QNBS-v3: `pnpm run i18n:check` only validates KEY PARITY, not interpolation correctness, so two
 * runtime bug classes slipped through (fixed 2026-06-14):
 *   1. single-brace `{view}` placeholders — the I18nContext only interpolates `{{...}}`, so single
 *      braces render literally (user saw "Du bist hier: {view}", "common.abort", etc.).
 *   2. translated placeholder NAMES — es/pt localized `{count}`→`{contar}` / `{seconds}`→`{segundos}`
 *      / `{{count}}`→`{{contagem}}`, which never match the param names the code passes.
 * This guard fails CI if either recurs in any of the 11 shipped locale bundles.
 *
 * QNBS-v3: token patterns use the Unicode letter class `\p{L}` (not `[A-Za-z]`) so a token name
 * localized into a non-ASCII script (e.g. `{{タイトル}}`, the ja-writer bug class) is still detected
 * rather than silently skipped (CodeAnt #135). The consistency check is bidirectional: a translation
 * may neither INTRODUCE an unknown token nor DROP one the English source requires.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ar', 'he', 'el', 'ja', 'pt', 'zh'] as const;

function loadBundle(lang: string): Record<string, string> {
  const path = join(process.cwd(), 'public', 'locales', lang, 'bundle.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

// A single-brace placeholder (Unicode-aware token) NOT part of a `{{...}}` pair.
const SINGLE_BRACE = /(?<!\{)\{\p{L}[\p{L}\p{N}]*\}(?!\})/u;
// Extract canonical `{{token}}` names (any script) from a string.
function doubleBraceTokens(value: string): Set<string> {
  const out = new Set<string>();
  for (const m of value.matchAll(/\{\{(\p{L}[\p{L}\p{N}]*)\}\}/gu)) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

describe('i18n placeholder syntax', () => {
  it.each(LOCALES)('locale "%s" has no single-brace placeholders', (lang) => {
    const bundle = loadBundle(lang);
    const offenders = Object.entries(bundle)
      .filter(([, v]) => typeof v === 'string' && SINGLE_BRACE.test(v))
      .map(([k, v]) => `${k} → "${v}"`);
    expect(offenders, `single-brace placeholders in ${lang} (use {{...}})`).toEqual([]);
  });

  it.each(
    LOCALES.filter((l) => l !== 'en'),
  )('locale "%s" uses exactly the English source placeholder names — none added or dropped', (lang) => {
    const en = loadBundle('en');
    const bundle = loadBundle(lang);
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(bundle)) {
      if (typeof value !== 'string') continue;
      const enValue = en[key];
      if (typeof enValue !== 'string') continue; // key not in en — parity gate covers that
      const expected = doubleBraceTokens(enValue);
      const actual = doubleBraceTokens(value);
      for (const token of actual) {
        if (!expected.has(token)) offenders.push(`${key}: introduced unknown "{{${token}}}"`);
      }
      for (const token of expected) {
        if (!actual.has(token)) offenders.push(`${key}: dropped required "{{${token}}}"`);
      }
    }
    expect(offenders, `placeholder-name drift in ${lang}`).toEqual([]);
  });
});
