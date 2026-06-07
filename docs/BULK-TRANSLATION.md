# Bulk Locale Translation Guide

> Infrastructure for translating StoryCraft Studio's i18n keys to Beta languages at scale.

## Current Status (2026-06-07)

| Language | English Placeholders | Translated | Progress |
|----------|---------------------|------------|----------|
| Japanese (ja) | 71.5% (1,672 / 2,340) | 668 | 🟡 Beta |
| Chinese (zh) | 71.5% (1,672 / 2,340) | 668 | 🟡 Beta |
| Portuguese (pt) | 71.7% (1,678 / 2,340) | 662 | 🟡 Beta |
| Greek (el) | 71.8% (1,680 / 2,340) | 660 | 🟡 Beta |

**Goal:** ≤ 5% English placeholders (~117 EN strings max per language).

**Completed files:** portal.json, sidebar.json, dashboard.json, common.json  
**Remaining high-impact files:** settings.json (648), writer.json (80), manuscript.json (67), characters.json (71), worlds.json (52), export.json (92), etc.

---

## Quick Start

### Translate a single file for one language

```bash
node scripts/bulk-translate-locales.mjs --lang=ja --files=writer --delay=400
```

### Translate all remaining files for all Beta languages

```bash
node scripts/bulk-translate-locales.mjs --lang=ja,zh,pt,el --all --delay=400
```

> **Time estimate:** ~12–15 minutes per language for all files (with 400 ms delay).

---

## Script Features

| Feature | Description |
|---------|-------------|
| **Glossary** | `locales/translation-glossary.json` — pre-defined translations for product terms (e.g., "Manuscript", "Dashboard") that should never be machine-translated differently. |
| **Checkpointing** | Progress is saved every 10 keys to `.translation-progress-{lang}-{file}.json`. If interrupted, re-run the same command — it resumes where it left off. |
| **Idempotent** | Already-translated keys (different from EN) are skipped on re-run. |
| **Placeholder-safe** | `{{count}}`, `{{name}}`, etc. are preserved by the translation engine. |
| **Rate limiting** | Configurable delay between requests (default 600 ms). Use 400–500 ms for speed; increase to 800+ if you see rate-limit errors. |
| **Retry logic** | 3 retries with exponential backoff (2s, 4s, 6s) on transient failures. |

---

## Translation Quality

### What works well with machine translation

- Short UI labels: "Save", "Cancel", "Loading…"
- Navigation items: "Dashboard", "Settings", "Export"
- Status messages: "Saving…", "All changes saved"
- Empty states and descriptions

### What needs manual review

- **ProForge loading messages** — creative/prose-like text ("Reading your draft carefully…")
- **Help articles** — long-form HTML content with cultural context
- **Error messages** — technical accuracy matters
- **Palette commands** — slash-command syntax should stay in English
- **Demo content** — story prose should feel natural in the target language

### Glossary overrides

Add fixed translations to `locales/translation-glossary.json`:

```json
{
  "ja": {
    "StoryCraft Studio": "StoryCraft Studio",
    "Manuscript": "原稿",
    "Plot Board": "プロットボード"
  }
}
```

The script checks the glossary **before** making an API call. Glossary entries take precedence.

---

## Using Official APIs (Higher Quality)

The default script uses the free Google Translate endpoint (rate-limited, unofficial). For production-quality translations:

### Option A: Google Cloud Translation API

1. Get an API key from [Google Cloud Console](https://console.cloud.google.com/)
2. Set environment variable:
   ```bash
   export GOOGLE_TRANSLATE_API_KEY=your_key_here
   ```
3. Modify the script to use the official endpoint (see script comments).

### Option B: DeepL API (Recommended for European languages)

1. Sign up for a [DeepL Free plan](https://www.deepl.com/pro-api) (500,000 chars/month)
2. Set environment variable:
   ```bash
   export DEEPL_API_KEY=your_key_here
   ```
3. DeepL generally produces better results for Portuguese and Greek.

---

## Post-Translation Checklist

After running the bulk script:

1. **Validate parity:**
   ```bash
   pnpm run i18n:check
   ```

2. **Rebuild bundles:**
   ```bash
   pnpm run build-i18n
   ```

3. **Check for broken placeholders:**
   ```bash
   grep -r "{{[^{}]*}}" locales/ja/ | grep -v "{{"
   ```
   (Should return nothing — placeholders must be preserved.)

4. **Spot-check critical UI:**
   - Switch to the Beta language in the app
   - Check Welcome Portal, Sidebar, Dashboard, Settings
   - Look for truncated text or awkward phrasing

5. **Update this doc:**
   - Run the metrics script and update the table above
   - Note any files that received manual review

---

## Metrics Update Script

```bash
node -e "
const fs = require('fs');
const enData = {};
for (const f of fs.readdirSync('locales/en').filter(f => f.endsWith('.json'))) {
  Object.assign(enData, JSON.parse(fs.readFileSync('locales/en/' + f, 'utf8')));
}
const enKeys = Object.keys(enData);
for (const lang of ['ja', 'zh', 'pt', 'el']) {
  const langData = {};
  for (const f of fs.readdirSync('locales/' + lang).filter(f => f.endsWith('.json'))) {
    Object.assign(langData, JSON.parse(fs.readFileSync('locales/' + lang + '/' + f, 'utf8')));
  }
  let enCount = 0;
  for (const key of enKeys) {
    if (langData[key] === enData[key]) enCount++;
  }
  console.log(lang + ': ' + ((enCount/enKeys.length)*100).toFixed(1) + '% EN (' + (enKeys.length-enCount) + ' translated)');
}
"
```

---

## Community Contribution

Native speaker review is the final quality gate. If you speak Japanese, Chinese, Portuguese, or Greek:

1. Check `locales/{ja,zh,pt,el}/` for awkward or incorrect translations
2. Focus on `common.json` and `portal.json` (highest visibility)
3. Open a PR with your improvements

See `.github/ISSUE_TEMPLATE/translation_pr.yml` for the translation PR template.
