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

use crate::error::{OpenError, SealError};
use crate::identity::RecordIdentity;
use crate::marker::content_digest;
use crate::provider::{InstallationScopeId, RootKeyRefV1, RootSlot};
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
/// §6.1.2: a non-secret key/epoch reference is at most 256 bytes.
const MAX_KEY_REF_LEN: usize = 256;

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

/// Seals `root` as its root slot: generation `root_generation` of `authority-root:<scope>`. The
/// payload is `u32be(ROOT_SLOT_FORMAT_VERSION)` followed by `canonical_root_body_bytes`.
pub fn seal_root_slot(
    key: &Key,
    scope: &InstallationScopeId,
    root: &RootBody,
    key_epoch: u64,
) -> Result<Vec<u8>, RootRecordError> {
    let mut payload = ROOT_SLOT_FORMAT_VERSION.to_be_bytes().to_vec();
    payload.extend_from_slice(&encode_root_body(root)?);
    let meta = RecordMeta {
        key_epoch,
        record_generation: root.root_generation,
        record_schema: CONTROL_RECORD_SCHEMA,
    };
    seal_record(key, &root_identity(scope)?, meta, &payload).map_err(RootRecordError::Seal)
}

/// Opens a root slot read as `root_generation` and returns the authenticated body with its
/// `root_digest`. The envelope must authenticate as `authority-root:<scope>` at that generation.
pub fn open_root_slot(
    key: &Key,
    scope: &InstallationScopeId,
    root_generation: u64,
    envelope: &[u8],
) -> Result<(RootBody, [u8; 32]), RootRecordError> {
    let opened =
        open_record(key, &root_identity(scope)?, envelope).map_err(RootRecordError::Open)?;
    check_header(
        opened.header.record_generation,
        opened.header.record_schema,
        root_generation,
    )?;
    let body = versioned(&opened.payload, ROOT_SLOT_FORMAT_VERSION)?;
    let root = decode_root_body(body)?;
    if root.root_generation != root_generation {
        return Err(RootRecordError::GenerationMismatch);
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
        check_epoch(self.epoch)?;
        let route = self.root_key_ref.as_bytes();
        if route.is_empty() || route.len() > MAX_KEY_REF_LEN {
            return Err(RootRecordError::Corrupt("key route length out of bounds"));
        }
        let mut out = KEY_EPOCH_RECORD_FORMAT_VERSION.to_be_bytes().to_vec();
        out.extend_from_slice(&self.epoch.to_be_bytes());
        out.extend_from_slice(&self.status.code().to_be_bytes());
        out.extend_from_slice(&(route.len() as u32).to_be_bytes());
        out.extend_from_slice(route);
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, RootRecordError> {
        let body = versioned(bytes, KEY_EPOCH_RECORD_FORMAT_VERSION)?;
        if body.len() < 8 + 4 + 4 {
            return Err(RootRecordError::Corrupt("truncated key-epoch record"));
        }
        let epoch = u64::from_be_bytes(body[..8].try_into().expect("8 bytes"));
        let status = KeyEpochStatus::from_code(u32::from_be_bytes(
            body[8..12].try_into().expect("4 bytes"),
        ))?;
        let len = u32::from_be_bytes(body[12..16].try_into().expect("4 bytes")) as usize;
        if len == 0 || len > MAX_KEY_REF_LEN || body.len() != 16 + len {
            return Err(RootRecordError::Corrupt("key route length out of bounds"));
        }
        let root_key_ref = RootKeyRefV1::new(body[16..].to_vec())
            .map_err(|_| RootRecordError::Corrupt("invalid key route"))?;
        let record = KeyEpochRecord {
            epoch,
            status,
            root_key_ref,
        };
        record.encode()?;
        Ok(record)
    }

    /// Seals this generation as `key-epoch:<scope>:<epoch>`, generation `registry_generation`.
    pub fn seal(
        &self,
        key: &Key,
        scope: &InstallationScopeId,
        registry_generation: u64,
        key_epoch: u64,
    ) -> Result<Vec<u8>, RootRecordError> {
        let meta = RecordMeta {
            key_epoch,
            record_generation: registry_generation,
            record_schema: CONTROL_RECORD_SCHEMA,
        };
        seal_record(
            key,
            &key_epoch_identity(scope, self.epoch)?,
            meta,
            &self.encode()?,
        )
        .map_err(RootRecordError::Seal)
    }

    /// Opens the record of `epoch` read as `registry_generation` and returns it with the
    /// `key_epoch_set_digest` entry its envelope supplies.
    pub fn open(
        key: &Key,
        scope: &InstallationScopeId,
        epoch: u64,
        registry_generation: u64,
        envelope: &[u8],
    ) -> Result<(Self, KeyEpochEntry), RootRecordError> {
        let identity = key_epoch_identity(scope, epoch)?;
        let opened = open_record(key, &identity, envelope).map_err(RootRecordError::Open)?;
        check_header(
            opened.header.record_generation,
            opened.header.record_schema,
            registry_generation,
        )?;
        let record = KeyEpochRecord::decode(&opened.payload)?;
        if record.epoch != epoch {
            return Err(RootRecordError::Corrupt(
                "key-epoch record names another epoch",
            ));
        }
        let entry = KeyEpochEntry {
            epoch,
            registry_generation,
            content_digest: content_digest(envelope),
        };
        Ok((record, entry))
    }
}

fn root_identity(scope: &InstallationScopeId) -> Result<RecordIdentity, RootRecordError> {
    RecordIdentity::new(RecordClass::AuthorityRoot, &[scope.as_str()])
        .map_err(|_| RootRecordError::InvalidIdentity)
}

fn key_epoch_identity(
    scope: &InstallationScopeId,
    epoch: u64,
) -> Result<RecordIdentity, RootRecordError> {
    check_epoch(epoch)?;
    let epoch = epoch.to_string();
    RecordIdentity::new(RecordClass::KeyEpoch, &[scope.as_str(), &epoch])
        .map_err(|_| RootRecordError::InvalidIdentity)
}

fn check_epoch(epoch: u64) -> Result<(), RootRecordError> {
    if epoch == 0 || epoch == u64::MAX {
        Err(RootRecordError::Root(RootError::InvalidCounter))
    } else {
        Ok(())
    }
}

fn check_header(generation: u64, schema: u32, expected: u64) -> Result<(), RootRecordError> {
    if schema != CONTROL_RECORD_SCHEMA {
        return Err(RootRecordError::UnsupportedFormat(schema));
    }
    if generation == expected {
        Ok(())
    } else {
        Err(RootRecordError::GenerationMismatch)
    }
}

/// The payload after its leading `u32be(format_version)`, which must be `version`.
fn versioned(payload: &[u8], version: u32) -> Result<&[u8], RootRecordError> {
    let Some((head, body)) = payload.split_first_chunk::<4>() else {
        return Err(RootRecordError::Corrupt("truncated record payload"));
    };
    let found = u32::from_be_bytes(*head);
    if found == version {
        Ok(body)
    } else {
        Err(RootRecordError::UnsupportedFormat(found))
    }
}
