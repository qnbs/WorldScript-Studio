# Plan: wire Claude's native structured outputs into ProForge

Status: **planned, not yet implemented** — prep doc from a `/claude-api prompt-audit` pass (2026-09-12,
corrected 2026-09-15 against post-#719/#759 `main` and a full review wave). Implement in this branch
(`feat/proforge-claude-structured-outputs`) when work resumes. This is the largest of the three audit
follow-ups; the other two (PR #727 / `docs/PROFORGE-CLAUDE-TOKEN-ACCOUNTING-PLAN.md` and PR #728 /
`docs/PROFORGE-CLAUDE-MAXTOKENS-CEILING-PLAN.md`, both not yet merged) are independent and smaller.

## Finding

Every JSON-producing ProForge stage asks Claude for JSON **in prose**, then hand-parses the reply:

- `services/proForge/pipelineOutput/structuredOutput.ts:387` (`stripJsonFences`) is the shared helper; the pattern it feeds is duplicated in `diagnosticAgent.ts:167-182`, `structuralAgent.ts:156-171`, `proseAgent.ts:93-124` (per-section), `copyEditAgent.ts:69-100` (per-section), `proofAgent.ts:55-70`, `publishingAgent.ts:56-71`: `stripJsonFences` → `JSON.parse` → on failure, a `/\{[\s\S]*\}/` regex brace-match → parse again → Zod `validateWithSchema`.
- Prose instructions live in `services/promptLibrary.ts:321,331,341,351,361,371` ("Return JSON with…") and `:251` ("Return JSON only: {…}").
- `AnalyticsAgent` makes no AI call — out of scope.
- **Eight `generate()` invocations, not six**: `DiagnosticAgent` and `StructuralAgent` each retry once on an incoherent self-reflection (`diagnosticAgent.ts:89`, `structuralAgent.ts:82`), calling `this.generate()` again with the same prompt. Both retry calls must receive the schema too, or a retry — precisely the case where the first response needed correction — reverts to unconstrained prose JSON.

The app already owns complete Zod schemas for every one of these six shapes in `structuredOutput.ts` (`diagnosticReportSchema`, `structuralEditPlanSchema`, `proseEditBatchSchema`, `copyEditPlanSchema`, `qualityGateReportSchema`, `publishingPackageSchema`) — it's just never handing them to the model.

## Verified Anthropic API constraints (checked live, 2026-09-12 — do not re-derive, use this)

Raw wire shape for `output_config.format` (confirmed against `https://platform.claude.com/docs/en/build-with-claude/structured-outputs`, since this app calls the Messages API via raw `fetch`, not the `@anthropic-ai/sdk` package):

```json
{
  "output_config": {
    "format": {
      "type": "json_schema",
      "schema": { "type": "object", "properties": { "...": "..." }, "required": ["..."], "additionalProperties": false }
    }
  }
}
```

**Response shape is unchanged** — the JSON comes back as plain text in a `type: "text"` content block, exactly like today. There is no `parsed_output` field at the raw-HTTP level (that's an SDK-only convenience from `client.messages.parse()`). This means `deliverAnthropicResponse` (`services/ai/providers/anthropicProvider.ts:8-20` — moved here from `aiProviderService.ts` by PR #759's provider-adapter extraction, merged since this plan was written) needs **zero changes** — only the request side changes. Keep `stripJsonFences`/`validateWithSchema` in place as a defense-in-depth safety net; don't remove them.

**Hard schema constraints — a schema violating these gets a 400:**

- `additionalProperties: false` is **required on every object node**, at every nesting level.
- **Not supported, will 400 if present:** `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (numeric), `minLength`, `maxLength` (string), `maxItems`/`minItems` other than 0 or 1 (array).
- Supported: basic types, `enum` (strings/numbers/bools/null only, no complex types), `const`, `anyOf`/`allOf` (not `allOf` with `$ref`), internal `$ref`/`$defs`/`definitions` (no external `$ref`), `default`, string `format` (`date-time`, `date`, `email`, `uuid`, etc.).

**This is exactly the problem**: every schema in `structuredOutput.ts` uses `.min()/.max()` on numbers (`qualityScoreSchema`'s 7 fields, `confidence: z.number().min(0).max(1)` everywhere) and `.max()` on arrays (`consistencyIssues.max(50)`, `edits.max(100)`, etc.) and strings (`summary: z.string().max(2000)`). A naive `z.toJSONSchema(schema)` (Zod 4.4.3 is already installed, `z.toJSONSchema` exists) would emit `minimum`/`maximum`/`maxLength`/`maxItems` everywhere and every one of the six calls would 400.

**Stripping a bound is not free** — several of those bounds encode real semantics that aren't
otherwise stated in the prompts (e.g. the publishing blurb length limits, the various prose score
ranges). Silently dropping `minimum`/`maximum`/`maxLength` from the wire schema makes it strictly
weaker than the Zod validator still guarding the response: Claude can return JSON that satisfies the
sanitized schema but still fails `validateWithSchema`, causing a valid-looking report/batch/package
to be discarded or replaced by a fallback for no visible reason. Whichever option below is chosen,
translate every stripped bound into either a prompt-level instruction or a `description` field on
the corresponding schema node — don't just delete it.

## Why not just add `@anthropic-ai/sdk` and use `zodOutputFormat()`

The skill's recommended path (`zodOutputFormat(schema)` from `@anthropic-ai/sdk/helpers/zod`) auto-strips the unsupported keywords and is the officially-blessed approach — but this repo has **no** `@anthropic-ai/sdk` dependency anywhere; it deliberately uses raw `fetch` for the whole Anthropic path (browser bundle + the edge proxy) to stay dependency-light and avoid CORS/bundle-size issues. Pulling in the full Node SDK just for one schema-conversion helper is a heavy tradeoff for a client bundle. Decide this explicitly next session between:

- **(a)** write a small local sanitizer (recursive walk over `z.toJSONSchema()`'s output: drop `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`/`minLength`/`maxLength`, drop `maxItems`/`minItems` > 1, force `additionalProperties: false` onto every `type: "object"` node including inside `$defs`, and fold each stripped bound into a `description`), or
- **(b)** add `@anthropic-ai/sdk` (server-only, e.g. scoped to the edge function if bundling allows) and use `zodOutputFormat()` directly.

(a) matches the existing architecture; (b) is less code to maintain but a new dependency in a codebase that has specifically avoided one here before (see `functions/api/claude-proxy.ts`'s own comment about avoiding `@cloudflare/workers-types` for a single type). **(b) has a structural gap this plan missed the first time**: `services/ai/providers/anthropicProvider.ts`'s Tauri-desktop branch sends requests straight to `https://api.anthropic.com` from the client, bypassing the edge function entirely — if the SDK/converter is scoped server-only (as (b) proposes), the desktop path has no way to produce the sanitized schema at all. Choosing (b) means either bundling `@anthropic-ai/sdk` (or at least its schema converter) into the client build too, or building separate desktop/proxy conversion plumbing — not "server-only" as a clean simplification. This tips the balance further toward (a) unless someone specifically wants to solve the desktop-bundling question too.

## Plumbing (files to touch, in order)

1. `api/_shared/claudeProxyCore.ts` — add an optional `responseSchema: z.record(z.string(), z.unknown()).optional()` field to `claudeProxyRequestSchema` (bounded by the existing `MAX_BODY_BYTES` cap, no separate size limit needed); pass it through as `output_config.format` on the upstream request when present.
2. `services/ai/providers/anthropicProvider.ts` — add `responseSchema?: Record<string, unknown>` to `AIRequestOptions`; thread it into **both** `streamAnthropic` branches (the Tauri-direct desktop path at `:36-49` and the proxy path at `:53-62`). No other provider reads this field — safe no-op for OpenAI/Grok/Gemini/Ollama/OpenRouter/local.
3. `services/proForge/pipelineAgents/baseAgent.ts` — `generate()` (`:123-136`) gains an optional third `responseSchema` param, forwarded into `buildAiOpts()`. `InferenceGateway.generate()` (`services/ai/inferenceGateway.ts`) needs **no changes** — it already forwards `options: AIRequestOptions` wholesale to `generateText()`.
4. New helper, e.g. `services/proForge/pipelineOutput/anthropicJsonSchema.ts`, exporting `toAnthropicJsonSchema(schema: z.ZodType): Record<string, unknown>` implementing option (a) above if chosen, including the bound-to-description folding.
5. **Eight `generate()` invocations across the six agents** — pass the converted schema as the third arg on every initial call *and* on both diagnostic/structural retry calls: `diagnosticAgent.ts` (`diagnosticReportSchema`, initial call and the `:89` retry), `structuralAgent.ts` (`structuralEditPlanSchema`, initial call and the `:82` retry), `proseAgent.ts` (`proseEditBatchSchema`, per-section), `copyEditAgent.ts` (`copyEditPlanSchema`, per-section), `proofAgent.ts` (`qualityGateReportSchema`), `publishingAgent.ts` (`publishingPackageSchema`). Leave `selfReflect()` itself text-only — it isn't one of the six structured shapes.
6. Leave the "Return JSON with…" prose in `promptLibrary.ts` untouched — it's still load-bearing for every non-Anthropic provider (Gemini has its own native JSON path already; OpenAI/Grok/Ollama/OpenRouter/local all still need the prose instruction). Redundant-but-harmless for Claude once structured outputs are wired.

## Verification plan for next session

1. Implement the chosen sanitizer/dependency approach.
2. Write a throwaway script (`pnpm exec tsx` one-shot, not a committed file — this repo pins all
   dependency execution through pnpm, not npm's executor) that runs `toAnthropicJsonSchema()`
   against all six schemas and asserts: no `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`/`minLength`/`maxLength` keys anywhere in the output, no `maxItems`/`minItems` > 1, `additionalProperties: false` present on every object node (including inside `$defs`), and every stripped bound has a corresponding `description`. This is checkable without live API access.
3. `pnpm run typecheck` + `pnpm run lint`.
4. Add committed, focused regression coverage — this is non-trivial network-request behavior, not
   something a throwaway script and manual smoke test alone should gate: extend
   `tests/unit/aiProviderService.test.ts` and `tests/unit/api/claudeProxyCore.test.ts` (the existing
   seams for this path) to assert `output_config.format` is forwarded correctly when a schema is
   present, and omitted entirely for an ordinary request without one, on both the desktop and proxy
   branches.
5. If a real Anthropic API key is available, smoke-test one stage (e.g. `DiagnosticAgent`) end-to-end and confirm the response still parses via the existing `validateWithSchema` safety net.
