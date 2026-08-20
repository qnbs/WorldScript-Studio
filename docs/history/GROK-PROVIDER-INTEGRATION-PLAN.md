# Native Grok + Claude Cloud Providers — Comprehensive Realization Plan

**File:** `GROK-PROVIDER-INTEGRATION-PLAN.md`
**Project:** [WorldScript Studio](https://github.com/qnbs/WorldScript-Studio)
**Scope:** Native xAI Grok (Cloud 4) as a first-class provider + native Anthropic Claude (Cloud 3)
via a serverless CORS proxy — both currently documented in README as working but not reachable
from the Settings UI. **Addendum (§7):** an unrelated but adjacent follow-up to Issue #266 — an
opt-in, experimental feature flag letting the PWA attempt direct browser-to-Ollama connections,
matching the "technically: yes" option the maintainer already described in that issue's comment
thread.
**Status:** ✅ Complete — merged 2026-07-30, see `[Unreleased]`/`[1.25.0]` in
[CHANGELOG.md](../../CHANGELOG.md) for the user-facing summary.
**Execution:** All phases below (Grok wiring, Claude desktop + web proxy, Ollama-in-PWA opt-in
addendum) have shipped. This file is retained as the historical design record; do not treat any
"do not implement yet" language below as current.

---

## 0. Executive summary — verified current state (corrects the original draft's premise, twice)

The original request assumed both Grok and Claude were simply "not yet implemented." A first
verification pass (below, still accurate for Grok) found Claude's backend deliberately stubbed for
a real reason (CORS) rather than just unwired. **A second, more careful pass — re-checking
`AiProviderCard.tsx` for the literal string `anthropic`, not `claude` (a search-term mistake in the
first pass) — found the picture is more nuanced still:**

| | Grok (xAI) | Claude (Anthropic) |
|---|---|---|
| `AIProvider` / `AiModel` types | Already present (`'grok'`, `'grok-3'`, `'grok-3-mini'`) | Already present (`'anthropic'`, Claude model ids) |
| README | Lists as Cloud 4 | Lists as Cloud 3 |
| Legacy provider service (`services/aiProviderService.ts`) | **Real, working implementation** — `streamGrok()` does an actual `fetch('https://api.x.ai/v1/chat/completions', ...)`, key lookup via `storageService.getApiKey('grok')`, and a real `/v1/models` connectivity test (lines 260, 314, 380, 827) | `streamAnthropic()` (line 244) **unconditionally throws on every platform, including desktop**: *"Claude/Anthropic: Direct browser requests are blocked by Anthropic (CORS). Please use a backend proxy or switch to Gemini/OpenAI/Ollama."* Same pattern at the image-generation and connection-test call sites (lines 590, 821-824). **This is the actual bug** — CORS is a *browser* security mechanism; it does not apply to Tauri's native HTTP plugin (`@tauri-apps/plugin-http`, `services/localServerHttp.ts`, ADR-0012), which already exists in this codebase for exactly this class of problem (local server discovery). `streamAnthropic()` never even tries the native path — it throws before checking `isTauriRuntime()` at all. |
| New Vercel AI SDK layer (`services/ai/providerFactory.ts`) | `providerToKind()` has no `'grok'` case — falls through to `'unsupported'`. Comment: *"anthropic/grok are reserved in the type union but not yet implemented here."* | Same — no `'anthropic'` case, falls through to `'unsupported'`. |
| Settings UI (`components/settings/AiProviderCard.tsx`) | **Not in the primary provider dropdown** (`{gemini, openai, ollama, webllm, onnx, transformers}`, lines 174-179). Reachable only as a **hybrid-fallback-chain** option in `AiSections.tsx` (lines 149, 178) — never as a primary selection with its own API-key field. | **Already in the primary provider dropdown** (`{ id: 'anthropic', label: 'Anthropic Claude' }`, line 180) — this part is *not* missing. Selecting it renders a dedicated warning block (line 587) with existing, already-shipped i18n strings (`settings.ai.corsRestriction`, `settings.ai.anthropicCorsNote` — the latter's copy *already says* "...or use the Tauri desktop app for Anthropic calls", a promise the code doesn't yet keep). There is no API-key input for it today — the block is warning-only. |
| CSP — Tauri desktop (`src-tauri/tauri.conf.json`) | `https://api.x.ai` **already present** in `connect-src` | `https://api.anthropic.com` **absent** — needed once desktop calls it directly |
| CSP — web (`index.html`, `vercel.json`) | Already permissive: `connect-src` includes a bare `https:` scheme-source by design (ADR-0004, BYOK custom-base-URL tradeoff) — any HTTPS origin is already allowed on web builds. | Same — already permissive on web (irrelevant either way, since the proxy call from the browser is same-origin). |
| Root cause | **UI wiring gap only.** The backend already works; it's simply unreachable from the Settings UI. | **Two separate gaps, one per platform.** Desktop: `streamAnthropic()` never attempts the native-HTTP escape hatch that ADR-0012 already built for exactly this CORS class of problem — a **narrow bug fix**, not new architecture. Web/PWA: browser `fetch()` has no such escape hatch; Anthropic's API sends no CORS headers permitting it, so the **only** way to make Claude work in a browser tab is a server-side relay — this app's first backend dependency. |

**Decision (made 2026-07-30, by the maintainer, mid-audit-sprint):** do both providers in one
plan/PR. Grok gets the straightforward UI-wiring fix. Claude gets **two independent tracks**: a
small native-HTTP fix for desktop (reusing ADR-0012's established pattern — ships first, no new
infrastructure) and a purpose-built serverless CORS-proxy for web/PWA (the actual new architecture,
ships second, larger and riskier). Treating these as one lump "Claude proxy" task — as the first
draft of this plan did — would have meant the *easier, already-half-promised* desktop fix waited
behind the *harder* web fix for no real reason.

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

1. **`components/settings/AiProviderCard.tsx`**: add `{ id: 'grok', label: t('settings.ai.provider.grok') }` (translation key, never a hardcoded literal — see item 5 below) to the
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
5. **i18n — mandatory, no hardcoded literals**: this repo's own convention requires every
   user-facing string to go through `t('key.path')` — no exceptions for a "just a label" string.
   Add `settings.ai.provider.grok` (label), model descriptions, and any new test-connection
   error strings, all via real translation keys — never a hardcoded `'xAI Grok'` literal anywhere
   in the UI. Same requirement applies to Claude in Phase 2 (label, model descriptions,
   connection-status and error text). Add all new keys across all 19 locales
   (`node scripts/check-i18n-keys.mjs --fix` then manual translation per
   `docs/LANGUAGE-EXPANSION-2026.md`'s workflow for the 14 non-production locales,
   `pnpm run i18n:check` must pass). This is part of both providers' Definition of Done below,
   not an optional nicety.
6. **Fallback chain**: `AiSections.tsx`'s hybrid-fallback-chain selector already lists `'grok'` —
   no change needed there, but re-verify it still makes sense once Grok is also a primary option
   (a provider shouldn't be selectable as its own fallback; check the existing `.filter((p) => p
   !== settings.advancedAi.provider)` guard already handles this generically).

**Grok Definition of Done:**
- [ ] Grok selectable as primary provider in Settings → AI Provider, with API key + model selector + working Test Connection
- [ ] Works in Hybrid and Cloud AI Execution Modes
- [ ] Works in the new Writer-streaming path (`useWorldScriptAI`), not just legacy thunks
- [ ] i18n: all provider/model/status strings use translation keys (no hardcoded literals); all 19 locales pass `pnpm run i18n:check`
- [ ] No new feature flag; `pnpm run parity:check` still reports 0 drifts
- [ ] Unit tests: `providerFactory` grok case, key-handling, connection-test mock
- [ ] README/CHANGELOG/ADR updated; TODO.md's Grok-related notes (if any) reconciled

---

## 4. Phase 2 — Claude: two independent tracks, desktop first

Claude splits cleanly into two tracks with very different sizes, because CORS is a **browser**
security mechanism — it does not apply to Tauri's native HTTP plugin at all. **Ship Track A first**:
it is a narrow bug fix reusing infrastructure that already exists (ADR-0012), not new architecture,
and it fulfills a promise the shipped UI copy already makes (`settings.ai.anthropicCorsNote`: *"...or
use the Tauri desktop app for Anthropic calls"*). Track B (the actual new architecture) follows.

### 4.0 Track A — Desktop: native-HTTP fix (small, ships first, no new infrastructure)

1. **`services/aiProviderService.ts`**: `streamAnthropic()` (and the image-generation / connection-test
   call sites at lines 590, 821-824) currently throw unconditionally, before ever checking the
   runtime. Branch on `isTauriRuntime()` (`services/tauriRuntime.ts`) first:
   - **Desktop**: call `https://api.anthropic.com/v1/messages` directly via a Tauri-native fetch —
     the same `@tauri-apps/plugin-http` escape hatch `services/localServerHttp.ts` already uses for
     Ollama/LM Studio/vLLM (ADR-0012). That module is scoped and named for *local* servers
     specifically (`LocalServerError`, `DEFAULT_OLLAMA_BASE_URL`); reusing it as-is for a cloud
     endpoint would be a naming/scope mismatch. Extract the ~10-line `isTauriRuntime() ? dynamic
     plugin-http import : global fetch` resolution into a small shared helper (or duplicate it
     narrowly here with a comment pointing at `localServerHttp.ts` as the sibling pattern) — decide
     which at execution time based on how it reads in context; either is defensible, over-abstracting
     two call sites into a shared module is not required.
   - **Web/browser** (including the Tauri WebView's own dev-mode web preview, if distinct from the
     packaged app — verify `isTauriRuntime()`'s detection covers exactly the packaged case): still
     throws, now pointing at Track B once it ships (or the existing message if Track B isn't done
     yet — sequence the throw message's wording to whichever is true at the time this ships).
2. **CSP**: add `https://api.anthropic.com` to `src-tauri/tauri.conf.json`'s `connect-src` (mirrors
   the existing `https://api.x.ai` entry for Grok). No web CSP change needed (native fetch isn't
   subject to it; irrelevant for the desktop-only path anyway).
3. **UI**: on desktop, `AiProviderCard.tsx`'s existing `provider === 'anthropic'` warning block
   (line 587) becomes conditional on `!isTauriRuntime()` — desktop instead renders the same
   API-key + model-selector + Test Connection pattern as every other cloud provider, calling straight
   through to the now-fixed `streamAnthropic()`. Web/PWA keeps the existing warning block (updated
   per Track B's actual shipped state — see §4.2 below).
4. **i18n**: no *new* strings needed for the desktop UI block itself — reuse the API-key/model-selector
   copy already shared with Gemini/OpenAI/Grok. The existing `anthropicCorsNote` string's wording may
   need a small revision once desktop actually works (it currently frames desktop as a suggestion,
   not a fact) — treat this as a content update, not a new key, across all 19 locales.
5. **Tests**: unit tests for `streamAnthropic()`'s new `isTauriRuntime()` branch (both sides mocked),
   and for the UI's desktop-vs-web conditional rendering.

**Track A Definition of Done:**
- [ ] `streamAnthropic()` (+ connection-test) branches on `isTauriRuntime()`; desktop calls Anthropic natively, no CORS error
- [ ] `src-tauri/tauri.conf.json` CSP includes `https://api.anthropic.com`
- [ ] Desktop Settings UI shows a real API-key/model-selector flow for Claude instead of the warning block
- [ ] Web/PWA UI unchanged by this track (still shows the warning, pointing at Track B once it exists)
- [ ] i18n: any copy changes across all 19 locales; no hardcoded literals
- [ ] Unit tests for both runtime branches
- [ ] This is explicitly **not** gated behind Track B — it can ship and be useful on its own even if Track B is deferred

### 4.1 Track B — Web/PWA: serverless CORS proxy (the actual new architecture)

This is the substantial new piece, and the only one that needs a backend. **Read this whole
section before starting** — the deployment-target constraint below affects the entire design, and
it is now **narrower than the first draft assumed**: Track A already covers desktop, so this track
only needs to reach browser tabs (Vercel, Cloudflare Pages, GitHub Pages).

#### 4.1.1 The deployment-target problem

A serverless function is not equally available across WorldScript Studio's three *web* deploy
targets:

| Target | Can host a serverless function? | Consequence for Claude |
|---|---|---|
| **Vercel** (primary) | Yes — Vercel Functions (`api/*.ts`) | Claude works when the app is served from Vercel |
| **Cloudflare Pages** | Yes — Cloudflare Pages Functions (`functions/*.ts`) | Claude works when served from Cloudflare, but needs a **second, separately-written** function (different runtime/handler shape from Vercel's) |
| **GitHub Pages** | **No** — pure static hosting, no server-side execution at all | Claude **cannot** work on the GitHub Pages mirror, ever, without pointing at an externally-hosted proxy |

**This is the crux of the decision the maintainer needs to be aware of at execution time, restated
clearly in this plan rather than glossed over:** enabling Claude on the web means either (a)
accepting that it silently doesn't work on GitHub Pages unless that build is configured to point at
a hosted proxy URL, with clear UI messaging about that, or (b) hardcoding a fallback proxy URL for
the GitHub Pages build specifically (introducing a real dependency on a specific external host that
isn't "this exact deployment" for those users, and a genuine trust-model question worth flagging to
the maintainer rather than deciding silently).

**Recommended default for this plan:** implement the Vercel Function (primary target) first;
Cloudflare Pages Function as a fast-follow using the same relay logic; GitHub Pages shows Claude as
**unavailable** with a clear, honest message (a new, precise i18n key — not a reuse of
`settings.ai.providerStatusUnavailableBrowser`, since that key's existing use case is a different
reason) rather than silently failing or defaulting to a hosted proxy the user didn't choose. Revisit
a hardcoded fallback proxy URL only if the maintainer explicitly wants GitHub-Pages users to have
Claude too, understanding the trust-model change that implies.

#### 4.1.2 Proxy design

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
- **Abuse controls — mandatory, not optional (CWE-400, uncontrolled resource consumption):** the
  proxy endpoint is public and unauthenticated — anyone can `POST` to it with any Anthropic key,
  turning it into an externally-reachable resource-exhaustion surface even though per-request *cost*
  is the caller's own key. Before this ships, the contract and test plan must cover **all** of:
  - **Schema validation** of the incoming body (reject anything not matching the expected
    `{ apiKey, model, messages, ... }` shape before forwarding).
  - **Request body size limit** (reject oversized payloads outright).
  - **Origin policy**: restrict accepted requests to WorldScript's own deployed origin(s)
    (`Origin`/`Referer` check), not a fully open endpoint.
  - **Rate limiting** per-IP or per-origin (platform-native — e.g. Vercel's edge rate-limiting — or
    a lightweight in-function counter) to bound abuse even from a spoofed-origin request.
  - **Timeouts** on both the inbound request and the outbound call to `api.anthropic.com`, so a
    slow/hanging upstream can't tie up function instances indefinitely.
  - Tests covering each control's rejection behavior (oversized body → 413, bad origin → 403,
    rate-limit exceeded → 429, timeout → 504), alongside the existing statelessness/secret-handling
    tests in §4.5.
- **CSP update needed:** the client still only talks to `'self'` (the proxy), so no client-side CSP
  change — but the **proxy's own outbound call** to `api.anthropic.com` is server-side and not
  subject to browser CSP at all. Document this clearly in the ADR so a future audit doesn't go
  looking for a client-side `api.anthropic.com` CSP entry that was never needed.
- **Cloudflare Pages Function equivalent:** `functions/claude-proxy.ts` (Cloudflare's file-based
  routing convention differs from Vercel's `api/` — check Cloudflare Pages Functions docs for the
  exact handler signature at execution time, since this plan predates writing the code).

### 4.2 UI wiring (web/PWA — the dropdown entry and warning block already exist, see §0)

Unlike Grok, **no new dropdown entry is needed** — `{ id: 'anthropic', label: 'Anthropic Claude' }`
and its warning block already ship (`AiProviderCard.tsx` lines 180, 587). The identifier is already
correctly `'anthropic'` throughout (`AIProvider` type, `aiProviderService.ts`'s `case 'anthropic':`)
— just don't introduce a parallel `'claude'` id anywhere while touching this.

1. **On web builds where the proxy is reachable** (Vercel, Cloudflare Pages): replace the existing
   warning-only block with the same API-key + model-selector + Test Connection pattern every other
   cloud provider gets — but the "backend" the Test Connection button calls is the proxy endpoint,
   not a direct Anthropic call. Existing labels are already real strings, not hardcoded literals
   (verify `t('settings.ai.provider.anthropic')`-equivalent is actually used, per the mandatory
   i18n rule in §3.5 — the current line reads `label: 'Anthropic Claude'`, a literal; fix this as
   part of the same change even though it predates this plan).
2. **On GitHub Pages** (no proxy possible — §4.1.1): keep a warning block, but update its copy to
   the new, precise "no proxy on this deployment" reasoning rather than the current generic CORS
   note, once Track A ships and the note's "use the desktop app" half becomes literally true.
3. **`services/aiProviderService.ts`**: replace `streamAnthropic()`'s web-path throw (the desktop
   path was already fixed in Track A) with a real implementation that calls the proxy endpoint
   (`fetch('/api/claude-proxy', ...)`) instead of `https://api.anthropic.com` directly. Same for the
   image-generation and connection-test call sites (lines 590, 821-824) — decide whether Claude
   image generation is in scope at all (Anthropic may not offer an image-gen endpoint; verify before
   wiring UI for something that doesn't exist).
4. **`services/ai/providerFactory.ts`**: add an `'anthropic'` case if the new Vercel-AI-SDK layer
   should also support Claude on the web — likely wants its own `'anthropicProxy'` kind rather than
   reusing `'openaiCompatible'`, since the request/response shape differs from OpenAI's.

### 4.3 Security & privacy documentation (mandatory, not optional)

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

### 4.4 Testing

- Unit tests for the proxy handler logic (request forwarding, no logging of secrets) — likely needs
  a lightweight Vercel Function test harness or at minimum a pure-function extraction of the relay
  logic that's testable without the platform runtime.
- Unit tests for `streamAnthropic()`'s new proxy-calling implementation, mocking the `/api/claude-proxy`
  fetch.
- E2E: a new `tests/e2e/claude-provider.spec.ts` (or folded into existing AI-provider specs) —
  mock the proxy endpoint, verify the Settings UI flow end-to-end. Cannot realistically hit the
  real Anthropic API in CI (costs money, needs a real key) — mock-only, consistent with how other
  cloud-provider E2E specs in this repo already avoid real API calls.
- Manual smoke test matrix: Tauri desktop (Track A, real Anthropic key, no proxy) — Vercel (Track B,
  real proxy, real Anthropic key) — Cloudflare Pages (Track B, real proxy) — GitHub Pages (Track B
  unavailable state, confirm it doesn't silently break).

**Claude Definition of Done (Track A — desktop, ships first):**
- [ ] `streamAnthropic()` (+ connection-test) branches on `isTauriRuntime()`; desktop calls Anthropic natively, no CORS error
- [ ] `src-tauri/tauri.conf.json` CSP includes `https://api.anthropic.com`
- [ ] Desktop Settings UI shows a real API-key/model-selector flow for Claude instead of the warning block
- [ ] Unit tests for both runtime branches

**Claude Definition of Done (Track B — web/PWA, ships second):**
- [ ] Vercel Function proxy deployed and relaying requests statelessly (no key/prompt logging)
- [ ] Proxy enforces schema validation, body-size limit, origin policy, rate limiting, and timeouts (§4.1.2) — tested
- [ ] Cloudflare Pages Function equivalent (or explicit decision to defer, documented in the ADR)
- [ ] Claude's existing warning-only block replaced with a real API-key/model-selector flow on proxy-capable web deployments
- [ ] GitHub Pages shows an honest "unavailable" state, not a silent failure
- [ ] `docs/SECURITY-THREAT-MODEL.md` and README's privacy framing updated with the proxy caveat
- [ ] Unit + E2E tests (mocked, no real Anthropic calls in CI)

**Both tracks:**
- [ ] i18n: all provider/model/status/error strings use translation keys (no hardcoded literals) — including fixing the pre-existing `label: 'Anthropic Claude'` literal; all 19 locales
- [ ] No new feature flag
- [ ] New ADR 0016 covers both Grok and Claude decisions (and the Track A/B split)
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

## 7. Addendum — opt-in browser-fetch Ollama for the PWA (Issue #266 follow-up)

**This is a separate initiative from §§0-6 above** — different issue, different mechanism, no
backend involved — bundled into this same plan file at the maintainer's request rather than as a
second document.

### 7.1 Why this is *not* the same pattern as the Claude proxy

A hosted serverless proxy (§4) works for Claude because the proxy's *destination* —
`api.anthropic.com` — is a fixed host reachable from anywhere on the internet, including from
Vercel's/Cloudflare's servers. **That reasoning does not transfer to Ollama.** Ollama's destination
is `http://localhost:11434` **on the end user's own machine**. A serverless function fetching
`localhost:11434` reaches *itself*, never the user's computer — there is no proxy design that
bridges "an internet server reaching into a user's private machine." This is a hard networking
fact, not a policy choice, and it's why no part of this addendum proposes a proxy.

### 7.2 What actually exists: the maintainer's own "technically: yes" answer in Issue #266

[Issue #266](https://github.com/qnbs/WorldScript-Studio/issues/266) already contains a full,
correct analysis (comment thread, 2026-07-28/29) of why the PWA doesn't attempt Ollama connections
today, and what would be required to allow it as an *explicit, opt-in, unsupported* path — this
plan operationalizes exactly that answer, not a new invention:

- **Desktop (Tauri) already works with zero config** — `@tauri-apps/plugin-http` does native
  networking, immune to WebView CORS/Private-Network-Access rules (ADR-0012).
- **The PWA deliberately does not auto-probe localhost** (ADR-0012, decision #4) — a *product*
  decision, not a technical dead-end. Direct browser `fetch()` to `localhost:11434` **is** possible,
  exactly like NovelCrafter does it, **if and only if** the user's own Ollama server is started with
  `OLLAMA_ORIGINS` covering the PWA's exact origin (and, for LM Studio, its own "Enable CORS"
  setting is turned on). This is real, working, user-configured CORS — not a bypass, not a hack.
  NovelCrafter's browser-Ollama support works this same way and is not "magic": their own docs tell
  users to run `OLLAMA_ORIGINS=https://app.novelcrafter.com ollama serve`.
- WorldScript Studio has **more possible origins** than NovelCrafter's single fixed SaaS URL
  (`qnbs.github.io`, `worldscript-studio.vercel.app`, custom domains, forks' own Pages URLs) — the
  reason this was never made the *default* — but that's an argument against defaulting it on, not
  against offering it as an explicit, clearly-labeled opt-in for users who understand the tradeoff.

### 7.3 Implementation sketch

1. **New feature flag** — e.g. `enableBrowserOllama` — default **off**, opt-in, added through the
   normal `featureFlagsSlice.ts` + `featureCatalog.ts` process this sprint's WS-2 already
   reconciled (re-run `pnpm exec tsx scripts/audit-feature-parity.ts` after adding it — 0 drifts
   required).
2. **`services/localServerHttp.ts`**: `resolveFetch()` currently branches purely on
   `isTauriRuntime()`. Add a narrow, explicit widening — not a removal — of ADR-0012's decision #4:
   `isTauriRuntime() || (enableBrowserOllama && provider === 'ollama')`. Scope this to Ollama only
   in the first cut; LM Studio/vLLM browser-fetch is a separate follow-up (their CORS toggles are
   per-server-product, not a single env var, and are explicitly out of scope for this first pass).
3. **Settings UI**: a new "Experimental: allow browser connection to Ollama (advanced, unsupported)"
   toggle under the existing Ollama section in `AiProviderCard.tsx`, gated on the feature flag being
   present in the Experimental Features catalog (same pattern as every other opt-in flag). When
   enabled, render the **exact** command the user needs to run, computed from
   `window.location.origin` at render time — e.g. `OLLAMA_ORIGINS=https://qnbs.github.io ollama serve`
   — so the copy-paste instruction is always correct for *this* deployment (GitHub Pages vs. Vercel
   vs. a fork vs. a custom domain all differ; guessing wrong here was explicitly the failure mode
   ADR-0012 rejected making default).
4. **Error classification**: extend the existing `scanLocalOpenAiCompatibleEndpoints()` /
   `testOllamaConnection()` result states (`ok` / `unreachable` / `timeout` / `http`) with a
   best-effort `cors`-suspected state when running in the browser with the flag on. **Document the
   known limitation honestly rather than overclaim precision:** the Fetch API deliberately gives a
   generic `TypeError: Failed to fetch` for CORS rejections, indistinguishable at the JS level from
   "server is actually down" — so this can only be a heuristic (e.g., "likely CORS — verify
   `OLLAMA_ORIGINS` includes `<origin>`, or check the server is actually running"), not a certain
   diagnosis.
5. **Explicit non-goals**: no LAN-IP server support, no Private-Network-Access permission-prompt
   flow (already deliberately rejected in ADR-0012's "Alternatives considered" — inconsistent
   browser support, and PNA alone doesn't satisfy the *server's* CORS requirement anyway), no
   attempt to make this the default or to remove/weaken the existing desktop-first messaging.
6. **New ADR**: `docs/adr/0017-pwa-browser-ollama-opt-in.md` (sequential after 0016 from §2 above),
   explicitly framed as a narrow, opt-in widening of ADR-0012's PWA-desktop-only decision — cross-
   reference both directions (0012 should gain a "superseded-in-part by 0017 for the opt-in case"
   pointer once 0017 exists).
7. **Docs**: update the existing "desktop app required" banner copy, README, TODO.md, and the
   in-app help article to mention the new opt-in path without implying it's the recommended one —
   desktop remains the recommended, zero-config path for local servers.
8. **i18n**: same mandatory-translation-key requirement as Phase 1's i18n item (§3.5) above — the
   toggle label, the `OLLAMA_ORIGINS` instructional copy, and the new `cors`-suspected error state
   all need real `t()` keys across all 19 locales; no hardcoded literals.

### 7.4 Definition of Done

- [ ] New feature flag, default off, follows this repo's existing flag conventions (`pnpm exec tsx scripts/audit-feature-parity.ts` reports 0 drifts)
- [ ] PWA can optionally attempt a direct Ollama fetch when the flag is on, clearly labeled experimental/unsupported in the UI
- [ ] Settings UI renders the exact `OLLAMA_ORIGINS` command for the *current* deployment origin, not a guessed/generic one
- [ ] Connection failures surface an actionable CORS-suspected hint (honestly hedged, not overclaimed) rather than a generic "unreachable"
- [ ] New ADR 0017 cross-referencing ADR-0012 in both directions
- [ ] i18n: all provider/toggle/error strings use translation keys (no hardcoded literals); all 19 locales
- [ ] Unit tests: flag on/off gating in `resolveFetch()`, origin-detection helper, error-classification logic
- [ ] Explicitly documented as NOT a proxy and NOT solving LAN-IP or LM Studio/vLLM CORS automatically — user-configured, best-effort, the same non-magic model NovelCrafter actually uses
- [ ] README/TODO.md/help article/existing banner copy updated without demoting desktop as the recommended zero-config path

---

## 8. Sequencing

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
