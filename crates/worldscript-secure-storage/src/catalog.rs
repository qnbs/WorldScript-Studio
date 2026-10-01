//! Gate 3 slice 3C part 2: record-catalog descriptors and pages (§5.5, §5.5.1).
//!
//! The catalog is the authenticated index of ordinary records that `list_records` will read
//! instead of trusting directory listings. Each record has one descriptor stating its current
//! marker generation and, where one exists, its readable generation; descriptors are grouped into
//! one page per non-empty shard, the shard being fixed by the record's identity. A page is sealed as
//! its own generation-addressed `record-catalog` record, and its `content_digest` is what the
//! authority root's `catalog_set_digest` binds. This module performs no I/O; writing pages and
//! committing them through the root is slice 3C part 3.

use sha2::{Digest, Sha256};

use crate::aad::tagged_identity_binding_parts;
use crate::commit::CommittedGeneration;
use crate::error::{AadError, OpenError, SealError};
use crate::identity::RecordIdentity;
use crate::marker::{state_code, CommitMarker, MarkerBody};
use crate::provider::InstallationScopeId;
use crate::record::{open_record, seal_record};
use crate::seal::{Key, RecordMeta};

/// §5.5.1 version-1 constants.
pub const CATALOG_SHARD_COUNT: u32 = 256;
pub const MAX_CATALOG_PAGE_DESCRIPTORS: usize = 4096;
pub const CATALOG_PAGE_FORMAT_VERSION: u32 = 1;
/// The page body's own payload schema when sealed as a `record-catalog` record.
pub const CATALOG_PAGE_RECORD_SCHEMA: u32 = 1;

const SHARD_DOMAIN: &[u8] = b"worldscript-r15/catalog-shard/v1";

/// Why a descriptor or page was refused. A refused page is never partially used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogError {
    Corrupt(&'static str),
    /// A version-1 page must use format version 1.
    UnsupportedFormat(u32),
    /// A marker state version 1 does not catalog (only `ACTIVE` and `PENDING`).
    UnsupportedState(u32),
    /// The readable-generation fields contradict the marker (§5.5 presence rules).
    InconsistentDescriptor,
    /// A descriptor whose identity belongs to another shard.
    WrongShard,
    /// A shard id outside `0..CATALOG_SHARD_COUNT`.
    InvalidShard,
    /// Descriptors out of order or duplicated.
    NotStrictlyAscending,
    /// No descriptors (an empty shard has no page), or more than the page bound.
    InvalidDescriptorCount,
    /// A generation or epoch that is unassigned (`0`) or terminal (`u64::MAX`).
    InvalidCounter,
    InvalidIdentity(AadError),
    Seal(SealError),
    Open(OpenError),
    /// The sealed page's envelope generation differs from the catalog generation it is read as.
    GenerationMismatch,
}

/// One descriptor (§5.5): an ordinary record's identity bindings, its current marker generation and
/// state, and its readable generation if it has one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogDescriptor {
    record_class: String,
    identity: Vec<u8>,
    project_scope: Vec<u8>,
    marker_generation: u64,
    marker_entry_digest: [u8; 32],
    marker_state: u32,
    readable: Option<CommittedGeneration>,
}

impl CatalogDescriptor {
    /// The descriptor for `record` whose current marker is `marker`. `readable` is the generation a
    /// read serves: the committed one for `ACTIVE`, the old one for a replacement `PENDING`, none
    /// for a first-write `PENDING`; it must agree with the marker.
    pub fn new(
        record: &RecordIdentity,
        marker: &CommitMarker,
        readable: Option<CommittedGeneration>,
    ) -> Result<Self, CatalogError> {
        if RecordIdentity::commit_marker(record).as_ref() != Ok(marker.identity()) {
            return Err(CatalogError::InconsistentDescriptor);
        }
        let consistent = match marker.body() {
            MarkerBody::Active {
                committed_generation,
                committed_epoch,
                content_digest,
            } => {
                readable
                    == Some(CommittedGeneration {
                        generation: *committed_generation,
                        epoch: *committed_epoch,
                        content_digest: *content_digest,
                    })
            }
            MarkerBody::Pending(pending) => {
                readable.map(|committed| committed.generation) == pending.old_generation
            }
            MarkerBody::RecoveryRequired { .. } => {
                return Err(CatalogError::UnsupportedState(
                    state_code::RECOVERY_REQUIRED,
                ))
            }
        };
        if !consistent {
            return Err(CatalogError::InconsistentDescriptor);
        }
        let (identity, project_scope) = bindings(record)?;
        Ok(CatalogDescriptor {
            record_class: record.class().token().to_owned(),
            identity,
            project_scope,
            marker_generation: marker.marker_generation(),
            marker_entry_digest: marker.entry_digest(),
            marker_state: marker.body().state_code(),
            readable,
        })
    }

    pub fn marker_generation(&self) -> u64 {
        self.marker_generation
    }

    pub fn marker_entry_digest(&self) -> [u8; 32] {
        self.marker_entry_digest
    }

    pub fn marker_state(&self) -> u32 {
        self.marker_state
    }

    pub fn readable(&self) -> Option<CommittedGeneration> {
        self.readable
    }

    /// Whether this descriptor describes `record`.
    pub fn describes(&self, record: &RecordIdentity) -> bool {
        bindings(record).is_ok_and(|(identity, scope)| {
            self.record_class == record.class().token()
                && self.identity == identity
                && self.project_scope == scope
        })
    }

    fn sort_key(&self) -> (&[u8], &[u8], &[u8]) {
        (
            self.record_class.as_bytes(),
            &self.identity,
            &self.project_scope,
        )
    }

    fn shard_id(&self) -> u32 {
        shard_from_bindings(&self.record_class, &self.identity, &self.project_scope)
    }

    fn encode(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&(self.record_class.len() as u32).to_be_bytes());
        out.extend_from_slice(self.record_class.as_bytes());
        out.extend_from_slice(&self.identity);
        out.extend_from_slice(&self.project_scope);
        out.extend_from_slice(&self.marker_generation.to_be_bytes());
        out.extend_from_slice(&self.marker_entry_digest);
        out.extend_from_slice(&self.marker_state.to_be_bytes());
        let readable = self.readable;
        let present = u8::from(readable.is_some());
        out.push(present);
        if let Some(committed) = readable {
            out.extend_from_slice(&committed.generation.to_be_bytes());
        }
        out.push(present);
        if let Some(committed) = readable {
            out.extend_from_slice(&committed.epoch.to_be_bytes());
        }
        out.push(present);
        if let Some(committed) = readable {
            out.extend_from_slice(&committed.content_digest);
        }
    }
}

/// The §5.5.1 shard of an ordinary record, fixed by its identity alone.
pub fn catalog_shard_of(record: &RecordIdentity) -> Result<u32, CatalogError> {
    let (identity, scope) = bindings(record)?;
    Ok(shard_from_bindings(
        record.class().token(),
        &identity,
        &scope,
    ))
}

/// One catalog page: every descriptor of one non-empty shard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogPage {
    shard_id: u32,
    descriptors: Vec<CatalogDescriptor>,
}

impl CatalogPage {
    /// A page for `shard_id`; the descriptors are sorted here and must all belong to that shard,
    /// with no identity twice and no more than the page bound.
    pub fn new(
        shard_id: u32,
        mut descriptors: Vec<CatalogDescriptor>,
    ) -> Result<Self, CatalogError> {
        descriptors.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
        let page = CatalogPage {
            shard_id,
            descriptors,
        };
        page.validate()?;
        Ok(page)
    }

    pub fn shard_id(&self) -> u32 {
        self.shard_id
    }

    pub fn descriptors(&self) -> &[CatalogDescriptor] {
        &self.descriptors
    }

    /// The canonical page body (§5.5.1).
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + self.descriptors.len() * 192);
        out.extend_from_slice(&CATALOG_PAGE_FORMAT_VERSION.to_be_bytes());
        out.extend_from_slice(&self.shard_id.to_be_bytes());
        out.extend_from_slice(&(self.descriptors.len() as u32).to_be_bytes());
        for descriptor in &self.descriptors {
            descriptor.encode(&mut out);
        }
        out
    }

    /// Strictly decodes a page body; every §5.5.1 rule is checked, and a decoded page re-encodes
    /// to the same bytes.
    pub fn decode(bytes: &[u8]) -> Result<Self, CatalogError> {
        let mut reader = Reader(bytes);
        let format = reader.u32()?;
        if format != CATALOG_PAGE_FORMAT_VERSION {
            return Err(CatalogError::UnsupportedFormat(format));
        }
        let shard_id = reader.u32()?;
        let count = reader.u32()? as usize;
        if count == 0 || count > MAX_CATALOG_PAGE_DESCRIPTORS {
            return Err(CatalogError::InvalidDescriptorCount);
        }
        let mut descriptors = Vec::with_capacity(count);
        for _ in 0..count {
            descriptors.push(reader.descriptor()?);
        }
        if !reader.0.is_empty() {
            return Err(CatalogError::Corrupt(
                "trailing bytes after the last descriptor",
            ));
        }
        let page = CatalogPage {
            shard_id,
            descriptors,
        };
        page.validate()?;
        Ok(page)
    }

    /// Seals the page as generation `catalog_generation` of `record-catalog:<scope>:<shard>`.
    pub fn seal(
        &self,
        key: &Key,
        scope: &InstallationScopeId,
        key_epoch: u64,
        catalog_generation: u64,
    ) -> Result<Vec<u8>, CatalogError> {
        let meta = RecordMeta {
            key_epoch,
            record_generation: catalog_generation,
            record_schema: CATALOG_PAGE_RECORD_SCHEMA,
        };
        seal_record(
            key,
            &page_identity(scope, self.shard_id)?,
            meta,
            &self.encode(),
        )
        .map_err(CatalogError::Seal)
    }

    /// Opens a sealed page of `shard_id` read as `catalog_generation`: the envelope must
    /// authenticate as that page's identity and generation, and its body must be a valid page of
    /// the same shard.
    pub fn open(
        key: &Key,
        scope: &InstallationScopeId,
        shard_id: u32,
        catalog_generation: u64,
        envelope: &[u8],
    ) -> Result<Self, CatalogError> {
        let opened = open_record(key, &page_identity(scope, shard_id)?, envelope)
            .map_err(CatalogError::Open)?;
        let header = opened.header;
        if header.record_generation != catalog_generation {
            return Err(CatalogError::GenerationMismatch);
        }
        if header.record_schema != CATALOG_PAGE_RECORD_SCHEMA {
            return Err(CatalogError::UnsupportedFormat(header.record_schema));
        }
        let page = CatalogPage::decode(&opened.payload)?;
        if page.shard_id == shard_id {
            Ok(page)
        } else {
            Err(CatalogError::WrongShard)
        }
    }

    fn validate(&self) -> Result<(), CatalogError> {
        if self.shard_id >= CATALOG_SHARD_COUNT {
            return Err(CatalogError::InvalidShard);
        }
        let count = self.descriptors.len();
        if count == 0 || count > MAX_CATALOG_PAGE_DESCRIPTORS {
            return Err(CatalogError::InvalidDescriptorCount);
        }
        let ascending = self
            .descriptors
            .windows(2)
            .all(|pair| pair[0].sort_key() < pair[1].sort_key());
        if !ascending {
            return Err(CatalogError::NotStrictlyAscending);
        }
        self.descriptors.iter().try_for_each(|descriptor| {
            check_descriptor(descriptor)?;
            if descriptor.shard_id() == self.shard_id {
                Ok(())
            } else {
                Err(CatalogError::WrongShard)
            }
        })
    }
}

fn page_identity(
    scope: &InstallationScopeId,
    shard_id: u32,
) -> Result<RecordIdentity, CatalogError> {
    let shard = shard_id.to_string();
    RecordIdentity::new(
        crate::record_class::RecordClass::RecordCatalog,
        &[scope.as_str(), &shard],
    )
    .map_err(|_| CatalogError::InvalidShard)
}

/// State, counter and presence rules a descriptor must meet (§5.5, §5.5.1).
fn check_descriptor(descriptor: &CatalogDescriptor) -> Result<(), CatalogError> {
    check_counter(descriptor.marker_generation)?;
    match (descriptor.marker_state, descriptor.readable) {
        (state_code::ACTIVE, None) => Err(CatalogError::InconsistentDescriptor),
        (state_code::ACTIVE | state_code::PENDING, readable) => readable.map_or(Ok(()), |c| {
            check_counter(c.generation)?;
            check_counter(c.epoch)
        }),
        (other, _) => Err(CatalogError::UnsupportedState(other)),
    }
}

fn bindings(record: &RecordIdentity) -> Result<(Vec<u8>, Vec<u8>), CatalogError> {
    tagged_identity_binding_parts(&record.context()).map_err(CatalogError::InvalidIdentity)
}

fn shard_from_bindings(class: &str, identity: &[u8], scope: &[u8]) -> u32 {
    let digest = Sha256::new()
        .chain_update(SHARD_DOMAIN)
        .chain_update((class.len() as u32).to_be_bytes())
        .chain_update(class.as_bytes())
        .chain_update(identity)
        .chain_update(scope)
        .finalize();
    u32::from_be_bytes(digest[..4].try_into().expect("4 bytes")) % CATALOG_SHARD_COUNT
}

fn check_counter(value: u64) -> Result<(), CatalogError> {
    if value == 0 || value == u64::MAX {
        Err(CatalogError::InvalidCounter)
    } else {
        Ok(())
    }
}

/// A strict big-endian cursor: every read fails on truncation instead of padding.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], CatalogError> {
        if self.0.len() < len {
            return Err(CatalogError::Corrupt("truncated catalog page"));
        }
        let (head, tail) = self.0.split_at(len);
        self.0 = tail;
        Ok(head)
    }

    fn u32(&mut self) -> Result<u32, CatalogError> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().expect("4 bytes"),
        ))
    }

    fn u64(&mut self) -> Result<u64, CatalogError> {
        Ok(u64::from_be_bytes(
            self.take(8)?.try_into().expect("8 bytes"),
        ))
    }

    fn digest(&mut self) -> Result<[u8; 32], CatalogError> {
        Ok(self.take(32)?.try_into().expect("32 bytes"))
    }

    fn flag(&mut self) -> Result<bool, CatalogError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(CatalogError::Corrupt("flag byte is neither 0 nor 1")),
        }
    }

    /// One §6.2 tagged binding, copied verbatim: direct (`1`, non-empty UTF-8 within the 256-byte
    /// cap), hashed (`2`, 32 bytes), or, only for the project scope, absent (`0`).
    fn binding(&mut self, absent_allowed: bool) -> Result<Vec<u8>, CatalogError> {
        let start = self.0;
        let tag = self.take(1)?[0];
        let body = match tag {
            0 if absent_allowed => 0,
            1 => {
                let len = self.u32()? as usize;
                let value = std::str::from_utf8(self.take(len)?)
                    .map_err(|_| CatalogError::Corrupt("identity binding is not UTF-8"))?;
                if value.is_empty() || len > crate::aad::MAX_DIRECT_IDENTITY_LEN {
                    return Err(CatalogError::Corrupt(
                        "non-canonical direct identity binding",
                    ));
                }
                4 + len
            }
            2 => self.take(32).map(|_| 32)?,
            _ => return Err(CatalogError::Corrupt("invalid identity binding tag")),
        };
        Ok(start[..1 + body].to_vec())
    }

    fn descriptor(&mut self) -> Result<CatalogDescriptor, CatalogError> {
        let class_len = self.u32()? as usize;
        let record_class = std::str::from_utf8(self.take(class_len)?)
            .ok()
            .filter(|token| crate::record_class::RecordClass::from_token(token).is_some())
            .ok_or(CatalogError::Corrupt("unknown record class"))?
            .to_owned();
        let identity = self.binding(false)?;
        let project_scope = self.binding(true)?;
        same_form(&identity, &project_scope)?;
        let marker_generation = self.u64()?;
        let marker_entry_digest = self.digest()?;
        let marker_state = self.u32()?;
        let readable = self.readable()?;
        Ok(CatalogDescriptor {
            record_class,
            identity,
            project_scope,
            marker_generation,
            marker_entry_digest,
            marker_state,
            readable,
        })
    }

    /// The three presence-flagged fields, which version 1 requires all present or all absent.
    fn readable(&mut self) -> Result<Option<CommittedGeneration>, CatalogError> {
        let generation = self.flag()?.then(|| self.u64()).transpose()?;
        let epoch = self.flag()?.then(|| self.u64()).transpose()?;
        let content_digest = self.flag()?.then(|| self.digest()).transpose()?;
        match (generation, epoch, content_digest) {
            (Some(generation), Some(epoch), Some(content_digest)) => {
                Ok(Some(CommittedGeneration {
                    generation,
                    epoch,
                    content_digest,
                }))
            }
            (None, None, None) => Ok(None),
            _ => Err(CatalogError::InconsistentDescriptor),
        }
    }
}

/// Rule D: a present project binding uses the identity binding's form.
fn same_form(identity: &[u8], scope: &[u8]) -> Result<(), CatalogError> {
    if scope[0] == 0 || scope[0] == identity[0] {
        Ok(())
    } else {
        Err(CatalogError::Corrupt(
            "mixed direct and hashed identity bindings",
        ))
    }
}
