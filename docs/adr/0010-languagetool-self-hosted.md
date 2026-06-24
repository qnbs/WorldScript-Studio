# ADR 0010 — Self-hosted LanguageTool grammar checking via the editor overlay

- **Status:** Accepted (PR-C1 on-demand panel + PR-C2 live inline overlay shipped; new-locale rollout staged)
- **Date:** 2026-06-25
- **Deciders:** Maintainer + Claude Code
- **Context tags:** editor, i18n, privacy, grammar, languagetool

## Context

The manuscript editor advertised "spell-check with suggestions" and "grammar & style hints", but the
implementation was a **hardcoded list of ~16 English + ~16 German typos** (`TYPOS_EN`/`TYPOS_DE` in
`ManuscriptEditor.tsx`) — not a real checker, no other languages, no grammar. Separately,
`services/languageToolClient.ts` existed only as a **connectivity ping** (a gate +
`POST /v2/check` with `language=en-US`), never parsing results; and the Writer "grammar check" tool is
an **AI/Gemini prompt**, unrelated and token-costly.

The app is **offline-first and privacy-first**: API keys live only in the browser, analytics are gated,
and manuscript text must not leave the device without explicit consent. Any real grammar feature has to
respect that. We also ship **19 locales** of widely varying maturity, and the proofreading engine we
pick does not support all of them.

## Decision

Adopt **LanguageTool** as the real grammar/spell engine, **self-hosted only**, integrated through the
editor's **existing overlay + popover** rather than a new rendering layer.

1. **Self-hosted, privacy-gated.** Keep `assertLanguageToolAllowed` as the gate: under
   `privacy.localStorageOnly`, only `localhost`/`127.0.0.1` base URLs are allowed — a cloud
   LanguageTool can never silently receive prose. Off by default; the user runs the server
   (`docker run -p 8010:8010 erikvl87/languagetool`). The service never logs text and degrades silently
   on any failure.
2. **One service, one apply path.** `services/languageToolService.ts` does the real work (`checkText`
   → parse `matches[]`, text-hash cache, abortable, offset-safe `applyMatchReplacement` with an anchor
   check). `hooks/useLanguageToolCheck.ts` orchestrates both surfaces so the on-demand panel and the
   live overlay share gating, apply, ignore, and dictionary logic.
3. **Locale support in the SSOT.** `i18n/locales.ts` carries `languageToolSupport` +
   `languageToolCode`; the feature is **hidden** for unsupported locales (`none`) — verified data, no
   fake promise (notably Turkish, Hebrew, Finnish, Hungarian, Icelandic, Basque, Korean are unsupported).
4. **Reuse the editor overlay.** The editor already renders an aligned, font-matched overlay with
   clickable spell-error spans + a suggestion popover. Live underlines map LanguageTool single-word
   matches to their exact offset in that overlay; multi-word grammar findings are surfaced by the
   on-demand panel instead of inventing a measured-span overlay.

## Alternatives considered

- **Cloud LanguageTool / a paid proofreading API** — rejected: sends manuscript text off-device,
  violates the privacy model, adds cost and a network dependency.
- **Bundle a WASM/JS grammar engine** — rejected for now: large download, narrower language coverage
  than LanguageTool's server, and duplicates the heavy-model concerns we already manage for voice/RAG.
- **Keep using the AI `grammarCheck` prompt for everything** — rejected as the *primary* path:
  non-deterministic, token-costly, and not a real per-token diagnostics layer (it stays available as a
  separate creative tool).
- **A new offset-driven underline overlay (full phrase underlines)** — deferred: a larger, riskier
  rewrite of a core editor file; the single-word overlay + panel covers the common case now.

## Consequences

- **Positive:** real multilingual spell/grammar checking; deterministic and free (no tokens);
  privacy-preserving by construction; minimal new UI surface (reuses overlay + popover); offset-safe,
  undoable corrections shared across both entry points.
- **Negative / trade-offs:** requires the user to run a local server (no bundled engine); inline
  underlines are single-word only (phrase grammar lives in the panel); coverage is uneven across
  locales and absent for several.
- **Follow-ups:** roll out new high-coverage UI locales (pl/nl/tr/uk/ro) — tracked separately; a future
  ADR could revisit a full offset-driven inline layer if phrase-level underlines are wanted.

See [`docs/LANGUAGETOOL.md`](../LANGUAGETOOL.md) for the feature guide and setup.
