# i18n Audit & Improvement Plan

> Phase-0 audit of the WorldScript Studio internationalization subsystem and the staged plan to
> harden it. Reconciles the i18n master prompts against the **actual** codebase (flat layout, custom
> `I18nContext`, not i18next). Companion: [ADDING_A_NEW_LANGUAGE](./ADDING_A_NEW_LANGUAGE.md),
> [IMPLEMENTATION_LOG](./IMPLEMENTATION_LOG.md).

## 1. Current state (as audited)

- **17 locales × 21 modules**, ~2793 keys, full **key parity** enforced by
  `scripts/check-i18n-keys.mjs` (CI `quality` job) + bundled to `public/locales/<lang>/bundle.json`.
- Runtime: custom `contexts/I18nContext.tsx` — lazy `bundle.json` fetch, `localStorage` persistence
  (`worldscript-language`), English fallback chain, cached `Intl.*` helpers, `Intl.Segmenter` word
  counting for CJK. `<html lang>`/`<dir>` set in `App.tsx`; `enableRtlLayout` flag can force RTL.
- **RTL** (`ar`/`he`/`fa`) has a mature foundation: logical Tailwind utilities + a `[dir="rtl"]`
  safety net + `.rtl-keep-ltr` for canvas/SVG coordinate islands.
- **Translation** is produced by a **networked** machine-translation script
  (`scripts/bulk-translate-locales.mjs`, glossary-anchored, placeholder-masked, resumable). Offline
  scripts only produce English-placeholder parity.

## 2. Gaps found

| # | Gap | Severity |
|---|-----|----------|
| G1 | **No SSOT for locale metadata** — codes/names/flags/dir/status duplicated across ~8 places (`I18nContext`, `LanguageSelector`, three `.mjs` scripts, the placeholder test, `i18nBootstrap`, `AiScratchpad`). Adding a language meant editing all of them. | High |
| G2 | **Dead font wiring** — `--font-ui-cjk` / `--font-ui-greek` existed but no selector consumed them; ja/zh/el fell through the Latin base stack. `Noto Naskh Arabic` was in the RTL editor stack but never fetched. | Medium |
| G3 | **No quality visibility** — parity checks key coverage only; nothing reported per-locale translation coverage, placeholder integrity, length-overflow risk, or glossary adoption. | Medium |
| G4 | **Stale contributor docs** — `CONTRIBUTING.md` / issue templates still said "5 locales" while 17 ship. | Low |
| G5 | **No variant support** — `Language` and all paths assume short 2-letter codes; `pt-BR`/`zh-Hant` need a BCP-47 change. | Deferred |

## 3. What this program does

- **PR1 (this) — infrastructure & audit:** SSOT registry `i18n/locales.ts` (G1); the `.mjs` scripts
  derive their lists from the filesystem via `scripts/i18n-locales.mjs`, kept in sync by
  `tests/unit/i18n/localesRegistry.test.ts`. Font wiring via `:lang()` + Noto Naskh Arabic (G2).
  `scripts/i18n-quality-report.mjs` + `pnpm run i18n:report` (G3). Playbook + this audit + impl log.
- **PR2/PR3 — add `ru` (Cyrillic) and `ko` (Hangul)** as Beta, via the new playbook.
- **PR4 — Beta-to-Production:** status-tier system (the registry already carries `status`),
  glossary expansion, help-content strategy + UI indicator, status dashboard. (G4 truth-up rides
  along where touched.)
- **Deferred:** BCP-47 variants (G5), Tier 2/3 languages, the 2026–2028 scale roadmap.

## 4. Risks

- MT is networked + rate-limited (`--delay=600`, resumable). `help.json` intentionally stays English
  fallback for Beta locales (tag-dense HTML the free endpoint mangles).
- The `Language` union must stay a literal union (derived via `as const`) for exhaustiveness — the
  typecheck gate enforces this.
- PR-size ≤ ~100 files so CodeAnt reviews each PR; language content fans out, so they are stacked.
