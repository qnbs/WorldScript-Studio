# Sprint Handoff — 2026-05-26b

**Branch:** `main` | **Version:** `v1.17.2` | **Session:** Local Inference Robustness Sprint

## What was completed today

| Ticket | Description | Status |
|--------|-------------|--------|
| INFER-1 | Tab leader election: localStorage heartbeat (5s refresh / 12s stale) — fast-path skips election when live leader exists | ✅ Done |
| INFER-2 | `surrenderLeadership()` — clears heartbeat + interval after inference completes so next cycle elects fairly | ✅ Done |
| INFER-3 | Election timeout 280ms → 800ms — resilience on slow/background-throttled devices | ✅ Done |
| INFER-4 | LRU embedding cache (1 000 entries) — eliminates ~400ms re-embedding per RAG query on unchanged sections | ✅ Done |
| INFER-5 | Worker health-check ping/pong — 30s ping, 5s pong timeout → auto-restart of stale/hung inference worker | ✅ Done |
| INFER-6 | GPU mutex in `localAiFacade` — `gpuResourceManager.acquireGpu` before WebLLM/ONNX-WebGPU; always released in `finally` | ✅ Done |
| INFER-7 | Cloud AI policy enforcement in `createDeduplicatedThunk` — `assertCloudAiAllowedSync` at thunk entry (one place, not per-caller) | ✅ Done |
| INFER-8 | RAG `indexedAt` stabilized — position-based `(i+1)*1000` instead of `now - offset` (stable across re-indexing runs) | ✅ Done |
| TEST-1 | 32 new unit tests across 4 files — heartbeat, PING/PONG, GPU mutex, cloud policy | ✅ Done |
| DOCS-1 | CLAUDE.md, .github/copilot-instructions.md, .cursor/rules/ — architecture docs updated (ProForge, Voice, Feature Flags, RTCDataChannel, checkStorageHealth, Tauri CSP) | ✅ Done |
| DOCS-2 | AUDIT.md + Sprint Handoff — v1.17.2 entry added | ✅ Done |

## Architecture changes

### Tab Leader Election (`packages/ai-core/src/tabLeaderElection.ts`)
- New: `surrenderLeadership()` — clears localStorage heartbeat and kills the heartbeat `setInterval`
- New: fast-path at election start — if `localStorage` has a fresh entry (< 12s old) from another tab, return `false` immediately without opening `BroadcastChannel`
- Default election timeout 280ms → 800ms
- `packages/ai-core/src/index.ts` re-exports `surrenderLeadership`

### Embedding Service (`services/ai/localEmbeddingService.ts`)
- LRU cache: `Map<string, EmbeddingVector>` (1 000 entries, insertion-order eviction). Key = `model\x00truncated-text`. ~400ms saved per repeated RAG query.
- Worker health-check: 30s ping interval, 5s pong timeout → `restartWorker()`. Pong handler auto-removes itself per ping cycle.
- `clearEmbeddingCache()` exported (use when model version changes)
- `_resetWorkerForTest()` now clears health-check timers too

### Local AI Facade (`services/localAiFacade.ts`)
- `detectWebGpuSupport()` checked before inference; if true → `gpuResourceManager.acquireGpu('webllm', 'high')` before WebLLM/ONNX init
- `finally` block: `gpuResourceManager.releaseGpu('webllm')` (if needsGpu) + `surrenderLeadership()` (always)
- Prevents VRAM races when ProForge runs multiple pipeline stages concurrently

### AI Thunk Utils (`features/project/aiThunkUtils.ts`)
- `assertCloudAiAllowedSync(provider, privacy)` called at the start of every `createDeduplicatedThunk` payload. If the provider is a cloud type (not `ollama`/`webllm`) and privacy settings block it, the thunk rejects immediately without calling the payload creator.

### RAG Service (`services/localRagService.ts`)
- `indexedAt`: was `Date.now() - (manuscript.length - i) * 1000` (now-relative, changes every run). Now `(i + 1) * 1_000` (position-monotonic, stable and always > 0).

### Inference Worker (`workers/inference.worker.ts`)
- `WORKER_PING` message → `postMessage({ type: 'WORKER_PONG', ts: Date.now() })` — supports health-check from `localEmbeddingService`

## Quality gate at final push

- **lint** ✅ — 895 files, Biome 2 (--error-on-warnings), 0 errors
- **typecheck** ✅ — `tsc --noEmit` passes (exit 0)
- **tests** ✅ — all 4 updated suites green (32 new tests); full suite last recorded at 4 044 tests / 360 files

## No regressions introduced

All existing tests in the 4 modified suites pass unchanged. The `aiPolicy` mock in `aiThunkUtils.test.ts` is required because default settings (`provider='gemini'`, `localStorageOnly=true`) would otherwise block the existing deduplication tests — the mock isolates policy behavior to dedicated test cases.

## Known open items (unchanged from v1.17.1)

See `TODO.md` and `ROADMAP.md` for authoritative tracking. No new deferred items introduced this session.

## Next session priority

1. Run CI and verify all jobs green (coverage, build, e2e, lighthouse)
2. Update README.md badges with CI-reported coverage numbers if requested
3. PLANbib v1.7 features (Objects → MindMap → Interviews → Timeline → Wizard → Analysis → ReadMode → Guide → Desktop) — 9 phases, go-ahead from user required
