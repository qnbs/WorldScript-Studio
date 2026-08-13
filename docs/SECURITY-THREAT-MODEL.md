# Security Threat Model

**Version:** 1.0.0  
**Date:** 2026-06-05 (baseline); desktop-crypto mitigation row updated 2026-07-29 (v1.24.2, F-05/F-06)  
**Status:** v1.24.2 baseline

This document provides a formal STRIDE threat analysis for WorldScript Studio, mapping threats to mitigations and code locations.

## STRIDE Analysis

### S - Spoofing (Identity Forgery)

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| User impersonation in collaboration | Password-derived room key; awareness state encrypted | `services/collaborationService.ts:deriveEncryptionKey()` |
| AI provider spoofing via malicious config | Provider allowlist; URL validation | `services/ai/aiPolicy.ts:LOCAL_INFERENCE_PROVIDERS` |
| Plugin identity spoofing | Zod schema validation on descriptor | `services/pluginRegistry.ts:PluginDescriptorSchema` |

### T - Tampering (Data Modification)

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| Manuscript data modification | AES-256-GCM authentication tag verification | `services/storage/storageEncryptionService.ts:decrypt()` |
| Collaboration payload tampering | RTCDataChannel E2E encryption | `packages/collab-transport/src/crypto.js` |
| Settings corruption | Schema validation on load | `features/settings/settingsSlice.ts:normalizePersistedSettings()` |
| Plugin code injection | Content guard script | `scripts/content-guard.mjs` |
| AI-proposed manuscript corruption | Control-character / lone-surrogate rejection with per-item skip | `services/proForge/applyReviewEdits.ts:validateProposedText()` |

### R - Repudiation (Non-repudiation)

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| User actions not traceable | StructuredLogger with GDPR sanitization | `services/logger.ts:createLogger()` |
| AI calls not logged | Telemetry service (opt-in) | `services/ai/telemetryService.ts` |
| Collaboration actions anonymous | Awareness state includes user identity | `services/collaborationService.ts` |

### I - Information Disclosure

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| API key leakage via logs | StructuredLogger sanitization; never log keys | `services/logger.ts:sanitizeLogContext()` |
| Desktop API key exposure via local file-read access | **Not resolved — corrected 2026-08-13.** The 2026-07-29 change (F-05/F-06) replaced a single unsalted SHA-256 digest with PBKDF2 (600 000 iterations, SHA-256, random 32-byte salt), which stops rainbow-table and multi-target reuse attacks — but the derivation *input* passed to PBKDF2 is still `${appDataPath}\|${provider}\|WorldScriptStudio\|v1`, built entirely from a standard OS app-data path, a public provider-name enum, and hardcoded literals. Anyone with read access to `config/<provider>_key.enc.json` — the exact threat this row exists to cover — can reconstruct that exact string and derive the same key in one PBKDF2 call; no brute force or precomputed table is needed, so the added iteration count provides no real defense here. The underlying "obfuscation, not encryption" finding was never actually closed. Real fix tracked: fold API keys into the same user-passphrase-protected store scheme `storageEncryptionService.ts`/`encryptionMigrationOrchestrator.ts` already provide, keyed by an actual user secret instead of a derived public string; honest plaintext fallback when no passphrase is set. | `services/fs/fsCore.ts:deriveFileSystemCryptoKey()`, `services/fs/settingsFsStore.ts:getApiKey()` |
| Manuscript data in IndexedDB | AES-256-GCM at-rest encryption | `services/storage/storageEncryptionService.ts` |
| Voice audio to cloud | Web Speech API consent gate | `components/voice/VoicePrivacyConsentModal.tsx` |
| DuckDB analytics unencrypted (SEC-6) | **Bounded by design, with one prose column now encrypted:** most persisted fields are local metadata only (titles, loglines, character names, word counts, embeddings) and **nothing leaves the device**. The one column that genuinely holds literal manuscript prose, `codex_mentions.excerpt`, is now cell-level encrypted (AES-256-GCM via `services/duckdb/duckdbEncryption.ts`, reusing the IDB at-rest encryption key) whenever `enableIdbAtRestEncryption` is active: `duckdbCodexWrite()` writes ciphertext into `excerpt_enc BLOB` and nulls the plaintext `excerpt` column; `services/duckdb/codexExcerptEncryptionMigration.ts` backfills any pre-existing plaintext rows once encryption is unlocked. Gated by `enableDuckDbAnalytics` **and** the Settings → Privacy "Analytics" opt-out (`isAnalyticsPersistenceAllowed` in `app/listenerMiddleware.ts`); turning the toggle off stops all DuckDB writes + inference telemetry. Full OPFS file-level encryption remains **infeasible** — DuckDB-WASM owns the OPFS file handle directly, so there is no app-level interception point; the other metadata columns stay intentionally plaintext (bounded-exposure design). | `app/listenerMiddleware.ts:isAnalyticsPersistenceAllowed`, `services/duckdb/duckdbAnalytics.ts:duckdbCodexWrite()`, `services/duckdb/duckdbEncryption.ts`, `services/duckdb/codexExcerptEncryptionMigration.ts` |
| Prompt injection exposing context | Prompt sanitization | `services/ai/ragPromptAssembly.ts:sanitizePromptBlock()` |
| Prompt injection via AI-proposed edits | Control-character / lone-surrogate validation; per-item skip | `services/proForge/applyReviewEdits.ts:validateProposedText()` |
| Claude BYOK key transits WorldScript's own infrastructure (web/PWA only — see §Claude serverless proxy below) | Stateless relay, no logging of key/prompt/response on any path; same-origin check rejects third-party callers | `api/_shared/claudeProxyCore.ts:handleClaudeProxyRequest()` |

### D - Denial of Service

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| Large model download OOM | Bundle exclusion from SW precache | `vite.config.ts:globIgnores` |
| Worker pool exhaustion | PriorityTaskQueue with MAX_QUEUE_SIZE=32 | `packages/worker-bus/src/taskQueue.ts` |
| Infinite AI retry loops | Exponential backoff with cap (30s) | `services/ai/aiRetry.ts` |
| Malicious plugin CPU burn | Worker isolation with timeout | `workers/plugin.worker.ts` (P0-2) |
| Public `claude-proxy` endpoint used as an open relay / resource-exhaustion surface (CWE-400) | Zod schema validation, 256 KiB body-size cap (checked via header **and** actual body length), same-origin check, per-client in-memory rate limit (20 req/60s), 20s outbound timeout to Anthropic | `api/_shared/claudeProxyCore.ts` |

### E - Elevation of Privilege

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| Plugin accessing unauthorized APIs | Permission gate in sandboxed API | `services/pluginRegistry.ts:PERMISSION_API_MAP` |
| Plugin cross-storage access | Namespace prefix + length/character/traversal validation | `services/pluginRegistry.ts:validatePluginStorageKey()` |
| Plugin storage DoS | Serialized value size cap (2 MiB) | `services/pluginRegistry.ts:validatePluginStorageValue()` |
| Collaboration without password | CollabEncryptionRequiredError | `services/collaborationService.ts:connect()` |
| Feature flag bypass | Runtime gate checks | `features/featureFlags/featureFlagsSlice.ts` |

## Attack Trees

### AI Prompt Injection Attack Tree

```
Goal: Inject malicious prompt to extract/manipulate manuscript data
├─ OR: Direct user input in AI prompt
│  └─ Mitigation: sanitizePromptBlock() strips control chars, fences
├─ OR: RAG context poisoning
│  ├─ Vector embedding manipulation
│  │  └─ Mitigation: RAG source validation, embedding integrity
│  └─ Lexical index poisoning
│     └─ Mitigation: Index sanitization on write
├─ OR: Plugin-generated prompts
│  └─ Mitigation: Plugin sandboxed API, no direct prompt access
└─ OR: AI-proposed edits carrying malicious control characters
   └─ Mitigation: validateProposedText() rejects C0 controls, null bytes, lone surrogates
```

### Plugin Sandbox Escape Attack Tree

```
Goal: Access app state outside plugin permissions
├─ OR: Dynamic import in main thread
│  └─ Mitigation: Worker isolation (P0-2)
├─ OR: Prototype pollution
│  └─ Mitigation: Zod validation, frozen globals
├─ OR: Resource exhaustion
│  └─ Mitigation: Worker timeout, circuit breaker
├─ OR: Cross-plugin storage access
│  └─ Mitigation: `plugin:${id}:` prefix + length/char/traversal validation
├─ OR: Plugin storage DoS
│  └─ Mitigation: 2 MiB serialized value size cap
└─ OR: Crypto key extraction
   └─ Mitigation: Non-extractable CryptoKey, no key export
```

### Collaboration MITM Attack Tree

```
Goal: Intercept/decrypt collaboration traffic
├─ OR: Signaling server compromise
│  ├─ Password strength weakness
│  │  └─ Mitigation: PBKDF2 600k iterations
│  └─ Room name enumeration
│     └─ Mitigation: Deterministic salt from projectId
├─ OR: RTCDataChannel interception
│  └─ Mitigation: AES-256-GCM E2E encryption
└─ OR: Awareness state tampering
   └─ Mitigation: Encrypted awareness payload
```

### Desktop (Tauri) Local File-Read Attack Tree

```
Goal: Recover a user's cloud-provider API key from the Tauri desktop install
├─ OR: Read config/<provider>_key.enc.json directly (local process / malware with user-level FS access)
│  └─ Mitigation: AES-256-GCM with PBKDF2-derived key (600k iter, random 32-byte salt per file) —
│     reading the ciphertext no longer reveals the key material; the pre-2026-07-29 scheme derived
│     the key from data an attacker with file-read access already had (F-05/F-06, fixed)
├─ OR: Read the IDB-at-rest passphrase sentinel (enableIdbAtRestEncryption)
│  └─ Mitigation: same PBKDF2 + non-extractable-key pattern; session-scoped in-memory key, never
│     persisted to disk (`services/storage/storageEncryptionService.ts`)
└─ OR: Tamper with the CSP to re-enable a weaker script-src and inject a key-exfiltration script
   └─ Mitigation: strict Tauri connect-src allowlist (no `https:` blanket); CSP is bundled into the
      signed app binary, not user-editable at runtime without re-signing (ADR-0004, ADR-0013)
```

## Mitigation Mapping

| Component | Threat | Mitigation | Status |
|-----------|--------|------------|--------|
| `storageEncryptionService.ts` | I | AES-256-GCM, PBKDF2 600k, extractable:false | ✅ Complete |
| `collaborationService.ts` | S,T,I | Password-derived key, E2E encryption | ✅ Complete |
| `pluginRegistry.ts` | E,D | Permission gate, sandboxed API | ✅ Complete (P0-2: worker isolation via plugin.worker.ts) |
| `aiPolicy.ts` | S | Provider allowlist, localStorageOnly gate | ✅ Complete |
| `logger.ts` | I,R | GDPR sanitization, no key logging | ✅ Complete |
| `sw.js` | I | Network-only for AI hosts | ✅ Complete |
| `tauri.conf.json` | I | Strict CSP — explicit `connect-src` allowlist, no `https:` blanket | ✅ Complete |
| `index.html` (web PWA) | I | CSP `connect-src 'self' https:` — broad HTTPS by design for BYOK; no `http:`/`ws:` wildcards | ⚠️ Documented tradeoff ([ADR-0004](adr/0004-csp-connect-src-byok-tradeoff.md)) |
| `vercel.json` / `public/_headers` / `nginx.conf` | I | `Content-Security-Policy` response header, mirrors the meta CSP (`frame-ancestors 'none'` only takes effect as a header) | ✅ Complete on Vercel/CF/Docker. **GitHub Pages cannot set response headers at all** — the `index.html` meta CSP is the sole enforcement there. |
| `script-src` (all 5 CSP surfaces) | D (denial of advertised functionality) | `'wasm-unsafe-eval'` (not `'unsafe-eval'`) — WebAssembly compile/instantiate for WebLLM/ONNX/Transformers.js/DuckDB-WASM/Whisper/Kokoro; plugin-sandbox WASM denial (`workers/plugin.worker.ts`) is a separate JS-level guard, unaffected | ✅ Complete ([ADR-0013](adr/0013-csp-wasm-and-blob-frames.md)) — was absent 2026-05-27 to 2026-07-29, blocking the entire local-inference stack in production (F-01/F-02) |
| `api/_shared/claudeProxyCore.ts` (Vercel Edge Function + Cloudflare Pages Function) | I, D | Schema validation, body-size cap, same-origin check, per-client rate limit, outbound timeout, no logging of key/prompt/response on any path | ✅ Complete ([ADR-0016](adr/0016-native-grok-and-claude-providers.md) Track B) |

### CSP connect-src: web-vs-Tauri asymmetry (ADR-0004)

The web PWA's `connect-src` intentionally allows the `https:` scheme-source because the shipped BYOK
feature `openAiCompatibleBaseUrl` (Settings → AI → custom base URL) lets users target arbitrary
self-hosted/third-party OpenAI-compatible proxies that cannot be statically enumerated in a `<meta>`
CSP. The redundant explicit cloud-provider entries were removed (they changed nothing under `https:`
and implied a hardening the policy did not provide). **Residual risk:** a `fetch` driven in the web
PWA (e.g. via AI prompt injection) can reach any HTTPS origin. Mitigations: no secrets in
`connect-src`-reachable globals; keys encrypted at rest and only attached to the user's chosen
provider request; AI output never `eval`'d. `http:`/`ws:` scheme-wildcards remain disallowed
(cleartext exfiltration blocked). The native **Tauri** CSP stays strict (no `https:`). Closing this
fully = build-time CSP generation (Option C, v2.0). Regression test: `tests/unit/csp.test.ts`.

**Host header CSP (2026-07-28):** `vercel.json`, `public/_headers`, and `nginx.conf` now set a real
`Content-Security-Policy` response header, identical to the meta CSP above — `connect-src` is
unchanged (this tradeoff still applies there), but `frame-ancestors 'none'` only takes effect as a
header, never as a meta tag, so that's a genuine additional control on Vercel/Cloudflare Pages/Docker.
**GitHub Pages — the canonical upstream mirror — cannot set any HTTP response header**, so the meta
CSP above remains its *only* enforcement point, and `Permissions-Policy` cannot be set there under any
circumstance (no meta-tag equivalent exists for it). Regression test:
`tests/unit/deploymentHeaders.test.ts`.

### CSP script-src: `'wasm-unsafe-eval'` (ADR-0013)

From 2026-05-27 (`faad8f0`) to 2026-07-29, `script-src` was `'self'` with no `'wasm-unsafe-eval'`
on any of the 5 deployment surfaces, so `WebAssembly.instantiate` was blocked in every Chromium
browser in production — the entire advertised local-inference stack (WebLLM, ONNX Runtime Web,
Transformers.js, DuckDB-WASM, Whisper-STT, Kokoro-TTS) never functioned. No test caught this: the
existing CSP tests (Layer A) only assert cross-surface *consistency*, and `scripts/smoke-prod-build.mjs`
listened only for `pageerror`, which CSP violations never fire (they surface as `console` warnings and
`securitypolicyviolation` DOM events instead). This is now closed with `'wasm-unsafe-eval'` (never
the broader `'unsafe-eval'`) plus two new test layers: **Layer B** (`tests/unit/cspCorrectness.test.ts`
— functional-directive assertions across all 5 surfaces, including a check that would have caught the
inline-script defect on day one) and **Layer C** (the hardened `smoke-prod-build.mjs`, which now
captures both violation channels and runs a real `WebAssembly.instantiate` probe in headless
Chromium). **Does this weaken the plugin sandbox?** No — `workers/plugin.worker.ts` sets
`self.WebAssembly = undefined` before executing untrusted plugin code and restores it on both the
success and error paths, independent of CSP; the adversarial tests in
`tests/unit/workers/plugin.worker.test.ts` remain green, unaffected. Full decision record:
[`docs/adr/0013-csp-wasm-and-blob-frames.md`](adr/0013-csp-wasm-and-blob-frames.md).

### Claude serverless proxy trust-model change (ADR-0016 Track B)

Every cloud AI provider in WorldScript except Claude-on-web is a **direct browser→provider** call —
the user's API key leaves their machine and goes straight to Gemini/OpenAI/Grok/OpenRouter, never
touching WorldScript's own infrastructure. **This is the one exception.** Anthropic blocks direct
browser requests entirely (no CORS allowlist WorldScript can request), so the web/PWA build (Vercel,
Cloudflare Pages — not GitHub Pages, which is static-only and can host neither function) relays
Claude calls through `api/claude-proxy.ts` / `functions/api/claude-proxy.ts`, both thin
platform-specific wrappers around the shared `api/_shared/claudeProxyCore.ts` relay. Concretely: the
user's browser → WorldScript's own Vercel/Cloudflare deployment → `api.anthropic.com`. The desktop
app (Tauri, ADR-0012's native-HTTP escape hatch — see [ADR-0016 Track A](adr/0016-native-grok-and-claude-providers.md))
does **not** go through this proxy; it calls Anthropic directly, matching every other provider's
trust model.

**Statelessness guarantee:** the proxy is a pure relay. It never writes the API key, prompt, or
response to any log, database, or cache — `tests/unit/api/claudeProxyCore.test.ts` asserts
`console.log`/`.warn`/`.error` are never called on any code path (success, validation failure, rate
limit, upstream error). **Abuse controls** (the endpoint is public and unauthenticated by
necessity — it exists so *any* user's own browser can reach it): Zod schema validation, a 256 KiB
body-size cap enforced against both the declared `Content-Length` header and the actual received
body length (defeats a spoofed header), a same-origin check (`Origin` header must match the
deployment's own host — rejects third-party pages driving traffic through the proxy with a stolen
or attacker-supplied key), a best-effort per-client-IP rate limit (20 requests/60s, in-memory —
genuinely per-instance, not distributed; see the code comment for why a platform KV/rate-limit
product was judged out of scope), and a 20s timeout on the outbound call to Anthropic so a hung
upstream can't tie up function instances indefinitely.

**What this does *not* change:** the proxy never sees the user's manuscript content in a way it
didn't already see as the request body — it is a transit point, not a new data store. It also
doesn't affect the CSP tradeoff above (ADR-0004): the client→proxy leg is same-origin (`'self'`,
already allowed), and the proxy→Anthropic leg is server-side, never subject to browser CSP at all.

**Monitoring / anomaly detection:** the proxy intentionally does **not** perform in-app logging of
requests, rate-limit hits, or errors — `tests/unit/api/claudeProxyCore.test.ts` enforces a hard
zero-console-call guarantee on every path, and adding request-level logging here would violate that
stateless contract. Instead, rely on the hosting platform's own request-level observability:
**Vercel Function Logs** or **Vercel Observability** (primary deployment) for request volume, status
codes, and latency; on Cloudflare Pages, **Cloudflare Workers Metrics/Analytics** and **Workers
Logs** provide the equivalent view — note that Workers observability (Logs) is opt-in and must be
explicitly enabled in the Worker's Wrangler configuration (`observability.enabled = true`) before
it captures anything. Spikes in 429 (rate-limited) or 4xx responses on the `claude-proxy`
route are the actionable signal for abuse; alert thresholds should be configured directly in the
platform dashboard, not in application code.

## Security Checklist

- [x] PBKDF2 iterations ≥ 600,000 (OWASP 2024 minimum)
- [x] CryptoKey extractable = false everywhere
- [x] IV uniqueness per operation (random 12-byte)
- [x] No API keys in localStorage/sessionStorage
- [x] No console.log of sensitive data
- [x] CSP connect-src: Tauri strict (known hosts); web PWA `https:` by design for BYOK, no `http:`/`ws:` wildcards (ADR-0004)
- [x] Collaboration requires password in production
- [x] Plugin system permission-gated
- [x] Plugin system Worker-isolated (P0-2) — `workers/plugin.worker.ts`
- [x] DuckDB analytics privacy-gated (SEC-6) — writes require `enableDuckDbAnalytics` **and** the Settings → Privacy "Analytics" opt-out (`isAnalyticsPersistenceAllowed`, `app/listenerMiddleware.ts`); only local metadata is stored, nothing leaves the device.
- [x] DuckDB cell-level excerpt encryption (SEC-6, v1.25.0) — `codex_mentions.excerpt` (the one column holding literal manuscript prose) is AES-256-GCM encrypted into `excerpt_enc BLOB` and nulled from the plaintext column when `enableIdbAtRestEncryption` is active, with a backfill migration for pre-existing rows (`services/duckdb/codexExcerptEncryptionMigration.ts`).
- [ ] DuckDB OPFS file-level encryption (SEC-6) — **infeasible / accepted risk, not deferred-pending-work.** DuckDB-WASM owns the OPFS file handle directly (`workers/v2/duckdb.worker.ts`), leaving no app-level interception point for transparent file encryption. Remaining plaintext metadata columns (`title`/`logline`/`name`/`character_names`/`label`) are bounded-exposure by design, not manuscript prose.
- [x] Voice WASM download UX (P0-5) — `components/voice/VoiceModelDownloadModal.tsx`
- [x] Claude web proxy (ADR-0016 Track B): stateless (no key/prompt/response logging), schema-validated, body-size-capped, same-origin-checked, rate-limited, timeout-bounded — `api/_shared/claudeProxyCore.ts`

## References

- OWASP 2024 Password Storage Guidelines
- NIST SP 800-63B Digital Identity Guidelines
- CWE-200: Exposure of Sensitive Information
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection (N/A - no SQL backend)