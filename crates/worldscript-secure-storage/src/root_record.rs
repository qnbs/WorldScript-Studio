//! Gate 3 slice 3C part 3a: the persisted authority-root records (§5.3, §5.3.4, §8.3).
//!
//! Three formats the two-phase root commit (§5.3.1) persists:
//! - a **root slot**: the root body sealed as generation `root_generation` of
//!   `authority-root:<InstallationScopeId>` — the only place the authority root's fields live;
//! - the **active-slot pointer**: a small unencrypted file naming one slot, generation and root
//!   digest, bound by `pointer_digest`. It holds no project content or key material and is
//!   recoverable state only: the secure anchor always wins a disagreement (§5.3.1);
//! - a **key-epoch control record**: one epoch's status and key route, sealed as generation
//!   `registry_generation` of `key-epoch:<InstallationScopeId>:<epoch>`; its `content_digest` is what
//!   the root's `key_epoch_set_digest` binds.
//!
//! This module performs no I/O; the commit sequence, its crash recovery and cold start are 3C part
//! 3b.

use crate::envelope::EnvelopeHeader;
use crate::error::{OpenError, SealError};
use crate::identity::RecordIdentity;
use crate::marker::content_digest;
use crate::provider::{InstallationScopeId, RootKeyRefV1, RootSlot, MAX_ROOT_KEY_REF_LEN};
use crate::record::{open_record, seal_record};
use crate::record_class::RecordClass;
use crate::root::{
    decode_root_body, encode_root_body, pointer_digest, root_digest, KeyEpochEntry, RootBody,
    RootError,
};
use crate::seal::{Key, RecordMeta};

/// §5.3.4 version-1 constants.
pub const ROOT_SLOT_FORMAT_VERSION: u32 = 1;
pub const POINTER_FORMAT_VERSION: u32 = 1;
pub const KEY_EPOCH_RECORD_FORMAT_VERSION: u32 = 1;
/// The `record_schema` root slots and key-epoch records are sealed with.
pub const CONTROL_RECORD_SCHEMA: u32 = 1;
const POINTER_MAGIC: &[u8; 4] = b"WSRP";

/// Why a root record was refused. A refused record is never authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootRecordError {
    Root(RootError),
    Corrupt(&'static str),
    UnsupportedFormat(u32),
    /// The record's envelope generation differs from the generation it is read as.
    GenerationMismatch,
    /// The pointer's `pointer_digest` does not bind its own slot, generation and root digest.
    PointerDigestMismatch,
    /// A key-epoch status outside §8.3's version-1 codes.
    UnknownKeyEpochStatus(u32),
    InvalidIdentity,
    Seal(SealError),
    Open(OpenError),
}

impl From<RootError> for RootRecordError {
    fn from(error: RootError) -> Self {
        RootRecordError::Root(error)
    }
}

/// Seals `root` as its root slot: generation `root_generation` of `authority-root:<scope>`, under
/// the root's own `active_key_epoch`. The payload is `u32be(ROOT_SLOT_FORMAT_VERSION)` followed by
/// `canonical_root_body_bytes`.
pub fn seal_root_slot(
    key: &Key,
    scope: &InstallationScopeId,
    root: &RootBody,
) -> Result<Vec<u8>, RootRecordError> {
    let (meta, payload) = root_slot_plaintext(root)?;
    seal_record(key, &root_identity(scope)?, meta, &payload).map_err(RootRecordError::Seal)
}

/// The envelope metadata and plaintext payload of `root`'s slot, for callers that seal through the
/// durable staging path (slice 3A) instead of [`seal_root_slot`].
pub(crate) fn root_slot_plaintext(
    root: &RootBody,
) -> Result<(RecordMeta, Vec<u8>), RootRecordError> {
    let mut payload = ROOT_SLOT_FORMAT_VERSION.to_be_bytes().to_vec();
    payload.extend_from_slice(&encode_root_body(root)?);
    let meta = RecordMeta {
        key_epoch: root.active_key_epoch,
        record_generation: root.root_generation,
        record_schema: CONTROL_RECORD_SCHEMA,
    };
    Ok((meta, payload))
}

/// A root slot to open: the sealed bytes of generation `root_generation` of
/// `authority-root:<scope>`.
#[derive(Debug, Clone, Copy)]
pub struct RootSlotRead<'a> {
    pub scope: &'a InstallationScopeId,
    pub root_generation: u64,
    pub envelope: &'a [u8],
}

impl RootSlotRead<'_> {
    /// The authenticated header must name this generation and the control-record schema.
    fn check(&self, header: &EnvelopeHeader) -> Result<(), RootRecordError> {
        check_schema(header)?;
        if header.record_generation == self.root_generation {
            Ok(())
        } else {
            Err(RootRecordError::GenerationMismatch)
        }
    }
}

/// Opens a root slot and returns the authenticated body with its `root_digest`. The envelope must
/// authenticate as `authority-root:<scope>` at the requested generation, and its header must agree
/// with the body it carries (same generation, same epoch).
pub fn open_root_slot(
    key: &Key,
    read: &RootSlotRead<'_>,
) -> Result<(RootBody, [u8; 32]), RootRecordError> {
    let opened = open_record(key, &root_identity(read.scope)?, read.envelope)
        .map_err(RootRecordError::Open)?;
    read.check(&opened.header)?;
    let root = decode_root_body(versioned::<ROOT_SLOT_FORMAT_VERSION>(&opened.payload)?)?;
    if root.root_generation != read.root_generation {
        return Err(RootRecordError::GenerationMismatch);
    }
    if opened.header.key_epoch != root.active_key_epoch {
        return Err(RootRecordError::Corrupt(
            "root slot sealed under another epoch",
        ));
    }
    let digest = root_digest(&root)?;
    Ok((root, digest))
}

/// The active-slot pointer (§5.3, §5.3.4): which committed slot, generation and root digest the
/// filesystem currently names. Recoverable state only; never publication authority (§5.3.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootPointer {
    pub slot: RootSlot,
    pub root_generation: u64,
    pub root_digest: [u8; 32],
}

impl RootPointer {
    /// `WSRP`, `u32be(POINTER_FORMAT_VERSION)`, `u8(slot)`, `u64be(root_generation)`, the root
    /// digest, then `pointer_digest` over those three fields.
    pub fn encode(&self) -> Result<Vec<u8>, RootRecordError> {
        let binding = pointer_digest(self.slot, self.root_generation, &self.root_digest)?;
        let mut out = Vec::with_capacity(4 + 4 + 1 + 8 + 32 + 32);
        out.extend_from_slice(POINTER_MAGIC);
        out.extend_from_slice(&POINTER_FORMAT_VERSION.to_be_bytes());
        out.push(self.slot.code());
        out.extend_from_slice(&self.root_generation.to_be_bytes());
        out.extend_from_slice(&self.root_digest);
        out.extend_from_slice(&binding);
        Ok(out)
    }

    /// Strictly decodes a pointer: exact length, magic and version, a valid slot code, an assigned
    /// generation, and a `pointer_digest` that binds the other fields.
    pub fn decode(bytes: &[u8]) -> Result<Self, RootRecordError> {
        if bytes.len() != 4 + 4 + 1 + 8 + 32 + 32 {
            return Err(RootRecordError::Corrupt("pointer has the wrong length"));
        }
        if &bytes[..4] != POINTER_MAGIC {
            return Err(RootRecordError::Corrupt("not a root pointer"));
        }
        let version = u32::from_be_bytes(bytes[4..8].try_into().expect("4 bytes"));
        if version != POINTER_FORMAT_VERSION {
            return Err(RootRecordError::UnsupportedFormat(version));
        }
        let slot = RootSlot::from_code(bytes[8])
            .map_err(|_| RootRecordError::Corrupt("unknown root slot code"))?;
        let root_generation = u64::from_be_bytes(bytes[9..17].try_into().expect("8 bytes"));
        let root_digest: [u8; 32] = bytes[17..49].try_into().expect("32 bytes");
        let pointer = RootPointer {
            slot,
            root_generation,
            root_digest,
        };
        let expected = pointer_digest(slot, root_generation, &root_digest)?;
        if bytes[49..] == expected {
            Ok(pointer)
        } else {
            Err(RootRecordError::PointerDigestMismatch)
        }
    }
}

/// Key-epoch status (§8.3, version 1). No status `0`; an unknown code is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEpochStatus {
    Prepared,
    Active,
    RetiredRecoveryOnly,
    Revoked,
}

impl KeyEpochStatus {
    pub fn code(self) -> u32 {
        match self {
            KeyEpochStatus::Prepared => 1,
            KeyEpochStatus::Active => 2,
            KeyEpochStatus::RetiredRecoveryOnly => 3,
            KeyEpochStatus::Revoked => 4,
        }
    }

    fn from_code(code: u32) -> Result<Self, RootRecordError> {
        match code {
            1 => Ok(KeyEpochStatus::Prepared),
            2 => Ok(KeyEpochStatus::Active),
            3 => Ok(KeyEpochStatus::RetiredRecoveryOnly),
            4 => Ok(KeyEpochStatus::Revoked),
            other => Err(RootRecordError::UnknownKeyEpochStatus(other)),
        }
    }
}

/// One immutable generation of a key-epoch control record (§5.4, §8.3): the epoch, its status and
/// the opaque, non-secret key route. Never key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyEpochRecord {
    pub epoch: u64,
    pub status: KeyEpochStatus,
    pub root_key_ref: RootKeyRefV1,
}

impl KeyEpochRecord {
    /// `u32be(KEY_EPOCH_RECORD_FORMAT_VERSION)`, `u64be(epoch)`, `u32be(status)`, then the key
    /// route as `u32be(byte_length)` + bytes.
    pub fn encode(&self) -> Result<Vec<u8>, RootRecordError> {
        if self.epoch == 0 || self.epoch == u64::MAX {
            return Err(RootRecordError::Root(RootError::InvalidCounter));
        }
        // `RootKeyRefV1` already guarantees 1..=MAX_ROOT_KEY_REF_LEN bytes.
        let route = self.root_key_ref.as_bytes();
        let mut out = KEY_EPOCH_RECORD_FORMAT_VERSION.to_be_bytes().to_vec();
        out.extend_from_slice(&self.epoch.to_be_bytes());
        out.extend_from_slice(&self.status.code().to_be_bytes());
        out.extend_from_slice(&(route.len() as u32).to_be_bytes());
        out.extend_from_slice(route);
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, RootRecordError> {
        let body = versioned::<KEY_EPOCH_RECORD_FORMAT_VERSION>(bytes)?;
        let Some((fixed, _)) = body.split_first_chunk::<12>() else {
            return Err(RootRecordError::Corrupt("truncated key-epoch record"));
        };
        let epoch = u64::from_be_bytes(fixed[..8].try_into().expect("8 bytes"));
        let status_code = u32::from_be_bytes(fixed[8..].try_into().expect("4 bytes"));
        let record = KeyEpochRecord {
            epoch,
            status: KeyEpochStatus::from_code(status_code)?,
            root_key_ref: key_route(&body[12..])?,
        };
        record.encode()?;
        Ok(record)
    }

    /// Seals this generation at `write.address` (its epoch must be this record's) under
    /// `write.key_epoch`.
    pub fn seal(&self, key: &Key, write: &KeyEpochWrite<'_>) -> Result<Vec<u8>, RootRecordError> {
        let address = write.address;
        // The address's own counters are validated before it is compared with the record.
        let identity = address.identity()?;
        if address.epoch != self.epoch {
            return Err(RootRecordError::Corrupt(
                "key-epoch record names another epoch",
            ));
        }
        let meta = RecordMeta {
            key_epoch: write.key_epoch,
            record_generation: address.registry_generation,
            record_schema: CONTROL_RECORD_SCHEMA,
        };
        seal_record(key, &identity, meta, &self.encode()?).map_err(RootRecordError::Seal)
    }

    /// Opens `read.envelope` at `read.address` and returns the record with the
    /// `key_epoch_set_digest` entry its envelope supplies.
    pub fn open(
        key: &Key,
        read: &KeyEpochRead<'_>,
    ) -> Result<(Self, KeyEpochEntry), RootRecordError> {
        let address = read.address;
        let opened =
            open_record(key, &address.identity()?, read.envelope).map_err(RootRecordError::Open)?;
        address.check(&opened.header)?;
        let record = KeyEpochRecord::decode(&opened.payload)?;
        if record.epoch != address.epoch {
            return Err(RootRecordError::Corrupt(
                "key-epoch record names another epoch",
            ));
        }
        let entry = KeyEpochEntry {
            epoch: address.epoch,
            registry_generation: address.registry_generation,
            content_digest: content_digest(read.envelope),
        };
        Ok((record, entry))
    }
}

/// A key-epoch record generation to seal: where, and under which data epoch's key.
#[derive(Debug, Clone, Copy)]
pub struct KeyEpochWrite<'a> {
    pub address: KeyEpochAddress<'a>,
    pub key_epoch: u64,
}

/// A sealed key-epoch record generation to open.
#[derive(Debug, Clone, Copy)]
pub struct KeyEpochRead<'a> {
    pub address: KeyEpochAddress<'a>,
    pub envelope: &'a [u8],
}

/// The identity, envelope metadata and plaintext of `record` at `write`, for callers that seal
/// through the durable staging path (slice 3A) instead of [`KeyEpochRecord::seal`].
pub(crate) fn key_epoch_plaintext(
    record: &KeyEpochRecord,
    write: &KeyEpochWrite<'_>,
) -> Result<(RecordIdentity, RecordMeta, Vec<u8>), RootRecordError> {
    let address = write.address;
    let identity = address.identity()?;
    if address.epoch != record.epoch {
        return Err(RootRecordError::Corrupt(
            "key-epoch record names another epoch",
        ));
    }
    let meta = RecordMeta {
        key_epoch: write.key_epoch,
        record_generation: address.registry_generation,
        record_schema: CONTROL_RECORD_SCHEMA,
    };
    Ok((identity, meta, record.encode()?))
}

/// Where one key-epoch record generation lives: `key-epoch:<scope>:<epoch>` at
/// `registry_generation`. Both counters are checked before anything uses them.
#[derive(Debug, Clone, Copy)]
pub struct KeyEpochAddress<'a> {
    pub scope: &'a InstallationScopeId,
    pub epoch: u64,
    pub registry_generation: u64,
}

impl KeyEpochAddress<'_> {
    fn identity(&self) -> Result<RecordIdentity, RootRecordError> {
        let assigned = |value: u64| value != 0 && value != u64::MAX;
        if !(assigned(self.epoch) && assigned(self.registry_generation)) {
            return Err(RootRecordError::Root(RootError::InvalidCounter));
        }
        let epoch = self.epoch.to_string();
        RecordIdentity::new(RecordClass::KeyEpoch, &[self.scope.as_str(), &epoch])
            .map_err(|_| RootRecordError::InvalidIdentity)
    }

    /// The authenticated header must name this generation and the control-record schema.
    fn check(&self, header: &EnvelopeHeader) -> Result<(), RootRecordError> {
        check_schema(header)?;
        if header.record_generation == self.registry_generation {
            Ok(())
        } else {
            Err(RootRecordError::GenerationMismatch)
        }
    }
}

/// The key route that must be exactly the rest of the record: `u32be(byte_length)` + bytes.
fn key_route(rest: &[u8]) -> Result<RootKeyRefV1, RootRecordError> {
    let Some((len, route)) = rest.split_first_chunk::<4>() else {
        return Err(RootRecordError::Corrupt("truncated key-epoch record"));
    };
    let len = u32::from_be_bytes(*len) as usize;
    let in_bounds = (1..=MAX_ROOT_KEY_REF_LEN).contains(&len) && route.len() == len;
    if !in_bounds {
        return Err(RootRecordError::Corrupt("key route length out of bounds"));
    }
    RootKeyRefV1::new(route.to_vec()).map_err(|_| RootRecordError::Corrupt("invalid key route"))
}

pub(crate) fn root_identity(
    scope: &InstallationScopeId,
) -> Result<RecordIdentity, RootRecordError> {
    RecordIdentity::new(RecordClass::AuthorityRoot, &[scope.as_str()])
        .map_err(|_| RootRecordError::InvalidIdentity)
}

fn check_schema(header: &EnvelopeHeader) -> Result<(), RootRecordError> {
    if header.record_schema == CONTROL_RECORD_SCHEMA {
        Ok(())
    } else {
        Err(RootRecordError::UnsupportedFormat(header.record_schema))
    }
}

/// The payload after its leading `u32be(format_version)`, which must be `VERSION`.
fn versioned<const VERSION: u32>(payload: &[u8]) -> Result<&[u8], RootRecordError> {
    let Some((head, body)) = payload.split_first_chunk::<4>() else {
        return Err(RootRecordError::Corrupt("truncated record payload"));
    };
    let found = u32::from_be_bytes(*head);
    if found == VERSION {
        Ok(body)
    } else {
        Err(RootRecordError::UnsupportedFormat(found))
    }
}
