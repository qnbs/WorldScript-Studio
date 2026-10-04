//! Gate 4 slice 4C: migration journal manifest and paged inventory codec (§10.1, §10.1.1).
//!
//! Defines `journal_page_set_digest`, the authenticated journal manifest body sealed under
//! `migration:<operation-id>`, and the page bodies sealed under `migration-page:<operation-id>:<page-index>`.
//! No migration state machine, durable I/O, or root live-migration binding updates live here.

use sha2::{Digest, Sha256};

use crate::aad::{tagged_identity_binding_parts, MAX_DIRECT_IDENTITY_LEN};
use crate::anchor::MAX_OPERATION_ID_LEN;
use crate::disposition::{disposition, Disposition};
use crate::identity::RecordIdentity;
use crate::marker::content_digest;
use crate::record::{open_record, seal_record};
use crate::record_class::RecordClass;
use crate::root::RootError;
use crate::seal::{Key, RecordMeta};

pub const JOURNAL_MANIFEST_FORMAT_VERSION: u32 = 1;
pub const JOURNAL_PAGE_FORMAT_VERSION: u32 = 1;
pub const JOURNAL_PAGE_RECORD_SCHEMA: u32 = 1;
pub const MAX_JOURNAL_PAGE_DESCRIPTORS: usize = 4096;
pub const MAX_JOURNAL_PAGE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_JOURNAL_INVENTORY_ENTRIES: u32 = 1_000_000;
pub const MAX_JOURNAL_ENTRY_BYTES: usize = 1024;

const JOURNAL_PAGE_SET_DOMAIN: &[u8] = b"worldscript-r15/journal-pages/v1";
const INVENTORY_DOMAIN: &[u8] = b"worldscript-r15/inventory/v1";

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

/// One row of `journal_page_set_digest` (§10.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JournalPageRef {
    pub page_index: u32,
    pub page_generation: u64,
    pub page_entry_count: u32,
    pub page_content_digest: [u8; 32],
}

/// The authenticated journal manifest body (§10.1.1), excluding the envelope header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalManifest {
    pub operation_id: String,
    pub journal_revision: u64,
    pub operation_type: u32,
    pub phase: u32,
    pub source_epoch: u64,
    pub target_epoch: u64,
    pub fencing_generation: u64,
    pub inventory_version: u32,
    pub inventory_digest: [u8; 32],
    pub page_count: u32,
    pub entry_count: u32,
    pub journal_page_set_digest: [u8; 32],
    pub cursor_page_index: u32,
    pub cursor_entry_index: u32,
    pub has_lease_owner: bool,
    pub lease_owner_id: Option<String>,
    pub lease_expires_unix_ms: Option<u64>,
    pub recovery_reason_code: u32,
}

impl JournalManifest {
    pub fn encode(&self) -> Result<Vec<u8>, JournalError> {
        validate_journal_revision(self.journal_revision)?;
        validate_epoch(self.source_epoch, true)?;
        validate_epoch(self.target_epoch, false)?;
        validate_fence(self.fencing_generation, self.phase)?;
        let mut out = Vec::with_capacity(512);
        out.extend_from_slice(&JOURNAL_MANIFEST_FORMAT_VERSION.to_be_bytes());
        push_operation_id(&mut out, &self.operation_id)?;
        out.extend_from_slice(&self.journal_revision.to_be_bytes());
        out.extend_from_slice(&self.operation_type.to_be_bytes());
        out.extend_from_slice(&self.phase.to_be_bytes());
        out.extend_from_slice(&self.source_epoch.to_be_bytes());
        out.extend_from_slice(&self.target_epoch.to_be_bytes());
        out.extend_from_slice(&self.fencing_generation.to_be_bytes());
        out.extend_from_slice(&self.inventory_version.to_be_bytes());
        out.extend_from_slice(&self.inventory_digest);
        out.extend_from_slice(&self.page_count.to_be_bytes());
        out.extend_from_slice(&self.entry_count.to_be_bytes());
        out.extend_from_slice(&self.journal_page_set_digest);
        out.extend_from_slice(&self.cursor_page_index.to_be_bytes());
        out.extend_from_slice(&self.cursor_entry_index.to_be_bytes());
        push_optional_owner(&mut out, self)?;
        out.extend_from_slice(&self.recovery_reason_code.to_be_bytes());
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, JournalError> {
        let mut reader = Reader(bytes);
        let format = reader.u32()?;
        if format != JOURNAL_MANIFEST_FORMAT_VERSION {
            return Err(JournalError::UnsupportedFormat(format));
        }
        let operation_id = reader.operation_id()?;
        let journal_revision = reader.u64()?;
        let operation_type = reader.u32()?;
        let phase = reader.u32()?;
        let source_epoch = reader.u64()?;
        let target_epoch = reader.u64()?;
        let fencing_generation = reader.u64()?;
        let inventory_version = reader.u32()?;
        let inventory_digest = reader.digest()?;
        let page_count = reader.u32()?;
        let entry_count = reader.u32()?;
        let journal_page_set_digest = reader.digest()?;
        let cursor_page_index = reader.u32()?;
        let cursor_entry_index = reader.u32()?;
        let (has_lease_owner, lease_owner_id, lease_expires_unix_ms) = reader.optional_owner()?;
        let recovery_reason_code = reader.u32()?;
        if !reader.0.is_empty() {
            return Err(JournalError::Corrupt("trailing bytes after journal manifest"));
        }
        let manifest = JournalManifest {
            operation_id,
            journal_revision,
            operation_type,
            phase,
            source_epoch,
            target_epoch,
            fencing_generation,
            inventory_version,
            inventory_digest,
            page_count,
            entry_count,
            journal_page_set_digest,
            cursor_page_index,
            cursor_entry_index,
            has_lease_owner,
            lease_owner_id,
            lease_expires_unix_ms,
            recovery_reason_code,
        };
        manifest.encode()?;
        Ok(manifest)
    }

    /// Refuses a manifest whose page-set digest does not match the supplied page refs.
    pub fn verify_page_set(&self, pages: &[JournalPageRef]) -> Result<(), JournalError> {
        if pages.len() as u32 != self.page_count {
            return Err(JournalError::PageSetMismatch);
        }
        let digest = journal_page_set_digest(pages)?;
        if digest != self.journal_page_set_digest {
            return Err(JournalError::PageSetMismatch);
        }
        Ok(())
    }

    /// Refuses when manifest counters or `inventory_digest` disagree with supplied entries.
    pub fn verify_inventory(&self, entries: &[JournalInventoryEntry]) -> Result<(), JournalError> {
        if entries.len() as u32 != self.entry_count {
            return Err(JournalError::EntryCountMismatch);
        }
        let digest = inventory_digest(self.inventory_version, entries)?;
        if digest != self.inventory_digest {
            return Err(JournalError::InconsistentInventory);
        }
        Ok(())
    }
}

/// §10.1 / §5.4 migration inventory descriptor carried on a journal page.
#[derive(Clone, PartialEq, Eq)]
pub struct JournalInventoryEntry {
    pub record: RecordIdentity,
    pub identity_binding: Vec<u8>,
    pub project_scope_binding: Vec<u8>,
    pub source_authority_kind: u32,
    pub source_physical_authority_kind: u32,
    pub source_generation: Option<u64>,
    pub source_evidence_digest: Option<[u8; 32]>,
    pub foreign: Option<ForeignInventoryExtension>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ForeignInventoryExtension {
    pub source_scheme_id: u32,
    pub source_format_version: u32,
    pub source_identity_binding: Vec<u8>,
    pub source_project_scope_binding: Vec<u8>,
}

/// Source-side fields for one migration inventory descriptor (§10.1).
#[derive(Clone, PartialEq, Eq)]
pub struct JournalInventorySource {
    pub authority_kind: u32,
    pub physical_authority_kind: u32,
    pub generation: Option<u64>,
    pub evidence_digest: Option<[u8; 32]>,
    pub foreign: Option<ForeignInventoryExtension>,
}

impl JournalInventoryEntry {
    pub fn new(
        record: RecordIdentity,
        source: JournalInventorySource,
    ) -> Result<Self, JournalError> {
        let (identity_binding, project_scope_binding) =
            tagged_identity_binding_parts(&record.context())
                .map_err(JournalError::InvalidIdentity)?;
        let entry = JournalInventoryEntry {
            record,
            identity_binding,
            project_scope_binding,
            source_authority_kind: source.authority_kind,
            source_physical_authority_kind: source.physical_authority_kind,
            source_generation: source.generation,
            source_evidence_digest: source.evidence_digest,
            foreign: source.foreign,
        };
        entry.validate()?;
        Ok(entry)
    }

    fn sort_key(&self) -> InventorySortKey<'_> {
        InventorySortKey {
            class: self.record.class().token(),
            identity: &self.identity_binding,
            project: &self.project_scope_binding,
            source_authority_kind: self.source_authority_kind,
            source_physical_authority_kind: self.source_physical_authority_kind,
            source_scheme_id: self
                .foreign
                .as_ref()
                .map(|f| f.source_scheme_id)
                .unwrap_or(0),
        }
    }

    fn encoded_len(&self) -> Result<usize, JournalError> {
        let mut probe = Vec::new();
        self.encode_payload_into(&mut probe)?;
        Ok(probe.len())
    }

    fn encode_into(&self, out: &mut Vec<u8>) -> Result<(), JournalError> {
        self.validate_semantics()?;
        self.encode_payload_into(out)
    }

    fn encode_payload_into(&self, out: &mut Vec<u8>) -> Result<(), JournalError> {
        push_string(out, self.record.class().token());
        out.extend_from_slice(&self.identity_binding);
        out.extend_from_slice(&self.project_scope_binding);
        out.extend_from_slice(&self.source_authority_kind.to_be_bytes());
        out.extend_from_slice(&self.source_physical_authority_kind.to_be_bytes());
        push_optional(out, self.source_generation, |out, value| {
            check_counter(value)?;
            out.extend_from_slice(&value.to_be_bytes());
            Ok(())
        })?;
        push_optional(out, self.source_evidence_digest, |out, digest| {
            out.extend_from_slice(&digest);
            Ok(())
        })?;
        match &self.foreign {
            None => out.push(0),
            Some(foreign) => {
                out.push(1);
                out.extend_from_slice(&foreign.source_scheme_id.to_be_bytes());
                out.extend_from_slice(&foreign.source_format_version.to_be_bytes());
                out.extend_from_slice(&foreign.source_identity_binding);
                out.extend_from_slice(&foreign.source_project_scope_binding);
            }
        }
        let components = self.record.components();
        out.extend_from_slice(&(components.len() as u32).to_be_bytes());
        for component in components {
            push_string(out, component);
        }
        Ok(())
    }

    fn validate(&self) -> Result<(), JournalError> {
        self.validate_semantics()?;
        if self.encoded_len()? > MAX_JOURNAL_ENTRY_BYTES {
            return Err(JournalError::TooLarge);
        }
        Ok(())
    }

    fn validate_semantics(&self) -> Result<(), JournalError> {
        if disposition(self.record.class()) == Some(Disposition::NativeControlPlane) {
            return Err(JournalError::Corrupt(
                "control-plane records are excluded from migration inventory",
            ));
        }
        match self.source_authority_kind {
            source_authority_kind::LEGACY_PLAINTEXT => self.validate_legacy_plaintext(),
            source_authority_kind::R15_PROTECTED => self.validate_r15_protected(),
            source_authority_kind::FOREIGN_PROTECTED => self.validate_foreign_protected(),
            other => Err(JournalError::UnsupportedSourceAuthority(other)),
        }
    }

    fn validate_legacy_plaintext(&self) -> Result<(), JournalError> {
        if self.source_generation.is_some() {
            return Err(JournalError::Corrupt("legacy plaintext carries no generation"));
        }
        if self.source_evidence_digest.is_none() {
            return Err(JournalError::Corrupt("legacy plaintext requires evidence digest"));
        }
        if self.foreign.is_some() {
            return Err(JournalError::Corrupt("legacy plaintext has no foreign extension"));
        }
        Ok(())
    }

    fn validate_r15_protected(&self) -> Result<(), JournalError> {
        let generation = self
            .source_generation
            .ok_or(JournalError::Corrupt("r15 protected requires generation"))?;
        check_counter(generation)?;
        if self.source_evidence_digest.is_some() {
            return Err(JournalError::Corrupt("r15 protected omits evidence digest"));
        }
        if self.foreign.is_some() {
            return Err(JournalError::Corrupt("r15 protected has no foreign extension"));
        }
        Ok(())
    }

    fn validate_foreign_protected(&self) -> Result<(), JournalError> {
        if self.source_evidence_digest.is_none() {
            return Err(JournalError::Corrupt("foreign protected requires evidence digest"));
        }
        if self.foreign.is_none() {
            return Err(JournalError::Corrupt("foreign protected requires extension"));
        }
        Ok(())
    }
}

struct InventorySortKey<'a> {
    class: &'static str,
    identity: &'a [u8],
    project: &'a [u8],
    source_authority_kind: u32,
    source_physical_authority_kind: u32,
    source_scheme_id: u32,
}

impl PartialEq for InventorySortKey<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
    }
}

impl Eq for InventorySortKey<'_> {}

impl PartialOrd for InventorySortKey<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for InventorySortKey<'_> {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (
            self.class.as_bytes(),
            self.identity,
            self.project,
            self.source_authority_kind.to_be_bytes(),
            self.source_physical_authority_kind.to_be_bytes(),
            self.source_scheme_id.to_be_bytes(),
        )
            .cmp(&(
                other.class.as_bytes(),
                other.identity,
                other.project,
                other.source_authority_kind.to_be_bytes(),
                other.source_physical_authority_kind.to_be_bytes(),
                other.source_scheme_id.to_be_bytes(),
            ))
    }
}

/// One authenticated journal page body (§10.1.1).
#[derive(Clone, PartialEq, Eq)]
pub struct JournalPage {
    pub page_index: u32,
    pub page_generation: u64,
    entries: Vec<JournalInventoryEntry>,
}

impl JournalPage {
    pub fn new(page_index: u32, page_generation: u64, entries: Vec<JournalInventoryEntry>) -> Result<Self, JournalError> {
        if entries.len() > MAX_JOURNAL_PAGE_DESCRIPTORS {
            return Err(JournalError::InvalidDescriptorCount);
        }
        let mut entries = entries;
        entries.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        refuse_duplicate_entries(&entries)?;
        let page = JournalPage {
            page_index,
            page_generation,
            entries,
        };
        page.validate()?;
        Ok(page)
    }

    pub fn page_index(&self) -> u32 {
        self.page_index
    }

    pub fn page_generation(&self) -> u64 {
        self.page_generation
    }

    pub fn entries(&self) -> &[JournalInventoryEntry] {
        &self.entries
    }

    pub fn encode(&self) -> Result<Vec<u8>, JournalError> {
        self.validate()?;
        let mut out = Vec::with_capacity(16 + self.entries.len() * 256);
        out.extend_from_slice(&JOURNAL_PAGE_FORMAT_VERSION.to_be_bytes());
        out.extend_from_slice(&self.page_index.to_be_bytes());
        out.extend_from_slice(&self.page_generation.to_be_bytes());
        out.extend_from_slice(&(self.entries.len() as u32).to_be_bytes());
        for entry in &self.entries {
            entry.encode_into(&mut out)?;
        }
        if out.len() > MAX_JOURNAL_PAGE_BYTES {
            return Err(JournalError::TooLarge);
        }
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, JournalError> {
        if bytes.len() > MAX_JOURNAL_PAGE_BYTES {
            return Err(JournalError::TooLarge);
        }
        let mut reader = Reader(bytes);
        let format = reader.u32()?;
        if format != JOURNAL_PAGE_FORMAT_VERSION {
            return Err(JournalError::UnsupportedFormat(format));
        }
        let page_index = reader.u32()?;
        let page_generation = reader.u64()?;
        let count = reader.u32()? as usize;
        if count > MAX_JOURNAL_PAGE_DESCRIPTORS {
            return Err(JournalError::InvalidDescriptorCount);
        }
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            entries.push(reader.inventory_entry()?);
        }
        if !reader.0.is_empty() {
            return Err(JournalError::Corrupt("trailing bytes after journal page"));
        }
        let page = JournalPage {
            page_index,
            page_generation,
            entries,
        };
        page.validate()?;
        let reencoded = page.encode()?;
        if reencoded != bytes {
            return Err(JournalError::Corrupt("journal page is not canonical"));
        }
        Ok(page)
    }

    pub fn content_digest(&self) -> Result<[u8; 32], JournalError> {
        Ok(content_digest(&self.encode()?))
    }

    pub fn seal(
        &self,
        key: &Key,
        record: &RecordIdentity,
        meta: RecordMeta,
    ) -> Result<Vec<u8>, JournalError> {
        if meta.record_generation != self.page_generation {
            return Err(JournalError::GenerationMismatch);
        }
        if meta.record_schema != JOURNAL_PAGE_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(meta.record_schema));
        }
        if record.class() != RecordClass::MigrationPage {
            return Err(JournalError::WrongPageIndex);
        }
        let page_index = migration_page_index(record)?;
        if page_index != self.page_index {
            return Err(JournalError::WrongPageIndex);
        }
        let payload = self.encode()?;
        seal_record(key, record, meta, &payload).map_err(JournalError::Seal)
    }

    pub fn open(
        key: &Key,
        record: &RecordIdentity,
        page_generation: u64,
        envelope: &[u8],
    ) -> Result<Self, JournalError> {
        let opened =
            open_record(key, record, envelope).map_err(JournalError::Open)?;
        if opened.header.record_generation != page_generation {
            return Err(JournalError::GenerationMismatch);
        }
        if opened.header.record_schema != JOURNAL_PAGE_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(opened.header.record_schema));
        }
        let page = JournalPage::decode(&opened.payload)?;
        if migration_page_index(record)? != page.page_index {
            return Err(JournalError::WrongPageIndex);
        }
        Ok(page)
    }

    fn validate(&self) -> Result<(), JournalError> {
        check_counter(self.page_generation)?;
        refuse_duplicate_entries(&self.entries)?;
        let ascending = self
            .entries
            .windows(2)
            .all(|pair| pair[0].sort_key() < pair[1].sort_key());
        if !ascending {
            return Err(JournalError::NotStrictlyAscending);
        }
        self.entries.iter().try_for_each(|entry| entry.validate())?;
        Ok(())
    }
}

/// `journal_page_set_digest` (§10.1.1).
pub fn journal_page_set_digest(pages: &[JournalPageRef]) -> Result<[u8; 32], JournalError> {
    let mut sorted = pages.to_vec();
    sorted.sort_by_key(|page| page.page_index);
    refuse_duplicate_pages(&sorted)?;
    let mut hasher = Sha256::new().chain_update(JOURNAL_PAGE_SET_DOMAIN);
    hasher.update(entry_count(sorted.len())?);
    for page in sorted {
        hasher.update(page.page_index.to_be_bytes());
        check_counter(page.page_generation)?;
        hasher.update(page.page_generation.to_be_bytes());
        hasher.update(page.page_entry_count.to_be_bytes());
        hasher.update(page.page_content_digest);
    }
    Ok(hasher.finalize().into())
}

/// §10.2 bootstrap: `page_count = 0` page-set digest.
pub fn empty_journal_page_set_digest() -> [u8; 32] {
    Sha256::new()
        .chain_update(JOURNAL_PAGE_SET_DOMAIN)
        .chain_update(0u32.to_be_bytes())
        .finalize()
        .into()
}

/// `inventory_digest` (§5.4) over the supplied entries.
pub fn inventory_digest(
    inventory_version: u32,
    entries: &[JournalInventoryEntry],
) -> Result<[u8; 32], JournalError> {
    if entries.len() as u32 > MAX_JOURNAL_INVENTORY_ENTRIES {
        return Err(JournalError::TooManyEntries);
    }
    let mut sorted: Vec<&JournalInventoryEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
    sorted
        .windows(2)
        .try_for_each(|pair| {
            if pair[0].sort_key() == pair[1].sort_key() {
                Err(JournalError::DuplicateEntry)
            } else {
                Ok(())
            }
        })?;
    let mut hasher = Sha256::new().chain_update(INVENTORY_DOMAIN);
    hasher.update(inventory_version.to_be_bytes());
    hasher.update(entry_count(sorted.len())?);
    for entry in sorted {
        entry.validate()?;
        hash_string(&mut hasher, entry.record.class().token());
        hasher.update(&entry.identity_binding);
        hasher.update(&entry.project_scope_binding);
        hasher.update(entry.source_authority_kind.to_be_bytes());
        hasher.update(entry.source_physical_authority_kind.to_be_bytes());
        hash_optional(&mut hasher, entry.source_generation, |hasher, value| {
            check_counter(value)?;
            hasher.update(value.to_be_bytes());
            Ok(())
        })?;
        hash_optional(&mut hasher, entry.source_evidence_digest, |hasher, digest| {
            hasher.update(digest);
            Ok(())
        })?;
        if let Some(foreign) = &entry.foreign {
            hasher.update(foreign.source_scheme_id.to_be_bytes());
            hasher.update(foreign.source_format_version.to_be_bytes());
            hasher.update(&foreign.source_identity_binding);
            hasher.update(&foreign.source_project_scope_binding);
        }
    }
    Ok(hasher.finalize().into())
}

pub fn empty_inventory_digest(inventory_version: u32) -> [u8; 32] {
    Sha256::new()
        .chain_update(INVENTORY_DOMAIN)
        .chain_update(inventory_version.to_be_bytes())
        .chain_update(0u32.to_be_bytes())
        .finalize()
        .into()
}

/// Builds the page-set row for a sealed page.
pub fn page_ref_for(page: &JournalPage, envelope: &[u8]) -> Result<JournalPageRef, JournalError> {
    Ok(JournalPageRef {
        page_index: page.page_index,
        page_generation: page.page_generation,
        page_entry_count: page.entries.len() as u32,
        page_content_digest: content_digest(envelope),
    })
}

fn refuse_duplicate_pages(pages: &[JournalPageRef]) -> Result<(), JournalError> {
    pages
        .windows(2)
        .try_for_each(|pair| {
            if pair[0].page_index == pair[1].page_index {
                Err(JournalError::DuplicateEntry)
            } else {
                Ok(())
            }
        })
}

fn refuse_duplicate_entries(entries: &[JournalInventoryEntry]) -> Result<(), JournalError> {
    entries
        .windows(2)
        .try_for_each(|pair| {
            if pair[0].sort_key() == pair[1].sort_key() {
                Err(JournalError::DuplicateEntry)
            } else {
                Ok(())
            }
        })
}

fn entry_count(len: usize) -> Result<[u8; 4], JournalError> {
    u32::try_from(len)
        .map(|value| value.to_be_bytes())
        .map_err(|_| JournalError::TooManyEntries)
}

fn check_counter(value: u64) -> Result<(), JournalError> {
    if value == 0 || value == u64::MAX {
        Err(JournalError::InvalidCounter)
    } else {
        Ok(())
    }
}

fn validate_journal_revision(value: u64) -> Result<(), JournalError> {
    if value == u64::MAX {
        Err(JournalError::InvalidCounter)
    } else {
        Ok(())
    }
}

fn validate_epoch(value: u64, allow_zero: bool) -> Result<(), JournalError> {
    if value == u64::MAX {
        return Err(JournalError::InvalidCounter);
    }
    if !allow_zero && value == 0 {
        return Err(JournalError::InvalidCounter);
    }
    Ok(())
}

fn validate_fence(fencing_generation: u64, phase: u32) -> Result<(), JournalError> {
    if fencing_generation == u64::MAX {
        return Err(JournalError::InvalidCounter);
    }
    if phase == phase_code::BOOTSTRAP_TARGET && fencing_generation == 0 {
        return Err(JournalError::InvalidCounter);
    }
    Ok(())
}

fn push_operation_id(out: &mut Vec<u8>, value: &str) -> Result<(), JournalError> {
    let len = value.len();
    if len == 0 || len > MAX_OPERATION_ID_LEN {
        return Err(JournalError::InvalidOperationId);
    }
    out.extend_from_slice(&(len as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

fn push_optional_owner(out: &mut Vec<u8>, manifest: &JournalManifest) -> Result<(), JournalError> {
    if !manifest.has_lease_owner {
        out.push(0);
        return Ok(());
    }
    out.push(1);
    let owner = manifest
        .lease_owner_id
        .as_ref()
        .ok_or(JournalError::Corrupt("lease owner flag without id"))?;
    push_string(out, owner);
    let expires = manifest
        .lease_expires_unix_ms
        .ok_or(JournalError::Corrupt("lease owner flag without expiry"))?;
    out.extend_from_slice(&expires.to_be_bytes());
    Ok(())
}

fn push_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

fn push_optional<T, W>(
    out: &mut Vec<u8>,
    value: Option<T>,
    write_present: W,
) -> Result<(), JournalError>
where
    W: FnOnce(&mut Vec<u8>, T) -> Result<(), JournalError>,
{
    match value {
        None => out.push(0),
        Some(value) => {
            out.push(1);
            write_present(out, value)?;
        }
    }
    Ok(())
}

fn hash_optional<T, H>(
    hasher: &mut Sha256,
    value: Option<T>,
    hash_present: H,
) -> Result<(), JournalError>
where
    H: FnOnce(&mut Sha256, T) -> Result<(), JournalError>,
{
    match value {
        None => hasher.update([0]),
        Some(value) => {
            hasher.update([1]);
            hash_present(hasher, value)?;
        }
    }
    Ok(())
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], JournalError> {
        if self.0.len() < len {
            return Err(JournalError::Corrupt("truncated journal bytes"));
        }
        let (head, tail) = self.0.split_at(len);
        self.0 = tail;
        Ok(head)
    }

    fn u32(&mut self) -> Result<u32, JournalError> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    fn u64(&mut self) -> Result<u64, JournalError> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().expect("8 bytes"),
        ))
    }

    fn digest(&mut self) -> Result<[u8; 32], JournalError> {
        Ok(self.take(32)?.try_into().expect("32 bytes"))
    }

    fn operation_id(&mut self) -> Result<String, JournalError> {
        let len = self.u32()? as usize;
        if len == 0 || len > MAX_OPERATION_ID_LEN {
            return Err(JournalError::InvalidOperationId);
        }
        std::str::from_utf8(self.take(len)?)
            .map(str::to_owned)
            .map_err(|_| JournalError::Corrupt("operation_id is not UTF-8"))
    }

    fn optional_owner(&mut self) -> Result<(bool, Option<String>, Option<u64>), JournalError> {
        match self.take(1)?[0] {
            0 => Ok((false, None, None)),
            1 => {
                let owner = self.string(MAX_OPERATION_ID_LEN)?.to_owned();
                let expires = self.u64()?;
                Ok((true, Some(owner), Some(expires)))
            }
            _ => Err(JournalError::Corrupt("lease owner flag is neither 0 nor 1")),
        }
    }

    fn string(&mut self, max_len: usize) -> Result<&'a str, JournalError> {
        let len = self.u32()? as usize;
        if len > max_len {
            return Err(JournalError::Corrupt("over-long string field"));
        }
        std::str::from_utf8(self.take(len)?)
            .map_err(|_| JournalError::Corrupt("string field is not UTF-8"))
    }

    fn binding(&mut self) -> Result<Vec<u8>, JournalError> {
        let start = self.0;
        let body_len = match self.take(1)?[0] {
            0 => 0,
            1 => 4 + self.string(MAX_DIRECT_IDENTITY_LEN)?.len(),
            2 => self.take(32).map(|_| 32)?,
            _ => return Err(JournalError::Corrupt("invalid identity binding tag")),
        };
        Ok(start[..=body_len].to_vec())
    }

    fn inventory_entry(&mut self) -> Result<JournalInventoryEntry, JournalError> {
        let start_len = self.0.len();
        let class = RecordClass::from_token(self.string(64)?)
            .ok_or(JournalError::Corrupt("unknown record class"))?;
        let identity_binding = self.binding()?;
        let project_scope_binding = self.binding()?;
        let source_authority_kind = self.u32()?;
        let source_physical_authority_kind = self.u32()?;
        let source_generation = self.optional_u64()?;
        let source_evidence_digest = self.optional_digest()?;
        let foreign = match self.take(1)?[0] {
            0 => None,
            1 => Some(ForeignInventoryExtension {
                source_scheme_id: self.u32()?,
                source_format_version: self.u32()?,
                source_identity_binding: self.binding()?,
                source_project_scope_binding: self.binding()?,
            }),
            _ => return Err(JournalError::Corrupt("foreign extension flag invalid")),
        };
        let component_count = self.u32()? as usize;
        if component_count > 8 {
            return Err(JournalError::Corrupt("too many identity components"));
        }
        let mut component_strings = Vec::with_capacity(component_count);
        for _ in 0..component_count {
            component_strings.push(self.string(16_384)?.to_owned());
        }
        let consumed = start_len - self.0.len();
        if consumed > MAX_JOURNAL_ENTRY_BYTES {
            return Err(JournalError::TooLarge);
        }
        let component_refs: Vec<&str> = component_strings.iter().map(String::as_str).collect();
        let record = RecordIdentity::new(class, &component_refs)
            .map_err(|_| JournalError::Corrupt("inventory entry identity does not rebuild"))?;
        let (identity, project) = tagged_identity_binding_parts(&record.context())
            .map_err(JournalError::InvalidIdentity)?;
        if identity != identity_binding || project != project_scope_binding {
            return Err(JournalError::Corrupt(
                "inventory entry bindings disagree with its identity",
            ));
        }
        JournalInventoryEntry::new(
            record,
            JournalInventorySource {
                authority_kind: source_authority_kind,
                physical_authority_kind: source_physical_authority_kind,
                generation: source_generation,
                evidence_digest: source_evidence_digest,
                foreign,
            },
        )
    }

    fn optional_u64(&mut self) -> Result<Option<u64>, JournalError> {
        match self.take(1)?[0] {
            0 => Ok(None),
            1 => {
                let value = self.u64()?;
                check_counter(value)?;
                Ok(Some(value))
            }
            _ => Err(JournalError::Corrupt("optional u64 flag invalid")),
        }
    }

    fn optional_digest(&mut self) -> Result<Option<[u8; 32]>, JournalError> {
        match self.take(1)?[0] {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(JournalError::Corrupt("optional digest flag invalid")),
        }
    }
}

fn migration_page_index(record: &RecordIdentity) -> Result<u32, JournalError> {
    let index = record
        .components()
        .get(1)
        .ok_or(JournalError::WrongPageIndex)?;
    index
        .parse::<u32>()
        .map_err(|_| JournalError::InvalidPageIndex)
}

fn hash_string(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u32).to_be_bytes());
    hasher.update(value.as_bytes());
}
