use crate::identity::RecordIdentity;
use crate::record::{open_record, seal_record};
use crate::record_class::RecordClass;
use crate::seal::{seal_journal_manifest_bootstrap, Key, RecordMeta, SealTarget};

use super::operation_type;
use super::wire::{
    check_counter, push_operation_id, push_optional, push_optional_owner, validate_epoch,
    validate_final_inventory, validate_inventory_version, validate_journal_revision,
    validate_lease_fields, validate_operation_type, validate_phase, validate_target_key_ref,
    Reader,
};
use super::{
    JournalError, JOURNAL_MANIFEST_FORMAT_VERSION, JOURNAL_MANIFEST_RECORD_SCHEMA,
    MAX_JOURNAL_INVENTORY_ENTRIES,
};

/// One row of `journal_page_set_digest` (§10.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JournalPageRef {
    pub page_index: u32,
    pub page_generation: u64,
    pub page_entry_count: u32,
    pub page_content_digest: [u8; 32],
}

/// The key epoch that seals every envelope of this operation's journal (manifest and pages) for the
/// whole operation (§10.1.1, maintainer decision B).
///
/// `ENABLE` has no encrypted source, so its journal is sealed under the first protected epoch, the
/// target. `ROTATE` and `ENVELOPE_MIGRATION` keep the journal under the SOURCE epoch from the first
/// revision to the last, so recovery never depends on a mid-operation key switch and the journal
/// stays readable before the target authority is active, during interrupted conversion and after
/// the cutover while cleanup is still journal-driven. A rotation or envelope migration whose source
/// epoch is 0 has nothing to be sealed under and is refused.
pub fn journal_envelope_epoch(manifest: &JournalManifest) -> Result<u64, JournalError> {
    match manifest.operation_type {
        operation_type::ENABLE => Ok(manifest.target_epoch),
        operation_type::ROTATE | operation_type::ENVELOPE_MIGRATION
            if manifest.source_epoch > 0 =>
        {
            Ok(manifest.source_epoch)
        }
        operation_type::ROTATE | operation_type::ENVELOPE_MIGRATION => {
            Err(JournalError::InvalidCounter)
        }
        other => Err(JournalError::UnsupportedOperationType(other)),
    }
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
    pub has_target_root_key_ref: bool,
    pub target_root_key_ref_digest: Option<[u8; 32]>,
    pub fencing_generation: u64,
    pub inventory_version: u32,
    pub inventory_digest: [u8; 32],
    pub page_count: u32,
    pub entry_count: u32,
    pub journal_page_set_digest: [u8; 32],
    /// Whether the inventory above is the FINAL one, captured behind `ADMIT`'s write barrier (§10.3)
    /// rather than the preliminary one `DISCOVER` records. Set only by the capture that runs in
    /// `ADMIT`, in the same successor that binds the final inventory; never cleared; required from
    /// `CONVERT` on.
    pub final_inventory_captured: bool,
    pub cursor_page_index: u32,
    pub cursor_entry_index: u32,
    pub has_lease_owner: bool,
    pub lease_owner_id: Option<String>,
    pub lease_expires_unix_ms: Option<u64>,
    pub recovery_reason_code: u32,
}

impl JournalManifest {
    pub fn encode(&self) -> Result<Vec<u8>, JournalError> {
        self.validate_semantics()?;
        let mut out = Vec::with_capacity(512);
        out.extend_from_slice(&JOURNAL_MANIFEST_FORMAT_VERSION.to_be_bytes());
        push_operation_id(&mut out, &self.operation_id)?;
        out.extend_from_slice(&self.journal_revision.to_be_bytes());
        out.extend_from_slice(&self.operation_type.to_be_bytes());
        out.extend_from_slice(&self.phase.to_be_bytes());
        out.extend_from_slice(&self.source_epoch.to_be_bytes());
        out.extend_from_slice(&self.target_epoch.to_be_bytes());
        push_optional(&mut out, self.target_root_key_ref_digest, |out, digest| {
            out.extend_from_slice(&digest);
            Ok(())
        })?;
        out.extend_from_slice(&self.fencing_generation.to_be_bytes());
        out.extend_from_slice(&self.inventory_version.to_be_bytes());
        out.extend_from_slice(&self.inventory_digest);
        out.extend_from_slice(&self.page_count.to_be_bytes());
        out.extend_from_slice(&self.entry_count.to_be_bytes());
        out.extend_from_slice(&self.journal_page_set_digest);
        out.push(u8::from(self.final_inventory_captured));
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
        let target_root_key_ref_digest = reader.optional_digest()?;
        let fencing_generation = reader.u64()?;
        let inventory_version = reader.u32()?;
        let inventory_digest = reader.digest()?;
        let page_count = reader.u32()?;
        let entry_count = reader.u32()?;
        let journal_page_set_digest = reader.digest()?;
        let final_inventory_captured = reader.flag("final inventory flag is neither 0 nor 1")?;
        let cursor_page_index = reader.u32()?;
        let cursor_entry_index = reader.u32()?;
        let (has_lease_owner, lease_owner_id, lease_expires_unix_ms) = reader.optional_owner()?;
        let recovery_reason_code = reader.u32()?;
        if !reader.0.is_empty() {
            return Err(JournalError::Corrupt(
                "trailing bytes after journal manifest",
            ));
        }
        let manifest = JournalManifest {
            operation_id,
            journal_revision,
            operation_type,
            phase,
            source_epoch,
            target_epoch,
            has_target_root_key_ref: target_root_key_ref_digest.is_some(),
            target_root_key_ref_digest,
            fencing_generation,
            inventory_version,
            inventory_digest,
            page_count,
            entry_count,
            journal_page_set_digest,
            final_inventory_captured,
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

    pub fn seal(
        &self,
        key: &Key,
        record: &RecordIdentity,
        meta: RecordMeta,
    ) -> Result<Vec<u8>, JournalError> {
        if record.class() != RecordClass::Migration {
            return Err(JournalError::Corrupt("journal manifest identity required"));
        }
        if record.components().first().map(String::as_str) != Some(self.operation_id.as_str()) {
            return Err(JournalError::Corrupt(
                "migration identity disagrees with manifest",
            ));
        }
        if meta.record_generation != self.journal_revision {
            return Err(JournalError::GenerationMismatch);
        }
        if meta.record_schema != JOURNAL_MANIFEST_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(meta.record_schema));
        }
        if meta.key_epoch != journal_envelope_epoch(self)? {
            return Err(JournalError::KeyEpochMismatch);
        }
        let payload = self.encode()?;
        if self.journal_revision == 0 {
            if meta.record_generation != 0 {
                return Err(JournalError::GenerationMismatch);
            }
            let target = SealTarget {
                context: record.context(),
                meta,
            };
            return seal_journal_manifest_bootstrap(key, &target, &payload)
                .map_err(JournalError::Seal);
        }
        seal_record(key, record, meta, &payload).map_err(JournalError::Seal)
    }

    pub fn open(
        key: &Key,
        record: &RecordIdentity,
        journal_revision: u64,
        envelope: &[u8],
    ) -> Result<Self, JournalError> {
        if record.class() != RecordClass::Migration {
            return Err(JournalError::Corrupt("journal manifest identity required"));
        }
        let opened = open_record(key, record, envelope).map_err(JournalError::Open)?;
        if opened.header.record_schema != JOURNAL_MANIFEST_RECORD_SCHEMA {
            return Err(JournalError::UnsupportedFormat(opened.header.record_schema));
        }
        if opened.header.record_generation != journal_revision {
            return Err(JournalError::GenerationMismatch);
        }
        let manifest = JournalManifest::decode(&opened.payload)?;
        if manifest.journal_revision != journal_revision {
            return Err(JournalError::GenerationMismatch);
        }
        if opened.header.key_epoch != journal_envelope_epoch(&manifest)? {
            return Err(JournalError::KeyEpochMismatch);
        }
        if record.components().first().map(String::as_str) != Some(manifest.operation_id.as_str()) {
            return Err(JournalError::Corrupt(
                "migration identity disagrees with manifest",
            ));
        }
        Ok(manifest)
    }

    fn validate_semantics(&self) -> Result<(), JournalError> {
        validate_journal_revision(self.journal_revision)?;
        validate_epoch(self.source_epoch, true)?;
        validate_epoch(self.target_epoch, false)?;
        validate_operation_type(self.operation_type)?;
        validate_phase(self.phase)?;
        validate_inventory_version(self.inventory_version)?;
        check_counter(self.fencing_generation)?;
        if self.page_count as u64 > MAX_JOURNAL_INVENTORY_ENTRIES as u64 {
            return Err(JournalError::TooManyEntries);
        }
        if self.entry_count > MAX_JOURNAL_INVENTORY_ENTRIES {
            return Err(JournalError::TooManyEntries);
        }
        if self.page_count > 0 && self.cursor_page_index >= self.page_count {
            return Err(JournalError::InvalidPageIndex);
        }
        validate_target_key_ref(self)?;
        validate_lease_fields(self)?;
        validate_final_inventory(self)?;
        journal_envelope_epoch(self)?;
        Ok(())
    }
}
