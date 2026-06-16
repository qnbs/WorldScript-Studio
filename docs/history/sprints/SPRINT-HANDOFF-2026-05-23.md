# Sprint Handoff — 2026-05-23

**Branch:** `main` | **HEAD:** `c57a648` | **Session:** v2.0 Phase 2 Complete

## v2.0 Master Plan — ALL PHASES DONE

Plan file: `/home/pc/.claude/plans/du-bist-claude-4-indexed-chipmunk.md`

| Phase | Ticket | Description | Commit |
|-------|--------|-------------|--------|
| 0 | E2E-1 | Collaboration awareness AES-256-GCM encryption | e68cb5f |
| 0 | DS-5 | Bridge block removal from `index.css` | e68cb5f |
| 0 | COV-1 | plotBoardAiThunks (7 tests) + ragPromptAssembly (+3) | e68cb5f |
| 0 | PERF-0 | AbortSignal audit — all listenerMiddleware listeners clean | e68cb5f |
| 0 | DB-1 | `verifyEmbeddingColumn()` smoke-test + 12 tests | 045188c |
| 1 | RTL-1 | RTL layout foundation (feature flag + BiDi context + html[dir]) | 6f5c7b7 |
| 1 | SYNC-1 | E2E-encrypted cloud-sync stub (AES-256-GCM, Cloudflare R2) | e7ef456 |
| 1 | VRT-1 | Visual regression CI job + expanded Playwright screenshot suite | a3b9440 |
| 1 | PRESET-1 | Per-project AI presets (already implemented before sessions) | — |
| 1 | TOUR-1 | Guided onboarding tour (already implemented before sessions) | — |
| 2 | LORA-1 | LoRA adapter inference foundation (IDB + settings UI + feature flag) | 94c93d7 |
| 2 | PLUGIN-1 | Plugin system v0.1 (sandboxed capability API + registry + settings UI) | d1a16aa |
| 2 | PERF-1 | Large manuscript performance (useDeferredValue + 500-scene notice) | df238d0 |
| 2 | COM-1 | Community section (GitHub links + curated WebLLM/ONNX model list) | e6450e2 |

## Quality gate at final push

- **lint** ✅ — 702 files, Biome (--error-on-warnings)
- **typecheck** ✅ — tsc --noEmit exit 0
- **i18n:check** ✅ — 1992 keys × 5 locales (de/en/es/fr/it)
- **graphify:update** ✅ — 1725 nodes / 1993 edges / 431 communities

## New files added this sprint (Phase 2)

```
services/loraAdapterService.ts          — IDB CRUD for LoRA adapter blobs
components/settings/LoraAdapterSection.tsx  — Upload/list/delete UI
components/settings/PluginsSection.tsx      — Plugin type badges + permission chips
components/settings/CommunitySection.tsx    — GitHub links + model list
```

## Notable architectural decisions

- **LoRA storage:** Separate `storycraft-lora-db` (not the main state/data IDB) — avoids bloating Redux persistence.
- **Plugin sandboxing:** `execute()` takes `rawApi` from the caller (knows Redux state), builds a permission-checking proxy — plugins never get direct Redux dispatch.
- **ManuscriptEditor PERF:** `useDeferredValue(activeSection.content)` defers only the highlight overlay useMemo; the textarea itself stays synchronous. `isHighlightPending` dims overlay when deferred value lags.
- **Community model list:** `WEBLLM_USE_CASES` map translates model IDs → i18n use-case keys; falls back to `'settings.community.useCase.balanced'` for unknown models.

## What's open for v2.1+

All v2.0 items are done. The PLANbib v1.7–v1.10 bibisco-style features are planned but NOT started:
- Phase 1: Objects view
- Phase 2: Mind Map (react-force-graph integration)
- Phase 3: Interviews / character questionnaire
- Phase 4: Timeline view
- Phase 5: Onboarding wizard
- Phase 6: Writing analysis dashboard
- Phase 7: Read-only mode
- Phase 8: Guide / help center v2
- Phase 9: Desktop polish (Tauri)

See `project_planbib_v17.md` in memory for the full plan.

## CI

Monitor all CI jobs at `https://github.com/qnbs/WorldScript-Studio/actions` after pushes.
CodeQL scans: `https://github.com/qnbs/WorldScript-Studio/security/code-scanning`
