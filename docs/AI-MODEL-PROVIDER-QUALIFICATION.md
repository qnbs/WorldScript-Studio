# AI model and provider qualification

This document is the product-truth companion to the machine-readable registry in
[`services/ai/cloudModelCatalog.ts`](../services/ai/cloudModelCatalog.ts). The registry is the
runtime authority for curated cloud IDs, lifecycle, capabilities, defaults, and persisted-value
admission. This document records the evidence boundary and the current qualification state; it is
not a remote model directory and does not silently promote upstream listings into the product.

## Current public-source checkpoint

Last public-source review: **2026-09-13**.

| Provider | Curated default | Current curated scope | Preview / dynamic scope | Official source |
| --- | --- | --- | --- | --- |
| Gemini | `gemini-3.5-flash` | Gemini 3.1/3.5 text models plus the admitted image model | `gemini-3.1-pro-preview` is opt-in | [Gemini models](https://ai.google.dev/gemini-api/docs/models) |
| OpenAI | `gpt-5.6-terra` | GPT-5.6 Terra/Luna/Sol and GPT-6 Astra | New families require a separate compatibility review | [OpenAI models](https://platform.openai.com/docs/models) |
| Anthropic | `claude-sonnet-5` | Claude Sonnet 5, Opus 5, Opus 4.8, and Fable 5 | Older IDs are compatibility-only | [Claude models](https://docs.anthropic.com/en/docs/about-claude/models) |
| xAI | `grok-4.6` | Grok 4.6 and 4.5 | Grok 4.20 aliases are preview/opt-in pending qualification | [Grok models](https://docs.x.ai/docs/models) |
| OpenRouter | `google/gemma-4-31b-it:free` | Dated free-tier recovery entries only | Live `/models` discovery is runtime data and is not automatically admitted | [Public models API](https://openrouter.ai/api/v1/models) |

The choices are workload-oriented rather than “newest wins”: the defaults favor a stable,
general writing path, while reasoning, low-cost, specialized, preview, and image roles are
represented separately in the registry. Provider availability, account entitlement, pricing, and
rate limits can change after this checkpoint.

## Qualification boundary

The #704-A catalogue pass is credential-free. It proves deterministic repository contracts:

- one curated cloud authority feeds selectors, defaults, fallback validation, persistence admission,
  the inference model list, and the Claude proxy allowlist;
- legacy IDs have explicit replacement metadata rather than prefix-based admission;
- custom OpenAI-compatible and OpenRouter model values remain preservable when their configured
  endpoint/provider contract permits them;
- preview and remotely advertised models are not silently promoted to defaults;
- capability metadata records the intended adapter contract without claiming a live request passed.

The following remain **CREDENTIAL_REQUIRED / NOT_YET_REAL_PROVIDER_QUALIFIED** and belong to the
later opt-in #704 qualification wave: authenticated account entitlement, live request acceptance,
provider latency and quality, provider-specific parameter behavior, real streaming, structured
output, and image generation. No provider credential is stored in this repository or used by the
normal test/CI path.

## Maintenance contract

Upstream change detection and recurring scheduled automation are intentionally separate from this
initial catalogue slice. A future #704 maintenance wave must re-check the official source, update
the registry and this evidence checkpoint together, add an explicit migration for shutdown IDs,
and run the focused deterministic suite before changing a production default. Remote metadata must
never auto-upgrade application defaults.
