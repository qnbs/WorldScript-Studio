# Language Expansion 2026 — +6 Locales (fi, sv, hu, is, eu, fa)

WorldScript Studio went from **11 → 17** shipped locales. This phase adds Finnish (`fi`), Swedish
(`sv`), Hungarian (`hu`), Icelandic (`is`), Basque (`eu`) and Persian/Farsi (`fa`, **RTL**). All six
ship as **Beta** (`isBeta: true`) and reuse the proven Beta-stub → bulk-translate → human-QA pipeline
that delivered ja/zh/pt/el (P1-5).

## Why these six

- **Nordic reach:** Swedish + Finnish + Icelandic cover the Nordic writing market.
- **Uralic:** Hungarian and Finnish exercise the agglutinative/long-compound layout edge cases.
- **Basque (`eu`):** a non-Indo-European European language; validates short-string discipline.
- **Persian (`fa`):** the third RTL locale (after `ar`/`he`), in Arabic script — exercises the
  RTL pipeline end-to-end with a fresh language.

## What shipped vs. what's machine-pending

**Hand-translated to production quality (all 6 langs):**
- `portal.json` (welcome screen), `sidebar.json` (nav chrome), `dashboard.json`, and the
  high-traffic `common.*` action verbs.
- Cold-start values (`services/i18nBootstrap.ts`) — native title/logline/chapter-1, no English flash.
- Glossary blocks (`locales/translation-glossary.json`).

**English-fallback stubs (parity-green) — awaiting the bulk job + human QA:**
- The other 16 modules (`writer`, `manuscript`, `settings`, `help`, `export`, …). They pass the
  `i18n:check` parity gate as EN stubs and are filled by the user-run bulk translator.

## Running the bulk translator (user-run; the agent makes no network calls)

```bash
node scripts/bulk-translate-locales.mjs --lang=fi,sv,hu,is,eu,fa --all --delay=600
pnpm run i18n:bundle
```

Script features (`scripts/bulk-translate-locales.mjs`):
- **Glossary-first** — `locales/translation-glossary.json` (lang-first `glossary[lang][term]`)
  takes priority over machine translation.
- **Placeholder masking** — `{{token}}` is masked to a sentinel (`⟦0⟧`) before MT and restored
  after, so the engine can't translate or drop interpolation tokens.
- **Checkpointing** — `.translation-progress-<lang>-<file>.json`; re-runs resume.
- **`--dry-run`** — reports per-file key counts + glossary hits with no network calls and no writes.

Estimate progress with the quality scanner:

```bash
node scripts/check-i18n-keys.mjs --quality   # lists likely-untranslated (EN-identical) strings per locale
```

The English-placeholder % trends toward 0 as bulk + human QA complete the non-priority modules.

## RTL (`fa`) notes

- Direction is automatic: `fa` is in `RTL_LOCALES` (`contexts/I18nContext.tsx`), and
  `App.tsx` sets `document.documentElement.dir = 'rtl'` from it. No per-language CSS needed.
- Fonts: the `[dir="rtl"]` font swap in `index.css` already points at Noto Sans/Naskh Arabic
  (imported in `index.tsx`), which cover Persian glyphs (پ چ ژ گ ک ی). No new font import.
- BiDi edge cases: Canvas/SVG boards (Plot/Scene board) opt out of mirroring via `.rtl-keep-ltr`
  so geometry math stays LTR; tables and logical Tailwind utilities (`ms-/me-/ps-/pe-`) flip
  automatically. A full BiDi QA pass over `fa` is tracked with the `ar`/`he` v2.0 work.

## Layout watch-list (long-compound languages)

`fi` / `hu` / `is` produce longer compounds than English (e.g. *Johdonmukaisuustarkistus*,
*Konzisztencia-ellenőrző*, *Samkvæmnisprófun* for "Consistency Checker"). Spot-check the sidebar and
dashboard cards for overflow; prefer the shorter glossary form where space is tight.

## Glossary

See [`I18N-GLOSSARY.md`](I18N-GLOSSARY.md). The glossary stays **lang-first** and its keys match the
English source strings verbatim (space-form, e.g. `"Plot Board"`).
