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
- `sidebar.json` (nav chrome) and `dashboard.json` — **~100 %** translated (EN-identical < 3 %).
- `portal.json` (welcome screen) — **100 %** of localizable strings, including the **17 language-name
  exonyms** (`portal.language.names.<code>`) shown in the `LanguageSelector` subtitle/search. The lone
  EN-identical key is `portal.features.ai.title` = "AI Co-Pilot" (brand term, verbatim by glossary).
- The high-traffic `common.*` action verbs (Save/Cancel/Delete/Close/Undo/… — the ~31 ubiquitous keys).
- Cold-start values (`services/i18nBootstrap.ts`) — native title/logline/chapter-1, no English flash.
- Glossary blocks (`locales/translation-glossary.json`).

**Language picker (`components/ui/LanguageSelector.tsx`):** the visible **exonym** label is resolved
at render time via `t('portal.language.names.<code>')` (no hardcoded UI strings); the **endonym**
(`nativeName` — `Suomi`, `Svenska`, …) stays hardcoded by design so a speaker always finds their own
language regardless of the active UI locale. `portal.language.names.*` is hand-translated for the 5
core + 6 new languages and English-fallback for the other Beta locales (filled by the bulk translator).

**Machine-translated — bulk run completed 2026-06-17 (Beta; human native review pending):**
- All remaining modules (`common`, `writer`, `manuscript`, `settings`, `copilot`, `export`, …) were
  completed via `scripts/bulk-translate-locales.mjs` — glossary-anchored (v2.0, ~44 anchor terms/locale)
  and placeholder-masked. Post-run coverage (translated; EN-identical residual is mostly brand/format
  verbatim terms **plus the English-fallback `help.json`** for the 6 new langs):

  | fi | sv | hu | is | eu | fa | ja | zh | pt | el |
  |----|----|----|----|----|----|----|----|----|----|
  | 91 % | 90 % | 91 % | 92 % | 92 % | 93 % | 99 % | 100 % | 98 % | 97 % |

- **`help.json` stays English fallback** for the new Beta langs and is **excluded from `--all`**
  (`ALL_SKIP` in the bulk script). Its long-form rich HTML cannot be safely machine-translated by the
  free endpoint — the tag-dense markup gets mangled (dropped/duplicated tags → unbalanced HTML)
  even with sentinel masking. Translating it is a **human-review** task; valid English help is shipped
  in the meantime. (ja/zh/pt/el `help.json` were translated in the earlier P1-5 run and are unchanged.)
- Quality bar is **Beta / machine translation**; human native review is the tracked follow-up (checklist
  in [`TRANSLATION-GUIDE.md`](TRANSLATION-GUIDE.md) §6). Measure coverage any time with
  `node scripts/check-i18n-keys.mjs --quality`.

> **Two bugs fixed during this run:** (1) `glossaryTranslate` did partial whole-word substitution and
> returned early, leaving multi-word strings partially English (e.g. "Exportálás your project…") — now
> **exact-match only**; ~1,300 mangled strings were reset + re-translated. (2) The `--all` mode
> translated `help.json` and mangled its HTML — now **excluded from `--all`** and reset to clean
> English fallback. Both fixes are in `scripts/bulk-translate-locales.mjs`.

## Running the bulk translator (glossary-first, placeholder-masked, resumable)

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
