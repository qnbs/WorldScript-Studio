//! Renderer-neutral R-15 protected-record primitives — Gate 1 of
//! `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §20.
//!
//! Headless only: the `WSR1` envelope header (§6.1), the record-class registry (§6.1.1), canonical
//! AAD (§6.2), and AES-256-GCM seal/open with an OS-backed nonce source (§6.3), plus the Gate 2
//! slice 1 typed record-identity registry ([`identity`], §5.2), the identity-bound record codec
//! ([`record`]), the §10.4.1 record-class disposition ([`mod@disposition`]), the Gate 3
//! slice 3A durable staging and promotion of one generation ([`durable`]), and slice 3B's
//! `record-commit` marker codec ([`marker`]) and marker commit protocol with startup reconciliation
//! ([`commit`]), and slice 3C's authority-root digests ([`root`]), record catalog ([`catalog`]),
//! persisted root records ([`root_record`]), the two-phase root commit ([`root_store`]) and the
//! persisted, root-verified record catalog ([`authority`]), and the protected write and read paths
//! that commit every marker transition through the root ([`protected`]), and Gate 4B's kernel
//! admission plus protected operation/snapshot/lifecycle boundary ([`operations`]), and Gate 4C's
//! migration journal manifest, paged inventory codec, and Gate 4D execution-state helpers ([`journal`]).
//! It changes no current TypeScript/Tauri storage authority; durable migration I/O and production
//! caller wiring remain future 4D slices.

#![deny(unsafe_code)]

pub mod aad;
pub mod admission;
pub mod anchor;
pub mod anchor_codec;
mod authority;
pub mod catalog;
pub mod commit;
pub mod disposition;
pub mod durable;
pub mod envelope;
pub mod error;
pub mod identity;
pub mod journal;
pub mod journal_route;
pub mod kdf;
pub mod marker;
#[cfg(feature = "test-support")]
pub mod memory_provider;
mod operation_authority;
pub mod operations;
pub mod protected;
pub mod provider;
pub mod random;
pub mod record;
pub mod record_class;
pub mod recovery;
pub mod root;
pub mod root_lock;
pub mod root_record;
pub mod root_store;
pub mod seal;
pub mod secure_store;
pub mod store_authority;
pub mod store_layout;
pub mod store_runtime;

pub use aad::{canonical_aad, RecordContext};
pub use admission::{
    AdmissionError, AdmissionScope, AdmittedRootCommitGuard, ExclusiveAdmissionGuard,
    SharedAdmissionGuard, OPERATION_ADMISSION_LOCK_FILE,
};
pub use authority::{
    advance_live_migration, commit_catalog_change, commit_inventory_capture,
    commit_journal_checkpoint, commit_journal_takeover, AuthorityError, BindingAdvance,
    CatalogChange, CatalogCommit, CatalogRecoveryReason, CatalogStep, CommittedShard,
    InventoryCapture, JournalCheckpoint, JournalSource, JournalTakeoverCommit, LoadedCatalog,
};
#[cfg(feature = "test-support")]
pub use authority::{list_records, load_catalog};
pub use catalog::{
    catalog_shard_of, CatalogDescriptor, CatalogError, CatalogPage, PageAddress,
    CATALOG_SHARD_COUNT, MAX_CATALOG_PAGE_DESCRIPTORS,
};
#[cfg(feature = "test-support")]
pub use commit::read_committed;
pub use commit::{
    commit_write, describe_record, load_authority, reconcile, Authority, CommitError, CommitStep,
    CommittedGeneration, Debris, DebrisKind, MarkerCommitted, Reconciled, RecordLocation,
    RecordStore, RecoveryReason, Resolution, WriteRequest,
};
pub use disposition::{disposition, is_r15_record_class, Disposition};
pub use durable::{
    generation_path, stage_and_promote, stage_and_promote_envelope, staging_path,
    DirectoryDurability, DurableFs, PromotedGeneration, StageFailure, StageFailureKind,
    StageRequest, StageStep, StagingResidue, StdFs, WriteOperationId,
};
pub use envelope::{parse_envelope, EnvelopeHeader, ParsedEnvelope};
pub use error::{AadError, KdfError, KeyProviderError, OpenError, RecoveryError, SealError};
pub use identity::{IdentityError, RecordIdentity};
pub use journal::{
    acquire_journal_durable_guard, allows_phase_transition, assert_binding_successor,
    assert_binding_takeover, assert_capture_successor, assert_fence, assert_live_binding,
    assert_manifest_promote_authority, assert_manifest_successor, assert_page_promote_authority,
    assert_progress_successor, assert_takeover_promote_authority, assert_takeover_successor,
    authoritative_manifest_revision, capture_inventory, checkpoint_progress,
    empty_inventory_digest, empty_journal_page_set_digest, inventory_digest, inventory_page_dir,
    is_terminal_phase, journal_envelope_epoch, journal_page_set_digest,
    load_authoritative_manifest, load_inventory_page, load_manifest_generation, mark_done,
    mark_recovery, operation_type, ordinary_mutating_writes_admitted, page_ref_for, phase_code,
    promote_inventory_set_fenced, promote_manifest_fenced, promote_page_fenced,
    publish_manifest_fenced, publish_takeover_fenced, root_named_journal_epoch,
    seal_inventory_pages, source_authority_kind, source_physical_authority_kind, source_scheme_id,
    transition_phase, verify_stored_inventory, with_fence, CandidateConflict,
    ForeignInventoryExtension, InventoryDigestVerifier, InventorySetWrite, JournalCheckpointCursor,
    JournalDurableContext, JournalDurableError, JournalDurableGuard, JournalError,
    JournalInventoryEntry, JournalInventoryExtent, JournalInventorySource, JournalManifest,
    JournalPage, JournalPageRef, JournalRevision, JournalTakeover, ManifestEnvelopeDigest,
    ManifestRead, MigrationExecutionError, MigrationFence, MigrationPhase, PublishedManifest,
    RecoveryReasonCode, SealedPage, VerifiedInventory, JOURNAL_MANIFEST_FORMAT_VERSION,
    JOURNAL_MANIFEST_RECORD_SCHEMA, JOURNAL_PAGE_FORMAT_VERSION, JOURNAL_PAGE_RECORD_SCHEMA,
    MAX_JOURNAL_ENTRY_BYTES, MAX_JOURNAL_INVENTORY_ENTRIES, MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES,
    MAX_JOURNAL_PAGE_BYTES, MAX_JOURNAL_PAGE_DESCRIPTORS,
};
pub use journal_route::{resolve_journal_key, JournalRoute, JournalRouteError};
pub use kdf::{derive_kek, KdfProfile, WSS_ARGON2ID_V1};
pub use marker::{
    content_digest, CommitMarker, MarkerBody, MarkerError, MarkerOperation, PendingBody,
};
pub use operation_authority::SnapshotRetention;
pub use operations::{
    AuthoritySnapshotGuard, OperationError, ProtectedMutation, ProtectedRecord, ProtectedStorage,
};
#[cfg(feature = "test-support")]
pub use protected::{protected_write, read_protected, reconcile_protected, ProtectedTarget};
pub use protected::{
    ProtectedCommitted, ProtectedError, ProtectedRead, ProtectedReconciled, ProtectedWrite,
    WriteDurability,
};
pub use provider::{
    AnchorState, CommittedRoot, EpochInfo, InstallationScopeId, KeyProvider, KeyState,
    PrepareRootAnchor, PreparedRootCommit, RootKeyRefV1, RootSlot,
};
pub use random::{OsRandom, RandomSource, RandomnessUnavailable};
pub use record::{open_record, seal_record, OpenedRecord, ADMITTED_RECORD_SCHEMAS};
pub use record_class::RecordClass;
pub use recovery::{unwrap_recovery, wrap_recovery, RecoveryMaterial, UnwrappedRecovery};
pub use root::{
    catalog_set_digest, decode_root_body, encode_root_body, key_epoch_set_digest,
    marker_set_digest, pointer_digest, root_digest, CatalogShard, KeyEpochEntry, LiveMigration,
    MarkerSetEntry, RootBody, RootCommitEvidence, RootCommitState, RootError,
};
pub use root_lock::{RootCommitGuard, ROOT_COMMIT_LOCK_FILE};
pub use root_record::{
    open_root_slot, seal_root_slot, KeyEpochAddress, KeyEpochRead, KeyEpochRecord, KeyEpochStatus,
    KeyEpochWrite, RootPointer, RootRecordError, RootSlotRead,
};
pub use root_store::{
    commit_root, load_committed_root, load_key_epoch_set, recover_root, repair_root_pointer,
    write_key_epoch, CommittedRootView, KeyEpochCommit, RootCommitRequest, RootCommitted,
    RootLayout, RootRecovery, RootRecoveryReason, RootStep, RootStoreError,
};
#[cfg(feature = "test-randomness")]
pub use seal::seal_with_random;
pub use seal::{open, seal, Key, RecordMeta, SealTarget};
pub use store_authority::SecureStoreAuthority;
pub use store_runtime::SecureStoreRuntime;
