# Plan: real token accounting for the Claude path (ProForge)

Status: **planned, not yet implemented** — prep doc from a `/claude-api prompt-audit` pass (2026-09-12). Implement in this branch (`fix/proforge-token-accounting`) when work resumes.

## Finding

`ProForge` agents label a raw **character** count as "tokens":

- `services/proForge/pipelineAgents/structuralAgent.ts:67` — `tokensConsumed += response.length;`
- `services/proForge/pipelineAgents/diagnosticAgent.ts:72,91` — same pattern (initial call + retry)
- `services/proForge/pipelineAgents/publishingAgent.ts:52`
- `services/proForge/pipelineAgents/proofAgent.ts:51`
- `services/proForge/pipelineAgents/proseAgent.ts:91` (per-section loop)
- `services/proForge/pipelineAgents/copyEditAgent.ts:67` (per-section loop)
- `services/proForge/pipelineAgents/baseAgent.ts:213` — `selfReflect()`'s `tokensUsed: response.text.length`

`services/aiProviderService.ts:362-369` (`deliverAnthropicResponse`) reads the full Anthropic response JSON and discards `json.usage` entirely — the real `usage.input_tokens`/`usage.output_tokens` (and thinking-token spend on Opus 5, which runs adaptive thinking by default) never reach the app. `AnalyticsAgent` has no AI call and needs no change.

## Small fix (low risk, do first)

Swap the character count for the existing token estimator already used elsewhere in this codebase (`services/ragPromptAssembly.ts:51-53`, `estimateTokens`):

```ts
export function estimateTokens(text: string): number {
  return Math.ceil((text.length / 4) * 1.3);
}
```

Import it in each of the six files above and replace `response.length` / `response.text.length` with `estimateTokens(response)` / `estimateTokens(response.text)`. Mechanical, no interface changes, no test breakage expected beyond any test asserting the old raw-length value.

## Larger fix (design decision needed, not a blind diff)

Thread Anthropic's real `usage` object back through the call chain instead of estimating:

1. `deliverAnthropicResponse` (`services/aiProviderService.ts:357-372`) already has `json.usage` available — capture `{ inputTokens, outputTokens }` instead of discarding it.
2. That requires extending `AIStreamCallbacks`/`generateText`'s return shape (currently just `Promise<string>`) to optionally carry usage, or a side-channel the ProForge agents can read. This is an interface change affecting every provider path (only Anthropic can populate it for now; others stay `undefined`) — decide the shape with the user before implementing, don't force it through as a mechanical hunk.
3. Once available, `structuralAgent.ts` etc. should prefer real `usage.output_tokens` when present, falling back to `estimateTokens()` for providers that don't return it.

## Why this matters

Without real usage data, the `MAX_TOKENS_CEILING`/timeout tuning in the companion plan (`docs/PROFORGE-CLAUDE-MAXTOKENS-CEILING-PLAN.md`) can't be validated from measurement — right now nobody can tell whether the app's self-imposed ceilings are actually being hit.
