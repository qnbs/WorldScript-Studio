# ADR 0003 — WorkerBus v2 hybrid routing and the Rust TaskSupervisor

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, performance, workers, tauri, ai

## Context

Background work in StoryCraft Studio (inference pipelines, DuckDB analytics, embeddings) historically
used ad-hoc worker wiring in `packages/ai-core`. That gave no priority scheduling, no circuit
breaking, no dead-letter handling, and no consistent protocol — and it could only ever target a Web
Worker. The app also ships as a Tauri desktop bundle, where some CPU-bound work is better done in
native Rust than in a WASM/JS worker.

We needed (a) a production-grade orchestration layer, (b) a way to migrate existing callers without a
big-bang rewrite, and (c) a single seam where a task can be dispatched to **either** a Web Worker
**or** native Rust, decided at runtime — without coupling call sites to Redux or to the Tauri runtime.

This ADR records the v2 architecture and the routing/degradation contract. Phase 1 built the runtime
(`@domain/worker-bus`); Phase 2 wired it into the app; Phase 3 added the native Rust backend.

## Decision

### Layers

1. **`@domain/worker-bus`** — the runtime: `WorkerBus` (orchestrator) → `WorkerRegistry` (capability →
   pool) → `WorkerPool` (auto-scaling `PooledWorker`s) → `PriorityTaskQueue` + `CircuitBreaker` +
   `DeadLetterQueue` + `ProtocolHandler` (versioned, Zod-validated `postMessage`). All thresholds live
   in `constants.ts`; never hardcoded at call sites.
2. **`services/workerBusManager.ts`** — singleton lifecycle. `initWorkerBus()` registers the
   `inference` (text + embed) and `duckdb` pools pointing at `workers/v2/*.worker.ts`; gated by the
   `enableWorkerBusV2` flag. `app/listenerMiddleware.ts` initializes on the OFF→ON flag transition,
   shuts down on ON→OFF, and `initWorkerBusOnStartup()` covers the cold-start case (flag already on in
   persisted state) — mirroring the `initAdaptiveAiOnStartup` pattern.
3. **`services/hybridRouter.ts`** — `routeTask(taskType, payload, opts)`, the single dispatch seam:
   - `target: 'rust'` (or `'any'`) **and** `rustComputeEnabled` **and** a reachable Tauri supervisor →
     native Rust via `services/tauriTaskBridge.ts`.
   - everything else, or any Rust failure → the WorkerBus v2 Web Worker pool (silent fallback).
   - returns `null` only when the bus is uninitialized (flag off / startup race) so callers can skip
     or use a legacy path. **Redux-free:** the caller passes `rustComputeEnabled` in; the router never
     reads the store.
4. **`services/legacyWorkerBusAdapter.ts`** — shims the old `@domain/ai-core` WorkerBus API
   (`enqueue/cancel/dequeue/getTelemetry`) onto the v2 bus so existing callers keep working unchanged
   during migration (Strangler pattern).
5. **Rust TaskSupervisor** (`src-tauri/src/commands/task_supervisor.rs`) — `…_ping` (availability) and
   `…_submit` (taskType dispatcher) Tauri commands. First native task: `text.analyze`. Contract mirrors
   `@domain/worker-bus` `RustTaskRequest` → `RustTaskResultEvent` (serde camelCase).

### Honest-failure contract

The Rust `submit` command resolves **unknown or bad-payload tasks** as
`{ success: false, error, … }` — never a hard `Err`. The router's fallback and the caller's success
path are therefore driven by `result.success`, not by a thrown exception. The TS front-end
(`rustTaskSupervisor.ts`) probes `isRustComputeAvailable()` **before** routing, so a Rust-only task is
never accidentally enqueued onto the Web Worker pool. This mirrors the degradation contract in
[[0002-local-ai-stack-layering]] (a backend that cannot run must report unavailable).

## Consequences

- **Positive:** one orchestration runtime with backpressure/resilience; one dispatch seam for
  web-vs-native; flag-gated and idle-by-default (no consumer is forced through it); legacy callers keep
  working; the desktop build can offload CPU-bound work to Rust without changing call sites.
- **Negative:** more layers to understand, and two parallel worker trees (`workers/` legacy +
  `workers/v2/`) until migration completes. Mitigated by the adapter and this ADR.
- **Verification constraint:** the Rust half has **no PR-CI gate** — `tauri-build.yml` runs only on
  `workflow_dispatch` / `v*` tags, and the crate does not build on constrained dev hardware. Native
  changes are verified by dispatching `tauri-build` on the branch (see `AUDIT.md` 2026-06-03).
- **Maintenance rule:** after editing `packages/worker-bus`, run
  `pnpm exec vitest run tests/unit/workerBus`. After editing `src-tauri/`, dispatch `tauri-build.yml`
  on the branch — local `cargo` is not a sufficient gate.

## Rejected alternatives

- **Keep ad-hoc `ai-core` workers** — no priority/circuit-breaking/DLQ; can't target Rust.
- **Couple the router to Redux** — would force every worker call site into a React/store context;
  passing `rustComputeEnabled` in keeps the router unit-testable and reusable from any context.
- **Big-bang migration off the legacy WorkerBus** — high risk; the `LegacyWorkerBusAdapter` lets
  callers move incrementally.

## References

- `CLAUDE.md` § WorkerBus v2
- `AUDIT.md` WorkerBus v2 Phase 3 + Tauri-Build Unblock (2026-06-03)
- `services/workerBusManager.ts`, `services/hybridRouter.ts`, `services/rustTaskSupervisor.ts`,
  `src-tauri/src/commands/task_supervisor.rs`
- [[0001-state-management-boundaries]], [[0002-local-ai-stack-layering]]
