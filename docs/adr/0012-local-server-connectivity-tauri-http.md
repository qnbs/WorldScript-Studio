# ADR 0012 — Local AI server connectivity: route localhost HTTP through the Tauri HTTP plugin (web stays fetch)

- **Status:** Accepted
- **Date:** 2026-07-25
- **Deciders:** Maintainer + Kimi Code
- **Context tags:** ai, ollama, lm-studio, tauri, cors, csp, private-network-access
- **Fixes:** [#266](https://github.com/qnbs/WorldScript-Studio/issues/266) · extends [ADR 0004](0004-csp-connect-src-byok-tradeoff.md)

## Context

WorldScript Studio can use server-grade local models through the **Ollama** provider and can scan
for local OpenAI-compatible servers (Ollama `:11434`, LM Studio `:1234`, vLLM `:8000`). Two failure
modes were reported in #266:

1. **Desktop build (.deb / Tauri) does not see Ollama or LM Studio even though both are running.**
2. **The installed PWA logs loud CORS errors against `localhost:11434` even when `OLLAMA_ORIGINS`
   is configured.**

### Root cause analysis

- `services/ollamaService.ts` (`testOllamaConnection`, `listOllamaModels`, `streamOllama`,
  `pullOllamaModel`) and `scanLocalOpenAiCompatibleEndpoints()` (`services/aiProviderService.ts`)
  all used the **browser `fetch`** — including inside the Tauri WebView.
- The Tauri WebView origin is `http://tauri.localhost` (Linux/Windows) resp. `tauri://localhost`
  (macOS). Requests to `http://localhost:11434` etc. are therefore **cross-origin**. Ollama sends
  **no `Access-Control-Allow-Origin` header** unless the server is started with `OLLAMA_ORIGINS`
  covering the WebView origin — the WebView then blocks the response (CORS). LM Studio and vLLM
  behave similarly depending on their own CORS configuration. WebView2/WKWebView additionally apply
  Private-Network-Access / mixed-content style restrictions to `localhost` targets.
- The Tauri CSP (`src-tauri/tauri.conf.json` `connect-src`) already listed all three ports for
  `localhost` and `127.0.0.1`. **CSP was never the blocker — CORS was.** CSP can only *forbid* a
  connection; it can never *permit* a cross-origin read that the server does not allow.
- In the PWA, `AiProviderCard`'s auto-effect fired `listOllamaModels()` **directly** (bypassing the
  desktop-only guard inside `testAIConnection`) whenever the Ollama provider was selected. Each
  settings visit produced CORS preflight failures in the console. `OLLAMA_ORIGINS` can silence this
  only if the PWA origin is explicitly listed — but the browser path is desktop-only by policy
  anyway, so auto-probing localhost from the PWA is simply wrong.
- `@tauri-apps/plugin-http` (JS) and `tauri-plugin-http` (Rust) were **already dependencies**, and
  the `http:default` capability was already granted — but nothing on the Ollama path used them. The
  plugin executes requests via the native Rust HTTP stack (reqwest), which is **not subject to
  WebView CORS or PNA rules at all**.

## Decision

1. **Introduce a thin runtime-aware HTTP layer** (`services/localServerHttp.ts`):
   - Under `isTauriRuntime()` (canonical `__TAURI_INTERNALS__`-aware detection, see
     `services/tauriRuntime.ts`) it dynamically imports `@tauri-apps/plugin-http` and uses its
     `fetch` — native, CORS-free.
   - Otherwise it uses the global `fetch`. The dynamic import keeps the web bundle lean and
     matches the existing `@tauri-apps/*` externalization for web builds.
   - The layer owns base-URL normalization (trailing-slash strip, `localhost:11434` default),
     timeout composition (`AbortSignal.timeout` merged with the caller's signal via
     `AbortSignal.any`), and error classification (`unreachable` | `timeout` vs. user `AbortError`,
     which is rethrown unchanged so cancel-vs-failure stays distinguishable).
2. **Route all local-server traffic through it:** all four `ollamaService` functions and
   `scanLocalOpenAiCompatibleEndpoints()`. Public signatures and legacy error strings are preserved
   so orchestration-layer contracts (single `onError` firing, AbortError propagation) are untouched.
3. **Classified scan results:** the scan returns a `state` (`ok` | `unreachable` | `timeout` |
   `http`) plus the legacy numeric `status`, so the UI can render actionable badges instead of a
   bare "no response".
4. **PWA stays strictly desktop-only** (product decision): no reachability probing from the
   browser. The `AiProviderCard` auto-effect and model loading are gated on `isTauriRuntime()`, so
   the PWA performs **zero** localhost requests — the CORS console noise disappears by
   construction. Instead the PWA shows a quiet banner explaining the restriction plus a
   "Download the desktop app" CTA.
5. **CSP is explicit and runtime-checked.** The WebView CSP is bypassed for plugin-http traffic
   (native stack), but `localServerFetch` still checks every native and browser endpoint against the
   shared `config/csp-connect-src.json` policy before transport. Tauri capability scope remains a
   second native enforcement boundary. Unlisted BYOK origins and local endpoints fail with an
   actionable policy error rather than an opaque network error. The same origin source generates the
   web headers and Tauri CSP; arbitrary BYOK origins require an explicit policy update.
6. **Capability scope is pinned explicitly** in `src-tauri/capabilities/default.json`. Audit finding
   during this work: `http:default` alone grants **no URL scope at all** (the plugin's
   `Scope::is_allowed` requires a matching allow entry), so every plugin-http call — including the
   existing AI-SDK `fetchAdapter` cloud calls on desktop — was silently denied. The scope now
   allows `http://localhost:*/*` + `http://127.0.0.1:*/*` as a defense-in-depth envelope plus the
   enumerated cloud endpoints that mirror the Tauri CSP `connect-src` (Gemini, OpenAI, x.ai,
   OpenRouter, Groq). The shared runtime policy narrows local requests to the explicitly supported
   ports before plugin-http is called. Known limitation (status quo, unchanged): LAN-IP servers
   (`http://192.168.…`) and arbitrary BYOK cloud base URLs remain outside the scope; widening is a
   separate, deliberate decision.

## Consequences

- **Positive:** Desktop Ollama/LM Studio/vLLM discovery and inference work out of the box — no
  `OLLAMA_ORIGINS` setup required on desktop. PWA console stays clean. Timeouts, aborts, and error
  classes are consistent across all local-server calls. Scan results are actionable (per-endpoint
  badge + one-click "use this URL").
- **Negative / accepted:** A second HTTP code path exists (plugin vs. browser fetch). It is
  isolated in one ~100-line module and covered by unit tests that mock both branches.
  `streamOllama`/`pullOllamaModel` rely on the plugin's streaming `Response.body` reader — covered
  by mocked-reader tests; a native smoke check rides on the `tauri-build.yml` workflow dispatch.
- **Security posture:** unchanged-or-better. No new cloud endpoints, no secrets, localhost-only
  capability scope, privacy-first (no call happens without a user-visible provider selection or
  button press).

## Alternatives considered

- **Document `OLLAMA_ORIGINS=tauri://localhost,http://tauri.localhost` as the fix** — rejected:
  pushes setup burden onto every desktop user, still breaks on LM Studio/vLLM CORS configs, and
  does nothing for PNA/mixed-content quirks in WebView2/WKWebView.
- **Rust command wrapper (`invoke`) for Ollama** — rejected: duplicates an already-shipped plugin,
  adds Rust surface for zero capability gain; plugin-http is the canonical Tauri v2 answer.
- **Allow PWA status-only probing with Private Network Access permission** — rejected (product
  decision): keeps CORS noise possible, adds a second-class UX path, and conflicts with the
  privacy-first "desktop-only" policy for localhost servers.

## Update (2026-07-28): build-pipeline gap left the desktop path broken in packaged builds

This ADR's decision (route local-server HTTP through `@tauri-apps/plugin-http`) was correct, but
the packaged desktop build never actually exercised it. `vite.config.ts`'s `rollupOptions.external`
unconditionally externalized every `@tauri-apps/*` package from **every** `vite build`, including
the exact build Tauri's `beforeBuildCommand` invokes to produce the `.deb`/`.msi`. Since
`services/localServerHttp.ts`'s `@tauri-apps/plugin-http` import is dynamic (`await import(...)`),
externalizing it left an unresolvable bare module specifier in the shipped bundle — confirmed with
a real build + real-Chromium repro, producing `TypeError: Failed to resolve module specifier
'@tauri-apps/plugin-http'` the instant `resolveFetch()` ran, before any network request. Every
caller's catch classified this identically to a genuinely-down server, matching the exact symptom
reported on issue #266 after #269 merged: no CORS console noise (nothing reached the network
layer), and no Ollama/LM Studio discovery despite both running.

Root cause: `resolveViteBase.ts` already had the right Tauri-vs-web build detection (via
`TAURI_ENV_PLATFORM`/`TAURI_PLATFORM`), used for the `base` config, but `rollupOptions.external`
was never given the same treatment. `tauri dev` was unaffected (Vite's dev server doesn't apply
`rollupOptions`), so the regression only surfaced in packaged builds — and the unit test suite
mocks `@tauri-apps/plugin-http` via `vi.mock`, which bypasses real module resolution entirely and
structurally cannot catch this class of bug.

Fix: extracted the Tauri-build check into a shared `isTauriBuild()` export in `resolveViteBase.ts`
and made `rollupOptions.external` conditional on it — the desktop build now bundles
`@tauri-apps/plugin-http` correctly; the web/PWA build is unaffected (those code paths are gated
by `isTauriRuntime()` and never exercised there). `services/localServerHttp.ts`'s `resolveFetch()`
also now wraps the dynamic import in its own try/catch, classifying a load failure as a distinct
`LocalServerError('plugin_unavailable')` and logging it, so a future regression of this class fails
loudly and distinctly instead of silently misclassifying as "unreachable."

## Update (2026-07-30): decision #4 (PWA stays strictly desktop-only) narrowly widened by 0017

[[0017-pwa-browser-ollama-opt-in]] adds an explicit, default-**off** `enableBrowserOllama` flag
letting a user who has separately configured their own Ollama server's `OLLAMA_ORIGINS` attempt a
direct browser fetch from the web/PWA build. This is a narrow widening, not a reversal: the default
behavior described in decision #4 above — the PWA performs zero localhost requests unless a user
explicitly opts in — is unchanged, and the "Allow PWA status-only probing with Private Network
Access permission" alternative rejected above stays rejected (0017 doesn't use PNA at all; it relies
on real, server-configured CORS instead).
