# i18n — Intl.DisplayNames

> **Binding reference.** WorldScript Studio uses native `Intl.DisplayNames` for localized display names of languages, regions, and scripts.

## Overview

The `I18nContext` provides `formatDisplayName(value, type)` for localized names of languages, regions, and scripts.

## Usage

```tsx
const { formatDisplayName } = useTranslation();

// Language names
formatDisplayName('en', 'language'); // "English"
formatDisplayName('ja', 'language'); // "Japanese"

// Region names
formatDisplayName('US', 'region'); // "United States"
formatDisplayName('DE', 'region'); // "Germany"

// Script names
formatDisplayName('Latn', 'script'); // "Latin"
formatDisplayName('Jpan', 'script'); // "Japanese"
```

## Supported Types

- `'language'` — Language names (en, ja, zh, etc.)
- `'region'` — Region/country names (US, DE, FR, etc.)
- `'script'` — Script names (Latn, Jpan, Arab, etc.)

## Supported Locales

All 11 languages can display localized names for other locales:

| Display Locale | Language | Example |
|----------------|----------|---------|
| en | English | "Japanese" |
| de | German | "Japanisch" |
| fr | French | "japonais" |
| es | Spanish | "japonés" |
| it | Italian | "giapponese" |
| ar | Arabic | "اليابانية" |
| he | Hebrew | "היפנית" |
| ja | Japanese | "日本語" |
| zh | Chinese | "日文" |
| pt | Portuguese | "japonês" |
| el | Greek | "Ιαπωνικά" |

## UI Integration Points

- Language selector dropdowns
- Region selectors (for future cloud sync regions)
- Script hints in font selection
- Settings help text for locale features

## Example: Language Selector

```tsx
const { formatDisplayName, language } = useTranslation();

// Show localized language names in selector
const languages = SUPPORTED_LOCALES.map(l => ({
  code: l.code,
  label: formatDisplayName(l.code, 'language'),
}));
```

## Fallback Behavior

If a display name is not available, returns the input value unchanged:

```tsx
formatDisplayName('xyz', 'language'); // "xyz" (fallback)
```
