# Plan: right-size the Claude web-path ceiling/timeout (ProForge)

Status: **planned, not yet implemented** — prep doc from a `/claude-api prompt-audit` pass (2026-09-12). Implement in this branch (`fix/proforge-anthropic-maxtokens-ceiling`) when work resumes.

## Finding

The Anthropic relay and several ProForge agents cap output far below what the target models (`claude-opus-5`/`claude-sonnet-5`, per `services/ai/cloudModelCatalog.ts`) actually support, and the web path never streams:

- `api/_shared/claudeProxyCore.ts:15` — `MAX_TOKENS_CEILING = 8192` (zod `.max()` on the request — an **over-limit request is rejected outright**, not clamped)
- `api/_shared/claudeProxyCore.ts:16` — `OUTBOUND_TIMEOUT_MS = 20_000`
- `api/_shared/claudeProxyCore.ts:146-168` — single blocking `fetch()` + one `.text()` read; no SSE
- `services/aiProviderService.ts:357-372` (`deliverAnthropicResponse`) — delivers the whole response as **one** `onChunk` call; "streaming" is fake for Claude specifically (OpenAI/Grok/Ollama paths do real SSE)
- `services/proForge/pipelineAgents/baseAgent.ts:178` — default `cfg.maxTokens ?? 8192`
- Extra-tight per-call caps, all hardcoded to `4000`: `publishingAgent.ts:50`, `proofAgent.ts:49`, `proseAgent.ts:89`, `copyEditAgent.ts:65`

## Verified constraint (from the current Claude API docs, checked 2026-09-12)

Claude Opus 5 / Sonnet 5 support **up to 128K output tokens**, but the API requires **streaming** to use values that large without hitting HTTP timeouts. Opus 5 also runs **adaptive thinking on by default** (unlike Opus 4.8/4.7), which adds latency before any visible output — compounding the risk under a 20s non-streaming timeout. Large ProForge payloads (up to 100 structural edits, or the full publishing package) are exactly the shape most likely to get truncated or time out under the current ceiling.

## Two-part fix

**Part A — mechanical, low risk (do first):**

```diff
- const MAX_TOKENS_CEILING = 8192;
- const OUTBOUND_TIMEOUT_MS = 20_000;
+ const MAX_TOKENS_CEILING = 32_000;
+ const OUTBOUND_TIMEOUT_MS = 55_000;
```

Raise the four `4000` per-call caps: `publishingAgent.ts`/`proofAgent.ts` (whole-manuscript scope, heavier output) → `16_000`; `proseAgent.ts`/`copyEditAgent.ts` (per-section, runs in a loop up to 5×/3× per stage) → `8_000`. All within the raised `MAX_TOKENS_CEILING`.

**Part B — real streaming, needs design time (flag, don't blind-diff):**

Genuine 128K-scale output still needs true SSE end-to-end: the Cloudflare/Vercel Pages Function currently reads the whole upstream body before responding, and `deliverAnthropicResponse` delivers it as one chunk. Fixing this means streaming through the edge function (`api/_shared/claudeProxyCore.ts:146`) and switching `deliverAnthropicResponse` (`services/aiProviderService.ts:357`) to a real reader loop that calls `callbacks.onChunk` incrementally. Worth doing, but it's an architecture change, not a one-line hunk — scope it as its own PR once Part A is in and measured (see `docs/PROFORGE-CLAUDE-TOKEN-ACCOUNTING-PLAN.md` for the usage-visibility prerequisite).

## Implementation checklist for next session

1. Apply Part A's diff (5 files above).
2. Run `pnpm run typecheck` + `pnpm run lint`.
3. Sanity-check a ProForge run locally against a real Claude API key if available, watching for the proxy's 400 (over-ceiling) or 504 (timeout) responses disappearing.
4. Decide whether to also tackle Part B in the same PR or split it further.
