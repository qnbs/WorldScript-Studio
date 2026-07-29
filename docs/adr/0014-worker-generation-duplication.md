# ADR 0014 — Two live worker generations (v1 and WorkerBus v2)

- **Status:** Accepted (documented as known debt — consolidation explicitly out of scope this sprint)
- **Date:** 2026-07-29
- **Deciders:** Maintainer + Claude Code
- **Context tags:** workers, architecture, tech-debt

## Context

Two independent worker "generations" exist side by side for the same two workloads (DuckDB
analytics and local inference), both wired into real, non-test code paths — confirmed via
call-site tracing, not assumed:

| Workload | Generation | Worker file | Real (non-test) call site |
|---|---|---|---|
| DuckDB analytics | v1 | `workers/duckdbWorker.ts` | `services/duckdb/duckdbClient.ts:25` (`new Worker(new URL('../../workers/duckdbWorker.ts', ...))`) |
| DuckDB analytics | v2 | `workers/v2/duckdb.worker.ts` | `services/workerBusManager.ts:81` (`new URL('../workers/v2/duckdb.worker.ts', ...)`) |
| Local inference | v1 | `workers/inference.worker.ts` | `services/ai/localNlpService.ts:19`, `services/ai/localEmbeddingService.ts:106` |
| Local inference | v2 | `workers/v2/inference.worker.ts` | `services/workerBusManager.ts:80` |
| WebLLM | v2 only | `workers/v2/webllm.worker.ts` | `services/workerBusManager.ts:84` |

`duckdbClient.ts` is in turn imported by `hooks/useDuckDb.ts`, `services/duckdb/duckdbAnalytics.ts`,
`services/duckdb/duckdbMigration.ts`, `services/duckdb/ragVectorMigration.ts`, and
`services/ai/telemetryService.ts`. `services/workerBusManager.ts` is imported by
`services/hybridRouter.ts`, `services/localAiFacade.ts`, and `app/listenerMiddleware.ts`, which is
registered directly into the Redux store (`app/store.ts:175`,
`.prepend(listenerMiddleware.middleware)`). Neither generation is dead code shadowed by the other.

**Concrete cost observed this sprint:** WS-5 (DuckDB-WASM self-hosting, F-09) had to apply the same
CDN-URL fix twice — once in `workers/duckdbWorker.ts`, once in `workers/v2/duckdb.worker.ts` —
because the same logic is duplicated across both generations. Any future fix to shared worker
concerns (CSP compliance, error handling, protocol changes) pays this tax again until consolidated.

`CLAUDE.md`'s own Architecture section describes `packages/worker-bus` (WorkerBus v2) as "Central
orchestration layer for all background tasks... auto-scaling pool, priority queue + circuit
breakers, dead-letter queue" — i.e. the codebase's own documentation already implies v2 is the
intended long-term target, without ever stating that v1 is deprecated or scheduling its removal.

## Decision

**Document the current state; do not consolidate in this sprint.** Migrating the v1 call sites
(`duckdbClient.ts`, `localNlpService.ts`, `localEmbeddingService.ts`) onto WorkerBus v2 touches
live, load-bearing code paths (analytics dual-write, local NLP/embedding inference used across RAG,
cross-project search, and ProForge's memory bank) and is a properly-scoped migration effort in its
own right — not a byproduct of a CSP/crypto/doc-truth hardening sprint.

This sprint's estimated scope was fixing CSP directives, desktop crypto, and doc-truth drift across
a bounded set of already-identified files (F-01..F-10). Migrating the 3 v1 call sites onto WorkerBus
v2 additionally requires re-verifying analytics dual-write, RAG/cross-project search, and ProForge's
memory bank — a different, materially larger surface than anything this sprint scoped, not merely a
longer version of it. That is this ADR's own STOP-AND-ASK decision (a sprint-local heuristic adopted
here, not a citation to an external governing policy): a workstream discovered mid-sprint to require
touching unrelated, independently load-bearing subsystems is deferred and documented rather than
absorbed silently.

## Consequences

- **Positive:** no migration risk introduced under time pressure; this ADR gives the next person
  (or sprint) who touches either worker generation the full picture instead of having to
  rediscover the duplication from scratch.
- **Negative (accepted, tracked):** any future fix to shared worker concerns must still be applied
  twice until consolidated. `TODO.md` carries a follow-up entry pointing here.
- **Follow-up:** a dedicated migration sprint should decide the target generation (v2, per the
  existing architecture docs' framing), write a migration plan for the 3 v1 call sites, and only
  then remove `workers/duckdbWorker.ts` / `workers/inference.worker.ts`. Until that happens, any
  change to worker-level concerns (CSP, error handling, message protocol) must be checked against
  **both** generations — grep for the affected worker filename across the whole repo, not just the
  generation you're already looking at.

## References

- `services/duckdb/duckdbClient.ts:25`, `services/workerBusManager.ts:80-84`
- `services/ai/localNlpService.ts:19`, `services/ai/localEmbeddingService.ts:106`
- `app/store.ts:175` (WorkerBus v2's `listenerMiddleware` registration)
- `docs/adr/0005-webllm-worker-offload.md` (P1-1, WorkerBus v2's WebLLM offload — v2-only, no v1 equivalent)
- WS-5 / F-09 (`docs/adr/0013-csp-wasm-and-blob-frames.md` is unrelated but the same audit sprint) — the duplicated-fix cost that prompted writing this down
