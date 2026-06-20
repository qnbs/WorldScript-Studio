# Security Threat Model

**Version:** 1.0.0  
**Date:** 2026-06-05  
**Status:** v1.22.0 baseline

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
| Manuscript data in IndexedDB | AES-256-GCM at-rest encryption | `services/storage/storageEncryptionService.ts` |
| Voice audio to cloud | Web Speech API consent gate | `components/voice/VoicePrivacyConsentModal.tsx` |
| DuckDB analytics unencrypted | OPFS encryption module exists but is **not wired** into the persistence path — analytics remain unencrypted at rest (P0-4 integration pending) | `services/duckdb/duckdbEncryption.ts` |
| Prompt injection exposing context | Prompt sanitization | `services/ai/ragPromptAssembly.ts:sanitizePromptBlock()` |
| Prompt injection via AI-proposed edits | Control-character / lone-surrogate validation; per-item skip | `services/proForge/applyReviewEdits.ts:validateProposedText()` |

### D - Denial of Service

| Threat | Mitigation | Code Location |
|--------|------------|-------------|
| Large model download OOM | Bundle exclusion from SW precache | `vite.config.ts:globIgnores` |
| Worker pool exhaustion | PriorityTaskQueue with MAX_QUEUE_SIZE=32 | `packages/worker-bus/src/taskQueue.ts` |
| Infinite AI retry loops | Exponential backoff with cap (30s) | `services/ai/aiRetry.ts` |
| Malicious plugin CPU burn | Worker isolation with timeout | `workers/plugin.worker.ts` (P0-2) |

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

### CSP connect-src: web-vs-Tauri asymmetry (ADR-0004)

The web PWA's `connect-src` intentionally allows the `https:` scheme-source because the shipped BYOK
feature `openAiCompatibleBaseUrl` (Settings → AI → custom base URL) lets users target arbitrary
self-hosted/third-party OpenAI-compatible proxies that cannot be statically enumerated in a `<meta>`
CSP. The redundant explicit cloud-provider entries were removed (they changed nothing under `https:`
and implied a hardening the policy did not provide). **Residual risk:** a `fetch` driven in the web
PWA (e.g. via AI prompt injection) can reach any HTTPS origin. Mitigations: no secrets in
`connect-src`-reachable globals; keys encrypted at rest and only attached to the user's chosen
provider request; AI output never `eval`'d; host HTTP-header CSP tightens production further.
`http:`/`ws:` scheme-wildcards remain disallowed (cleartext exfiltration blocked). The native **Tauri**
CSP stays strict (no `https:`). Closing this fully = build-time CSP generation (Option C, v2.0).
Regression test: `tests/unit/csp.test.ts`.

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
- [ ] DuckDB OPFS encrypted (P0-4) — encryption module + unit tests exist (`services/duckdb/duckdbEncryption.ts`), but it is **not wired** into the persistence path (0 production callers), so DuckDB analytics are not encrypted at rest. Integration pending.
- [x] Voice WASM download UX (P0-5) — `components/voice/VoiceModelDownloadModal.tsx`

## References

- OWASP 2024 Password Storage Guidelines
- NIST SP 800-63B Digital Identity Guidelines
- CWE-200: Exposure of Sensitive Information
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection (N/A - no SQL backend)