# i18n — Intl.Collator (ICU Sorting)

> **Binding reference.** StoryCraft Studio uses native `Intl.Collator` for locale-aware string sorting.

## Overview

The `I18nContext` provides `getCollator(options?)` for locale-aware string comparison and `sortByLocale()` helper.

## Usage

```tsx
const { getCollator } = useTranslation();

// Get a collator instance
const collator = getCollator();

// Sort strings
const sorted = [...items].sort((a, b) => collator.compare(a, b));

// With options
const numericCollator = getCollator({ numeric: true, ignorePunctuation: true });
```

## Writing-App Defaults

For a writing application, sensible defaults are applied:

- `numeric: true` — Sorts "Chapter 2" before "Chapter 10"
- `ignorePunctuation: true` — Ignores punctuation for cleaner sorting

## Supported Locales

All 11 languages have native Collator support with appropriate collation rules:

| Language | Code | Special Rules |
|----------|------|---------------|
| English | en | Dictionary order |
| German | de | Umlaut sorting (ä → ae, etc.) |
| French | fr | Accent handling |
| Spanish | es | ñ sorting |
| Italian | it | Accent handling |
| Arabic | ar | Right-to-left collation |
| Hebrew | he | Right-to-left collation |
| Japanese | ja | Hiragana/Katakana/Kanji order |
| Chinese | zh | Pinyin-based sorting |
| Portuguese | pt | Ç → C, Á → A |
| Greek | el | Accented monotonic sorting |

## UI Integration Points

- Character list sorting
- World list sorting
- Scene sorting by title
- Search results ordering
- Tag lists

## Example: Character Sorting

```tsx
const { getCollator } = useTranslation();

// Sort characters by name with locale-aware collation
const sortedCharacters = useMemo(() => {
  const collator = getCollator();
  return [...characters].sort((a, b) => collator.compare(a.name, b.name));
}, [characters, getCollator]);
```

## CJK Note

Japanese and Chinese have complex collation rules. `Intl.Collator` handles:
- Japanese: Hiragana < Katakana < Kanji order
- Chinese: Pinyin-based sorting for Simplified Chinese
