# IndexedDB At-Rest Encryption — Architecture Design

**Status:** Phase 0 design — implementation deferred to Phase 2  
**Tracking:** SEC-3 (Master Plan Phase 0 hardening)

---

## Overview

StoryCraft Studio stores all project data in IndexedDB. Currently, API keys are encrypted at rest via `dbService.ts` using AES-256-GCM with a locally-generated `CryptoKey`. All other stores (manuscripts, settings, snapshots, RAG vectors, codex) are stored in plaintext.

This document describes the design for extending at-rest encryption to all IDB stores using a passphrase-derived key, protecting data against offline extraction (e.g. from a shared or compromised browser profile).

---

## Threat Model

| Threat | Addressed |
| --- | --- |
| Physical access to browser profile directory | ✅ Encrypted blobs unreadable without passphrase |
| Malicious browser extension reading IDB | ✅ Same — ciphertext only |
| XSS reading IDB via `indexedDB.open()` | ✅ — content cannot be decrypted without the in-memory key |
| Man-in-the-middle on sync / export | Out of scope (handled by transport layer) |
| User forgets passphrase | ⚠️ Data loss — deliberate UX tradeoff |

This design does **not** protect against an attacker who can execute arbitrary code in the page's origin (e.g. a full XSS compromise), since the `CryptoKey` is held in memory during the session.

---

## Key Derivation

```
passphrase (UTF-8)
    │
    ▼
PBKDF2(SHA-256, salt=appSalt, iterations=310,000)
    │
    ▼
AES-256-GCM CryptoKey  { extractable: false, usages: ['encrypt','decrypt','wrapKey','unwrapKey'] }
```

### Parameters

| Parameter | Value | Rationale |
| --- | --- | --- |
| KDF | PBKDF2 | WebCrypto native; no WASM dependency |
| Hash | SHA-256 | OWASP 2024 minimum |
| Iterations | 310,000 | Matches collaboration PBKDF2 budget (`collaborationService.ts`) |
| Salt | 32-byte random, stored in IDB `app-data` store as `idb_kdf_salt_v1` | Random per-install; must not be derived from passphrase |
| Key output | AES-GCM 256-bit | Authenticated encryption — GCM tag detects corruption |
| `extractable` | `false` | Key cannot be exported from WebCrypto context |

### Salt storage

The salt is a 32-byte random value generated on first initialization:
```ts
const salt = crypto.getRandomValues(new Uint8Array(32));
// stored as: APP_DATA_STORE / 'idb_kdf_salt_v1'  (plaintext — public by design)
```

The salt is **not** secret. Its purpose is to prevent cross-device rainbow-table attacks. It is stored alongside the encrypted data.

---

## Encryption Per Store

Encryption is applied at the **value** level — store keys remain plaintext to allow `IDBKeyRange` queries to continue working.

### Data flow (write)

```
Redux state / blob
    │
    ▼  LZ-String compression (> 10 KB threshold — existing behavior)
    │
    ▼  AES-256-GCM encrypt(key, random 12-byte IV, plaintext)
    │
    ▼  [ IV (12 bytes) || ciphertext || GCM tag (16 bytes) ] → Uint8Array
    │
    ▼  stored in IDB
```

### Data flow (read)

```
Uint8Array from IDB
    │
    ▼  split: IV[0..12], ciphertext[12..]
    │
    ▼  AES-256-GCM decrypt(key, IV, ciphertext)   — GCM tag verified before any data returned
    │
    ▼  LZ-String decompress (if \x00lz1\x00 prefix detected)
    │
    ▼  JSON.parse → typed value
```

### Failure behavior

- **Wrong passphrase / corrupted data:** `crypto.subtle.decrypt` rejects. The app surfaces a toast ("Unable to decrypt project data — check your storage passphrase") and does **not** attempt to return partial plaintext.
- **GCM tag mismatch:** Same path — rejection surfaces as a user-visible error, never silently ignored.

---

## Stores to Encrypt

| Store | DB | Priority | Notes |
| --- | --- | --- | --- |
| `app-data` | `storycraft-state-db` | P1 | Contains Redux state including settings |
| `storycraft-snapshots` | `storycraft-state-db` | P1 | Manuscript snapshots |
| `storycraft-data-images` | `storycraft-data-db` | P2 | Binary blobs |
| `storycraft-rag-vectors` | `storycraft-data-db` | P2 | Float32 embeddings |
| `storycraft-codex` | `storycraft-data-db` | P3 | Extracted entities |
| `storycraft-binder-assets` | `storycraft-data-db` | P3 | Binder attachments |

Stores `proforge-memory-bank`, `scene-revisions`, `cross-project-index` are in separate IDB databases; Phase 2 will encrypt them using the same derived key via a shared `idbEncrypt` / `idbDecrypt` helper.

---

## API Shape (planned)

```ts
// services/idbEncryptionService.ts  (new file — Phase 2)

export async function initIdbEncryption(passphrase: string): Promise<void>
// Derives CryptoKey, stores in module-level singleton. Throws if passphrase is empty.

export async function idbEncrypt(plaintext: unknown): Promise<Uint8Array>
// Compress → encrypt → prepend IV → return Uint8Array

export async function idbDecrypt<T>(ciphertext: Uint8Array): Promise<T>
// Verify GCM tag → decrypt → decompress → parse → return typed T

export function isIdbEncryptionReady(): boolean
// Returns true once initIdbEncryption() has resolved successfully
```

`dbService.ts` will call `idbEncrypt` / `idbDecrypt` in place of the existing raw `JSON.stringify` / `JSON.parse` paths after a feature-flag check:

```ts
featureFlags.enableIdbAtRestEncryption  // new flag, off by default
```

---

## Tauri Desktop Layer

On Tauri, the passphrase is managed by **`tauri-plugin-stronghold`** (OS keychain / TPM-backed KMS):

1. On first launch: generate a 256-bit random passphrase, store in Stronghold.
2. On subsequent launches: retrieve passphrase from Stronghold, derive `CryptoKey`.
3. The user never sees or types the passphrase — Stronghold provides OS-level protection.

This means:
- Web build: passphrase entered by user at app open (unlock screen, similar to KeePass).
- Tauri build: transparent, OS-protected — no user friction.

Plugin requirement: `pnpm add @tauri-apps/plugin-stronghold` + `src-tauri/Cargo.toml` entry.

---

## Migration Path

At-rest encryption is a breaking change to the IDB schema. Migration proceeds via `dbMigration.ts`:

1. **DB version bump:** `DB_VERSION` in `dbConstants.ts` incremented (current: see `DB_VERSION` constant).
2. **`onupgradeneeded` handler:** Reads all existing plaintext records, encrypts each with the derived key, writes back. Transaction rolls back on any failure — app surfaces "migration failed" with retry.
3. **Forward compat:** Records without the IV prefix (`\x00enc1\x00` sentinel, distinct from `\x00lz1\x00`) are treated as legacy plaintext and migrated lazily on first read (write-back encrypted copy).
4. **Rollback:** Not supported — downgrading to a pre-encryption build will fail to read encrypted stores. Release notes must warn about this.

### Migration sentinel

```
byte 0..4:  '\x00enc1\x00'   (6 bytes, distinct from LZ prefix '\x00lz1\x00')
byte 6..17: IV (12 bytes)
byte 18..:  AES-GCM ciphertext + 16-byte GCM tag
```

`decompressData()` in `dbService.ts` already handles the `\x00lz1\x00` sentinel — the same dispatch pattern extends to `\x00enc1\x00`.

---

## Open Questions (Phase 2 planning)

1. **Web UX for passphrase entry:** unlock modal at app init vs. per-operation prompt. Recommendation: unlock modal on cold start with session-scoped in-memory key (key wiped on tab close / `visibilitychange` to `hidden`).
2. **Forgot passphrase flow:** emergency export of unencrypted data while key is still known, or complete data loss. Needs explicit UX decision.
3. **Multi-tab coordination:** all tabs must use the same derived key. `BroadcastChannel` can signal "passphrase unlocked" to sibling tabs; key itself stays per-tab in WebCrypto (non-extractable — cannot be transferred).
4. **Key rotation:** change passphrase → re-derive key → re-encrypt all stores in one transaction. Expensive for large vaults; show progress spinner.
5. **DuckDB OPFS:** DuckDB WAL and data files are outside IDB. Phase 3 consideration.

---

## References

- `services/dbService.ts` — existing IDB layer with LZ-String + AES-256-GCM API key path
- `services/dbMigration.ts` — existing schema migration infrastructure
- `services/dbConstants.ts` — `DB_VERSION`, store name constants
- `services/collaborationService.ts` — reference PBKDF2 implementation (310,000 iterations, SHA-256)
- `services/libraryBackupService.ts` — AES-GCM export path (export/import pattern reference)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — PBKDF2 iteration guidance
