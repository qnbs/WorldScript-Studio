use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::aad::{canonical_aad, RecordContext};
use crate::envelope::{EnvelopeHeader, ParsedEnvelope, MAX_CIPHERTEXT_LEN, NONCE_LEN, TAG_LEN};
use crate::error::{OpenError, SealError};
use crate::random::RandomSource;

/// Opaque 32-byte AES-256 key material, zeroized on drop. Deliberately not `Debug`/`Clone`, so it
/// cannot be printed or silently duplicated.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct Key([u8; 32]);

impl Key {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Key(bytes)
    }
}

/// Non-secret routing fields the caller commits to for this encryption (§6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordMeta {
    pub key_epoch: u64,
    pub record_generation: u64,
    pub record_schema: u32,
}

fn cipher(key: &Key) -> Aes256Gcm {
    Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key.0))
}

/// Encrypts `plaintext` into a complete `WSR1` envelope (header ‖ ciphertext ‖ tag). A fresh nonce
/// comes from `random` for every call; if it cannot be produced, sealing fails instead of reusing or
/// deriving one (§6.3).
pub fn seal(
    key: &Key,
    random: &mut impl RandomSource,
    context: &RecordContext<'_>,
    meta: RecordMeta,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    let ciphertext_len = (plaintext.len() as u64)
        .checked_add(TAG_LEN as u64)
        .filter(|len| *len <= MAX_CIPHERTEXT_LEN)
        .ok_or(SealError::TooLarge)?;
    let mut nonce = [0u8; NONCE_LEN];
    random
        .fill(&mut nonce)
        .map_err(|_| SealError::RandomnessUnavailable)?;
    let header = EnvelopeHeader {
        key_epoch: meta.key_epoch,
        record_generation: meta.record_generation,
        record_schema: meta.record_schema,
        nonce,
        ciphertext_len,
    }
    .encode();
    let aad = canonical_aad(context, &header).map_err(SealError::InvalidContext)?;
    let ciphertext = cipher(key)
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        // QNBS-v3 (#445): AES-GCM encryption only fails on inputs already bounded above; surfaced as TooLarge rather than panicking.
        .map_err(|_| SealError::TooLarge)?;
    debug_assert_eq!(ciphertext.len() as u64, ciphertext_len);
    let mut out = Vec::with_capacity(header.len() + ciphertext.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Authenticates and decrypts a parsed envelope under the caller's expected context. The caller must
/// have already checked `envelope.header.key_epoch` against committed authority before resolving
/// `key` (§6.4): this function never selects a key from the header. Any authentication failure —
/// wrong key, modified bytes, or a different record/project/generation context — is `Tampered`.
pub fn open(
    key: &Key,
    context: &RecordContext<'_>,
    envelope: &ParsedEnvelope<'_>,
) -> Result<Vec<u8>, OpenError> {
    let aad = canonical_aad(context, &envelope.header_bytes).map_err(OpenError::InvalidContext)?;
    cipher(key)
        .decrypt(
            Nonce::from_slice(&envelope.header.nonce),
            Payload {
                msg: envelope.ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| OpenError::Tampered)
}
