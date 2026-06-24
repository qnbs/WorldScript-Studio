# Adaptive Current-State Report v3 — i18n hardening + LanguageTool editor integration

> **Mandatory Phase-0 deliverable** for the "i18n hardening + 5 new locales + real LanguageTool"
> program. This is read-only ground truth captured before any feature code, so the work *extends* the
> existing system rather than reinventing it. Status fields below are accurate as of **2026-06-24**.

## 1. Locale inventory (SSOT: `i18n/locales.ts`)

19 locales, each a typed `LocaleDescriptor` in the single source of truth. The `.mjs`
build/check/translate scripts derive their list from the `locales/<code>/` folders; the
`tests/unit/i18n/localesRegistry.test.ts` integrity guard asserts the two never drift.

| Tier | Locales | Notes |
|------|---------|-------|
| **Production** (5) | de, en, es, fr, **it** | full key parity + translated `help.json` (`helpFallback: false`) |
| **Near-Production** (4) | ja, zh, pt, el | ≥96% UI coverage, 0 placeholder issues; `help.json` still English-fallback |
| **Beta** (10) | ar, he (RTL); fi, sv, hu, is, eu; fa (RTL); ru, ko | UI coverage varies; `help.json` English-fallback |

`status` drives the README badge + `LanguageSelector` β-badge (`isBeta` = the *beta* tier specifically,
so Near-Production is distinguished from Beta). RTL = ar/he/fa. Scripts: latin/arabic/hebrew/cjk/
greek/cyrillic/hangul (font wiring per script; Korean needs Noto Sans KR via CDN, Cyrillic self-hosts).

## 2. LanguageTool reality — scaffold only, NOT a working grammar checker

- **`services/languageToolClient.ts`** is a **gate + connectivity ping**, nothing more:
  - `assertLanguageToolAllowed(settings, baseUrl)` — throws if the LT integration is disabled, the URL
    is invalid, or `privacy.localStorageOnly` is on **and** the host is not `localhost`/`127.0.0.1`
    (privacy-first: remote LT blocked in local-only mode).
  - `languageToolPing(baseUrl, sampleText)` — a single `POST /v2/check` with `language=en-US` that
    returns `res.ok`. **It does not parse `matches[]`, does not surface issues, and is hardcoded to
    English.** No real grammar checking exists anywhere in the editor.
- **The Writer "grammar check" is unrelated** — `hooks/useWriterView.ts` `grammarCheck` is an
  **AI/Gemini prompt**, not LanguageTool.
- **Settings surface already exists**: `components/settings/IntegrationsSection.tsx` renders the
  LanguageTool card; settings shape is `integrations.languageToolEnabled` (default **false**) +
  `integrations.languageToolBaseUrl` (default `http://localhost:8010`). This is the scaffold PR-C
  builds on — no new Settings plumbing required for enable/baseURL.

## 3. Editor seam for inline underlines (`components/manuscript/ManuscriptEditor.tsx`)

The editor is a **plain `<textarea>` with an aligned highlight overlay** — an `absolute inset-0 …
pointer-events-none overflow-auto` layer that renders the same text with the **exact same font stack**
as the textarea so glyphs stay aligned (it already powers search-term highlights and is RTL-aware).
**LanguageTool underlines reuse this exact technique**: map LT match `offset`/`length` → overlay spans
with an underline decoration; a hover/click popover (PR-C2) hangs off those spans. No new editor
architecture is needed — only a second overlay decoration source.

## 4. Existing docs / tooling to extend (do NOT duplicate)

- `docs/i18n/`: `ADDING_A_NEW_LANGUAGE.md`, `BETA_TO_PRODUCTION_PLAYBOOK.md`, `BETA_QUALITY_AUDIT.md`,
  `TRANSLATION_STATUS.md`, `AUDIT_AND_IMPROVEMENT_PLAN.md`, `BETA_COMPLETION_LOG.md`, `IMPLEMENTATION_LOG.md`.
- `docs/`: `I18N-GLOSSARY.md`, `TRANSLATION-GUIDE.md`, `LANGUAGE-EXPANSION-2026.md`, `BULK-TRANSLATION.md`.
- `scripts/bulk-translate-locales.mjs` (glossary-anchored, placeholder-masked, `--dry-run`),
  `check-i18n-keys.mjs`, `build-i18n.mjs`, `i18n-locales.mjs`.

The 5 new locales route through `ADDING_A_NEW_LANGUAGE.md` + `bulk-translate-locales.mjs`; tier
decisions extend `TRANSLATION_STATUS.md` (see the Review & Elevation Log added there) rather than a new
file.

## 5. **Verified LanguageTool support matrix** (dev.languagetool.org/languages, 2026-06-24)

This is the load-bearing correction to the original plan. Tiers below are now encoded in
`i18n/locales.ts` as `languageToolSupport` (`strong` | `partial` | `none`) + `languageToolCode`.

| Locale | LT rules / spell | Tier in registry | LT code |
|--------|------------------|------------------|---------|
| en | 6074 + spell | **strong** | en-US |
| fr | 6984 + spell | **strong** | fr |
| de | 5224 + spell | **strong** | de-DE |
| pt | 2919 + spell | **strong** | pt-PT |
| es | 1644 + spell | **strong** | es |
| nl *(new)* | 3500 + spell | **strong** | nl |
| pl *(new)* | 1747 + spell | **strong** | pl-PL |
| uk *(new)* | 1186 + spell | **strong** | uk-UA |
| zh | 1863, no spell | partial | zh-CN |
| ru | 892 + spell, unmaintained | partial | ru-RU |
| ja | 735, no spell | partial | ja-JP |
| ro *(new)* | 457 + spell | partial | ro-RO |
| ar | 450 + spell | partial | ar |
| fa | 283, no spell | partial | fa |
| it | 141 + spell | partial | it |
| el | 55 + spell | partial | el-GR |
| sv | 32 + spell | partial | sv |
| **tr** *(new)* | **NOT supported** | **none** | — |
| he, fi, hu, is, eu, ko | **NOT supported** | **none** | — |

### ⚠ Material finding — Turkish has NO LanguageTool support
The original plan asserted "pl/nl/tr/uk/ro all have strong LanguageTool coverage." **That is false for
Turkish** — Turkish is absent from LanguageTool's supported-languages list entirely. Decision:
- Turkish **stays** in the 5-locale Workstream-A set — its value is creative-writing UI demand, which
  is independent of grammar checking. It is added as a normal Beta UI locale.
- Turkish gets `languageToolSupport: 'none'` → the grammar feature is simply **absent** for `tr`, the
  same honest treatment as he/fi/hu/is/eu/ko. No fake grammar promise.
- Of the 5 new locales, **pl/nl/uk = strong, ro = partial, tr = none**. The LT feature therefore lands
  meaningfully for 4 of the 5.

## 6. Adjusted prioritization

- **Workstream B (registry enrichment) — done in this PR.** `languageToolSupport` + `languageToolCode`
  added to all 19 entries (verified data), with `getLanguageToolCode()` / `hasLanguageToolSupport()`
  SSOT helpers so the editor feature gates on one source. Integrity test extended.
- **Workstream C (real LanguageTool) — primary.** MVP "Check this scene" panel (PR-C1) → live inline
  overlay (PR-C2). Self-hosted only; the existing `assertLanguageToolAllowed` privacy gate stays. The
  locale→LT code map is `getLanguageToolCode()`; `none` locales hide the feature.
- **Workstream A (5 locales) — pl, nl, tr, uk, ro**, one stacked PR each, via the existing pipeline.
  `pt-BR` and Chinese variants are deferred → `ROADMAP.md`.

## 7. Tier elevation posture (honest, data-gated)

No tier is promoted in this PR. Promotion (near-production → production) requires translated `help.json`
(the single gap for ja/zh/pt/el) **plus** parity + 0 placeholder-integrity issues — recorded
per-decision in the **Review & Elevation Log** appended to `docs/i18n/TRANSLATION_STATUS.md`. Beta
labels stay until the data supports otherwise; we do not over-promote.

## 8. Risks / anti-patterns (and mitigations)

- **Over-promising grammar** for unsupported locales → mitigated: `none` tier hides the feature; the
  registry test pins he/fi/hu/is/eu/ko (+tr) to `none`.
- **Cloud LT leaking private prose** → mitigated: `assertLanguageToolAllowed` keeps remote LT blocked
  under local-only privacy mode; self-hosted (`localhost:8010`) is the documented default.
- **Editor perf regression from live checking** → mitigated (PR-C2): debounce, active/visible section
  only, cancel in-flight on keystroke, MVP-first.
- **English on Beta surfaces** (CodeAnt/review custom rule rejects it) → mitigated: translate new
  user-visible strings up front (core-5 by hand, Beta via bulk-translate); `help.json` stays
  English-fallback for Beta by policy (tag-dense HTML is not safely MT-able).
- **Locale fan-out crossing ~100 files** (review bot skips) → mitigated: one locale per PR.
- **Registry drift** → mitigated: `languageToolCode` present **iff** support ≠ `none`, asserted by the
  integrity test.

## 9. Deliverable status (this PR = Phase-0 + Workstream B)

- [x] This report.
- [x] `i18n/locales.ts` enriched (LT support + code, helpers) + integrity test extended.
- [x] Review & Elevation Log seeded in `docs/i18n/TRANSLATION_STATUS.md`.
- [ ] Glossary anchor terms for the 5 new locales — added per-locale when each lands (Workstream A),
      where the bulk-translate context is concrete.
- [ ] `languageToolService` + PR-C1/C2 — next PR.
- [ ] 5 locale additions — subsequent stacked PRs.
- [ ] LanguageTool Integration Architecture doc + ADR + final handover report — closing PR.
