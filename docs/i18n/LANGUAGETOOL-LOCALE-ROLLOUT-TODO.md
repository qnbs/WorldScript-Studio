# TODO — LanguageTool program: new-locale rollout + closing items

> **Status: NOT STARTED — deferred for later execution.** This is the remaining tail of the
> "i18n hardening + 5 new locales + real LanguageTool" program. The LanguageTool *engine* work is
> **done and merged** (see below); what remains is the **language curation / addition** half plus the
> locale-dependent closing docs. Pick this up after the other planned work — do **not** start it
> inline. This file is self-contained; the original execution plan file may be overwritten in the
> meantime, so everything needed is captured here.

## 0. What is already DONE (merged to `main`, 2026-06-24/25)

| PR | Scope |
|----|-------|
| #234 | Phase-0 report (`ADAPTIVE_CURRENT_STATE_REPORT_v3.md`) + Workstream B: SSOT `i18n/locales.ts` enriched with `languageToolSupport` + `languageToolCode` (all 19 locales) + helpers; Review & Elevation Log seeded in `TRANSLATION_STATUS.md` |
| #235 | `services/languageToolService.ts` — real `checkText` + offset-safe `applyMatchReplacement` (13 tests) |
| #236 | PR-C1 MVP: `useLanguageToolCheck` hook + `GrammarCheckPanel` ("Check this scene") + 14 `writer.grammar.*` i18n keys ×19 locales |
| #237 | DeepSource runbook updated (inline resolvable threads) |
| #238 | PR-C2: live inline grammar overlay + popover in `ManuscriptEditor` |
| #239 | Docs: `docs/LANGUAGETOOL.md`, ADR 0010, CHANGELOG, README |

**Net:** real self-hosted LanguageTool grammar/spell checking is live for all currently-supported
locales. The remaining work below is **purely the 5 new UI locales + the locale-dependent closing
docs**. Nothing in the engine needs changing.

## 1. Workstream A — add 5 new UI locales (one stacked PR each)

Add **pl, nl, tr, uk, ro** — high creative-writing demand. Of these, LanguageTool supports
**pl/nl/uk = strong, ro = partial, tr = none** (verified; see `ADAPTIVE_CURRENT_STATE_REPORT_v3.md §5`).
Turkish still gets the UI locale; its grammar feature is simply absent (`languageToolSupport: 'none'`),
exactly like he/fi/hu/is/eu/ko.

### Per-locale recipe (reuse the existing pipeline — do NOT hand-roll)

Follow [`ADDING_A_NEW_LANGUAGE.md`](./ADDING_A_NEW_LANGUAGE.md). For each locale `<xx>`:

1. **SSOT** — add a `LocaleDescriptor` to `i18n/locales.ts` with `status: 'beta'`, correct
   `nativeName` (endonym), `englishName`, `flag`, `dir: 'ltr'`, `script: 'latin'` (all 5 are Latin),
   `helpFallback: true`, **and the LanguageTool metadata**:
   - `pl` → `languageToolSupport: 'strong'`, `languageToolCode: 'pl-PL'`
   - `nl` → `languageToolSupport: 'strong'`, `languageToolCode: 'nl'`
   - `uk` → `languageToolSupport: 'strong'`, `languageToolCode: 'uk-UA'`
   - `ro` → `languageToolSupport: 'partial'`, `languageToolCode: 'ro-RO'`
   - `tr` → `languageToolSupport: 'none'` (no `languageToolCode`)
2. **Locale folder** — create `locales/<xx>/` with all module JSON files. Seed high-traffic chrome by
   hand (common/sidebar/portal/onboarding) + the `i18nBootstrap` native strings; then run
   `scripts/bulk-translate-locales.mjs` (glossary-anchored, placeholder-masked) for the rest. `help.json`
   stays **English fallback** (tag-dense HTML isn't safely machine-translatable — matches policy;
   `helpFallback: true`).
3. **Script lists** — add `<xx>` wherever the `.mjs` scripts derive their locale list from the
   filesystem if needed (`scripts/check-i18n-keys.mjs`, `build-i18n.mjs`, `i18n-locales.mjs`); the
   registry-integrity test (`tests/unit/i18n/localesRegistry.test.ts`) asserts SSOT ↔ folders match.
4. **Exonym** — add `portal.language.names.<xx>` (the in-UI exonym) to all locales; keep the native
   endonym in `i18n/locales.ts` hardcoded.
5. **Fonts** — all 5 are Latin → no CDN/`:lang()` font wiring needed (Inter/Merriweather cover them).
6. **Bundles** — `pnpm run i18n:bundle`; verify `pnpm run i18n:check` (parity) + the
   `i18nPlaceholders` test (no single-brace `{x}`, no translated/dropped placeholder names).
7. **Elevation log** — append a row to the Review & Elevation Log in `TRANSLATION_STATUS.md` (status
   `beta`, basis = MT + parity, no native review yet — honest tiering).
8. **Per-PR gate** (one heavy shell at a time): `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`
   + `pnpm exec vitest run tests/unit/i18n/localesRegistry.test.ts tests/unit/i18nPlaceholders.test.ts`.

### Glossary
Before bulk-MT, extend [`../I18N-GLOSSARY.md`](../I18N-GLOSSARY.md) with anchor terms for each new
locale (the canonical Manuscript/Outline/Snapshot/Co-Pilot/etc. translations) so `bulk-translate` stays
consistent.

### PR sequencing
One **stacked** PR per locale (D–H): `pl` → `nl` → `tr` → `uk` → `ro`. i18n fan-out is the heaviest of
the program (each locale = ~20 module JSON + rebuilt bundles), so **one locale per PR** keeps each diff
reviewable and under the ~100-file limit that the review bot needs. Run the **DeepSource correction
loop** on each (fix status-red findings, resolve inline `deepsource-io` threads — see
[`../DEEPSOURCE-REVIEW-LOOP.md`](../DEEPSOURCE-REVIEW-LOOP.md)).

### Deferred (do NOT add now → ROADMAP only)
`pt-BR` and additional Chinese variants — add to `ROADMAP.md` as future locale work, not this program.

## 2. Closing / locale-dependent docs (after the 5 locales land)

These were intentionally **left out** of the LanguageTool docs PR (#239) because they depend on the
locale count changing from 19 → 24:

- **README** — update the i18n badge/line and the "Quality tiers" section from **19 → 24 locales**;
  add pl/nl/tr/uk/ro to the Beta tier list. (Metrics badges auto-sync via `sync-readme-metrics.mjs` —
  do not hand-edit the generated numbers; only the prose locale list.)
- **`TRANSLATION_STATUS.md`** — add the 5 new per-locale rows + their elevation-log entries.
- **`docs/LANGUAGE-EXPANSION-2026.md`** — note the pl/nl/tr/uk/ro addition.
- **`docs/LANGUAGETOOL.md` §4** — the coverage lists already include pl/nl/tr/uk/ro (written ahead);
  re-verify they match the shipped `i18n/locales.ts` once the locales are in.
- **Final handover report** — write `docs/i18n/FINAL_IMPLEMENTATION_AND_HANDOVER_REPORT.md`
  summarizing the whole program (engine + locales), the self-assessment, and residual debt (native
  review of Beta locales, single-word inline limitation, no bundled LT server).

## 3. Verification (whole tail)

- Each new locale: `i18n:check` parity green + `i18nPlaceholders` green; switch the UI to the locale →
  chrome renders translated, no raw keys, LTR direction correct.
- LanguageTool: for pl/nl/uk/ro, with a local server running (`docker run -p 8010:8010
  erikvl87/languagetool`) and the locale active, "Check this scene" returns findings and applies them;
  for **tr**, the grammar UI is **absent** (panel hidden) — confirm no console errors.
- Full DeepSource loop quiescent + codecov/patch green + all CI green before each merge.

## 4. Gotchas (learned this program — apply on resume)

- **DeepSource analyzes `tests/`** and posts **inline resolvable threads**; rename short `const`/`let`
  (JS-C1002), declare-before-use (JS-0357), avoid single-child fragments (JS-0424); resolve every
  `deepsource-io` thread. (Full loop: `../DEEPSOURCE-REVIEW-LOOP.md`.)
- **Flat, insertion-ordered locale JSON** — do **not** run `check-i18n-keys.mjs --fix` (it re-sorts →
  churn); inject new keys in place (a small Python `OrderedDict` script worked well this program).
- **Placeholders are double-brace** `{{count}}`; the `i18nPlaceholders` guard rejects single-brace.
- **`codecov/patch`** needs the diff's branches tested — but pure locale PRs add no JS branches, so
  codecov should be a non-issue for Workstream A.
- **Low-end hardware:** one heavy shell per turn; `typecheck` needs a long timeout (~300s).
