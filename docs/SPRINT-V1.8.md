# Sprint Reference — v1.8 RAG Prompt Assembly + UX

**Target:** 2026-05-21  
**Builds on:** v1.7 DuckDB + Hybrid RAG retrieval

## 1. RAG prompt assembly

| Component | Path |
|-----------|------|
| Assembly API | `services/ragPromptAssembly.ts` |
| Templates | `promptLibrary`: `writerContinuationWithRAG`, `plotSuggestionWithRAG` |
| Writer | `hooks/useWriterView.ts` + `ToolsPanel` RAG toggle |
| Plot Board | `features/project/thunks/plotBoardAiThunks.ts`, `hooks/usePlotBoardAi.ts` |

Flow: `retrieveContext` → `buildRAGContextBlock` → template merge → AI call.

## 2. DuckDB 384-dim migration

| Item | Path |
|------|------|
| Schema v2 DDL | `duckdbSchema.ts` — `embedding` column |
| Migration | `services/duckdb/ragVectorMigration.ts` |
| Dual-write | `localRagService.rebuildHybridRagIndex` uses `semanticVec` |
| Trigger | `listenerMiddleware` after P1 seed |

## 3. Tests

- `tests/unit/ragPromptAssembly.test.ts`
- Updated `tests/unit/localRagService.duckdb.test.ts`

## 4. Related docs

- [docs/PWA-AUDIT.md](PWA-AUDIT.md)
- [infra/low-end-ci/](../infra/low-end-ci/) — local CI (act + Forgejo)
