# LanguageTool grammar & spelling integration

A **privacy-first, self-hosted** grammar/spell checker wired directly into the manuscript editor.
It uses [LanguageTool](https://languagetool.org) — an open-source proofreading engine — running on
**your own machine**, so manuscript text never leaves the device. This replaced the earlier hardcoded
fake-typo list with a real, multilingual checker.

> **TL;DR** — install a local LanguageTool server, point Settings → Connections at it, and the editor
> gains a live "underline + suggestion" layer plus an on-demand "Check this scene" panel. If you don't
> run a server, the feature stays hidden and nothing changes.

## 1. What you get

| Surface | Where | Behaviour |
|---------|-------|-----------|
| **"Check this scene" panel** | Writer tools sidebar (below the AI tools) | On-demand check of the active section → a list of findings (category, message, suggestion) with **one-click apply**, **ignore**, and **add-to-dictionary**. |
| **Live inline overlay** | Manuscript editor | Debounced live check as you type; single-word findings **underline in place**; click/keyboard opens a popover with the LanguageTool message + replacement chips. |

Both apply edits **offset-safe** through one shared path (`hooks/useLanguageToolCheck.ts` →
`applyMatchReplacement`) so corrections are anchor-checked and natively undoable (the project slice is
`redux-undo`-wrapped). The user dictionary is persisted in `settings.advancedEditor.customDictionary`
and suppresses matching spelling findings everywhere.

## 2. Privacy model (why self-hosted only)

- The integration is **opt-in** and **off by default** (`settings.integrations.languageToolEnabled`).
- `services/languageToolClient.ts#assertLanguageToolAllowed` is the gate: when
  `settings.privacy.localStorageOnly` is on, any **non-`localhost`/`127.0.0.1`** base URL is **blocked**
  — so a cloud LanguageTool can never silently receive your prose. The documented default base URL is
  `http://localhost:8010`.
- `services/languageToolService.ts` **never logs manuscript text** (only match counts), and any
  network/HTTP failure **degrades silently** to an empty result so typing is never blocked.

## 3. Setup — run a local server

The quickest path is the community Docker image:

```bash
docker run --rm -p 8010:8010 erikvl87/languagetool
```

Then in the app: **Settings → Connections → LanguageTool** → enable it and set the base URL to
`http://localhost:8010`. (Native installs and the official `languagetool.org` JAR work too — point the
base URL at whatever host/port the server listens on.)

## 4. Language coverage

LanguageTool does **not** support every locale the app ships. Coverage is encoded in the locale SSOT
(`i18n/locales.ts`) as `languageToolSupport: 'strong' | 'partial' | 'none'` + `languageToolCode`, and
the feature is **simply hidden** for unsupported locales — no fake promise. Verified against
[dev.languagetool.org/languages](https://dev.languagetool.org/languages) (2026-06-24):

- **strong** — en, de, fr, es, pt, nl, pl, uk (large rule set + spell check)
- **partial** — it, ru, ja, zh, el, ar, fa, sv, ro (supported but limited rules and/or no spell check)
- **none** — **tr**, he, fi, hu, is, eu, ko (not supported by LanguageTool → feature absent)

`getLanguageToolCode(locale)` / `hasLanguageToolSupport(locale)` (`i18n/locales.ts`) are the single
source the editor gates on.

## 5. Architecture

```
i18n/locales.ts              SSOT: languageToolSupport + languageToolCode (+ helpers)
        │
services/languageToolClient.ts   assertLanguageToolAllowed() — privacy gate (cloud blocked in local-only)
services/languageToolService.ts  checkText() → POST /v2/check, parse matches[], text-hash cache,
        │                        abortable (AbortSignal.any), graceful offline/error degrade,
        │                        applyMatchReplacement() — offset-safe single-edit apply (anchor check)
        ▼
hooks/useLanguageToolCheck.ts    orchestration: locale→code, gate, run, apply→re-check,
        │                        ignore, add-to-dictionary (→ advancedEditor.customDictionary)
        ├──────────────► components/writing/GrammarCheckPanel.tsx   "Check this scene" (PR-C1)
        └──────────────► components/manuscript/ManuscriptEditor.tsx  live inline overlay (PR-C2)
```

- The **service** is pure and fully unit-tested (`tests/unit/languageToolService.test.ts`); the
  **hook** and **panel** have their own tests. The inline overlay reuses the editor's existing
  aligned-overlay + popover infrastructure rather than introducing a new rendering layer.
- **Caching**: results are keyed by a text hash; the user dictionary is applied *after* the cache read,
  so adding a word never forces a re-fetch. The request is abortable so rapid typing cancels in-flight
  checks.
- **Scope of the inline layer**: only single-word matches underline in place (mapped to their exact
  offset in the word-token overlay). Multi-word grammar findings are surfaced by the on-demand panel.

See [ADR 0010](adr/0010-languagetool-self-hosted.md) for the design rationale.

## 6. Limitations & future work

- **No bundled server.** This is intentional (privacy + bundle size); the user runs LanguageTool.
- **Inline = single-word only.** Phrase-level grammar shows in the panel, not as inline underlines.
- **Cloud LanguageTool** is deliberately gated off under local-only privacy mode.
- New UI locales whose LanguageTool support is `none` (e.g. Turkish) get the editor but not the grammar
  layer — this is documented per-locale, not a bug.
