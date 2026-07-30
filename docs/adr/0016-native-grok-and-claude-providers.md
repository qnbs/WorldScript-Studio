# ADR 0016 — Native Grok provider + split Claude fix (desktop native-HTTP, web serverless proxy)

- **Status:** Accepted
- **Date:** 2026-07-30
- **Deciders:** Maintainer + Claude Code
- **Context tags:** ai, grok, anthropic, claude, cors, tauri, proxy, backend
- **Related:** [`GROK-PROVIDER-INTEGRATION-PLAN.md`](../../GROK-PROVIDER-INTEGRATION-PLAN.md) (execution plan this ADR formalizes) · extends [ADR 0012](0012-local-server-connectivity-tauri-http.md) · see also [ADR 0004](0004-csp-connect-src-byok-tradeoff.md)

## Context

README documents Grok (xAI, "Cloud 4") and Claude (Anthropic, "Cloud 3") as working cloud AI
providers. Neither was actually selectable as a primary provider with its own API key in
`components/settings/AiProviderCard.tsx`'s main flow, prompting an investigation into why.

Verification found **two structurally different problems**, not one:

- **Grok**: `services/aiProviderService.ts`'s `streamGrok()` already has a real, working
  implementation — a genuine `fetch('https://api.x.ai/v1/chat/completions', ...)`, BYOK key
  storage, and a working `/v1/models` connection test. It simply was never added to
  `AiProviderCard.tsx`'s primary provider dropdown (only reachable as a hybrid-fallback-chain
  option) or to the newer Vercel-AI-SDK layer (`services/ai/providerFactory.ts`'s
  `providerToKind()`). **Pure UI/wiring gap.**
- **Claude**: `streamAnthropic()` unconditionally throws — *"Direct browser requests are blocked by
  Anthropic (CORS). Please use a backend proxy or switch to Gemini/OpenAI/Ollama."* — on **every**
  platform, including desktop, without ever checking which platform it's running on. A first
  investigation pass concluded this needed a serverless proxy everywhere. **A second, more careful
  pass corrected that**: `AiProviderCard.tsx` already has an `'anthropic'` entry in its primary
  dropdown with a dedicated warning block, whose own shipped i18n copy already says *"...or use the
  Tauri desktop app for Anthropic calls"* — a promise the code doesn't keep. CORS is a **browser**
  security mechanism. It does not apply to Tauri's native HTTP plugin
  (`@tauri-apps/plugin-http`), which `services/localServerHttp.ts` already uses to bypass exactly
  this class of restriction for Ollama/LM Studio/vLLM (ADR-0012). `streamAnthropic()` never
  attempts that escape hatch before throwing.

## Decision

### Grok — native UI wiring (no new architecture)

Add Grok to `AiProviderCard.tsx`'s primary provider dropdown with its own API-key field and model
selector, wired to the existing, already-functional `streamGrok()` backend. Add a `case 'grok'` to
`providerFactory.ts`'s `providerToKind()` (xAI's API is OpenAI-compatible) so the newer
Vercel-AI-SDK Writer-streaming path gets Grok too, not just legacy thunks. No new feature flag —
Grok becomes a regular provider option exactly like Gemini/OpenAI. No CSP change needed:
`https://api.x.ai` is already present in `src-tauri/tauri.conf.json`, and the web CSP's `https:`
scheme-source (ADR-0004) already covers it.

### Claude — two independent tracks, not one

**Track A (desktop, ships first, no new infrastructure):** fix `streamAnthropic()` to branch on
`isTauriRuntime()` before throwing. On desktop, call `https://api.anthropic.com` directly via the
same native-HTTP pattern ADR-0012 established for local servers — native networking is not subject
to browser CORS at all. Add `https://api.anthropic.com` to the Tauri CSP's `connect-src` (mirrors
the existing Grok entry). Desktop Settings UI swaps the warning-only block for a real API-key/model
flow. This is a narrow bug fix, not new architecture, and ships independently of Track B.

**Track B (web/PWA, ships second, the actual new architecture):** browser `fetch()` has no
native-HTTP escape hatch — Anthropic's API sends no CORS headers permitting direct browser access,
so the only way to make Claude work in a browser tab is a server-side relay. This is the app's
**first backend dependency** ever (previously a purely static SPA across GitHub Pages, Vercel, and
Cloudflare Pages, plus a Tauri desktop bundle with no local server of its own). A Vercel Function
(`api/claude-proxy.ts`) relays `{ apiKey, model, messages }` to `https://api.anthropic.com/v1/messages`
statelessly — it must never log, persist, or cache the API key or message content. A Cloudflare
Pages Function equivalent follows for that deploy target. **GitHub Pages cannot host a serverless
function at all** (pure static hosting) — Claude shows an honest "unavailable on this deployment"
state there rather than silently failing or defaulting to a hosted proxy the user didn't choose.

The proxy is public and unauthenticated by construction (it relays whatever API key the caller
supplies) — this makes it an externally-reachable resource-exhaustion surface (CWE-400) if shipped
without controls. Schema validation, a request body size limit, an origin check, rate limiting, and
timeouts on both legs (inbound and the outbound call to Anthropic) are **mandatory**, not optional
hardening to consider later.

### Trust-model consequence (Track B only)

Every other cloud provider in this app is a direct browser→provider call — the user's API key
never transits infrastructure WorldScript controls. Track B's proxy is the **first exception**: a
Claude request on the web now flows browser → WorldScript's Vercel/Cloudflare deployment →
Anthropic. The proxy is stateless (nothing is persisted or logged), but the key still passes
through code the maintainer runs, for the duration of that one request. This is documented
explicitly in `docs/SECURITY-THREAT-MODEL.md` and in README's privacy framing — it is not hidden
behind "just like BYOK for other providers," because it isn't quite the same guarantee.

### Ollama-in-PWA (adjacent follow-up, Issue #266, not part of this decision's core scope)

A related but separate question came up during this work: could the same proxy pattern let the PWA
reach the user's own local Ollama server? **No** — a hosted proxy can only reach itself, never a
user's private `localhost`, so this is not a variant of Track B. The actual answer (already
described by the maintainer in Issue #266's own comment thread) is an opt-in feature flag using
direct browser `fetch()`, matching NovelCrafter's real (non-magic) model: it works only when the
user configures their own Ollama server's `OLLAMA_ORIGINS` to the exact PWA origin. This narrowly
widens ADR-0012's "PWA stays desktop-only" decision for users who explicitly opt in and accept the
setup burden — it does not reverse that decision as the default. See the plan document's addendum
for the full design.

## Consequences

- **Positive:** Grok becomes fully usable with zero new infrastructure. Claude becomes usable on
  desktop immediately (Track A) with a small, low-risk fix reusing an established pattern, and on
  the web (Track B) once the proxy ships — closing a real gap between README's claims and actual
  behavior for both providers.
- **Negative (accepted):** Track B introduces this app's first backend dependency, a genuine
  architectural shift from "purely static SPA" — deliberately scoped as narrowly as possible (one
  relay endpoint, no general backend-for-frontend layer) and documented as a trust-model change,
  not glossed over.
- **Deliberately deferred:** a hardcoded fallback proxy URL for GitHub Pages (so that deployment
  could have Claude too, at the cost of routing every such request through a fixed external host
  the user didn't choose) is not part of this decision — it's called out in the plan as a choice
  for the maintainer to make explicitly later, not a default.
- **Resolved during Track B implementation:** Claude's image-generation call site (`generateImage()`'s
  `case 'anthropic':` in `services/aiProviderService.ts`) is left throwing, on every platform —
  Anthropic's API has no image-generation endpoint at all, so this was never a CORS/proxy bug to fix.
- **Resolved during Track B implementation:** no dedicated E2E spec was added for the Claude Settings
  flow. Neither Grok (Phase 1) nor any other cloud provider (Gemini/OpenAI/Ollama/OpenRouter) has
  one in this repo — that class of Settings-form interaction is covered at the component/RTL level
  only, and the desktop/proxy-web/GitHub-Pages branching added here follows the same pattern
  (`tests/unit/settings/AiProviderCard.test.tsx`, `tests/unit/aiProviderService.test.ts`,
  `tests/unit/api/claudeProxyCore.test.ts`). Introducing a first-of-its-kind provider E2E spec —
  with no established mocking pattern for `/api/claude-proxy` or base-path simulation — would be new
  test infrastructure beyond what this fix requires, not a gap relative to actual repo convention.
- **Resolved during Track B implementation:** `services/ai/providerFactory.ts`'s `providerToKind()`
  deliberately keeps returning `'unsupported'` for `'anthropic'` — wiring the newer Vercel-AI-SDK
  Writer-streaming layer would need the `@ai-sdk/anthropic` package (Anthropic's Messages API isn't
  OpenAI-Chat-Completions-shaped, unlike Grok/Ollama, which both work through `createOpenAI`), a new
  runtime dependency out of scope for this plan. Both tracks instead wire the actual live call path,
  `aiProviderService.ts` — the same one every existing Settings UI flow (Test Connection, ProForge,
  Writer thunks) already goes through.

## References

- [`GROK-PROVIDER-INTEGRATION-PLAN.md`](../../GROK-PROVIDER-INTEGRATION-PLAN.md) — full phased execution plan
- [[0012-local-server-connectivity-tauri-http]] — the native-HTTP pattern Track A reuses
- [[0004-csp-connect-src-byok-tradeoff]] — why the web CSP's `https:` scheme-source already covers Grok
- [Issue #266](https://github.com/qnbs/WorldScript-Studio/issues/266) — origin of both the ADR-0012 pattern and the Ollama-in-PWA follow-up
