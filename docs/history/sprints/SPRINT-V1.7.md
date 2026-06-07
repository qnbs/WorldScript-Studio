# Sprint Reference — v1.7 DuckDB Analytics + Hybrid RAG + AI Extensions

**Released:** 2026-05-20
**Commits since v1.6.0:** 21 (see `git log v1.6.0..v1.7.0`)

---

## 1. DuckDB-WASM Analytics Layer (P0–P3)

### Architecture

```
Main thread ──► duckdbClient.ts (singleton proxy)
                      │  messageId / AbortSignal protocol
                      ▼
              workers/duckdbWorker.ts
                      │  duckdb-eh WASM bundle (no SharedArrayBuffer required)
                      ▼
              OPFS file: storycraft_analytics.duckdb
              (in-memory fallback when OPFS unavailable)
```

### Schema (v1)

| Table | Purpose |
|---|---|
| `projects` | Title, logline, word counts, targets |
| `sections` | Section metadata + word counts + scene_start |
| `writing_history` | Daily word counts (progress charts) |
| `writing_sessions` | Session-level metadata |
| `characters` | Name, avatar flag (encrypted backstory NOT stored) |
| `rag_chunks` | `(chunk_id, project_id, section_id, chunk_index, vector FLOAT[], indexed_at)` — text stays in IDB |
| `cross_project_index` | Project search metadata + optional embedding |
| `codex_entities` | Entity names + types + mention counts |
| `codex_mentions` | Entity mention excerpts |
| `readability_snapshots` | Flesch scores + locale |

Analytics views: `v_daily_progress`, `v_weekly_progress`, `v_section_metrics`, `v_scene_overlap`, `v_character_cooccurrence`.

### Key files

| File | Role |
|---|---|
| `workers/duckdbWorker.ts` | Off-main-thread DuckDB-WASM; OPFS + in-memory |
| `services/duckdb/duckdbClient.ts` | Singleton proxy; init retry 3×; AbortSignal |
| `services/duckdb/duckdbSchema.ts` | DDL, views, `DUCKDB_DDL` export |
| `services/duckdb/duckdbAnalytics.ts` | Typed query helpers; `withDuckDbRetry` |
| `services/duckdb/duckdbMigration.ts` | IDB→DuckDB seed (idempotent) |
| `hooks/useDuckDb.ts` | React integration; `queryAsync`/`execAsync` |
| `hooks/useAnalytics.ts` | Feature-flagged analytics; parallel queries |

---

## 2. Hybrid RAG — Wired End-to-End

### What was already built (v1.5 / v1.6)

- `services/localRagIndex.ts` — lexical BoW index (64-dim hash vectors)
- `services/localRagService.ts` — `rebuildHybridRagIndex()` (300-token chunks, MiniLM 384-dim, DuckDB dual-write) + `retrieveContext()` (lexical / semantic / hybrid / DuckDB path)
- `services/ai/localEmbeddingService.ts` — `embedText()` (MiniLM-L6-v2, 384-dim, L2-normalized)
- `app/listenerMiddleware.ts` — auto-rebuild on manuscript change (5 s debounce)

### What v1.7 added

| Change | File |
|---|---|
| `ragMode: 'lexical' \| 'hybrid'` field (default `'hybrid'`) | `types.ts`, `features/settings/settingsSlice.ts` |
| Migration default for IDB upgrade | `services/dbService.ts` |
| Settings button now calls `rebuildHybridRagIndex` (was `rebuildLocalRagIndex`) | `components/settings/AiSections.tsx` |
| RAG mode selector dropdown in Advanced AI settings | `components/settings/AiSections.tsx` |
| Consistency checker calls `retrieveContext()` before AI call | `hooks/useConsistencyCheckerView.ts` |
| `ragChunks?` param in `ConsistencyCheckParams` | `services/geminiService.ts` |
| Re-Index for AI footer button | `components/manuscript/ReferencePanelView.tsx` |

### Retrieval flow (hybrid mode)

```
characterName → embedText() → Float32Array (384-dim)
                     │
                     ▼
              retrieveContext(projectId, characterName, 8, 'hybrid', queryEmb, duckDbOn)
                     │
                     ├── DuckDB path (when duckDbOn && queryEmb): list_dot_product() ranking
                     │   └── text resolved from IDB by chunk_id
                     │
                     └── IDB path: 60% semantic + 30% lexical token-overlap + 10% recency
                                   + sliding window (3 most-recent always included)
                     │
                     ▼
              top-8 ragChunks → geminiService.ts consistencyCheck prompt
                                (replaces full 50 000-char manuscript block)
```

---

## 3. AI Provider Extensions

- **ONNX + Transformers.js** as selectable primary providers (Settings → AI Model → Provider)
- **Service-level dedup**: `features/project/aiThunkUtils.ts` `buildAiCreativity()` wraps all AI thunks; prevents concurrent duplicate requests for the same `thunkId`
- **Per-project AI preset**: `advancedAi.localBackendPreset` scoped per project; hash-based deep links via `deepLinkService.ts`
- **WorkerBus backpressure**: `MAX_QUEUE_SIZE` = 32; critical tasks bypass limit; telemetry extended with `peakLatencyMs`, `errorRate`, `lastSuccessAt`

---

## 4. Y-WebRTC E2E Encryption

- `collaborationService.ts`: `deriveEncryptionKey()` (PBKDF2, 600 000 iterations, SHA-256, AES-256-GCM), `encryptUpdate()`, `decryptUpdate()`
- Deterministic salt: SHA-256 of `projectId` → `Uint8Array` (no random bytes → reproducible across reconnects)
- `CollaborationPanel`: green badge `E2E Key Derived (AES-256-GCM)` / amber `Room isolation only`
- **Note:** Full in-flight RTCDataChannel patching of y-webrtc deferred to v2.0 (requires vendored y-webrtc fork)

---

## 5. Performance

- `components/scene-board/PlotCanvas.tsx`: `onPointerMove` handler wrapped in `requestAnimationFrame` guard; prevents 60 Hz Redux dispatch storm during pan/zoom on low-end hardware
- `packages/ai-core/src/index.ts` `WorkerBus`: backpressure guard prevents queue overflow; low-priority tasks auto-promoted after 3 preemptions (starvation prevention)

---

## 6. i18n

1 590 → **1 625 keys** (+35):
- `settings.advancedAi.ragModeLabel` / `ragModeHybrid` / `ragModeLexical` (×5 locales = 15)
- `reference.reindex.action` / `busy` / `done` / `doneDetail` / `error` (×5 locales = 25, -5 overlap)
- Updated `settings.advancedAi.localRagDescription` in all locales

---

## 7. Quality Gate

```
pnpm run lint              → ✅ Biome 2 — no diagnostics
pnpm run typecheck         → ✅ tsc --noEmit — exit 0
pnpm run i18n:check        → ✅ 1625 keys × 5 locales — OK
pnpm exec vitest run ...   → ✅ existing unit tests pass
```

Coverage and E2E metrics authoritative from CI artifacts (Codecov, JUnit).
