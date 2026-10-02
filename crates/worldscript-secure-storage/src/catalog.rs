//! Gate 3 slice 3C part 2: record-catalog descriptors and pages (§5.5, §5.5.1).
//!
//! The catalog is the authenticated index of ordinary records that `list_records` will read
//! instead of trusting directory listings. Each record has one descriptor stating its current
//! marker generation and, where one exists, its readable generation, plus the identity's template
//! components so the exact identity — even one whose bindings are hashed — is reproduced, never
//! guessed. Descriptors are grouped into one page per shard that has ever held one (an emptied shard
//! keeps a zero-descriptor page), the shard being fixed by the record's identity. A page is sealed as its own generation-addressed `record-catalog` record, and
//! its `content_digest` is what the authority root's `catalog_set_digest` binds. Descriptors are
//! derived only from a verified marker chain ([`describe_record`](crate::commit::describe_record)).
//! This module performs no I/O; [`authority`](crate::authority) writes pages and commits them
//! through the root.

use sha2::{Digest, Sha256};

use crate::aad::{tagged_identity_binding_parts, MAX_DIRECT_IDENTITY_LEN};
use crate::commit::CommittedGeneration;
use crate::error::{AadError, OpenError, SealError};
use crate::identity::{has_ordinary_marker, RecordIdentity};
use crate::marker::{state_code, CommitMarker, MarkerBody};
use crate::provider::InstallationScopeId;
use crate::record::{open_record, seal_record};
use crate::record_class::RecordClass;
use crate::seal::{Key, RecordMeta};

/// §5.5.1 version-1 constants.
pub const CATALOG_SHARD_COUNT: u32 = 256;
pub const MAX_CATALOG_PAGE_DESCRIPTORS: usize = 4096;
pub const CATALOG_PAGE_FORMAT_VERSION: u32 = 1;
/// The `record_schema` a catalog page is sealed with.
pub const CATALOG_PAGE_RECORD_SCHEMA: u32 = 1;
/// The encoded page body never exceeds this, so it always fits one protected envelope (§5.5.1,
/// the §6.1.2 journal-encoding bound).
pub const MAX_CATALOG_PAGE_BYTES: usize = 16 * 1024 * 1024;
/// A catalogued identity's template components together never exceed this (§5.5.1, the §6.1.2
/// direct `logical_record_id` bound).
pub const MAX_IDENTITY_EXTENSION_BYTES: usize = 16_384;

const SHARD_DOMAIN: &[u8] = b"worldscript-r15/catalog-shard/v1";
/// More components than any version-1 template has; a larger count is refused before allocating.
const MAX_IDENTITY_COMPONENTS: usize = 8;

/// Why a descriptor or page was refused. A refused page is never partially used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogError {
    Corrupt(&'static str),
    /// A version-1 page must use format version 1 and record schema 1.
    UnsupportedFormat(u32),
    /// A marker state this implementation does not catalog yet.
    UnsupportedState(u32),
    /// The readable-generation fields contradict the marker (§5.5 presence rules).
    InconsistentDescriptor,
    /// A record that is not an ordinary record (control-plane, retained-authority or asset-pair
    /// member classes are never catalogued, §5.5).
    NotAnOrdinaryRecord,
    /// A descriptor whose identity belongs to another shard.
    WrongShard,
    /// A shard id outside `0..CATALOG_SHARD_COUNT`.
    InvalidShard,
    /// Descriptors out of order or duplicated.
    NotStrictlyAscending,
    /// More descriptors than the page bound.
    InvalidDescriptorCount,
    /// The encoded page would exceed `MAX_CATALOG_PAGE_BYTES`, or an identity's components exceed
    /// `MAX_IDENTITY_EXTENSION_BYTES`; the write is refused like a full shard.
    TooLarge,
    /// A generation or epoch that is unassigned (`0`) or terminal (`u64::MAX`).
    InvalidCounter,
    InvalidIdentity(AadError),
    Seal(SealError),
    Open(OpenError),
    /// The sealed page's envelope generation differs from the catalog generation it is read as.
    GenerationMismatch,
}

/// One descriptor (§5.5): an ordinary record's identity, its current marker generation and state,
/// and its readable generation if it has one. `Debug` shows only the class, marker generation and
/// state, never the identity (§14).
#[derive(Clone, PartialEq, Eq)]
pub struct CatalogDescriptor {
    record: RecordIdentity,
    identity: Vec<u8>,
    project_scope: Vec<u8>,
    marker_generation: u64,
    marker_entry_digest: [u8; 32],
    marker_state: u32,
    readable: Option<CommittedGeneration>,
}

impl std::fmt::Debug for CatalogDescriptor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CatalogDescriptor")
            .field("record_class", &self.record.class())
            .field("marker_generation", &self.marker_generation)
            .field("marker_state", &self.marker_state)
            .field("readable", &self.readable.map(|c| c.generation))
            .finish()
    }
}

impl CatalogDescriptor {
    /// The descriptor for `record` whose current marker is `marker`, with `readable` the
    /// generation a read serves. Crate-internal: only a verified marker chain supplies these
    /// ([`describe_record`](crate::commit::describe_record)), so a descriptor never states an
    /// authority the chain does not.
    pub(crate) fn new(
        record: &RecordIdentity,
        marker: &CommitMarker,
        readable: Option<CommittedGeneration>,
    ) -> Result<Self, CatalogError> {
        if !has_ordinary_marker(record.class()) {
            return Err(CatalogError::NotAnOrdinaryRecord);
        }
        if RecordIdentity::commit_marker(record).as_ref() != Ok(marker.identity()) {
            return Err(CatalogError::InconsistentDescriptor);
        }
        if !agrees_with_marker(marker.body(), readable)? {
            return Err(CatalogError::InconsistentDescriptor);
        }
        check_extension(record)?;
        let (identity, project_scope) = bindings(record)?;
        Ok(CatalogDescriptor {
            record: record.clone(),
            identity,
            project_scope,
            marker_generation: marker.marker_generation(),
            marker_entry_digest: marker.entry_digest(),
            marker_state: marker.body().state_code(),
            readable,
        })
    }

    /// Test hook for the codec vectors: [`new`](Self::new) without a marker chain. Only compiled
    /// with the `test-support` feature, which production builds never enable.
    #[cfg(feature = "test-support")]
    pub fn new_unverified(
        record: &RecordIdentity,
        marker: &CommitMarker,
        readable: Option<CommittedGeneration>,
    ) -> Result<Self, CatalogError> {
        Self::new(record, marker, readable)
    }

    /// The exact record this descriptor describes.
    pub fn record(&self) -> &RecordIdentity {
        &self.record
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

    fn sort_key(&self) -> (&[u8], &[u8], &[u8]) {
        (
            self.record.class().token().as_bytes(),
            &self.identity,
            &self.project_scope,
        )
    }

    fn shard_id(&self) -> u32 {
        shard_from_bindings(
            self.record.class().token(),
            &self.identity,
            &self.project_scope,
        )
    }

    fn encoded_len(&self) -> usize {
        let readable = self.readable.map_or(0, |_| 8 + 8 + 32);
        let components: usize = self.record.components().iter().map(|c| 4 + c.len()).sum();
        4 + self.record.class().token().len()
            + self.identity.len()
            + self.project_scope.len()
            + 8
            + 32
            + 4
            + 3
            + readable
            + 4
            + components
    }

    fn encode(&self, out: &mut Vec<u8>) {
        push_string(out, self.record.class().token());
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
        let components = self.record.components();
        out.extend_from_slice(&(components.len() as u32).to_be_bytes());
        for component in components {
            push_string(out, component);
        }
    }
}

/// Whether `readable` is what a read of a record with this marker body serves (§5.5): `ACTIVE`
/// names exactly its committed generation, a replacement `PENDING` its old one (the chain's own
/// `ACTIVE`), a first-write `PENDING` none.
fn agrees_with_marker(
    body: &MarkerBody,
    readable: Option<CommittedGeneration>,
) -> Result<bool, CatalogError> {
    match body {
        MarkerBody::Active {
            committed_generation,
            committed_epoch,
            content_digest,
        } => Ok(readable
            == Some(CommittedGeneration {
                generation: *committed_generation,
                epoch: *committed_epoch,
                content_digest: *content_digest,
            })),
        MarkerBody::Pending(pending) => {
            Ok(readable.map(|committed| committed.generation) == pending.old_generation)
        }
        MarkerBody::RecoveryRequired { .. } => Err(CatalogError::UnsupportedState(
            state_code::RECOVERY_REQUIRED,
        )),
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

/// Where a catalog page lives: its installation scope, shard and catalog generation. The shard is
/// checked before anything else uses it.
#[derive(Debug, Clone, Copy)]
pub struct PageAddress<'a> {
    pub scope: &'a InstallationScopeId,
    pub shard_id: u32,
    pub catalog_generation: u64,
}

impl PageAddress<'_> {
    pub(crate) fn identity(&self) -> Result<RecordIdentity, CatalogError> {
        if self.shard_id >= CATALOG_SHARD_COUNT {
            return Err(CatalogError::InvalidShard);
        }
        check_counter(self.catalog_generation)?;
        let shard = self.shard_id.to_string();
        RecordIdentity::new(RecordClass::RecordCatalog, &[self.scope.as_str(), &shard])
            .map_err(|_| CatalogError::InvalidShard)
    }
}

/// One catalog page: every descriptor of one shard (none for an emptied shard). `Debug` shows only the shard and the
/// descriptor count.
#[derive(Clone, PartialEq, Eq)]
pub struct CatalogPage {
    shard_id: u32,
    descriptors: Vec<CatalogDescriptor>,
}

impl std::fmt::Debug for CatalogPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CatalogPage")
            .field("shard_id", &self.shard_id)
            .field("descriptor_count", &self.descriptors.len())
            .finish()
    }
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
        let mut out = Vec::with_capacity(12 + self.descriptors.len() * 256);
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
        // An over-long body is refused before any descriptor is materialized (§6.1.2).
        if bytes.len() > MAX_CATALOG_PAGE_BYTES {
            return Err(CatalogError::TooLarge);
        }
        let mut reader = Reader(bytes);
        let format = reader.u32()?;
        if format != CATALOG_PAGE_FORMAT_VERSION {
            return Err(CatalogError::UnsupportedFormat(format));
        }
        let shard_id = reader.u32()?;
        let count = reader.u32()? as usize;
        if count > MAX_CATALOG_PAGE_DESCRIPTORS {
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

    /// Seals the page as `address`'s generation of `record-catalog:<scope>:<shard>`.
    pub fn seal(
        &self,
        key: &Key,
        address: &PageAddress<'_>,
        key_epoch: u64,
    ) -> Result<Vec<u8>, CatalogError> {
        if address.shard_id != self.shard_id {
            return Err(CatalogError::WrongShard);
        }
        let meta = RecordMeta {
            key_epoch,
            record_generation: address.catalog_generation,
            record_schema: CATALOG_PAGE_RECORD_SCHEMA,
        };
        seal_record(key, &address.identity()?, meta, &self.encode()).map_err(CatalogError::Seal)
    }

    /// Opens the sealed page at `address`: the envelope must authenticate as that page's identity
    /// and generation, and its body must be a valid page of the same shard.
    pub fn open(
        key: &Key,
        address: &PageAddress<'_>,
        envelope: &[u8],
    ) -> Result<Self, CatalogError> {
        let opened =
            open_record(key, &address.identity()?, envelope).map_err(CatalogError::Open)?;
        let header = opened.header;
        if header.record_generation != address.catalog_generation {
            return Err(CatalogError::GenerationMismatch);
        }
        if header.record_schema != CATALOG_PAGE_RECORD_SCHEMA {
            return Err(CatalogError::UnsupportedFormat(header.record_schema));
        }
        let page = CatalogPage::decode(&opened.payload)?;
        if page.shard_id == address.shard_id {
            Ok(page)
        } else {
            Err(CatalogError::WrongShard)
        }
    }

    fn encoded_len(&self) -> usize {
        12 + self
            .descriptors
            .iter()
            .map(CatalogDescriptor::encoded_len)
            .sum::<usize>()
    }

    fn validate(&self) -> Result<(), CatalogError> {
        if self.shard_id >= CATALOG_SHARD_COUNT {
            return Err(CatalogError::InvalidShard);
        }
        let count = self.descriptors.len();
        if count > MAX_CATALOG_PAGE_DESCRIPTORS {
            return Err(CatalogError::InvalidDescriptorCount);
        }
        let ascending = self
            .descriptors
            .windows(2)
            .all(|pair| pair[0].sort_key() < pair[1].sort_key());
        if !ascending {
            return Err(CatalogError::NotStrictlyAscending);
        }
        if self.encoded_len() > MAX_CATALOG_PAGE_BYTES {
            return Err(CatalogError::TooLarge);
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

/// State, counter and presence rules a descriptor must meet (§5.5, §5.5.1). The format admits
/// every version-1 state; this implementation decodes `ACTIVE`, `PENDING` and
/// `READ_AUTHORITY_PENDING`, and refuses the deletion states until §8.5 is admitted.
fn check_descriptor(descriptor: &CatalogDescriptor) -> Result<(), CatalogError> {
    check_counter(descriptor.marker_generation)?;
    match (descriptor.marker_state, descriptor.readable) {
        (state_code::ACTIVE, None) => Err(CatalogError::InconsistentDescriptor),
        (
            state_code::ACTIVE | state_code::PENDING | state_code::READ_AUTHORITY_PENDING,
            readable,
        ) => readable.map_or(Ok(()), |c| {
            check_counter(c.generation)?;
            check_counter(c.epoch)
        }),
        (other, _) => Err(CatalogError::UnsupportedState(other)),
    }
}

/// A catalogued identity's template components stay within `MAX_IDENTITY_EXTENSION_BYTES`.
fn check_extension(record: &RecordIdentity) -> Result<(), CatalogError> {
    let total: usize = record.components().iter().map(String::len).sum();
    if total > MAX_IDENTITY_EXTENSION_BYTES {
        Err(CatalogError::TooLarge)
    } else {
        Ok(())
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

fn push_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
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

    fn string(&mut self, max_len: usize) -> Result<&'a str, CatalogError> {
        let len = self.u32()? as usize;
        if len > max_len {
            return Err(CatalogError::Corrupt("over-long string field"));
        }
        std::str::from_utf8(self.take(len)?)
            .map_err(|_| CatalogError::Corrupt("string field is not UTF-8"))
    }

    /// One §6.2 tagged binding, copied verbatim; its canonicality is proven later by rebuilding the
    /// identity and comparing.
    fn binding(&mut self) -> Result<Vec<u8>, CatalogError> {
        let start = self.0;
        let body_len = match self.take(1)?[0] {
            0 => 0,
            1 => 4 + self.string(MAX_DIRECT_IDENTITY_LEN)?.len(),
            2 => self.take(32).map(|_| 32)?,
            _ => return Err(CatalogError::Corrupt("invalid identity binding tag")),
        };
        Ok(start[..=body_len].to_vec())
    }

    fn descriptor(&mut self) -> Result<CatalogDescriptor, CatalogError> {
        let class = RecordClass::from_token(self.string(64)?)
            .ok_or(CatalogError::Corrupt("unknown record class"))?;
        if !has_ordinary_marker(class) {
            return Err(CatalogError::NotAnOrdinaryRecord);
        }
        let identity = self.binding()?;
        let project_scope = self.binding()?;
        let marker_generation = self.u64()?;
        let marker_entry_digest = self.digest()?;
        let marker_state = self.u32()?;
        let readable = self.readable()?;
        let record = self.record(class)?;
        // The stored bindings must be exactly the canonical bindings of the rebuilt identity, so a
        // descriptor can neither name a non-template identity nor pair bindings with another one.
        if bindings(&record)? != (identity.clone(), project_scope.clone()) {
            return Err(CatalogError::Corrupt(
                "descriptor bindings do not match its identity",
            ));
        }
        Ok(CatalogDescriptor {
            record,
            identity,
            project_scope,
            marker_generation,
            marker_entry_digest,
            marker_state,
            readable,
        })
    }

    /// The identity rebuilt from its template components through the class template (§5.2).
    fn record(&mut self, class: RecordClass) -> Result<RecordIdentity, CatalogError> {
        let count = self.u32()? as usize;
        if count > MAX_IDENTITY_COMPONENTS {
            return Err(CatalogError::Corrupt("too many identity components"));
        }
        let mut components = Vec::with_capacity(count);
        let mut total = 0usize;
        for _ in 0..count {
            let component = self.string(MAX_IDENTITY_EXTENSION_BYTES)?;
            total += component.len();
            if total > MAX_IDENTITY_EXTENSION_BYTES {
                return Err(CatalogError::TooLarge);
            }
            components.push(component);
        }
        RecordIdentity::new(class, &components)
            .map_err(|_| CatalogError::Corrupt("descriptor identity violates its class template"))
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
