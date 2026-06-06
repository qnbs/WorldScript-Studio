import type React from 'react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { bootstrapTranslation } from '../services/i18nBootstrap';
import { logger } from '../services/logger';

export type Language = 'en' | 'de' | 'fr' | 'es' | 'it' | 'ar' | 'he' | 'ja' | 'zh' | 'pt' | 'el';

// QNBS-v3: Phase 2 B-5 — ar/he are beta stubs (English placeholder text); RTL direction is active.
// QNBS-v3: Phase 3 — ja/zh/pt/el are beta stubs (English placeholder text); LTR direction.
/** Languages whose natural writing direction is right-to-left. */
export const RTL_LOCALES: ReadonlySet<Language> = new Set(['ar', 'he']);

// QNBS-v3: Phase 3 — Language metadata for UI display and font handling
export interface LanguageInfo {
  code: Language;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  isBeta?: boolean;
  fontScript?: 'latin' | 'arabic' | 'hebrew' | 'cjk' | 'cyrillic' | 'greek';
}

// QNBS-v3: Phase 3 — Supported locales with metadata (used by LanguageSelector, Settings, etc.)
export const SUPPORTED_LOCALES: ReadonlyArray<LanguageInfo> = [
  { code: 'de', nativeName: 'Deutsch', dir: 'ltr', fontScript: 'latin' },
  { code: 'en', nativeName: 'English', dir: 'ltr', fontScript: 'latin' },
  { code: 'fr', nativeName: 'Français', dir: 'ltr', fontScript: 'latin' },
  { code: 'es', nativeName: 'Español', dir: 'ltr', fontScript: 'latin' },
  { code: 'it', nativeName: 'Italiano', dir: 'ltr', fontScript: 'latin' },
  // RTL Beta (B-5)
  { code: 'ar', nativeName: 'العربية', dir: 'rtl', fontScript: 'arabic', isBeta: true },
  { code: 'he', nativeName: 'עברית', dir: 'rtl', fontScript: 'hebrew', isBeta: true },
  // Phase 3 Beta — ja/zh/pt/el
  { code: 'ja', nativeName: '日本語', dir: 'ltr', fontScript: 'cjk', isBeta: true },
  { code: 'zh', nativeName: '简体中文', dir: 'ltr', fontScript: 'cjk', isBeta: true },
  { code: 'pt', nativeName: 'Português', dir: 'ltr', fontScript: 'latin', isBeta: true },
  { code: 'el', nativeName: 'Ελληνικά', dir: 'ltr', fontScript: 'greek', isBeta: true },
];

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  /** True once the active language bundle has been fetched. */
  isReady: boolean;
  t: <T = string>(key: string, replacements?: Record<string, string | number>) => T;
  /** Layout direction derived from the active locale. */
  dir: 'ltr' | 'rtl';
  /** QNBS-v3: Intl helpers with caching */
  /** Get CLDR plural category for a count (one, other, many, etc.) */
  getPluralCategory: (count: number) => string;
  /** Format a number with locale-aware grouping and options */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Format relative time (e.g., "yesterday", "in 2 days") */
  formatRelativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit) => string;
  /** Get a collator for locale-aware string comparison */
  getCollator: (options?: Intl.CollatorOptions) => Intl.Collator;
  /** Format a list of items with locale-aware conjunctions */
  formatList: (items: string[], options?: Intl.ListFormatOptions) => string;
  /** Format display names (language, region, script) */
  formatDisplayName: (value: string, type: Intl.DisplayNamesType) => string;
}

// QNBS-v3: Intl helper caches (per-language, per-options)
const pluralRuleCache = new Map<Language, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const relativeTimeFormatCache = new Map<Language, Intl.RelativeTimeFormat>();
const collatorCache = new Map<string, Intl.Collator>();
const listFormatCache = new Map<string, Intl.ListFormat>();
const displayNamesCache = new Map<string, Intl.DisplayNames>();

// QNBS-v3: Get cached Intl.PluralRules for a language
function getPluralRule(lang: Language): Intl.PluralRules {
  let rule = pluralRuleCache.get(lang);
  if (!rule) {
    rule = new Intl.PluralRules(lang);
    pluralRuleCache.set(lang, rule);
  }
  return rule;
}

// QNBS-v3: Get cached Intl.NumberFormat for a language + options key
function getNumberFormat(lang: Language, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}-${JSON.stringify(options ?? {})}`;
  let fmt = numberFormatCache.get(key);
  if (!fmt) {
    // QNBS-v3: Writing-app defaults: no unnecessary decimals, grouped thousands
    fmt = new Intl.NumberFormat(lang, {
      maximumFractionDigits: 0,
      ...options,
    });
    numberFormatCache.set(key, fmt);
  }
  return fmt;
}

// QNBS-v3: Get cached Intl.RelativeTimeFormat for a language
function getRelativeTimeFormat(lang: Language): Intl.RelativeTimeFormat {
  let fmt = relativeTimeFormatCache.get(lang);
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    relativeTimeFormatCache.set(lang, fmt);
  }
  return fmt;
}

// QNBS-v3: Get cached Intl.Collator for a language + options key
function getCollatorCached(lang: Language, options?: Intl.CollatorOptions): Intl.Collator {
  const key = `${lang}-${JSON.stringify(options ?? {})}`;
  let coll = collatorCache.get(key);
  if (!coll) {
    // QNBS-v3: Writing-app defaults: numeric sorting, ignore punctuation
    coll = new Intl.Collator(lang, { numeric: true, ignorePunctuation: true, ...options });
    collatorCache.set(key, coll);
  }
  return coll;
}

// QNBS-v3: Get cached Intl.ListFormat for a language + options key
function getListFormat(lang: Language, options?: Intl.ListFormatOptions): Intl.ListFormat {
  const key = `${lang}-${JSON.stringify(options ?? {})}`;
  let fmt = listFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.ListFormat(lang, { style: 'long', type: 'conjunction', ...options });
    listFormatCache.set(key, fmt);
  }
  return fmt;
}

// QNBS-v3: Get cached Intl.DisplayNames for a language + type
function getDisplayNames(lang: Language, type: Intl.DisplayNamesType): Intl.DisplayNames {
  const key = `${lang}-${type}`;
  let dn = displayNamesCache.get(key);
  if (!dn) {
    dn = new Intl.DisplayNames(lang, { type });
    displayNamesCache.set(key, dn);
  }
  return dn;
}

// QNBS-v3: Clear all Intl caches when language changes (prevents stale formatters)
function clearIntlCaches() {
  pluralRuleCache.clear();
  numberFormatCache.clear();
  relativeTimeFormatCache.clear();
  collatorCache.clear();
  listFormatCache.clear();
  displayNamesCache.clear();
}

export const I18nContext = createContext<I18nContextType>({
  language: 'de',
  setLanguage: () => {},
  isReady: false,
  t: <T = string>(key: string) => (bootstrapTranslation('en', key) ?? key) as unknown as T,
  dir: 'ltr',
  getPluralCategory: () => 'other',
  formatNumber: (value) => value.toString(),
  formatRelativeTime: (value, unit) => `${value} ${unit}`,
  getCollator: () => new Intl.Collator('en'),
  formatList: (items) => items.join(', '),
  formatDisplayName: (value) => value,
});

interface I18nProviderProps {
  children: ReactNode;
}

const LANG_KEY = 'storycraft-language';
const VALID_LANGS: Language[] = ['en', 'de', 'fr', 'es', 'it', 'ar', 'he', 'ja', 'zh', 'pt', 'el'];

const getInitialLanguage = (): Language => {
  try {
    const saved = localStorage.getItem(LANG_KEY) as Language;
    if (saved && VALID_LANGS.includes(saved)) return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  return 'en';
};

export const I18nProvider: React.FC<I18nProviderProps> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  // translations keyed by language — grows lazily as languages are loaded
  const [translations, setTranslations] = useState<Record<string, Record<string, unknown>>>({});
  // in-flight fetch promises deduplicate concurrent loads for the same language
  const inFlight = useRef<Partial<Record<Language, Promise<Record<string, unknown>>>>>({});

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    // QNBS-v3: Clear Intl caches on language change to prevent stale formatters
    clearIntlCaches();
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  // QNBS-v3: dir is derived here but DOM application is App.tsx's responsibility (it also handles the enableRtlLayout flag).
  const dir: 'ltr' | 'rtl' = RTL_LOCALES.has(language) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  /** Fetch a language bundle, deduplicating concurrent requests. */
  const loadLanguage = useCallback(
    async (lang: Language): Promise<Record<string, unknown>> => {
      // Already loaded
      if (translations[lang]) return translations[lang];

      // Deduplicate in-flight requests
      if (!inFlight.current[lang]) {
        const base = import.meta.env.BASE_URL || '/';
        inFlight.current[lang] = fetch(`${base}locales/${lang}/bundle.json`)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<Record<string, unknown>>;
          })
          .then((data) => {
            setTranslations((prev) => ({ ...prev, [lang]: data }));
            delete inFlight.current[lang];
            return data;
          })
          .catch((err) => {
            logger.error(`[i18n] Failed to load bundle for "${lang}"`, err);
            delete inFlight.current[lang];
            return {};
          });
      }
      return inFlight.current[lang] as Promise<Record<string, unknown>>;
    },
    [translations],
  );

  // On mount and whenever language changes: load active lang + EN fallback
  useEffect(() => {
    const loads: Promise<unknown>[] = [loadLanguage(language)];
    if (language !== 'en') loads.push(loadLanguage('en'));
    Promise.all(loads).catch(() => {});
  }, [language, loadLanguage]);

  const isReady = Boolean(
    translations[language] && Object.keys(translations[language] as object).length > 0,
  );

  const t = useCallback(
    <T = string>(key: string, replacements?: Record<string, string | number>): T => {
      // Fallback: active lang → EN → sync bootstrap (cold start) → raw key
      const value =
        translations[language]?.[key] ??
        translations['en']?.[key] ??
        bootstrapTranslation(language, key) ??
        key;

      if (typeof value !== 'string') {
        return value as unknown as T;
      }

      let translation = value;

      if (replacements) {
        Object.entries(replacements).forEach(([placeholder, replacementValue]) => {
          // QNBS-v3: Auto-format numbers when count is provided
          if (placeholder === 'count' && typeof replacementValue === 'number') {
            const formatted = getNumberFormat(language).format(replacementValue);
            translation = translation.replace(`{{${placeholder}}}`, formatted);
          } else {
            translation = translation.replace(`{{${placeholder}}}`, String(replacementValue));
          }
        });
      }

      return translation as unknown as T;
    },
    [language, translations],
  );

  // QNBS-v3: Intl helper functions (memoized with stable references)
  const getPluralCategory = useCallback(
    (count: number): string => getPluralRule(language).select(count),
    [language],
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions): string =>
      getNumberFormat(language, options).format(value),
    [language],
  );

  const formatRelativeTime = useCallback(
    (value: number, unit: Intl.RelativeTimeFormatUnit): string =>
      getRelativeTimeFormat(language).format(value, unit),
    [language],
  );

  const getCollator = useCallback(
    (options?: Intl.CollatorOptions): Intl.Collator => getCollatorCached(language, options),
    [language],
  );

  const formatList = useCallback(
    (items: string[], options?: Intl.ListFormatOptions): string =>
      getListFormat(language, options).format(items),
    [language],
  );

  const formatDisplayName = useCallback(
    (value: string, type: Intl.DisplayNamesType): string =>
      getDisplayNames(language, type).of(value) ?? value,
    [language],
  );

  return (
    <I18nContext.Provider
      value={{
        language,
        setLanguage,
        isReady,
        t,
        dir,
        getPluralCategory,
        formatNumber,
        formatRelativeTime,
        getCollator,
        formatList,
        formatDisplayName,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
};
