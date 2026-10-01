//! Gate 3 slice 3B1: the `record-commit` marker codec (§5.4, §8.4, §9 step 2).
//!
//! A commit marker is the authority statement about one ordinary record: which generation is
//! committed (`ACTIVE`), which write is in flight (`PENDING`), or that the identity needs recovery
//! (`RECOVERY_REQUIRED`). This module defines its exact canonical body bytes, the
//! `marker_entry_digest` the authority root will bind (slice 3C), the envelope `content_digest` an
//! `ACTIVE` marker commits to, and the sealing of a marker generation as its own protected
//! `record-commit` record. It performs no I/O and decides no authority; the write protocol and
//! startup reconciliation that read and write markers are slice 3B2.
//!
//! Version 1 admits the three states an ordinary write and its recovery produce. `DELETE_PENDING`
//! and `TOMBSTONED` (authenticated deletion, §8.5) and the migration-only `READ_AUTHORITY_PENDING`
//! keep their reserved codes but are refused until their gates admit them, and so is a chunked
//! (`is_chunked = 1`) record, whose envelope (§6.1.2) is not implemented. `asset-pair` markers have
//! their own body (§8.4.1) and are not encoded here.

use sha2::{Digest, Sha256};

use crate::aad::{tagged_identity_bindings, MAX_DIRECT_IDENTITY_LEN};
use crate::error::{AadError, OpenError, SealError};
use crate::identity::{IdentityError, RecordIdentity};
use crate::record::{open_record, seal_record, ADMITTED_RECORD_SCHEMAS};
use crate::record_class::RecordClass;
use crate::seal::{Key, RecordMeta};

const CONTENT_DIGEST_DOMAIN: &[u8] = b"worldscript-r15/content/v1";
const MARKER_ENTRY_DOMAIN: &[u8] = b"worldscript-r15/marker-entry/v1";
/// §6.1.2: an `operation_id` is at most 128 bytes of UTF-8 — the same bound every other
/// operation identity uses, so the marker reuses it rather than keeping a second copy.
pub use crate::anchor::MAX_OPERATION_ID_LEN;
/// The marker body's own payload schema when sealed as a `record-commit` record.
pub const MARKER_RECORD_SCHEMA: u32 = 1;

/// Version-1 marker `state_code` values (§5.4); assigned once, never reused.
pub mod state_code {
    pub const ACTIVE: u32 = 1;
    pub const PENDING: u32 = 2;
    pub const DELETE_PENDING: u32 = 3;
    pub const TOMBSTONED: u32 = 4;
    pub const RECOVERY_REQUIRED: u32 = 5;
    pub const READ_AUTHORITY_PENDING: u32 = 6;
}

/// `content_digest` (§5.4): SHA-256 over the domain and the complete canonical `WSR1` envelope.
pub fn content_digest(envelope: &[u8]) -> [u8; 32] {
    Sha256::new()
        .chain_update(CONTENT_DIGEST_DOMAIN)
        .chain_update(envelope)
        .finalize()
        .into()
}

/// The write an in-flight or interrupted marker names: its operation identity and fence.
#[derive(Clone, PartialEq, Eq)]
pub struct MarkerOperation {
    pub operation_id: String,
    /// `0` for ordinary writes (§9 step 2); positive values are reserved for journal-owned fencing.
    pub fencing_generation: u64,
}

impl std::fmt::Debug for MarkerOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MarkerOperation")
            .field("operation_id_len", &self.operation_id.len())
            .field("fencing_generation", &self.fencing_generation)
            .finish()
    }
}

/// `PENDING(old -> target)` (§8.4, §9 step 2). The old generation stays authoritative while it is
/// the latest marker; `content_digest` is absent until a staged candidate exists. The target is
/// always the next generation: `1` for a first write, otherwise `old + 1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingBody {
    pub operation: MarkerOperation,
    /// `None` for a first write, `PENDING(none -> target)`.
    pub old_generation: Option<u64>,
    pub target_generation: u64,
    pub target_epoch: u64,
    pub content_digest: Option<[u8; 32]>,
    pub record_schema: u32,
}

/// The state-specific body (§5.4). `ABSENT` has no marker and therefore no body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MarkerBody {
    Active {
        committed_generation: u64,
        committed_epoch: u64,
        content_digest: [u8; 32],
    },
    Pending(PendingBody),
    RecoveryRequired {
        /// An opaque diagnostic classifier; fail-closed behavior never depends on it.
        reason_code: u32,
        prior: Option<MarkerOperation>,
    },
}

impl MarkerBody {
    pub fn state_code(&self) -> u32 {
        match self {
            MarkerBody::Active { .. } => state_code::ACTIVE,
            MarkerBody::Pending(_) => state_code::PENDING,
            MarkerBody::RecoveryRequired { .. } => state_code::RECOVERY_REQUIRED,
        }
    }
}

/// Why a marker was refused. A refused marker is never authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkerError {
    /// Truncated, over-long or otherwise malformed bytes, including a non-canonical flag byte.
    Corrupt(&'static str),
    /// The bytes name a different marker identity than the one requested (§7
    /// `PROTECTED_IDENTITY_MISMATCH`).
    IdentityMismatch,
    /// The record has no ordinary `record-commit` marker (§5.2.1).
    NoOrdinaryMarker,
    /// A reserved state not admitted in this slice, or an unknown state code.
    UnsupportedState(u32),
    /// `is_chunked = 1`: the chunked envelope (§6.1.2) is not implemented.
    UnsupportedChunked,
    /// A record schema outside the compatibility registry (§6.4).
    UnsupportedSchema,
    /// A generation or epoch that is unassigned (`0`) or terminal (`u64::MAX`), §5.4's lifecycle.
    InvalidCounter,
    /// A pending target that is not exactly the next generation: `1` for a first write
    /// (`PENDING(none -> 1)`, §8.4), otherwise `checked_increment(old)` (§5.4's lifecycle rule).
    TargetNotNextGeneration,
    /// An empty or over-long (over 128 bytes) `operation_id`.
    InvalidOperationId,
    /// A positive `fencing_generation` on `PENDING`: reserved for journal-owned migration/rekey
    /// writes (§9 step 2, §10.1), not admitted until their gate.
    FenceNotAdmitted,
    /// A `content_digest` on an ordinary `PENDING`: the intent precedes the ciphertext (§9 step 2).
    PendingDigestNotAdmitted,
    InvalidIdentity(AadError),
    /// The sealed marker's envelope generation differs from the `marker_generation` in its body.
    GenerationMismatch,
    Seal(SealError),
    Open(OpenError),
}

/// One immutable generation of a record's commit marker: its own identity, its control-plane
/// `marker_generation` (distinct from the record's `record_generation`, §5.4) and its body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitMarker {
    identity: RecordIdentity,
    marker_generation: u64,
    body: MarkerBody,
}

impl CommitMarker {
    /// The marker generation `marker_generation` of `record`'s commit marker. Every field is checked
    /// here, so a marker that exists is always encodable and decodes back to itself.
    pub fn new(
        record: &RecordIdentity,
        marker_generation: u64,
        body: MarkerBody,
    ) -> Result<Self, MarkerError> {
        let identity = RecordIdentity::commit_marker(record).map_err(|error| match error {
            IdentityError::NoOrdinaryMarker => MarkerError::NoOrdinaryMarker,
            _ => MarkerError::IdentityMismatch,
        })?;
        check_counter(marker_generation)?;
        check_body(&body)?;
        let marker = CommitMarker {
            identity,
            marker_generation,
            body,
        };
        marker.header_prefix()?;
        Ok(marker)
    }

    pub fn identity(&self) -> &RecordIdentity {
        &self.identity
    }

    pub fn marker_generation(&self) -> u64 {
        self.marker_generation
    }

    pub fn body(&self) -> &MarkerBody {
        &self.body
    }

    /// `canonical_marker_body_bytes` (§5.4): the common header — class token, tagged logical and
    /// project bindings, `u64be(marker_generation)`, `u32be(state_code)` — then the state body.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = self
            .header_prefix()
            .expect("identity bindings are checked by CommitMarker::new");
        out.extend_from_slice(&self.marker_generation.to_be_bytes());
        out.extend_from_slice(&self.body.state_code().to_be_bytes());
        encode_body(&mut out, &self.body);
        out
    }

    /// `marker_entry_digest` (§5.4), the value the authority root's `marker_set_digest` binds.
    pub fn entry_digest(&self) -> [u8; 32] {
        Sha256::new()
            .chain_update(MARKER_ENTRY_DOMAIN)
            .chain_update(self.encode())
            .finalize()
            .into()
    }

    /// Strictly decodes `bytes` as a marker of `record`. The identity fields must equal `record`'s
    /// marker exactly, every flag is `0` or `1`, no byte may follow the body, and the decoded marker
    /// passes the same checks as [`CommitMarker::new`].
    pub fn decode(record: &RecordIdentity, bytes: &[u8]) -> Result<Self, MarkerError> {
        let expected = CommitMarker::new(record, 1, placeholder_body())?;
        let prefix = expected.header_prefix()?;
        let rest = bytes
            .strip_prefix(prefix.as_slice())
            .ok_or_else(|| identity_or_corrupt(bytes, &prefix))?;
        let mut reader = Reader(rest);
        let marker_generation = reader.u64()?;
        let code = reader.u32()?;
        let body = decode_body(&mut reader, code)?;
        if !reader.0.is_empty() {
            return Err(MarkerError::Corrupt("trailing bytes after marker body"));
        }
        CommitMarker::new(record, marker_generation, body)
    }

    /// Seals this marker generation as its own protected `record-commit` record, whose
    /// `record_generation` is the `marker_generation` (markers are generation-addressed, §5.4).
    pub fn seal(&self, key: &Key, key_epoch: u64) -> Result<Vec<u8>, MarkerError> {
        let meta = RecordMeta {
            key_epoch,
            record_generation: self.marker_generation,
            record_schema: MARKER_RECORD_SCHEMA,
        };
        seal_record(key, &self.identity, meta, &self.encode()).map_err(MarkerError::Seal)
    }

    /// Opens a sealed marker of `record`: the envelope must authenticate as `record`'s marker, and
    /// the body's `marker_generation` must equal the envelope's `record_generation`, so a marker body
    /// can never be replayed under another generation's name.
    pub fn open(key: &Key, record: &RecordIdentity, envelope: &[u8]) -> Result<Self, MarkerError> {
        let identity =
            RecordIdentity::commit_marker(record).map_err(|_| MarkerError::NoOrdinaryMarker)?;
        let opened = open_record(key, &identity, envelope).map_err(MarkerError::Open)?;
        if opened.header.record_schema != MARKER_RECORD_SCHEMA {
            return Err(MarkerError::UnsupportedSchema);
        }
        let marker = CommitMarker::decode(record, &opened.payload)?;
        if marker.marker_generation == opened.header.record_generation {
            Ok(marker)
        } else {
            Err(MarkerError::GenerationMismatch)
        }
    }

    fn header_prefix(&self) -> Result<Vec<u8>, MarkerError> {
        let class = self.identity.class().token();
        let bindings = tagged_identity_bindings(&self.identity.context())
            .map_err(MarkerError::InvalidIdentity)?;
        let mut out = Vec::with_capacity(4 + class.len() + bindings.len() + 12);
        push_string(&mut out, class);
        out.extend_from_slice(&bindings);
        Ok(out)
    }
}

/// Any valid body; only the identity of the marker built with it is used.
fn placeholder_body() -> MarkerBody {
    MarkerBody::RecoveryRequired {
        reason_code: 0,
        prior: None,
    }
}

/// Bytes that start with a `record-commit` class token are a marker of some other identity;
/// anything else is not a marker body at all.
/// Only a well-formed `record-commit` header naming another identity is an identity mismatch
/// (§7 `PROTECTED_IDENTITY_MISMATCH`); truncated or malformed bindings are corruption.
fn identity_or_corrupt(bytes: &[u8], expected_prefix: &[u8]) -> MarkerError {
    let class_len = 4 + RecordClass::RecordCommit.token().len();
    let mut reader = Reader(bytes);
    let class_matches =
        bytes.len() >= class_len && bytes[..class_len] == expected_prefix[..class_len];
    let well_formed =
        class_matches && reader.take(class_len).is_ok() && reader.canonical_bindings();
    if well_formed {
        MarkerError::IdentityMismatch
    } else {
        MarkerError::Corrupt("not a record-commit marker body")
    }
}

fn check_counter(value: u64) -> Result<(), MarkerError> {
    if value == 0 || value == u64::MAX {
        Err(MarkerError::InvalidCounter)
    } else {
        Ok(())
    }
}

fn check_operation(operation: &MarkerOperation) -> Result<(), MarkerError> {
    let len = operation.operation_id.len();
    if len == 0 || len > MAX_OPERATION_ID_LEN {
        Err(MarkerError::InvalidOperationId)
    } else {
        Ok(())
    }
}

fn check_body(body: &MarkerBody) -> Result<(), MarkerError> {
    match body {
        MarkerBody::Active {
            committed_generation,
            committed_epoch,
            ..
        } => {
            check_counter(*committed_generation)?;
            check_counter(*committed_epoch)
        }
        MarkerBody::Pending(pending) => check_pending(pending),
        MarkerBody::RecoveryRequired { prior, .. } => {
            prior.as_ref().map_or(Ok(()), check_operation)
        }
    }
}

fn check_pending(pending: &PendingBody) -> Result<(), MarkerError> {
    check_operation(&pending.operation)?;
    // §9 step 2: an ordinary write's fence is always 0; positive fences belong to journal-owned
    // migration/rekey writes, which this slice does not admit.
    if pending.operation.fencing_generation != 0 {
        return Err(MarkerError::FenceNotAdmitted);
    }
    // §9 step 2: the ordinary intent is recorded before ciphertext exists, so it carries no
    // `content_digest`; the verified envelope supplies it only with `ACTIVE(new)`.
    if pending.content_digest.is_some() {
        return Err(MarkerError::PendingDigestNotAdmitted);
    }
    check_counter(pending.target_generation)?;
    check_counter(pending.target_epoch)?;
    let next = match pending.old_generation {
        None => 1,
        Some(old) => {
            check_counter(old)?;
            old + 1
        }
    };
    if pending.target_generation != next {
        return Err(MarkerError::TargetNotNextGeneration);
    }
    if ADMITTED_RECORD_SCHEMAS.contains(&pending.record_schema) {
        Ok(())
    } else {
        Err(MarkerError::UnsupportedSchema)
    }
}

fn push_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value.as_bytes());
}

fn push_digest(out: &mut Vec<u8>, digest: Option<&[u8; 32]>) {
    out.push(u8::from(digest.is_some()));
    if let Some(digest) = digest {
        out.extend_from_slice(digest);
    }
}

fn push_operation(out: &mut Vec<u8>, operation: &MarkerOperation) {
    push_string(out, &operation.operation_id);
    out.extend_from_slice(&operation.fencing_generation.to_be_bytes());
}

/// Version 1 never writes a chunked record, so `is_chunked` is always `0` and `chunk_count` absent.
const NOT_CHUNKED: u8 = 0;

fn encode_body(out: &mut Vec<u8>, body: &MarkerBody) {
    match body {
        MarkerBody::Active {
            committed_generation,
            committed_epoch,
            content_digest,
        } => {
            out.extend_from_slice(&committed_generation.to_be_bytes());
            out.extend_from_slice(&committed_epoch.to_be_bytes());
            push_digest(out, Some(content_digest));
            out.push(NOT_CHUNKED);
        }
        MarkerBody::Pending(pending) => encode_pending(out, pending),
        MarkerBody::RecoveryRequired { reason_code, prior } => {
            out.extend_from_slice(&reason_code.to_be_bytes());
            out.push(u8::from(prior.is_some()));
            if let Some(prior) = prior {
                push_operation(out, prior);
            }
        }
    }
}

fn encode_pending(out: &mut Vec<u8>, pending: &PendingBody) {
    push_operation(out, &pending.operation);
    out.push(u8::from(pending.old_generation.is_some()));
    if let Some(old) = pending.old_generation {
        out.extend_from_slice(&old.to_be_bytes());
    }
    out.extend_from_slice(&pending.target_generation.to_be_bytes());
    out.extend_from_slice(&pending.target_epoch.to_be_bytes());
    push_digest(out, pending.content_digest.as_ref());
    out.extend_from_slice(&pending.record_schema.to_be_bytes());
    out.push(NOT_CHUNKED);
}

fn decode_body(reader: &mut Reader<'_>, code: u32) -> Result<MarkerBody, MarkerError> {
    match code {
        state_code::ACTIVE => {
            let committed_generation = reader.u64()?;
            let committed_epoch = reader.u64()?;
            if !reader.flag()? {
                return Err(MarkerError::Corrupt("ACTIVE marker without content_digest"));
            }
            let content_digest = reader.digest()?;
            reader.not_chunked()?;
            Ok(MarkerBody::Active {
                committed_generation,
                committed_epoch,
                content_digest,
            })
        }
        state_code::PENDING => decode_pending(reader).map(MarkerBody::Pending),
        state_code::RECOVERY_REQUIRED => {
            let reason_code = reader.u32()?;
            let prior = if reader.flag()? {
                Some(reader.operation()?)
            } else {
                None
            };
            Ok(MarkerBody::RecoveryRequired { reason_code, prior })
        }
        other => Err(MarkerError::UnsupportedState(other)),
    }
}

fn decode_pending(reader: &mut Reader<'_>) -> Result<PendingBody, MarkerError> {
    let operation = reader.operation()?;
    let old_generation = if reader.flag()? {
        Some(reader.u64()?)
    } else {
        None
    };
    let target_generation = reader.u64()?;
    let target_epoch = reader.u64()?;
    let content_digest = if reader.flag()? {
        Some(reader.digest()?)
    } else {
        None
    };
    let record_schema = reader.u32()?;
    reader.not_chunked()?;
    Ok(PendingBody {
        operation,
        old_generation,
        target_generation,
        target_epoch,
        content_digest,
        record_schema,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BindingForm {
    Absent,
    Direct,
    Hashed,
}

/// A strict big-endian cursor: every read fails on truncation instead of padding.
struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], MarkerError> {
        if self.0.len() < len {
            return Err(MarkerError::Corrupt("truncated marker body"));
        }
        let (head, tail) = self.0.split_at(len);
        self.0 = tail;
        Ok(head)
    }

    fn u32(&mut self) -> Result<u32, MarkerError> {
        let bytes = self.take(4)?;
        Ok(u32::from_be_bytes(bytes.try_into().expect("4 bytes")))
    }

    fn u64(&mut self) -> Result<u64, MarkerError> {
        let bytes = self.take(8)?;
        Ok(u64::from_be_bytes(bytes.try_into().expect("8 bytes")))
    }

    fn flag(&mut self) -> Result<bool, MarkerError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(MarkerError::Corrupt("flag byte is neither 0 nor 1")),
        }
    }

    /// One §6.2 tagged identity binding: direct (`1`: a non-empty UTF-8 value within the 256-byte
    /// direct cap), hashed (`2`: 32 bytes), or absent (`0`). Anything else is `None`.
    fn binding(&mut self) -> Option<BindingForm> {
        match self.take(1).ok()?[0] {
            0 => Some(BindingForm::Absent),
            1 => {
                let len = self.u32().ok()? as usize;
                let value = std::str::from_utf8(self.take(len).ok()?).ok()?;
                let canonical = !value.is_empty() && len <= MAX_DIRECT_IDENTITY_LEN;
                canonical.then_some(BindingForm::Direct)
            }
            2 => self.take(32).ok().map(|_| BindingForm::Hashed),
            _ => None,
        }
    }

    /// Whether the logical and project bindings could name some marker identity under §6.2: the
    /// logical binding is present, and a present project binding uses the same form (rule D).
    fn canonical_bindings(&mut self) -> bool {
        match (self.binding(), self.binding()) {
            (Some(BindingForm::Absent) | None, _) | (_, None) => false,
            (Some(logical), Some(project)) => project == BindingForm::Absent || project == logical,
        }
    }

    fn digest(&mut self) -> Result<[u8; 32], MarkerError> {
        Ok(self.take(32)?.try_into().expect("32 bytes"))
    }

    fn not_chunked(&mut self) -> Result<(), MarkerError> {
        if self.flag()? {
            Err(MarkerError::UnsupportedChunked)
        } else {
            Ok(())
        }
    }

    fn operation(&mut self) -> Result<MarkerOperation, MarkerError> {
        let len = self.u32()? as usize;
        if len == 0 || len > MAX_OPERATION_ID_LEN {
            return Err(MarkerError::InvalidOperationId);
        }
        let operation_id = std::str::from_utf8(self.take(len)?)
            .map_err(|_| MarkerError::Corrupt("operation_id is not UTF-8"))?
            .to_owned();
        let fencing_generation = self.u64()?;
        Ok(MarkerOperation {
            operation_id,
            fencing_generation,
        })
    }
}
