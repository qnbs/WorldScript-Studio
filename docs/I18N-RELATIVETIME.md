# i18n — Intl.RelativeTimeFormat

> **Binding reference.** WorldScript Studio uses native `Intl.RelativeTimeFormat` for relative time formatting.

## Overview

The `I18nContext` provides `formatRelativeTime(value, unit)` for formatting relative times like "yesterday", "in 2 days", "last week".

## Usage

```tsx
const { formatRelativeTime } = useTranslation();

// Basic usage
formatRelativeTime(-1, 'day'); // "yesterday" (en) / "gestern" (de)
formatRelativeTime(2, 'day'); // "in 2 days" (en) / "in 2 Tagen" (de)
formatRelativeTime(-3, 'hour'); // "3 hours ago"

// Units supported
// - 'year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second'
```

## Options

- `numeric: 'auto'` (default) — Uses colloquial terms like "yesterday", "tomorrow" when possible
- `numeric: 'always'` — Always uses numeric format like "1 day ago", "2 days ago"

## Supported Locales

All 11 languages have native RelativeTimeFormat support:

| Language | Code | Example (1 day ago) |
|----------|------|-------------------|
| English | en | "yesterday" |
| German | de | "gestern" |
| French | fr | "hier" |
| Spanish | es | "ayer" |
| Italian | it | "ieri" |
| Arabic | ar | "أمس" |
| Hebrew | he | "אתמול" |
| Japanese | ja | "昨日" |
| Chinese | zh | "昨天" |
| Portuguese | pt | "ontem" |
| Greek | el | "εχθές" |

## UI Integration Points

- Dashboard: Last edited timestamps
- Progress tracker: Session times
- Version control: Snapshot ages
- Auto-save indicators: Time since last save

## Example

```tsx
const { formatRelativeTime, t } = useTranslation();

// In a component showing last edited time
const lastEdited = formatRelativeTime(-1, 'day'); // "yesterday"
return <span>{t('dashboard.header.lastEdited', { title: lastEdited })}</span>;
```
