# IndexedDB At-Rest Encryption

**Status:** Implemented for primary project storage and content-bearing secondary IndexedDB records

**Feature flag:** `enableIdbAtRestEncryption` (on by default; Settings → Privacy)

**Cryptography:** AES-256-GCM; PBKDF2-HMAC-SHA-256 with 600,000 iterations

## Security boundary

WorldScript Studio can encrypt manuscript-derived data stored in IndexedDB. The encryption key is
derived from a user passphrase, remains non-extractable, and is held only in memory for the unlocked
session. A persisted encrypted verifier checks the passphrase without storing it.

The boundary protects against offline inspection of a browser profile and direct extraction of
IndexedDB files while the application is locked. It does not protect against arbitrary code already
executing in the unlocked application origin, because that code can ask the running application to
decrypt data.

Two documented exceptions remain:

- DuckDB-WASM structural analytics metadata remains plaintext in its OPFS database. Literal
  manuscript excerpts in `codex_mentions` are cell-level encrypted when at-rest encryption is
  enabled. See `docs/SECURITY-THREAT-MODEL.md`.
- Large LoRA weight blobs remain outside the manuscript-data encryption guarantee. LoRA adapter
  metadata, dataset instruction/input/output records, and training-run details are encrypted.

## Key lifecycle

```text
passphrase (UTF-8)
    │
    ▼
PBKDF2-HMAC-SHA-256
salt: 32 random bytes per installation
iterations: 600,000
    │
    ▼
AES-256-GCM CryptoKey
extractable: false; usages: encrypt/decrypt
```

The non-secret salt is stored in `localStorage` under
`worldscript-idb-kdf-salt-v1`. The encrypted passphrase verifier is stored in IndexedDB under
`idb_passphrase_sentinel_v1`. AES-GCM authentication rejects a wrong passphrase or modified
ciphertext before any plaintext is returned.

Web users unlock with their passphrase after a cold start. `lockSession()` clears the in-memory key.
The Settings passphrase flow supports setup, unlock, change, and disable operations.

## Storage formats

### Primary project stores

Primary app data and snapshots use the byte format produced by `StorageEncryptionService`:

```text
\x00enc1\x00 (6 bytes) || random IV (12 bytes) || AES-GCM ciphertext and tag
```

Reads accept legacy compressed/plain values for backwards compatibility. Encrypted values without
an active key fail instead of being interpreted as plaintext.

Primary coverage includes:

| Database | Store or data class | Sensitive content |
| --- | --- | --- |
| `worldscript-state-db` | app data | project state and settings |
| `worldscript-state-db` | snapshots | manuscript snapshots |
| `worldscript-data-db` | binder/image assets | attachment metadata and bytes |
| `worldscript-data-db` | codex/RAG records | extracted entities and local vectors |

### Secondary databases

Secondary services retain only routing fields required for keys and indexes. Their sensitive payload
uses a structured-clone-safe envelope:

```ts
interface SecureRecordEnvelope {
  version: 1;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}
```

The shared `prepareSecureRecordPayload()` and `readSecureRecordPayload()` helpers enforce these
rules:

- configured encryption plus no active key rejects reads and writes with
  `SecureRecordLockedError`; it never silently downgrades to plaintext;
- malformed, unsupported, or unauthenticated envelopes reject with
  `SecureRecordCorruptError`;
- legacy plaintext remains readable after a successful unlock and is rewritten lazily as an
  encrypted envelope;
- encryption/decryption finishes outside live IndexedDB transactions so WebCrypto awaits cannot
  cause transaction inactivity or partial writes.

| Service/database | Plaintext routing fields | Encrypted payload |
| --- | --- | --- |
| Scene revisions | revision ID, scene ID, timestamp, version | title and manuscript content |
| AI inference cache | cache key, expiry/access timestamps | generated result |
| ProForge memory bank | record/project/section IDs, category, timestamp | remembered content and scoring details |
| ProForge history | project ID, timestamp | pipeline run history |
| Cross-project index | project ID, index timestamp | title, logline, names, summary, word count, embedding |
| LoRA adapter metadata | adapter/project IDs, creation timestamp | name, description, model/path/quality metadata |
| LoRA datasets | entry/project IDs, source, creation timestamp | instruction, input, output, scores/counts |
| LoRA training runs | run/project IDs, status, timestamps | model/preset, progress, loss history, output/error details |

Raw-record canary tests assert that known manuscript, prompt/result, descriptive metadata, and LoRA
content strings do not appear in fake IndexedDB storage while encryption is enabled. Tests also
cover locked access, authentication corruption, encrypted round trips, and lazy legacy migration.

## Passphrase rotation

The Settings flow verifies the old passphrase, derives the new key, and re-encrypts primary
app-data, snapshot records, and all secondary secure-record databases via
`reEncryptAllSecondaryStores()`. Disabling encryption first decrypts secondary stores to plaintext
via `decryptAllSecondaryStoresToPlaintext()` so envelopes are not stranded after the sentinel is
removed.

This operation is not atomic across independent IndexedDB databases. Codex, RAG vectors, images,
and binder assets in the primary data DB are still re-encrypted on the next natural write. The
durable rotation journal described below remains future hardening for crash recovery across every
store.

## Failure and recovery behavior

- A wrong passphrase fails verification through the AES-GCM authentication tag.
- A locked secondary store returns a typed locked error; it does not return partial fields.
- A corrupt envelope returns a typed corrupt error without including plaintext or key material.
- Losing the passphrase means encrypted data cannot be recovered. The application offers a guarded
  reset path, but resetting deletes the inaccessible local library.
- Disabling encryption must verify the current passphrase. Existing encrypted records must not be
  made unreadable by merely clearing the feature flag.

## Implementation references

- `services/storage/storageEncryptionService.ts` — key derivation, primary blob format, secondary
  record envelope, locked/corrupt errors, sentinel-backed lifecycle
- `services/storage/idbPassphraseSentinel.ts` — encrypted verifier persistence
- `services/storage/idbProjectStore.ts` and `idbSnapshotStore.ts` — primary storage integration
- `services/sceneRevisionService.ts`
- `services/ai/aiInferenceCacheService.ts`
- `services/proForge/proForgeMemoryBank.ts` and `proForgeHistoryStore.ts`
- `services/crossProjectIndexService.ts`
- `services/loraAdapterService.ts`
- `services/duckdb/duckdbEncryption.ts` — accepted DuckDB cell-level exception handling

## Remaining work

1. Implement and test the resumable cross-database passphrase-rotation journal described above.
2. Reconcile stale plaintext comments in individual primary-store modules with their actual secure
   read/write behavior.
3. Keep DuckDB structural metadata and LoRA weight-blob exceptions visible in Settings, security
   documentation, and release notes.
