# Translation Guide — WorldScript Studio

> How to add, complete and review translations for WorldScript Studio. Pairs with the binding
> terminology reference in [`I18N-GLOSSARY.md`](I18N-GLOSSARY.md) and the rollout notes in
> [`LANGUAGE-EXPANSION-2026.md`](LANGUAGE-EXPANSION-2026.md).

WorldScript Studio ships **17 locales**: `de` `en` `es` `fr` `it` (core, fully translated) ·
`ar` `he` `fa` (RTL Beta) · `ja` `zh` `pt` `el` `fi` `sv` `hu` `is` `eu` (Beta). Beta locales are
machine-translated (glossary-anchored) and await human native review.

---

## 1. Architecture & build flow

- **No i18next.** A custom React context (`contexts/I18nContext.tsx`) is the runtime. Components read
  strings via `const { t } = useTranslation()` and call `t('module.key.path')`.
- **Source of truth:** `locales/<lang>/<module>.json` — **20 modules** (`common`, `settings`,
  `writer`, `manuscript`, `copilot`, `dashboard`, `outline`, `worlds`, `characters`, `export`,
  `help`, `tour`, `portal`, `templates`, `sidebar`, `tags`, `objects`, `mindmap`, `lora`,
  `characterInterviews`). Files are **flat JSON** — keys are the full dotted path
  (`"portal.welcome.title": "…"`), not nested objects.
- **Runtime bundles:** `pnpm run i18n:bundle` (or `i18n:check`) merges the 20 module files per
  language into `public/locales/<lang>/bundle.json`. **Never hand-edit a bundle** — edit the source
  module and rebuild.
- **English is the reference.** Every locale must hold the exact same key set as `locales/en`
  (parity gate). Missing keys fail CI; extra keys fail CI.

### Commands

```bash
pnpm run i18n:check     # key parity across all 17 locales + rebuild bundles + content guard
pnpm run i18n:bundle    # rebuild public/locales/<lang>/bundle.json only
node scripts/check-i18n-keys.mjs --quality   # report likely-untranslated (EN-identical) strings per locale
node scripts/check-i18n-keys.mjs --fix       # fill MISSING keys in EXISTING files with the EN value (does NOT create files)
pnpm exec vitest run tests/unit/i18nPlaceholders.test.ts   # placeholder/token integrity gate
```

> ⚠️ `--fix` only fills missing keys in files that already exist; it never creates a locale folder or
> file. Seed a new locale by copying EN first: `for f in locales/en/*.json; do cp "$f" locales/<lang>/; done`.

---

## 2. Placeholder & token rules (hard gate)

`tests/unit/i18nPlaceholders.test.ts` enforces these across **all** locales; violations fail CI.

- **Always double-brace:** `{{count}}`, never single `{count}`. Single braces render literally.
- **Never translate or rename a token.** The token name stays the **English canonical** form in every
  locale — `{{count}}`, not `{{anzahl}}` / `{{contagem}}` / `{{recuento}}`.
- **Preserve every token** from the English source; never add tokens the source doesn't have.
- **Surrounding words may be reordered** for grammar; the `{{token}}` itself moves as a unit.

| | Example |
|---|---|
| EN source | `"writer.wordGoal": "{{current}} of {{goal}} words"` |
| ✅ Good (de) | `"{{current}} von {{goal}} Wörtern"` |
| ❌ Bad — translated token | `"{{aktuell}} von {{ziel}} Wörtern"` |
| ❌ Bad — single brace | `"{current} von {goal} Wörtern"` |
| ❌ Bad — dropped token | `"{{current}} Wörter"` |

**Bulk-translate safety:** `scripts/bulk-translate-locales.mjs` masks each `{{token}}` to a sentinel
(`⟦0⟧`) before sending to MT and restores it afterward, because the free endpoint otherwise
translates/drops the inner word. If you translate by hand or with another tool, apply the same care.

---

## 3. Tone & style by category

Keep a concise, modern software register. Match the energy of the English source: **empowering** for
authors/screenwriters, **precise** for technical/AI, **calm and actionable** for errors.

| Category | Guidance | Example (EN → target intent) |
|---|---|---|
| **UI chrome** (buttons, nav, labels) | Short, conventional platform verbs. Use the glossary form. | "Save" → the standard OS verb, not a literary synonym |
| **Creative domain** (manuscript, plot, character, world) | Natural to novelists/screenwriters in the target culture; consistent with the glossary. | "Plot Board", "Subplot", "Scene Revision" |
| **AI tools / Co-Pilot** | Action-oriented and benefit-focused; the assistant is a helpful co-writer, not a robot. **"Co-Pilot" stays verbatim.** | "Improve Writing" → an inviting "make this better" phrasing, not "ameliorate text" |
| **Settings / providers** | Neutral and precise. Keep technical/model names verbatim (`Gemini`, `Ollama`, `WebLLM`, `Qwen3`, `OpenRouter`). | "Hybrid mode", "Local AI" |
| **Errors / warnings** | Clear, empathetic, actionable — say what to do next. | "Invalid API key — open Settings → AI & Models to update it." |
| **Onboarding / tour** | Warm and encouraging; short sentences. | "Welcome", tour step copy |

---

## 4. Glossary usage

`locales/translation-glossary.json` is **lang-first** (`glossary[lang]["English term"] = "translation"`),
keys match the EN source string verbatim (space-form, e.g. `"Plot Board"`). It is the consistency
anchor for Beta locales and is consumed by the bulk translator (exact match first, then case-sensitive
whole-word substitution).

- **Use the glossary term everywhere** a concept appears. No synonyms for core concepts.
- **Verbatim across all langs** (never translate): `WorldScript Studio`, `AI`, `Co-Pilot`, `ProForge`,
  `RAG`, `WebLLM`, `IndexedDB`, format/tech tokens (`PDF`, `DOCX`, `EPUB`, `JSON`, `AES-256`, `Tauri`,
  `LoRA`), version strings, and keyboard combos (`Ctrl+S`).
- **Proposing a new term:** add it to the relevant lang blocks (sparse is fine — a missing entry
  simply falls through to MT), prefer **distinctive Title-Case** terms (lower risk of partial-match
  collisions inside longer strings), bump `_meta.lastUpdated` / `version`, and add a row to
  `I18N-GLOSSARY.md`. Avoid adding very common short words that appear capitalized mid-sentence.

---

## 5. RTL (`ar` / `he` / `fa`)

- **Direction is automatic:** a locale in `RTL_LOCALES` (`contexts/I18nContext.tsx`) makes `App.tsx`
  set `document.documentElement.dir = 'rtl'`. No per-string or per-language CSS is needed.
- **Fonts:** the `[dir="rtl"]` swap in `index.css` points at self-hosted Noto Sans/Naskh Arabic
  (imported in `index.tsx`), covering Persian glyphs (پ چ ژ گ ک ی). No new font import for `fa`.
- **Numerals:** keep Western Arabic digits (0-9) in data and `{{count}}` tokens; Persian/Arabic prose
  may render Eastern digits naturally, but never hardcode them into a `{{token}}`.
- **Layout:** logical Tailwind utilities (`ms-/me-/ps-/pe-/start-/end-`) mirror automatically. Canvas
  & SVG boards (Plot Board, Character Graph) intentionally stay LTR via `.rtl-keep-ltr` so
  pointer/geometry math is correct — do not "fix" them to RTL.

### RTL verification checklist (per RTL locale)
- [ ] App flips to `dir="rtl"`; nav, sidebar, toolbars mirror.
- [ ] Glyphs render (no tofu boxes); Persian letters پ چ ژ گ ک ی display correctly.
- [ ] `{{token}}` interpolation intact and correctly placed in mirrored sentences.
- [ ] Modals, toasts, dropdowns, the command palette open on the correct side.
- [ ] Plot Board / Character Graph stay LTR and remain usable.
- [ ] No clipped/overflowing labels in the sidebar or dashboard cards.

---

## 6. Per-language native-review checklist

Run for each Beta locale before promoting it out of Beta:
- [ ] **Coverage:** `node scripts/check-i18n-keys.mjs --quality` shows ≤ ~5 % EN-identical (excluding intentional verbatim terms).
- [ ] **Chrome:** sidebar, dashboard, portal, settings read naturally; no overflow (watch fi/hu/is compounds).
- [ ] **Creative tools:** manuscript/outline/plot/world/character labels use glossary terms consistently.
- [ ] **AI / Copilot:** tool names + hints are inviting and accurate; "Co-Pilot" kept verbatim.
- [ ] **Settings:** AI modes, providers, Local AI, Voice, Export are precise; tech/model names verbatim.
- [ ] **Errors:** clear and actionable; no literal MT artifacts.
- [ ] **Placeholders:** `pnpm exec vitest run tests/unit/i18nPlaceholders.test.ts` green.
- [ ] **Plurals:** counts flow through `Intl.PluralRules` (never hardcode one/other); note fi/hu/is/fa have one/other.
- [ ] **RTL** (fa): section 5 checklist passes.

---

## 7. Common pitfalls

- **Translating token names** — the #1 CI failure. Tokens are code, not prose.
- **Single braces** `{x}` — render literally; always `{{x}}`.
- **Inconsistent terminology** — use the glossary; don't invent synonyms per module.
- **Editing `public/locales/**/bundle.json`** — generated; edit source modules + rebuild.
- **Hardcoded numerals/dates** — leave formatting to `Intl`; keep data locale-agnostic.
- **Over-eager glossary terms** — a wrong/over-broad anchor propagates via whole-word substitution; prefer distinctive Title-Case terms.
- **"Fixing" canvas boards to RTL** — they are intentionally LTR.

---

## 8. Contribution workflow (new language or keys)

1. **Seed** (new language): copy `locales/en/*.json` → `locales/<code>/`; add the locale to the
   `Language` union + `SUPPORTED_LOCALES` (`I18nContext.tsx`), `LANGUAGE_METADATA`
   (`LanguageSelector.tsx`), `TTS_LOCALE` (`AiScratchpad.tsx`), `I18N_BOOTSTRAP` (`i18nBootstrap.ts`),
   `portal.language.names.<code>` in every locale, and the `LANGS`/`langs` arrays in
   `scripts/check-i18n-keys.mjs` + `scripts/build-i18n.mjs` + `bulk-translate-locales.mjs`. Add `fa`-style
   entries to `RTL_LOCALES` for RTL.
2. **Draft:** `node scripts/bulk-translate-locales.mjs --lang=<code> --all --delay=600`
   (glossary-first, placeholder-masked, checkpointed/resumable). Or hand-translate priority chrome.
3. **Enforce glossary** terms; spot-fix MT artifacts.
4. **Rebuild + gate:** `pnpm run i18n:check && pnpm exec vitest run tests/unit/i18nPlaceholders.test.ts`.
5. **Native review** with the section 6 checklist; **RTL** with section 5.
6. **Docs:** update `I18N-GLOSSARY.md`, `LANGUAGE-EXPANSION-2026.md`, README locale count/list, and the
   `AUDIT.md` quality-gate line.
7. **PR** with the coverage numbers and which gates passed; never add a `biome-ignore` to silence a
   finding (the suppression ratchet fails CI — refactor instead).
