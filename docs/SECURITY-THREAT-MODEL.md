# Security Threat Model

**Version:** 1.0.0  
**Date:** 2026-06-05  
**Status:** v1.19.0 baseline

This document provides a formal STRIDE threat analysis for StoryCraft Studio, mapping threats to mitigations and code locations.

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
| DuckDB analytics unencrypted | OPFS encryption (planned) | `services/duckdb/duckdbEncryption.ts` (P0-4) |
| Prompt injection exposing context | Prompt sanitization | `services/ai/ragPromptAssembly.ts:sanitizePromptBlock()` |

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
└─ OR: Plugin-generated prompts
   └─ Mitigation: Plugin sandboxed API, no direct prompt access
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
| `tauri.conf.json` | I | CSP with explicit connect-src | ✅ Complete |

## Security Checklist

- [x] PBKDF2 iterations ≥ 600,000 (OWASP 2024 minimum)
- [x] CryptoKey extractable = false everywhere
- [x] IV uniqueness per operation (random 12-byte)
- [x] No API keys in localStorage/sessionStorage
- [x] No console.log of sensitive data
- [x] CSP restricts connect-src to known hosts
- [x] Collaboration requires password in production
- [x] Plugin system permission-gated
- [x] Plugin system Worker-isolated (P0-2) — `workers/plugin.worker.ts`
- [x] DuckDB OPFS encrypted (P0-4) — `services/duckdb/duckdbEncryption.ts`
- [x] Voice WASM download UX (P0-5) — `components/voice/VoiceModelDownloadModal.tsx`

## References

- OWASP 2024 Password Storage Guidelines
- NIST SP 800-63B Digital Identity Guidelines
- CWE-200: Exposure of Sensitive Information
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection (N/A - no SQL backend)