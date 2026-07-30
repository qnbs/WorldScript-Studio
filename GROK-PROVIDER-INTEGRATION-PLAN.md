# Native Grok + Claude Cloud Providers — Comprehensive Realization Plan

**File:** `GROK-PROVIDER-INTEGRATION-PLAN.md`
**Project:** [WorldScript Studio](https://github.com/qnbs/WorldScript-Studio)
**Scope:** Native xAI Grok (Cloud 4) as a first-class provider + native Anthropic Claude (Cloud 3)
via a serverless CORS proxy — both currently documented in README as working but not reachable
from the Settings UI.
**Status:** v1.24.3 (2026-07-30)
**Execution:** **Plan only — do not implement yet.** Per explicit instruction, this file is written
now and executed only after every other workstream in the current post-recovery audit sprint
(WS-3 through WS-10, including the WS-8 close-out) has merged into `main`.

---

## 0. Executive summary — verified current state (corrects the original draft's premise)

The original request assumed both Grok and Claude were simply "not yet implemented." Verification
against the actual code shows two **structurally different** problems:

| | Grok (xAI) | Claude (Anthropic) |
|---|---|---|
| `AIProvider` / `AiModel` types | Already present (`'grok'`, `'grok-3'`, `'grok-3-mini'`) | Already present (`'anthropic'`, Claude model ids) |
| README | Lists as Cloud 4 | Lists as Cloud 3 |
| Legacy provider service (`services/aiProviderService.ts`) | **Real, working implementation** — `streamGrok()` does an actual `fetch('https://api.x.ai/v1/chat/completions', ...)`, key lookup via `storageService.getApiKey('grok')`, and a real `/v1/models` connectivity test (lines 260, 314, 380, 827) | **Deliberately stubbed** — `streamAnthropic()` (line 244) unconditionally throws: *"Claude/Anthropic: Direct browser requests are blocked by Anthropic (CORS). Please use a backend proxy or switch to Gemini/OpenAI/Ollama."* Same pattern at the image-generation and connection-test call sites (lines 590, 821-824). |
| New Vercel AI SDK layer (`services/ai/providerFactory.ts`) | `providerToKind()` has no `'grok'` case — falls through to `'unsupported'`. Comment: *"anthropic/grok are reserved in the type union but not yet implemented here."* | Same — no `'anthropic'` case, falls through to `'unsupported'`. |
| Settings UI (`components/settings/AiProviderCard.tsx`) | **Not in the primary provider dropdown** (`{gemini, openai, ollama, webllm}` only, lines 174-177). Reachable only as a **hybrid-fallback-chain** option in `AiSections.tsx` (lines 149, 178) — never as a primary selection with its own API-key field. | **Not in the primary provider dropdown either.** No fallback-chain entry, no dedicated UI anywhere. |
| CSP — Tauri desktop (`src-tauri/tauri.conf.json`) | `https://api.x.ai` **already present** in `connect-src` | `https://api.anthropic.com` **absent** |
| CSP — web (`index.html`, `vercel.json`) | Already permissive: `connect-src` includes a bare `https:` scheme-source by design (ADR-0004, BYOK custom-base-URL tradeoff) — any HTTPS origin is already allowed on web builds. | Same — already permissive on web. |
| Root cause | **UI wiring gap only.** The backend already works; it's simply unreachable from the Settings UI. | **Architectural constraint, not a wiring gap.** Anthropic's API does not send CORS headers permitting direct browser `fetch()`. This app has zero backend/serverless infrastructure today (no `api/` directory, no Vercel Functions, no Cloudflare Workers) — it is a purely static SPA across all three of its deployment targets (GitHub Pages, Vercel, Cloudflare Pages) plus a Tauri desktop bundle. Claude genuinely cannot work without adding a server-side relay. |

**Decision (made 2026-07-30, by the maintainer, mid-audit-sprint):** do both in one plan/PR —
Grok gets the straightforward UI-wiring fix; Claude gets a purpose-built serverless CORS-proxy
**in addition to** the same UI wiring, since this is the app's first backend dependency and needs
its own architectural treatment, not just a UI patch.

---

## 1. Ground rules for whoever executes this plan

- **One task per step.** After each file change: `pnpm run lint:fix && pnpm run typecheck && pnpm run i18n:check && pnpm run parity:check && pnpm run docs:check`. Add `pnpm run build:edge` before considering a phase done (catches the Cloudflare/edge build path too, since the proxy touches deploy-target-specific code).
- **No new feature flag.** Both providers are regular entries in the existing provider selector, exactly like Gemini/OpenAI/Ollama — consistent with how OpenRouter (Cloud 5) is a toggle inside Settings, not a `featureFlags` entry.
- **Doc-truth in lockstep**: `TODO.md`, `AUDIT.md`, `CHANGELOG.md`, `README.md`, and a new ADR all get updated in the same PR(s) that change behavior — this audit sprint's whole premise (WS-1, WS-7, WS-10) was fixing exactly this kind of doc/code drift; don't reintroduce it here.
- **i18n in all 19 locales** for every new user-facing string.
- **Privacy-first**: BYOK stays BYOK. The Claude proxy is a **stateless relay** — it must never persist, log, or cache the user's API key or prompt/response content. This needs to be explicit in the proxy's implementation and in `docs/SECURITY-THREAT-MODEL.md`.
- **Conventional Commits**, QNBS-v3 single-line comments, no `biome-ignore` suppressions added.

---

## 2. Phase 0 — Analysis & ADR (already substantially done by this plan; formalize on execution)

1. Re-verify this plan's findings against the code state *at execution time* (this audit sprint's
   own governing methodology: "treat a snapshot as a hypothesis, not truth" — several PRs will have
   merged between now and execution).
2. New ADR: **`docs/adr/0016-native-grok-and-claude-providers.md`** (0016 is the next free number
   after 0015). Must document:
   - Why Grok is a pure UI fix and Claude is not (the CORS/no-backend distinction above).
   - The proxy's trust model: it relays a user's own BYOK key server-side for the duration of one
     request only; it does not become a WorldScript-managed credential store.
   - Which deployment targets can actually serve the proxy (see Phase 2).
3. Take `services/ai/providers/openrouterProvider.ts` as the reference pattern for a dedicated
   provider file if Phase 1 decides Grok needs one (see Option A vs B below) — it already has the
   circuit-breaker / retry / model-catalog conventions this repo expects from a "real" provider
   module, not just an inline `case` in `aiProviderService.ts`.

---

## 3. Phase 1 — Grok: native provider wiring (backend already works)

**Goal:** make Grok selectable as a primary provider with its own API-key field, exactly like
Gemini/OpenAI.

1. **`components/settings/AiProviderCard.tsx`**: add `{ id: 'grok', label: 'xAI Grok' }` to the
   primary options array (currently `gemini | openai | ollama | webllm`, lines 174-177). Add a
   `provider === 'grok'` UI block mirroring the existing `provider === 'openai'` block (lines
   257+): API-key input (`storageService.saveApiKey('grok', ...)` / `clearApiKey('grok')` — the
   key-storage plumbing already exists since `aiProviderService.ts` already calls
   `getApiKey('grok')`), a model selector (`grok-3` / `grok-3-mini`, matching the existing
   `AiModel` union in `types.ts`), and a **Test Connection** button wired to the real `/v1/models`
   check already implemented at `aiProviderService.ts:827-837`.
2. **`services/ai/providerFactory.ts`**: add a `case 'grok': return 'openaiCompatible';` to
   `providerToKind()` (xAI's API is OpenAI-compatible — `POST /v1/chat/completions`, same shape),
   with `baseURL: 'https://api.x.ai/v1'`. This brings Grok into parity with the newer
   `useWorldScriptAI` Writer-streaming path, not just the legacy thunks. Confirm whether this needs
   a small `worldScriptCompletionFetch.ts` change to resolve the Grok API key into that call — trace
   the existing `'openai'` case there as the template.
3. **`services/ai/aiPolicy.ts`**: confirm `assertCloudAiAllowed('grok')` behaves like other cloud
   providers (privacy gate, not a provider-specific allow/deny) — likely already correct since the
   gate is provider-agnostic, but verify at execution time.
4. **CSP**: `https://api.x.ai` is already present in `src-tauri/tauri.conf.json`; web builds are
   already covered by the `https:` blanket (ADR-0004). **No CSP change needed for Grok** — verify
   this is still true at execution time before skipping it.
5. **i18n**: add `settings.ai.provider.grok` (label, if not just reusing the existing `'xAI Grok'`
   literal — check whether the other provider labels are already i18n keys or hardcoded strings
   before deciding), model descriptions, and any new test-connection error strings, across all 19
   locales (`node scripts/check-i18n-keys.mjs --fix` then manual translation per
   `docs/LANGUAGE-EXPANSION-2026.md`'s workflow for the 14 non-production locales).
6. **Fallback chain**: `AiSections.tsx`'s hybrid-fallback-chain selector already lists `'grok'` —
   no change needed there, but re-verify it still makes sense once Grok is also a primary option
   (a provider shouldn't be selectable as its own fallback; check the existing `.filter((p) => p
   !== settings.advancedAi.provider)` guard already handles this generically).

**Grok Definition of Done:**
- [ ] Grok selectable as primary provider in Settings → AI Provider, with API key + model selector + working Test Connection
- [ ] Works in Hybrid and Cloud AI Execution Modes
- [ ] Works in the new Writer-streaming path (`useWorldScriptAI`), not just legacy thunks
- [ ] i18n: all 19 locales pass `pnpm run i18n:check`
- [ ] No new feature flag; `pnpm run parity:check` still reports 0 drifts
- [ ] Unit tests: `providerFactory` grok case, key-handling, connection-test mock
- [ ] README/CHANGELOG/ADR updated; TODO.md's Grok-related notes (if any) reconciled

---

## 4. Phase 2 — Claude: serverless CORS proxy (new architecture)

This is the substantial new piece. **Read this whole phase before starting** — the deployment-target
constraint below affects the entire design.

### 4.1 The deployment-target problem

WorldScript Studio ships to **four** targets, and a serverless function is not equally available
on all of them:

| Target | Can host a serverless function? | Consequence for Claude |
|---|---|---|
| **Vercel** (primary) | Yes — Vercel Functions (`api/*.ts`) | Claude works when the app is served from Vercel |
| **Cloudflare Pages** | Yes — Cloudflare Pages Functions (`functions/*.ts`) | Claude works when served from Cloudflare, but needs a **second, separately-written** function (different runtime/handler shape from Vercel's) |
| **GitHub Pages** | **No** — pure static hosting, no server-side execution at all | Claude **cannot** work on the GitHub Pages mirror, ever, without pointing at an externally-hosted proxy |
| **Tauri desktop** | No — static bundled app, no local server | Claude on desktop would have to call out to a **hosted** proxy (e.g., the maintainer's own Vercel deployment) — a materially different trust/privacy story than "your key never leaves your device except to the provider you configure," since now a request also transits the maintainer's infrastructure |

**This is the crux of the decision the maintainer needs to be aware of at execution time, restated
clearly in this plan rather than glossed over:** enabling Claude means either (a) accepting that it
silently doesn't work on 2 of 4 targets (GitHub Pages, desktop) unless those builds are configured
to point at a hosted proxy URL, with clear UI messaging about that, or (b) writing and maintaining
proxy functions for both Vercel *and* Cloudflare Pages, and deciding whether desktop/GitHub-Pages
builds get a hardcoded fallback proxy URL (introducing a real dependency on a specific external
host that isn't "your own deployment" for those users) or simply show Claude as unavailable there.

**Recommended default for this plan:** implement the Vercel Function (primary target) first;
Cloudflare Pages Function as a fast-follow using the same relay logic; GitHub Pages and Tauri
desktop show Claude as **unavailable** with a clear, honest message (reusing the existing
`settings.ai.providerStatusUnavailableBrowser` i18n key's *pattern* — a new, more specific key —
rather than silently failing or defaulting to a hosted proxy the user didn't choose). Revisit
hardcoding a fallback proxy URL only if the maintainer explicitly wants GitHub-Pages/desktop users
to have Claude too, understanding the trust-model change that implies.

### 4.2 Proxy design

- **New file:** `api/claude-proxy.ts` (Vercel Function, Node.js runtime — check whether Vercel's
  Edge Runtime or Node runtime is the better fit; Edge is lighter but has stricter API surface).
- **Contract:** the proxy receives `{ apiKey, model, messages, ...anthropicRequestBody }` from the
  client over `POST /api/claude-proxy` (same-origin — already covered by CSP `connect-src 'self'`,
  no CSP change needed for the client→proxy leg), forwards it to
  `https://api.anthropic.com/v1/messages` with `x-api-key: <apiKey>` and `anthropic-version` header,
  and streams the response back unmodified.
- **Statelessness — the core privacy guarantee:** the function must not write the API key, prompt,
  or response to any log, database, or cache. No `console.log` of the request body (this repo's own
  `services/logger.ts` convention — GDPR sanitization — should extend to this function; if
  `StructuredLogger` isn't usable inside a Vercel Function runtime, document why and use the
  platform's own request logging with the same "never log secrets" discipline).
- **Rate-limiting / abuse consideration:** since this proxy relays to an API that costs the *user's*
  API key, per-user cost isn't WorldScript's problem the way it would be for a shared-key gateway —
  but the proxy endpoint itself is public and unauthenticated (anyone could POST to it with any
  Anthropic key). Decide whether that's acceptable (it's the same trust model as the user's own
  browser calling Anthropic directly, just relayed) or whether a lightweight abuse guard (e.g.,
  origin-checking against WorldScript's own deployed origin) is warranted.
- **CSP update needed:** the client still only talks to `'self'` (the proxy), so no client-side CSP
  change — but the **proxy's own outbound call** to `api.anthropic.com` is server-side and not
  subject to browser CSP at all. Document this clearly in the ADR so a future audit doesn't go
  looking for a client-side `api.anthropic.com` CSP entry that was never needed.
- **Cloudflare Pages Function equivalent:** `functions/claude-proxy.ts` (Cloudflare's file-based
  routing convention differs from Vercel's `api/` — check Cloudflare Pages Functions docs for the
  exact handler signature at execution time, since this plan predates writing the code).

### 4.3 UI wiring (same pattern as Grok, once the proxy exists)

1. `components/settings/AiProviderCard.tsx`: add `{ id: 'claude', label: 'Anthropic Claude' }`,
   with the same API-key + model-selector + test-connection pattern as Grok — but the "backend" the
   Test Connection button calls is now the proxy endpoint, not a direct Anthropic call.
2. **Availability detection:** on GitHub Pages / Tauri desktop builds (however that's detected at
   runtime — check `services/tauriRuntime.ts` and any existing hostname-based deploy-target
   detection), show Claude as disabled/unavailable per §4.1's recommended default, with a
   `settings.ai.providerStatusUnavailableProxy`-style i18n string explaining why (not just a generic
   "unavailable in browser" reuse — this is a different reason than the existing key's original
   use case, so a new, precise key is more honest).
3. `services/aiProviderService.ts`: replace `streamAnthropic()`'s unconditional throw with a real
   implementation that calls the proxy endpoint (`fetch('/api/claude-proxy', ...)`) instead of
   `https://api.anthropic.com` directly. Same for the image-generation and connection-test call
   sites (lines 590, 821-824) — decide whether Claude image generation is in scope at all (Anthropic
   may not offer an image-gen endpoint; verify before wiring UI for something that doesn't exist).
4. `services/ai/providerFactory.ts`: add an `'anthropic'` case if the new Vercel-AI-SDK layer should
   also support Claude — likely wants its own `'anthropicProxy'` kind rather than reusing
   `'openaiCompatible'`, since the request/response shape differs from OpenAI's.

### 4.4 Security & privacy documentation (mandatory, not optional)

- `docs/SECURITY-THREAT-MODEL.md`: add a new row/section for the Claude proxy — it is the **first**
  place in this app's architecture where a BYOK key transits infrastructure the user doesn't
  control end-to-end (their browser → WorldScript's Vercel deployment → Anthropic). Every other
  provider is a direct browser→provider call. This is a genuine, user-relevant trust-model change
  and must be stated plainly, not buried.
- `README.md`'s "Encryption — which mechanism protects what" table and its privacy-first framing
  ("Cloud AI features send only the prompts and context you trigger to the provider you configure")
  need a caveat specifically for Claude: *the request transits WorldScript's own proxy en route to
  Anthropic, unlike every other cloud provider.*
- Settings UI: the Claude API-key input should carry a brief, honest inline note about this
  distinction — not hidden in docs only.

### 4.5 Testing

- Unit tests for the proxy handler logic (request forwarding, no logging of secrets) — likely needs
  a lightweight Vercel Function test harness or at minimum a pure-function extraction of the relay
  logic that's testable without the platform runtime.
- Unit tests for `streamAnthropic()`'s new proxy-calling implementation, mocking the `/api/claude-proxy`
  fetch.
- E2E: a new `tests/e2e/claude-provider.spec.ts` (or folded into existing AI-provider specs) —
  mock the proxy endpoint, verify the Settings UI flow end-to-end. Cannot realistically hit the
  real Anthropic API in CI (costs money, needs a real key) — mock-only, consistent with how other
  cloud-provider E2E specs in this repo already avoid real API calls.
- Manual smoke test matrix: Vercel (real proxy, real Anthropic key) — Cloudflare Pages (real proxy)
  — GitHub Pages (confirm Claude shows unavailable, doesn't silently break) — Tauri desktop (same).

**Claude Definition of Done:**
- [ ] Vercel Function proxy deployed and relaying requests statelessly (no key/prompt logging)
- [ ] Cloudflare Pages Function equivalent (or explicit decision to defer, documented in the ADR)
- [ ] Claude selectable as primary provider in Settings → AI Provider on proxy-capable deployments
- [ ] GitHub Pages and Tauri desktop show an honest "unavailable" state, not a silent failure
- [ ] `docs/SECURITY-THREAT-MODEL.md` and README's privacy framing updated with the proxy caveat
- [ ] i18n: all 19 locales
- [ ] No new feature flag
- [ ] Unit + E2E tests (mocked, no real Anthropic calls in CI)
- [ ] New ADR 0016 covers both Grok and Claude decisions
- [ ] README/CHANGELOG updated; TODO.md/AUDIT.md reconciled

---

## 5. Phase 3 — Combined polish & release

1. Cross-check both providers against `docs/adr/0004-csp-connect-src-byok-tradeoff.md` — confirm
   neither introduces a CSP regression (Grok: none needed; Claude: only same-origin, as above).
2. Update `docs/FEATURE-PARITY.md` / `pnpm run parity:check` baseline if either provider is tracked
   there (verify at execution time — providers aren't feature flags, so this may be a no-op).
3. Settings Guide / Help article update (`services/help/helpCatalog.ts`) describing both new
   provider options and, for Claude, the deployment-target caveat.
4. Version bump: given this adds real new capability (not just a doc/hardening fix, per this
   sprint's own established minor-vs-patch precedent — see AUDIT.md's historical bump reasoning),
   this likely warrants a **minor** bump (e.g., v1.25.0) rather than a patch. Confirm with the
   maintainer before tagging — version/tag/release actions are maintainer-only per this repo's
   standing governance rule, same as every other workstream in this sprint.

---

## 6. Explicit non-goals (for this plan)

- No feature-flag gating for either provider (explicit maintainer instruction).
- No attempt to make Claude work identically across all four deployment targets without a hosted
  proxy fallback decision — that tradeoff is surfaced for the maintainer to decide at execution
  time (§4.1), not silently resolved one way.
- No change to OpenRouter (Cloud 5) — it already has its own working gateway/flag pattern and is
  out of scope here.
- No new backend beyond the single-purpose Claude relay — this plan does not propose a general
  backend-for-frontend layer for the rest of the app.

---

## 7. Sequencing

**Updated 2026-07-30 (maintainer re-prioritization, supersedes the original deferral below):**
execute this plan **immediately after PR #297 (WS-3 + WS-6) merges into `main`** — once its
CodeRabbit correction loop is quiescent and CI is fully green — **before** WS-4, WS-5, WS-9, and
the WS-8 close-out. This plan's Phase 0 re-verification step (§2.1) still applies: re-check this
document's findings against `main` at that point, since PR #297's merge changes the baseline.

WS-4/WS-5/WS-9 and the WS-8 close-out resume after Grok+Claude lands, in their previously-planned
order. WS-8 still runs last regardless, since its whole purpose is auditing the final merged state
— including whatever this plan produces.

<details>
<summary>Original deferral language (superseded above, kept for history)</summary>

Per explicit instruction: do not execute any part of this plan until every other workstream in the
current post-recovery audit sprint has merged — WS-3/WS-6 (in progress), WS-4/WS-5/WS-9 (planned
next), and WS-8's close-out re-audit (must run last, against the final merged main). This plan
itself introduces the app's first backend dependency, which is exactly the kind of architectural
change that should land on a clean, fully-reconciled main, not mid-sprint.

</details>
