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
| API/provider credentials | Active desktop path is `storageService` → WebView IndexedDB `idbKeyStore`; legacy `$APPDATA/config/<provider>_key.enc.json` files are cleanup-only and new FS writes throw. | Credentials are secrets. Current random-key IDB protection is separate from R-15 and the old path-derived filesystem helper is not an authority. Source classification for migration is `FOREIGN_PROTECTED` under `source_scheme_id = CREDENTIAL_IDB_KEYSTORE_V1` (§10.1.2). | **PROTECTED**; not regenerable. | `credential:<provider>` in the owning secure key store. Native Core may use an OS keystore or passphrase adapter, but the renderer never receives raw key material. Migration must explicitly handle existing IDB/WebView credentials; no silent cross-authority copy. Migration disposition (§10.4.1) is `RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY` unless a future decision selects `MIGRATE_TO_APPROVED_NATIVE_SECRET_AUTHORITY`; it is never `MIGRATE_TO_R15` merely because credentials are classified `PROTECTED`, and Gate 7 (§20) may not claim complete packaged-desktop protection while this disposition is unset. |
| Global images | `FsAssetStore`; `$APPDATA/images/<sanitized-id>.png`; image save/get/delete. | Avatar/ambiance image bytes are user-provided content; image IDs and MIME/data-URL metadata can identify project material. Current files are plaintext base64 text despite the `.png` suffix. | **PROTECTED**; authoritative user asset, not regenerable. | `image:<image-id>` because current storage is global and IDs are the current stable lookup key. Do not add project scope unless it becomes a persisted invariant; bind the exact image ID. |
| Binder binary assets | `FsAssetStore`; `$APPDATA/projects/<safe-project-id>/binder/<asset-id>.bin`; save/get/delete/list. | PDFs, images, audio and other research files can contain authored or private source material. Included in library backups and recursively preserved by quarantine. | **PROTECTED**; authoritative attachment, not regenerable. | `asset:<project-id>:<asset-id>`; project scope and asset ID are both required. Migration must treat binary and metadata as one logical generation, not two independently successful records. |
| Binder asset metadata | Same binder directory, `<asset-id>.meta.json`; `getBinderAsset` pairs it with `.bin` and checks byte size. | MIME type, original filename and byte size can reveal sensitive context; mismatch currently signals corruption. Included in backups/quarantine. | **PROTECTED**; not independently regenerable without losing provenance. | `asset-metadata:<project-id>:<asset-id>` is distinct from the bytes identity and is joined by an authenticated `asset-pair:<project-id>:<asset-id>` commit marker. Migration must never expose either member as a complete asset without the committed pair. |
| Story Codex | `FsCodexStore`; `$APPDATA/projects/<safe-project-id>/codex/codex.snap`; save/get/delete. | Derived entities, mentions, excerpts, summaries and relationships may reproduce manuscript content. Included in backups and may be rebuilt from a project, but rebuilding is not lossless. | **PROTECTED**; derived but content-sensitive and regenerable only from still-available source. | `codex:<project-id>` plus an explicit derivation/version if split. Protect it even when marked derived; no plaintext sibling is permitted. |
| RAG/vector/index payloads | `FsCodexStore`; `$APPDATA/projects/<safe-project-id>/codex/vectors.snap`; save/get/delete. | Embeddings and index metadata are content-derived and can support disclosure or cross-project confusion. Current vectors have no embedded provenance, so the project path is the only owner signal. | **PROTECTED** for any persisted native copy; computationally regenerable. | `rag-index:<project-id>:<index-version>`; project scope is mandatory because current payload lacks provenance. Migration must reject unowned vectors rather than guess ownership. |
| Task metadata | Tauri `task_supervisor` handles bounded requests/results in memory; no native persistent task journal is currently written. | Current task IDs, type, timing and errors are transient; future resumable task payloads could contain user text or paths. | **DERIVED_REGENERABLE** for the current transient class; no native record to migrate. A future persisted task record becomes **PROTECTED** if it carries content or resumability authority. | Future `task:<task-id>`; admission requires an explicit persistence contract before adding files. Do not infer R-15 coverage from current in-memory handling. |
| Worker dead-letter entries | `packages/worker-bus/src/deadLetterQueue.ts`; IndexedDB `worldscript-dead-letter-db/dead_letters`; failed `WorkerTask` requests and `TaskResult` entries are persisted best-effort up to a bounded capacity. | Task payloads, generated results, error details, worker IDs and retry metadata can contain prompts, manuscript text, paths or provider context. Persistence is not harmless merely because entries are bounded or retryable. | **PROTECTED**; current WebView persistence is separate from future native Core authority and is not regenerable without losing failure evidence. | `worker-dlq:<installation-scope>:<task-id>`; task ID is immutable and installation scope is explicit. A future migration must redact or protect payload/result/error fields and preserve entries until their retention policy permits cleanup. |
| Active-project marker | `FsProjectStore`; `$APPDATA/config/active-project-id.txt`; save updates it and boot reads it. | Looks like metadata, but legacy IDs can be title/path-derived and reveal project linkage; a wrong marker can route reads to the wrong project. | **PROTECTED**; small authoritative routing metadata, not safely regenerable from content. | `active-project:<scope>`; bind the referenced project ID and marker schema. Migration must preserve it or fail closed rather than select a default project. |
| Secure-storage authority manifest and record catalog | No native record exists on `main`; future Core owns the active epoch, authority generation, record-root mapping, commit state, and a protected paged catalog/index of owned records. | These values decide which protected generation is authoritative, enable authenticated enumeration, and can expose project/storage topology. | **PROTECTED**; security-critical control state, not regenerable after a crash. The catalog is bounded/paged rather than an in-memory or plaintext filename listing. | `authority-root:<scope>` plus `record-catalog:<scope>:<shard>`; storage-root scope is path-independent. Migration must durably switch the root and catalog only after target verification. |
| Key-epoch registry and verifier references | No native record exists on `main`; future Core/key adapter must persist non-secret epoch status, key identity references, and verifiers. | Epoch status and verifier metadata control key lookup and locked/recovery behavior; raw key material is never stored here. | **PROTECTED**; required control state, not regenerable without the key provider. | `key-epoch:<scope>:<epoch>`; epoch identity is immutable and survives path relocation. Migration must create and verify a target epoch before conversion. |
| Record-generation and commit markers | No native record exists on `main`; future Core must track active/pending generation and commit intent per protected logical record. | A valid older ciphertext for the same identity can otherwise pass AEAD after rollback. Pending/active markers also decide deterministic crash recovery. | **PROTECTED**; authenticated authority metadata, not regenerable from record content alone. | `record-commit:<record-class>:<logical-record-id>`; the class-qualified marker binds identity, epoch, generation, operation and the content-digest presence/value. Migration must retain the prior active generation until the new marker is durable. |
| Migration journals/checkpoints | No native FS journal exists on `main`; the existing `encryptionMigrationJournal.ts` is IDB-only. Future Core journal is the authority for native migration. | Operation ID, epochs, record inventory/cursor, per-record state and recovery status can reveal project structure and must never contain plaintext or keys. | **PROTECTED**; operationally required, not regenerable after a crash. | `migration:<operation-id>` for the journal root/manifest, plus paged `migration-page:<operation-id>:<page-index>` child envelopes (§10.1.1) once the checkpoint or inventory is paged; journal format/version is separate from project schema and envelope version. Migration must write/checkpoint it durably before touching records, and the manifest's authenticated page-set digest — not directory enumeration — is authoritative for which pages exist. |
| Atomic-write temporary files | `FsCore#writeAndReplace` creates sibling `<target>.tmp-<UUID>` files for text and binary writes and removes them best effort. Current content is plaintext/compressed or raw bytes. | Temporary files are alternate representations and can survive a crash. Their existence must not create a plaintext sibling of a protected record. | **PROTECTED** in the future; current unprotected implementation is a migration input/risk, not an R-15 success. | Physical staging locator only — a same-directory `<target>.tmp-<operation-id>-<generation>`-style temp name is a locator/reconciliation aid, never an independent AAD-authenticated record class (`staging` is not a §6.1.1 registry token). From the moment ciphertext exists, the candidate envelope's AAD already carries the *final* record's identity (record class, final `logical_record_id`, project scope, target epoch, target generation, §6.2); the pending commit marker (§5.4) authenticates the operation/fence relationship, not a separate staging identity. Promotion relocates the same bytes; it never re-encrypts merely because the file moves. Reconcile without deleting the only valid authority. |
| Migration staging | No native implementation currently exists. | Future conversion staging must not write plaintext temp data; it may contain ciphertext and authenticated generation metadata only. | **PROTECTED**; temporary but may contain the only converted copy during a commit window. | Physical conversion-staging locator only, journal-owned and named for reconciliation — not an independent AAD-authenticated record class (`migration-stage` is not a §6.1.1 registry token). The candidate envelope inside it already carries the target record's final AAD; the migration journal/marker (§5.4, §10) authenticates the conversion operation. Deleted only after durable commit/finalization. |
| Import staging/input | Current project import reads a user-selected external JSON/Markdown file into memory; assets can be written directly to the active backend. No internal staging file is used. | External input is an explicit user-controlled disclosure/source boundary, but an internal copied import would be sensitive project content. | **OUT_OF_SCOPE** for the current external boundary; any future internal staging is **PROTECTED**. | External file identity is not a native record identity. A Core import operation would use `import:<operation-id>` and ciphertext-only staging, with explicit ownership validation. |
| Export staging/output | JSON/Markdown/DOCX exports are built in memory and written to a user-selected external path; the encrypted library backup is listed separately. | Plaintext export is intentional user disclosure, not an internal protected sibling. In-memory buffers must be bounded and cleared by normal runtime ownership, without unsupported secure-erasure claims. | **OUT_OF_SCOPE** for explicit user-selected plaintext output; future internal staging is **PROTECTED**. | No R-15 authority identity for the external file. If a Core export operation needs staging, use `export:<operation-id>` and an explicit disclosure confirmation. |
| Logs/diagnostics | `services/diagnostics/logSinks.ts` writes bounded IDB logs and desktop JSONL at `$APPDATA/logs/worldscript-YYYY-MM-DD.jsonl`; `safeStringify` and logger redaction are current controls. | Structured errors, project IDs, paths, provider/task metadata and migration states can be sensitive even when manuscript text is prohibited. Current JSONL is not an R-15 protected record. | **PROTECTED** for desktop diagnostic persistence; bounded/derived but not harmless. | `diagnostic:<installation-scope>:<date>:<chunk-id>`; future chunks are redacted, authenticated and size-bounded. Migration must not carry raw plaintext logs into protected storage or vice versa. |
| Local AI/model caches | Local model storage and inference caches are browser/WebView or model-file caches, not current `FsProjectStore` authority. | Downloaded models are not user-authored project records; prompt/result caches may become content-sensitive if persisted. | **DERIVED_REGENERABLE** for model/cache bytes with no user content; content-bearing cache records become **PROTECTED** before native persistence. | Future `model-cache:<model-id>:<version>` or `inference-cache:<content-scope>:<key>` only after an explicit owner contract. No current native R-15 migration. |
| Service-worker/browser caches | PWA/service-worker caches and browser profile data are not native Tauri filesystem records and are owned by the browser runtime. | Static assets are generally regenerable; cached user responses may be sensitive depending on the browser feature. | **OUT_OF_SCOPE** for native R-15 authority; browser-specific protection remains its own policy. | No native identity. Do not use cache presence as project existence or secure-storage state. |
| Local-first sync document (Yjs) | `services/localFirst/docPersistence.ts` persists the Yjs update log and `services/localFirst/projectDoc.ts` projects manuscript, characters, worlds and metadata into it; active only behind the opt-in `enableLocalFirstSync` flag (ADR-0008) as a WebView IndexedDB store, with Redux remaining the declared source of truth. | The projected CRDT document mirrors complete authored manuscript, character, world and project-metadata content, so it carries the same sensitivity as the canonical project record even though it is a shadow projection. | **PROTECTED**; content-bearing shadow copy, not a disposable cache merely because Redux is the declared source of truth. | `local-first-doc:<project-id>`; bind the owning project ID. Migration must treat the update log as a project child record and must never let it become authoritative ahead of the canonical project record. |
| Analytics store (DuckDB/OPFS) | `workers/v2/duckdb.worker.ts` persists the DuckDB analytics database `worldscript_analytics.duckdb` in OPFS behind `enableDuckDbAnalytics`; `services/duckdb/duckdbSchema.ts` defines the tables/views it holds. | Project titles, loglines, character names and Codex-derived excerpts are aggregated for analytics queries; this is native content, not a disposable query cache, even though every row is derived from the canonical project record. | **PROTECTED** for the persisted OPFS database; computationally regenerable from source projects but content-bearing until regenerated. | `analytics-db:<installation-scope>`; the database aggregates multiple projects, so per-project scope is authenticated payload rather than the record's own AAD identity. Migration must protect or refuse the whole database before any authority switch; it is not a harmless cache merely because it is derived. |
| Cross-project search index | `services/crossProjectIndexService.ts`; IndexedDB `worldscript-data-db/projects-index-store`, keyed by `projectId`; `indexProject`/`listIndexedProjects`/`removeProjectIndex` read/write it and dual-write a copy into the analytics store above when `enableDuckDbAnalytics` is on. | Project titles, loglines, character names, manuscript word counts, an AI-generated summary and a semantic-search embedding vector per project; this is native content, not a disposable query cache, even though every field is derived from the canonical project record. | **PROTECTED** for the persisted IndexedDB store; computationally regenerable from source projects but content-bearing until regenerated. | `cross-project-index:<project-id>`; unlike the aggregate `analytics-db` record, this store holds one entry per project, so the project ID is the record's own AAD identity, not payload. Migration must protect or refuse each project's index entry before any authority switch. |
| Scene comments and replies | `features/sceneComments/sceneCommentsSlice.ts`; localStorage key `worldscript-scene-comments`; Redux middleware persists comment/reply bodies. | Comment bodies, replies, section IDs and resolution state are user-authored project context even though this store is outside `project.json`. | **PROTECTED**; current localStorage is a separate WebView authority and is not covered by native Core. | `scene-comments:<installation-scope>` until a project binding is added; future migration must bind every section/comment ID and preserve the current global namespace rather than guess a project. |
| Scene revision history | `services/sceneRevisionService.ts`; WebView IndexedDB `worldscript-revisions-db/scene-revisions`; current browser encryption is separate from native R-15. | Revision titles and full scene content are recoverable user data. | **PROTECTED**; independently encrypted today where the IDB policy applies, but not a native Core record. When retained under B-1's `storageEncryptionService` policy, its migration source is classified `FOREIGN_PROTECTED` under `source_scheme_id = WEBVIEW_IDB_AT_REST_V1` (§10.1.2) rather than a scene-revision-specific cipher; a record outside the IDB policy's scope remains a `LEGACY_PLAINTEXT` source. | `scene-revision:<revision-id>` with section routing authenticated separately. Migration must preserve revision identity and bounded history. |
| Plot-board and mind-map UI records | `features/plotBoard/plotBoardSlice.ts` and `features/mindMap/mindMapUiSlice.ts`; localStorage viewport/selection state. Authored connections/nodes remain in project state, but IDs and active selections persist here. | Selection, map identifiers, viewport and interaction metadata can reveal project structure; the UI state is regenerable but not harmless. | **PROTECTED** for a persisted desktop profile; it must not be treated as the project content authority. | `plot-ui:<installation-scope>` / `mind-map-ui:<installation-scope>`; future Core may omit purely ephemeral viewport fields only after proving no user intent or routing metadata is lost. |
| Writing progress and session history | `features/progressTracker/progressTrackerSlice.ts`; localStorage key `worldscript-progress-tracker`. | Goals, streaks, writing totals and session timing are personal activity metadata. | **PROTECTED**; not manuscript content but capable of sensitive disclosure and not safely reconstructable. | `progress:<installation-scope>`; import/duplicate does not silently transfer personal history. |
| ProForge memory bank | `services/proForge/proForgeMemoryBank.ts`; IndexedDB `proforge-memory-bank/entries`, keyed by entry ID and indexed by project ID. | Memory keys and content are project-specific AI context and may reproduce user text. | **PROTECTED**; current browser/IDB authority is separate from native R-15. | `proforge-memory:<project-id>:<entry-id>`; project binding is required and entries are not migrated by database name alone. |
| ProForge run history | `services/proForge/proForgeHistoryStore.ts`; IndexedDB `proforge-run-history/history`, keyed by project ID. | Pipeline runs can retain prompts, review context, generated text and operational project metadata. | **PROTECTED**; bounded per project but content-bearing. | `proforge-history:<project-id>`; history is preserved as a project child record and never treated as disposable cache during migration. |
| AI inference cache | `services/ai/aiInferenceCacheService.ts`; IndexedDB `worldscript-inference-cache-db/inference-cache` with bounded in-memory LRU. | Cached results are user/provider content and the hashed prompt/model key is still sensitive linkage metadata. | **PROTECTED** for persisted desktop/WebView entries; TTL/LRU is a retention policy, not encryption. | `inference-cache:<installation-scope>:<cache-key>`; future Core must bind the model/prompt cache namespace without storing raw prompt text in routing metadata. |
| LoRA adapters, datasets and run metadata | `services/loraAdapterService.ts`; IndexedDB `worldscript-lora-db` metadata/blob/dataset/run/active stores; adapter metadata can also reference Tauri paths. | Adapter blobs, training datasets, lineage and active-model metadata may contain user material or reveal project provenance. | **PROTECTED** when persisted or project-linked; downloaded public model bytes are not automatically safe once user data is merged. | `lora:<adapter-id>` plus explicit dataset/run child identities; filesystem paths are locations only. Migration must preserve metadata/blob pairing. |
| LoRA Redux mirror | `features/lora/loraSlice.ts`; localStorage key `worldscript-lora`, rehydrated into Redux state at startup. | Adapter names/descriptions, project IDs, filesystem paths, run history and error details mirror a subset of the IndexedDB stores above in a separate physical location. | **PROTECTED**; a second physical copy of already-protected content is not exempt merely because the IndexedDB store is the primary record. | `lora-mirror:<installation-scope>`; migration must protect or remove this mirror in the same operation as the IndexedDB stores it duplicates, never leaving one protected and the other plaintext. |
| Opt-in AI telemetry | `services/ai/telemetryService.ts`; DuckDB `ai_telemetry` or bounded localStorage fallback `worldscript-ai-telemetry`. | Task/provider/model, timing and success metadata can expose usage and provider context even without prompt text. | **PROTECTED** for persisted desktop telemetry; the opt-in gate remains separate from the protection requirement. | `telemetry:<installation-scope>:<chunk-id>`; future records are redacted, bounded and authenticated. |
| AI benchmark history | `services/ai/benchmarkService.ts`; localStorage key `worldscript-benchmarks`; active whenever the default-on adaptive AI engine records a benchmark. | Task type, backend, model ID, latency and timestamps are the same class of usage/model/timing fields the adjacent telemetry row protects. | **PROTECTED**; not exempt merely because the feature that produces it is default-on rather than opt-in. | `ai-benchmark:<installation-scope>:<entry-id>`; future records are redacted, bounded and authenticated the same way as the telemetry chunk row above. |
| Existing IDB KDF salt (B-1 at-rest encryption) | `services/storage/storageEncryptionService.ts`; WebView IndexedDB key-derivation salt record, generated once when a passphrase is first set and read on every unlock to re-derive the PBKDF2 key; no native Tauri filesystem record exists on `main`. | The salt value itself is non-secret by cryptographic design, but it is a security-critical migration input: losing it, silently rotating it, or letting a future authority switch discard it before every legacy IDB record that depends on it is retired would desynchronize key derivation from already-committed ciphertext and could mask a rollback instead of detecting one. It is the key-acquisition input for every `FOREIGN_PROTECTED` source classified `source_scheme_id = WEBVIEW_IDB_AT_REST_V1` (§10.1.2), not a generic migration convenience value. | **PROTECTED** migration/control input; confidentiality is non-secret, integrity and availability are security-critical. Not independently regenerable without invalidating every IDB record derived from it. | `idb-kdf-salt:<installation-scope>`; do not imply the salt is secret or treat it as free to regenerate. MUST retain, specifically for as long as any retained record uses `source_scheme_id = WEBVIEW_IDB_AT_REST_V1` (§10.1.2, §10.6), until every such record is no longer required for rollback/recovery AND the new R-15 authority is durably committed AND cleanup/finalization is itself durable — no early deletion merely because the new root became `ACTIVE` or because one record's conversion succeeded once. |
| UI preferences and feature flags | Theme, language, last-view, feature-flag, tour, command-palette and similar localStorage keys. | No authored content or credentials by contract; values are small presentation preferences. | **NON_SENSITIVE** and regenerable, provided no content or secret is added to these keys. | `ui-preferences:<installation-scope>` only as a future bounded preference record; never use them as project or encryption authority. |
| Protected-envelope routing header | Future envelope header contains only the magic, fixed-width version/suite/epoch/generation/schema fields, nonce and ciphertext length; no plaintext project/title/content. | Protocol metadata is non-sensitive by contract, but tampering is detected because the canonical header is included in AAD. | **NON_SENSITIVE** protocol metadata; not a user record. | No logical record identity of its own. It is authenticated in the containing record's AAD and parsed strictly before key/payload use. |

**Inventory result:** 36 `PROTECTED`, 2 `NON_SENSITIVE`, 2 `DERIVED_REGENERABLE`, 3 `OUT_OF_SCOPE`, 0 unclassified (43 classes total). The two derived classes are not permitted to become a plaintext native persistence escape if they later carry content or recovery authority. Persistent worker dead-letter entries are protected even though their current WebView queue is bounded and best-effort.

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
  content-bearing WebView/localStorage/IndexedDB/OPFS stores, and persisted worker dead-letter task,
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
| Binder asset bytes | `asset:<project-id>:<asset-id>` | Project and asset IDs are both required. Bytes and metadata have distinct member identities and one authenticated pair generation. |
| Binder asset metadata | `asset-metadata:<project-id>:<asset-id>` | Metadata is a distinct protected member; it is readable as an asset only through the committed pair authority. |
| Binder asset pair commit | `asset-pair:<project-id>:<asset-id>` | An authenticated aggregate marker commits the bytes and metadata members together; a partial pair is pending/recovery, never an independently successful asset. |
| Codex | `codex:<project-id>` | Rebuild/version changes do not change project identity; stale derived versions are rejected or regenerated explicitly. |
| RAG/index | `rag-index:<project-id>:<index-version>` | Project scope and derivation version prevent cross-project reuse. |
| Diagnostic chunk | `diagnostic:<installation-scope>:<date>:<chunk-id>` | Rotation/chunking changes physical files, not the installation scope or operation identity. |
| Migration | `migration:<operation-id>` | Operation ID is random and immutable; retries resume the same journal. This is the journal root/manifest identity; see the paged child identity below once a checkpoint or inventory is paged. |
| Migration page | `migration-page:<operation-id>:<page-index>` | A page is immutable per generation (§10.1.1); a checkpoint revision that changes a page writes a new `page_generation` under the same `page_index` rather than mutating it in place. Page identity, count, and membership are authenticated by the parent journal's page-set digest, never by directory enumeration. |
| Authority manifest/control root | `authority-root:<scope>` | Storage-root relocation does not change scope. This special control root and its catalog pointer are the sole epoch/authority selectors after their commit boundary and are not ordinary records requiring another commit marker. |
| Key epoch registry | `key-epoch:<scope>:<epoch>` | Epoch identity is immutable; key rotation adds an epoch and never changes record identities. |
| Record commit marker | `record-commit:<record-class>:<logical-record-id>` | Tracks the active/pending generation for one class-qualified identity; physical generation files and path names are subordinate to this marker. |
| Record catalog/index | `record-catalog:<scope>:<shard>` | Authenticated paged enumeration of owned record descriptors; it is controlled by the authority root and never rebuilt from filenames alone. |
| Local-first sync document | `local-first-doc:<project-id>` | Project ID binds the CRDT projection to its owning project; the update log is never an independent live authority ahead of the canonical project record. |
| Analytics store | `analytics-db:<installation-scope>` | The aggregated OPFS database is one installation-scoped record; per-project rows inside it are authenticated payload, not separate record identities. |
| Cross-project search index | `cross-project-index:<project-id>` | Project ID binds the index entry to its owning project; the record is keyed identically to the underlying store, so rename/relocation does not change identity. |
| Scene comments | `scene-comments:<installation-scope>` | Current global localStorage has no project binding; future migration must retain that namespace or add a verified binding, never infer ownership from section text. |
| Scene revision | `scene-revision:<revision-id>` | Revision identity survives renderer/storage relocation; section routing is authenticated metadata. |
| ProForge memory | `proforge-memory:<project-id>:<entry-id>` | Entry ID and project ID jointly bind project-specific AI context. |
| ProForge history | `proforge-history:<project-id>` | Project ID binds the bounded run-history record; run order is payload, not a physical path. |
| Inference cache | `inference-cache:<installation-scope>:<cache-key>` | The cache-key namespace is bound without exposing the raw prompt; TTL does not change identity. |
| LoRA adapter | `lora:<adapter-id>` | Adapter metadata/blob pairing survives path changes; dataset/run children receive separate IDs. |
| LoRA dataset | `lora-dataset:<adapter-id>:<dataset-id>` | Adapter and dataset IDs jointly identify a training-dataset child record; identity survives path changes and is never inferred from directory listing. |
| LoRA run | `lora-run:<adapter-id>:<run-id>` | Adapter and run IDs jointly identify one training/run record; run identity is independent of the adapter's active-model selection. |
| LoRA Redux mirror | `lora-mirror:<installation-scope>` | A second physical copy of adapter/dataset/run content; migration binds it to the same operation as the parent `lora`/`lora-dataset`/`lora-run` records, never a separate schedule. |
| AI telemetry chunk | `telemetry:<installation-scope>:<chunk-id>` | Opt-in telemetry chunks rotate physically without changing the installation scope. |
| AI benchmark entry | `ai-benchmark:<installation-scope>:<entry-id>` | Entry ID rotates physically without changing the installation scope, following the same pattern as the telemetry chunk row. |
| Worker dead-letter entry | `worker-dlq:<installation-scope>:<task-id>` | Task ID is immutable; queue retention or physical compaction does not change identity. |
| IDB KDF salt | `idb-kdf-salt:<installation-scope>` | Non-secret by design; salt rotation is a distinct migration operation from key rotation and must not silently invalidate already-migrated IDB ciphertext, and it is never regenerated as an implicit side effect of an unrelated write. |

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
| `asset` | Required `project_id` | Project and asset IDs jointly identify the protected bytes member. |
| `asset-metadata` | Required `project_id` | Metadata has its own authenticated member identity and shares the asset-pair generation and owner with the bytes record. |
| `asset-pair` | Required `project_id` | The aggregate marker authenticates the member identities, generations, epochs, and content digests as one readable asset pair. |
| `codex` | Required `project_id` | Derived content remains project-owned even when regenerable. |
| `rag-index` | Required `project_id` | Index generation cannot be shared across projects without an explicit new owner. |
| `active-project` | Installation/storage scope; referenced project ID is protected payload | The marker binds routing to a project but is not itself project-scoped. |
| `authority-root` | Storage-root scope; no project ID | This is the finite control-plane anchor for the storage authority. |
| `key-epoch` | Storage-root/key-provider scope; no project ID | Epoch identity is global to its protected storage authority. |
| `record-commit` | Same scope as the referenced logical record | A class-qualified project record marker carries that record's project ID; control markers do not acquire one. |
| `record-catalog` | Storage-root scope; no project ID | The authenticated, paged catalog enumerates owned record descriptors; it is not a plaintext filename authority. |
| `migration` | Installation/storage operation scope; no single project ID required | The protected journal contains an authenticated inventory of all owned records in the operation. |
| `migration-page` | Same operation scope as its parent `migration` journal; no independent project ID | Each page inherits the journal's operation-level scope; page ownership and membership are never inferred from a filename or page index alone. |
| `diagnostic` | Installation scope; no project ID by default | Redacted diagnostics are global; a future project-bound diagnostic must opt into an explicit owner. |
| `local-first-doc` | Required `project_id` | The projected CRDT document is a project child record; it inherits the canonical project's owner and is never a standalone authority. |
| `analytics-db` | Installation scope; per-project ownership lives in table rows, not the record's own AAD | The database aggregates multiple projects; a project ID inside the payload is not a substitute for verified per-record ownership. |
| `cross-project-index` | Required `project_id` | Each index entry is a project-owned search/summary record, unlike the installation-scoped `analytics-db` aggregate. |
| `scene-comments` | Current installation/global scope; project ID absent until verified | Preserve the current namespace; never bind comments from section text. |
| `scene-revision` | Current revision scope; project ID required only when verified | Revision IDs remain stable; section routing is authenticated payload metadata. |
| `plot-ui` | Current installation scope; no project ID | Viewport/selection state is not project authority; future binding must be explicit. |
| `mind-map-ui` | Current installation scope; no project ID | Same rule as plot UI; no content-based owner inference. |
| `progress` | Installation/profile scope; no project ID | Personal progress remains separate from project identity. |
| `proforge-memory` | Required `project_id` | Each memory entry is project-specific AI context. |
| `proforge-history` | Required `project_id` | Run history is a project child record. |
| `inference-cache` | Current installation/cache scope; project ID absent unless a project-bound cache is explicitly admitted | Cache keys are not project provenance and raw prompts are not routing metadata. |
| `lora` | Installation/adapter scope; project ID required for project-bound datasets/runs | Adapter identity survives path changes; child ownership is explicit. |
| `lora-dataset` | Installation/adapter scope; project ID required for a project-bound dataset | Dataset ownership follows the parent adapter's rule: explicit, never inferred from content. |
| `lora-run` | Installation/adapter scope; project ID required for a project-bound run | Run ownership follows the parent adapter's rule and is independent of other runs under the same adapter. |
| `lora-mirror` | Installation scope; no project ID | Mirrors the installation/adapter-scoped `lora` family; never acquires a project ID the parent records don't already carry. |
| `telemetry` | Installation/profile scope; no project ID by default | Opt-in telemetry is redacted and global unless a separately approved project scope exists. |
| `ai-benchmark` | Installation/profile scope; no project ID by default | Follows the same scope rule as `telemetry`; benchmark entries are not project-owned even though the feature that produces them is default-on. |
| `worker-dlq` | Installation scope; no project ID by default | Task IDs and bounded retention define queue ownership; payload content must not be used to infer a project. |
| `idb-kdf-salt` | Installation scope; no project ID | The salt is a shared per-installation KDF input, not project-owned or secret; do not infer a rotation from an unrelated encryption or migration event. |

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
while holding `root_commit_mutex` (§11.1) — the finite control-plane commit lock, not a
shared-to-exclusive upgrade of ordinary operation-level admission. The pointer contains no plaintext
project content or key material. A crash leaves the prior valid root slot, the new valid slot, or
`RECOVERY_REQUIRED`; startup never selects a slot from timestamps alone.

Root slots also carry a monotonic `root_generation`, authenticated root digest, and the fixed root
AAD. The pointer names one slot, generation, and digest and can advance only while holding
`root_commit_mutex` (§11.1) plus a directory-synchronized commit. A root slot has authenticated
commit evidence that
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
and its absence is never treated as proof of freshness. Every durable root commit in §9 advances
this floor to the new `root_generation` through the same key/secure-metadata adapter, before that
commit may report success; a root checkpoint that leaves the floor unadvanced is not a complete
commit, because an unadvanced floor would let an offline restore of an older complete data-directory
snapshot pass verification. §5.3.1 defines the exact two-phase durability protocol and
crash-recovery table for this floor advance, including why it is a recoverable sequence rather than
a claim of atomicity between two independent durable stores.

First-time enable creates the root key reference in the approved key adapter before writing the
first protected root slot, using the bootstrap sequence in §10.2. The root remains the finite
anchor for later control-record commits while ordinary record generations continue to use their
per-record markers. This is a storage mechanism boundary, not a renderer or Storage-Core policy
escape.

### 5.3.1 Two-phase secure-anchor commit protocol for the rollback floor

The rollback floor and the on-disk root are two independent durable stores — a key/secure-metadata
adapter (OS keystore or passphrase-derived store) and the filesystem. No admission fence makes
writing to both of them a single atomic operation, and this contract does not claim otherwise. This
section replaces the ambiguous "before or atomically with" floor-advance wording with an explicit,
recoverable two-phase protocol. Implementation naming may differ; the state machine below is
normative.

**State**, held by the key/secure-metadata adapter:

```text
committed_floor           u64; the current durable monotonic rollback floor
committed_root            the trusted cold-start root binding; advanced only by step F below:
  root_generation           u64; equals committed_floor once F has run at least once
  root_digest               32-byte target_final_root_digest (defined below) of the currently
                             trusted root
  root_slot                 the §5.3 generation-addressable slot identity holding that root
  root_key_ref              opaque non-secret key/epoch reference for the trusted root key; may be
                             represented as an epoch only if that epoch is an unambiguous trusted
                             key-provider reference (trusted_root_epoch)
prepared_root_commit      optional; absent in steady state; when present:
  operation_id              the fenced operation this preparation belongs to
  expected_prior_floor      u64; must equal committed_floor (and committed_root.root_generation)
                             at prepare time
  target_root_generation    u64; the root_generation this commit is advancing to
  target_final_root_digest  32-byte digest (§5.4) of the representation that will exist after
                             filesystem authority commit (step E below), including
                             root_commit_state_code = COMMITTED, computed canonically in advance —
                             this replaces the earlier ambiguous target_root_digest name
  target_slot                the §5.3 generation-addressable slot identity this targets
  target_root_key_ref       opaque non-secret key/epoch reference this commit is advancing to
                             (target_epoch when represented as an epoch)
  preparation_revision      disambiguates re-preparation after a retry of the same operation
```

**Sequence**, run while the caller already holds its operation-level admission (§11) for this
write and, for this finite control-plane commit, `root_commit_mutex` (§11.1):

```text
A. acquire root_commit_mutex (§11.1) for this root commit — never a shared-to-exclusive upgrade of
   the operation-level admission already held
B. read committed_floor, committed_root, and the currently committed root/pointer; verify the
   intended target_root_generation is exactly committed_root.root_generation + 1 (or the
   first-commit case)
C. durably PREPARE the secure anchor: write prepared_root_commit with expected_prior_floor set to
   the current committed_floor, and target_final_root_digest bound to the digest the representation
   will have after filesystem authority commit (step E), including root_commit_state_code =
   COMMITTED, computed canonically in advance. This write MUST NOT raise committed_floor or
   committed_root.
D. durably write/sync the target root slot, tagged NOT_COMMITTED per the §5.3/§9
   root_commit_evidence encoding. This NOT_COMMITTED candidate's own authenticated digest
   legitimately differs from target_final_root_digest — root_commit_state_code = NOT_COMMITTED
   versus COMMITTED alone changes the digest input (§5.4) — and that difference is expected, not an
   error; no step ever compares D's candidate digest to target_final_root_digest.
E. durably perform the filesystem authority commit: update that same slot's evidence to COMMITTED
   and advance the directory-synchronized active-slot pointer to it (the existing §5.3/§9
   atomic-rename-and-fsync mechanism, intra-filesystem only). The installed representation's digest
   now equals target_final_root_digest exactly, because both were computed canonically from the
   same target inputs with root_commit_state_code = COMMITTED.
F. durably COMMIT the secure anchor, in one durable adapter write: committed_floor :=
   target_root_generation; committed_root := { root_generation: target_root_generation, root_digest:
   target_final_root_digest, root_slot: target_slot, root_key_ref: target_root_key_ref };
   prepared_root_commit := none. F never fires until the durable E representation has been
   re-authenticated and its digest confirmed to exactly match target_final_root_digest.
G. only after F succeeds may the caller report DURABLE_COMMIT_SUCCESS for this root commit
```

Steps D and E are logically distinct durable states for crash recovery. An implementation may
perform them as two separate filesystem writes, or — whenever the slot's final `COMMITTED`
evidence is already fully known before D, which holds for every root commit including the §10.2
bootstrap anchor (its `journal_revision = 0` is the deterministic initial-revision sentinel for a
first-time journal and is known before the journal's own bytes are materialized, not a value only
the journal itself can supply) — as one atomic filesystem write that lands directly in the
`COMMITTED` state, collapsing D into E. Either way, the durable state after D (or combined D+E) must
be authenticable independently of C, and F never fires until that state is durably observed.

**Crash semantics.** Startup evaluates these cases in order; only the fourth row permits completing
a commit forward, and every other row leaves the prior committed root as authority:

| Crash point | Startup disposition |
|---|---|
| Before C is durable | No new secure intent exists. The prior committed root remains authority; retry starts a fresh A-G attempt. `committed_floor` and `committed_root` are unchanged. |
| After C, before D is durable | An authenticated `prepared_root_commit` exists but the target root slot is absent or incomplete. Startup discards the preparation (clears `prepared_root_commit`) or, only if it can deterministically confirm no target-slot write ever started, re-enters PREPARE for the same `operation_id`. `committed_floor` and `committed_root` MUST NOT be raised or advanced; the prior committed root remains authority. |
| After D is durable, before E is durable | The target root slot is durable but still `NOT_COMMITTED`; the filesystem pointer has not moved. It remains a non-authoritative candidate — discard it or retain it as a retry candidate for the same `operation_id`. Its own authenticated digest is never compared against `target_final_root_digest` at this point: a `NOT_COMMITTED` candidate's digest is expected to differ from the eventual `COMMITTED` representation's digest, so that difference is never treated as corruption. The prior committed root remains authority; `committed_floor` and `committed_root` are unchanged. |
| After E is durable, before F is durable | The filesystem pointer now names the target slot, which is durably `COMMITTED` and whose own re-derived digest is the final representation's digest, but `committed_floor`/`committed_root` still name the prior generation and `prepared_root_commit` still names this exact operation. Startup re-authenticates `prepared_root_commit` against the durable target slot's own committed `root_commit_evidence` and re-derived digest — matching `operation_id`, `target_root_generation`, and `target_final_root_digest` exactly against the durable `COMMITTED` slot's own digest, never against D's earlier `NOT_COMMITTED` candidate digest, and never generation or recency alone — and only on an exact match performs F to complete the commit forward and set `committed_root` to the new binding. A `prepared_root_commit` that does not exactly match the durable target evidence is never used to advance the floor; that case is `RECOVERY_REQUIRED`, because the filesystem pointer has moved to a root the secure anchor cannot prove it authorized. |
| After F is durable | `committed_floor` and `committed_root.root_generation` agree, `committed_root` names the newly committed `root_digest`/`root_slot`/`root_key_ref`, and `prepared_root_commit` is absent. This state is idempotent and replay-safe: re-running F against an absent preparation is a no-op. |

The middle three rows are why this is a *recoverable* protocol rather than a claim of cross-store
atomicity: every crash window leaves either the prior committed root intact and authoritative, or
durable evidence specific enough (an exact `operation_id`/`target_root_generation`/
`target_final_root_digest` match against the durable `COMMITTED` slot) to finish the same commit
forward — never a guess from generation numbers, timestamps, or slot recency alone.

**Fail-closed requirement.** A platform adapter that cannot provide a durable `prepared_root_commit`/
`committed_floor`/`committed_root` state with the ordering and exact-match semantics above cannot
implement this protocol, and therefore cannot implement R-15 offline-rollback protection or trusted
cold-start key routing (below): it must refuse the protection mode (fail closed) at admission time
rather than approximate the ordering with a weaker primitive. This does not change §2.2's boundary —
the protocol defends against offline restoration of an older complete data-directory (or
secure-metadata-store) snapshot; it still assumes the platform's secure-metadata/keystore mechanism
is not simultaneously compromised alongside the filesystem, and it makes no claim against a live,
currently-compromised kernel, OS, or keystore.

**Trusted cold-start root-key routing.** Startup never chooses the root key from the unauthenticated
root-envelope routing header, and never discovers it by calling `KeyProvider.list_epochs()` and
attempting each returned epoch in turn until one authenticates — that pattern is an unbounded,
untrusted search and is not admitted by this contract. `list_epochs()` (§8.2) returns non-secret
epoch identities for UI/diagnostic display and rotation-target enumeration only; it is never a
trust-routing mechanism for the root itself. Cold start instead resolves the root key exclusively
from the secure anchor's own `committed_root` binding:

```text
1. read rollback-resistant secure-anchor state (KeyProvider.read_root_anchor_state())
2. obtain the committed root's trusted slot, generation, digest, and key reference/epoch from
   committed_root
3. resolve ONLY that trusted key (committed_root.root_key_ref) via KeyProvider.resolve(...)
4. authenticate the expected authority root at committed_root.root_slot against
   committed_root.root_digest
5. compare the root's own routing/header epoch against the anchor-bound expectation
   (committed_root.root_key_ref / trusted_root_epoch)
6. only after root authentication succeeds: accept the root-contained active_key_epoch, authenticate
   key_epoch_set_digest against it (§5.4), and use the now-authenticated key-epoch registry
```

The unauthenticated root-envelope header MUST NOT choose the root key; it is untrusted input until
the root it names has authenticated against `committed_root`. This integrates with, and does not
replace, §5.3's existing startup rule that a slot is authority only once it matches a committed slot
and is not below the monotonic floor: steps 1-4 above are how that resolution obtains its trusted
key in the first place. During an interrupted prepared transition, recovery may consider only the
explicitly anchor-bound `committed_root.root_key_ref` and, if a `prepared_root_commit` is present,
its `target_root_key_ref` — never an unbounded search across every key the provider knows about.

**Adapter surface.** This replaces the bare `KeyProvider.read_floor()` / `advance_floor(new_value)`
pair (§8.2) with operations equivalent to:

```text
KeyProvider.read_root_anchor_state() -> { committed_floor, committed_root, prepared_root_commit? }
KeyProvider.prepare_root_anchor(expected_floor, target_root_generation, target_final_root_digest,
                                 target_slot, target_root_key_ref, operation_id) -> committed /
                                 typed failure (step C)
KeyProvider.commit_root_anchor(operation_id, target_root_generation) -> committed / typed failure (step F)
KeyProvider.abort_or_recover_root_anchor(operation_id) -> clears a stale/discardable
                                 prepared_root_commit without raising committed_floor or
                                 committed_root
```

Exact method names, argument shapes, and whether these are exposed as one call or several are an
implementation choice; the durable state machine, the exact-match recovery rule, the trusted
cold-start routing rule above, and the fail-closed requirement above are normative.

### 5.4 Canonical digest contract

All R-15 digests use SHA-256 with a 32-byte output and an explicit ASCII domain-separation prefix.
The digest input is never locale-dependent or JSON-dependent. Unless a rule below says otherwise,
strings use the §6.2 encoding (`u32be(byte_length)` followed by UTF-8 bytes), integers use unsigned
big-endian fixed-width encoding, and records are sorted by the encoded byte tuple stated below.
Implementations must reject invalid UTF-8, over-limit fields, and checked-length overflow before
hashing; a digest algorithm or input change requires a new envelope/journal version.

| Digest | Exact input, in order | Use |
|---|---|---|
| `content_digest` | `"worldscript-r15/content/v1"` bytes, then the complete canonical protected envelope bytes (`WSR1` header plus ciphertext) | Lets the commit marker verify that the generation-addressable envelope is the one it committed without exposing plaintext. |
| `marker_set_digest` | `"worldscript-r15/marker-set/v1"` bytes, then `u32be(entry_count)`, then each entry sorted by `(record_class bytes, sort key derived from the §6.2-tagged logical_record_id binding, sort key derived from the §6.2-tagged project_id binding)` and encoded as record class, the tagged logical-identity binding, the tagged project binding, `u64be(marker_generation)` — the control-plane generation counter for this identity's marker, distinct from the protected data record's own `record_generation` — and the 32-byte `marker_entry_digest` for that identity's current canonical marker body at that generation, defined exactly below the table | Checkpoints the complete authenticated record-marker set in the authority root by binding one immutable canonical marker body, at one explicit generation, per identity, so a replayed or substituted marker with different authority fields (operation, fencing, target generation/epoch, retention, or tombstone provenance) cannot pass verification merely because it names the same identity and state code, and so the root can select one marker generation as current without requiring the marker body itself to be mutated in place. |
| `catalog_set_digest` | `"worldscript-r15/catalog-set/v1"` bytes, then `u32be(shard_count)`, then each shard sorted by `shard_id` and encoded as `shard_id`, `u64be(catalog_generation)`, and the 32-byte page `content_digest` | Binds the complete, authenticated set of catalog shards — count, identity, and current generation — so an omitted or replayed shard cannot be substituted for the current catalog. |
| `key_epoch_set_digest` | `"worldscript-r15/key-epoch-set/v1"` bytes, then `u32be(entry_count)`, then each entry sorted by `epoch` and encoded as `u64be(epoch)`, `u64be(registry_generation)`, and the 32-byte `content_digest` of that key-epoch control record | Binds the complete, authenticated set of key-epoch control records — count, identity, and current generation — the same way `catalog_set_digest` binds the catalog shard set, so an omitted or replayed key-epoch record cannot be substituted for the currently trusted registry. |
| `root_digest` | `"worldscript-r15/root/v1"` bytes, then `u64be(root_generation)`, `u64be(active_key_epoch)`, `u64be(root_checkpoint_revision)`, the 32-byte `marker_set_digest`, the 32-byte `catalog_set_digest`, the 32-byte `key_epoch_set_digest`, and the `root_commit_evidence` tuple (`operation_id`, fencing generation, `has_journal`, journal revision, and commit-state code), encoded exactly as defined below the table | Authenticates the root body named by the pointer, including the complete catalog-shard set and the complete key-epoch control-record set, not only the record-marker set. The digest field itself is excluded from its input. |
| `pointer_digest` | `"worldscript-r15/pointer/v1"` bytes, then the canonical slot name, `u64be(root_generation)`, and the 32-byte `root_digest` | Binds the active-slot pointer to one committed root slot. |
| `inventory_digest` | `"worldscript-r15/inventory/v1"` bytes, then `u32be(inventory_version)`, `u32be(entry_count)`, and record descriptors sorted per the canonical tuple defined below, each encoded as class, the §6.2-tagged logical-identity binding, the §6.2-tagged project-ID scope binding, the exact `source_authority_kind`/`has_source_generation`/`source_generation` presence encoding defined in §10.1, and — only when `source_authority_kind = FOREIGN_PROTECTED` — the `source_scheme_id`/`source_format_version`/source-side identity and project-scope bindings/`source_evidence_digest` fields defined in §10.1.2 | Makes a migration inventory reproducible without hashing plaintext payloads. |

**Canonical inventory sort order (version 1).** `inventory_digest` orders its record descriptors by
exactly the tuple `(source record-class token bytes, tagged logical-record identity binding bytes,
tagged project-scope binding bytes, source_authority_kind code, source_scheme_id code)`, compared
byte-wise in that field order. A field that does not apply to a given entry uses its canonical
absent representation rather than an omitted or renumbered tuple: the tagged project-scope binding
uses its existing `u8(0)` absent encoding (§5.2.1, §6.2) when no project scope applies, and
`source_scheme_id` uses `NONE / PLAINTEXT = 0` (§10.1.2) as its canonical absent representation for
every `LEGACY_PLAINTEXT` or `R15_PROTECTED` entry, not only for `FOREIGN_PROTECTED` entries that
happen to select that code. This sort key is derived exclusively from authenticated descriptor
identity fields the Core itself controls. It is never filesystem path, locale collation, JSON
serialization order, timestamp, directory enumeration order, or an implementation's internal enum
order. Source generation/fingerprint is descriptor content, not a primary sort-key component: §10.1's
inventory model produces at most one source descriptor per logical identity per migration operation,
so no discriminator is needed to disambiguate multiple descriptors for the same identity in one
inventory; a future admitted operation kind that can legitimately produce more than one source
descriptor for the same identity in a single inventory must add an explicit discriminator field to
this tuple and bump `inventory_version`, never rely on source-generation ordering to disambiguate
silently.

`root_commit_evidence` is encoded, in order, as: the §6.2 string encoding of `operation_id`
(`u32be(byte_length)` then UTF-8 bytes), `u64be(fencing_generation)`, `u8(has_journal)`,
`u64be(journal_revision)`, and `u32be(root_commit_state_code)`. `has_journal` gates the meaning of
`journal_revision`, so a real revision is never conflated with an absent one: an ordinary,
non-migration root commit (the per-write checkpoint in §9/§5.4) sets `has_journal = 0` and the
sentinel `journal_revision = 0`, because no migration journal exists for that commit. A
migration-driven root commit (§10) sets `has_journal = 1` and the journal's actual current
`journal_revision` from §10.1, which may itself legitimately be `0` — that value is a real revision
only because `has_journal = 1` says so. `root_commit_state_code` is a discriminant scoped to this
evidence tuple alone and is distinct from the version-1 marker `state_code` values below:
`NOT_COMMITTED = 0` for a slot that is authenticated but only prepared or pending per §5.3, and
`COMMITTED = 1` for the durable committed state §5.3 requires before a slot is authority.

Each `key-epoch:<scope>:<epoch>` control record committed by `key_epoch_set_digest` is immutable and
generation-addressed, following the same immutable-generation discipline §8.4 requires for ordinary
protected records and §5.5 requires for catalog pages: a rotation or status change writes a new
`registry_generation` under the same `epoch` rather than mutating the previous generation's bytes in
place. Its protected payload may contain a key-provider reference, verifier metadata, epoch status,
retirement state, a KDF profile reference, and non-secret recovery metadata; raw key material never
appears in it (this does not relax the existing §8.1/§8.2 rule that raw key bytes are never written
to the data directory or exposed to a renderer). Like the authority root and catalog pages, a
key-epoch control record does not itself require another `record-commit` marker — the root's
`key_epoch_set_digest` is its non-recursive anchor, the same finite-base-case principle §5.3 already
establishes for the authority manifest and record-commit markers themselves.

The root's `active_key_epoch` field (already part of `root_digest`'s own input above) MUST name an
entry present in the root-bound `key_epoch_set_digest` set; an `active_key_epoch` naming no matching
authenticated key-epoch control record is a `root_digest` verification failure, not a `KEY_LOST` or
`PROTECTED_WRONG_KEY` outcome, because the root itself failed to authenticate its own selection.
This key-epoch registry becomes trusted only *after* the root has authenticated, per §5.3.1's
cold-start sequence; cold-start key routing itself resolves the root key from the secure anchor's
`committed_root` binding (§5.3.1), never from this registry, so the two mechanisms are never
conflated.

Version-1 marker `state_code` values are immutable and assigned once: `ABSENT = 0`, `ACTIVE = 1`,
`PENDING = 2`, `DELETE_PENDING = 3`, `TOMBSTONED = 4`, `RECOVERY_REQUIRED = 5`, and
`READ_AUTHORITY_PENDING = 6`. Code 6 is valid for both a single-record migration/read-authority
transition (the `PENDING(2) and a single-record READ_AUTHORITY_PENDING(6)` body defined below) and
an asset-pair transition whose committed member has not yet been matched by its partner (the
dedicated `asset-pair` body defined further below) — each uses its own canonical body, never a
shared one, and neither reading makes the other invalid. The parser dispatches by record
class/marker kind plus state code to the correct canonical body; an unrecognized combination remains
unsupported/corrupt per the existing parse rules. Every version-1 Core implementation must emit and
compare these exact discriminants; a future state requires a new numeric value and a version bump,
never a reused or implementation-chosen code.

Every marker-set entry's authority-bearing content is committed via a per-identity
`marker_entry_digest` rather than being enumerated inline in `marker_set_digest` itself, so the full
authenticated marker body — including fields that only apply to some states — can be bound without
contradicting states that do not carry them:

```text
marker_entry_digest = SHA-256("worldscript-r15/marker-entry/v1" bytes || canonical_marker_body_bytes)
```

`canonical_marker_body_bytes` is a common header followed by exactly one state-specific body,
selected by the entry's `state_code`. The common header is, in order: the exact `record_class`
registry token (`u32be(byte_length) + UTF-8 bytes`), the §6.2-tagged `logical_record_id` binding,
the §6.2-tagged `project_id` binding (`u8(0)` when absent), `u64be(marker_generation)`, and
`u32be(state_code)`. This repeats the entry's own leading identity fields — now including its own
generation — inside the hashed body, not only in the outer `marker_set_digest` entry, because the
persisted `record-commit`/`asset-pair` marker is itself an authoritative record read directly by
ordinary reads/writes (§8.4) independent of ever being enumerated in a root checkpoint; it must be
self-binding to its claimed identity and generation on its own.

**Marker generations are immutable and generation-addressed.** `marker_generation` is a
monotonically increasing counter maintained per logical identity's `record-commit`/`asset-pair`
marker, starting at `1` for that identity's first marker write. It is a control-plane counter,
entirely distinct from the protected data record's own `record_generation` carried inside the
state-specific body below: `record_generation` versions the protected payload, `marker_generation`
versions the authority statement about that payload, and the two counters advance independently — a
single `record_generation` may be described by several successive marker generations (for example,
an `ACTIVE(1)` marker generation followed later by a `DELETE_PENDING` marker generation that still
names record generation `1`). Every marker transition — `ABSENT -> PENDING`, `PENDING -> ACTIVE`,
`ACTIVE -> PENDING`, `DELETE_PENDING`, `TOMBSTONED`, and any `READ_AUTHORITY_PENDING` transition —
writes the next `marker_generation` as a new immutable, generation-addressed marker record rather
than mutating the previous marker generation's bytes in place, following the same
generation-addressing discipline §8.4 already requires for ordinary protected records and §5.5
requires for catalog pages. The current marker generation for an identity is exactly the one named
by the committed root's `marker_set_digest` entry for that identity; older marker generations remain
physically retained per §5.5's retention rule, giving startup a deterministic, authenticatable marker
body to recover against after a crash rather than only a digest with no accessible bytes behind it.

The state-specific body is exactly one of the following (`ABSENT` never appears as an entry — no
marker exists yet — and is therefore not encoded here):

```text
ACTIVE(1):
  committed_generation      u64be
  committed_epoch           u64be
  content_digest_present    u8, always 1 for ACTIVE
  content_digest            32 bytes, present because content_digest_present = 1

PENDING(2) and a single-record READ_AUTHORITY_PENDING(6):
  operation_id              length-delimited UTF-8, u32be(byte_length) + bytes, max 128 bytes (§6.1.2)
  fencing_generation        u64be
  has_old_generation        u8; 1 when a prior generation exists, 0 for PENDING(none -> 1)
  old_generation             u64be, present only when has_old_generation = 1
  target_generation         u64be
  target_epoch              u64be
  candidate_descriptor      u8(0) when unassigned, else the §6.2-tagged binding of the staging
                             candidate descriptor (§9 step 3)
  content_digest_present    u8
  content_digest            32 bytes, present only when content_digest_present = 1
  record_schema             u32be; the target record schema needed to interpret the candidate

DELETE_PENDING(3):
  operation_id              length-delimited UTF-8, max 128 bytes
  fencing_generation        u64be
  generation_being_deleted  u64be
  retention_policy_code     u32be; 0 = default retention (§8.5); a code that changes recovery
                             behavior requires a version bump, never silent reuse

TOMBSTONED(4):
  tombstone_generation      u64be
  tombstone_epoch           u64be
  delete_operation_id       length-delimited UTF-8, max 128 bytes; the committed delete's
                             authenticated operation identity/provenance

RECOVERY_REQUIRED(5):
  recovery_reason_code      u32be; an opaque diagnostic classifier that does not itself change
                             fail-closed behavior, which depends only on state_code plus the fields
                             below
  has_prior_operation       u8
  operation_id              length-delimited UTF-8, max 128 bytes, present only when
                             has_prior_operation = 1
  prior_fencing_generation  u64be, present only when has_prior_operation = 1
```

`asset-pair` markers use the same common header (with the `asset-pair` registry token and the
`asset-pair:<project-id>:<asset-id>` identity) but a dedicated state-specific body, because the pair
authenticates two members at once rather than one candidate/committed generation. Valid state codes
for an `asset-pair` body are `ACTIVE`, `PENDING`, `DELETE_PENDING`, `TOMBSTONED`,
`READ_AUTHORITY_PENDING`, and `RECOVERY_REQUIRED` — the pair-level authority machine is a complete
aggregate counterpart to the single-record marker's own six states, so a pair can reach a durable
deleted state exactly as a single record can:

```text
pair_generation           u64be
operation_id              length-delimited UTF-8; u32be(0) empty-string sentinel when
                           state_code = ACTIVE and no in-flight operation applies; for TOMBSTONED
                           this carries the committed delete's authenticated operation identity
                           (mirrors the single-record TOMBSTONED delete_operation_id above); else
                           u32be(byte_length) + bytes, max 128 bytes
fencing_generation        u64be; 0 sentinel when state_code = ACTIVE and not applicable
retention_policy_code     u32be; present only when state_code = DELETE_PENDING; 0 = default
                           retention (§8.5); a code that changes recovery behavior requires a
                           version bump, never silent reuse (mirrors the single-record
                           DELETE_PENDING body above)
bytes-member tuple        member_generation (u64be), member_key_epoch (u64be),
                           content_digest_present (u8), content_digest (32 bytes, if present); for
                           DELETE_PENDING and TOMBSTONED this is the generation/epoch/digest being
                           deleted or already tombstoned, retained per §8.5's retention boundary
metadata-member tuple     same shape as the bytes-member tuple, for the metadata member
```

This is the only marker shape carrying more than one generation/epoch/content-digest tuple. Adding
`operation_id`/`fencing_generation` to the pair body closes the same replay gap the single-record
bodies above close: without them, an older but still AEAD-valid partial-pair marker with different
operation authority could otherwise match the current root merely because its two member tuples
happened to still parse.

A durable pair `TOMBSTONED` marker binds both members' final generation/epoch/content-digest tuples
together with the committed delete's `operation_id`, which is exactly the provenance needed to
prevent either member — bytes or metadata — from becoming independently readable again after the
pair is deleted: a reader can never reconstruct a "still active" bytes record from a tombstoned pair
merely because the bytes envelope itself still authenticates under its own AAD. After a durable pair
tombstone, a `getBinderAsset`-equivalent read returns `PROTECTED_DELETED` (§7) even when the old
bytes/metadata generations remain physically retained for recovery or garbage collection; garbage
collection of a tombstoned pair's retained generations remains separately retryable and non-blocking
for the tombstone commit itself, consistent with the existing single-record `TOMBSTONED`/GC language
in §8.5.

This entry-digest design replaces the previous inline-tuple entry shape entirely, including the
former `asset-pair`-specific carve-out at the `marker_set_digest` table-row level: every record
class, including `asset-pair`, now uses the same five-field outer entry — record class, tagged
identity, tagged project scope, `u64be(marker_generation)`, `marker_entry_digest` — in
`marker_set_digest`'s input; only the hashed body inside `marker_entry_digest` differs by class and
state. `marker_generation` is never dropped from this outer entry in any restatement of the
`marker_set_digest` shape elsewhere in this document; the full five-field list in §5.4's digest
table above is the sole wire-format authority, and no simplified summary may be read as an alternate
encoding.

Every control-plane occurrence of a logical identity or project ID — `marker_set_digest` entries and
the canonical marker bodies hashed into `marker_entry_digest` (including the `asset-pair` body
above), catalog descriptors (§5.5), and `inventory_digest`
descriptors — uses the exact same tagged direct-or-hashed binding §6.2 defines for envelope AAD:
`u8(1) + u32be(byte_length) + exact UTF-8 bytes` within the 16,384-byte direct bound, or
`u8(2) + SHA-256(the matching §6.2 domain-prefixed hash input)` for a longer exact identity. An
identity that exceeds the direct bound is never truncated, renamed, or dropped to raw untagged
bytes merely because it appears in a marker, catalog page, or inventory entry instead of an
envelope: the same identity produces the same tagged binding everywhere it is authenticated, so an
envelope that hashes a long ID under §6.2 can still acquire a compliant commit marker, catalog
entry, and migration descriptor for that identical binding.

The root's `marker_set_digest` is committed together with every record-marker authority change,
including an ordinary write, under the same `with_fence` boundary. Record generations remain
independent; the root does not serve as a per-record lookup table. Because ordinary writes hold only
shared admission, two concurrent writes to different records may both observe the same
`root_checkpoint_revision`; each commit therefore performs a compare-and-swap on
`root_checkpoint_revision` while holding `root_commit_mutex` (§11.1) and, on conflict, recomputes
the marker set against the newly committed root and retries its own record's marker transition
rather than overwriting the concurrent update. A record's independent generation compare-and-swap in §8.4 governs only that
record's own marker; it does not by itself serialize the shared root checkpoint. A marker/root digest
mismatch is therefore a pending or recovery state, not a readable new generation: startup preserves
the prior marker and candidate, then completes or rolls back the fenced transition using journal
evidence.

For `ACTIVE(old) -> PENDING(old -> new)`, Core commits the pending marker and the corresponding
`marker_set_digest` root checkpoint in one fenced authority transition before candidate ciphertext
is produced. A pending marker contains the verified identity, old and target generations, target
epoch, operation/fence and candidate descriptor, but its `content_digest` is explicitly absent; the
marker-set encoding records that absence rather than inventing a digest. For a replacement, the
old generation remains the readable source while the pending transition is in force. For
`ABSENT -> PENDING(none -> 1)`, no payload is readable until the first active commit. After the
staged envelope exists and passes authentication, the final pending-to-active transition supplies
the content digest and commits the updated marker/root checkpoint under the same fence. A crash can
therefore expose only the old root/active marker or the matching pending root/marker state, never a
pending marker with an unrelated old root. The exact field list and byte encoding of a pending
marker's canonical body — `operation_id`, `fencing_generation`, old/target generation, target
epoch, candidate descriptor, record schema, and the deferred `content_digest` — is normative in the
`canonical_marker_body_bytes` definition above; this paragraph states only the commit-ordering rule.

### 5.5 Authenticated enumeration and paired asset authority

The `authority-root` is an integrity anchor, not a lookup table. The future Core therefore owns a
protected, paged `record-catalog:<scope>:<shard>` set. The catalog is an authenticated lookup/index
for **ordinary protected records only** — it is not an inventory of its own control-plane pages.
`record-catalog` catalog pages, `authority-root`, `key-epoch` control records, and `migration`/
`migration-page` control records are explicitly excluded from their own catalog descriptor set: a
catalog page is authenticated only through authority root -> `catalog_set_digest` -> shard id +
catalog generation + content digest -> catalog page, never through a catalog descriptor that
describes a catalog page. There is no catalog-page self-descriptor, and no catalog marker for a
catalog page, for the same non-recursion reason the root has no marker for a marker (§5.3) and the
migration journal excludes itself and its own control apparatus from the per-record inventory it
gates (§10.1) — the same finite-base-case principle applied a third time.

Each catalog page contains only bounded, authenticated descriptors for ordinary protected records,
using the exact version-1 descriptor field list below. Fields that name currently readable authority
use explicit presence encoding, never a sentinel value, so a descriptor for a record with no
committed payload generation yet is never forced to invent one:

```text
record_class                     exact §6.1.1 registry token
identity                         §6.2-tagged logical-identity binding
project_scope                    §6.2-tagged project-ID scope binding; u8(0) when absent (§5.2.1)
marker_generation                u64be; the identity's current marker generation (§5.4)
marker_entry_digest              32 bytes; the identity's current canonical marker-body digest (§5.4)
marker_state                     u32be; the version-1 state_code (§5.4)

has_active_record_generation     u8
active_record_generation         u64be, present only when has_active_record_generation = 1

has_active_epoch                 u8
active_epoch                     u64be, present only when has_active_epoch = 1

has_content_digest               u8
content_digest                   32 bytes, present only when has_content_digest = 1
```

For a brand-new record's catalog entry — the `ABSENT -> PENDING(none -> 1)` transition — the
descriptor is `marker_state = PENDING`, `marker_generation` present, `marker_entry_digest` present,
and `has_active_record_generation = 0`, `has_active_epoch = 0`, `has_content_digest = 0`: a
descriptor for a record that has never had a committed payload generation is never required to name
one, and it never substitutes a sentinel (`0`, `-1`, or an all-zero digest) for an absent field. The
pending marker itself (§5.4's `PENDING`/`READ_AUTHORITY_PENDING` canonical body), not the catalog
descriptor, is the authority for target generation, target epoch, candidate descriptor, and
operation/fence metadata; the catalog descriptor never duplicates that speculative target
information into the `active_record_generation`/`active_epoch`/`content_digest` fields, which name
only currently readable authority. Some duplication between the catalog descriptor and the marker
body it names is acceptable — both name the same `marker_generation`/`marker_entry_digest` — but no
value may be ambiguous, and the catalog's `has_active_*`/`active_*` fields never carry a pending
target's information under the currently-readable field names.

Authenticated enumeration and readability are two distinct guarantees. `list_records` may report that
a logical identity exists — including one in a `PENDING`/`READ_AUTHORITY_PENDING` transition, per its
catalog descriptor's `marker_state` — without that identity being a *readable* record: a descriptor
with `has_active_record_generation = 0` (as every brand-new `PENDING` descriptor above requires) has
no committed payload generation, and `read_record` on that identity returns the applicable §7 outcome
(`PROTECTED_READ_AUTHORITY_PENDING`, or no result at all before `PENDING` is itself durable) rather
than a payload. A record becomes readable only once its catalog descriptor reaches
`marker_state = ACTIVE` with `has_active_record_generation = 1`, `has_active_epoch = 1`, and
`has_content_digest = 1` under the same committed root. Enumerable-but-not-yet-readable is an
expected, authenticated state, not a catalog defect, and `list_records` callers must not treat
enumeration alone as permission to read.

The catalog pages are generation-addressable records authenticated directly through
`catalog_set_digest` — never through the ordinary-record `marker_set_digest`, and never through
another catalog descriptor (this section's non-recursion rule above) — page order, count, and shard
identity are authenticated by the `catalog_set_digest` defined in §5.4, which is itself an explicit
input to `root_digest`. Because the root binds both
`catalog_set_digest` and `marker_set_digest`, the committed root simultaneously selects (a) the
authenticated catalog generation and (b) the marker-set state — including each descriptor's current
`marker_generation` — corresponding to it; a catalog descriptor naming a `marker_generation` absent
from the root's committed `marker_set_digest` fails verification the same way an omitted catalog
shard does. A shard omitted or replayed from an older catalog generation therefore fails root
verification rather than silently disappearing from enumeration. A cursor is bound to the committed
catalog generation and scope, and becomes invalid rather than silently continuing across an
authority change.

**Retention.** Old catalog generations and marker generations referenced by the previous committed
root, the current committed root, or a prepared root (§5.3.1), if present, must remain physically
retained. Garbage collection may remove a marker or catalog generation only after no retained or
recoverable root can reference it — a digest recorded in an old root without physically accessible
bytes for the generation it names is not sufficient recovery evidence. This is what gives startup an
actual deterministic path to restore or verify the previous marker state after a crash.

**Ordinary-write coherence.** For every ordinary record authority transition whose catalog
descriptor changes — `ABSENT -> PENDING`, `ACTIVE -> PENDING`, `PENDING -> ACTIVE`,
`DELETE_PENDING`, `TOMBSTONED`, and migration read-authority transitions — Core updates, in the same
serialized root commit: the new immutable `marker_generation`, the new affected catalog-page
generation, `marker_set_digest`, `catalog_set_digest`, and the authority root. A write must never
return durable success while authenticated enumeration (`list_records`) still describes the previous
record authority. §9 step 9's fenced prepare/commit sub-sequence is where this catalog update is
performed — it is part of the same fenced transition as the marker/root update, never a separate or
deferred step.

`list_records(scope, filter, cursor)` verifies the committed root, catalog marker, page digest,
and each returned descriptor before returning bounded results. It never enumerates by trusting
filenames, directory order, or caller-supplied record IDs. A missing, stale, or inconsistent
catalog returns `RECOVERY_REQUIRED` and does not reconstruct authority from untrusted paths.
Create, delete, relocation, and migration update the catalog and the affected record markers under
the same admission fence; an entry is not visible as committed until both are durable.

`list_records` and the record catalog are the intended authenticated replacement for the current
filename-trusting enumeration surface exposed by the `StorageBackend` interface referenced in §3
(its `listProjects`, `listSnapshots`, and `listBinderAssetIds` methods) once the explicit authority
switch in §20 gate 7 occurs. Until then, those call sites continue to operate against the current
owners described in §3; no renderer
or startup verification path may substitute directory listing for the committed catalog after the
switch, and gate 7 cannot be marked complete while any such call site still trusts a directory
listing instead of `list_records`.

Asset bytes and metadata retain distinct protected identities:
`asset:<project-id>:<asset-id>` and `asset-metadata:<project-id>:<asset-id>`. Their separate
envelopes use their respective record-class AAD. The aggregate
`asset-pair:<project-id>:<asset-id>` marker records the pair generation, both member identities,
both member generations/epochs, and both content digests. Core exposes the pair only when the
aggregate marker is committed and both members match it under one fence. A partial pair is
`READ_AUTHORITY_PENDING`/`RECOVERY_REQUIRED`, never an independently successful asset; a durably
`TOMBSTONED` pair is `PROTECTED_DELETED` (§7) for both members even if their bytes remain physically
retained; migration, backup, quarantine, and cleanup must preserve or process the pair as one
recovery unit.

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
| `ciphertext_len` | `64 MiB` (67,108,864 bytes), including the 16-byte tag | Reject values below 16, above the limit, or unequal to the remaining byte count before allocating the ciphertext buffer. Larger records use an admitted chunked envelope. |
| Whole protected record (52-byte header + `ciphertext_len`) | `64 MiB + 52 bytes` (67,108,916 bytes) | The maximum envelope size is exactly the fixed header plus the maximum `ciphertext_len`; a parser must not apply the `64 MiB` bound a second time to the complete file, and must not accept a file larger than this exact sum. |
| One length-delimited direct AAD field (`domain`, `record_class`, `logical_record_id`, `project_id`) | 64, 64, 16,384, and 16,384 UTF-8 bytes respectively | Decode the length, compare with the field-specific limit and remaining input, then allocate/decode. Invalid UTF-8 is rejected. Longer exact identities use the fixed-size bindings defined in §6.2; they are not truncated or renamed. |
| Hashed long identity/project binding | 32-byte SHA-256 binding plus its fixed representation tag | Hash the exact UTF-8 logical identity or project ID with its versioned domain and length before AAD construction; do not allocate from an envelope-controlled length. |
| Canonical AAD | `32 KiB` total | Reject before constructing the AAD buffer if fixed fields plus length-delimited fields exceed the limit. The hashed project binding remains fixed-size for IDs that would exceed this total. |
| `operation_id` | 128 UTF-8 bytes | Journal and staging parsers reject an over-limit or invalid value before allocation. |
| Non-secret key/epoch reference | 256 bytes | The key provider and journal reject an over-limit reference before allocation; key material is never parsed from the record. |
| One journal record entry | 1 KiB | Reject an entry whose encoded fields exceed the bound before materializing it. |
| Journal page (`migration-page:<operation-id>:<page-index>`, §10.1.1) | 4096 entries | Process pages incrementally; reject a larger page before allocating its entry list. |
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
document's field encoding is the authority those vectors must implement. Gate 1 must also add a
boundary fixture for §6.2's deterministic direct-vs-hashed rule: a `logical_record_id` and a
`project_id` that each individually fit within the 16,384-byte direct per-field limit, but whose
combined direct-form canonical AAD would exceed the 32 KiB canonical AAD maximum, so both fields are
required to fall through to their tagged hashed forms per §6.2 rule D rather than only one of them.

### 6.1.1 Normative record-class registry

`record_class` is an ASCII registry token, not a human-readable inventory label. The following
tokens are normative for version 1 and are serialized exactly as length-delimited UTF-8 strings in
AAD:

```text
project              project-metadata   snapshot           backup
recovery             settings           credential         image
asset                asset-metadata     asset-pair         codex
rag-index            active-project     authority-root     key-epoch
record-commit        migration          migration-page     diagnostic
record-catalog       local-first-doc    analytics-db       cross-project-index
scene-comments       scene-revision     plot-ui            mind-map-ui
progress             proforge-memory    proforge-history   inference-cache
lora                 lora-dataset       lora-run           lora-mirror
telemetry            ai-benchmark       worker-dlq         idb-kdf-salt
```

`staging` and `migration-stage` are deliberately not registry tokens: staging is a physical locator
and operation descriptor, never an independent cryptographic record identity (§9, §10). A candidate
ciphertext is encrypted under its final record's own AAD — final `record_class`, final
`logical_record_id`, project scope, target `key_epoch`, and target `record_generation` (§6.2) —
from the moment it is created, so promotion to immutable generation storage never requires
re-encryption merely because the physical file moves out of a staging location. `migration-page` is
a registered token because a journal page (§10.1.1) is a persisted, generation-addressed control
record in its own right, unlike an ephemeral staging file.

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
logical_record_id_binding = direct exact registry identity within the bound, or fixed SHA-256 binding for a longer exact identity
project_id_binding = u8(0) when absent; u8(1) + u32be(byte_length) + exact UTF-8 string when present and within the direct bound; u8(2) + fixed SHA-256 binding for a longer exact ID
header = the exact 52-byte routing header, including envelope_version, suite_id, key_epoch,
          record_generation, record_schema, nonce, and ciphertext_len
```

The canonical AAD byte sequence is the following fixed order: `u32be(byte_length) + UTF-8 bytes`
for `domain` and `record_class`; then the logical-identity binding, project binding, and exact
header bytes. The logical-identity binding is `u8(1) + u32be(byte_length) + exact UTF-8 identity`
within 16,384 bytes, or `u8(2) + SHA-256("worldscript-r15/logical-id/v1" bytes ||
u32be(full_byte_length) || full UTF-8 identity)` for a longer exact identity. The project binding
is `u8(0)` when absent, `u8(1) + u32be(byte_length) + exact UTF-8 project ID` up to 16,384 bytes,
or `u8(2) + SHA-256("worldscript-r15/project-id/v1" bytes || u32be(full_byte_length) || full
UTF-8 project ID)` for a longer exact ID. Both hash forms preserve the existing logical identity;
they are authenticated compact representations, not import-ID renames or truncations. The Core
must obtain exact identities from verified project/ownership records and hash them incrementally
when needed.

**Deterministic direct-vs-hashed selection (version 1).** Whether `logical_record_id` and
`project_id` use their direct or tagged-hashed AAD form is decided by the following fixed,
implementation-independent rule, evaluated in order, so no two compliant implementations can select
different encodings for the same identity pair:

```text
A. A logical_record_id or project_id that exceeds its direct per-field limit (16,384 bytes,
   §6.1.2) always uses its tagged hashed representation, independent of the other field.
B. Otherwise, first construct the size canonical AAD would have if every individually-direct-
   eligible identity field (logical_record_id and, when present, project_id) were encoded in its
   direct form.
C. If that total fits within the 32 KiB canonical AAD maximum (§6.1.2): use their direct forms.
D. If that total would exceed the 32 KiB maximum: encode BOTH logical_record_id and a present
   project_id using their tagged hashed forms, even if one of the two would have fit alone.
E. Recompute the total using the hashed forms and require it to fit the normative AAD maximum.
   Failure after applying the fixed-size hashed forms indicates malformed or unsupported contract
   input (an over-limit `domain`/`record_class`/header combination), not an implementation choice,
   and is rejected before AAD construction rather than resolved by any further fallback.
```

This deterministic rule is the only admitted selection order. It deliberately forecloses "hash
whichever field is longest," "hash whichever field the implementation encounters first," or any
other per-implementation heuristic: two conformant implementations given the same
`logical_record_id`/`project_id` pair must always compute byte-identical canonical AAD. §6.1.2
requires a boundary test fixture for the case this rule exists to make deterministic — both IDs
individually within the 16,384-byte direct bound, but their combined direct-form AAD exceeding the
32 KiB maximum — and that fixture must exercise rule D, not rule A. The header is the
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
| `PROTECTED_READ_AUTHORITY_PENDING` | An authenticated authority transition (an in-progress asset-pair member, or a migration target not yet fully committed) is durable but the requested identity is not yet readable under it. Return no payload and the operation's transitional status; the caller retries after the transition completes or the state resolves to `RECOVERY_REQUIRED`. This is distinct from `PROTECTED_DELETE_PENDING`, which is a delete intent rather than a not-yet-readable write/migration target. |
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
KeyProvider.list_epochs() -> non-secret key identities and availability; enumeration/diagnostic use
                             only — never a trust-routing mechanism for the root (§5.3.1)
KeyProvider.read_root_anchor_state() -> { committed_floor, committed_root, prepared_root_commit? }
                             (§5.3.1)
KeyProvider.prepare_root_anchor(...) -> committed / typed failure (§5.3.1)
KeyProvider.commit_root_anchor(...) -> committed / typed failure (§5.3.1)
KeyProvider.abort_or_recover_root_anchor(operation_id) -> clears a discardable preparation (§5.3.1)
```

The provider may be implemented by an OS keystore, a user passphrase adapter, or a later approved
combination. A passphrase implementation must use an explicitly versioned KDF profile and a random
salt; the existing WebCrypto PBKDF2-SHA-256/600,000 profile is a browser reference, not a reason to
copy browser storage code into Core. The native implementation must select and document its KDF
profile before production admission. No raw passphrase, key, salt secret, or decrypted payload is
logged or sent to a renderer.

The four `*_root_anchor` operations expose the two-phase secure-anchor protocol that §5.3.1
normatively defines for the rollback floor and the trusted `committed_root` cold-start binding; they
are ordinary `KeyProvider` operations, not a separate contract. There is no claim of atomicity
between the secure-metadata adapter and the filesystem: `prepare_root_anchor` durably records intent
without raising `committed_floor` or `committed_root`, the filesystem pointer transition happens
independently, and `commit_root_anchor` durably raises `committed_floor` and advances `committed_root`
only after re-authenticating that transition's exact evidence (§5.3.1). §9 step 9 invokes
`prepare_root_anchor`/`commit_root_anchor` at the two points §5.3.1's sequence requires, and startup
calls `read_root_anchor_state()` before accepting any root slot as authoritative and before resolving
the root key at all (§5.3.1's trusted cold-start routing sequence), consistent with §5.3's
floor-verification rule and §5.3.1's crash-recovery table. An adapter that cannot provide the exact
ordering and evidence-matching semantics §5.3.1 requires must fail closed per that section, not
approximate it here.

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
generation remains the active authority while `PENDING` is durable. A new record generation is
promoted under a generation-addressable physical name, and a new `marker_generation` (§5.4) — the
identity's marker counter, distinct from and independent of this record's own `record_generation` —
is durably written naming `ACTIVE(new)`, rather than mutating the previous marker generation in
place. The authority manifest separately selects the active storage epoch and is switched only by
the migration/rotation commit protocol. These control records are protected and included in the
inventory; they are not mutable plaintext sidecars.

The authority-root manifest does not duplicate every record's generation or act as their lookup
table. It anchors the active storage epoch and carries the `marker_set_digest` defined in §5.4.
Each `record-commit` marker remains authoritative for exactly one logical identity. Record
generations may advance independently, but each marker change and the corresponding root digest
checkpoint are committed under the same fence. A read requires the envelope generation and epoch to
match its marker and the marker-set digest to match the committed root (or the matching migration
journal view); a marker written without that root checkpoint remains pending and is not served.

### 8.4.1 Paired asset commit

Asset bytes and metadata retain distinct protected identities:
`asset:<project-id>:<asset-id>` and `asset-metadata:<project-id>:<asset-id>`. Their separate
envelopes use their respective record-class AAD. The aggregate
`asset-pair:<project-id>:<asset-id>` marker records the pair generation, both member identities,
both member generations/epochs, and both content digests. Core exposes the pair only when the
aggregate marker is committed and both members match it under one fence. A partial pair is
`READ_AUTHORITY_PENDING`/`RECOVERY_REQUIRED`, never an independently successful asset; a durably
`TOMBSTONED` pair (§5.4) is `PROTECTED_DELETED` (§7) for both members even if their bytes remain
physically retained for recovery/GC; migration, backup, quarantine, and cleanup must preserve or
process the pair as one recovery unit.

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

On restart, a crash before the `DELETE_PENDING` marker is durable leaves the old generation
`ACTIVE` and fully readable, because no delete intent was ever authenticated. A crash after a
durable `DELETE_PENDING` marker but before `TOMBSTONED` resumes the same authenticated delete
intent: the identity returns `PROTECTED_DELETE_PENDING` with no payload while the prior generation's
bytes remain retained but not served, pending an idempotent retry of the tombstone transition —
never a reversion to ordinary active reads. A durable tombstone makes the identity logically deleted
while bytes remain subject to the retention/recovery policy; an uncertain marker or fence result
returns `RECOVERY_REQUIRED`. Resume is idempotent. Deletion
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
   ID, fencing token, target generation, target epoch, target record schema, and candidate
   descriptor, but deliberately no `content_digest` because ciphertext does not exist yet. This is
   itself a root-commit event: acquire `root_commit_mutex` (§11.1), commit this pending marker as a
   new immutable `marker_generation` (§5.4) together with the matching root `marker_set_digest` and
   the affected `catalog_set_digest` descriptor (§5.5's ordinary-write coherence rule) via the same
   §5.3.1 two-phase secure-anchor sequence step 9 uses, then release `root_commit_mutex` before
   staging (steps 3-8) begins.
3. Serialize and authenticate the payload under the *final* record's own AAD — final `record_class`,
   final `logical_record_id`, project scope, target `key_epoch`, and target `record_generation`
   (§6.2) — the same identity the committed record will use. The physical staging location and its
   temp filename are a locator only and are never part of AAD (§6.1.1, §3). Materialize the
   resulting ciphertext to a unique same-directory staging target. No plaintext staging file is
   allowed.
4. Write all staged bytes and verify the expected byte count/format.
5. Flush/sync the staging file to the required durability level and close it.
6. Validate the staged envelope by parsing/authenticating it against the exact target identity,
   epoch, schema, and generation.
7. Promote the staging file to an immutable, generation-addressable record without removing the
   old active generation. Promotion relocates the already-final-AAD ciphertext bytes verbatim;
   because the candidate was encrypted under the final identity from creation, promotion never
   re-encrypts or rewrites AAD merely because the physical file moves.
8. Flush/sync the containing directory or platform-equivalent metadata required to persist the
   promoted generation.
9. Acquire `root_commit_mutex` (§11.1) — never by upgrading this write's shared operation admission
   from step 1 — and perform the fenced root-anchor transition defined in §5.3.1 for this commit:
   (a) `prepare_root_anchor` durably records the intent to advance the authority root to its next
   generation together with the updated `marker_set_digest` and `catalog_set_digest` (the marker's
   next `marker_generation` moving `PENDING` to `ACTIVE(new)` and the affected `record-catalog`
   descriptor's next `catalog_generation`, or, for a migration target, also the matching
   `VERIFIED_TARGET` journal/read-authority checkpoint) without yet raising the rollback floor or
   `committed_root`; (b) durably write the next `marker_generation` for the protected commit marker
   (`PENDING` to `ACTIVE(new)`) as a new immutable marker record (§5.4) and the affected
   `record-catalog` shard's next `catalog_generation` (§5.5), together with the authority-root
   `marker_set_digest` and `catalog_set_digest` checkpoints, all under the same `with_fence`
   transition — this is the first point at which the verified staged envelope supplies
   `content_digest`; for a migration target, retain `READ_AUTHORITY_PENDING` and block target reads
   until all required state is durable, or return recovery if the adapter cannot provide that
   semantic; (c) `commit_root_anchor` durably advances the adapter-held rollback floor and
   `committed_root` (§5.3, §5.3.1) to the new `root_generation` only after (b) is durable. Only the
   completed (a)-(c) sequence transfers ordinary record authority and updates authenticated
   enumeration in the same serialized commit (§5.5); a crash at any point resolves per §5.3.1's
   crash-recovery table, never by claiming atomicity between the secure-metadata adapter and the
   filesystem. Release `root_commit_mutex` once this step's durable result is known.
10. Only after the marker generation, catalog-page generation, root checkpoint, advanced rollback
    floor, their containing directory metadata, and any required migration checkpoint are durable
    return `DURABLE_COMMIT_SUCCESS`; never report success after a marker-only commit or while
    `list_records` could still describe the previous record authority (§5.5).
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
| After the fenced pending marker/root checkpoint, before `ACTIVE(1)` | A replacement continues serving its old generation; a new identity has no payload authority. Resume or roll back the pending operation under the fence without discarding unrelated data. |
| After `ACTIVE(1)` marker and required root commit | Generation `1` is authoritative; restart verifies the root/marker digest before serving it. |
| Before staging write | Old authority remains valid; retry can start a new generation. |
| During staging write | Old authority remains authoritative; incomplete staging is untrusted and reconciled. |
| After staging write, before file sync | Staging is not committed; old authority remains. |
| After file sync, before promotion | Complete staging may be verified/adopted by the journal or discarded; old authority remains until commit. |
| After promotion, before directory sync | Old marker remains active; the new generation is preserved and not yet authoritative. |
| After directory sync, before marker advancement | New bytes are durable but marker metadata is stale. Startup validates the authenticated pending intent and completes the marker, or rolls back while preserving the candidate for recovery — restoring `ACTIVE(old)` for a replacement, or `ABSENT` when the pending transition was `PENDING(none -> 1)` and no prior generation exists. It never guesses from timestamps. |
| During the final marker/root/checkpoint transition (§9 step 9's prepare/commit sub-sequence, held under `root_commit_mutex`, §11.1) | `root_commit_mutex` blocks readers from selecting the new target until the marker, root checkpoint, rollback-floor preparation and commit, and any migration checkpoint agree. §5.3.1's crash-recovery table governs the exact disposition of the floor's prepare/commit sub-sequence; the marker/root-checkpoint write itself resolves the same way as any other interruption in this table — restoring `ACTIVE(old)` for a replacement, or `ABSENT` for `PENDING(none -> 1)` — and `root_commit_mutex` is released only once both the record-level and floor-level recovery are resolved. A marker-only ordinary write, and a floor-only `prepared_root_commit` with no matching durable target evidence, are never reported as durable success. |
| After journal/manifest advancement | New authority is durable; cleanup remains separately retryable. |
| During cleanup | Authority is unchanged; cleanup can resume without deleting the committed generation. |

The post-directory-sync/pre-marker rule is normative: startup first authenticates the durable
`PENDING` intent and candidate generation. If both match, it idempotently completes the commit
marker, the root marker-set checkpoint, and, for migration, the matching journal/manifest checkpoint
while holding the same fence.
If the candidate is missing, malformed, or fails authentication, it restores `ACTIVE(old)` for a
replacement, or `ABSENT` for `PENDING(none -> 1)` where no prior generation exists, and preserves
the candidate/staging bytes for recovery. An unrecognized candidate is never adopted solely because
it is newer or has a plausible filename.

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
  revision sufficient to prevent stale migration owners from mutating records;
- page count, entry count, and an ordered, authenticated page-set digest once the checkpoint or
  inventory is paged (§10.1.1).

**`source_authority_kind` encoding.** Every migration-inventory descriptor names an immutable
version-1 numeric source-authority kind. These are source-*authority* categories — which mechanism a
Core migration must trust and convert from — not confidentiality labels; `LEGACY_PLAINTEXT` and
`R15_PROTECTED` are the two kinds this contract has admitted since an earlier pass (renamed here from
their original `LEGACY`/`PROTECTED` names to make room for the third kind below without ambiguity;
the numeric codes are unchanged), and `FOREIGN_PROTECTED` is a new third kind admitted by this pass:

- `LEGACY_PLAINTEXT = 0` for a legacy plaintext source discovered during `enable`/bootstrap (§10.2,
  §10.4).
- `R15_PROTECTED = 1` for an already-protected R-15 source record being re-enveloped under `rotate`
  or an envelope/schema migration (§10.4), where a real prior `record_generation` exists under the
  source epoch.
- `FOREIGN_PROTECTED = 2` for a source currently protected by a mechanism OTHER than R-15 — a
  packaged-desktop WebView encryption authority such as `storageEncryptionService`'s IDB at-rest
  protection or the separate `idbKeyStore` credential authority. §10.1.2 defines its versioned
  scheme registry, inventory descriptor extension, and migration-compatibility boundary.

The associated source generation uses explicit presence encoding, never a sentinel value a caller
must separately learn means absence, for all three kinds:

```text
source_authority_kind   u32be
has_source_generation   u8
source_generation       u64be only when has_source_generation = 1
```

For a `LEGACY_PLAINTEXT` source, `source_authority_kind = LEGACY_PLAINTEXT` and
`has_source_generation = 0`; there is no generation number for plaintext that was never a protected
record. For an `R15_PROTECTED` source, `source_authority_kind = R15_PROTECTED`,
`has_source_generation = 1`, and `source_generation` is the source record's existing
`record_generation` under the source epoch. For a `FOREIGN_PROTECTED` source,
`source_authority_kind = FOREIGN_PROTECTED` and `has_source_generation`/`source_generation` follow
the foreign scheme's own generation semantics (§10.1.2) — present only when that scheme actually
tracks one — and the descriptor carries the additional `FOREIGN_PROTECTED`-only fields §10.1.2
defines. `inventory_digest` (§5.4) hashes this exact encoding, not a generic prose description of
"source-authority kind and source generation."

The inventory is streamed or paged. The entire project and full record list are never required in
memory. A checkpoint is written only after the corresponding record conversion and verification
are durable.

The journal itself, together with the other control-plane records created under
`BOOTSTRAP_TARGET` (the authority-root manifest, the key-epoch registry, and
record-commit/record-catalog control records), is excluded from the per-record `CONVERT`/`VERIFY`
inventory that gates completion. These records are created natively under the target epoch as the
migration's own control apparatus — never converted from legacy plaintext — so the journal's own
revision advancing at every checkpoint does not make it a stale inventory entry; §5.3 already
establishes this same exclusion for control records versus their own `record-commit` marker, and
this is its migration-inventory counterpart. Gate 5's inventory-complete requirement in §20 applies
to ordinary `PROTECTED` record classes with legacy or current-authority source data; the
control-plane apparatus is instead verified by its own commit/fence protocol from
`BOOTSTRAP_TARGET` onward, not by a source/target generation comparison.

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

### 10.1.1 Paged journal pages and page-set manifest

A single `migration:<operation-id>` journal identity is the manifest/root record only; it is
insufficient by itself once the checkpoint or inventory is paged (§6.1.2 already bounds a journal
page to 4096 entries and a whole journal/checkpoint encoding to 16 MiB, and permits up to
1,000,000 inventory entries overall). Version 1 defines a finite, authenticated page hierarchy,
following the same pattern as `record-catalog:<scope>:<shard>`/`catalog_set_digest` (§5.4, §5.5):

```text
migration:<operation-id>                    journal root / manifest (unchanged identity)
migration-page:<operation-id>:<page-index>  one authenticated protected envelope per page
```

`migration-page` is a normative §6.1.1 record-class token. Each page is its own authenticated
protected envelope (§6, AES-256-GCM, AAD-bound) using its own final identity
`migration-page:<operation-id>:<page-index>`; a physical filename or directory listing is never
authoritative for page identity, generation, or membership. If a page is replaced across checkpoint
revisions, its `page_generation` is bound inside its authenticated payload, not inferred from a
physical overwrite.

**Journal root/manifest fields.** The `migration:<operation-id>` root/manifest authenticates, at
minimum: `journal_version`, `operation_id`, `journal_revision`, `phase` (§10.3), `source_epoch`,
`target_epoch`, `fencing_generation`, `page_count`, `entry_count`, cursor/progress state, and the
ordered `journal_page_set_digest` defined below.

**`journal_page_set_digest`**, analogous to `catalog_set_digest` (§5.4):

```text
"worldscript-r15/journal-pages/v1"
u32be(page_count)
for pages sorted by page_index:
  page_index          u32be
  page_generation     u64be
  page_entry_count    u32be
  page_content_digest 32 bytes; the page envelope's §5.4 content_digest
```

`journal_page_set_digest` is an explicit input to the journal root/manifest's own authenticated
body — the manifest is itself a protected envelope keyed by `migration:<operation-id>` — the same
way `catalog_set_digest` is an explicit input to `root_digest`. A missing, duplicated, reordered,
stale, or replayed page therefore fails manifest verification rather than silently disappearing
from, or reappearing in, the paged inventory; the manifest's authenticated page set is the only
trusted source of which pages exist, never directory enumeration.

**Processing model.** Pages are immutable per generation; a checkpoint revision that must change a
page's content writes a new `page_generation` under the same `page_index` and republishes the
manifest with an atomically replaced `journal_page_set_digest` and `journal_revision`, rather than
mutating a page in place. Implementations must not load the full inventory into memory; the
manifest's `page_count` and cursor/progress state let a resumed operation stream only the pages it
still needs.

**Crash recovery.** These paged-journal cases are explicit, in addition to the whole-journal cases
in §10.3/§12:

| Case | Disposition |
|---|---|
| Orphan prepared page — a `migration-page` envelope is durable but no durable manifest `journal_page_set_digest` references it | Not authoritative; discard it or retain it as an unclaimed candidate. Never adopted merely because its `operation_id`/`page_index` looks plausible. |
| Manifest references a page that is missing | `RECOVERY_REQUIRED` for that checkpoint; the manifest's authenticated page set is trusted over what physically exists. |
| A new page generation is durable but the manifest still names the old generation | The old generation remains authoritative for that `page_index` until the manifest is durably updated; the new page is a discardable or retryable candidate. |
| Manifest is durably updated to a new `journal_page_set_digest` but a referenced page's durability is incomplete | The manifest update itself was not eligible to commit under §9's write contract; treat as `RECOVERY_REQUIRED` rather than serve a partially-durable page set. |
| Replay of an older, internally-consistent complete page set (an older `journal_revision` with its own valid `journal_page_set_digest`) | Rejected: the manifest is read through the same committed-root/marker authority as any other record (§5.3, §8.4), so an older `journal_revision` cannot become current again without also rolling back that authority, which §5.3.1's floor protocol independently blocks. |
| Resume after partial page conversion | Idempotent: the cursor/progress state in the last durably committed manifest determines which pages/entries remain; already-converted pages are re-verified, not reprocessed. |
| Any paged state that cannot be fully authenticated (mixed generations, an unverifiable digest, or an ambiguous cursor) | `RECOVERY_REQUIRED` — never guessed from filenames, directory order, or page count alone. |

This paging scheme applies to the migration inventory/checkpoint only; it does not change how an
ordinary record's own generations or the `record-catalog` shards are addressed, and it does not add
the journal or its pages to the per-record `CONVERT`/`VERIFY` inventory the journal itself gates.
§10.1 already excludes the journal and the other `BOOTSTRAP_TARGET` control records from that
inventory; `migration-page` envelopes are the same kind of migration-owned control apparatus and
are excluded on the same basis, not a data record subject to conversion.

### 10.1.2 Foreign-protected source registry and inventory descriptor

This section defines the version-1 `FOREIGN_PROTECTED` machinery §10.1 forward-references: which
existing non-R-15 protection mechanisms are admitted migration sources, how a `FOREIGN_PROTECTED`
inventory descriptor extends the common `source_authority_kind` encoding, and the boundary between
this migration-compatibility concern and the R-15 `KeyProvider`/`Core` authority defined elsewhere in
this contract.

**Why a third kind is needed.** The two-way `LEGACY_PLAINTEXT`/`R15_PROTECTED` split (§10.1)
correctly distinguishes plaintext from R-15 ciphertext, but several packaged-desktop `PROTECTED`
classes in §3 are today protected by a real, independent, non-R-15 cryptographic mechanism —
`storageEncryptionService`'s WebView IDB at-rest encryption and the separate `idbKeyStore` random-key
credential authority. Such a source is neither unprotected legacy plaintext nor an existing R-15
envelope; classifying it as either would either silently treat live ciphertext as plaintext to be
read directly (a false `LEGACY_PLAINTEXT` claim) or claim an R-15 envelope's generation/epoch
semantics for bytes that never went through R-15's key/epoch model (a false `R15_PROTECTED` claim).
`FOREIGN_PROTECTED` names this third, honest category instead of collapsing it into either existing
one.

**Versioned foreign protection-scheme registry (version 1).** `source_scheme_id` is an immutable,
version-1 numeric registry distinguishing the mechanisms that actually exist in the packaged desktop
application, at minimum:

```text
0   NONE / PLAINTEXT             no foreign protection scheme applies; the canonical absent
                                  representation for a LEGACY_PLAINTEXT or R15_PROTECTED entry's
                                  source_scheme_id, including for §5.4's inventory sort tuple
1   WEBVIEW_IDB_AT_REST_V1        current storageEncryptionService secure-record/IDB at-rest
                                  protection path (PBKDF2-SHA-256/600,000 -> AES-256-GCM, keyed by
                                  the retained `idb-kdf-salt:<installation-scope>` record, §3)
2   CREDENTIAL_IDB_KEYSTORE_V1    separate idbKeyStore random non-extractable AES-GCM credential
                                  authority (§3's API/provider credentials row); a distinct key-
                                  acquisition and verification mechanism from code 1, never
                                  collapsed into it merely because both use AES-GCM
```

A record protected under `storageEncryptionService`'s policy — including scene revisions where that
IDB policy applies (§3) — uses `WEBVIEW_IDB_AT_REST_V1` rather than a bespoke per-class cipher code,
because it is the same key-derivation/verification mechanism regardless of which logical record class
lives in that database. A record protected by a materially different cryptographic
verification/key-acquisition mechanism registers its own immutable code rather than sharing one; code
2 exists specifically because `idbKeyStore`'s random non-extractable per-credential key has no KDF,
no shared salt, and no passphrase — a different key authority from code 1, not an implementation
detail of it. `libraryBackupService.ts` encrypted ZIPs are deliberately NOT registered here: §10.4
already classifies them `MIGRATION_INPUT_ONLY`, requiring an explicit user import/ownership operation
before Core ever reads them; folding them into the automatic `FOREIGN_PROTECTED` inventory would
erase that already-established explicit-disclosure boundary. A future scheme requires a new immutable
code and a compatibility rule, never a reused or renamed value.

**`FOREIGN_PROTECTED` inventory descriptor extension.** In addition to the common
`source_authority_kind`/`has_source_generation`/`source_generation` fields (§10.1), a
`FOREIGN_PROTECTED` inventory descriptor binds:

```text
source_authority_kind          = FOREIGN_PROTECTED
source_scheme_id                u32be; this registry's code
source_format_version           u32be; the foreign scheme's own format/version marker
source_identity_binding         §6.2-tagged binding of the source-side logical identity, as the
                                 foreign scheme's own routing evidence names it
source_project_scope_binding    §6.2-tagged binding of the source-side project scope; u8(0) when
                                 the foreign scheme carries none
has_source_generation            u8   (from the common encoding above)
source_generation                u64be, present only when the foreign scheme has a generation
                                 concept and has_source_generation = 1
source_evidence_digest           32 bytes; SHA-256("worldscript-r15/foreign-source-evidence/v1"
                                 bytes || the scheme-defined canonical opaque source representation
                                 or authenticated routing evidence)
```

`source_identity_binding`/`source_project_scope_binding` are the frozen-inventory-time authenticated
claim of the *source's own* identity/scope, encoded with the same §6.2 tagged direct-or-hashed
mechanism used for the destination `logical_record_id`/`project_id` bindings elsewhere in the
inventory descriptor (§5.4). They are a separate, independently authenticated commitment from the
destination binding in the same descriptor, not a copy of it: §10.6/§15.3's no-transitive-trust rule
requires Core to independently validate that the source-side identity actually maps to the intended
destination `RecordIdentity` before conversion, rather than assuming the two bindings mean the same
thing merely because they were captured in the same inventory entry.

`source_evidence_digest` is a domain-separated digest over the scheme-defined canonical opaque source
representation or authenticated routing evidence — for example, the foreign envelope's own
authenticated header/AAD bytes, or an equivalent scheme-defined routing commitment — never a hash
offered as a substitute for actually verifying the old encryption at conversion time. Its sole purpose
is detecting source mutation between frozen inventory and conversion (§10.6); a mismatch at
conversion time returns `SOURCE_CHANGED_SINCE_INVENTORY` (§15.3) rather than being silently ignored.
The journal/inventory never contains raw source keys, passphrases, decrypted plaintext, or any other
secret derived from the foreign source — only this non-secret evidence digest and the non-secret
routing/scope bindings above.

`inventory_digest` (§5.4) hashes this exact `FOREIGN_PROTECTED` extension, appended after the common
fields, for every descriptor whose `source_authority_kind = FOREIGN_PROTECTED`; a `LEGACY_PLAINTEXT`
or `R15_PROTECTED` descriptor never carries these extension fields at all, rather than carrying them
with a sentinel absent value.

### 10.2 Bootstrap for first-time enable

Enabling protection from `UNCONFIGURED` cannot first write a plaintext journal and cannot encrypt a
journal before a target key exists, and it must not invent a bootstrap-only trust mechanism separate
from the two-phase secure-anchor protocol §5.3.1 already defines for every later root commit. The
operation therefore uses that exact same `prepare_root_anchor`/`commit_root_anchor` sequence, applied
to the `UNCONFIGURED -> first COMMITTED root` transition, in an explicit `BOOTSTRAP_TARGET` step
before the first protected `DISCOVER` checkpoint:

1. The key adapter creates/resolves target epoch `M` and its approved target key reference,
   storing only key reference/material in the approved keystore or passphrase adapter; no raw key
   is written to the data directory. If key preparation fails, no migration journal is claimed and
   the known legacy authority remains untouched.
2. Core constructs the initial `key-epoch:<scope>:M` control record (§5.4) — the generation-addressed,
   immutable protected payload carrying epoch `M`'s key-provider reference, verifier metadata, and
   status, never raw key material — at `registry_generation = 1`. This is the record
   `key_epoch_set_digest` (§5.4) must bind before any root can legally claim `active_key_epoch = M`
   (§5.4's finding-#8 invariant); bootstrap cannot skip it merely because there is no prior registry
   to extend.
3. Core determines the canonical final `COMMITTED` bootstrap root representation: `root_generation`
   = the first generation, `active_key_epoch = M`, the (empty, single-entry) `marker_set_digest`
   appropriate to a still-empty record set, an empty `catalog_set_digest`, the `key_epoch_set_digest`
   binding the step-2 record, and `root_commit_evidence` with `root_commit_state_code = COMMITTED`,
   `has_journal = 1`, and `journal_revision = 0` — the journal's deterministic initial-checkpoint
   revision, known before the journal's own bytes are materialized in step 7, not a value only the
   journal itself can supply (§5.3.1's D/E-collapsing rule already establishes this precomputability
   for bootstrap; nothing here is a special case of it).
4. Core computes `target_final_root_digest` (§5.3.1) over the exact representation determined in
   step 3.
5. Core calls `prepare_root_anchor` (§5.3.1 step C; expected prior state = `UNCONFIGURED`, i.e. no
   `committed_root` yet exists) with the target generation, `target_final_root_digest` from step 4,
   the target slot, `target_root_key_ref` = epoch `M`'s key reference, and the bootstrap
   `operation_id`. This durably records, in the secure anchor, the only key reference a later restart
   may trust for this bootstrap attempt — closing the exact crash window finding #1 identified: a
   crash after this point leaves an authenticatable `prepared_root_commit` naming epoch `M`, not an
   unauthenticatable bare filesystem slot.
6. Core durably writes the first `authority-root:<scope>` root slot under target epoch `M`, in the
   `NOT_COMMITTED` state of the `root_commit_evidence` encoding (§5.3.1 step D), naming the exact
   `operation_id` and fencing generation from step 5. A `NOT_COMMITTED` slot is never treated as
   authority (§5.3); it only anchors discovery, and its own digest legitimately differs from
   `target_final_root_digest` per §5.3.1's normal D/E distinction.
7. Core writes the first journal under target epoch `M`, tagged with the exact `operation_id` named
   by steps 5-6, with source authority explicitly marked `LEGACY_PLAINTEXT` and state
   `MIGRATING(source=LEGACY_PLAINTEXT,target=M)`. Legacy project data remains authoritative until the
   later `COMMIT` phase.
8. Core verifies the exact final bootstrap authority state before proceeding: the step-2 key-epoch
   record, the step-6 `NOT_COMMITTED` slot, and the step-7 journal all authenticate under the same
   `operation_id` and target epoch `M`, and together reproduce exactly the representation
   `target_final_root_digest` (step 4) commits to. A mismatch here is `RECOVERY_REQUIRED`, never a
   best-effort repair.
9. Core installs the `COMMITTED` root matching `target_final_root_digest` (§5.3.1 step E): the same
   slot's evidence advances from `NOT_COMMITTED` to `COMMITTED`, and the directory-synchronized
   active-slot pointer advances to it.
10. Core calls `commit_root_anchor` (§5.3.1 step F), advancing `committed_floor` and `committed_root`
    to this bootstrap generation only after re-authenticating step 9's durable representation against
    `target_final_root_digest`.
11. Only after step 10 succeeds does Core report bootstrap authority durable (§5.3.1 step G).

Steps 5-6 and 9-10 are exactly §5.3.1's C/D and E/F; bootstrap introduces no parallel commit
mechanism, only this specific `UNCONFIGURED -> first-COMMITTED-root` instantiation of it, with steps
2-3 and 7-8 supplying the bootstrap-specific content (the key-epoch record and the journal) that the
generic sequence commits. Crash recovery therefore follows §5.3.1's crash-recovery table directly:

- **Before step 5 is durable** — no authenticated secure-anchor intent exists yet. Restart remains
  `UNCONFIGURED`; any stray bytes from an unanchored attempt (a partial step-2 record, for example)
  are inert and are never adopted merely because a filename or operation ID looks plausible.
- **After step 5, before step 6 is durable** — an authenticated `prepared_root_commit` names epoch
  `M`'s trusted key reference and `operation_id`, but the target root slot is absent or incomplete
  (§5.3.1's "After C, before D" row). Restart resolves the trusted key from this preparation — never
  from an unauthenticated slot header, never by trying every `list_epochs()` entry — and either
  discards the preparation or, only if it can deterministically confirm no slot write ever started,
  re-enters step 6 for the same `operation_id`. `committed_floor`/`committed_root` are not raised.
- **After step 6, before step 7 is durable** — the `NOT_COMMITTED` slot is durable and authenticatable
  against the step-5 preparation's trusted key reference, but no matching journal exists yet. Restart
  authenticates the slot, recovers the named `operation_id` and target epoch `M` from the secure
  anchor's `prepared_root_commit` (never from the slot's own header), and deterministically resumes
  by writing the journal under that exact same `operation_id` and epoch — the anchored identity is
  never orphaned, and this is the specific gap finding #1 closes relative to the pre-existing text.
- **After step 7, before step 9 is durable** — §5.3.1's "After D, before E" row: the slot remains a
  non-authoritative `NOT_COMMITTED` candidate regardless of how much bootstrap-specific content (the
  journal) has accumulated around it.
- **After step 9, before step 10 is durable** — §5.3.1's "After E, before F" row applies verbatim:
  startup re-authenticates the `prepared_root_commit` against the durable `COMMITTED` slot's own
  evidence and re-derived digest, matching `operation_id`/`target_root_generation`/
  `target_final_root_digest` exactly, and only on an exact match completes step 10.
- **After step 10** — `committed_floor`, `committed_root`, and the committed root's `root_generation`
  agree; bootstrap is durable and idempotent to re-observe.

The bootstrap epoch is not active project authority merely because it protects the journal. A crash
before `COMMIT` (§10.3) resumes from the journal or returns an explicit recovery result; it never
interprets the absence of a target record as permission to write defaults.

### 10.3 Migration phases

| Phase | Durable before/after; crash view | Resume/rollback; reads/writes |
|---|---|---|
| `BOOTSTRAP_TARGET` | Target key reference/verifier, the initial `key-epoch:<scope>:M` control record, a secure-anchor `prepared_root_commit` naming epoch `M` (§10.2 step 5), the `NOT_COMMITTED` first root slot naming the operation ID, and the first protected journal are durable in that order; legacy records are unchanged and remain authoritative. | If preparation fails, remain `UNCONFIGURED` with legacy data untouched. Before the secure-anchor preparation (§10.2 step 5) is durable, remain `UNCONFIGURED`. After it but before the root slot, resolve the trusted key only from that preparation and resume from step 6. After the root slot but before the journal, resume by writing the journal under that same anchored operation ID (§10.2 step 7). Once the root is durably `COMMITTED` and the secure anchor's `commit_root_anchor` has run (§10.2 steps 9-10), resume the same operation from the journal or enter recovery. Reads use legacy authority; no ordinary record writes occur before the journal exists. |
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

### 10.4.1 Migration disposition per protected class

Not every `PROTECTED` class from §3 is a candidate for the generic R-15 data-envelope path merely
because it is classified `PROTECTED` — some already have their own approved, independent protected
authority. For each `PROTECTED` class, the migration plan names exactly one disposition, immutable
once admitted for that class:

```text
MIGRATE_TO_R15                          the ordinary path: convert into an R-15 envelope under this
                                          contract's identity/generation/AAD model
RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY
                                          the class keeps its existing, independently-approved
                                          protection mechanism (e.g. a dedicated secret/keystore
                                          authority); it never becomes an ordinary R-15 filesystem
                                          record merely for uniformity
MIGRATE_TO_APPROVED_NATIVE_SECRET_AUTHORITY
                                          a future, separately authorized native secret-store
                                          migration target, distinct from both R-15 filesystem
                                          records and the class's current mechanism
REFUSE_AUTHORITY_SWITCH
                                          the class blocks the authority switch until its
                                          disposition is decided; an unset disposition is this
                                          state by default, never a silent MIGRATE_TO_R15
```

API/provider credentials (§3) are the normative example: their disposition is
`RETAIN_APPROVED_SEPARATE_PROTECTED_AUTHORITY` (the existing `idbKeyStore` random non-extractable
key authority, or a future OS-keystore equivalent) unless a separate, explicit product/security
decision selects `MIGRATE_TO_APPROVED_NATIVE_SECRET_AUTHORITY` — never `MIGRATE_TO_R15`, because
folding credentials into the ordinary envelope/generation/epoch model would give the renderer or an
ordinary record-read path a way to observe credential ciphertext structure the dedicated authority
deliberately isolates. **Gate 7 (§20) may not claim complete packaged-desktop protection while any
`PROTECTED` class's disposition is unset or is `REFUSE_AUTHORITY_SWITCH`.** No disposition permits
silent plaintext export of the class it governs.

### 10.5 Legacy plaintext and corruption

Discovery distinguishes known healthy legacy plaintext, unknown shape, corrupt/unreadable data,
already protected legacy envelopes, current envelopes, orphan staging, quarantine, and journals.
Only a recognized, ownership-verified legacy record is a migration candidate. A corrupt legacy file
is preserved, optionally quarantined under a recovery identity, and surfaced as recovery-required
or per-record migration failure. Migration may continue independent records only when the journal
can prove that doing so cannot hide or overwrite the failed record.

### 10.6 Foreign-protected migration, key availability, and no-transitive-trust

This section governs conversion of every `FOREIGN_PROTECTED` (§10.1, §10.1.2) source — a record
currently protected by a real, independent, non-R-15 mechanism such as `WEBVIEW_IDB_AT_REST_V1` or
`CREDENTIAL_IDB_KEYSTORE_V1`. It is strictly a migration-compatibility concern: it does not extend
R-15's own threat model or key authority, and it does not create a new long-term renderer security
boundary. §2.2's threat-model boundary is unchanged by anything in this section.

**Preserve-first foreign migration flow.** For every `FOREIGN_PROTECTED` source, conversion follows
exactly this ordering, each step durable before the next begins:

```text
freeze/admit writer
  -> capture exact source descriptor/evidence (§10.1.2's frozen-inventory fields)
  -> obtain required legacy unlock/key authority (via MigrationSourceAdapter, §15.3)
  -> authenticate + decrypt source (MigrationSourceAdapter.open_verified, §15.3)
  -> validate identity/schema against the frozen migration contract (this section's
     no-transitive-trust rule, below)
  -> create R-15 ciphertext under the *final* destination identity (§9's existing final-AAD-from-
     creation staging discipline — the foreign-decrypted plaintext feeds the same staging path an
     ordinary write already uses, from the moment ciphertext is first produced)
  -> verify the R-15 candidate
  -> commit the R-15 marker/catalog/root (§9 step 9, §5.3.1, §5.5)
  -> preserve the old foreign-protected source
  -> continue migration verification for remaining records
```

Core never deletes or disables an old `FOREIGN_PROTECTED` source immediately after one record
converts. The old source remains recovery authority until: every applicable record verifies under
the new R-15 authority; the final authority switch (§20 Gate 7) is durable; rollback/recovery no
longer references the foreign source; every scheme-specific key/salt material the source depends on
is no longer needed by any retained record (for `WEBVIEW_IDB_AT_REST_V1`, this is exactly the
`idb-kdf-salt:<installation-scope>` retention rule §3 already states, tied specifically to that
scheme); and cleanup/finalization itself commits durably.

**Foreign-key availability.** A `FOREIGN_PROTECTED` source is not migration-ready merely because its
ciphertext parses; conversion requires successful verification under its own admitted source scheme
(`MigrationSourceAdapter.open_verified`, §15.3). If the required legacy key, passphrase, or
non-extractable `CryptoKey` handle is unavailable, Core does **not**: treat the record as corrupt
automatically, fall back to reading it as plaintext, delete it, reset it, write a default value in
its place, or mark migration complete while it remains unconverted. Core returns the applicable
typed source failure (§15.3) and preserves the original foreign-protected authority exactly as it
was. **For an inventory-complete authority switch, an unresolved, non-regenerable `FOREIGN_PROTECTED`
source is a blocker** — this is the same admission-readiness requirement Gate 5 (§20) already applies
to WebView writer fencing, extended to source-key availability: a class cannot reach Gate 5's final
inventory snapshot while a required foreign key is known to be permanently unavailable for a record
that class's migration plan does not otherwise refuse or exempt.

**No transitive trust from source encryption.** A source record successfully authenticating under
its foreign scheme proves only that "these particular source bytes were valid under that foreign
scheme/context" — it does not make the foreign scheme's own routing metadata (its notion of record
class, logical identity, or project scope) automatically valid R-15 identity. Before encrypting a
foreign-decrypted plaintext into R-15 ciphertext, Core independently validates the record class,
logical identity, project scope, schema, and owner relationship the *frozen migration inventory*
assigned to that source descriptor (§10.1.2's `source_identity_binding`/`source_project_scope_binding`
are the frozen claim being validated against, not assumed equal to the destination binding merely
because both appear in the same inventory entry) — and confirms the source is still a member of the
admitted migration inventory. This prevents a valid old foreign ciphertext from being rebound to the
wrong R-15 logical identity merely because it successfully decrypted.

## 11. Unified admission model (#360)

The Core owns one admission authority for ordinary reads, ordinary writes, migration, rotation,
enable, lock/unlock, the explicitly refused disable operation, and shutdown. The mechanism may be a Rust async
reader/writer gate plus a durable journal lease; it need not copy browser Web Locks.

`enable` is admitted through the journaled state machine. `disable` is an explicit refusal state in
R-15 (`unsupported/locked`) until a separate product/security decision defines a safe non-plaintext
contract; it is not an unimplemented fall-through that may read or write legacy data.

| Operation | Admission | Authority rule |
|---|---|---|
| Ordinary read | Shared read admission; hold through key selection, decrypt, identity verification, and payload handoff. | Core selects committed/verified source or target during migration. Renderer cannot choose an epoch. |
| Ordinary write | Shared ordinary-write admission; hold from epoch/key resolution through durable commit. | A writer cannot capture an old epoch, wait, then commit after migration retires it. Concurrent ordinary writes serialize their shared root checkpoint via the root-generation compare-and-swap in §5.4, never a blind overwrite. |
| Migration/rekey | Exclusive admission over the conversion/verification/commit protocol, or a formally equivalent per-batch protocol with a durable write barrier. | No ordinary writer can cross the source/target transition. Any batch optimization must prove the same TOCTOU invariant. |
| Lock | Exclusive state transition; block new operations and drain already admitted reads/writes/migration at a safe boundary before clearing key handles. | Report `LOCKED` only after no admitted operation can decrypt, hand off plaintext, or commit with the cleared key. If draining cannot complete safely, keep the prior state and return a typed pending/recovery result. |
| Unlock | Exclusive state transition; resolve and authenticate the intended epoch before admitting new operations. | Failed verification leaves storage `LOCKED`; no caller selects an epoch or uses legacy plaintext as a fallback. |
| Shutdown/close | Admission-aware drain/cancel protocol. | Do not report clean shutdown while a durable write/critical commit is unresolved. Preserve journal and resume after crash/forced kill. |

If an operation loses its key, admission lease, or durability confirmation, it returns a typed
failure and leaves the old authority/journal available. Admission failure is never treated as
record absence.

`lock()` and `unlock()` are Core admission operations, not direct calls from a renderer to
`KeyProvider`. `lock()` first prevents new admissions, drains already admitted work through
plaintext handoff or durable commit, then clears key handles and acknowledges `LOCKED`. A staged
write that cannot reach a safe boundary is preserved as pending/recovery rather than silently
cancelled. `unlock()` verifies the configured key and expected committed epoch while the exclusive
transition is held; only then may ordinary admission resume. A lock/unlock request racing with
migration or rotation waits for that operation's journal boundary or returns a resumable typed
state, never a transient state in which the UI says `LOCKED` while an old-epoch write can commit.

### 11.1 Root-commit concurrency (`root_commit_mutex`)

Ordinary writers hold only shared operation admission (the table above), and an ordinary writer
never attempts to upgrade that shared admission to exclusive in order to perform its root-anchor
transition — a shared-to-exclusive upgrade while other shared holders remain active is the deadlock
this section closes. Instead, the finite control-plane commit in §5.3.1 steps C-F is serialized by a
separate, cross-process-serialized `root_commit_mutex`, held **below** the admission layer above:

```text
1. obtain operation admission — shared for ordinary read/write, exclusive for migration/lock/
   authority switch (already defined in the table above)
2. perform record preparation/staging outside root_commit_mutex where safe (§9 steps 1-8)
3. acquire root_commit_mutex for the finite control-plane commit
4. while holding root_commit_mutex:
   - re-read current root
   - validate CAS/root_checkpoint_revision (§5.4)
   - recompute affected marker/catalog/key-registry sets if required
   - perform secure-anchor PREPARE (§5.3.1 step C)
   - commit filesystem root/control generations (§5.3.1 steps D/E)
   - commit secure anchor (§5.3.1 step F)
   - reach durable result
5. release root_commit_mutex
6. release operation admission at the already-defined boundary
```

An ordinary write (§9) performs steps 1-8 while holding only shared admission, then acquires
`root_commit_mutex` for step 9's fenced prepare/commit sub-sequence — §5.3.1 steps A-G map onto
steps 3-5 above — and releases it before returning its durability result. A migration, rotation,
lock, or authority-switch operation first acquires exclusive admission and waits for ordinary shared
work to drain (as the table above already requires), then acquires the same `root_commit_mutex` in
the same ordering — never inverted, and never by holding `root_commit_mutex` while waiting to
acquire admission. Because exclusive admission already excludes concurrent ordinary admission, such
an operation is the sole admission holder when it takes `root_commit_mutex`, so no separate upgrade
path is ever needed for that case either. §5.3.1 step A and §5.3's pointer-advance rule both refer to
acquiring `root_commit_mutex`, never to upgrading operation-level admission.

### 11.2 Locked legacy plaintext

When secure mode is configured and the session is `LOCKED`, a legacy plaintext record is not
readable through a special-case path. Core returns `PROTECTED_LOCKED` or `MIGRATION_REQUIRED`,
depending on whether an unlock/migration operation is available. There is no silent bypass merely
because a particular file has not yet been converted.

### 11.3 Read/write policy during migration

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
| Lock during admitted operation | Drain through handoff/commit before acknowledging `LOCKED`; otherwise return a typed pending/recovery result and retain the prior key/state authority. Never clear key material under an admitted operation. |
| Stale staging | Validate operation/generation/authentication; adopt only with journal proof, otherwise preserve/quarantine for recovery. |
| Delete pending/tombstoned record | Return `PROTECTED_DELETE_PENDING` or `PROTECTED_DELETED` with no payload; do not recreate defaults or treat retained bytes as ordinary authority. |
| Crash before `DELETE_PENDING` is durable | The old generation remains `ACTIVE` and fully readable; retry the same delete operation from the start. |
| Crash after durable `DELETE_PENDING`, before tombstone | Resume returns `PROTECTED_DELETE_PENDING` with no payload and idempotently retries the tombstone transition; never reverts to ordinary active reads. |
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

The public Core read/write/delete surface accepts one structured identity value, never a
colon-delimited logical string the Core would have to parse to recover project scope:

```text
RecordIdentity {
    record_class
    logical_record_id
    project_id: Option<ExactProjectId>
}
```

`logical_record_id` remains the stable registered logical identity (§5.1); `project_id` remains its
separately authenticated AAD scope (§6.2), carried as its own structured field rather than joined
into `logical_record_id`. The implementation may internally derive a canonical encoded storage key
or AAD binding from `RecordIdentity`'s fields, but the public semantic contract must never recover
project scope by splitting a joined string such as `asset:<project-id>:<asset-id>`, because existing
imported IDs are unrestricted strings that may themselves contain the join delimiter.

The later public Core API is semantic:

```text
read_record(identity: RecordIdentity) -> typed read outcome + payload (§7)
write_record(identity: RecordIdentity, payload, expected_generation) -> durability result
delete_record(identity: RecordIdentity) -> durability result
list_records(scope, filter, cursor) -> bounded authenticated descriptors + cursor
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
- the two-phase secure-anchor rollback-floor and trusted `committed_root` cold-start binding defined
  in §5.3.1 (`KeyProvider.read_root_anchor_state()` / `prepare_root_anchor(...)` /
  `commit_root_anchor(...)` / `abort_or_recover_root_anchor(...)`, §8.2) backed by the same
  key/secure-metadata store rather than the on-disk root slot;
- platform permission/error translation;
- process shutdown/cancellation signals.

The adapter reports capabilities and honest failures. It does not choose policy, classify a missing
record from an I/O error, or bypass Core admission. Tauri and later Qt therefore consume the same
Core contract.

An adapter's rollback-floor primitive must provide the exact durability ordering and
evidence-matching semantics §5.3.1 defines. An adapter that cannot provide a durable
`prepared_root_commit`/`committed_floor`/`committed_root` state with that ordering cannot implement
R-15 offline-rollback protection or trusted cold-start key routing at all and must refuse the
protection mode at admission time (fail closed), per §5.3.1's fail-closed requirement — it must not
approximate the ordering with a weaker primitive. Once admitted, a genuine mid-operation crash inside
the prepare/commit sequence resolves per §5.3.1's crash-recovery table; an adapter that cannot even
distinguish those crash states returns `RECOVERY_REQUIRED` rather than claim durable success.

### 15.3 MigrationSourceAdapter boundary

Core owns migration semantics — identity validation, admission, and destination encryption. Foreign
(non-R-15) cryptographic mechanics belong behind an explicit, separate compatibility boundary, kept
distinct from `KeyProvider` (§8.2) and from the `source_scheme` registry (§10.1.2, which only
*identifies* a mechanism, never verifies it):

```text
MigrationSourceAdapter.inspect(source_scheme_id, source_locator)
    -> canonical source descriptor (§10.1.2's FOREIGN_PROTECTED inventory fields)

MigrationSourceAdapter.open_verified(descriptor, source_authority_or_unlock_context)
    -> verified plaintext stream/value
       OR one of: SOURCE_LOCKED, SOURCE_KEY_UNAVAILABLE, SOURCE_AUTHENTICATION_FAILED,
                  SOURCE_UNSUPPORTED_VERSION, SOURCE_CHANGED_SINCE_INVENTORY,
                  SOURCE_IDENTITY_MISMATCH, SOURCE_RECOVERY_REQUIRED
```

**`SOURCE_CHANGED_SINCE_INVENTORY`** is returned when the source's re-derived evidence no longer
matches the frozen `source_evidence_digest` (§10.1.2) captured at inventory time. **The R-15
`KeyProvider` is not the legacy-key registry.** Core does not copy every existing WebView key into
the future R-15 `KeyProvider` merely to make migration convenient, and does not export a
non-extractable WebCrypto key merely to satisfy a uniform API. Where a current source key is
intentionally non-extractable (for example, `idbKeyStore`'s per-credential keys), the
`MigrationSourceAdapter` authenticates and decrypts *within the legacy authority that already owns
that key* and returns only the verified plaintext result to the Core migration operation calling
`open_verified` — it never extracts or relocates the legacy key itself.

That returned plaintext:

- exists only in bounded process memory for the duration of the conversion step;
- is never persisted as intermediate plaintext, on disk or otherwise;
- is never logged (§14's redaction rule applies to it identically);
- is immediately validated against the destination record schema/identity (§10.6's
  no-transitive-trust rule) before any further use;
- is encrypted directly into final-identity R-15 ciphertext staging (§9's existing final-AAD-from-
  creation discipline — the same staging path an ordinary write uses, just fed by foreign-decrypted
  bytes instead of a fresh plaintext write);
- is released as soon as that conversion step completes.

This is a **migration-compatibility mechanism**, not a new long-term renderer security authority: it
exists only to move bytes from an already-approved legacy protection into R-15, and it confers no
standing access beyond the single conversion operation it serves. §2.2's threat-model boundary is
unchanged — a renderer already compromised while unlocked remains outside R-15's protection claim,
`MigrationSourceAdapter` included.

**Four non-collapsing layers.** `KeyProvider` (§8.2, the future R-15 target key authority),
`MigrationSourceAdapter` (this section, the temporary compatibility boundary for *existing* source
protection), the `source_scheme` registry (§10.1.2, which mechanism identifies which verification
rules apply), and Core itself (identity validation, migration semantics, destination encryption, and
authority decisions) are four distinct roles. An implementation must not collapse them into one
generic "crypto adapter" — in particular, `MigrationSourceAdapter` never becomes a general-purpose
key-management facility, and `KeyProvider` never gains foreign-scheme decryption responsibility.

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
    observes a target marker without its matching verified checkpoint under the same fence. A crash
    during that transition recovers to `ABSENT`, never to `ACTIVE(old)`; a crash during the
    corresponding replacement transition (`ACTIVE(old) -> PENDING(old -> new)`) recovers to
    `ACTIVE(old)`, never to `ABSENT`. These two recovery outcomes are asserted separately.
13. Lock/unlock transitions drain or preserve admitted work before changing key availability; no
    operation can continue with an old key after `LOCKED` is acknowledged.
14. Record enumeration verifies the committed paged catalog and rejects filename-only discovery;
    asset bytes and metadata are exposed only through their committed aggregate pair marker.
15. A replayed but still AEAD-valid `PENDING`/`DELETE_PENDING`/`READ_AUTHORITY_PENDING` marker for
    the same logical identity — one carrying a different `operation_id`, `fencing_generation`,
    target generation/epoch, or (for `asset-pair`) member tuple than the currently committed root's
    `marker_set_digest` — is rejected before it can be read as current authority; the fixture set
    includes at least one replay vector per marker state defined in §5.4's canonical marker-body
    encoding.
16. A candidate envelope staged under its final record's AAD (final `record_class`,
    `logical_record_id`, project scope, target epoch, target generation) authenticates identically
    before promotion, as a verified staging candidate, and after promotion, as the committed
    generation; the same ciphertext bytes are never re-encrypted or re-AAD'd purely because the
    physical file relocates from a staging locator to immutable generation storage.
17. Concurrent-write admission scenarios cover every packaged-desktop `PROTECTED` WebView class
    named in §3 whose current writer must be fenced, quiesced, or refused before Gate 5's final
    inventory snapshot (§20) — at minimum scene comments, progress/session state, ProForge
    memory/history, the LoRA Redux mirror, AI benchmark history, and the AI inference cache —
    proving no unfenced writer can produce an untracked plaintext update once that class's
    inventory is captured.
18. Paged migration-checkpoint recovery exercises every case in §10.1.1's table — orphan prepared
    page, manifest-references-missing-page, new-page-durable-with-stale-manifest,
    manifest-updated-with-incomplete-page-durability, page-set replay, and
    resume-after-partial-page-conversion — and confirms an unauthenticatable paged state returns
    `RECOVERY_REQUIRED` rather than a guess from filenames or page count.
19. `FOREIGN_PROTECTED` fault-injection coverage (§10.6, §15.3) exercises, at minimum: foreign
    ciphertext changed after final inventory (`SOURCE_CHANGED_SINCE_INVENTORY`); foreign key
    unavailable (`SOURCE_KEY_UNAVAILABLE`); foreign key wrong (`SOURCE_AUTHENTICATION_FAILED`);
    foreign AEAD/tag failure; foreign scheme version unsupported (`SOURCE_UNSUPPORTED_VERSION`);
    foreign source decrypt succeeds but destination identity validation fails
    (`SOURCE_IDENTITY_MISMATCH`); crash after foreign decrypt but before R-15 candidate durability;
    crash after R-15 candidate durability but before authority commit; crash after R-15 commit while
    the foreign source is still retained; resume with the foreign source unchanged; resume with the
    foreign source missing; the `idb-kdf-salt:<installation-scope>` record missing while a dependent
    `WEBVIEW_IDB_AT_REST_V1` source remains; and a `CREDENTIAL_IDB_KEYSTORE_V1` non-extractable key
    unavailable. Every case remains preserve-first: no assertion may pass by observing source
    cleanup, plaintext fallback, a default write, or migration marked complete under any of these
    conditions.

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
5. **Migration admission readiness and inventory-complete migration:** before this gate captures the
   final per-class inventory snapshot, every current writer of that packaged-desktop `PROTECTED`
   class — WebView localStorage/IndexedDB writers included — must reach one of three states: routed
   through an admitted adapter/interceptor capable of participating in the Core migration fence;
   deterministically quiesced/disabled for the migration window so it cannot produce an untracked
   write; or the R-15 enable/switch must refuse to proceed for that class rather than capture an
   inventory it cannot keep current. Only a class satisfying one of these three states may have its
   final inventory snapshot captured and converted; capturing an inventory while an unfenced legacy
   writer can still mutate that class is not gate-complete. This makes Gate 5 a migration
   *admission-readiness* gate, not a full authority-ownership gate — ordinary reads/writes may still
   resolve through the current TS/WebView authority for a class that has not yet reached Gate 7,
   provided that authority is now routed through the admitted/quiesced path above rather than an
   unfenced direct writer. Admit every `PROTECTED` class from §3 that exists in packaged desktop,
   including current Tauri WebView localStorage/IndexedDB records, `backup:<backup-id>` records,
   quarantine, diagnostics, and derived content indexes. Each class needs a Core or explicitly owned
   WebView adapter migration/refusal result; a desktop authority switch cannot skip a plaintext,
   unknown, or unmigrated packaged class. Explicitly exclude existing user-selected
   `libraryBackupService.ts` ZIPs until an explicit import operation; prove no plaintext sibling
   path remains. Required no-gap invariant: `capture final inventory -> convert/verify every
   protected class -> authority switch` must have no interval in which an unfenced legacy writer can
   create or mutate a protected plaintext record outside the captured inventory; a class whose
   writers cannot be admitted, quiesced, or refused per this rule blocks Gate 5 for that class, not
   only Gate 7. §16 item 17 requires explicit concurrent-write fault-injection coverage for this
   admission requirement.
6. **Shadow/compatibility phase:** compare Core verdicts with current TS reads without switching
   authority; run packaged Tauri acceptance and the relevant #332 durability/background scenarios.
   Gate 6 remains shadow/compatibility verification only; it does not itself admit or refuse writer
   fencing, which is Gate 5's responsibility and must already be satisfied for every class reaching
   this gate.
7. **Explicit authority switch:** only a separately authorized release migration may change all
   packaged-desktop readers/writers, including WebView adapters, preserve legacy recovery, and
   update security/release documentation. Gate 7 is the separately authorized semantic authority
   switch — the point where all packaged-desktop readers/writers begin using the new authoritative
   Core path — not the first point at which those writers become controllable; that control is
   Gate 5's admission-readiness requirement above. Browser/PWA authority remains independent.

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
