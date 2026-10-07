use sha2::{Digest, Sha256};

use crate::aad::{tagged_identity_binding_parts, MAX_DIRECT_IDENTITY_LEN};
use crate::anchor::MAX_OPERATION_ID_LEN;
use crate::identity::RecordIdentity;
use crate::record_class::RecordClass;

use super::inventory::{ForeignInventoryExtension, JournalInventoryEntry, JournalInventorySource};
use super::manifest::{JournalManifest, JournalPageRef};
use super::operation_type;
use super::phase_code;
use super::source_physical_authority_kind;
use super::source_scheme_id;
use super::JournalError;
use super::MAX_JOURNAL_ENTRY_BYTES;

pub(crate) fn refuse_duplicate_adjacent<T>(
    items: &[T],
    is_duplicate: impl Fn(&T, &T) -> bool,
) -> Result<(), JournalError> {
    items.windows(2).try_for_each(|pair| {
        if is_duplicate(&pair[0], &pair[1]) {
            Err(JournalError::DuplicateEntry)
        } else {
            Ok(())
        }
    })
}

pub(crate) fn refuse_duplicate_pages(pages: &[JournalPageRef]) -> Result<(), JournalError> {
    refuse_duplicate_adjacent(pages, |left, right| left.page_index == right.page_index)
}

pub(crate) fn refuse_duplicate_entries(
    entries: &[JournalInventoryEntry],
) -> Result<(), JournalError> {
    refuse_duplicate_adjacent(entries, |left, right| left.sort_key() == right.sort_key())
}

pub(crate) fn entry_count(len: usize) -> Result<[u8; 4], JournalError> {
    u32::try_from(len)
        .map(|value| value.to_be_bytes())
        .map_err(|_| JournalError::TooManyEntries)
}

pub(crate) fn check_counter(value: u64) -> Result<(), JournalError> {
    if value == 0 || value == u64::MAX {
        Err(JournalError::InvalidCounter)
    } else {
        Ok(())
    }
}

pub(crate) fn validate_journal_revision(value: u64) -> Result<(), JournalError> {
    if value == u64::MAX {
        Err(JournalError::InvalidCounter)
    } else {
        Ok(())
    }
}

pub(crate) fn validate_epoch(value: u64, allow_zero: bool) -> Result<(), JournalError> {
    if value == u64::MAX {
        return Err(JournalError::InvalidCounter);
    }
    if !allow_zero && value == 0 {
        return Err(JournalError::InvalidCounter);
    }
    Ok(())
}

pub(crate) fn validate_operation_type(value: u32) -> Result<(), JournalError> {
    match value {
        operation_type::ENABLE | operation_type::ROTATE | operation_type::ENVELOPE_MIGRATION => {
            Ok(())
        }
        other => Err(JournalError::UnsupportedOperationType(other)),
    }
}

pub(crate) fn validate_phase(value: u32) -> Result<(), JournalError> {
    match value {
        phase_code::BOOTSTRAP_TARGET
        | phase_code::DISCOVER
        | phase_code::PREPARE
        | phase_code::ADMIT
        | phase_code::CONVERT
        | phase_code::VERIFY
        | phase_code::COMMIT
        | phase_code::RETIRE_OLD_AUTHORITY
        | phase_code::FINALIZE
        | phase_code::DONE
        | phase_code::RECOVERY_REQUIRED => Ok(()),
        other => Err(JournalError::UnsupportedPhase(other)),
    }
}

pub(crate) fn validate_inventory_version(value: u32) -> Result<(), JournalError> {
    if value == 0 {
        Err(JournalError::UnsupportedFormat(value))
    } else {
        Ok(())
    }
}

pub(crate) fn validate_physical_authority_kind(value: u32) -> Result<(), JournalError> {
    match value {
        source_physical_authority_kind::TAURI_FILESYSTEM
        | source_physical_authority_kind::PACKAGED_IDB
        | source_physical_authority_kind::WEBVIEW_LOCALSTORAGE
        | source_physical_authority_kind::WEBVIEW_INDEXEDDB
        | source_physical_authority_kind::WEBVIEW_OPFS
        | source_physical_authority_kind::R15_CORE => Ok(()),
        other => Err(JournalError::UnsupportedPhysicalAuthority(other)),
    }
}

pub(crate) fn validate_registered_foreign_source_scheme(value: u32) -> Result<(), JournalError> {
    match value {
        source_scheme_id::WEBVIEW_IDB_AT_REST_V1 | source_scheme_id::CREDENTIAL_IDB_KEYSTORE_V1 => {
            Ok(())
        }
        other => Err(JournalError::UnsupportedSourceScheme(other)),
    }
}

pub(crate) fn validate_foreign_source_format_version(
    scheme_id: u32,
    version: u32,
) -> Result<(), JournalError> {
    if version == 0 || version == u32::MAX {
        return Err(JournalError::UnsupportedFormat(version));
    }
    match scheme_id {
        source_scheme_id::WEBVIEW_IDB_AT_REST_V1 | source_scheme_id::CREDENTIAL_IDB_KEYSTORE_V1 => {
            if version == 1 {
                Ok(())
            } else {
                Err(JournalError::UnsupportedFormat(version))
            }
        }
        other => Err(JournalError::UnsupportedSourceScheme(other)),
    }
}

pub(crate) fn validate_canonical_binding(bytes: &[u8]) -> Result<(), JournalError> {
    let mut reader = Reader(bytes);
    reader.binding()?;
    if !reader.0.is_empty() {
        return Err(JournalError::Corrupt("trailing bytes in canonical binding"));
    }
    Ok(())
}

pub(crate) fn validate_target_key_ref(manifest: &JournalManifest) -> Result<(), JournalError> {
    if manifest.has_target_root_key_ref != manifest.target_root_key_ref_digest.is_some() {
        return Err(JournalError::Corrupt(
            "target key-ref flag disagrees with digest presence",
        ));
    }
    let requires = matches!(
        manifest.operation_type,
        operation_type::ENABLE | operation_type::ROTATE
    ) || manifest.phase == phase_code::BOOTSTRAP_TARGET;
    if requires && manifest.target_root_key_ref_digest.is_none() {
        return Err(JournalError::Corrupt(
            "target root key reference required for this manifest",
        ));
    }
    if let Some(digest) = manifest.target_root_key_ref_digest {
        if digest == [0u8; 32] {
            return Err(JournalError::Corrupt(
                "target root key reference digest is zero",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_lease_fields(manifest: &JournalManifest) -> Result<(), JournalError> {
    if manifest.has_lease_owner {
        let owner = manifest
            .lease_owner_id
            .as_ref()
            .ok_or(JournalError::Corrupt("lease owner flag without id"))?;
        if owner.is_empty() || owner.len() > MAX_OPERATION_ID_LEN {
            return Err(JournalError::InvalidOperationId);
        }
        if manifest.lease_expires_unix_ms.is_none() {
            return Err(JournalError::Corrupt("lease owner flag without expiry"));
        }
        return Ok(());
    }
    if manifest.lease_owner_id.is_some() || manifest.lease_expires_unix_ms.is_some() {
        return Err(JournalError::Corrupt(
            "lease owner fields present while lease flag is absent",
        ));
    }
    Ok(())
}

/// Phases that run on the final inventory: `CONVERT` and everything after it except the diagnostic
/// `RECOVERY_REQUIRED`, which may be entered before or after the final capture.
pub(crate) fn final_inventory_required(phase: u32) -> bool {
    matches!(
        phase,
        phase_code::CONVERT
            | phase_code::VERIFY
            | phase_code::COMMIT
            | phase_code::RETIRE_OLD_AUTHORITY
            | phase_code::FINALIZE
            | phase_code::DONE
    )
}

/// Phases before the write barrier, where only a preliminary inventory can exist.
pub(crate) fn final_inventory_forbidden(phase: u32) -> bool {
    matches!(
        phase,
        phase_code::BOOTSTRAP_TARGET | phase_code::DISCOVER | phase_code::PREPARE
    )
}

/// §10.3: the final inventory is captured in `ADMIT`, so the flag is false before it, free in
/// `ADMIT` (and in `RECOVERY_REQUIRED`, entered from anywhere) and true from `CONVERT` on.
pub(crate) fn validate_final_inventory(manifest: &JournalManifest) -> Result<(), JournalError> {
    let flag = manifest.final_inventory_captured;
    if (flag && final_inventory_forbidden(manifest.phase))
        || (!flag && final_inventory_required(manifest.phase))
    {
        return Err(JournalError::Corrupt(
            "final inventory flag disagrees with the phase",
        ));
    }
    Ok(())
}

pub(crate) fn validate_migration_operation_id(value: &str) -> Result<(), JournalError> {
    if value.is_empty() || value.len() > MAX_OPERATION_ID_LEN {
        return Err(JournalError::InvalidOperationId);
    }
    if value.chars().any(char::is_control) {
        return Err(JournalError::InvalidOperationId);
    }
    Ok(())
}

pub(crate) fn push_operation_id(out: &mut Vec<u8>, value: &str) -> Result<(), JournalError> {
    validate_migration_operation_id(value)?;
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

pub(crate) fn push_optional_owner(
    out: &mut Vec<u8>,
    manifest: &JournalManifest,
) -> Result<(), JournalError> {
    validate_lease_fields(manifest)?;
    if !manifest.has_lease_owner {
        out.push(0);
        return Ok(());
    }
    out.push(1);
    let owner = manifest
        .lease_owner_id
        .as_ref()
        .ok_or(JournalError::Corrupt("lease owner flag without id"))?;
    push_bounded_string(out, owner, MAX_OPERATION_ID_LEN)?;
    let expires = manifest
        .lease_expires_unix_ms
        .ok_or(JournalError::Corrupt("lease owner flag without expiry"))?;
    out.extend_from_slice(&expires.to_be_bytes());
    Ok(())
}

pub(crate) fn push_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

pub(crate) fn push_bounded_string(
    out: &mut Vec<u8>,
    value: &str,
    max_len: usize,
) -> Result<(), JournalError> {
    if value.is_empty() || value.len() > max_len {
        return Err(JournalError::InvalidOperationId);
    }
    push_string(out, value);
    Ok(())
}

pub(crate) fn push_optional<T, W>(
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

pub(crate) fn hash_optional<T, H>(
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

pub(crate) struct Reader<'a>(pub(crate) &'a [u8]);

impl<'a> Reader<'a> {
    pub(crate) fn take(&mut self, len: usize) -> Result<&'a [u8], JournalError> {
        if self.0.len() < len {
            return Err(JournalError::Corrupt("truncated journal bytes"));
        }
        let (head, tail) = self.0.split_at(len);
        self.0 = tail;
        Ok(head)
    }

    pub(crate) fn u32(&mut self) -> Result<u32, JournalError> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    pub(crate) fn u64(&mut self) -> Result<u64, JournalError> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().expect("8 bytes"),
        ))
    }

    pub(crate) fn digest(&mut self) -> Result<[u8; 32], JournalError> {
        Ok(self.take(32)?.try_into().expect("32 bytes"))
    }

    pub(crate) fn operation_id(&mut self) -> Result<String, JournalError> {
        let len = self.u32()? as usize;
        if len == 0 || len > MAX_OPERATION_ID_LEN {
            return Err(JournalError::InvalidOperationId);
        }
        let value = std::str::from_utf8(self.take(len)?)
            .map_err(|_| JournalError::Corrupt("operation_id is not UTF-8"))?;
        validate_migration_operation_id(value)?;
        Ok(value.to_owned())
    }

    pub(crate) fn optional_owner(
        &mut self,
    ) -> Result<(bool, Option<String>, Option<u64>), JournalError> {
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

    /// A strict one-byte flag: 0 or 1, anything else is `Corrupt(what)`.
    pub(crate) fn flag(&mut self, what: &'static str) -> Result<bool, JournalError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(JournalError::Corrupt(what)),
        }
    }

    pub(crate) fn string(&mut self, max_len: usize) -> Result<&'a str, JournalError> {
        let len = self.u32()? as usize;
        if len > max_len {
            return Err(JournalError::Corrupt("over-long string field"));
        }
        std::str::from_utf8(self.take(len)?)
            .map_err(|_| JournalError::Corrupt("string field is not UTF-8"))
    }

    pub(crate) fn binding(&mut self) -> Result<Vec<u8>, JournalError> {
        let start = self.0;
        let body_len = match self.take(1)?[0] {
            0 => 0,
            1 => 4 + self.string(MAX_DIRECT_IDENTITY_LEN)?.len(),
            2 => self.take(32).map(|_| 32)?,
            _ => return Err(JournalError::Corrupt("invalid identity binding tag")),
        };
        Ok(start[..=body_len].to_vec())
    }

    pub(crate) fn require_entry_budget(&self, entry_start: usize) -> Result<(), JournalError> {
        let consumed = entry_start - self.0.len();
        if consumed > MAX_JOURNAL_ENTRY_BYTES {
            Err(JournalError::TooLarge)
        } else {
            Ok(())
        }
    }

    pub(crate) fn inventory_entry(&mut self) -> Result<JournalInventoryEntry, JournalError> {
        let entry_start = self.0.len();
        let class = RecordClass::from_token(self.string(64)?)
            .ok_or(JournalError::Corrupt("unknown record class"))?;
        self.require_entry_budget(entry_start)?;
        let identity_binding = self.binding()?;
        self.require_entry_budget(entry_start)?;
        let project_scope_binding = self.binding()?;
        self.require_entry_budget(entry_start)?;
        let source_authority_kind = self.u32()?;
        let source_physical_authority_kind = self.u32()?;
        self.require_entry_budget(entry_start)?;
        let source_generation = self.optional_u64()?;
        let source_evidence_digest = self.optional_digest()?;
        self.require_entry_budget(entry_start)?;
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
        self.require_entry_budget(entry_start)?;
        let component_count = self.u32()? as usize;
        if component_count > 8 {
            return Err(JournalError::Corrupt("too many identity components"));
        }
        let mut component_strings = Vec::with_capacity(component_count);
        for _ in 0..component_count {
            self.require_entry_budget(entry_start)?;
            component_strings.push(self.string(16_384)?.to_owned());
        }
        self.require_entry_budget(entry_start)?;
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

    pub(crate) fn optional_u64(&mut self) -> Result<Option<u64>, JournalError> {
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

    pub(crate) fn optional_digest(&mut self) -> Result<Option<[u8; 32]>, JournalError> {
        match self.take(1)?[0] {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(JournalError::Corrupt("optional digest flag invalid")),
        }
    }
}

pub(crate) fn migration_page_index(record: &RecordIdentity) -> Result<u32, JournalError> {
    let index = record
        .components()
        .get(1)
        .ok_or(JournalError::WrongPageIndex)?;
    index
        .parse::<u32>()
        .map_err(|_| JournalError::InvalidPageIndex)
}

pub(crate) fn hash_string(hasher: &mut Sha256, value: &str) {
    hasher.update((value.len() as u32).to_be_bytes());
    hasher.update(value.as_bytes());
}
