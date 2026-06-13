// @vitest-environment node
/**
 * QNBS-v3: Regression guard for command-palette localization. Command labels use `titleKey` +
 * t(), so a missing translation silently falls back to the English source. This asserts that no
 * `palette.*` key in a core locale still equals its English value — except a small allowlist of
 * words that are legitimately identical (loanwords / proper nouns). Prevents the "added in
 * English, never translated" regression that left ~20 palette commands English in de/es/fr/it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function load(loc: string): Record<string, string> {
  const url = new URL(`../../../locales/${loc}/common.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Record<string, string>;
}

const en = load('en');
const PALETTE_KEYS = Object.keys(en).filter((k) => k.startsWith('palette.'));

// Keys whose value is legitimately identical to English in that locale (loanwords).
const ALLOWLIST: Record<string, ReadonlySet<string>> = {
  de: new Set(['palette.category.navigation', 'palette.category.editor']),
  es: new Set(['palette.category.editor']),
  fr: new Set(['palette.category.navigation']),
  it: new Set(['palette.category.editor']),
};

const CORE_LOCALES = ['de', 'es', 'fr', 'it'] as const;

describe('command palette localization (core locales)', () => {
  it('has palette.* keys to check', () => {
    expect(PALETTE_KEYS.length).toBeGreaterThan(50);
  });

  for (const loc of CORE_LOCALES) {
    it(`${loc}: no palette.* command label falls back to English (allowlist aside)`, () => {
      const l = load(loc);
      const allow = ALLOWLIST[loc] ?? new Set<string>();
      const untranslated = PALETTE_KEYS.filter((k) => l[k] === en[k] && !allow.has(k));
      expect(untranslated).toEqual([]);
    });
  }
});
