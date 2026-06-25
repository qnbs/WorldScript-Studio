# ADR 0011 — AI heuristic fallbacks via a registry + provider-layer seam (no orchestrator class)

- **Status:** Accepted (PR 0 foundation shipped; per-feature generators staged)
- **Date:** 2026-06-25
- **Deciders:** Maintainer + Claude Code
- **Context tags:** ai, resilience, offline, heuristics, fallback

## Context

When AI is unavailable (offline, quota/rate-limit, error, Eco/Heuristics-only mode, low local-inference
availability), most AI features hard-fail — a toast or an `"Error: …"` string in the result pane. The
only terminal heuristic (`services/localAiFacade.ts`) is a stub returning `"Heuristic fallback
response"`, and the structured generators (Outline, Character, World, Plot-Board) call
`generateJson`+Gemini which **bypasses the provider fallback chain entirely**, so they have no degrade
path at all. The app feels broken when AI fails instead of gracefully assisted.

The strategic brief proposed a large "Unified Fallback Orchestrator" service plus a Confidence Scorer
and a Context Intelligence Layer. But the codebase already contains nearly all the primitives: a
pluggable heuristic engine (`services/copilot/heuristicEngine.ts`, `registerRule`), a provider fallback
chain with a terminal local seam (`services/aiProviderService.ts` `generateText:503`), ProForge's
`isFallback` + `SupervisionDecision { pass, qualityScore, reasons }` confidence model, error
classification (`classifyAiError`), degraded-state UI atoms (`AiModeIndicator`, `Badge`, `Toast`), and
telemetry (`recordInferenceTelemetry` through the analytics gate).

## Decision

Build the **minimum that closes the real gaps**, reusing those seams — **no new orchestrator class**.

1. **Heuristic-generator registry** (`services/ai/heuristicFallback/`) modeled on the existing rule
   engine: `registerHeuristicGenerator(task, fn)` + `runHeuristicFallback(task, ctx)`. Each AI feature
   registers one generator keyed by a stable task id; if none is registered the call returns `null` and
   the caller keeps its existing behavior — so the layer is always safe to ship empty.
2. **Shared envelope** `HeuristicFallbackResult<T> = { data, isFallback: true, confidence (0..1),
   tier, reasonKey }` — reuses ProForge's `isFallback` discriminator; `confidence` is the one new
   field, calibrated like `supervisorAgent.confidenceScore`.
3. **Provider-layer seam** — wire `runHeuristicFallback` into the three choke points that callers
   already use: `generateText`'s terminal (before the generic local stub), `generateJson` (the
   Gemini-direct path that previously had no fallback), and `streamText` (deliver the heuristic through
   `onChunk`+`onDone`). The seam carries `heuristicTask` + `heuristicContext` on `AIRequestOptions`.
   We attach at the provider service rather than deep in `localAiFacade` because that is where the task
   id and feature context are available.
4. **Degraded UX + telemetry** — a small `useHeuristicFallback()` hook over a module-level event
   observable feeds a reusable `AssistedModeBadge` and records each fallback to `recordInferenceTelemetry`
   (existing schema: `backend:'heuristic'`, `taskType:'heuristic:<task>'`) through the analytics gate.

## Alternatives considered

- **A central Unified Fallback Orchestrator class** (the brief's design) — rejected as over-engineering:
  `aiProviderService` + `inferenceGateway` already are the single choke points; a new orchestrator
  would duplicate the routing/chain logic without earning its weight.
- **A new dedicated confidence type** — rejected in favor of reusing ProForge's `isFallback` +
  `SupervisionDecision`/`confidence` conventions for cross-codebase consistency.
- **Re-pointing the `localAiFacade` stub at the registry** — deferred: the stub lacks the task id and
  feature context; the provider-layer seam is the better attachment point. The stub stays as the honest
  "no heuristic available" last resort.

## Consequences

- **Positive:** every targeted feature can degrade gracefully and offline; one consistent fallback
  model; minimal new surface (a tiny registry + one envelope + UI atoms); ships inert and safe, then
  lights up feature-by-feature.
- **Negative / trade-offs:** per-feature generators are real work (subsequent PRs); heuristic quality
  depends on project context and templates; the generic `localAiFacade` stub still exists for tasks
  with no registered generator.
- **Follow-ups (own PRs):** structured generators (Outline/Character/World/Plot-Board), Writing Studio
  tools, analysis tools; later — Copilot rule expansion + learning/personalization.

See the plan and `docs/AI-HEURISTIC-FALLBACKS.md` (added with the first feature generators) for the
feature-level detail.
