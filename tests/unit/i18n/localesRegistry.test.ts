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
  getLanguageToolCode,
  getLocaleInfo,
  hasLanguageToolSupport,
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

  it('every locale declares a valid LanguageTool support tier', () => {
    const valid = new Set(['strong', 'partial', 'none']);
    for (const l of LOCALES) {
      expect(valid.has(l.languageToolSupport), `${l.code}: ${l.languageToolSupport}`).toBe(true);
    }
  });

  it('languageToolCode is present iff the locale has LanguageTool support', () => {
    // QNBS-v3: SSOT invariant — a usable LT code exists exactly when support !== 'none', so the
    // editor grammar feature can gate on getLanguageToolCode() returning non-null.
    for (const l of LOCALES) {
      // QNBS-v3: read the code via the LocaleDescriptor-typed lookup — the `as const` literal type of
      // `none` entries omits the optional `languageToolCode`, so direct access there is a type error.
      const hasCode = Boolean(getLocaleInfo(l.code)?.languageToolCode);
      const supported = l.languageToolSupport !== 'none';
      expect(hasCode, `${l.code}: code/support mismatch`).toBe(supported);
      expect(hasLanguageToolSupport(l.code), l.code).toBe(supported);
      expect(getLanguageToolCode(l.code) !== null, l.code).toBe(supported);
    }
  });

  it('LanguageTool-unsupported locales (verified) expose no grammar feature', () => {
    // QNBS-v3: verified against dev.languagetool.org/languages (2026-06-24); these must stay 'none'
    // so we never promise grammar checking we cannot deliver.
    for (const code of ['he', 'fi', 'hu', 'is', 'eu', 'ko'] as const) {
      expect(getLocaleInfo(code)?.languageToolSupport, code).toBe('none');
      expect(getLanguageToolCode(code), code).toBeNull();
    }
  });

  it('the core 5 production locales all have LanguageTool coverage', () => {
    for (const code of ['de', 'en', 'es', 'fr', 'it'] as const) {
      expect(hasLanguageToolSupport(code), code).toBe(true);
    }
  });
});
