# ADR 0005 — WebLLM inference offloaded to a dedicated WorkerBus v2 pool

- **Status:** Accepted
- **Date:** 2026-06-10
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, performance, workers, ai, webgpu

## Context

`services/localAiFacade.ts` (`generateLocalText`) ran `@mlc-ai/web-llm` (MLC, WebGPU) **inline on the
main thread**. Model loading and token generation blocked the UI thread, causing visible jank during
local inference. It also used the legacy `@domain/ai-core` `WorkerBus` only as an in-process queue
(`enqueue`→`dequeue` in the same tick) — so there was no real off-thread execution, no circuit
breaking, and no priority scheduling. This was the last heavy AI workload still on the main thread
(transformers.js embeddings/text and DuckDB already run in `workers/v2/*`).

P1-1 calls for moving all WebLLM inference into a dedicated, isolated worker, reusing the WorkerBus v2
runtime ([[0003-workerbus-hybrid-routing]]).

## Decision

1. **New capability `inference.webllm`** (added to `packages/worker-bus/src/schemas.ts` +
   `types.ts`).
2. **Dedicated `webllm` pool**, registered in `services/workerBusManager.ts` (`maxWorkers: 1`,
   `minWorkers: 0`) pointing at the new **`workers/v2/webllm.worker.ts`**. A separate pool — not the
   existing `inference` pool — keeps the ~6 MB `@mlc-ai/web-llm` chunk out of the transformers.js
   worker bundle and isolates the WebGPU lifecycle. One worker is sufficient: tab-leader election
   already serializes heavy inference across tabs, and WebGPU is a single shared device.
3. **Worker-first with automatic main-thread fallback (no flag).** WebLLM offload is "always-on" and
   therefore **decoupled from `enableWorkerBusV2`** — `ensureWebLlmPool()` lazily initializes the bus
   regardless of that flag. `generateLocalText` attempts the worker whenever WebGPU **and** a `Worker`
   global are present; on `NO_WEBGPU`, worker-spawn failure, circuit-open, or an empty completion it
   silently falls back to the existing `runLocalTextGeneration` main-thread orchestrator (WebLLM →
   ONNX → transformers.js → heuristic). The fallback **is** the rollback path for "always-on".
4. **GPU mutex + tab election stay on the main thread**, acquired *before* enqueue
   (`gpuResourceManager.acquireGpu('webllm','high')`); the worker never re-acquires, avoiding a
   double-acquire / VRAM race.
5. **Progress bridging.** The worker emits `loading`/`done` progress (model-load fraction); the caller
   maps these onto the existing `inferenceProgressEmitter` (`reportWebLlmProgress`/`reportWebLlmReady`)
   so existing UI subscribers are unchanged. No token streaming is introduced — the prior main-thread
   path was already non-streaming (it awaited the full completion), so UX is preserved exactly.

## Consequences

- **Positive:** WebLLM model load + generation run off the main thread (UI stays responsive); the
  workload gains WorkerBus backpressure/circuit-breaking/abort; no new runtime dependency; graceful
  degradation on devices without WebGPU-in-worker (Safari, older Firefox) via the retained
  main-thread path.
- **Negative:** WebLLM now has two execution paths (worker + fallback). Mitigated because the fallback
  reuses the *same* `webllmOptimizer` engine cache and the *same* orchestrator, so behavior is
  identical; the path is chosen purely by capability.
- **Verification:** `tests/unit/webllmWorkerHandler.test.ts` (handler logic) +
  `tests/unit/localAiFacade.test.ts` (enqueue payload, progress mapping, fallback on `NO_WEBGPU`,
  GPU acquire/release). Bundle isolation is exercised by the CI `build` + `smoke:prod` jobs.

## Rejected alternatives

- **MLC's native `CreateWebWorkerMLCEngine` / `WebWorkerMLCEngineHandler`** — purpose-built but
  bypasses WorkerBus's queue, circuit breaker, DLQ and abort. We keep WorkerBus as the single
  orchestration layer and call the plain `getWebLlmEngine`/`CreateMLCEngine` inside the worker
  (mirrors how `inference.worker.ts` wraps transformers.js).
- **Gate behind `enableWorkerBusV2`** — would couple a UI-responsiveness fix to a broader, off-by-
  default rollout; "always-on with capability fallback" gives the win everywhere with a built-in
  rollback.
- **Reuse the `inference` pool** — would bundle `@mlc-ai/web-llm` with transformers.js and entangle
  the WebGPU lifecycle with embedding/text workers.

## References

- `CLAUDE.md` § AI Services / WorkerBus v2
- `workers/v2/webllm.worker.ts`, `services/localAiFacade.ts`, `services/workerBusManager.ts`,
  `packages/ai-core/src/webllmOptimizer.ts`
- `TODO.md` P1-1
- [[0002-local-ai-stack-layering]], [[0003-workerbus-hybrid-routing]]
