# i18n — Intl.Locale API

> **Binding reference.** WorldScript Studio uses native `Intl.Locale` for locale metadata and BCP47 tag handling.

## Overview

The `SUPPORTED_LOCALES` constant in `I18nContext.tsx` provides structured locale metadata:

```typescript
export interface LanguageInfo {
  code: Language;
  nativeName: string;
  dir: 'ltr' | 'rtl';
  isBeta?: boolean;
  fontScript?: 'latin' | 'arabic' | 'hebrew' | 'cjk' | 'cyrillic' | 'greek';
}
```

## Supported Locales

| Code | Native Name | Direction | Script | Beta |
|------|-------------|-----------|--------|------|
| en | English | ltr | latin | no |
| de | Deutsch | ltr | latin | no |
| fr | Français | ltr | latin | no |
| es | Español | ltr | latin | no |
| it | Italiano | ltr | latin | no |
| ar | العربية | rtl | arabic | yes |
| he | עברית | rtl | hebrew | yes |
| ja | 日本語 | ltr | cjk | yes |
| zh | 简体中文 | ltr | cjk | yes |
| pt | Português | ltr | latin | yes |
| el | Ελληνικά | ltr | greek | yes |

## Usage

```tsx
import { SUPPORTED_LOCALES } from '../contexts/I18nContext';

// Find locale info
const localeInfo = SUPPORTED_LOCALES.find(l => l.code === 'ja');
// { code: 'ja', nativeName: '日本語', dir: 'ltr', fontScript: 'cjk', isBeta: true }

// Check if RTL
const isRtl = localeInfo?.dir === 'rtl';

// Get font stack hint
const fontScript = localeInfo?.fontScript; // 'cjk'
```

## Font Script Mapping

The `fontScript` property maps to CSS font variables:

- `latin` → `--font-ui` (Inter) / `--font-editor` (Merriweather)
- `arabic` → `--font-ui-rtl` / `--font-editor-rtl` (Noto Sans Arabic / Noto Naskh Arabic)
- `hebrew` → `--font-ui-rtl` / `--font-editor-rtl` (Noto Sans Hebrew)
- `cjk` → `--font-ui-cjk` (Noto Sans Japanese)
- `greek` → `--font-ui-greek` (Noto Sans Greek)

## Language Switch Logic

When switching languages:

1. `setLanguage()` clears all Intl caches
2. `document.documentElement.lang` is updated
3. `dir` attribute is derived from `RTL_LOCALES` set
4. Font stack is applied via CSS `[dir="rtl"]` or script-specific classes

## BCP47 Compatibility

All language codes follow BCP47:

- `ja` — Japanese (no region specified, uses system default)
- `zh` — Chinese (simplified, implicit)
- `pt` — Portuguese (Brazilian preferred for localization)
- `el` — Greek (monotonic/modern)
