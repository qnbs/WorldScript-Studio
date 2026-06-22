# i18n Program — Implementation Log

Chronological record of the i18n language-addition + perfection program. Each PR runs the
[CodeAnt correction loop](../CODEANT-REVIEW-LOOP.md) to quiescence, then admin-squash-merges.

## PR1 — Infrastructure, SSOT & audit (in progress)

**Goal:** make every later language addition a one-entry change; surface translation quality; document
the process. No new languages → small i18n fan-out.

- **SSOT registry** `i18n/locales.ts` — `LOCALES` (`as const`) is the single source for code,
  nativeName, englishName, flag, dir, `status` (production/near-production/beta), script, helpFallback.
  Derives `Language` (literal union), `RTL_LOCALES`, `SUPPORTED_LOCALES`, `LOCALE_CODES`, `isLanguage`,
  `getLocaleInfo`.
  - **Rationale:** locale metadata was duplicated across ~8 files; adding a language touched all of
    them, inviting drift (e.g. a flag in `LanguageSelector` but not `SUPPORTED_LOCALES`).
- **Rewired consumers:** `contexts/I18nContext.tsx` re-exports from the registry (keeps the 16 existing
  import sites working) and validates persisted locale via `isLanguage` (was a hand-kept
  `VALID_LANGS`); `components/ui/LanguageSelector.tsx` derives `LANGUAGE_METADATA` from the registry.
- **`.mjs` SSOT bridge** `scripts/i18n-locales.mjs` — `getLocales()`/`getModules()`/`getMtLocales()`
  derive code/module lists from the filesystem (scripts can't import TS). `check-i18n-keys.mjs`,
  `build-i18n.mjs`, `bulk-translate-locales.mjs` now use it (removed three hand-kept lists +
  the bulk translator's name table → `Intl.DisplayNames`). `tests/unit/i18nPlaceholders.test.ts`
  imports `LOCALE_CODES`. `tests/unit/i18n/localesRegistry.test.ts` asserts registry == filesystem.
- **Font wiring** — `index.css`: `:lang(ja)/:lang(zh)` → `--font-ui-cjk`, `:lang(el)` →
  `--font-ui-greek` (these vars existed but nothing consumed them). `index.html`: added
  `Noto Naskh Arabic` (it leads the RTL editor stack but was never fetched).
- **Quality tooling** — `scripts/i18n-quality-report.mjs` + `pnpm run i18n:report`: per-locale
  coverage, placeholder integrity, length-overflow risk, glossary-term count (non-gating; basis for
  the PR4 dashboard). The length heuristic flags only over-length (CJK is legitimately compact).
- **Docs** — this log, `AUDIT_AND_IMPROVEMENT_PLAN.md`, `ADDING_A_NEW_LANGUAGE.md`.

**Verification:** `lint` + `typecheck` clean; `i18n:check` parity OK (17 bundles rebuilt);
`i18nPlaceholders` (33) + `localesRegistry` (7) green; `i18n:report` shows placeholder issues 0 across
all locales (consistent with the hard gate).

## PR2 — Russian (`ru`) · in review

First language added via the new playbook (Cyrillic, Beta). **One** `LOCALES` registry entry — no
font work needed (Inter + Merriweather self-host the Cyrillic subset via @fontsource). Scaffolded
`locales/ru/` from `en/`, seeded a 44-term `ru` glossary block, ran
`bulk-translate-locales.mjs --lang=ru --all` (glossary-anchored, placeholder-masked) + `i18n:bundle`.
Wiring: `i18nBootstrap` cold-start, `AiScratchpad` TTS (`ru-RU`), `portal.language.names.ru` exonym in
all 18 locales, README. **Coverage 94%, 0 placeholder issues** (`help.json` stays English by design).
Verification: parity OK (18 bundles), typecheck clean, registry + placeholder tests green.

## PR3 — Korean (`ko`) · in review

Hangul, Beta. Unlike Russian, Hangul is **not** in the Inter/@fontsource set, so this added font
wiring: `Noto Sans KR` to the Google Fonts CDN (`index.html`), a `--font-ui-kr` var + `:lang(ko)`
rule (`index.css`), and `'hangul'` to `LocaleDescriptor['script']`. Otherwise identical to the ru
flow: registry entry, scaffold, 44-term `ko` glossary, `bulk-translate --lang=ko --all`,
`i18nBootstrap` cold-start, TTS (`ko-KR`), `portal.language.names.ko` in all 19 locales, README.
**Coverage 94%, 0 placeholder issues.** Verification: parity OK (19 bundles), typecheck clean,
registry + placeholder + I18nContext tests green (the count assertion is now registry-derived).

## PR4 — Beta-to-Production elevation · planned
