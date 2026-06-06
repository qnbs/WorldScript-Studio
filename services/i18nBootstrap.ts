import type { Language } from '../contexts/I18nContext';

/** Synchronous fallbacks for keys needed before async bundle.json loads (cold start). */
export const I18N_BOOTSTRAP: Record<Language, Record<string, string>> = {
  en: {
    'initialProject.title': 'My Untitled Story',
    'initialProject.logline': 'A journey of a thousand miles begins with a single step...',
    'initialProject.chapter1': 'Chapter 1',
  },
  de: {
    'initialProject.title': 'Meine unbenannte Geschichte',
    'initialProject.logline': 'Eine Reise von tausend Meilen beginnt mit einem einzigen Schritt...',
    'initialProject.chapter1': 'Kapitel 1',
  },
  fr: {
    'initialProject.title': 'Mon histoire sans titre',
    'initialProject.logline': 'Un voyage de mille lieues commence par un seul pas...',
    'initialProject.chapter1': 'Chapitre 1',
  },
  es: {
    'initialProject.title': 'Mi historia sin título',
    'initialProject.logline': 'Un viaje de mil millas comienza con un solo paso...',
    'initialProject.chapter1': 'Capítulo 1',
  },
  it: {
    'initialProject.title': 'La mia storia senza titolo',
    'initialProject.logline': 'Un viaggio di mille miglia inizia con un solo passo...',
    'initialProject.chapter1': 'Capitolo 1',
  },
  // QNBS-v3: RTL beta — cold-start values translated to match the ar/he bundles (no English flash on first paint).
  ar: {
    'initialProject.title': 'قصتي بلا عنوان',
    'initialProject.logline': 'رحلة الألف ميل تبدأ بخطوة واحدة...',
    'initialProject.chapter1': 'الفصل 1',
  },
  he: {
    'initialProject.title': 'הסיפור חסר הכותרת שלי',
    'initialProject.logline': 'מסע של אלף מילין מתחיל בצעד אחד...',
    'initialProject.chapter1': 'פרק 1',
  },
  // QNBS-v3: Phase 3 Beta — ja/zh/pt/el cold-start values (English placeholders until native review)
  ja: {
    'initialProject.title': 'タイトルなしの物語',
    'initialProject.logline': '千里の道も一歩から...',
    'initialProject.chapter1': '第1章',
  },
  zh: {
    'initialProject.title': '无标题故事',
    'initialProject.logline': '千里之行，始于足下...',
    'initialProject.chapter1': '第1章',
  },
  pt: {
    'initialProject.title': 'Minha História Sem Título',
    'initialProject.logline': 'Uma jornada de mil milhas começa com um único passo...',
    'initialProject.chapter1': 'Capítulo 1',
  },
  el: {
    'initialProject.title': 'Η αφήγησή μου χωρίς τίτλο',
    'initialProject.logline': 'Το ταξίδι αυτό εκατομμύριο μιλία ξεκινάει από ένα βήμα...',
    'initialProject.chapter1': 'Κεφάλαιο 1',
  },
};

const KNOWN_PERSISTED_KEYS = new Set([
  'initialProject.title',
  'initialProject.logline',
  'initialProject.chapter1',
]);

export function bootstrapTranslation(lang: Language, key: string): string | undefined {
  return I18N_BOOTSTRAP[lang]?.[key] ?? I18N_BOOTSTRAP.en[key];
}

/** True when value equals a known i18n key that was persisted before bundles loaded. */
export function isKnownPersistedTranslationKey(value: string): boolean {
  return KNOWN_PERSISTED_KEYS.has(value);
}

export function resolveTranslation(
  lang: Language,
  key: string,
  loaded: Record<string, unknown> | undefined,
  enLoaded: Record<string, unknown> | undefined,
): string {
  const fromActive = loaded?.[key];
  if (typeof fromActive === 'string') return fromActive;
  const fromEn = enLoaded?.[key];
  if (typeof fromEn === 'string') return fromEn;
  return bootstrapTranslation(lang, key) ?? key;
}
