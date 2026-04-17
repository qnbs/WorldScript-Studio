import type React from 'react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useEffect, useState } from 'react';
import { logger } from '../services/logger';

type Language = 'en' | 'de' | 'fr' | 'es' | 'it';

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

const modules = [
  'common',
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
];

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
  const [translations, setTranslations] = useState<Record<string, Record<string, unknown>> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    // KRITISCHER FIX: Verwende import.meta.env.BASE_URL für Subpath-Unterstützung
    const base = import.meta.env.BASE_URL || '/';

    const fetchTranslations = async (lang: Language) => {
      const settled = await Promise.allSettled(
        modules.map((module) =>
          fetch(`${base}locales/${lang}/${module}.json`).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          }),
        ),
      );
      return settled.reduce(
        (acc, result) => {
          if (result.status === 'fulfilled') return { ...acc, ...result.value };
          return acc;
        },
        {} as Record<string, unknown>,
      );
    };

    const loadAllLanguages = async () => {
      setIsLoading(true);
      try {
        const [enData, deData, frData, esData, itData] = await Promise.all([
          fetchTranslations('en'),
          fetchTranslations('de'),
          fetchTranslations('fr'),
          fetchTranslations('es'),
          fetchTranslations('it'),
        ]);
        setTranslations({
          en: enData,
          de: deData,
          fr: frData,
          es: esData,
          it: itData,
        });
      } catch (error) {
        logger.error('Failed to load all translation files', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadAllLanguages();
  }, []);

  const t = useCallback(
    <T = string>(key: string, replacements?: Record<string, string>): T => {
      if (!translations) {
        return key as unknown as T;
      }
      // Fallback auf EN wenn die aktuelle Sprache den Key nicht hat
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

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--background-primary)]">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[var(--border-interactive)]"></div>
      </div>
    );
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
  );
};
