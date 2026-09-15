# Plan: real token accounting for the Claude path (ProForge)

Status: **planned, not yet implemented** — prep doc from a `/claude-api prompt-audit` pass (2026-09-12,
corrected 2026-09-15 against post-#719/#759 `main`). Implement in this branch
(`fix/proforge-token-accounting`) when work resumes.

## Finding

`ProForge` agents label a raw **character** count as "tokens", across seven files:

- `services/proForge/pipelineAgents/structuralAgent.ts:67` — `tokensConsumed += response.length;`
- `services/proForge/pipelineAgents/diagnosticAgent.ts:72,91` — same pattern (initial call + retry)
- `services/proForge/pipelineAgents/publishingAgent.ts:52`
- `services/proForge/pipelineAgents/proofAgent.ts:51`
- `services/proForge/pipelineAgents/proseAgent.ts:91` (per-section loop)
- `services/proForge/pipelineAgents/copyEditAgent.ts:67` (per-section loop)
- `services/proForge/pipelineAgents/baseAgent.ts:220` — `selfReflect()`'s `tokensUsed: response.text.length`

`baseAgent.ts` is not a minor seventh concern — `structuralAgent.ts` and `diagnosticAgent.ts` both do
`tokensConsumed += reflection.tokensUsed;` after calling `selfReflect()`, so its raw character count
already leaks into two of the other six files' totals today. Fixing those six without also fixing
`baseAgent.ts` leaves that leak in place.

`AnalyticsAgent` has no AI call and needs no change.

`deliverAnthropicResponse` (`services/ai/providers/anthropicProvider.ts:8-20`, moved here from
`aiProviderService.ts` by PR #759's provider-adapter extraction) reads the full Anthropic response
JSON and discards `json.usage` entirely — the real `usage.input_tokens`/`usage.output_tokens` (and
thinking-token spend on Opus 5, which runs adaptive thinking by default) never reach the app.

## Small fix (low risk, do first)

The existing token estimator (`services/ragPromptAssembly.ts:52-54`, `estimateTokens`) is the right
formula, but importing it as-is is not safe for every caller of these seven files:

```ts
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.3);
}
```

`ragPromptAssembly.ts` transitively imports `services/ai/localEmbeddingService.ts` (Web Worker via
`workerBusManager`) and pulls in `services/localRagService.ts`'s WebGPU/DuckDB-WASM chain through
sibling module graphs — browser-only. ProForge agents also load under the Node-based MCP server
(`.mcp/proforge-mcp-server`), so importing `estimateTokens` straight from `ragPromptAssembly.ts`
risks breaking that path before an agent even runs. Extract `estimateTokens` into a new
dependency-free module (e.g. `services/tokenEstimate.ts`) first, have `ragPromptAssembly.ts` import
it from there and re-export it (both `tests/unit/ragPromptAssembly.test.ts` and
`tests/unit/services/ragPromptAssembly.test.ts` import `estimateTokens` from
`ragPromptAssembly.ts` directly today — removing that export without a re-export breaks them), and
have the seven agent files import from the new module.

Then, in each of the seven files above, replace every raw character count
(`response.length` / `retryRaw.length` / `response.text.length`) with the matching
`estimateTokens(...)` call. Mechanical, no interface changes, no test breakage expected beyond any
test asserting the old raw-length value.

## Larger fix (design decision needed, not a blind diff)

Thread Anthropic's real `usage` object back through the call chain instead of estimating. The
ProForge-facing boundary is **not** `generateText`'s bare `Promise<string>` — it's `GenerateResult`
(`services/ai/inferenceGateway.ts`), the type `InferenceGateway.generate()` actually returns to
`BaseAgent`/the pipeline agents:

1. `deliverAnthropicResponse` (`services/ai/providers/anthropicProvider.ts:8-20`) already has
   `json.usage` available — capture `{ inputTokens, outputTokens }` instead of discarding it. Its
   only way to communicate today is `AIStreamCallbacks` (`onChunk`/`onDone`/`onError`), and
   `streamAnthropic` itself returns `Promise<void>` — so this needs a new optional
   `onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void` callback (or an
   equivalent side-channel `generateText` can read after the stream completes).
2. `generateText` (`services/aiProviderService.ts:276-281`, `Promise<string>`) needs a way to
   surface that captured usage to its caller without breaking its existing plain-string callers.
   This is an interface change affecting every provider path (only Anthropic can populate it for
   now; Gemini/local/other providers stay `undefined`) — **decide the exact shape with the user
   before implementing** (an overload, a second parallel function, or a mutable out-param are all
   plausible; this doc intentionally does not pick one).
3. `DefaultInferenceGateway.generate()` (`services/ai/inferenceGateway.ts`) needs to capture that
   usage and add an optional `usage?: { inputTokens: number; outputTokens: number }` field to
   `GenerateResult`. `NodeInferenceGateway.generate()` (`services/proForge/adapters/nodeInferenceGateway.ts`,
   Gemini-backed) always returns `usage: undefined` — Gemini's usage metadata is a separate,
   unaudited follow-up, out of scope here.
4. Once available, each of the seven files' existing per-call accounting stays additive exactly as
   it is today (`structuralAgent.ts`/`diagnosticAgent.ts` already do `tokensConsumed +=` once for
   the primary call, once for `selfReflect()`, and again for a retry; `proseAgent.ts`/`copyEditAgent.ts`
   already do it once per qualifying section) — only the *source* of each addend changes: use
   `usage?.outputTokens ?? estimateTokens(response)` for the six string-returning call sites, and
   `usage?.outputTokens ?? estimateTokens(response.text)` in `baseAgent.ts`'s `selfReflect()`,
   which returns an object, not a bare string. Do not collapse a multi-call agent's total down to a
   single final `usage.output_tokens` value.
5. `tokensConsumed` today only ever accumulated an output-side estimate. Decide with the user
   whether it should stay output-only (cheapest to implement, matches current semantics) or become
   `inputTokens + outputTokens` (more honest cost signal, but a metric-contract change every
   consumer of `tokensConsumed` needs to tolerate) before implementing — don't silently change what
   the number means.

## Why this matters

Without real usage data, the `MAX_TOKENS_CEILING`/timeout tuning proposed in the companion plan
(tracked in parallel PR #728, `docs/PROFORGE-CLAUDE-MAXTOKENS-CEILING-PLAN.md`, not yet merged)
can't be validated from measurement — right now nobody can tell whether the app's self-imposed
ceilings are actually being hit.
