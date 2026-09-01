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
| Worker dead-letter entries | `packages/worker-bus/src/deadLetterQueue.ts`; IndexedDB `worldscript-dead-letter-db/dead_letters`; failed `WorkerTask` requests and `TaskResult` entries are persisted best-effort up to a bounded capacity. | Task payloads, generated results, error details, worker IDs and retry metadata can contain prompts, manuscript text, paths or provider context. Persistence is not harmless merely because entries are bounded or retryable. | **PROTECTED**; current WebView persistence is separate from future native Core authority and is not regenerable without losing failure evidence. | `worker-dlq:<installation-scope>:<task-id>`; task ID is immutable and installation scope is explicit. A future migration must redact or protect payload/result/error fields and preserve entries until their retention policy permits cleanup. |
| Active-project marker | `FsProjectStore`; `$APPDATA/config/active-project-id.txt`; save updates it and boot reads it. | Looks like metadata, but legacy IDs can be title/path-derived and reveal project linkage; a wrong marker can route reads to the wrong project. | **PROTECTED**; small authoritative routing metadata, not safely regenerable from content. | `active-project:<scope>`; bind the referenced project ID and marker schema. Migration must preserve it or fail closed rather than select a default project. |
| Secure-storage authority manifest | No native record exists on `main`; future Core owns the active epoch, authority generation, record-root mapping, and commit state. | These values decide which protected generation is authoritative and can expose project/storage topology. | **PROTECTED**; security-critical control state, not regenerable after a crash. | `authority-root:<scope>`; scope is installation or storage-root specific and independent of filesystem path. Migration must durably switch it only after target verification. |
| Key-epoch registry and verifier references | No native record exists on `main`; future Core/key adapter must persist non-secret epoch status, key identity references, and verifiers. | Epoch status and verifier metadata control key lookup and locked/recovery behavior; raw key material is never stored here. | **PROTECTED**; required control state, not regenerable without the key provider. | `key-epoch:<scope>:<epoch>`; epoch identity is immutable and survives path relocation. Migration must create and verify a target epoch before conversion. |
| Record-generation and commit markers | No native record exists on `main`; future Core must track active/pending generation and commit intent per protected logical record. | A valid older ciphertext for the same identity can otherwise pass AEAD after rollback. Pending/active markers also decide deterministic crash recovery. | **PROTECTED**; authenticated authority metadata, not regenerable from record content alone. | `record-commit:<logical-record-id>`; marker binds identity, epoch, generation, operation and content digest. Migration must retain the prior active generation until the new marker is durable. |
| Migration journals/checkpoints | No native FS journal exists on `main`; the existing `encryptionMigrationJournal.ts` is IDB-only. Future Core journal is the authority for native migration. | Operation ID, epochs, record inventory/cursor, per-record state and recovery status can reveal project structure and must never contain plaintext or keys. | **PROTECTED**; operationally required, not regenerable after a crash. | `migration:<operation-id>`; journal format/version is separate from project schema and envelope version. Migration must write/checkpoint it durably before touching records. |
| Atomic-write temporary files | `FsCore#writeAndReplace` creates sibling `<target>.tmp-<UUID>` files for text and binary writes and removes them best effort. Current content is plaintext/compressed or raw bytes. | Temporary files are alternate representations and can survive a crash. Their existence must not create a plaintext sibling of a protected record. | **PROTECTED** in the future; current unprotected implementation is a migration input/risk, not an R-15 success. | `staging:<operation-id>:<record-id>:<generation>`; unique, same-directory, ciphertext-only. Reconcile without deleting the only valid authority. |
| Migration staging | No native implementation currently exists. | Future conversion staging must not write plaintext temp data; it may contain ciphertext and authenticated generation metadata only. | **PROTECTED**; temporary but may contain the only converted copy during a commit window. | `migration-stage:<operation-id>:<record-id>:<generation>`; journal-owned and deleted only after durable commit/finalization. |
| Import staging/input | Current project import reads a user-selected external JSON/Markdown file into memory; assets can be written directly to the active backend. No internal staging file is used. | External input is an explicit user-controlled disclosure/source boundary, but an internal copied import would be sensitive project content. | **OUT_OF_SCOPE** for the current external boundary; any future internal staging is **PROTECTED**. | External file identity is not a native record identity. A Core import operation would use `import:<operation-id>` and ciphertext-only staging, with explicit ownership validation. |
| Export staging/output | JSON/Markdown/DOCX exports are built in memory and written to a user-selected external path; the encrypted library backup is listed separately. | Plaintext export is intentional user disclosure, not an internal protected sibling. In-memory buffers must be bounded and cleared by normal runtime ownership, without unsupported secure-erasure claims. | **OUT_OF_SCOPE** for explicit user-selected plaintext output; future internal staging is **PROTECTED**. | No R-15 authority identity for the external file. If a Core export operation needs staging, use `export:<operation-id>` and an explicit disclosure confirmation. |
| Logs/diagnostics | `services/diagnostics/logSinks.ts` writes bounded IDB logs and desktop JSONL at `$APPDATA/logs/worldscript-YYYY-MM-DD.jsonl`; `safeStringify` and logger redaction are current controls. | Structured errors, project IDs, paths, provider/task metadata and migration states can be sensitive even when manuscript text is prohibited. Current JSONL is not an R-15 protected record. | **PROTECTED** for desktop diagnostic persistence; bounded/derived but not harmless. | `diagnostic:<installation-scope>:<date>:<chunk-id>`; future chunks are redacted, authenticated and size-bounded. Migration must not carry raw plaintext logs into protected storage or vice versa. |
| Local AI/model caches | Local model storage and inference caches are browser/WebView or model-file caches, not current `FsProjectStore` authority. | Downloaded models are not user-authored project records; prompt/result caches may become content-sensitive if persisted. | **DERIVED_REGENERABLE** for model/cache bytes with no user content; content-bearing cache records become **PROTECTED** before native persistence. | Future `model-cache:<model-id>:<version>` or `inference-cache:<content-scope>:<key>` only after an explicit owner contract. No current native R-15 migration. |
| Service-worker/browser caches | PWA/service-worker caches and browser profile data are not native Tauri filesystem records and are owned by the browser runtime. | Static assets are generally regenerable; cached user responses may be sensitive depending on the browser feature. | **OUT_OF_SCOPE** for native R-15 authority; browser-specific protection remains its own policy. | No native identity. Do not use cache presence as project existence or secure-storage state. |
| Scene comments and replies | `features/sceneComments/sceneCommentsSlice.ts`; localStorage key `worldscript-scene-comments`; Redux middleware persists comment/reply bodies. | Comment bodies, replies, section IDs and resolution state are user-authored project context even though this store is outside `project.json`. | **PROTECTED**; current localStorage is a separate WebView authority and is not covered by native Core. | `scene-comments:<installation-scope>` until a project binding is added; future migration must bind every section/comment ID and preserve the current global namespace rather than guess a project. |
| Scene revision history | `services/sceneRevisionService.ts`; WebView IndexedDB `worldscript-revisions-db/scene-revisions`; current browser encryption is separate from native R-15. | Revision titles and full scene content are recoverable user data. | **PROTECTED**; independently encrypted today where the IDB policy applies, but not a native Core record. | `scene-revision:<revision-id>` with section routing authenticated separately. Migration must preserve revision identity and bounded history. |
| Plot-board and mind-map UI records | `features/plotBoard/plotBoardSlice.ts` and `features/mindMap/mindMapUiSlice.ts`; localStorage viewport/selection state. Authored connections/nodes remain in project state, but IDs and active selections persist here. | Selection, map identifiers, viewport and interaction metadata can reveal project structure; the UI state is regenerable but not harmless. | **PROTECTED** for a persisted desktop profile; it must not be treated as the project content authority. | `plot-ui:<installation-scope>` / `mind-map-ui:<installation-scope>`; future Core may omit purely ephemeral viewport fields only after proving no user intent or routing metadata is lost. |
| Writing progress and session history | `features/progressTracker/progressTrackerSlice.ts`; localStorage key `worldscript-progress-tracker`. | Goals, streaks, writing totals and session timing are personal activity metadata. | **PROTECTED**; not manuscript content but capable of sensitive disclosure and not safely reconstructable. | `progress:<installation-scope>`; import/duplicate does not silently transfer personal history. |
| ProForge memory bank | `services/proForge/proForgeMemoryBank.ts`; IndexedDB `proforge-memory-bank/entries`, keyed by entry ID and indexed by project ID. | Memory keys and content are project-specific AI context and may reproduce user text. | **PROTECTED**; current browser/IDB authority is separate from native R-15. | `proforge-memory:<project-id>:<entry-id>`; project binding is required and entries are not migrated by database name alone. |
| ProForge run history | `services/proForge/proForgeHistoryStore.ts`; IndexedDB `proforge-run-history/history`, keyed by project ID. | Pipeline runs can retain prompts, review context, generated text and operational project metadata. | **PROTECTED**; bounded per project but content-bearing. | `proforge-history:<project-id>`; history is preserved as a project child record and never treated as disposable cache during migration. |
| AI inference cache | `services/ai/aiInferenceCacheService.ts`; IndexedDB `worldscript-inference-cache-db/inference-cache` with bounded in-memory LRU. | Cached results are user/provider content and the hashed prompt/model key is still sensitive linkage metadata. | **PROTECTED** for persisted desktop/WebView entries; TTL/LRU is a retention policy, not encryption. | `inference-cache:<installation-scope>:<cache-key>`; future Core must bind the model/prompt cache namespace without storing raw prompt text in routing metadata. |
| LoRA adapters, datasets and run metadata | `services/loraAdapterService.ts`; IndexedDB `worldscript-lora-db` metadata/blob/dataset/run/active stores; adapter metadata can also reference Tauri paths. | Adapter blobs, training datasets, lineage and active-model metadata may contain user material or reveal project provenance. | **PROTECTED** when persisted or project-linked; downloaded public model bytes are not automatically safe once user data is merged. | `lora:<adapter-id>` plus explicit dataset/run child identities; filesystem paths are locations only. Migration must preserve metadata/blob pairing. |
| Opt-in AI telemetry | `services/ai/telemetryService.ts`; DuckDB `ai_telemetry` or bounded localStorage fallback `worldscript-ai-telemetry`. | Task/provider/model, timing and success metadata can expose usage and provider context even without prompt text. | **PROTECTED** for persisted desktop telemetry; the opt-in gate remains separate from the protection requirement. | `telemetry:<installation-scope>:<chunk-id>`; future records are redacted, bounded and authenticated. |
| UI preferences and feature flags | Theme, language, last-view, feature-flag, tour, command-palette and similar localStorage keys. | No authored content or credentials by contract; values are small presentation preferences. | **NON_SENSITIVE** and regenerable, provided no content or secret is added to these keys. | `ui-preferences:<installation-scope>` only as a future bounded preference record; never use them as project or encryption authority. |
| Protected-envelope routing header | Future envelope header contains only the magic, fixed-width version/suite/epoch/generation/schema fields, nonce and ciphertext length; no plaintext project/title/content. | Protocol metadata is non-sensitive by contract, but tampering is detected because the canonical header is included in AAD. | **NON_SENSITIVE** protocol metadata; not a user record. | No logical record identity of its own. It is authenticated in the containing record's AAD and parsed strictly before key/payload use. |

**Inventory result:** 30 `PROTECTED`, 2 `NON_SENSITIVE`, 2 `DERIVED_REGENERABLE`, 3 `OUT_OF_SCOPE`, 0 unclassified (37 classes total). The two derived classes are not permitted to become a plaintext native persistence escape if they later carry content or recovery authority. Persistent worker dead-letter entries are protected even though their current WebView queue is bounded and best-effort.

This R-15 inventory is the authoritative security/storage admission list for packaged desktop data.
The renderer classification in `UI-DOMAIN-STATE-CLASSIFICATION.md` remains authoritative for whether a
slice is domain, presentation, or preference state; it does not narrow R-15 protection scope. In
particular, persisted `plot-ui` and `mind-map-ui` records remain `PROTECTED` desktop records even
though their values are presentation state and are not automatically Core-owned domain state. The
PWA/browser authority remains separate as described in §18; a packaged Tauri WebView is not outside
the native desktop inventory merely because its current physical store is localStorage or IndexedDB.

## 4. No plaintext sibling rule

For every `PROTECTED` class, the following representations are covered by the same inventory and
must either be protected or be an explicit external disclosure boundary:

- authoritative record and its replacement generation;
- snapshot, backup, quarantine, and recovery copies;
- atomic-write, migration, and cleanup staging;
- import copies and conversion buffers if they leave bounded process memory;
- Codex/RAG/thumbnail or metadata derivatives that can reveal source content;
- diagnostic files, journals, manifests, ownership indexes, epoch registries, generation markers,
  content-bearing WebView/localStorage/IndexedDB stores, and persisted worker dead-letter task,
  result, or error payloads on packaged desktop.

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
| Authority manifest/control root | `authority-root:<scope>` | Storage-root relocation does not change scope. This special control root is the sole epoch/authority selector after its commit boundary and is not an ordinary record requiring another commit marker. |
| Key epoch registry | `key-epoch:<scope>:<epoch>` | Epoch identity is immutable; key rotation adds an epoch and never changes record identities. |
| Record commit marker | `record-commit:<logical-record-id>` | Tracks the active/pending generation for one identity; physical generation files and path names are subordinate to this marker. |
| Scene comments | `scene-comments:<installation-scope>` | Current global localStorage has no project binding; future migration must retain that namespace or add a verified binding, never infer ownership from section text. |
| Scene revision | `scene-revision:<revision-id>` | Revision identity survives renderer/storage relocation; section routing is authenticated metadata. |
| ProForge memory | `proforge-memory:<project-id>:<entry-id>` | Entry ID and project ID jointly bind project-specific AI context. |
| ProForge history | `proforge-history:<project-id>` | Project ID binds the bounded run-history record; run order is payload, not a physical path. |
| Inference cache | `inference-cache:<installation-scope>:<cache-key>` | The cache-key namespace is bound without exposing the raw prompt; TTL does not change identity. |
| LoRA adapter | `lora:<adapter-id>` | Adapter metadata/blob pairing survives path changes; dataset/run children receive separate IDs. |
| AI telemetry chunk | `telemetry:<installation-scope>:<chunk-id>` | Opt-in telemetry chunks rotate physically without changing the installation scope. |
| Worker dead-letter entry | `worker-dlq:<installation-scope>:<task-id>` | Task ID is immutable; queue retention or physical compaction does not change identity. |

### 5.2.1 Project-scope registry

The `project_id` AAD component is required for project-owned records and absent for installation,
storage-root, record-local control, or explicit external-boundary records. This is a scope rule,
not a permission to infer ownership from a title, path, content value, or cache key. The following
registry is exhaustive for the version-1 record-class tokens in §6.1.1; current global namespaces
remain explicit gaps until a verified owner binding exists.

| Record-class token | Scope in the AAD contract | Ownership rule |
|---|---|---|
| `project` | Required `project_id` | The persisted project ID is the owner. |
| `project-metadata` | Required `project_id` | Metadata is a child of the project record, never a fresh authority. |
| `snapshot` | Absent in the current global namespace; required when a verified owner is added | Preserve the current snapshot ID and do not guess a project owner from content. |
| `backup` | Explicit artifact/storage scope | A Core-owned backup gets an explicit artifact owner; user-selected archives remain external migration inputs. |
| `recovery` | Required original `project_id` | The recovery ID is bound to the original project and is never inferred from the quarantine path. |
| `settings` | Installation/profile scope; no project ID | Settings are not project provenance or encryption authority. |
| `credential` | Installation scope plus provider identity; no project ID | Provider credentials belong to the secure key store scope, not to a project title or path. |
| `image` | Current installation/global scope; project ID absent unless persisted ownership exists | Preserve the global image ID; do not invent project ownership. |
| `asset` | Required `project_id` | Project and asset IDs jointly identify the protected attachment. |
| `asset-metadata` | Required `project_id` | Metadata and bytes share the asset generation and owner. |
| `codex` | Required `project_id` | Derived content remains project-owned even when regenerable. |
| `rag-index` | Required `project_id` | Index generation cannot be shared across projects without an explicit new owner. |
| `active-project` | Installation/storage scope; referenced project ID is protected payload | The marker binds routing to a project but is not itself project-scoped. |
| `authority-root` | Storage-root scope; no project ID | This is the finite control-plane anchor for the storage authority. |
| `key-epoch` | Storage-root/key-provider scope; no project ID | Epoch identity is global to its protected storage authority. |
| `record-commit` | Same scope as the referenced logical record | A project record marker carries that record's project ID; control markers do not acquire one. |
| `migration` | Installation/storage operation scope; no single project ID required | The protected journal contains an authenticated inventory of all owned records in the operation. |
| `staging` | Record/operation scope; project ID required for a project record | A staging identity inherits the record owner and cannot become authority by filename. |
| `migration-stage` | Record/operation scope; project ID required for a project record | Conversion staging inherits the journal-verified owner. |
| `diagnostic` | Installation scope; no project ID by default | Redacted diagnostics are global; a future project-bound diagnostic must opt into an explicit owner. |
| `scene-comments` | Current installation/global scope; project ID absent until verified | Preserve the current namespace; never bind comments from section text. |
| `scene-revision` | Current revision scope; project ID required only when verified | Revision IDs remain stable; section routing is authenticated payload metadata. |
| `plot-ui` | Current installation scope; no project ID | Viewport/selection state is not project authority; future binding must be explicit. |
| `mind-map-ui` | Current installation scope; no project ID | Same rule as plot UI; no content-based owner inference. |
| `progress` | Installation/profile scope; no project ID | Personal progress remains separate from project identity. |
| `proforge-memory` | Required `project_id` | Each memory entry is project-specific AI context. |
| `proforge-history` | Required `project_id` | Run history is a project child record. |
| `inference-cache` | Current installation/cache scope; project ID absent unless a project-bound cache is explicitly admitted | Cache keys are not project provenance and raw prompts are not routing metadata. |
| `lora` | Installation/adapter scope; project ID required for project-bound datasets/runs | Adapter identity survives path changes; child ownership is explicit. |
| `telemetry` | Installation/profile scope; no project ID by default | Opt-in telemetry is redacted and global unless a separately approved project scope exists. |
| `worker-dlq` | Installation scope; no project ID by default | Task IDs and bounded retention define queue ownership; payload content must not be used to infer a project. |

For the current desktop implementation, rows marked as global or installation-scoped retain that
scope rather than receiving a speculative project binding. A future authority switch may add a
verified project owner as an additive migration field, but a missing owner causes migration or
recovery—not a guessed AAD value. Physical path, display title, and renderer remain excluded from
every scope decision.

### 5.3 Non-recursive control root

The `authority-root:<scope>` manifest is a special protected control-plane root, not an ordinary
user record. Its fixed scope and key-provider reference form the non-recursive anchor for the
authority manifest, key-epoch registry, and record-commit markers. Those control records are
authenticated and durable, but they do not each require another `record-commit` record. Otherwise a
protected commit marker would require a marker for its marker without a finite base case.

The platform adapter provides the root's finite commit primitive: two generation-addressable root
slots plus an atomic, directory-synchronized active-slot pointer (or a platform-equivalent
transaction with the same semantics). Core authenticates each root slot with the fixed
`authority-root:<scope>` AAD, verifies its generation and digest, and advances the pointer only
under the exclusive control/admission fence. The pointer contains no plaintext project content or
key material. A crash leaves the prior valid root slot, the new valid slot, or
`RECOVERY_REQUIRED`; startup never selects a slot from timestamps alone.

Root slots also carry a monotonic `root_generation`, authenticated root digest, and the fixed root
AAD. The pointer names one slot, generation, and digest and can advance only under the exclusive
fence plus a directory-synchronized commit. A root slot has authenticated commit evidence that
binds its operation ID, fencing generation, journal revision, and `COMMITTED` state; an authenticated
slot that is only prepared or pending is not authority. Startup authenticates both slots and accepts
the pointer only when it matches a committed slot and is not below the monotonic floor held by the
approved key or secure-metadata adapter. A newer slot is selected or used to repair the pointer only
when that committed root evidence proves the authority switch completed under the current fence;
generation, timestamps, or slot recency alone never promote it. If the pointed slot is valid, a
newer uncommitted slot is retained as a candidate and does not displace it. If the pointer is
invalid, only one newer committed candidate with matching journal/fence evidence may repair it;
otherwise startup returns `RECOVERY_REQUIRED`. The same result applies when the floor is
unavailable, the pointer conflicts with both slots, or the platform cannot distinguish a complete
older-directory snapshot from current state. Filesystem slots alone cannot detect an attacker
restoring the entire data directory; the adapter floor is the required rollback-detection boundary,
and its absence is never treated as proof of freshness.

First-time enable creates the root key reference in the approved key adapter before writing the
first protected root slot, using the bootstrap sequence in §10.2. The root remains the finite
anchor for later control-record commits while ordinary record generations continue to use their
per-record markers. This is a storage mechanism boundary, not a renderer or Storage-Core policy
escape.

## 6. Protected-record envelope

### 6.1 Version 1 wire contract

The first Core envelope is a binary record format, not JSON, so protected bytes do not depend on
JSON key ordering or a renderer serializer. The exact Rust representation is an implementation
detail, but the wire fields and order are part of the contract:

```text
magic             4 bytes ASCII: WSR1
envelope_version  unsigned 32-bit integer, big-endian: 1
suite_id          unsigned 32-bit integer, big-endian: 1 = AES-256-GCM-1
key_epoch        unsigned 64-bit integer, big-endian
record_generation unsigned 64-bit integer, big-endian
record_schema     unsigned 32-bit integer, big-endian
nonce             12 bytes, generated by the CSPRNG for this encryption
ciphertext_len    unsigned 64-bit integer, big-endian
ciphertext        exactly ciphertext_len bytes, including the 16-byte AES-GCM tag
```

The fixed routing header is exactly 52 bytes in the order above: offsets `0..3` magic,
`4..7` envelope version, `8..11` suite ID, `12..19` key epoch, `20..27` record generation,
`28..31` record schema, `32..43` nonce, and `44..51` ciphertext length. `ciphertext_len` must be
at least 16 and must equal the remaining file length; Core also applies a configured maximum before
allocating. The tag is the final 16 bytes of the standard AES-GCM ciphertext representation. There
is no trailing field or implicit endianness.

#### 6.1.2 Normative parser bounds

Version 1 uses the following exact limits. They are protocol constants, not implementation hints;
all Core and adapter implementations reject a value before allocating memory for it, and a larger
accepted value requires a new envelope or journal version with an explicit compatibility rule.

| Field or collection | Version-1 maximum | Parsing rule |
|---|---:|---|
| `ciphertext_len` / whole protected record | `64 MiB`, including the 16-byte tag | Reject values below 16, above the limit, or unequal to the remaining byte count before allocating the ciphertext buffer. Larger records use an admitted chunked envelope. |
| One length-delimited AAD field (`domain`, `record_class`, `logical_record_id`, `project_id`) | 64, 64, 512, and 128 UTF-8 bytes respectively | Decode the length, compare with the field-specific limit and remaining input, then allocate/decode. Invalid UTF-8 is rejected. |
| Canonical AAD | `4096` bytes total | Reject before constructing the AAD buffer if fixed fields plus length-delimited fields exceed the limit. |
| `operation_id` | 128 UTF-8 bytes | Journal and staging parsers reject an over-limit or invalid value before allocation. |
| Non-secret key/epoch reference | 256 bytes | The key provider and journal reject an over-limit reference before allocation; key material is never parsed from the record. |
| One journal record entry | 1 KiB | Reject an entry whose encoded fields exceed the bound before materializing it. |
| Journal page | 4096 entries | Process pages incrementally; reject a larger page before allocating its entry list. |
| Complete migration inventory | 1,000,000 entries | Inventory is paged/streamed and counted with a checked counter; a larger inventory is `RECOVERY_REQUIRED` or requires a later admitted journal version. |
| Journal/checkpoint encoding | 16 MiB | Reject before allocating a complete journal buffer; implementations must use paged checkpoints for larger inventories. |

The same limits apply to equivalent adapter encodings, including logical IDs embedded in staging,
marker, pointer, and journal records. A malformed or oversized length is a format error, never a
reason to fall through to legacy plaintext parsing. Implementations must use checked arithmetic for
length-plus-header calculations so integer overflow cannot bypass these bounds.

The following header fixture is normative for parser tests (the nonce is test-only and must never be
used by production randomness): envelope version `1`, suite `1`, key epoch `7`, record generation
`3`, record schema `1`, nonce `000102030405060708090a0b`, ciphertext length `19`:

```text
57535231 00000001 00000001 0000000000000007 0000000000000003
00000001 000102030405060708090a0b 0000000000000013
```

Gate 1 must add the corresponding fixed-key AEAD vector, canonical AAD bytes, and expected tag to
the headless Core test fixtures. The fixture must cover an absent and a present `project_id`; this
document's field encoding is the authority those vectors must implement.

### 6.1.1 Normative record-class registry

`record_class` is an ASCII registry token, not a human-readable inventory label. The following
tokens are normative for version 1 and are serialized exactly as length-delimited UTF-8 strings in
AAD:

```text
project          project-metadata   snapshot          backup
recovery         settings           credential        image
asset            asset-metadata     codex             rag-index
active-project   authority-root     key-epoch         record-commit
migration        staging            migration-stage   diagnostic
scene-comments   scene-revision     plot-ui            mind-map-ui
progress         proforge-memory    proforge-history  inference-cache
lora             telemetry          worker-dlq
```

The mapping is one token to one contract row or explicitly paired subrecord; aliases and locale
labels are never accepted as tokens. A token is immutable once emitted. Adding a class requires a
new registry entry and compatibility rule; removing one requires retaining its refusal/migration
behavior for all supported envelope versions. An unknown class token is
`PROTECTED_UNSUPPORTED_VERSION`, never an unbound generic record.

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
record_class = exact registry token
logical_record_id = exact registry identity
project_id = u8(0) when absent; u8(1) + length-delimited string when present
header = the exact 52-byte routing header, including envelope_version, suite_id, key_epoch,
          record_generation, record_schema, nonce, and ciphertext_len
```

The canonical AAD byte sequence is the following fixed order: `u32be(byte_length) + UTF-8 bytes`
for `domain`, `record_class`, and `logical_record_id`; the one-byte `project_id` presence marker
and optional length-delimited UTF-8 project ID; then the exact header bytes. The header is the
single serialization of the version, suite, epoch, generation, schema, nonce, and ciphertext
length fields: those fields are not serialized a second time as standalone AAD values. All integer
encodings are unsigned big-endian. Lengths are checked against Core limits before allocation. There
are no implicit separators, locale conversions, JSON key ordering, or omitted-field guesses. The
same logical record context and header are required for encrypt and decrypt. Replacing `project-A`
with `project-B`, a snapshot with an image, one epoch with another, or one generation with an older
value causes authentication or authority validation failure before payload use. Paths and display
titles are deliberately absent.

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

Read routing is authority-first. Core first resolves the committed record marker and authority-root
or migration journal state to obtain the expected epoch for the requested logical identity. It then
parses the fixed header and compares its `key_epoch` with that expected epoch before asking the key
provider for material. A routed envelope whose epoch does not match the committed expectation is
`PROTECTED_TAMPERED` (or `RECOVERY_REQUIRED` when the authority evidence itself conflicts); it is
never used to select a key. Only a matching epoch is resolved: a locked session returns
`PROTECTED_LOCKED`, an unavailable expected key returns `PROTECTED_WRONG_KEY`, and authentication
failure with that expected key returns `PROTECTED_TAMPERED`. This prevents attacker-controlled
header routing from turning an unknown epoch into an apparently ordinary wrong-key retry.

## 7. Read and parse outcomes

The Core returns typed semantic results rather than `string | error`:

| Outcome | Meaning and required behavior |
|---|---|
| `NOT_PROTECTED_LEGACY` | Known legacy plaintext encountered in an unlocked migration-capable state; it may be queued for an explicit journaled conversion. It is not evidence that the record is absent. |
| `PROTECTED_READABLE` | Current or explicitly supported envelope authenticated, decoded, and passed record validation. |
| `PROTECTED_LOCKED` | Secure mode is configured but the session has no usable key. No plaintext or ciphertext payload is returned. |
| `PROTECTED_WRONG_KEY` | The required key identity/epoch cannot be resolved, or an explicit supplied key fails the durable verifier. Do not retry indefinitely. |
| `PROTECTED_TAMPERED` | Expected key is available but AEAD/AAD authentication fails; includes modified ciphertext, header, AAD, or cross-record substitution. |
| `PROTECTED_UNSUPPORTED_VERSION` | Future envelope, suite, record class, or record schema cannot be interpreted safely. Never parse it as legacy plaintext or relabel it as corruption. |
| `PROTECTED_CORRUPT` | Truncated, malformed, invalidly encoded, or authenticated bytes whose payload cannot be decoded. |
| `PROTECTED_IDENTITY_MISMATCH` | An authenticated authority/commit marker maps the located physical generation to a different requested logical identity before payload use. Preserve both copies and require recovery. A bare AEAD failure under the requested context is `PROTECTED_TAMPERED`, because the envelope intentionally does not expose identity as plaintext. |
| `PROTECTED_DELETE_PENDING` | An authenticated delete intent is durable but the tombstone commit is not complete. Return no payload and the operation's transitional status; reads do not recreate defaults or bypass the delete fence. |
| `PROTECTED_DELETED` | An authenticated tombstone is durable. Return no payload and stable logical absence; physical retention/recovery bytes may remain, but ordinary reads and default creation do not resurrect the record. |
| `MIGRATION_REQUIRED` | The record is a supported legacy/current format that cannot be used under the current authority until a journaled migration completes. |
| `RECOVERY_REQUIRED` | Journal, commit markers, ownership evidence, or verification state is inconsistent. Ordinary writes and destructive cleanup are blocked. |

A key-unavailable result is not silently relabeled as corruption, and a parse/authentication
failure is not silently relabeled as absence. If the parsed `record_schema` is not in the Core
compatibility registry, the result is `PROTECTED_UNSUPPORTED_VERSION` even when the envelope and
suite are known. If AEAD failure occurs after the expected key is
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

### 8.4 Record generations and commit authority

Every protected logical record has a monotonically increasing `record_generation` starting at `1`.
The value is authenticated in the envelope header/AAD and is recorded in the protected
`record-commit:<logical-record-id>` marker together with the active epoch, content digest, and
commit state. An ordinary write is admitted only when its expected active generation matches the
marker; it allocates the next value under the same admission and compare-and-swap boundary. A
generation counter reaching its maximum is a recovery error, not a wrap to zero.

The marker supports `ABSENT`, `ACTIVE(old)`, `PENDING(old -> new)`, `DELETE_PENDING`, `TOMBSTONED`,
and `RECOVERY_REQUIRED` states. A first-time record follows the same fenced authority protocol:
`ABSENT -> PENDING(none -> 1) -> ACTIVE(1)`. Before `PENDING`, no generation is authoritative;
while pending, no payload is readable as the new record; after the authenticated `ACTIVE(1)` marker
is durable, generation `1` is authoritative. If this creates the first root or changes its digest,
the root commit is part of the same authority transition. The old
generation remains the active authority while `PENDING` is durable. A new generation is promoted
under a generation-addressable physical name, then the marker is durably advanced to `ACTIVE(new)`.
The authority manifest separately selects the active storage epoch and is switched only by the
migration/rotation commit protocol. These control records are protected and included in the
inventory; they are not mutable plaintext sidecars.

The authority-root manifest does not duplicate every record's generation. It anchors the active
storage epoch and carries a digest of the sorted authenticated record-marker set (logical identity,
marker generation, epoch, and state). Each `record-commit` marker remains authoritative for exactly
one logical identity. A read requires the envelope generation and epoch to match that marker, and
the marker-set digest to match the committed root (or the matching migration journal view).
Independent records may therefore advance generations independently without weakening root-level
rollback detection.

Outside a migration, Core requires the authenticated record generation and epoch to match both the
committed record marker and the authority-root manifest. A valid older ciphertext for the same
identity and epoch is therefore classified as stale/recovery-required rather than accepted after
rollback. A record with no committed marker is not made authoritative by its existence; it is
preserved for recovery. A current marker with a missing/invalid candidate never causes defaults or
another generation to be written over the old authority.

During `MIGRATING(source=N,target=M)`, the authenticated journal is a temporary Core read
authority. For a requested logical record, a `VERIFIED_TARGET` checkpoint whose target marker,
generation, epoch, operation ID, and fencing generation all match the journal permits Core to read
the target `M` generation before the global authority-root switch. Every other record is read from
the still-authoritative source `N` while its marker and journal state permit it. The renderer never
chooses an epoch, and a target-looking file without the matching journal/marker evidence is not
read. Marker activation and the `VERIFIED_TARGET` checkpoint are one fenced read-authority
transition: `PENDING`/`READ_AUTHORITY_PENDING` is not readable as target authority, and the
exclusive fence remains held until the marker and checkpoint/authority state are both durable. If
the process crashes between their physical writes, startup reconciles under the fence by completing
the matching checkpoint or restoring `ACTIVE(old)` while preserving the verified candidate. No
reader observes a target generation without its checkpoint. After `COMMIT` durably advances the
authority root, all reads resolve to `M`; after `FINALIZE`, the temporary dual-epoch rule is no
longer needed.

### 8.5 Authenticated deletion authority

Deletion is an authenticated logical transition, not an unlink-first filesystem operation. An
explicitly admitted user delete (or a separately authorized migration cleanup) creates a protected
`DELETE_PENDING` marker containing the logical identity, active generation, operation ID, fencing
generation, and retention policy. Core syncs that intent while the prior generation remains
recoverable, then durably commits a `TOMBSTONED` marker under the same fence. Only after the
tombstone and required directory metadata are durable may physical generations, staging copies,
or retained recovery copies become eligible for cleanup. The tombstone is itself bound to the
record identity and epoch/generation context; it cannot be substituted between records.

On restart, a crash before the tombstone leaves the old generation active; a durable tombstone
makes the identity logically deleted while bytes remain subject to the retention/recovery policy;
an uncertain marker or fence result returns `RECOVERY_REQUIRED`. Resume is idempotent. Deletion
never creates a default replacement, re-enables a legacy plaintext copy, or deletes quarantine and
backup evidence automatically. Old-key retirement and physical cleanup must wait for the same
retention boundary used by migration. A future purge operation is a separate explicit policy and
must not be conflated with ordinary record deletion.

Read behavior is part of the deletion contract: while `DELETE_PENDING` is committed, Core returns
`PROTECTED_DELETE_PENDING` with the operation status and no payload; after `TOMBSTONED` is committed,
Core returns `PROTECTED_DELETED` with no payload. Retained generations are recovery material, not
ordinary read candidates, and a normal read never recreates a default record from either outcome.

## 9. Durable protected write contract (#357)

For a new or replacement protected record, Core semantics are:

1. Resolve record identity, current authority, expected generation, target epoch, and admission
   state together.
2. Durably record a protected `PENDING(old -> new)` commit intent while the old generation remains
   active; for a new record use `PENDING(none -> 1)` from `ABSENT`. The intent includes operation
   ID, fencing token, target generation, and digest.
3. Serialize and authenticate the payload; materialize ciphertext to a unique same-directory
   staging target. No plaintext staging file is allowed.
4. Write all staged bytes and verify the expected byte count/format.
5. Flush/sync the staging file to the required durability level and close it.
6. Validate the staged envelope by parsing/authenticating it against the exact target identity,
   epoch, schema, and generation.
7. Promote the staging file to an immutable, generation-addressable record without removing the
   old active generation.
8. Flush/sync the containing directory or platform-equivalent metadata required to persist the
   promoted generation.
9. Atomically replace/sync the protected commit marker from `PENDING` to `ACTIVE(new)`; only this
   marker change transfers ordinary record authority. For a migration target, the marker change and
   its `VERIFIED_TARGET` journal/read-authority checkpoint are one `with_fence` transition: retain
   `READ_AUTHORITY_PENDING` and block target reads until both are durable, or return recovery if the
   adapter cannot provide that fenced semantic.
10. Only after the marker, its containing directory, and any required migration checkpoint are
    durable return `DURABLE_COMMIT_SUCCESS` and advance the authority manifest when applicable.
11. Reconcile stale staging deterministically on startup using authenticated generation/operation
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
| Before first `PENDING(none -> 1)` marker | Record remains `ABSENT`; no default or replacement authority is created. |
| After first pending marker, before `ACTIVE(1)` | No record payload is authoritative; resume or roll back the pending operation under the fence without discarding unrelated data. |
| After `ACTIVE(1)` marker and required root commit | Generation `1` is authoritative; restart verifies the root/marker digest before serving it. |
| Before staging write | Old authority remains valid; retry can start a new generation. |
| During staging write | Old authority remains authoritative; incomplete staging is untrusted and reconciled. |
| After staging write, before file sync | Staging is not committed; old authority remains. |
| After file sync, before promotion | Complete staging may be verified/adopted by the journal or discarded; old authority remains until commit. |
| After promotion, before directory sync | Old marker remains active; the new generation is preserved and not yet authoritative. |
| After directory sync, before marker advancement | New bytes are durable but marker metadata is stale. Startup validates the authenticated pending intent and completes the marker, or restores `ACTIVE(old)` while preserving the candidate for recovery. It never guesses from timestamps. |
| After marker advancement, before migration checkpoint/manifest advancement | The migration read authority is `READ_AUTHORITY_PENDING` under the fence; no reader selects the new target. Startup completes the matching checkpoint or restores `ACTIVE(old)` while preserving the candidate, then releases the fence. Ordinary non-migration writes may treat their already-durable marker as authoritative. |
| After journal/manifest advancement | New authority is durable; cleanup remains separately retryable. |
| During cleanup | Authority is unchanged; cleanup can resume without deleting the committed generation. |

The post-directory-sync/pre-marker rule is normative: startup first authenticates the durable
`PENDING` intent and candidate generation. If both match, it idempotently completes the commit
marker and, for migration, the matching journal/manifest checkpoint while holding the same fence.
If the candidate is missing, malformed, or fails authentication, it restores `ACTIVE(old)` and
preserves the candidate/staging bytes for recovery. An unrecognized candidate is never adopted
solely because it is newer or has a plausible filename.

## 10. Crash-resumable migration and rekey (#359)

### 10.1 Journal contract

The journal is a durable Core record with no key material and no plaintext project payload. It
contains:

- `operation_id` and journal format version;
- operation type: `enable`, `rotate`, or envelope/schema migration; an explicit disable operation
  is not admitted by this contract;
- source and target epoch identities and target verifier reference where applicable;
- deterministic inventory version/digest and bounded record count estimate;
- per-record status or a resumable cursor, staging generation and verification result;
- commit/finalization state, last durable checkpoint, and recovery-required reason code;
- ownership/lease information, a monotonic fencing generation, and compare-and-swap journal
  revision sufficient to prevent stale migration owners from mutating records.

The inventory is streamed or paged. The entire project and full record list are never required in
memory. A checkpoint is written only after the corresponding record conversion and verification
are durable.

Every checkpoint, record promotion, commit-marker update, and authority switch carries the current
fencing generation and expected journal revision. The Core/adapter rejects a stale token
(`STALE_MIGRATION_OWNER`) before mutation. Lease expiry makes a new owner eligible but is not by
itself permission for the old owner to continue; a new owner must atomically advance the fencing
generation. This prevents a stalled process that resumes after lease expiry from overwriting a
new owner's checkpoint or promoted record.

A token check performed as a separate preflight is insufficient. Every mutation-capable adapter
operation therefore exposes the semantic equivalent of
`with_fence(fencing_generation, mutation_and_durability)`: it acquires the cross-process migration
lock, compares the expected token/revision, performs the promotion or marker update and required
syncs, and releases the lock only after the mutation's durability result is known. A platform that
cannot hold that fence through the mutation must return `RECOVERY_REQUIRED` rather than rely on a
stale preflight check. The Core still records the token on each operation for crash recovery, but
the lock/CAS is the authority that prevents an expired owner from resuming a previously authorized
filesystem mutation.

### 10.2 Bootstrap for first-time enable

Enabling protection from `UNCONFIGURED` cannot first write a plaintext journal and cannot encrypt a
journal before a target key exists. The operation therefore has an explicit `BOOTSTRAP_TARGET`
step before the first protected `DISCOVER` checkpoint:

1. The key adapter creates/resolves target epoch `M` and stores only its key reference/material in
   the approved keystore or passphrase adapter; no raw key is written to the data directory.
2. The adapter durably stores only the non-secret epoch/key reference and verifier through the
   approved keystore or passphrase adapter; Core establishes the protected journal key context.
   The first protected control record is encrypted under `M`, so no plaintext journal or data-
   directory key record is needed. If key preparation fails, no migration journal is claimed and
   the known legacy authority remains untouched.
3. Core writes the first journal under target epoch `M`, with source authority explicitly marked
   `LEGACY` and state `MIGRATING(source=LEGACY,target=M)`. Legacy project data remains authoritative
   until the later `COMMIT` phase.

The bootstrap epoch is not active project authority merely because it protects the journal. A crash
before `COMMIT` resumes from the journal or returns an explicit recovery result; it never interprets
the absence of a target record as permission to write defaults.

### 10.3 Migration phases

| Phase | Durable before/after; crash view | Resume/rollback; reads/writes |
|---|---|---|
| `BOOTSTRAP_TARGET` | Target key reference/verifier and the first protected journal are durable; legacy records are unchanged and remain authoritative. | If preparation fails, remain `UNCONFIGURED` with legacy data untouched. If the process crashes, resume the same operation or enter recovery. Reads use legacy authority; no ordinary record writes occur before the journal exists. |
| `DISCOVER` | Journal operation ID and a preliminary deterministic inventory identity are durable; records are not changed. | Resume re-runs discovery. The preliminary inventory is not sufficient for commit; a changed/unverifiable inventory enters recovery. Reads use the existing authority; ordinary writes may occur only before the final barrier. |
| `PREPARE` | Target key/verifier, staging namespace, and source/target policy are durable. | Idempotently reuse the same target epoch and operation. No old authority is deleted. Reads use source; ordinary writes stop once admission is acquired. |
| `ADMIT` | Exclusive migration ownership and write barrier are durable; only now is the final streamed inventory snapshot and digest captured. | The final inventory includes records created before the barrier and becomes the commit inventory. If ownership is lost, restart claims the same journal only after lease expiry and fencing CAS. No ordinary writes cross the barrier; reads remain Core-selected. |
| `CONVERT` | Each record is ciphertext-staged, synced, promoted, marker-committed, verified, then checkpointed with the current fencing generation. | Already checkpointed records are verified/replayed idempotently; pending records retain source authority. A stale owner is refused before mutation. No rollback deletes source or target. During migration, Core reads a record from target only under the `VERIFIED_TARGET` journal/marker/fence rule in §8.4; otherwise it reads the source. |
| `VERIFY` | All inventory records have been read under target policy and verified; journal records the exact result. | Any shortfall becomes `RECOVERY_REQUIRED`; no epoch switch or cleanup. Ordinary writes remain blocked. |
| `COMMIT` | All final-inventory records and their generation markers are verified; the active epoch/authority pointer and commit marker are atomically/durably switched with the fencing generation. | Before the switch, source remains authoritative. After a durable switch, target is authoritative; startup never guesses from file timestamps. Reads follow the committed epoch; writes use target only. |
| `RETIRE_OLD_AUTHORITY` | Target is committed and verified; old copies/keys are still retained until this phase succeeds. | Cleanup is retryable and non-destructive to target. If deletion/retirement is uncertain, remain recoverable rather than claim completion. |
| `FINALIZE` | Journal says commit, verification, and permitted cleanup are complete; no key material is stored in the journal. | Remove only fully finalized operational debris. A stale journal is reconciled, not ignored. Ordinary operations resume after finalization. |
| `DONE` / `RECOVERY_REQUIRED` | `DONE` is durable terminal success. `RECOVERY_REQUIRED` is durable terminal refusal with a reason code. | `DONE` permits normal policy. `RECOVERY_REQUIRED` blocks ordinary writes and destructive cleanup until explicit recovery; never resets to defaults. |

### 10.4 Operations

- **Enable:** discover known healthy legacy plaintext while unlocked, convert every admitted
  protected class, verify, then commit the first protected epoch. A corrupt or ownership-ambiguous
  legacy record is preserved and marked for recovery; it is not replaced with an empty/default
  record.
- **Rotate:** source and target epochs are both available, records are re-enveloped with fresh
  nonces and target AAD, and the target epoch is switched only after complete verification.
- **Disable:** not admitted by this contract. Producing an internal legacy plaintext generation
  would conflict with the no-plaintext-sibling rule during the preserve-first commit window. Core
  must return an explicit unsupported/locked result and retain the protected authority. A future
  product decision may define an external-export-only disclosure flow, but it must not silently
  become an internal downgrade or delete the protected source.
- **Envelope/schema migration:** changes format or record schema under an operation ID without
  changing logical identity. An unknown future version is refused, not migrated by guessing.
- **Delete:** creates and durably commits an authenticated `DELETE_PENDING`/`TOMBSTONED` transition
  under the record fence before any physical cleanup. It is idempotently resumed and never writes
  defaults over the deleted record; uncertain cleanup remains recoverable.

Core-owned future backup records use `backup:<backup-id>` and enter the final migration inventory
only when the Core has an explicit ownership record. Existing `libraryBackupService.ts` encrypted
ZIPs are user-selected external artifacts classified as `MIGRATION_INPUT_ONLY`; they are never
auto-discovered as live Core backups or converted merely because they are present on disk. Reading
or converting one requires an explicit user operation and a separate import/ownership check.

### 10.5 Legacy plaintext and corruption

Discovery distinguishes known healthy legacy plaintext, unknown shape, corrupt/unreadable data,
already protected legacy envelopes, current envelopes, orphan staging, quarantine, and journals.
Only a recognized, ownership-verified legacy record is a migration candidate. A corrupt legacy file
is preserved, optionally quarantined under a recovery identity, and surfaced as recovery-required
or per-record migration failure. Migration may continue independent records only when the journal
can prove that doing so cannot hide or overwrite the failed record.

## 11. Unified admission model (#360)

The Core owns one admission authority for ordinary reads, ordinary writes, migration, rotation,
enable, the explicitly refused disable operation, and shutdown. The mechanism may be a Rust async
reader/writer gate plus a durable journal lease; it need not copy browser Web Locks.

`enable` is admitted through the journaled state machine. `disable` is an explicit refusal state in
R-15 (`unsupported/locked`) until a separate product/security decision defines a safe non-plaintext
contract; it is not an unimplemented fall-through that may read or write legacy data.

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
| Delete pending/tombstoned record | Return `PROTECTED_DELETE_PENDING` or `PROTECTED_DELETED` with no payload; do not recreate defaults or treat retained bytes as ordinary authority. |
| Crash before delete tombstone | The old generation remains active and recoverable; retry the same delete operation or return recovery. |
| Crash after delete tombstone | The identity is logically deleted; retain bytes until the authenticated retention/finalize boundary, then cleanup may resume idempotently. |
| Uncertain delete marker/fence result | `RECOVERY_REQUIRED`; never guess whether deletion committed and never recreate defaults. |
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
delete_record(class, logical_id, project_scope?) -> durability result
query_secure_storage_state() -> key/epoch/migration state
unlock(input) / lock()
  begin_enable() / begin_rotation()
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
9. Delete intent/tombstone transitions are authenticated, idempotent, and preserve the prior
   generation until the explicit retention/finalization boundary.
10. Parser bounds are enforced before allocation, oversized lengths cannot overflow checked
    arithmetic, and an unsupported size/version never falls through to plaintext parsing.
11. `DELETE_PENDING` and `TOMBSTONED` reads return their typed no-payload outcomes; neither state
    recreates defaults or exposes retained generations as ordinary authority.
12. A first write follows `ABSENT -> PENDING(none -> 1) -> ACTIVE(1)`, and a migration reader never
    observes a target marker without its matching verified checkpoint under the same fence.

## 17. Reconciliation of current TypeScript mechanisms

| Current mechanism | S5 classification | What may carry forward |
|---|---|---|
| `storageEncryptionService.ts` AES-256-GCM, typed locked/wrong-passphrase/corrupt errors | **SEMANTICALLY_REUSABLE**, **TEST_FIXTURE_REUSABLE** | AEAD/authentication concepts and explicit failure distinctions. The WebCrypto API and IDB byte layout are not the Core authority. |
| `encryptionMigrationJournal.ts` and `protectedStoreMigration.ts` | **SEMANTICALLY_REUSABLE**, **TEST_FIXTURE_REUSABLE** | Durable operation phases, ownership lease, checkpoints, replay-safe batches, verification and recovery-required state. Native fs durability and one unified Core admission still must be implemented. |
| `protectedWriteAdmission.ts` | **SEMANTICALLY_REUSABLE** | Shared/exclusive and key-resolution-through-commit invariant. Browser Web Locks/fallback code is not copied into Rust. |
| `secureRecordCodec.ts` | **TEST_FIXTURE_REUSABLE** | Explicit structured-clone/binary preservation lessons. It is not the native envelope or a complete project schema. |
| `fsCore.ts#encryptText/decryptText` | **TRANSITIONAL_ONLY / MUST NOT BE CARRIED AS AUTHORITY** | Current history and migration detection only. Its path-derived/legacy payload lacks the R-15 identity contract. |
| `libraryBackupService.ts` | **MIGRATION_INPUT_ONLY** | Explicit user backup boundary and existing backup test vectors. Its ZIP/PBKDF2 format is not the native record envelope. |
| IDB stores and `idbKeyStore.ts` | **TRANSITIONAL_ONLY** | Browser/PWA storage remains an independent authority; common semantic vectors may be shared. Packaged Tauri WebView localStorage/IndexedDB records that are listed as `PROTECTED` in §3 are included in the native desktop authority-switch inventory and cannot be left plaintext or unknown when that switch is admitted. No browser/PWA authority switch is implied. |

## 18. Browser/IDB relationship

The browser/PWA and desktop Core share concepts—authenticated records, key epochs, locked state,
journals, redaction, and preserve-first recovery—but retain separate storage implementations.
Browser-only IDB stores and WebCrypto envelopes may remain optimized for PWA queries. A packaged
Tauri WebView is part of the native desktop product: every packaged-desktop `PROTECTED` localStorage/
IndexedDB class in §3 must be included in the R-15 authority-switch inventory and must have an
explicit adapter migration or refusal state before desktop protection is declared active. Native
Core records use the identity-bound R-15 envelope and platform durability contract. Cross-platform
golden vectors are useful only where the exact primitive/AAD/KDF profile is intentionally shared; a
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
5. **Inventory-complete migration:** admit every `PROTECTED` class from §3 that exists in packaged
   desktop, including current Tauri WebView localStorage/IndexedDB records, `backup:<backup-id>`
   records, quarantine, diagnostics, and derived content indexes. Each class needs a Core or
   explicitly owned WebView adapter migration/refusal result; a desktop authority switch cannot
   skip a plaintext, unknown, or unmigrated packaged class. Explicitly exclude existing
   user-selected `libraryBackupService.ts` ZIPs until an explicit import operation; prove no
   plaintext sibling path remains.
6. **Shadow/compatibility phase:** compare Core verdicts with current TS reads without switching
   authority; run packaged Tauri acceptance and the relevant #332 durability/background scenarios.
7. **Explicit authority switch:** only a separately authorized release migration may change all
   packaged-desktop readers/writers, including WebView adapters, preserve legacy recovery, and
   update security/release documentation. Browser/PWA authority remains independent.

Each gate must re-run the relevant #357/#359/#360/#361 evidence and must not mark the next gate
complete merely because a design document exists.

## 21. S5 admission decision

The contract is implementation-ready at the semantic level:

- protected records and alternate representations are enumerated;
- logical identity is separated from path/title and bound through canonical AAD and exact byte
  encoding;
- envelope, key/epoch, parse, failure, and downgrade semantics are explicit;
- durable writes, generations/commit markers, migration/rekey, admission, lock, recovery, and
  memory bounds are defined;
- Core versus platform responsibilities and headless tests are explicit;
- #357/#359/#360/#361 have implementation owners and closure evidence.

This is **`DESIGN_ADMITTED / CONTRACT_DEFINED / IMPLEMENTATION_NOT_STARTED`**. Current desktop
filesystem authority remains unchanged and current user data is not retroactively encrypted by S5.
