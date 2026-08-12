# IndexedDB At-Rest Encryption — Implementation

**Status:** Partial implementation with fail-closed locked writes and a durable migration-journal foundation. Cross-database enable, disable, and rekey conversion/recovery remain a release-blocking follow-up.
**Feature flag:** `enableIdbAtRestEncryption` (on by default since v1.23 — manage via Settings → Privacy)
**Tracking:** SEC-3 (Master Plan Phase 2 delivery)

---

## Overview

WorldScript Studio stores project data in IndexedDB. API keys use a separate encrypted-secret mechanism in `dbService.ts`. Optional IDB at-rest encryption uses a passphrase-derived AES-256-GCM key for the primary project, settings, snapshot, image, Codex, RAG, and binder-asset persistence paths. Other persistence surfaces must be inventoried and integrated through the same policy before a blanket “all IndexedDB data” claim is valid.

The encryption service is gated behind `featureFlags.enableIdbAtRestEncryption` (on by default since v1.23 — manage in Settings → Privacy → "Encrypt project data at rest"). Current lifecycle behavior is deliberately conservative:
- `IdbUnlockModal` — prompts for passphrase on cold start when flag is on; rate-limiting: 3 failures → 5 s lockout, 6 failures → 30 s lockout
- **Session lock** — `lockSession()` clears the in-memory key; "Lock Session" button in Settings → Privacy
- **Locked writes fail closed** — when a passphrase sentinel exists but no runtime key is available, protected reads and writes return a typed locked error rather than storing plaintext.
- **Disable and passphrase rotation are unavailable** until a versioned, resumable cross-database journal verifies every conversion. The UI does not expose those destructive controls and the service rejects them before mutation.

**Required next step:** implement per-store conversion/checkpointing, multi-tab coordination, and verified enable/disable/rekey recovery before enabling lifecycle operations. The journal currently blocks a second migration owner and ordinary protected access while active; it does not yet convert records.

The authoritative lifecycle states, transition rules, and journal requirements are in [ADR 0018](adr/0018-idb-encryption-lifecycle-and-recovery.md).

---

## Threat Model

| Threat | Addressed |
| --- | --- |
| Physical access to browser profile directory | ✅ Encrypted blobs unreadable without passphrase |
| Malicious browser extension reading IDB | ✅ Same — ciphertext only |
| XSS in an unlocked renderer | ❌ Out of scope — an attacker executing in the app origin can use the in-memory key through application APIs |
| Man-in-the-middle on sync / export | Out of scope (handled by transport layer) |
| User forgets passphrase | ⚠️ Data loss — deliberate UX tradeoff |

This design does **not** protect against an attacker who can execute arbitrary code in the page's origin (e.g. a full XSS compromise), since the `CryptoKey` is held in memory during the session.

---

## Key Derivation

```
passphrase (UTF-8)
    │
    ▼
PBKDF2(SHA-256, salt=appSalt, iterations=600,000)
    │
    ▼
AES-256-GCM CryptoKey  { extractable: false, usages: ['encrypt','decrypt','wrapKey','unwrapKey'] }
```

### Parameters

| Parameter | Value | Rationale |
| --- | --- | --- |
| KDF | PBKDF2 | WebCrypto native; no WASM dependency |
| Hash | SHA-256 | OWASP 2024 minimum |
| Iterations | 600,000 | Current `storageEncryptionService.ts` PBKDF2-HMAC-SHA-256 setting |
| Salt | 32-byte random, stored in localStorage as `worldscript-idb-kdf-salt-v1` | Random per-install; setup fails if it cannot be persisted; a missing/invalid salt after a passphrase sentinel already exists fails closed with `IdbEncryptionSaltLostError` instead of silently deriving a new, incompatible key |
| Key output | AES-GCM 256-bit | Authenticated encryption — GCM tag detects corruption |
| `extractable` | `false` | Key cannot be exported from WebCrypto context |

### Salt storage

The salt is a 32-byte random value generated on first initialization:
```ts
const salt = crypto.getRandomValues(new Uint8Array(32));
// stored as: localStorage['worldscript-idb-kdf-salt-v1']  (plaintext — public by design)
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
| `app-data` | `worldscript-state-db` | P1 | Contains Redux state including settings |
| `worldscript-snapshots` | `worldscript-state-db` | P1 | Manuscript snapshots |
| `worldscript-data-images` | `worldscript-data-db` | P2 | Binary blobs |
| `worldscript-rag-vectors` | `worldscript-data-db` | P2 | Float32 embeddings |
| `worldscript-codex` | `worldscript-data-db` | P3 | Extracted entities |
| `worldscript-binder-assets` | `worldscript-data-db` | P3 | Binder attachments |

Stores `proforge-memory-bank`, `scene-revisions`, `cross-project-index` are in separate IDB databases; Phase 2 will encrypt them using the same derived key via a shared `idbEncrypt` / `idbDecrypt` helper.

---

## Implemented API

```ts
// services/storage/storageEncryptionService.ts  (v1.19.0, B-1)

export async function setupIdbEncryption(passphrase: string): Promise<void>
// Derives a non-extractable CryptoKey, persists an encrypted verifier, then activates the in-memory key.

export async function idbEncrypt(plaintext: unknown): Promise<Uint8Array>
// JSON.stringify → LZ-String compress (> 10 KB) → AES-256-GCM encrypt → [ IV || ciphertext ] Uint8Array

export async function idbReadSecure<T>(ciphertext: Uint8Array | unknown): Promise<T>
// Split IV[0..12] + ciphertext[12..] → AES-256-GCM decrypt (GCM tag verified) → decompress → JSON.parse → T

export function isIdbEncryptionReady(): boolean
// Returns true once initStorageEncryption() has resolved successfully
```

Protected store writers call `assertIdbProtectedWriteAllowed()` before they open an IndexedDB write transaction. A configured but locked library therefore does not silently downgrade to plaintext.

---

## Tauri Desktop Layer

Tauri uses the same WebView storage encryption lifecycle as the web build. The repository does **not** currently use `tauri-plugin-stronghold`, an OS keychain, or a transparent desktop-only passphrase store. Desktop users enter the passphrase through the same unlock flow and receive the same locked-write guarantees.

---

## Migration Path

At-rest encryption is a breaking change to the IDB schema. Migration proceeds via `dbMigration.ts`:

1. Existing plaintext records are readable only after unlock and may be encrypted when rewritten.
2. The application must not claim complete library encryption until a verified full-store migration exists.
3. A future migration must be journaled across databases; IndexedDB cannot make the current multi-database conversion atomic.
4. Old writers must be blocked or coordinated during a future migration; rollback of code is not automatically rollback of data.

### Migration sentinel

```
byte 0..4:  '\x00enc1\x00'   (6 bytes, distinct from LZ prefix '\x00lz1\x00')
byte 6..17: IV (12 bytes)
byte 18..:  AES-GCM ciphertext + 16-byte GCM tag
```

`decompressData()` in `dbService.ts` already handles the `\x00lz1\x00` sentinel — the same dispatch pattern extends to `\x00enc1\x00`.

---

## Remaining migration work

1. **Multi-tab coordination:** all tabs must be blocked or coordinated before a future migration begins; a `BroadcastChannel` notification alone cannot transfer a non-extractable key safely.
2. **Disable/rekey:** both are currently blocked rather than risking inaccessible data. A durable journal, checkpoints, generation handling, and recovery UX are required before they are re-enabled.
3. **DuckDB OPFS:** DuckDB WAL and data files are outside IDB. A separate encryption layer requires its own threat model and recovery protocol.

---

## References

- `services/storage/storageEncryptionService.ts` — **implemented service** (v1.19.0, B-1)
- `services/storage/idbCore.ts` — IDB lifecycle; calls `encryptForStorage`/`decryptFromStorage` when flag is on
- `services/storage/` (barrel) — `idbProjectStore`, `idbSnapshotStore`, `idbKeyStore`, `idbCodexStore`, `idbAssetStore`
- `services/dbMigration.ts` — existing schema migration infrastructure
- `services/dbConstants.ts` — `DB_VERSION`, store name constants
- `services/collaborationService.ts` — reference PBKDF2 implementation (310,000 iterations, SHA-256)
- `services/libraryBackupService.ts` — AES-GCM export path (export/import pattern reference)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — PBKDF2 iteration guidance
