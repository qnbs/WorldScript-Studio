# Plan: right-size the Claude web-path ceiling/timeout (ProForge)

Status: **planned, not yet implemented** — prep doc from a `/claude-api prompt-audit` pass (2026-09-12,
corrected 2026-09-15 against post-#719/#759 `main` and a full review wave). Implement in this branch
(`fix/proforge-anthropic-maxtokens-ceiling`) when work resumes.

## Finding

The Anthropic relay and several ProForge agents cap output far below what the target models (`claude-opus-5`/`claude-sonnet-5`, per `services/ai/cloudModelCatalog.ts`) actually support, and the web path never streams:

- `api/_shared/claudeProxyCore.ts:15` — `MAX_TOKENS_CEILING = 8192` (zod `.max()` on the request — an **over-limit request is rejected outright**, not clamped)
- `api/_shared/claudeProxyCore.ts:16` — `OUTBOUND_TIMEOUT_MS = 20_000`
- `api/_shared/claudeProxyCore.ts:146-168` — single blocking `fetch()` + one `.text()` read; no SSE; the request body has no `stream` field at all
- `services/ai/providers/anthropicProvider.ts:8-20` (`deliverAnthropicResponse` — moved here from `aiProviderService.ts` by PR #759's provider-adapter extraction) — delivers the whole response as **one** `onChunk` call for *both* the Tauri desktop path and the web proxy path (neither request body sets `stream`); "streaming" is fake for Claude specifically
- `services/proForge/pipelineAgents/baseAgent.ts:185` — default `cfg.maxTokens ?? 8192`
- Extra-tight per-call caps, all hardcoded to `4000`: `publishingAgent.ts:50`, `proofAgent.ts:49`, `proseAgent.ts:89`, `copyEditAgent.ts:65`

`publishingAgent.ts`/`proofAgent.ts` do **not** currently see the whole manuscript — `proofAgent.ts:34`
truncates its input to 12,000 characters and `publishingAgent.ts:31-32` sends two 500-character
excerpts. Both agents are still the two with the heaviest per-call output relative to input,
which is why their caps are proposed higher below, but "whole-manuscript scope" was the wrong
framing for the input side.

## Verified constraint (from the current Claude API docs, checked 2026-09-12)

Claude Opus 5 / Sonnet 5 support **up to 128K output tokens**, but the API requires **streaming** to use values that large without hitting HTTP timeouts. Opus 5 also runs **adaptive thinking on by default** (unlike Opus 4.8/4.7), which adds latency before any visible output — compounding the risk under a 20s non-streaming timeout. Large ProForge payloads (up to 100 structural edits, or the full publishing package) are exactly the shape most likely to get truncated or time out under the current ceiling.

**Correction: Grok already streams for real.** An earlier pass of this plan claimed Grok fakes
streaming like Claude does — verified false against current code: `streamGrok`
(`services/ai/providers/openaiProvider.ts:195-224`) sends `stream: true` and consumes the response
via `consumeOpenAiCompatibleStream`, a genuine SSE reader loop. OpenAI and Ollama were not
re-audited here but were not disputed by this review wave; Claude (and only Claude, among the
providers reachable from this codebase) fakes streaming.

## Why raising the four agent caps alone does nothing for most users

`Math.min(config.maxTokens, N)` is bounded by whichever is *smaller*. For a real ProForge run
started through the UI, `config.maxTokens` is **not** `DEFAULT_PIPELINE_CONFIG.maxTokens` (8000,
`features/proForge/types.ts:129` — only used when no config is built at all); it's
`settings?.advancedAi?.maxTokens ?? 8000` from `hooks/useProForgeOrchestrator.ts:45`, and
`features/settings/settingsSlice.ts:73` seeds `advancedAi.maxTokens` at **4096** by default. Redux
state is never `undefined` once the slice initializes, so the `?? 8000` fallback never actually
fires for a normal user — the effective default is 4096. Raising the four hardcoded `4000` literals
to `16_000`/`8_000` therefore evaluates as `Math.min(4096, 16000/8000) = 4096`: a **96-token**
increase over today's `4000`, not the intended one. Part A must also raise the effective default —
either `settingsSlice.ts`'s `advancedAi.maxTokens` seed or the `useProForgeOrchestrator.ts` fallback
— or explicitly scope this plan as "only benefits users who manually raise their AI settings budget
above 4096."

**Not Claude-specific**: `BaseAgent.buildAiOpts()` (`services/proForge/pipelineAgents/baseAgent.ts:152-188`)
forwards `maxTokens` identically regardless of which provider is actually configured — there is no
Anthropic-only branch. Raising the four agent-level caps changes the request budget (latency, cost,
and effective output limit) for whichever provider a given ProForge run is routed to: Gemini,
OpenAI, Grok, and Ollama are all affected, not only Claude. Either keep these four increases gated
to the Anthropic path specifically, or treat this as a deliberate cross-provider change and say so.

**Security/threat-model impact of the timeout change**: the 20s `OUTBOUND_TIMEOUT_MS` is not just a
latency knob — `docs/SECURITY-THREAT-MODEL.md`'s "Public `claude-proxy` endpoint used as an open
relay / resource-exhaustion surface (CWE-400)" row explicitly lists the 20s outbound timeout,
alongside the body-size cap, same-origin check, and per-client rate limit, as part of the documented
abuse-control bundle for this *public, unauthenticated* endpoint. Raising it to 55s lets each
unauthenticated relay invocation occupy an edge function instance nearly 3x longer. This needs an
explicit resource-exhaustion re-assessment (does the existing rate limit + body-size cap still bound
worst-case function-instance-seconds acceptably at 55s?) and a `docs/SECURITY-THREAT-MODEL.md`
update alongside the code change — not a five-file mechanical diff.

## Two-part fix

**Part A — mechanical, low risk, but incomplete without the default-budget fix above (do first):**

```diff
- const MAX_TOKENS_CEILING = 8192;
- const OUTBOUND_TIMEOUT_MS = 20_000;
+ const MAX_TOKENS_CEILING = 32_000;
+ const OUTBOUND_TIMEOUT_MS = 55_000;
```

Raise the four `4000` per-call caps: `publishingAgent.ts`/`proofAgent.ts` (heavier output relative to
their truncated/excerpted input) → `16_000`; `proseAgent.ts`/`copyEditAgent.ts` (per-section, runs in
a loop up to 5×/3× per stage) → `8_000`. All within the raised `MAX_TOKENS_CEILING`. **Also** raise
the effective default budget (`settingsSlice.ts`'s `advancedAi.maxTokens` seed and/or
`useProForgeOrchestrator.ts`'s fallback) above 16_000, or these four increases are a no-op for
default users. Decide provider scoping (Anthropic-only vs. all providers) before implementing.
Include the `docs/SECURITY-THREAT-MODEL.md` re-assessment and update as part of this part, not a
follow-up.

**Part B — real streaming, needs design time (flag, don't blind-diff):**

Genuine 128K-scale output still needs true SSE end-to-end, and it needs it on **both** upstream
paths that call `deliverAnthropicResponse`: the Cloudflare/Vercel Pages Function
(`api/_shared/claudeProxyCore.ts:146`, web) and the Tauri native-HTTP path
(`services/ai/providers/anthropicProvider.ts:37-43`, desktop) both currently omit `stream: true`
from their request bodies, and neither reads an event stream. Fixing this means adding `stream: true`
to both request bodies, switching the proxy to stream its response through instead of buffering
`.text()`, and switching `deliverAnthropicResponse` to a real reader loop that parses Anthropic's
SSE event types and calls `callbacks.onChunk` incrementally per delta — not just wrapping the
existing single-shot read in a loop. Worth doing, but it's an architecture change touching two
call sites in lockstep, not a one-line hunk — scope it as its own PR once Part A is in and measured
(see PR #727 / `docs/PROFORGE-CLAUDE-TOKEN-ACCOUNTING-PLAN.md`, not yet merged, for the
usage-visibility prerequisite).

## Implementation checklist for next session

1. Decide the two open questions above: provider scoping for the four agent caps, and where the
   effective default budget gets raised.
2. Apply Part A's diff (the five files above, plus whichever default-budget file was chosen).
3. Update `docs/SECURITY-THREAT-MODEL.md`'s CWE-400 row to reflect the new timeout and the
   re-assessment's conclusion.
4. Run `pnpm run typecheck`, `pnpm run lint`, and `pnpm run ci:prepush` — this changes request-schema
   bounds, a security-relevant timeout, and agent token forwarding, not a docs-only or
   test-only change, so the full pre-push gate applies. Add or update focused unit coverage for the
   proxy's ceiling/timeout constants and for agent token-forwarding, not just a live-key sanity check.
5. Sanity-check a ProForge run locally against a real Claude API key if available, watching for the
   proxy's 400 (over-ceiling) or 504 (timeout) responses disappearing.
6. Decide whether to also tackle Part B in the same PR or split it further.
