// QNBS-v3: Single source of truth (SSOT) for locale metadata. Before this file, locale lists were
// duplicated across I18nContext, LanguageSelector, three build/check/translate scripts and the
// placeholder test. Everything now derives from LOCALES below; adding a language = one entry here
// (+ its content folder + fonts). The `.mjs` build/check/translate scripts derive their code/module
// lists from the filesystem (they cannot import this TS module), and a registry-integrity unit test
// asserts the two stay in sync.

/**
 * One locale's display + behaviour metadata.
 * - `nativeName` is the endonym (intentionally NOT localized so users always find their own language).
 * - `englishName` is the exonym used in docs/README; the in-UI exonym is `t('portal.language.names.<code>')`.
 * - `flag` is an emoji (non-translatable); Basque has no flag emoji → globe.
 * - `status` drives the Production / Near-Production / Beta tier surfaced in the UI + README.
 * - `helpFallback` = true when `help.json` long-form content still falls back to English.
 */
export interface LocaleDescriptor {
  readonly code: string;
  readonly nativeName: string;
  readonly englishName: string;
  readonly flag: string;
  readonly dir: 'ltr' | 'rtl';
  readonly status: 'production' | 'near-production' | 'beta';
  readonly script: 'latin' | 'arabic' | 'hebrew' | 'cjk' | 'greek' | 'cyrillic' | 'hangul';
  readonly helpFallback: boolean;
}

// QNBS-v3: `as const` keeps each `code` a string literal so `Language` stays an exhaustive union
// (a plain string[] / JSON import would widen to `string` and lose type safety on locale codes).
export const LOCALES = [
  // Production — full key parity + translated help.
  {
    code: 'de',
    nativeName: 'Deutsch',
    englishName: 'German',
    flag: '🇩🇪',
    dir: 'ltr',
    status: 'production',
    script: 'latin',
    helpFallback: false,
  },
  {
    code: 'en',
    nativeName: 'English',
    englishName: 'English',
    flag: '🇺🇸',
    dir: 'ltr',
    status: 'production',
    script: 'latin',
    helpFallback: false,
  },
  {
    code: 'fr',
    nativeName: 'Français',
    englishName: 'French',
    flag: '🇫🇷',
    dir: 'ltr',
    status: 'production',
    script: 'latin',
    helpFallback: false,
  },
  {
    code: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
    flag: '🇪🇸',
    dir: 'ltr',
    status: 'production',
    script: 'latin',
    helpFallback: false,
  },
  {
    code: 'it',
    nativeName: 'Italiano',
    englishName: 'Italian',
    flag: '🇮🇹',
    dir: 'ltr',
    status: 'production',
    script: 'latin',
    helpFallback: false,
  },
  // RTL Beta (B-5).
  {
    code: 'ar',
    nativeName: 'العربية',
    englishName: 'Arabic',
    flag: '🇸🇦',
    dir: 'rtl',
    status: 'beta',
    script: 'arabic',
    helpFallback: true,
  },
  {
    code: 'he',
    nativeName: 'עברית',
    englishName: 'Hebrew',
    flag: '🇮🇱',
    dir: 'rtl',
    status: 'beta',
    script: 'hebrew',
    helpFallback: true,
  },
  // Phase 3 Beta — CJK + Portuguese + Greek.
  {
    code: 'ja',
    nativeName: '日本語',
    englishName: 'Japanese',
    flag: '🇯🇵',
    dir: 'ltr',
    status: 'beta',
    script: 'cjk',
    helpFallback: true,
  },
  {
    code: 'zh',
    nativeName: '简体中文',
    englishName: 'Chinese (Simplified)',
    flag: '🇨🇳',
    dir: 'ltr',
    status: 'beta',
    script: 'cjk',
    helpFallback: true,
  },
  {
    code: 'pt',
    nativeName: 'Português',
    englishName: 'Portuguese',
    flag: '🇵🇹',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  {
    code: 'el',
    nativeName: 'Ελληνικά',
    englishName: 'Greek',
    flag: '🇬🇷',
    dir: 'ltr',
    status: 'beta',
    script: 'greek',
    helpFallback: true,
  },
  // Phase X Beta — Nordic / Uralic / Basque (LTR) + Persian (RTL, Arabic script).
  {
    code: 'fi',
    nativeName: 'Suomi',
    englishName: 'Finnish',
    flag: '🇫🇮',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  {
    code: 'sv',
    nativeName: 'Svenska',
    englishName: 'Swedish',
    flag: '🇸🇪',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  {
    code: 'hu',
    nativeName: 'Magyar',
    englishName: 'Hungarian',
    flag: '🇭🇺',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  {
    code: 'is',
    nativeName: 'Íslenska',
    englishName: 'Icelandic',
    flag: '🇮🇸',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  // QNBS-v3: Basque has no Unicode flag emoji (ikurriña absent) → globe.
  {
    code: 'eu',
    nativeName: 'Euskara',
    englishName: 'Basque',
    flag: '🌐',
    dir: 'ltr',
    status: 'beta',
    script: 'latin',
    helpFallback: true,
  },
  {
    code: 'fa',
    nativeName: 'فارسی',
    englishName: 'Persian',
    flag: '🇮🇷',
    dir: 'rtl',
    status: 'beta',
    script: 'arabic',
    helpFallback: true,
  },
  // QNBS-v3: Tier-1 expansion (2026) — Russian (Cyrillic). Inter + Merriweather self-host the
  // Cyrillic subset via @fontsource, so no CDN/`:lang()` font wiring is needed.
  {
    code: 'ru',
    nativeName: 'Русский',
    englishName: 'Russian',
    flag: '🇷🇺',
    dir: 'ltr',
    status: 'beta',
    script: 'cyrillic',
    helpFallback: true,
  },
  // QNBS-v3: Tier-1 expansion (2026) — Korean (Hangul). Inter does NOT cover Hangul, so this needs
  // Noto Sans KR via the Google Fonts CDN (index.html) + a `:lang(ko)` font rule (index.css).
  {
    code: 'ko',
    nativeName: '한국어',
    englishName: 'Korean',
    flag: '🇰🇷',
    dir: 'ltr',
    status: 'beta',
    script: 'hangul',
    helpFallback: true,
  },
] as const satisfies ReadonlyArray<LocaleDescriptor>;

/** Union of all supported locale codes — derived from LOCALES so it can never drift. */
export type Language = (typeof LOCALES)[number]['code'];
export type LocaleStatus = LocaleDescriptor['status'];
export type FontScript = LocaleDescriptor['script'];

/** Ordered list of all supported locale codes (Production first, then Beta). */
export const LOCALE_CODES: readonly Language[] = LOCALES.map((l) => l.code);

/** Languages whose natural writing direction is right-to-left. */
export const RTL_LOCALES: ReadonlySet<Language> = new Set(
  LOCALES.filter((l) => l.dir === 'rtl').map((l) => l.code),
);

// QNBS-v3: backward-compatible shape consumed by LanguageSelector/Settings (was hand-maintained in
// I18nContext). `isBeta` is derived from `status` so the two can never disagree.
export interface LanguageInfo {
  code: Language;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  isBeta?: boolean;
  fontScript?: FontScript;
}

export const SUPPORTED_LOCALES: ReadonlyArray<LanguageInfo> = LOCALES.map((l) => ({
  code: l.code,
  nativeName: l.nativeName,
  dir: l.dir,
  fontScript: l.script,
  ...(l.status !== 'production' ? { isBeta: true as const } : {}),
}));

// QNBS-v3: keyed by `string` (not `Language`) so the runtime guard below can call `.has(value)` on a
// checked string without a `value as Language` assertion — the Map IS the source of truth for which
// strings are valid codes. getLocaleInfo still takes a typed Language (assignable to string).
const LOCALE_BY_CODE: ReadonlyMap<string, LocaleDescriptor> = new Map(
  LOCALES.map((l) => [l.code, l]),
);

/** Look up a locale's full descriptor; undefined for unknown codes. */
export const getLocaleInfo = (code: Language): LocaleDescriptor | undefined =>
  LOCALE_BY_CODE.get(code);

/** True when `value` is a supported locale code (runtime-safe guard for persisted/URL values). */
export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && LOCALE_BY_CODE.has(value);
