//! Gate 2 slice A: the identity-bound record codec (§6.1–§6.3, §7, §20).
//!
//! A record routed through a [`RecordIdentity`] is sealed and opened only under that identity's
//! canonical AAD context, so no caller assembles a [`RecordContext`](crate::RecordContext) by hand.
//! An envelope relocated to another record, scope or class therefore fails closed as
//! `PROTECTED_TAMPERED` (§7) instead of opening under the wrong identity. No I/O happens here: where
//! the bytes live, and whether they are the newest committed generation, belongs to later gates.

use crate::envelope::{parse_envelope, EnvelopeHeader};
use crate::error::{OpenError, SealError};
use crate::identity::RecordIdentity;
use crate::seal::{open, seal, Key, RecordMeta, SealTarget};

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
/// AAD is that identity's canonical context (§6.2).
pub fn seal_record(
    key: &Key,
    identity: &RecordIdentity,
    meta: RecordMeta,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    let target = SealTarget {
        context: identity.context(),
        meta,
    };
    seal(key, &target, plaintext)
}

/// Strictly parses `bytes` as a `WSR1` envelope and authenticates it as a version of the record
/// `identity` names. Malformed or future-format bytes are refused before any decryption, and
/// ciphertext sealed under any other identity is `Tampered`.
pub fn open_record(
    key: &Key,
    identity: &RecordIdentity,
    bytes: &[u8],
) -> Result<OpenedRecord, OpenError> {
    let envelope = parse_envelope(bytes)?;
    let payload = open(key, &identity.context(), &envelope)?;
    Ok(OpenedRecord {
        header: *envelope.header(),
        payload,
    })
}
