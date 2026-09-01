# R-15 Secure Storage Contract

**Issue:** [#445](https://github.com/qnbs/WorldScript-Studio/issues/445)

**Status:** Design admitted; production implementation not started

**Baseline:** `main` at `7ce506ee771f6273e22c08ded049b48955cb40a5`

**Owner:** renderer-neutral Rust Core, with platform adapters for mechanisms

**Scope:** S5 protected-data inventory and secure-envelope architecture only

This is the single S5 source of truth for the later R-15 implementation. It defines security and
durability semantics; it does not switch the current Tauri filesystem authority, migrate user data,
add a crypto dependency, or claim that desktop filesystem data is protected today.

## 1. Current truth and scope boundary

### 1.1 What is true on the baseline

The authoritative desktop backend is the TypeScript/Tauri filesystem store chain:

```text
FsCore
  -> FsSettingsStore
  -> FsCodexStore
  -> FsSnapshotStore
  -> FsAssetStore
  -> FsProjectStore
```

The current desktop filesystem records are compressed or plain JSON/binary data, not R-15
protected records. `services/fs/fsCore.ts#encryptText` and `decryptText` are shared crypto helpers
with no active project-data call sites. `writeTextFileAtomic` and `writeFileAtomic` prevent readers
from observing an incomplete sibling write, but they do not provide the `fsync`/directory-sync
durability promised by R-15.

Provider credentials are a separate case: `storageService` routes them to the random-key
IndexedDB/WebView key store on desktop. `FsSettingsStore` only removes legacy filesystem key
files and refuses new filesystem key writes. This is not native Core authority and must not be
described as desktop filesystem encryption.

The mature IndexedDB encryption path (`services/storage/storageEncryptionService.ts`,
`encryptionMigrationJournal.ts`, `protectedWriteAdmission.ts`) is a design and test reference. It
is a browser/WebView implementation with its own storage authority, envelope, journal, and key
lifecycle. It is not silently promoted to the native filesystem implementation by this document.

The Rust `crates/worldscript-project` package currently owns a partial renderer-neutral project
schema/validation/migration/plain-I/O proof. It deliberately has no encryption, protected-record
authority, durable filesystem replacement, or key provider. The R-15 Core work must build on that
boundary without making Redux, Tauri, React, or Qt the security owner.

### 1.2 S5 does and does not admit

S5 admits:

- the protected-data inventory and classifications below;
- stable logical identities independent of display titles and physical paths;
- an authenticated, versioned envelope with identity-bound AAD;
- explicit key, epoch, read, write, migration, and recovery states;
- durable replacement and crash-resumable migration semantics;
- headless Core/adapter contracts and fault-injection test requirements.

S5 does not admit:

- a production encryption dependency or ciphertext format in the current application;
- automatic encryption of existing plaintext desktop data;
- deletion of legacy plaintext or old key material;
- an OS-keychain promise that the current Tauri layer does not provide;
- a plaintext fallback when secure mode is locked;
- Qt implementation, PWA changes, or closure of #445 or #357/#359/#360/#361.

## 2. Threat model

### 2.1 Protected threats

The later R-15 implementation is intended to reduce the following risks:

| Threat | Required R-15 property |
|---|---|
| Offline theft or copying of the app-data directory | Ciphertext is unreadable without the applicable key epoch. |
| Copying record A over record B | Record class, logical identity, project scope, envelope version, and epoch are authenticated as AAD. |
| Accidental plaintext sibling files | Protected writes use ciphertext-only staging; inventory coverage is an admission gate. |
| Torn or reordered replacement | Write/sync/replace/directory-sync has an explicit durable-success boundary. |
| Wrong key or lost key | Key selection and key loss have typed fail-closed outcomes; no defaults are written. |
| Modified, truncated, or malformed protected data | AEAD authentication and strict envelope parsing reject it before payload use. |
| Older software encountering a newer format | Unknown protected versions are unsupported, never reinterpreted as legacy plaintext. |
| Application failure during migration | A durable journal, bounded cursor, per-record status, and recovery state make resumption deterministic. |

### 2.2 Non-goals and honest limits

R-15 does not by itself protect a fully compromised logged-in OS account, a malicious process with
equivalent access to live memory, a kernel or hypervisor compromise, a hardware keylogger, or a
renderer that is already executing attacker-controlled code while unlocked. It does not make
filesystem deletion cryptographically irreversible and must not claim secure deletion where the
platform cannot prove it. It also does not protect an export that the user explicitly requests to
write as plaintext outside the app-data authority.

## 3. Protected-data inventory

Classification is about the record's confidentiality and integrity contract, not only its current
file extension. `PROTECTED` includes user-authored content and metadata that can reveal content,
ownership, project relationships, or credentials. `DERIVED_REGENERABLE` means that the current
record is a disposable computation/cache rather than authoritative user data; if it is persisted
as a content-derived native record, it still requires encryption before that persistence is
admitted. `OUT_OF_SCOPE` means a user-controlled external boundary or a non-native cache, not that
the material is universally harmless.

The current `owner` and `authority` columns describe `main`; the R-15 column describes the future
Core contract.

| Record class | Current owner, physical location, readers and writers | Content/sensitivity, backup and staging relationship | R-15 classification and regenerability | Stable identity proposal and migration requirement |
|---|---|---|---|---|
| Project/manuscript canonical data | `FsProjectStore`; `$APPDATA/projects/<safe-project-id>/project.json`; `loadProject` reads and `saveProject` writes; snapshots and library backup read it through `StorageBackend`. Current authority is compressed plaintext Tauri FS. | User-authored title, logline, characters, worlds, outline, manuscript and project fields. Included in snapshots and library backups. Current atomic temp is also plaintext/compressed. | **PROTECTED**; authoritative, not regenerable. | `project:<project-id>`; use the persisted logical project ID, never title or path. Migrate one complete record with ownership verification; preserve legacy path aliases until a durable mapping is committed. |
| Project metadata | Same physical `project.json`, owned by `FsProjectStore`; read/written with canonical project data. | Display title, logline, author, goals, writing history, compile/export metadata, binder references and legacy identity metadata can expose sensitive context even without prose. Included in every project copy. | **PROTECTED**; not independently regenerable. | Subrecord identity is `project:<project-id>:metadata` only if Core later splits it; otherwise it remains covered by the project record AAD. Never use empty/non-empty metadata as provenance. |
| Snapshots | `FsSnapshotStore`; `$APPDATA/snapshots/<numeric-id>.json`; list/get/save/delete and restore read/write it. Auto-snapshots are triggered by project saves and pruned to 20. | Full project copies plus label/date/word count. A snapshot is a recoverable user-data copy, not a disposable cache. Current snapshot files are compressed plaintext and globally named. | **PROTECTED**; authoritative recovery copy, not regenerable. | `snapshot:<snapshot-id>` using the current global numeric namespace. Do not invent project ownership from title; a future migration must retain the current ID and add verified owner metadata only where available. |
| Library backups | `libraryBackupService.ts`; user-selected external archive contains settings, projects, snapshots, Codex, RAG vectors and binder assets; current `META.json`/`vault.bin` is an explicit encrypted ZIP output. API keys are excluded. | Aggregate content copy. Current implementation builds the inner plaintext JSON/ZIP in memory and then AES-GCM encrypts it; it is not a native Core record and no internal plaintext staging file is created. | **PROTECTED** as a backup artifact; regenerable from source but not disposable until the user chooses to delete it. | `backup:<backup-id>` for a future Core-owned artifact. Keep the existing backup format as migration input only; do not claim it is the R-15 envelope. |
| Quarantine/recovery data | `FsProjectStore#quarantineProject`; `$APPDATA/quarantined-projects/<project>-corrupt-<timestamp>/<project-id>/` plus `legacy-auxiliary.json`. Recovery reads preserved content; quarantine is created by explicit corruption recovery. | Preserved manuscript, assets, Codex and metadata. The quarantine manifest contains project and auxiliary provenance. It is recovery data, not a deletion permission or a plaintext escape. | **PROTECTED**; not regenerable without losing recovery evidence. | `recovery:<original-project-id>:<recovery-id>`; recovery ID is unique and path-independent. Migration must protect the whole preserved tree and manifest before any cleanup is admitted. |
| Settings | `FsSettingsStore`; `$APPDATA/config/settings.json`; startup/settings UI read it and flush writes it. | User preferences, endpoints, accessibility, integrations, desktop choices and privacy settings can be sensitive. API keys are intentionally not part of this file. | **PROTECTED**; authoritative settings, not regenerable. | `settings:global` (or a future explicit profile scope). Migration must preserve unknown forward-compatible settings fields and never copy key material into the settings record. |
| API/provider credentials | Active desktop path is `storageService` → WebView IndexedDB `idbKeyStore`; legacy `$APPDATA/config/<provider>_key.enc.json` files are cleanup-only and new FS writes throw. | Credentials are secrets. Current random-key IDB protection is separate from R-15 and the old path-derived filesystem helper is not an authority. | **PROTECTED**; not regenerable. | `credential:<provider>` in the owning secure key store. Native Core may use an OS keystore or passphrase adapter, but the renderer never receives raw key material. Migration must explicitly handle existing IDB/WebView credentials; no silent cross-authority copy. |
| Global images | `FsAssetStore`; `$APPDATA/images/<sanitized-id>.png`; image save/get/delete. | Avatar/ambiance image bytes are user-provided content; image IDs and MIME/data-URL metadata can identify project material. Current files are plaintext base64 text despite the `.png` suffix. | **PROTECTED**; authoritative user asset, not regenerable. | `image:<image-id>` because current storage is global and IDs are the current stable lookup key. Do not add project scope unless it becomes a persisted invariant; bind the exact image ID. |
| Binder binary assets | `FsAssetStore`; `$APPDATA/projects/<safe-project-id>/binder/<asset-id>.bin`; save/get/delete/list. | PDFs, images, audio and other research files can contain authored or private source material. Included in library backups and recursively preserved by quarantine. | **PROTECTED**; authoritative attachment, not regenerable. | `asset:<project-id>:<asset-id>`; project scope and asset ID are both required. Migration must treat binary and metadata as one logical generation, not two independently successful records. |
| Binder asset metadata | Same binder directory, `<asset-id>.meta.json`; `getBinderAsset` pairs it with `.bin` and checks byte size. | MIME type, original filename and byte size can reveal sensitive context; mismatch currently signals corruption. Included in backups/quarantine. | **PROTECTED**; not independently regenerable without losing provenance. | Same `asset:<project-id>:<asset-id>` identity, with a generation/version inside the protected payload. Migration must never commit metadata detached from its bytes. |
| Story Codex | `FsCodexStore`; `$APPDATA/projects/<safe-project-id>/codex/codex.snap`; save/get/delete. | Derived entities, mentions, excerpts, summaries and relationships may reproduce manuscript content. Included in backups and may be rebuilt from a project, but rebuilding is not lossless. | **PROTECTED**; derived but content-sensitive and regenerable only from still-available source. | `codex:<project-id>` plus an explicit derivation/version if split. Protect it even when marked derived; no plaintext sibling is permitted. |
| RAG/vector/index payloads | `FsCodexStore`; `$APPDATA/projects/<safe-project-id>/codex/vectors.snap`; save/get/delete. | Embeddings and index metadata are content-derived and can support disclosure or cross-project confusion. Current vectors have no embedded provenance, so the project path is the only owner signal. | **PROTECTED** for any persisted native copy; computationally regenerable. | `rag-index:<project-id>:<index-version>`; project scope is mandatory because current payload lacks provenance. Migration must reject unowned vectors rather than guess ownership. |
| Task metadata | Tauri `task_supervisor` handles bounded requests/results in memory; no native persistent task journal is currently written. | Current task IDs, type, timing and errors are transient; future resumable task payloads could contain user text or paths. | **DERIVED_REGENERABLE** for the current transient class; no native record to migrate. A future persisted task record becomes **PROTECTED** if it carries content or resumability authority. | Future `task:<task-id>`; admission requires an explicit persistence contract before adding files. Do not infer R-15 coverage from current in-memory handling. |
| Active-project marker | `FsProjectStore`; `$APPDATA/config/active-project-id.txt`; save updates it and boot reads it. | Looks like metadata, but legacy IDs can be title/path-derived and reveal project linkage; a wrong marker can route reads to the wrong project. | **PROTECTED**; small authoritative routing metadata, not safely regenerable from content. | `active-project:<scope>`; bind the referenced project ID and marker schema. Migration must preserve it or fail closed rather than select a default project. |
| Migration journals/checkpoints | No native FS journal exists on `main`; the existing `encryptionMigrationJournal.ts` is IDB-only. Future Core journal is the authority for native migration. | Operation ID, epochs, record inventory/cursor, per-record state and recovery status can reveal project structure and must never contain plaintext or keys. | **PROTECTED**; operationally required, not regenerable after a crash. | `migration:<operation-id>`; journal format/version is separate from project schema and envelope version. Migration must write/checkpoint it durably before touching records. |
| Atomic-write temporary files | `FsCore#writeAndReplace` creates sibling `<target>.tmp-<UUID>` files for text and binary writes and removes them best effort. Current content is plaintext/compressed or raw bytes. | Temporary files are alternate representations and can survive a crash. Their existence must not create a plaintext sibling of a protected record. | **PROTECTED** in the future; current unprotected implementation is a migration input/risk, not an R-15 success. | `staging:<operation-id>:<record-id>:<generation>`; unique, same-directory, ciphertext-only. Reconcile without deleting the only valid authority. |
| Migration staging | No native implementation currently exists. | Future conversion staging must not write plaintext temp data; it may contain ciphertext and authenticated generation metadata only. | **PROTECTED**; temporary but may contain the only converted copy during a commit window. | `migration-stage:<operation-id>:<record-id>:<generation>`; journal-owned and deleted only after durable commit/finalization. |
| Import staging/input | Current project import reads a user-selected external JSON/Markdown file into memory; assets can be written directly to the active backend. No internal staging file is used. | External input is an explicit user-controlled disclosure/source boundary, but an internal copied import would be sensitive project content. | **OUT_OF_SCOPE** for the current external boundary; any future internal staging is **PROTECTED**. | External file identity is not a native record identity. A Core import operation would use `import:<operation-id>` and ciphertext-only staging, with explicit ownership validation. |
| Export staging/output | JSON/Markdown/DOCX exports are built in memory and written to a user-selected external path; the encrypted library backup is listed separately. | Plaintext export is intentional user disclosure, not an internal protected sibling. In-memory buffers must be bounded and cleared by normal runtime ownership, without unsupported secure-erasure claims. | **OUT_OF_SCOPE** for explicit user-selected plaintext output; future internal staging is **PROTECTED**. | No R-15 authority identity for the external file. If a Core export operation needs staging, use `export:<operation-id>` and an explicit disclosure confirmation. |
| Logs/diagnostics | `services/diagnostics/logSinks.ts` writes bounded IDB logs and desktop JSONL at `$APPDATA/logs/worldscript-YYYY-MM-DD.jsonl`; `safeStringify` and logger redaction are current controls. | Structured errors, project IDs, paths, provider/task metadata and migration states can be sensitive even when manuscript text is prohibited. Current JSONL is not an R-15 protected record. | **PROTECTED** for desktop diagnostic persistence; bounded/derived but not harmless. | `diagnostic:<installation-scope>:<date>:<chunk-id>`; future chunks are redacted, authenticated and size-bounded. Migration must not carry raw plaintext logs into protected storage or vice versa. |
| Local AI/model caches | Local model storage and inference caches are browser/WebView or model-file caches, not current `FsProjectStore` authority. | Downloaded models are not user-authored project records; prompt/result caches may become content-sensitive if persisted. | **DERIVED_REGENERABLE** for model/cache bytes with no user content; content-bearing cache records become **PROTECTED** before native persistence. | Future `model-cache:<model-id>:<version>` or `inference-cache:<content-scope>:<key>` only after an explicit owner contract. No current native R-15 migration. |
| Service-worker/browser caches | PWA/service-worker caches and browser profile data are not native Tauri filesystem records and are owned by the browser runtime. | Static assets are generally regenerable; cached user responses may be sensitive depending on the browser feature. | **OUT_OF_SCOPE** for native R-15 authority; browser-specific protection remains its own policy. | No native identity. Do not use cache presence as project existence or secure-storage state. |
| Protected-envelope routing header | Future envelope header contains only the magic, envelope version, suite ID, key epoch, nonce and ciphertext length; no plaintext project/title/content. | Protocol metadata is non-sensitive by contract, but tampering is detected because the canonical header is included in AAD. | **NON_SENSITIVE** protocol metadata; not a user record. | No logical record identity of its own. It is authenticated in the containing record's AAD and parsed strictly before key/payload use. |

**Inventory result:** 17 `PROTECTED`, 1 `NON_SENSITIVE`, 2 `DERIVED_REGENERABLE`, 3 `OUT_OF_SCOPE`, 0 unclassified. The two derived classes are not permitted to become a plaintext native persistence escape if they later carry content or recovery authority.

## 4. No plaintext sibling rule

For every `PROTECTED` class, the following representations are covered by the same inventory and
must either be protected or be an explicit external disclosure boundary:

- authoritative record and its replacement generation;
- snapshot, backup, quarantine, and recovery copies;
- atomic-write, migration, and cleanup staging;
- import copies and conversion buffers if they leave bounded process memory;
- Codex/RAG/thumbnail or metadata derivatives that can reveal source content;
- diagnostic files, journals, manifests, and ownership indexes.

The future Core may hold bounded plaintext in memory while reading or transforming a record. It
must never write plaintext to an internal temporary or sibling path merely to encrypt it later. A
user-selected JSON/Markdown/DOCX export is a separate explicit disclosure operation and must not be
used as an internal migration mechanism. Current desktop plaintext is an acknowledged pre-R-15
state, not a compliant implementation.

## 5. Logical record identity registry

### 5.1 Identity rules

1. A logical identity is a canonical UTF-8 string with a fixed domain prefix and length limit. It
   is serialized deterministically for AAD; no locale, JSON key order, or UI formatting is allowed
   to change it.
2. Display title, logline, author, filesystem path, sanitized path segment, renderer, window, and
   current language are never identity components.
3. A path may locate a record, but a path change must not silently change identity. A relocation
   mapping is authenticated and committed as data, not inferred from a new filename.
4. Duplication/import creates a new project identity and new child identities unless the operation
   explicitly preserves a record as a user-requested reference. Copying bytes alone never transfers
   authority.
5. Quarantine preserves the original identity and adds a unique recovery identity. Restoration
   does not make a quarantined copy silently authoritative.
6. Key rotation changes the key epoch, not the logical identity. Envelope/schema migration changes
   format metadata, not identity.
7. Legacy projects with missing/invalid IDs require a verified mapping before R-15 migration. If
   ownership cannot be proven, the record is preserved and placed in recovery; a title/path guess
   is not an acceptable identity migration.

### 5.2 Proposed domains

| Domain | Identity | Rename/path/copy/restore semantics |
|---|---|---|
| Project | `project:<project-id>` | Title rename and relocation do not change identity. Import/duplicate receives a new ID. Snapshot restore changes project content, not snapshot identity. |
| Project metadata | `project:<project-id>:metadata` when split; otherwise covered by project | Same as project. It must not become an independent authority accidentally. |
| Settings | `settings:<scope>` | Scope is explicit (`global` initially); moving the app-data directory does not change it. |
| Snapshot | `snapshot:<snapshot-id>` | Current numeric global IDs are preserved. A future owner binding is additive and verified, not guessed from content. |
| Backup | `backup:<backup-id>` | User-created archive receives a new artifact ID; it is not an alternate live project authority. |
| Recovery/quarantine | `recovery:<original-project-id>:<recovery-id>` | Quarantine preserves the original project ID and makes the recovery copy independently addressable. |
| Credential | `credential:<provider>` | Provider name is the logical record; key rotation changes epoch only. Provider aliases require an explicit migration map. |
| Image | `image:<image-id>` | Current global image lookup preserves ID across project display changes. A project-scoped variant requires a persisted invariant. |
| Binder asset | `asset:<project-id>:<asset-id>` | Project and asset IDs are both required. Asset metadata and bytes are one generation. |
| Codex | `codex:<project-id>` | Rebuild/version changes do not change project identity; stale derived versions are rejected or regenerated explicitly. |
| RAG/index | `rag-index:<project-id>:<index-version>` | Project scope and derivation version prevent cross-project reuse. |
| Diagnostic chunk | `diagnostic:<installation-scope>:<date>:<chunk-id>` | Rotation/chunking changes physical files, not the installation scope or operation identity. |
| Migration | `migration:<operation-id>` | Operation ID is random and immutable; retries resume the same journal. |

## 6. Protected-record envelope

### 6.1 Version 1 wire contract

The first Core envelope is a binary record format, not JSON, so protected bytes do not depend on
JSON key ordering or a renderer serializer. The exact Rust representation is an implementation
detail, but the wire fields and order are part of the contract:

```text
magic             4 bytes ASCII: WSR1
envelope_version  unsigned integer: 1
suite_id          unsigned integer: 1 = AES-256-GCM-1
key_epoch        unsigned 64-bit integer, big-endian
nonce             12 bytes, generated by the CSPRNG for this encryption
ciphertext        remaining bytes, including the 16-byte AES-GCM tag
```

There is no unauthenticated plaintext payload field. Record class, logical identity, project
scope, and the canonical schema/domain context are supplied by the Core caller and authenticated
as AAD; they do not need to be duplicated in the envelope. The routing header is intentionally
small and non-sensitive by contract. A future format that needs additional routing metadata must
version it and include it in AAD before it is accepted.

The plaintext passed to AEAD is a typed Core record payload. Project schema version, application
record schema version, and protected-envelope version are separate version domains:

```text
envelope version  -> how to parse/authenticate the protected bytes
record schema     -> how to decode this record class
project schema    -> how to interpret ProjectData/StoryProject fields
key epoch         -> which key protects this generation
```

### 6.2 AAD binding

AES-GCM AAD is the canonical serialization of:

```text
domain = "worldscript-r15"
envelope_version = 1
suite_id = 1
record_class = exact registry token
logical_record_id = exact registry identity
project_id = present only for project-scoped records
record_schema_version = Core record schema version
key_epoch = envelope key_epoch
header = magic + envelope_version + suite_id + key_epoch + nonce
```

The canonical serializer uses fixed field order, UTF-8, length-delimited strings, and a documented
integer encoding. It is not a concatenated string with ambiguous separators. The same logical
record context is required for encrypt and decrypt. Replacing `project-A` with `project-B`, a
snapshot with an image, or one epoch with another causes authentication failure before payload
use. Paths and display titles are deliberately absent.

### 6.3 Algorithm and randomness

- Suite: standard RustCrypto `aes-gcm` AES-256-GCM, subject to dependency/security review at
  implementation admission. No custom cipher, MAC, padding, or authentication layer.
- Key: 32 bytes of key material; the Core treats the key as opaque outside the crypto module.
- Nonce: 12 bytes of cryptographically secure OS-backed random bytes for every encryption. The
  Core must reject a provider that cannot supply secure randomness. Nonces are never derived from a
  path, record ID, timestamp, or revision alone.
- Authentication tag: the standard 16-byte GCM tag included in `ciphertext`.
- Large records: use bounded chunked records only with a separately versioned chunk envelope and
  domain-separated per-chunk AAD/nonces. Do not invent unauthenticated streaming AES. The initial
  implementation may reject records above its bounded whole-record limit until the chunk format is
  admitted.

### 6.4 Compatibility and downgrade

`WSR1` is the only admitted version in the first implementation. Unknown magic, future envelope
version, unknown suite, malformed lengths, and unsupported key-epoch encoding return an explicit
unsupported/corrupt result. They never fall through to plaintext parsing. An older application may
read a newer record only when its versioned compatibility registry explicitly says so; otherwise it
must refuse it without rewriting, deleting, or replacing it with defaults.

The current TypeScript `fsCore` encrypted helper payload (`iv`, optional `salt`, `data`) is not an
R-15 envelope and has no general record binding. It is a migration input only if a separately
approved, identity-verified adapter supports it; otherwise it is preserved as an unsupported
legacy record. Existing IDB envelopes likewise remain a separate authority.

## 7. Read and parse outcomes

The Core returns typed semantic results rather than `string | error`:

| Outcome | Meaning and required behavior |
|---|---|
| `NOT_PROTECTED_LEGACY` | Known legacy plaintext encountered in an unlocked migration-capable state; it may be queued for an explicit journaled conversion. It is not evidence that the record is absent. |
| `PROTECTED_READABLE` | Current or explicitly supported envelope authenticated, decoded, and passed record validation. |
| `PROTECTED_LOCKED` | Secure mode is configured but the session has no usable key. No plaintext or ciphertext payload is returned. |
| `PROTECTED_WRONG_KEY` | The required key identity/epoch cannot be resolved, or an explicit supplied key fails the durable verifier. Do not retry indefinitely. |
| `PROTECTED_TAMPERED` | Expected key is available but AEAD/AAD authentication fails; includes modified ciphertext, header, AAD, or cross-record substitution. |
| `PROTECTED_UNSUPPORTED_VERSION` | Future envelope or suite cannot be interpreted safely. Never parse it as legacy plaintext. |
| `PROTECTED_CORRUPT` | Truncated, malformed, invalidly encoded, or authenticated bytes whose payload cannot be decoded. |
| `PROTECTED_IDENTITY_MISMATCH` | The requested registry identity differs from the authenticated record context. Preserve both copies and require recovery. |
| `MIGRATION_REQUIRED` | The record is a supported legacy/current format that cannot be used under the current authority until a journaled migration completes. |
| `RECOVERY_REQUIRED` | Journal, commit markers, ownership evidence, or verification state is inconsistent. Ordinary writes and destructive cleanup are blocked. |

A key-unavailable result is not silently relabeled as corruption, and a parse/authentication
failure is not silently relabeled as absence. If AEAD failure occurs after the expected key is
available, the cryptographic primitive cannot prove whether the cause was tampering or the wrong
key; the semantic result is `PROTECTED_TAMPERED` with redacted diagnostics, while key-resolution
failure is `PROTECTED_WRONG_KEY`.

## 8. Key and epoch model

### 8.1 Key state

The Core owns the state machine; a platform adapter supplies key acquisition/storage mechanisms.
React and QML receive state and commands, never raw key bytes.

```text
UNCONFIGURED
LOCKED
UNLOCKED(epoch=N)
MIGRATING(source=N,target=M)
RECOVERY_REQUIRED
KEY_LOST / RESET_REQUIRED
```

`UNCONFIGURED` means no protected authority has been admitted. It does not mean a protected record
may be overwritten. `LOCKED` means a configured key is unavailable; legacy plaintext is not
readable through a special path. `KEY_LOST` is truthful and does not promise recovery that the
cryptography cannot provide.

### 8.2 Key material and provider boundary

The Core contract is:

```text
KeyProvider.resolve(epoch) -> opaque 32-byte key or typed unavailable result
KeyProvider.unlock(input) -> authenticated epoch/state transition
KeyProvider.lock() -> clear runtime key handles/material
KeyProvider.list_epochs() -> non-secret key identities and availability
```

The provider may be implemented by an OS keystore, a user passphrase adapter, or a later approved
combination. A passphrase implementation must use an explicitly versioned KDF profile and a random
salt; the existing WebCrypto PBKDF2-SHA-256/600,000 profile is a browser reference, not a reason to
copy browser storage code into Core. The native implementation must select and document its KDF
profile before production admission. No raw passphrase, key, salt secret, or decrypted payload is
logged or sent to a renderer.

### 8.3 Epoch rules

1. Epoch `N` is immutable once a record is committed under it.
2. A new enable or rotation creates target epoch `M > N` and a durable target verifier before any
   record conversion is reported successful.
3. Every envelope names exactly one epoch; reads ask the Core to resolve that epoch.
4. A rotation holds exclusive write admission from source/target resolution through each durable
   commit and the final epoch switch. An ordinary writer cannot capture `N`, wait, and commit after
   `M` has retired `N`.
5. Old key material and old authority copies remain available until every required record is
   verified under `M`, the epoch switch is durable, and the journal is finalizable.
6. Old material is retired only in a separate finalization phase. If retirement fails, the new
   authority remains valid and cleanup is retried; no rollback is simulated by deleting the new
   record.
7. Interrupted rotation resumes from the same journal. It never generates a new target epoch just
   because the process restarted.

## 9. Durable protected write contract (#357)

For a new or replacement protected record, Core semantics are:

1. Resolve record identity, current authority, target epoch, and admission state together.
2. Serialize and authenticate the payload; materialize ciphertext to a unique same-directory
   staging target. No plaintext staging file is allowed.
3. Write all staged bytes and verify the expected byte count/format.
4. Flush/sync the staging file to the required durability level and close it.
5. Validate the staged envelope by parsing/authenticating it against the exact target identity.
6. Atomically replace/promote the target without deleting the only old authority first.
7. Flush/sync the containing directory or platform-equivalent metadata required to persist the
   replacement.
8. Only after step 7 return `DURABLE_COMMIT_SUCCESS` and advance the journal/manifest.
9. Reconcile stale staging deterministically on startup using authenticated generation/operation
   metadata; never delete an unrecognized file merely because it has a temp suffix.

The platform adapter implements `fsync`/directory-sync mechanics. The Core owns the order, success
boundary, generation rules, and recovery interpretation. Where a platform cannot provide the
required primitive, the operation returns `COMMITTED_NOT_CONFIRMED_DURABLE` or
`RECOVERY_REQUIRED`; it must not claim durable success.

### 9.1 Durability result model

```text
WRITE_FAILED_BEFORE_STAGING
STAGING_WRITTEN_NOT_COMMITTED
COMMITTED_NOT_CONFIRMED_DURABLE
DURABLE_COMMIT_SUCCESS
RECOVERY_REQUIRED
```

For an existing record, the old durable authority remains recoverable until the new authority has
passed the commit boundary. A crash may expose old or new filesystem directory state depending on
the platform; authenticated generations and the journal must make the next decision explicit. The
Core never turns an uncertain state into default project data.

### 9.2 Fault points

| Fault point | Required next state |
|---|---|
| Before staging write | Old authority remains valid; retry can start a new generation. |
| During staging write | Old authority remains authoritative; incomplete staging is untrusted and reconciled. |
| After staging write, before file sync | Staging is not committed; old authority remains. |
| After file sync, before replace | Complete staging may be verified/adopted by the journal or discarded; old authority remains until commit. |
| After replace, before directory sync | Return uncertain/recovery state; startup verifies journal, generations, and available old/new copies. |
| After directory sync | New authority is durable; only now advance commit state. |
| During cleanup | Authority is unchanged; cleanup can resume without deleting the committed generation. |

## 10. Crash-resumable migration and rekey (#359)

### 10.1 Journal contract

The journal is a durable Core record with no key material and no plaintext project payload. It
contains:

- `operation_id` and journal format version;
- operation type: `enable`, `rotate`, `disable-if-explicitly-admitted`, or envelope/schema
  migration;
- source and target epoch identities and target verifier reference where applicable;
- deterministic inventory version/digest and bounded record count estimate;
- per-record status or a resumable cursor, staging generation and verification result;
- commit/finalization state, last durable checkpoint, and recovery-required reason code;
- ownership/lease information sufficient to prevent two migration owners.

The inventory is streamed or paged. The entire project and full record list are never required in
memory. A checkpoint is written only after the corresponding record conversion and verification
are durable.

### 10.2 Migration phases

| Phase | Durable before/after; crash view | Resume/rollback; reads/writes |
|---|---|---|
| `DISCOVER` | Journal operation ID and a deterministic inventory identity are durable; records are not changed. | Resume re-runs discovery and compares the inventory. A changed/unverifiable inventory enters recovery. Reads use the existing authority; ordinary writes are admitted only before the operation is locked. |
| `PREPARE` | Target key/verifier, staging namespace, and source/target policy are durable. | Idempotently reuse the same target epoch and operation. No old authority is deleted. Reads use source; ordinary writes stop once admission is acquired. |
| `ADMIT` | Exclusive migration ownership and write barrier are durable. | If ownership is lost, restart claims the same journal only after lease expiry. No ordinary writes cross the barrier; reads remain Core-selected. |
| `CONVERT` | Each record is ciphertext-staged, synced, promoted, verified, then checkpointed. | Already checkpointed records are verified/replayed idempotently; pending records retain source authority. No rollback deletes source or target. Reads use verified target for completed records and source for pending records under one Core policy. |
| `VERIFY` | All inventory records have been read under target policy and verified; journal records the exact result. | Any shortfall becomes `RECOVERY_REQUIRED`; no epoch switch or cleanup. Ordinary writes remain blocked. |
| `COMMIT` | The active epoch/authority pointer and commit marker are atomically/durably switched. | Before the switch, source remains authoritative. After a durable switch, target is authoritative; startup never guesses from file timestamps. Reads follow the committed epoch; writes use target only. |
| `RETIRE_OLD_AUTHORITY` | Target is committed and verified; old copies/keys are still retained until this phase succeeds. | Cleanup is retryable and non-destructive to target. If deletion/retirement is uncertain, remain recoverable rather than claim completion. |
| `FINALIZE` | Journal says commit, verification, and permitted cleanup are complete; no key material is stored in the journal. | Remove only fully finalized operational debris. A stale journal is reconciled, not ignored. Ordinary operations resume after finalization. |
| `DONE` / `RECOVERY_REQUIRED` | `DONE` is durable terminal success. `RECOVERY_REQUIRED` is durable terminal refusal with a reason code. | `DONE` permits normal policy. `RECOVERY_REQUIRED` blocks ordinary writes and destructive cleanup until explicit recovery; never resets to defaults. |

### 10.3 Operations

- **Enable:** discover known healthy legacy plaintext while unlocked, convert every admitted
  protected class, verify, then commit the first protected epoch. A corrupt or ownership-ambiguous
  legacy record is preserved and marked for recovery; it is not replaced with an empty/default
  record.
- **Rotate:** source and target epochs are both available, records are re-enveloped with fresh
  nonces and target AAD, and the target epoch is switched only after complete verification.
- **Disable:** not an automatic fallback. It is an explicit, separately confirmed security
  downgrade if product policy admits it. It uses the same journal and preserve-first durability
  sequence, verifies the resulting legacy representation, and never deletes the protected source
  before the new authority is durable. If policy does not admit disable, Core returns an explicit
  unsupported/locked result.
- **Envelope/schema migration:** changes format or record schema under an operation ID without
  changing logical identity. An unknown future version is refused, not migrated by guessing.

### 10.4 Legacy plaintext and corruption

Discovery distinguishes known healthy legacy plaintext, unknown shape, corrupt/unreadable data,
already protected legacy envelopes, current envelopes, orphan staging, quarantine, and journals.
Only a recognized, ownership-verified legacy record is a migration candidate. A corrupt legacy file
is preserved, optionally quarantined under a recovery identity, and surfaced as recovery-required
or per-record migration failure. Migration may continue independent records only when the journal
can prove that doing so cannot hide or overwrite the failed record.

## 11. Unified admission model (#360)

The Core owns one admission authority for ordinary reads, ordinary writes, migration, rotation,
enable/disable, and shutdown. The mechanism may be a Rust async reader/writer gate plus a durable
journal lease; it need not copy browser Web Locks.

| Operation | Admission | Authority rule |
|---|---|---|
| Ordinary read | Shared read admission; hold through key selection, decrypt, identity verification, and payload handoff. | Core selects committed/verified source or target during migration. Renderer cannot choose an epoch. |
| Ordinary write | Shared ordinary-write admission; hold from epoch/key resolution through durable commit. | A writer cannot capture an old epoch, wait, then commit after migration retires it. |
| Migration/rekey | Exclusive admission over the conversion/verification/commit protocol, or a formally equivalent per-batch protocol with a durable write barrier. | No ordinary writer can cross the source/target transition. Any batch optimization must prove the same TOCTOU invariant. |
| Shutdown/close | Admission-aware drain/cancel protocol. | Do not report clean shutdown while a durable write/critical commit is unresolved. Preserve journal and resume after crash/forced kill. |

If an operation loses its key, admission lease, or durability confirmation, it returns a typed
failure and leaves the old authority/journal available. Admission failure is never treated as
record absence.

### 11.1 Locked legacy plaintext

When secure mode is configured and the session is `LOCKED`, a legacy plaintext record is not
readable through a special-case path. Core returns `PROTECTED_LOCKED` or `MIGRATION_REQUIRED`,
depending on whether an unlock/migration operation is available. There is no silent bypass merely
because a particular file has not yet been converted.

### 11.2 Read/write policy during migration

Core owns a deterministic policy: verified target records may be read after their per-record
checkpoint, pending records may be read from the still-valid source only while the journal permits
it, and the renderer sees one semantic record rather than an epoch choice. Ordinary writes are
blocked for the migration admission window in the initial implementation. A later bounded-batch
optimization requires proof that the write barrier and epoch acquisition still span the actual
durable commit.

## 12. Failure and recovery matrix

| Failure | Core disposition |
|---|---|
| Missing key/session locked | `PROTECTED_LOCKED`; no payload, no plaintext fallback, no default write. |
| Wrong passphrase/key identity | `PROTECTED_WRONG_KEY`; use durable verifier/key identity and bounded retry UX. |
| Modified ciphertext or AAD | `PROTECTED_TAMPERED`; preserve bytes and block overwrite/cleanup. |
| Cross-record substitution | AAD fails; `PROTECTED_TAMPERED` or `PROTECTED_IDENTITY_MISMATCH` when routing metadata also conflicts. |
| Truncated/malformed envelope | `PROTECTED_CORRUPT`; preserve original and require recovery/migration decision. |
| Unknown envelope/version/suite | `PROTECTED_UNSUPPORTED_VERSION`; never parse as plaintext or rewrite. |
| Disk full | Keep old authority; return `WRITE_FAILED_BEFORE_STAGING`, `STAGING_WRITTEN_NOT_COMMITTED`, or recovery state based on the observed boundary. |
| Permission denied | Keep old authority; return an adapter-translated failure without exposing raw paths to renderers. |
| Crash before rename | Old authority remains the safe choice; reconcile complete staging only through journal evidence. |
| Crash after rename before directory sync | Uncertain durability; verify both journal and generations, return recovery if proof is incomplete. |
| Crash during migration | Resume same operation/cursor; do not create a new epoch or delete source. |
| Crash during rotation | Resolve source/target from journal; target becomes authority only after durable commit. |
| Stale/corrupt journal | `RECOVERY_REQUIRED`; no database reset or journal deletion. |
| Mixed epochs | Journal determines per-record status; source remains recoverable until target verification and commit. |
| Key loss | `KEY_LOST / RESET_REQUIRED`; no promise of decryption. Destructive reset requires separate explicit confirmation. |
| Stale staging | Validate operation/generation/authentication; adopt only with journal proof, otherwise preserve/quarantine for recovery. |
| Large record/inventory | Use bounded whole-record, chunked, or paged processing according to class; reject unsupported size rather than allocate unbounded memory. |

## 13. Memory and processing contract

| Class | Initial intended processing |
|---|---|
| Project metadata, settings, journals, Codex metadata | Whole-record with explicit size limits. |
| Project/manuscript and snapshots | Bounded whole-record initially; admit chunked authenticated format before supporting records above the limit. |
| Images, binder assets, backup archives | Streaming/chunked adapter path with per-chunk authentication and a final record manifest; never a hand-rolled unauthenticated stream. |
| RAG/vector indexes | Incremental or chunked by project/index generation; regenerable but protected when persisted. |
| Logs | Bounded redacted chunks with rotation; no unbounded append file. |
| Migration inventory | Paged/streamed cursor and bounded journal checkpoints, never the entire inventory in memory. |

## 14. Logging and redaction

Core may log structured non-secret diagnostics:

```text
record_class, opaque_record_id, operation_id, phase, epoch_id, result_code
```

It must never log manuscript prose, credentials, passphrases, raw key bytes, decrypted payloads,
full protected envelopes, or unrestricted filesystem paths. Logical IDs must be treated as
potentially sensitive: use a stable opaque diagnostic identifier or a redacted hash where the
record ID itself is user-derived. Error messages exposed to renderers are stable semantic codes;
platform adapters may retain private OS error detail in a redacted diagnostic channel.

## 15. Core and platform boundaries

### 15.1 Renderer-neutral Core surface

The later public Core API is semantic:

```text
read_record(class, logical_id) -> typed read outcome + payload
write_record(class, logical_id, payload) -> durability result
query_secure_storage_state() -> key/epoch/migration state
unlock(input) / lock()
begin_enable() / begin_rotation() / begin_explicit_disable()
resume_recovery(operation_id)
observe_migration(operation_id)
```

The renderer does not choose algorithms, construct nonces/AAD, select an epoch, receive raw keys,
write envelopes, choose migration source authority, or delete old copies.

### 15.2 Platform adapter mechanisms

Adapters may provide:

- app-data directory and path/file operations;
- file write, file sync, atomic replace, and directory-sync primitives;
- OS-backed cryptographic randomness;
- OS keystore/credential access or the approved passphrase KDF input;
- platform permission/error translation;
- process shutdown/cancellation signals.

The adapter reports capabilities and honest failures. It does not choose policy, classify a missing
record from an I/O error, or bypass Core admission. Tauri and later Qt therefore consume the same
Core contract.

## 16. Headless implementation and fault-injection requirements

The Rust/Core test harness must run without Tauri or Qt and provide:

- in-memory filesystem with atomic rename and directory-sync events;
- fault-injecting filesystem for every durability boundary;
- fake key provider with missing, wrong, lost, source, and target epochs;
- deterministic CSPRNG/test-vector injection without weakening production randomness;
- corrupt/truncated/unknown envelope and modified-AAD fixtures;
- crash points before/after each journal checkpoint and epoch switch;
- permission denied, disk full, stale temp, stale journal, and ownership mismatch;
- concurrent ordinary read/write versus exclusive migration schedules;
- large record and paged inventory cases with observable memory bounds.

Required assertions include:

1. Wrong key, modified ciphertext, modified AAD, cross-record substitution, truncation, and
   unsupported versions fail closed.
2. A durable write never reports success before file and directory durability requirements.
3. Every interruption leaves an old valid authority, a new valid authority, or an explicit
   recoverable state; never silent mixed authority.
4. Migration and rotation resume idempotently from the same journal without deleting the only copy.
5. Ordinary writes cannot commit under an epoch retired during an exclusive operation.
6. Locked secure mode cannot read legacy plaintext.
7. Protected IDs, fields, and unknown forward-compatible fields are preserved; no normalization
   silently drops user content.
8. Logs and error results contain no raw content, key, passphrase, or unrestricted path.

## 17. Reconciliation of current TypeScript mechanisms

| Current mechanism | S5 classification | What may carry forward |
|---|---|---|
| `storageEncryptionService.ts` AES-256-GCM, typed locked/wrong-passphrase/corrupt errors | **SEMANTICALLY_REUSABLE**, **TEST_FIXTURE_REUSABLE** | AEAD/authentication concepts and explicit failure distinctions. The WebCrypto API and IDB byte layout are not the Core authority. |
| `encryptionMigrationJournal.ts` and `protectedStoreMigration.ts` | **SEMANTICALLY_REUSABLE**, **TEST_FIXTURE_REUSABLE** | Durable operation phases, ownership lease, checkpoints, replay-safe batches, verification and recovery-required state. Native fs durability and one unified Core admission still must be implemented. |
| `protectedWriteAdmission.ts` | **SEMANTICALLY_REUSABLE** | Shared/exclusive and key-resolution-through-commit invariant. Browser Web Locks/fallback code is not copied into Rust. |
| `secureRecordCodec.ts` | **TEST_FIXTURE_REUSABLE** | Explicit structured-clone/binary preservation lessons. It is not the native envelope or a complete project schema. |
| `fsCore.ts#encryptText/decryptText` | **TRANSITIONAL_ONLY / MUST NOT BE CARRIED AS AUTHORITY** | Current history and migration detection only. Its path-derived/legacy payload lacks the R-15 identity contract. |
| `libraryBackupService.ts` | **MIGRATION_INPUT_ONLY** | Explicit user backup boundary and existing backup test vectors. Its ZIP/PBKDF2 format is not the native record envelope. |
| IDB stores and `idbKeyStore.ts` | **TRANSITIONAL_ONLY** | Browser/WebView storage remains independent; common semantic vectors may be shared. No desktop authority switch is implied. |

## 18. Browser/IDB relationship

The browser/PWA and desktop Core share concepts—authenticated records, key epochs, locked state,
journals, redaction, and preserve-first recovery—but retain separate storage implementations.
Browser IDB store keys and WebCrypto envelopes may remain optimized for IDB queries. Native Core
records use the identity-bound R-15 envelope and platform durability contract. Cross-platform golden
vectors are useful only where the exact primitive/AAD/KDF profile is intentionally shared; a
renderer-specific implementation must not be treated as a security oracle for another authority.

## 19. Reconciliation of child issues

These issues remain open and are not closed by S5. The table records the contract and the later
implementation evidence required for each one.

| Issue | Current exact gap on `main` | R-15 contract owner | Implementation dependency | Required evidence / closure condition |
|---|---|---|---|---|
| [#357](https://github.com/qnbs/WorldScript-Studio/issues/357) | FS temp-write + rename is atomic at the JS level but has no Core-controlled file/parent `fsync` durability boundary. | §9 durable protected write and §12 durability faults | Rust/platform durable-write adapter and capability reporting. | Headless fault tests plus packaged platform evidence show no durable-success claim before file and directory sync. |
| [#359](https://github.com/qnbs/WorldScript-Studio/issues/359) | No native filesystem journal/checkpoint/resumable cursor exists; current desktop encryption migration is not a live authority. | §10 migration/rekey journal and phases | Core journal, epoch lifecycle, bounded inventory, recovery UX. | Kill/power-loss simulation resumes the same operation and verifies every record before old-key retirement. |
| [#360](https://github.com/qnbs/WorldScript-Studio/issues/360) | Current fs reads/writes are not coordinated with a native encryption migration admission lock; locked legacy plaintext is a historical bypass risk. | §11 unified admission and locked-legacy policy | Core shared/exclusive gate integrated with every protected reader/writer. | Deterministic TOCTOU schedule proves no old-epoch commit after retirement and no locked plaintext read. |
| [#361](https://github.com/qnbs/WorldScript-Studio/issues/361) | Current filesystem protected helper has no general per-record AAD/identity binding; valid ciphertext can be substituted between records. | §5 identity registry and §6 AAD/envelope | Core record registry, canonical AAD and migration adapters. | Cross-record substitution, modified AAD, and relocation tests fail closed while valid IDs/content remain intact. |

`R15_CHILD_ISSUES_RECONCILED` means their requirements have owners and evidence conditions in this
contract. It does not mean any child issue is implemented or closed.

## 20. Staged implementation admission plan

Later implementation may be admitted only in these bounded gates:

1. **Core primitive and vectors:** implement the selected AEAD/KDF/randomness profile behind a
   headless interface; publish versioned vectors and malformed-input tests.
2. **Envelope and identity registry:** implement strict parsing, canonical AAD, record-class
   adapters, and substitution tests without changing current TS/Tauri authority.
3. **Durable adapter:** implement file sync, atomic replacement, directory sync, generation
   reconciliation, and fault-injection tests for one record class.
4. **Journal/admission:** implement enable/rotate/recovery state machines, exclusive migration
   admission, bounded inventory/checkpoints, and shutdown/cancellation behavior.
5. **Inventory-complete migration:** add every `PROTECTED` class from §3, including backups,
   quarantine, diagnostics, and derived content indexes; prove no plaintext sibling path remains.
6. **Shadow/compatibility phase:** compare Core verdicts with current TS reads without switching
   authority; run packaged Tauri acceptance and the relevant #332 durability/background scenarios.
7. **Explicit authority switch:** only a separately authorized release migration may change desktop
   readers/writers, preserve legacy recovery, and update security/release documentation.

Each gate must re-run the relevant #357/#359/#360/#361 evidence and must not mark the next gate
complete merely because a design document exists.

## 21. S5 admission decision

The contract is implementation-ready at the semantic level:

- protected records and alternate representations are enumerated;
- logical identity is separated from path/title and bound through AAD;
- envelope, key/epoch, parse, failure, and downgrade semantics are explicit;
- durable writes, migration/rekey, admission, lock, recovery, and memory bounds are defined;
- Core versus platform responsibilities and headless tests are explicit;
- #357/#359/#360/#361 have implementation owners and closure evidence.

This is **`DESIGN_ADMITTED / CONTRACT_DEFINED / IMPLEMENTATION_NOT_STARTED`**. Current desktop
filesystem authority remains unchanged and current user data is not retroactively encrypted by S5.
