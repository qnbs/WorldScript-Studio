/**
 * Middleware-safe i18n accessor. `I18nContext`'s `t()` lives in React state and is only reachable
 * from components; Redux listener middleware runs outside React and cannot call `useTranslation()`.
 * This module fetches + caches the same runtime `public/locales/{lang}/bundle.json` files the app
 * already serves, with the identical active-language → English → raw-key fallback chain and
 * `{{placeholder}}` interpolation as `t()`. Not a general replacement for `useTranslation()` — use
 * the React hook in components.
 */
import { isLanguage, type Language } from '../../i18n/locales';
import { createLogger } from '../logger';

const log = createLogger('static-translate');
const LANG_STORAGE_KEY = 'worldscript-language';

// QNBS-v3: module-level cache shared across all callers within the same page lifetime, mirroring I18nProvider's `loadLanguage` dedup/cache behaviour.
const bundleCache = new Map<Language, Record<string, unknown>>();
const inFlight = new Map<Language, Promise<Record<string, unknown>>>();

async function loadBundle(lang: Language): Promise<Record<string, unknown>> {
  const cached = bundleCache.get(lang);
  if (cached) return cached;

  let pending = inFlight.get(lang);
  if (!pending) {
    const base = import.meta.env.BASE_URL || '/';
    pending = fetch(`${base}locales/${lang}/bundle.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Record<string, unknown>>;
      })
      .then((data) => {
        bundleCache.set(lang, data);
        inFlight.delete(lang);
        return data;
      })
      .catch((err: unknown) => {
        log.warn('Locale bundle load failed', {
          lang,
          err: err instanceof Error ? err.message : String(err),
        });
        inFlight.delete(lang);
        return {};
      });
    inFlight.set(lang, pending);
  }
  return pending;
}

/** Reads the user's persisted language preference (same storage key as I18nProvider). */
export function getCurrentLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* localStorage may be unavailable */
  }
  return 'en';
}

/**
 * Translate a single key outside of React, with the same fallback chain and `{{placeholder}}`
 * interpolation as `I18nContext`'s `t()`: active language → English → raw key.
 */
export async function getStaticTranslation(
  key: string,
  lang: Language = getCurrentLanguage(),
  replacements?: Record<string, string | number>,
): Promise<string> {
  const [activeBundle, enBundle] = await Promise.all([
    loadBundle(lang),
    lang === 'en' ? Promise.resolve(undefined) : loadBundle('en'),
  ]);

  const value = activeBundle[key] ?? enBundle?.[key] ?? key;
  if (typeof value !== 'string') return key;

  let translation = value;
  if (replacements) {
    for (const [placeholder, replacementValue] of Object.entries(replacements)) {
      translation = translation.replace(`{{${placeholder}}}`, String(replacementValue));
    }
  }
  return translation;
}
