# ADR 0002 — Local-AI stack layering and fallback chain

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** Maintainer + Claude Code
- **Context tags:** architecture, ai, performance, privacy

## Context

StoryCraft Studio is offline-first and privacy-first: AI must be able to run with **no cloud call**.
The local-inference stack grew across several sprints (WebLLM, ONNX Runtime Web, Transformers.js,
WGSL compute shaders, an adaptive engine, a device profiler, benchmark/telemetry). Audits flagged it
as "deep and high-maintenance." This ADR records the intended layering and the **degradation
contract** so the depth is legible and each layer's responsibility is fixed.

## Decision

### Layered fallback chain (most → least capable, capability-gated at runtime)

1. **WebLLM** (`services/localAiFacade.ts` → `packages/ai-core`) — WebGPU, largest local models
   (Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B). Tab-leader election via BroadcastChannel prevents
   multi-tab GPU contention.
2. **ONNX Runtime Web** (`packages/ai-core/onnxRuntimeEngine.ts`) — WebGPU or WASM, smaller models.
3. **Transformers.js** (`@huggingface/transformers` v3, `workers/inference.worker.ts`) — off-main-thread
   pipelines (text-generation, feature-extraction, sentiment, summarization).
4. **Heuristic / energy-based engines** — always-available last resort (e.g. `WebRtcVadEngine`,
   `EnergyThresholdWakeWordEngine`) so a feature never hard-fails when no model is loadable.

**Selection is not hardcoded.** `services/ai/adaptiveAiEngine.ts` + `localAiDeviceProfiler.ts`
(30 s TTL hardware cache) choose a backend per task; `recommendBackend()` falls to `onnx-wasm` when
WebGPU is absent. Cloud providers (Gemini/OpenAI/…) are a **separate** axis, always gated by
`assertCloudAiAllowed` (`services/ai/aiPolicy.ts`) — never reached when the user is local-only.

### Shared infrastructure (cross-cutting, not per-layer)

- **Pipeline residency:** `services/ai/pipelineLruCache.ts` — one LRU per worker, bounded
  (`MAX_PIPELINE_CACHE = 8`), **dispose-on-evict** (releases GPU/WASM memory), **in-flight load
  dedup**. Replaces the previously-duplicated cache loops in the two inference workers.
- **Result cache:** `services/ai/aiInferenceCacheService.ts` — two-layer (in-mem LRU 64 + IDB 256,
  7-day TTL, skips prompts > 512 chars).
- **Transient resilience:** `services/ai/aiRetry.ts` — exponential backoff + full jitter, with a
  server `Retry-After` taking precedence (clamped against hostile values).
- **Orchestration:** `@domain/worker-bus` (priority queue, circuit breakers, dead-letter queue);
  `workerBusManager` routes to `workers/v2/inference.worker.ts`.
- **Observability:** `benchmarkService` + `telemetryService` (local DuckDB / localStorage, no cloud),
  gated by `enableDuckDbAnalytics`.

### Honest degradation contract

A layer that cannot run **must report unavailable** (`isAvailable() === false`) so the next layer is
selected — it must never return a plausible-but-fake result. Example: `SileroVadEngine` is wired but
ONNX integration is deferred, so it reports `false` and the energy-based VAD is used. The ProForge
pipeline mirrors this with `isFallback: true` + 0 scores so the supervisor can trigger retries.

## Consequences

- **Positive:** Each layer has a single responsibility; capability gating means the app runs on a
  no-GPU low-end device down to the heuristic layer; memory is bounded by the shared LRU; the
  degradation contract prevents silent quality cliffs.
- **Negative:** Many moving parts. Mitigated by: shared infra (cache/retry/bus) instead of per-layer
  re-implementation, and this ADR as the map.
- **Maintenance rule:** new heavy optional chunks must be added to both `manualChunks` and
  `globIgnores` in `vite.config.ts` (never service-worker-precached).

## References

- `CLAUDE.md` § AI Services, § Local inference, § Code Splitting
- `AUDIT.md` Edge-AI Perfection Cycle (2026-05-31), Perf Hardening (2026-06-02)
- [[0001-state-management-boundaries]]
