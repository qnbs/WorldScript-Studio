# ADR 0013 — CSP `'wasm-unsafe-eval'` and `frame-src blob:`

- **Status:** Accepted
- **Date:** 2026-07-29
- **Deciders:** Maintainer + Claude Code
- **Context tags:** security, csp, wasm, ci-gates

## Context

WorldScript Studio advertises a "fully browser-native 4-layer local inference engine" — WebLLM,
ONNX Runtime Web, Transformers.js, DuckDB-WASM, plus Whisper-STT and Kokoro-TTS — as its core
differentiator. Every one of those is WebAssembly-based.

From 2026-05-27 (`faad8f0`, *feat(security): Phase 0 hardening*) to 2026-07-29, `script-src` on
every one of the 5 deployment surfaces (`index.html` meta tag, `vercel.json`, `public/_headers`,
`nginx.conf` ×3 blocks, `src-tauri/tauri.conf.json`) was `'self'` with no `'wasm-unsafe-eval'`.
`WebAssembly.instantiate`/`compile` are classified under CSP's `'unsafe-eval'` restriction unless
`'wasm-unsafe-eval'` is explicitly present. The result: **`WebAssembly.instantiate` was blocked in
every Chromium browser, on every deployment surface, for two months.** The advertised local-inference
stack never functioned in production.

The same commit that introduced `script-src 'self'` also added an inline `<script>` at
`index.html:96` (the `aurora-disabled` low-end-hardware check) with no nonce or hash — a second,
independent violation, directly contradicting that commit's own CSP-strategy comment three lines
above it ("`script-src`: nur eigene Skripte … kein inline nötig" — "no inline needed").

**Why no test caught this for two months:** the existing CSP tests
(`tests/unit/csp.test.ts`, `tests/unit/deploymentHeaders.test.ts`) assert **consistency between the
5 deployment surfaces**, never **functional correctness of a directive**. Four identically-broken
CSPs pass those tests with a clean bill of health. `scripts/smoke-prod-build.mjs` loads the real
production build in headless Chromium — the right place to catch this — but only listened for
`pageerror`. CSP violations never fire `pageerror`; they surface as `console` warnings and
`securitypolicyviolation` DOM events, neither of which the script observed.

Separately, no CSP surface had a `frame-src`/`child-src` directive, so both fell back to
`default-src 'self'`, which blocks `blob:` iframes. `components/BinderPanel.tsx:124` and
`components/ManuscriptResearchSplit.tsx:92` both render PDF/asset previews via
`<iframe src={blobUrl}>`, where `blobUrl` comes from `URL.createObjectURL()` on an
IndexedDB-backed asset (no same-origin static file exists to point at instead).

## Decision

1. Add `'wasm-unsafe-eval'` to `script-src` on all 5 surfaces — **not** the broader `'unsafe-eval'`
   keyword, which remains strictly forbidden. `'wasm-unsafe-eval'` only lifts the restriction on
   `WebAssembly.compile`/`instantiate`(`Streaming`).
2. Add `frame-src 'self' blob:` to all 5 surfaces.
3. Move the inline `aurora-disabled` script out of `index.html` and into `index.tsx` as a
   same-origin module statement (runs as the first executable line after imports, before the SPA
   redirect handler and before `ReactDOM.createRoot`) — no `'unsafe-inline'`, no hash to maintain.
4. Build a 3-layer test architecture so this class of defect cannot silently recur:
   - **Layer A (consistency)** — `tests/unit/csp.test.ts`, `tests/unit/deploymentHeaders.test.ts`
     (pre-existing, unchanged in intent).
   - **Layer B (correctness, new)** — `tests/unit/cspCorrectness.test.ts`: asserts, across all 5
     surfaces, that `script-src` contains `'wasm-unsafe-eval'` and neither `'unsafe-eval'` nor
     `'unsafe-inline'`; that `frame-src`/`child-src` allows `blob:`; regression guards on
     `worker-src`/`img-src` `blob:`, `object-src 'none'`, `base-uri 'self'`,
     `frame-ancestors 'none'`; and — the assertion that would have caught the 2026-05-27 defect on
     day one — that every inline `<script>` in `index.html` without a `src` attribute has a
     matching `'sha256-…'` entry in `script-src`, or that none exist.
   - **Layer C (runtime, hardened)** — `scripts/smoke-prod-build.mjs` now additionally: registers a
     `securitypolicyviolation` DOM listener via `page.addInitScript`; listens on `page.on('console')`
     for actual block/refusal phrasing (excluding the permanent, harmless
     `frame-ancestors`-ignored-in-`<meta>` notice); and runs a real
     `WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0]))` probe in headless Chromium,
     failing the gate on any unexpected violation or a blocked WASM probe.

## One accepted, narrowly-scoped exception

Layer C surfaced a fourth, distinct `securitypolicyviolation` after the fix: zod v4's own internal
JIT-availability probe (`new Function("")` inside a `try`/`catch`, used to decide between
compiled-validator fast paths and a graceful jitless fallback — traced to the exact blocked column
in the built `zod-*.js` chunk during this audit) is CSP-classified under `'unsafe-eval'`, which this
app deliberately does not grant. zod already handles the failure gracefully (falls back to jitless
validation; nothing breaks). Enabling `'unsafe-eval'` to silence this is forbidden by this ADR's own
decision. `scripts/smoke-prod-build.mjs` therefore excludes this one specific, precisely-matched
case (`blockedURI === 'eval'` **and** `sourceFile` matches `/assets/zod-*.js`) from the "0
violations" bar, logging it separately as a known-benign, third-party, self-handled degradation —
not silently ignored, and not a hand-wave: any *other* `eval`-classified violation still fails the
gate.

## Alternatives rejected

- **`'unsafe-eval'`** — strictly broader than needed; grants arbitrary `eval`/`Function` execution,
  not just WASM compilation. Forbidden outright.
- **Drop WebAssembly entirely** — guts the product's core advertised differentiator (local-first AI
  inference). Not viable.
- **Hash the inline script instead of moving it** — viable fallback if moving it into `index.tsx`
  had introduced a visible Aurora-effect flash on low-end-CPU simulation (deferred module execution
  vs. inline parser-time execution). Verified in this sprint: moving it produced no observable
  regression, so the simpler, hash-free option was kept. A hand-maintained hash would silently drift
  from the actual script content on any future edit — noted here in case a future change needs to
  revisit this tradeoff.
- **Silence the zod JIT-probe finding entirely (don't log it)** — rejected; logging it (excluded
  from the pass/fail count, but visible in output) keeps the exception auditable rather than a silent
  carve-out that could mask a *real* future `eval` violation hiding behind the same exclusion filter
  if the filter were made too broad. The filter is deliberately narrow (exact `blockedURI` + exact
  chunk-name-prefix match).

## Consequences

- **Positive:** the advertised local-inference stack (WebLLM, ONNX Runtime Web, Transformers.js,
  DuckDB-WASM, Whisper-STT, Kokoro-TTS) can now actually run in every deployed Chromium environment.
  Binder-PDF-preview and ManuscriptResearchSplit iframes work. A commit that reintroduces this class
  of defect (missing `'wasm-unsafe-eval'`, an unhashed inline script, or a missing `frame-src`) now
  fails in 3 independent places before it can reach production.
- **Negative (accepted):** `'wasm-unsafe-eval'` is a real, if narrow, expansion of what script the
  page's origin can execute — any script that can reach `script-src` (i.e., any first-party code, or
  a successful same-origin injection) can now compile and run arbitrary WebAssembly. This is
  inherent to shipping a WASM-based local-inference feature at all; no CSP directive can scope WASM
  permission to only "trusted" first-party code. The plugin sandbox is unaffected — see the JS-level
  guard analysis below.

## Does this weaken the plugin sandbox?

**No.** `workers/plugin.worker.ts` sets `self.WebAssembly = undefined` before executing untrusted
plugin code (`workers/plugin.worker.ts:128`, snapshotting the original at `:103`) and restores it
afterward on **both** the success and error paths (`:164`, with `'WebAssembly'` in the guard-check
list at `:203`). This is a JS-level guard, entirely independent of CSP — it works by removing the
global binding a plugin's sandboxed code could call, not by relying on the browser's CSP enforcement.
`'wasm-unsafe-eval'` changes what the *page's own first-party code* may do; it does not restore
`self.WebAssembly` inside a plugin's execution context, where the JS-level guard already denies it
regardless of CSP. The adversarial tests in `tests/unit/workers/plugin.worker.test.ts` (WebAssembly
denial, `Function`/`AsyncFunction`/`GeneratorFunction`/`AsyncGeneratorFunction` constructor-escape
blocks, guard-restoration on both success and error paths) were re-run after this change and remain
green, unmodified.

## References

- `index.html`, `vercel.json`, `public/_headers`, `nginx.conf`, `src-tauri/tauri.conf.json` (the 5 CSP surfaces)
- `index.tsx` (moved `aurora-disabled` script)
- `tests/unit/cspCorrectness.test.ts` (Layer B, new)
- `scripts/smoke-prod-build.mjs` (Layer C, hardened)
- `tests/unit/workers/plugin.worker.test.ts`, `workers/plugin.worker.ts` (plugin-sandbox non-impact)
- `docs/DEPLOYMENT.md` § Why `'wasm-unsafe-eval'`, `docs/SECURITY-THREAT-MODEL.md` § CSP script-src
- Origin commit `faad8f0` (2026-05-27); audit `PROMPT-WSS-v1.24.x`, findings F-01…F-04 (2026-07-29)
- [[0004-csp-connect-src-byok-tradeoff]]
