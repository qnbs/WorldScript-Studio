# i18n — Intl.NumberFormat

> **Binding reference.** WorldScript Studio uses native `Intl.NumberFormat` for locale-aware number formatting.

## Overview

The `I18nContext` provides `formatNumber(value, options?)` for formatting numbers with locale-aware grouping, decimal places, and currency.

## Usage

```tsx
const { formatNumber, t } = useTranslation();

// Basic formatting (no decimals, grouped thousands)
formatNumber(1234567); // "1,234,567" (en) / "1.234.567" (de)

// With options
formatNumber(0.875, { style: 'percent' }); // "88%" (en) / "88 %" (de)
formatNumber(1234.56, { maximumFractionDigits: 2 }); // "1,234.56"
formatNumber(1500000, { notation: 'compact' }); // "1.5M"
```

## Writing-App Defaults

For a writing application, sensible defaults are applied:

- `maximumFractionDigits: 0` — Word counts, character counts, and stats are integers
- `minimumFractionDigits: 0` — No forced decimal places
- Grouping is enabled by default (thousands separators)

## Supported Locales

All 11 supported languages have proper number formatting:

| Language | Code | Thousands Separator | Decimal Separator |
|----------|------|---------------------|-------------------|
| English | en | `,` | `.` |
| German | de | `.` | `,` |
| French | fr | ` ` (space) | `,` |
| Spanish | es | `.` | `,` |
| Italian | it | `.` | `,` |
| Arabic | ar | `,` | `.` |
| Hebrew | he | `,` | `.` |
| Japanese | ja | `,` | `.` |
| Chinese | zh | `,` | `.` |
| Portuguese | pt | `.` | `,` |
| Greek | el | `.` | `,` |

## Integration with t()

The `t()` function automatically formats `{{count}}` placeholders:

```tsx
const { t } = useTranslation();
t('dashboard.stats.characters', { count: 42 }); // "42" formatted per locale
```

## Examples in UI

- Dashboard stats: Character count, word count, scene count
- Progress tracker: Goal progress, streak counts
- Settings: Max tokens, rate limits
- Export: File sizes, page counts
