# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` (v1.19.0) | ✅ Full support |
| `1.3.x – 1.18.x` | ⚠️ Best effort (upgrade strongly recommended) |
| `< 1.3.0` | ❌ Not supported |

Maintainer-facing documentation (CI, contributing, architecture) is indexed in [`README.md`](README.md#-documentation-hub) and enumerated in [`AUDIT.md`](AUDIT.md).

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use one of these private channels instead:

1. Preferred: GitHub Private Vulnerability Reporting (Security Advisories)
   - URL: https://github.com/qnbs/WorldScript-Studio/security/advisories/new
2. Encrypted email (fallback): maintainers may publish a dedicated address in organization docs; until then, **use GitHub Private Vulnerability Reporting only**.

If the email channel is not configured, use GitHub Private Vulnerability Reporting.

## Disclosure and Embargo Policy

- We target an initial maintainer response within 72 hours.
- We follow a default 90-day coordinated disclosure embargo, starting from first private report receipt.
- During the embargo, we work on triage, patching, validation, and release coordination.
- The embargo may be shortened for actively exploited issues or extended by mutual agreement when required for safe remediation.
- After a fix is released (or the embargo expires), we publish a public advisory with impact, affected versions, and mitigation details.

## Known Active Security Work Items

Phase 0 and Phase 2 hardening complete as of v1.19.0; the Phase 3 plugin-isolation (SEC-7) and
voice-download-UX (SEC-8) items shipped in v1.21–v1.23. The only remaining at-rest gap is SEC-6
(DuckDB OPFS encryption), whose module exists but is not yet wired into the persistence path:

| ID | Area | Description | Status |
| --- | --- | --- | --- |
| SEC-1 | Collaboration | Mandatory password enforcement — `CollabEncryptionRequiredError` thrown in `collaborationService.ts` when no password is provided in production | ✅ Complete (Phase 0) |
| SEC-2 | Documentation | Updated security policy, version table, scope, and active-item tracking | ✅ Complete (Phase 0) |
| SEC-3 | Storage | IDB at-rest encryption — `services/storage/storageEncryptionService.ts`, AES-256-GCM, PBKDF2 600k iter; `enableIdbAtRestEncryption` flag (on by default since v1.23) | ✅ Implemented (Phase 2 / B-1) |
| SEC-4 | Voice | Web Speech API consent gate — GDPR Art. 13 disclosure and explicit opt-in before audio is routed to cloud STT providers | ✅ Complete (Phase 0) |
| SEC-5 | Storage | IDB at-rest encryption UX — passphrase unlock modal, forgot-passphrase export flow, key rotation UI | ✅ Complete (2026-06-02) |
| SEC-6 | Storage | DuckDB OPFS at-rest encryption — WAL and data files outside IDB; requires separate encryption layer | 🟡 Partial (P0-4) — encryption module + unit tests exist (`services/duckdb/duckdbEncryption.ts`), but it is **not yet wired into the DuckDB persistence path** (0 production callers as of v1.23.1), so DuckDB analytics are **not** encrypted at rest. Integration pending. |
| SEC-7 | Plugin System | Worker isolation for plugin execution — prevent main-thread access, enforce timeouts | ✅ Complete (P0-2) — plugin execution routed to an isolated worker (`workers/plugin.worker.ts`) via `pluginRegistry.ts` + `workerBusManager.ts`, sandboxed API + timeout; adversarial tests in `tests/unit/workers/plugin.worker.test.ts`. Follow-up FU-1: full timeout/abort coupling for dynamic `import()` + sync loops (low impact). |
| SEC-8 | Voice | WASM model download UX — progress feedback, cancel/retry controls for Whisper/Kokoro models | ✅ Complete (P0-5) — `components/voice/VoiceModelDownloadModal.tsx` (progress, cancel, retry), wired from `components/settings/VoiceSettingsSection.tsx`; driven by `VoiceCommandService.downloadVoiceModels(type, signal?)`. |
| SEC-9 | ProForge / Copilot | Prompt-injection hardening — reject C0 control chars, null bytes, lone surrogates in AI-proposed edits; per-item graceful skip instead of batch abort | ✅ Complete (PR #114) |
| SEC-10 | Plugin System | Storage key isolation hardening — length limit, allowed-character suffix validation, anti-traversal (`..`), value size cap | ✅ Complete (PR #114) |

## Threat Model

A formal STRIDE threat analysis with attack trees and mitigation mappings is documented in [`docs/SECURITY-THREAT-MODEL.md`](docs/SECURITY-THREAT-MODEL.md).

## Scope

This includes vulnerabilities involving:

- **API key handling and storage** — encrypted AES-256-GCM via IndexedDB (`dbService.ts`); never `localStorage` or `sessionStorage`
- **Collaboration E2E encryption** — signaling-channel and RTCDataChannel in-flight encryption (`collaborationService.ts`, `packages/collab-transport` vendor fork); PBKDF2 600,000 iterations, SHA-256, deterministic salt from `projectId`
- **IndexedDB at-rest privacy** — passphrase-derived AES-256-GCM encryption implemented in `services/storage/storageEncryptionService.ts` (v1.19.0, B-1); migration path via `dbMigration.ts`
- **Voice STT routing** — Web Speech API routes raw audio to Google/Microsoft servers; GDPR Art. 13 consent required before first use
- **WebCrypto correctness** — IV uniqueness per operation, GCM authentication tag verification, PBKDF2 iteration count, non-extractable `CryptoKey` handles
- **Yjs CRDT transport integrity** — in-flight data must be encrypted end-to-end; any new CRDT or transport layer must not bypass the existing encryption contract
- **Authentication/authorization bypass risks**
- **Data leakage or privacy violations**
- **Remote code execution, XSS, injection, or sandbox escape**
- **Supply-chain compromise in build/release workflows**
