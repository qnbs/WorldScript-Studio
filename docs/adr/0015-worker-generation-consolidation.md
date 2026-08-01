# ADR 0015 — Worker-generation consolidation: v1 retired, WorkerBus v2 is the sole generation

- **Status:** Accepted (shipped)
- **Date:** 2026-07-29
- **Deciders:** Maintainer + Claude Code
- **Context tags:** workers, architecture, tech-debt
- **Supersedes:** [[0014-worker-generation-duplication]]

## Context

[[0014-worker-generation-duplication]] documented, but deliberately deferred, consolidating two
live worker generations (legacy `workers/*.worker.ts` vs. WorkerBus v2's `workers/v2/*.worker.ts`)
for the same two workloads — DuckDB analytics and local inference (embeddings/NLP). That ADR named
the target generation (v2, per the codebase's own architecture framing) and the exact 3 v1 call
sites to migrate, but explicitly scoped the actual migration out as "a dedicated migration sprint."
This ADR is that migration, executed as 4 stacked PRs.

## Decision

**v2 is now the sole worker generation for DuckDB analytics and local inference.** Both legacy
files are deleted:

| Workload | v1 file (deleted) | v2 file (sole generation) | Migrated in |
|---|---|---|---|
| DuckDB analytics | `workers/duckdbWorker.ts` | `workers/v2/duckdb.worker.ts` | PR #287 |
| Embeddings | `workers/inference.worker.ts` | `workers/v2/inference.worker.ts` (`inference.embed`) | PR #288 |
| Local NLP | `workers/inference.worker.ts` | `workers/v2/inference.worker.ts` (`inference.text`) | PR #290 |

Each of the 3 v1 call sites (`services/duckdb/duckdbClient.ts`, `services/ai/localEmbeddingService.ts`,
`services/ai/localNlpService.ts`) kept its exact public API — an adapter pattern, not a consumer
rewrite — so none of their real callers (`useDuckDb.ts`, `duckdbAnalytics.ts`, `duckdbMigration.ts`,
`ragVectorMigration.ts`, `telemetryService.ts`, `localRagService.ts`, `crossProjectIndexService.ts`,
`ragPromptAssembly.ts`, `proForgeMemoryBank.ts`, `loraEvaluationService.ts`, `loraDatasetBuilder.ts`,
`inferenceGateway.ts`) needed any changes. `services/workerBusManager.ts` gained
`ensureDuckDbPool()`/`ensureInferencePool()`, mirroring `ensureWebLlmPool()`'s decoupling from
`enableWorkerBusV2` (ADR-0005) — these are core features (DuckDB analytics defaults on; RAG/
cross-project search are permanent core behaviour), not experimental infra, so toggling that flag
off must not silently break them.

### Parity gaps found and fixed before cutover (not assumed away)

The v2 worker files had zero production callers before this migration — registered as live pools
but never exercised by real traffic — and had genuinely drifted from v1 in ways a parity-test PR
(#286) and two review-comment correction loops caught before they could reach users:

1. **`initDuckDb()`'s OPFS-unavailable catch block silently swallowed the failure**, unlike v1's
   out-of-band `OPFS_FALLBACK` message that lets the UI warn users their analytics won't persist.
   Fixed by threading `emitProgress` into `initDuckDb()` and emitting an `'opfs-fallback'` progress
   stage; a follow-up review pass found the fix itself could abort the fallback path if the
   partial connection's `close()` rejected — wrapped in its own best-effort try/catch.
2. **`handleQuery`/`handleExec` silently dropped `params`**, executing an unbound query — already
   live and breaking `telemetryService.ts`'s parameterized `INSERT` (a real, shipping bug caught
   only by this migration, not a hypothetical). Fixed via DuckDB-WASM prepared statements
   (`connection.prepare(sql)` → `stmt.query(...params)` → `stmt.close()`).
3. **A respawned duckdb-pool worker had no `connection`** (the pool's `minWorkers:0` lets it
   idle-terminate; a fresh worker's module state starts blank), so any QUERY/EXEC after a respawn
   failed with "DuckDB not initialized." Fixed by transparently re-sending INIT once and retrying
   the original call when `duckdbClient.ts` sees that specific error.
4. **`WorkerBus.terminatePool()` had no lifecycle contract** — removing a pool didn't settle tasks
   already routed to it (their result promises would await a RESULT message from a worker that no
   longer exists), and `ensureDuckDbPool()` assumed a non-null bus always has every pool, so any
   call after `duckdbClient.terminate()` would fail with `NO_POOL` forever. Fixed by tracking
   task→pool assignment and cancelling matching tasks on `terminatePool()`, plus a re-registration
   path (`reRegisterDuckDbPool()`/`reRegisterInferencePool()`) shared with initial registration.
5. **`ensureInferencePool()` was imported by `localEmbeddingService.ts` but never defined** — a
   genuine missing-export regression that broke production builds (caught by Vercel's build, not
   by Vitest, since the consumer test fully mocks the module, or by local `tsgo` typecheck, for
   reasons not fully understood). Fixed by adding the function; see the "not yet resolved" item
   below and `TODO.md`'s incident write-up.

### Deliberately not changed

WebLLM's worker-first-with-main-thread-fallback shape (ADR-0005) was **not** extended to DuckDB or
embedding/NLP — that shape exists because a real main-thread fallback engine exists for WebLLM
(`runLocalTextGeneration`'s ONNX→Transformers.js→heuristic chain). No such fallback exists for
DuckDB-WASM or transformers.js pipelines in this repo; failures still surface as errors and callers
degrade exactly as they did against v1 (empty query results, heuristic sentiment/summary fallback).

## Consequences

- **Positive:** the "any worker-level fix must be checked against both generations" tax ADR-0014
  described is retired — `workers/duckdbWorker.ts` and `workers/inference.worker.ts` no longer
  exist. `packages/worker-bus`'s generic `WorkerPool` health-check also replaced ~70 lines of
  hand-rolled ping/backoff duplicated per v1 service.
- **Negative (accepted):** the `inference` pool's `maxWorkers` was capped at 2 (was
  `MAX_WORKERS_INFERENCE`=4) because each pool replica independently loads its own transformers.js
  pipeline with no cross-replica cache sharing — a resource tradeoff to revisit from WorkerBus's own
  telemetry (`peakLatencyMs`/`errorRate`) if it proves too conservative.
- **Resolved in the scheduler follow-up (2026-08-01):** WorkerBus now dispatches exclusively through
  its bounded priority queue, uses event-driven pool availability instead of animation-frame polling,
  and enforces `timeoutMs` as an inactivity watchdog from enqueue through execution. Valid progress
  rearms the watchdog; an active timeout replaces the presumed-wedged worker.

## References

- [[0014-worker-generation-duplication]] — the deferred decision this ADR completes
- [[0005-webllm-worker-offload]] — the `ensureXPool()`/worker-first pattern this migration reused
- PRs #286 (parity gate), #287 (DuckDB), #288 (embeddings), #290 (NLP + v1 deletion)
- `TODO.md`'s "Vercel deployment failures root-caused + fixed" entry — the missing-export incident
