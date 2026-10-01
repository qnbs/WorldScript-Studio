//! Gate 2 slice A: the identity-bound record codec (§6.1–§6.3, §7, §20).
//!
//! A record routed through a [`RecordIdentity`] is sealed and opened only under that identity's
//! canonical AAD context, so no caller assembles a [`RecordContext`](crate::RecordContext) by hand.
//! An envelope relocated to another record, scope or class therefore fails closed as
//! `PROTECTED_TAMPERED` (§7) instead of opening under the wrong identity. No I/O happens here: where
//! the bytes live, and whether they are the newest committed generation, belongs to later gates.

use crate::disposition::is_r15_record_class;
use crate::envelope::{parse_envelope, EnvelopeHeader};
use crate::error::{OpenError, SealError};
use crate::identity::RecordIdentity;
use crate::seal::{open, seal, Key, RecordMeta, SealTarget};

/// The record schemas the version-1 compatibility registry admits (§6.1 "record schema", §6.4, §7).
/// No class has a second payload schema yet, so every class admits exactly `1`; a schema is added
/// here only together with the decoder that reads it.
pub const ADMITTED_RECORD_SCHEMAS: &[u32] = &[1];

fn admitted_schema(record_schema: u32) -> bool {
    ADMITTED_RECORD_SCHEMAS.contains(&record_schema)
}

/// An authenticated record payload and the header it was sealed with. The header's
/// `record_generation` is authentic for this identity but not necessarily the latest committed one;
/// rollback rejection compares it with the committed marker (§5.4, §9). `Debug` shows only the
/// header (which redacts its nonce) and the payload length, never the payload.
#[derive(Clone, PartialEq, Eq)]
pub struct OpenedRecord {
    pub header: EnvelopeHeader,
    pub payload: Vec<u8>,
}

impl std::fmt::Debug for OpenedRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenedRecord")
            .field("header", &self.header)
            .field("payload_len", &self.payload.len())
            .finish()
    }
}

/// Seals `plaintext` as one version of the record `identity` names: a complete `WSR1` envelope whose
/// AAD is that identity's canonical context (§6.2). A record schema outside the compatibility
/// registry is refused, so no record is written that current readers cannot decode, and so is a
/// class whose §10.4.1 disposition never yields R-15 ciphertext (credentials, the IDB KDF salt and
/// passphrase sentinel).
pub fn seal_record(
    key: &Key,
    identity: &RecordIdentity,
    meta: RecordMeta,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    if !is_r15_record_class(identity.class()) {
        return Err(SealError::NotAnR15RecordClass);
    }
    if !admitted_schema(meta.record_schema) {
        return Err(SealError::UnsupportedSchema);
    }
    let target = SealTarget {
        context: identity.context(),
        meta,
    };
    seal(key, &target, plaintext)
}

/// Strictly parses `bytes` as a `WSR1` envelope and authenticates it as a version of the record
/// `identity` names. Malformed or future-format bytes, including a record schema outside the
/// compatibility registry (§7 `PROTECTED_UNSUPPORTED_VERSION`), are refused before any decryption,
/// so no payload reaches a decoder that cannot read it; ciphertext sealed under any other identity is
/// `Tampered`. A class that never has R-15 ciphertext (§10.4.1) is refused before any parsing.
pub fn open_record(
    key: &Key,
    identity: &RecordIdentity,
    bytes: &[u8],
) -> Result<OpenedRecord, OpenError> {
    if !is_r15_record_class(identity.class()) {
        return Err(OpenError::NotAnR15RecordClass);
    }
    let envelope = parse_envelope(bytes)?;
    if !admitted_schema(envelope.header().record_schema) {
        return Err(OpenError::UnsupportedVersion("record schema"));
    }
    let payload = open(key, &identity.context(), &envelope)?;
    Ok(OpenedRecord {
        header: *envelope.header(),
        payload,
    })
}
