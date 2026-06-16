# i18n — CLDR Plural Rules

> **Binding reference.** WorldScript Studio uses native `Intl.PluralRules` for CLDR-compliant plural handling.

## Overview

The `I18nContext` provides `getPluralCategory(count)` which returns the CLDR plural category for a given count in the active language:

- `one` — singular (e.g., "1 day")
- `other` — plural (e.g., "2 days")
- `many` — used in Arabic, Polish, Russian, etc.
- `few` — used in Arabic, Polish, Russian, etc.
- `zero` — used in Arabic, French (for some nouns)

## Usage

```tsx
const { getPluralCategory, t } = useTranslation();

// Get plural category
const category = getPluralCategory(5); // 'other' in English

// Use in translation keys
const key = `dashboard.goals.daysLeft_${category}`; // 'dashboard.goals.daysLeft_other'
```

## Supported Languages

| Language | Code | Plural Categories |
|----------|------|-----------------|
| English | en | one, other |
| German | de | one, other |
| French | fr | one, other |
| Spanish | es | one, other |
| Italian | it | one, other |
| Arabic | ar | zero, one, two, few, many, other |
| Hebrew | he | one, other |
| Japanese | ja | other (no plural distinction) |
| Chinese | zh | other (no plural distinction) |
| Portuguese | pt | one, other |
| Greek | el | one, other |

## Implementation Notes

- **Caching**: PluralRules instances are cached per language in `pluralRuleCache`
- **Fallback**: If a plural-specific key is missing, falls back to `other` variant
- **Number formatting**: The `t()` function auto-formats `{{count}}` values using `Intl.NumberFormat`

## Example: Days Left

```json
// locales/en/dashboard.json
{
  "dashboard.goals.daysLeft_one": "{{count}} day left",
  "dashboard.goals.daysLeft_other": "{{count}} days left",
  "dashboard.goals.daysLeft_few": "{{count}} days left",
  "dashboard.goals.daysLeft_many": "{{count}} days left"
}
```

```tsx
const { t, getPluralCategory } = useTranslation();
const daysLeft = 5;
const category = getPluralCategory(daysLeft);
const key = `dashboard.goals.daysLeft_${category}`;
return t(key, { count: daysLeft }); // "5 days left"
```

## CJK Note

Japanese and Chinese do not have grammatical plural forms. All counts return `other`. This is handled correctly by CLDR.
