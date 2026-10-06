//! Gate 4 slice 4C/4D: migration journal manifest, paged inventory codec (§10.1, §10.1.1), and
//! execution state helpers (§10.3) for crash-resumable rotation/rekey.
//!
//! Defines `journal_page_set_digest`, the authenticated journal manifest body sealed under
//! `migration:<operation-id>`, and the page bodies sealed under `migration-page:<operation-id>:<page-index>`.
//! Slice 4D part A adds phase/fence/revision state only; durable I/O and root binding updates follow.

mod digest;
mod durable;
mod inventory;
mod manifest;
mod manifest_verify;
mod page;
mod state;
mod wire;

use crate::root::RootError;

pub const JOURNAL_MANIFEST_FORMAT_VERSION: u32 = 1;
pub const JOURNAL_MANIFEST_RECORD_SCHEMA: u32 = 1;
pub const JOURNAL_PAGE_FORMAT_VERSION: u32 = 1;
pub const JOURNAL_PAGE_RECORD_SCHEMA: u32 = 1;
pub const MAX_JOURNAL_PAGE_DESCRIPTORS: usize = 4096;
pub const MAX_JOURNAL_PAGE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_JOURNAL_INVENTORY_ENTRIES: u32 = 1_000_000;
pub const MAX_JOURNAL_ENTRY_BYTES: usize = 1024;

pub(crate) const JOURNAL_PAGE_SET_DOMAIN: &[u8] = b"worldscript-r15/journal-pages/v1";
pub(crate) const INVENTORY_DOMAIN: &[u8] = b"worldscript-r15/inventory/v1";

/// §10.3 phase codes (version 1).
pub mod phase_code {
    pub const BOOTSTRAP_TARGET: u32 = 1;
    pub const DISCOVER: u32 = 2;
    pub const PREPARE: u32 = 3;
    pub const ADMIT: u32 = 4;
    pub const CONVERT: u32 = 5;
    pub const VERIFY: u32 = 6;
    pub const COMMIT: u32 = 7;
    pub const RETIRE_OLD_AUTHORITY: u32 = 8;
    pub const FINALIZE: u32 = 9;
    pub const DONE: u32 = 10;
    pub const RECOVERY_REQUIRED: u32 = 11;
}

/// §10.1 operation types admitted in version 1 (disable is not admitted).
pub mod operation_type {
    pub const ENABLE: u32 = 1;
    pub const ROTATE: u32 = 2;
    pub const ENVELOPE_MIGRATION: u32 = 3;
}

pub mod source_authority_kind {
    pub const LEGACY_PLAINTEXT: u32 = 0;
    pub const R15_PROTECTED: u32 = 1;
    pub const FOREIGN_PROTECTED: u32 = 2;
}

pub mod source_physical_authority_kind {
    pub const TAURI_FILESYSTEM: u32 = 1;
    pub const PACKAGED_IDB: u32 = 2;
    pub const WEBVIEW_LOCALSTORAGE: u32 = 3;
    pub const WEBVIEW_INDEXEDDB: u32 = 4;
    pub const WEBVIEW_OPFS: u32 = 5;
    pub const R15_CORE: u32 = 6;
}

pub mod source_scheme_id {
    pub const NONE_PLAINTEXT: u32 = 0;
    pub const WEBVIEW_IDB_AT_REST_V1: u32 = 1;
    pub const CREDENTIAL_IDB_KEYSTORE_V1: u32 = 2;
}

/// Why journal bytes were refused. A refused value is never partially trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JournalError {
    Corrupt(&'static str),
    UnsupportedFormat(u32),
    InvalidCounter,
    InvalidOperationId,
    InvalidPageIndex,
    DuplicateEntry,
    TooManyEntries,
    NotStrictlyAscending,
    InvalidDescriptorCount,
    TooLarge,
    InconsistentInventory,
    PageSetMismatch,
    WrongPageIndex,
    EntryCountMismatch,
    UnsupportedSourceAuthority(u32),
    UnsupportedOperationType(u32),
    UnsupportedPhase(u32),
    UnsupportedPhysicalAuthority(u32),
    UnsupportedSourceScheme(u32),
    BindingMismatch,
    InvalidIdentity(crate::error::AadError),
    Seal(crate::error::SealError),
    Open(crate::error::OpenError),
    GenerationMismatch,
    Root(RootError),
}

impl From<RootError> for JournalError {
    fn from(value: RootError) -> Self {
        JournalError::Root(value)
    }
}

pub use digest::{
    empty_inventory_digest, empty_journal_page_set_digest, inventory_digest,
    journal_page_set_digest, page_ref_for, InventoryDigestVerifier,
};
pub use durable::{
    acquire_journal_durable_guard, load_authoritative_manifest, load_manifest_generation,
    promote_manifest_fenced, promote_page_fenced, with_fence, JournalDurableContext,
    JournalDurableError, JournalDurableGuard,
};
pub use inventory::{ForeignInventoryExtension, JournalInventoryEntry, JournalInventorySource};
pub use manifest::{JournalManifest, JournalPageRef};
pub use page::JournalPage;
pub use state::{
    allows_phase_transition, assert_fence, assert_live_binding, assert_manifest_promote_authority,
    assert_page_promote_authority, authoritative_manifest_revision, checkpoint_progress,
    is_terminal_phase, mark_done, mark_recovery, ordinary_mutating_writes_admitted,
    transition_phase, JournalCheckpointCursor, JournalInventoryExtent, JournalRevision,
    ManifestEnvelopeDigest, MigrationExecutionError, MigrationFence, MigrationPhase,
    RecoveryReasonCode,
};
