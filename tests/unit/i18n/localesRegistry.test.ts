// @vitest-environment node
/**
 * QNBS-v3: PR1 i18n — registry-integrity guard for the SSOT (i18n/locales.ts).
 *
 * The `.mjs` build/check/translate scripts derive their locale list from the filesystem because they
 * cannot import the typed registry. This test is the bridge that keeps the two from drifting: it
 * asserts the registry's codes exactly match the `locales/<code>/` folders, that RTL/status/flag
 * metadata is internally consistent, and that the runtime guards behave.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getLocaleInfo,
  isLanguage,
  LOCALE_CODES,
  LOCALES,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
} from '../../../i18n/locales';

const LOCALES_DIR = join(process.cwd(), 'locales');

/** The same filesystem derivation the .mjs scripts (scripts/i18n-locales.mjs) use. */
function filesystemLocaleCodes(): string[] {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(LOCALES_DIR, d.name, 'common.json')))
    .map((d) => d.name)
    .sort();
}

describe('i18n locale registry (SSOT)', () => {
  it('registry codes exactly match the locales/ folders on disk', () => {
    expect([...LOCALE_CODES].sort()).toEqual(filesystemLocaleCodes());
  });

  it('has no duplicate locale codes', () => {
    expect(new Set(LOCALE_CODES).size).toBe(LOCALE_CODES.length);
  });

  it('RTL_LOCALES contains exactly the rtl-direction locales', () => {
    const rtlFromDir = LOCALES.filter((l) => l.dir === 'rtl')
      .map((l) => l.code)
      .sort();
    expect([...RTL_LOCALES].sort()).toEqual(rtlFromDir);
  });

  it('every locale has non-empty nativeName, englishName and flag', () => {
    for (const l of LOCALES) {
      expect(l.nativeName, l.code).toBeTruthy();
      expect(l.englishName, l.code).toBeTruthy();
      expect(l.flag, l.code).toBeTruthy();
    }
  });

  it('SUPPORTED_LOCALES.isBeta is set iff the tier is beta (near-production is NOT beta)', () => {
    for (const info of SUPPORTED_LOCALES) {
      const desc = getLocaleInfo(info.code);
      expect(desc, info.code).toBeDefined();
      expect(Boolean(info.isBeta), info.code).toBe(desc?.status === 'beta');
    }
  });

  it('isLanguage guards real codes and rejects junk', () => {
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('de')).toBe(true);
    expect(isLanguage('xx')).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
    expect(isLanguage(42)).toBe(false);
  });

  it('every locale has a valid status tier', () => {
    const valid = new Set(['production', 'near-production', 'beta']);
    for (const l of LOCALES) {
      expect(valid.has(l.status), `${l.code}: ${l.status}`).toBe(true);
    }
  });

  it('production locales ship translated help (helpFallback false); others fall back', () => {
    for (const l of LOCALES) {
      if (l.status === 'production') {
        expect(l.helpFallback, l.code).toBe(false);
      } else {
        expect(l.helpFallback, l.code).toBe(true);
      }
    }
  });

  it('the core 5 are the production tier', () => {
    const production = LOCALES.filter((l) => l.status === 'production')
      .map((l) => l.code)
      .sort();
    expect(production).toEqual(['de', 'en', 'es', 'fr', 'it']);
  });

  it('English is present and is production (the ultimate fallback)', () => {
    const en = getLocaleInfo('en');
    expect(en?.status).toBe('production');
    expect(en?.dir).toBe('ltr');
  });
});
