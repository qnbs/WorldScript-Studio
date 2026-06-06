# i18n — Intl.ListFormat

> **Binding reference.** StoryCraft Studio uses native `Intl.ListFormat` for locale-aware list formatting.

## Overview

The `I18nContext` provides `formatList(items, options?)` for formatting lists with locale-aware conjunctions and disjunctions.

## Usage

```tsx
const { formatList } = useTranslation();

// Basic usage (conjunction)
formatList(['Alice', 'Bob', 'Charlie']); // "Alice, Bob, and Charlie" (en)

// Disjunction
formatList(['Yes', 'No'], { type: 'disjunction' }); // "Yes or No" (en)

// Short style
formatList(['A', 'B', 'C'], { style: 'short' }); // "A, B, C" (en)
```

## Options

- `style: 'long'` (default) — Full conjunction: "A, B, and C"
- `style: 'short'` — Minimal: "A, B, C"
- `style: 'narrow'` — Narrowest: "A, B, C"
- `type: 'conjunction'` (default) — "and" style
- `type: 'disjunction'` — "or" style

## Supported Locales

All 11 languages have native ListFormat support:

| Language | Code | Example |
|----------|------|---------|
| English | en | "A, B, and C" |
| German | de | "A, B und C" |
| French | fr | "A, B et C" |
| Spanish | es | "A, B y C" |
| Italian | it | "A, B e C" |
| Arabic | ar | "A، B، وC" |
| Hebrew | he | "A, B ו- C" |
| Japanese | ja | "A、B、およびC" |
| Chinese | zh | "A、B和C" |
| Portuguese | pt | "A, B e C" |
| Greek | el | "A, B και C" |

## UI Integration Points

- Character relationship lists
- Tag lists in export summaries
- Linked items in scene cards
- Multi-select action summaries
- Help article tag lists

## Example: Character Relationships

```tsx
const { formatList } = useTranslation();

// Format related characters
const relatedNames = character.related.map(r => r.name);
const formatted = formatList(relatedNames); // "Alice, Bob, and Charlie"
return <span>{formatted}</span>;
```

## CJK Note

Japanese and Chinese use their respective list separators:
- Japanese: "、" (ten) for items, "および" for conjunction
- Chinese: "、" for items, "和" for conjunction
