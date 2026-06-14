// @vitest-environment node
/**
 * i18n placeholder-syntax guard.
 * QNBS-v3: `pnpm run i18n:check` only validates KEY PARITY, not interpolation correctness, so two
 * runtime bug classes slipped through (fixed 2026-06-14):
 *   1. single-brace `{view}` placeholders — the I18nContext only interpolates `{{...}}`, so single
 *      braces render literally (user saw "Du bist hier: {view}", "common.abort", etc.).
 *   2. translated placeholder NAMES — es/pt localized `{count}`→`{contar}` / `{seconds}`→`{segundos}`,
 *      which never match the param names the code passes.
 * This guard fails CI if either recurs in any of the 11 shipped locale bundles.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'ar', 'he', 'el', 'ja', 'pt', 'zh'] as const;

function loadBundle(lang: string): Record<string, string> {
  const path = join(process.cwd(), 'public', 'locales', lang, 'bundle.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

// A single-brace placeholder NOT part of a `{{...}}` pair.
const SINGLE_BRACE = /(?<!\{)\{[A-Za-z][A-Za-z0-9]*\}(?!\})/;
// Extract canonical `{{token}}` names from a string.
function doubleBraceTokens(value: string): Set<string> {
  const out = new Set<string>();
  for (const m of value.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)) {
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
  )('locale "%s" introduces no placeholder names absent from the English source', (lang) => {
    const en = loadBundle('en');
    const bundle = loadBundle(lang);
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(bundle)) {
      if (typeof value !== 'string') continue;
      const enValue = en[key];
      if (typeof enValue !== 'string') continue; // key not in en — parity gate covers that
      const allowed = doubleBraceTokens(enValue);
      for (const token of doubleBraceTokens(value)) {
        if (!allowed.has(token))
          offenders.push(`${key}: "{{${token}}}" not in en {${[...allowed]}}`);
      }
    }
    expect(offenders, `translated/unknown placeholder names in ${lang}`).toEqual([]);
  });
});
