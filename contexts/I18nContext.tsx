import type React from 'react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../services/logger';

export type Language = 'en' | 'de' | 'fr' | 'es' | 'it';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: <T = string>(key: string, replacements?: Record<string, string>) => T;
}

export const I18nContext = createContext<I18nContextType>({
  language: 'de',
  setLanguage: () => {},
  t: <T = string>(key: string) => key as unknown as T,
});

interface I18nProviderProps {
  children: ReactNode;
}

const LANG_KEY = 'storycraft-language';
const VALID_LANGS: Language[] = ['en', 'de', 'fr', 'es', 'it'];

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
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

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

  const t = useCallback(
    <T = string>(key: string, replacements?: Record<string, string>): T => {
      // Fallback chain: active lang → EN → raw key
      const value = translations[language]?.[key] ?? translations['en']?.[key] ?? key;

      if (typeof value !== 'string') {
        return value as unknown as T;
      }

      let translation = value;

      if (replacements) {
        Object.entries(replacements).forEach(([placeholder, replacementValue]) => {
          translation = translation.replace(`{{${placeholder}}}`, replacementValue);
        });
      }

      return translation as unknown as T;
    },
    [language, translations],
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
  );
};
