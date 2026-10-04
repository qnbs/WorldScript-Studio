use sha2::{Digest, Sha256};

use crate::aad::tagged_identity_binding_parts;
use crate::disposition::{disposition, Disposition};
use crate::identity::RecordIdentity;

use super::source_authority_kind;
use super::wire::{
    check_counter, hash_optional, hash_string, push_optional, push_string,
    validate_canonical_binding, validate_foreign_source_format_version,
    validate_physical_authority_kind, validate_registered_foreign_source_scheme,
};
use super::{JournalError, MAX_JOURNAL_ENTRY_BYTES};

/// §10.1 / §5.4 migration inventory descriptor carried on a journal page.
#[derive(Clone, PartialEq, Eq)]
pub struct JournalInventoryEntry {
    pub record: RecordIdentity,
    identity_binding: Vec<u8>,
    project_scope_binding: Vec<u8>,
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

    pub(crate) fn sort_key(&self) -> InventorySortKey<'_> {
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

    pub(crate) fn encode_into(&self, out: &mut Vec<u8>) -> Result<(), JournalError> {
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

    pub(crate) fn validate(&self) -> Result<(), JournalError> {
        self.validate_semantics()?;
        self.validate_identity_bindings()?;
        if self.encoded_len()? > MAX_JOURNAL_ENTRY_BYTES {
            return Err(JournalError::TooLarge);
        }
        Ok(())
    }

    fn validate_identity_bindings(&self) -> Result<(), JournalError> {
        let (identity, project) = tagged_identity_binding_parts(&self.record.context())
            .map_err(JournalError::InvalidIdentity)?;
        if identity != self.identity_binding || project != self.project_scope_binding {
            return Err(JournalError::BindingMismatch);
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
        .and_then(|()| validate_physical_authority_kind(self.source_physical_authority_kind))
    }

    fn validate_legacy_plaintext(&self) -> Result<(), JournalError> {
        if self.source_generation.is_some() {
            return Err(JournalError::Corrupt(
                "legacy plaintext carries no generation",
            ));
        }
        if self.source_evidence_digest.is_none() {
            return Err(JournalError::Corrupt(
                "legacy plaintext requires evidence digest",
            ));
        }
        if self.foreign.is_some() {
            return Err(JournalError::Corrupt(
                "legacy plaintext has no foreign extension",
            ));
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
            return Err(JournalError::Corrupt(
                "r15 protected has no foreign extension",
            ));
        }
        Ok(())
    }

    fn validate_foreign_protected(&self) -> Result<(), JournalError> {
        if self.source_evidence_digest.is_none() {
            return Err(JournalError::Corrupt(
                "foreign protected requires evidence digest",
            ));
        }
        let foreign = self.foreign.as_ref().ok_or(JournalError::Corrupt(
            "foreign protected requires extension",
        ))?;
        validate_registered_foreign_source_scheme(foreign.source_scheme_id)?;
        validate_foreign_source_format_version(
            foreign.source_scheme_id,
            foreign.source_format_version,
        )?;
        validate_canonical_binding(&foreign.source_identity_binding)?;
        validate_canonical_binding(&foreign.source_project_scope_binding)?;
        Ok(())
    }
}

pub(crate) struct InventorySortKey<'a> {
    class: &'static str,
    identity: &'a [u8],
    project: &'a [u8],
    source_authority_kind: u32,
    source_physical_authority_kind: u32,
    source_scheme_id: u32,
}

#[derive(Clone)]
pub(crate) struct OwnedInventorySortKey {
    class: &'static str,
    identity: Vec<u8>,
    project: Vec<u8>,
    source_authority_kind: u32,
    source_physical_authority_kind: u32,
    source_scheme_id: u32,
}

impl InventorySortKey<'_> {
    pub(crate) fn owned(&self) -> OwnedInventorySortKey {
        OwnedInventorySortKey {
            class: self.class,
            identity: self.identity.to_vec(),
            project: self.project.to_vec(),
            source_authority_kind: self.source_authority_kind,
            source_physical_authority_kind: self.source_physical_authority_kind,
            source_scheme_id: self.source_scheme_id,
        }
    }
}

impl OwnedInventorySortKey {
    fn as_borrowed(&self) -> InventorySortKey<'_> {
        InventorySortKey {
            class: self.class,
            identity: &self.identity,
            project: &self.project,
            source_authority_kind: self.source_authority_kind,
            source_physical_authority_kind: self.source_physical_authority_kind,
            source_scheme_id: self.source_scheme_id,
        }
    }
}

impl PartialEq for OwnedInventorySortKey {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
    }
}

impl Eq for OwnedInventorySortKey {}

impl PartialOrd for OwnedInventorySortKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

fn inventory_sort_material_cmp(
    left: &InventorySortKey<'_>,
    right: &InventorySortKey<'_>,
) -> std::cmp::Ordering {
    (
        left.class.as_bytes(),
        left.identity,
        left.project,
        left.source_authority_kind.to_be_bytes(),
        left.source_physical_authority_kind.to_be_bytes(),
        left.source_scheme_id.to_be_bytes(),
    )
        .cmp(&(
            right.class.as_bytes(),
            right.identity,
            right.project,
            right.source_authority_kind.to_be_bytes(),
            right.source_physical_authority_kind.to_be_bytes(),
            right.source_scheme_id.to_be_bytes(),
        ))
}

impl Ord for OwnedInventorySortKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        inventory_sort_material_cmp(&self.as_borrowed(), &other.as_borrowed())
    }
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
        inventory_sort_material_cmp(self, other)
    }
}

pub(crate) fn hash_inventory_entry(
    hasher: &mut Sha256,
    entry: &JournalInventoryEntry,
) -> Result<(), JournalError> {
    hash_string(hasher, entry.record.class().token());
    hasher.update(&entry.identity_binding);
    hasher.update(&entry.project_scope_binding);
    hasher.update(entry.source_authority_kind.to_be_bytes());
    hasher.update(entry.source_physical_authority_kind.to_be_bytes());
    hash_optional(hasher, entry.source_generation, |hasher, value| {
        check_counter(value)?;
        hasher.update(value.to_be_bytes());
        Ok(())
    })?;
    hash_optional(hasher, entry.source_evidence_digest, |hasher, digest| {
        hasher.update(digest);
        Ok(())
    })?;
    if let Some(foreign) = &entry.foreign {
        hasher.update(foreign.source_scheme_id.to_be_bytes());
        hasher.update(foreign.source_format_version.to_be_bytes());
        hasher.update(&foreign.source_identity_binding);
        hasher.update(&foreign.source_project_scope_binding);
    }
    Ok(())
}
