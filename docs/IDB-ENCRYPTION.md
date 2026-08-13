# IndexedDB At-Rest Encryption — Implementation

**Status:** Complete. Fail-closed locked writes, a durable cross-database migration journal, and production disable/rekey wiring (Phase 4, issue #338) all ship. Interrupted migrations are resumable via a dedicated recovery UX. Remaining: E2E test coverage for the disable/rotate/recovery round trips (unit + component tests only so far).
**Feature flag:** `enableIdbAtRestEncryption` (on by default since v1.23 — manage via Settings → Privacy)
**Tracking:** SEC-3 (Master Plan Phase 2 delivery); Phase 4 production wiring: issue #338

---

## Overview

WorldScript Studio stores project data in IndexedDB. API keys use a separate encrypted-secret mechanism in `dbService.ts`. Optional IDB at-rest encryption uses a passphrase-derived AES-256-GCM key for the primary project, settings, snapshot, image, Codex, RAG, and binder-asset persistence paths. Other persistence surfaces must be inventoried and integrated through the same policy before a blanket “all IndexedDB data” claim is valid.

The encryption service is gated behind `featureFlags.enableIdbAtRestEncryption` (on by default since v1.23 — manage in Settings → Privacy → "Encrypt project data at rest"):
- `IdbUnlockModal` — prompts for passphrase on cold start when flag is on; rate-limiting: 3 failures → 5 s lockout, 6 failures → 30 s lockout
- **Session lock** — `lockSession()` clears the in-memory key; "Lock Session" button in Settings → Privacy
- **Locked writes fail closed** — when a passphrase sentinel exists but no runtime key is available, protected reads and writes return a typed locked error rather than storing plaintext.
- **Disable and passphrase rotation** — `PassphraseModal`'s `'disable'`/`'rotate'` modes drive `clearIdbPassphrase()`/`rotateIdbPassphrase()`, which run a full journal-backed migration (`services/storage/encryptionMigrationOrchestrator.ts`) across every primary and secondary protected store, verify it, and only then touch the passphrase sentinel. A live progress bar shows per-store migration/verification progress.
- **Cross-tab write admission** — `services/storage/protectedWriteAdmission.ts` (Web Locks API) admits ordinary protected writes/deletes in shared mode and migration batches in exclusive mode, closing the write-vs-migration TOCTOU race a standalone journal read alone could not.
- **Interrupted-migration recovery** — if a disable/rotate migration is interrupted (reload/crash) before reaching `'completed'`, `EncryptionRecoveryModal` (App.tsx startup guard, takes priority over `IdbUnlockModal`) lets the user re-enter their passphrase(s) to resume via `resumeEncryptionMigration()`. A `'recovery-required'` journal (the migration's own verification found an inconsistency) is surfaced as a distinct, honest stuck state requiring manual/support recovery — never auto-fixed.

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

export async function clearIdbPassphrase(onProgress?: ProtectedStoreMigrationProgressCallback): Promise<void>
// Disable: journal-backed migration decrypts every protected store with the active key, verifies it,
// then deletes the sentinel + KDF salt and clears the session key. Requires an already-unlocked session.

export async function rotateIdbPassphrase(oldPassphrase: string, newPassphrase: string, onProgress?: ProtectedStoreMigrationProgressCallback): Promise<void>
// Rekey: verifies oldPassphrase against the sentinel, derives+authenticates the target key via a
// durable verifier, re-encrypts every protected store, verifies it, then saves the new sentinel.

export async function resumeEncryptionMigration(journal: EncryptionMigrationJournal, input: { sourcePassphrase: string; targetPassphrase?: string }, onProgress?: ProtectedStoreMigrationProgressCallback): Promise<void>
// Recovery UX entry point — re-derives keys from re-entered passphrase(s) and resumes an
// interrupted disable/rekey journal to the same end state as a fresh-start migration.
```

Every protected store writer runs inside `withProtectedWriteAdmission()` (shared-mode Web Lock), so a concurrent migration batch (exclusive-mode lock) can never interleave with an ordinary write. The two call paths differ inside that admission: save paths call `resolveProtectedWriteKey()` to snapshot the write key and lock state atomically, then re-run only `assertNoActiveEncryptionMigration()` immediately before opening the transaction (re-checking the full lock guard here would wrongly reject a write that already captured a valid key before the session locked mid-write); delete paths, which encrypt nothing and so have no key to snapshot, call `assertIdbProtectedWriteAllowed()` directly. Either path rejects a configured-but-locked library before a transaction opens, so it never silently downgrades to plaintext.

---

## Tauri Desktop Layer

**This section previously claimed desktop shares the full encryption lifecycle described above. That was inaccurate — corrected below.**

On the Tauri desktop build, primary project, settings, snapshot, image, Codex, RAG, and binder-asset data is persisted by the filesystem-backed store (`services/fs/*Store.ts`), not IndexedDB. That store writes plaintext (LZ-string compressed only, no encryption) regardless of `enableIdbAtRestEncryption` — every writer is explicitly commented `ENCRYPTION: plaintext`. Enabling the setting on desktop still shows `IdbUnlockModal`/`PassphraseModal` (the passphrase sentinel lives in the WebView's own IndexedDB, which persists on desktop too), but that unlock flow gates nothing on the filesystem side today — only the UI, not the actual manuscript files under `$APPDATA`, is shared with the web build. See `README.md`'s "Encryption — which mechanism protects what" table for the authoritative per-mechanism breakdown. Extending real at-rest protection to the desktop filesystem store is a tracked, open gap — not yet implemented.

The one thing that *is* desktop-specific and already encrypted is per-provider API keys (`services/fs/settingsFsStore.ts`, via `encryptText`/`decryptText` in `services/fs/fsCore.ts`) — but that mechanism has its own, separate weakness: its PBKDF2 passphrase is derived from a string built entirely out of public/discoverable values (the app-data path, the provider name, and hardcoded constants), not a real secret. Anyone with filesystem read access to the encrypted key file — the exact threat model at-rest encryption exists to defend against — can reconstruct the same derivation and decrypt it. This is also a tracked, open gap, independent from the project-data gap above; do not treat the presence of `encryptText`/`decryptText` as evidence that desktop API keys are meaningfully protected today. **"Per-provider" excludes Gemini**: `components/ApiKeySection.tsx` never adopted the `storageService`/`FsSettingsStore` path at all — it still reads/writes the Gemini key directly through `dbService` (the browser IndexedDB store), even when running on desktop. `services/geminiService.ts` reads the key through `storageService`, which resolves to the filesystem backend on desktop — so a Gemini key saved via Settings → AI on desktop is written to a location `geminiService.ts` never looks in. This is a functional bug, not a security one; tracked in [#358](https://github.com/qnbs/WorldScript-Studio/issues/358), independent of the two gaps above.

The repository does **not** currently use `tauri-plugin-stronghold`, an OS keychain, or a transparent desktop-only passphrase store.

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

1. **Multi-tab coordination:** the migration journal's single-owner lease (`claimEncryptionMigrationOwnership`) and `protectedWriteAdmission.ts`'s exclusive-mode Web Lock coordinate a migration against ordinary writers *within* the current tab set, but a non-extractable `CryptoKey` still cannot be transferred to another tab — a second tab that opens mid-migration must re-derive its own key from a re-entered passphrase (same as `EncryptionRecoveryModal`) rather than receiving one via `BroadcastChannel`.
2. **`'recovery-required'` manual recovery:** when the migration's own verification finds an inconsistency, the journal is deliberately left stuck (no automatic retry, no automatic data reconciliation) — `EncryptionRecoveryModal` surfaces this honestly but does not resolve it. A dedicated manual-recovery procedure (support-assisted) is out of scope for Phase 4.
3. **DuckDB OPFS:** DuckDB WAL and data files are outside IDB and outside the Phase 4 migration's scope. A separate encryption layer requires its own threat model and recovery protocol.
4. **E2E coverage:** the disable/rotate/recovery flows currently have unit + component test coverage (`tests/unit/storage/storageEncryptionService.test.ts`, `tests/unit/settings/PassphraseModal.test.tsx`, `tests/unit/settings/EncryptionRecoveryModal.test.tsx`) but no Playwright E2E round trip yet.

---

## References

- `services/storage/storageEncryptionService.ts` — **implemented service** (v1.19.0, B-1; Phase 4 disable/rotate/resume)
- `services/storage/encryptionMigrationJournal.ts` — durable cross-database journal, single-owner lease, legal phase transitions
- `services/storage/protectedStoreMigration.ts` — journal-owned adapter execution protocol + progress callback
- `services/storage/protectedWriteAdmission.ts` — Web Locks–based cross-tab admission (shared writers vs. exclusive migration batches)
- `services/storage/primaryProtectedStoreAdapter.ts` / `primaryProtectedStoreAdapters.ts` — explicit-key/inline-keyPath adapter engine + the 5 generic-engine primary-store specs
- `services/storage/ragVectorsProtectedStoreAdapter.ts` — bespoke per-project RAG-vector adapter (aggregate ↔ individual-record duality)
- `services/storage/secondaryPayloadStoreAdapter.ts` / `secondaryProtectedStoreAdapters.ts` — pre-existing secondary-store adapters (scene revisions, inference cache)
- `services/storage/encryptionMigrationOrchestrator.ts` — combines primary + secondary adapters into one production migration run
- `components/settings/PassphraseModal.tsx` / `EncryptionRecoveryModal.tsx` — set/unlock/disable/rotate UI + interrupted-migration recovery UX
- `services/storage/idbCore.ts` — IDB lifecycle; calls `encryptForStorage`/`decryptFromStorage` when flag is on
- `services/storage/` (barrel) — `idbProjectStore`, `idbSnapshotStore`, `idbKeyStore`, `idbCodexStore`, `idbAssetStore`
- `services/dbMigration.ts` — existing schema migration infrastructure
- `services/dbConstants.ts` — `DB_VERSION`, store name constants
- `services/collaborationService.ts` — reference PBKDF2 implementation (310,000 iterations, SHA-256)
- `services/libraryBackupService.ts` — AES-GCM export path (export/import pattern reference)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) — PBKDF2 iteration guidance
