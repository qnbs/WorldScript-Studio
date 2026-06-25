# AI heuristic fallbacks

When AI is unavailable — offline, quota/rate-limited, an error, **Eco** / **Heuristics-only** mode, or
no usable local inference — WorldScript Studio degrades **gracefully** instead of hard-failing. Each
covered feature falls back to a **context-aware heuristic** built from your existing project data, runs
fully **offline**, and is surfaced with an unobtrusive **"Assisted (offline)"** indicator plus a path to
re-run with a real model when one is available.

> Design rationale and the reuse-first architecture are in
> [ADR 0011](adr/0011-ai-heuristic-fallbacks.md).

## How it works

```
hooks (have t)  ──build localized labels──►  thunk  ──heuristicTask + heuristicContext──►
  services/aiProviderService (generateText / generateJson / streamText)
        │  AI path terminally unavailable (classifyAiError, not a user cancel)
        ▼
  services/ai/heuristicFallback/  registry → registered per-feature generator → HeuristicFallbackResult
        │
        ├─ useHeuristicFallback() + AssistedModeBadge   (the "Assisted (offline)" UX)
        └─ recordInferenceTelemetry                     (gated by analyticsGate)
```

- **Registry** (`services/ai/heuristicFallback/`) — each feature registers ONE generator keyed by a
  task id (e.g. `outline`). The provider seam calls `runHeuristicFallback(task, ctx)` when the AI path
  is terminally unavailable; with no generator it returns `null` and the caller keeps its old behavior.
- **Envelope** — `HeuristicFallbackResult<T> = { data, isFallback: true, confidence (0..1), tier, reasonKey }`
  (reuses ProForge's `isFallback` discriminator; `confidence` is calibrated per generator).
- **Localization** — generators are **pure** (no React `t`). The triggering hook resolves a small
  `<module>.heuristic.*` label set (with the user's own already-localized input interpolated) and passes
  it through the thunk; the generator only assembles those strings. A generator returns `null` if its
  labels weren't provided, so it can never emit untranslated text.
- **A user cancel is never a fallback** — only retryable/unavailable failures degrade.

## Covered features

| Feature | Task id | Heuristic | Status |
|---------|---------|-----------|--------|
| Outline Generator | `outline` | three-act beat sheet scaled to the requested chapter count (setup → inciting incident → rising action / midpoint / complications → optional twist → climax → resolution), with the user's idea woven in | ✅ shipped |
| Character profile | `character.profile` | structured field scaffold (backstory / motivation / appearance / arc / …) with the concept woven in | ✅ shipped |
| World profile | `world.profile` | structured-section scaffold (description / geography / magic / culture) with the concept woven in | ✅ shipped |
| Plot-Board beat | `plotBoard.beat` | structural rules over existing connections + tension | planned |
| Writing Studio tools | `writer.*` | per-tool heuristics (continue / improve / tone / dialogue / brainstorm / synopsis) | planned |
| Analysis tools | `critic.*` | structural rule findings (reuses the Copilot rule engine) | planned |

## Adding a new generator

1. Write a pure generator in `services/ai/heuristicFallback/generators/<feature>.ts` that returns
   `makeHeuristicResult(data, { confidence, tier, reasonKey })` (or `null` to decline), and
   `registerHeuristicGenerator('<task>', fn)` at module load.
2. Add `<module>.heuristic.*` i18n keys (all locales) for any structural copy.
3. In the feature's **hook**, resolve those keys via `t(...)` (interpolating the user's input) and pass
   the resolved labels through the thunk.
4. In the **thunk**, `import` the generator module (side-effect registration), set
   `aiOptions.heuristicTask` + `heuristicContext` (carry the labels in `params`), and call the provider.
5. Test the generator deterministically (mock no-project + rich-project; assert schema-valid output).

## Verifying manually

Force degradation three ways and confirm a useful result + the Assisted badge + an enhance path:
- Settings → AI mode → **Eco** or **Heuristics-only**;
- DevTools → **offline**;
- an **invalid API key**.
