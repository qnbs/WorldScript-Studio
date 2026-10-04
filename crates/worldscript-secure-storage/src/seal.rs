use aes_gcm::aead::{Aead, AeadInPlace, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::aad::{canonical_aad, RecordContext};
use crate::disposition::is_r15_record_class;
use crate::envelope::{EnvelopeHeader, ParsedEnvelope, MAX_CIPHERTEXT_LEN, NONCE_LEN, TAG_LEN};
use crate::error::{OpenError, SealError};
use crate::random::{OsRandom, RandomSource};

/// Opaque 32-byte AES-256 key material, zeroized on drop. Deliberately not `Debug`/`Clone`, so it
/// cannot be printed or silently duplicated.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct Key([u8; 32]);

impl Key {
    /// Takes the key material and zeroizes `source`, so the caller's buffer does not keep a second
    /// live copy after the key is dropped.
    pub fn from_bytes(source: &mut [u8; 32]) -> Self {
        let key = Key(*source);
        source.zeroize();
        key
    }
}

/// Non-secret routing fields the caller commits to for this encryption (§6.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordMeta {
    pub key_epoch: u64,
    pub record_generation: u64,
    pub record_schema: u32,
}

/// The record version being sealed: its authenticated identity (AAD context) and header fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SealTarget<'a> {
    pub context: RecordContext<'a>,
    pub meta: RecordMeta,
}

fn cipher(key: &Key) -> Aes256Gcm {
    Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(&key.0))
}

/// Encrypts `plaintext` into a complete `WSR1` envelope (header ‖ ciphertext ‖ tag). Every call draws
/// a fresh nonce from the OS CSPRNG; if it cannot be produced, sealing fails instead of reusing or
/// deriving one (§6.3). Callers cannot supply their own nonce source.
pub fn seal(key: &Key, target: &SealTarget<'_>, plaintext: &[u8]) -> Result<Vec<u8>, SealError> {
    seal_inner(key, &mut OsRandom, target, plaintext)
}

/// Test-vector hook (§16): [`seal`] with an injected nonce source. Only compiled with the
/// `test-randomness` feature, which production builds never enable.
#[cfg(feature = "test-randomness")]
pub fn seal_with_random(
    key: &Key,
    random: &mut impl RandomSource,
    target: &SealTarget<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    seal_inner(key, random, target, plaintext)
}

/// §5.4: `0` means "unassigned" and reaching `u64::MAX` is `RECOVERY_REQUIRED`, so neither is ever a
/// valid committed epoch or record generation.
fn check_counters(meta: &RecordMeta) -> Result<(), SealError> {
    let assigned = |value: u64| value != 0 && value != u64::MAX;
    if assigned(meta.key_epoch) && assigned(meta.record_generation) {
        Ok(())
    } else {
        Err(SealError::UnassignedCounter)
    }
}

/// §10.2 bootstrap journal manifest: `journal_revision == 0` is carried as envelope `record_generation == 0`.
/// Only this path may seal at generation 0; [`check_counters`] still applies everywhere else.
fn check_counters_journal_manifest_bootstrap(meta: &RecordMeta) -> Result<(), SealError> {
    if meta.record_generation != 0 {
        return Err(SealError::UnassignedCounter);
    }
    if meta.key_epoch == 0 || meta.key_epoch == u64::MAX {
        return Err(SealError::UnassignedCounter);
    }
    Ok(())
}

fn seal_inner_with_counter_policy(
    key: &Key,
    random: &mut impl RandomSource,
    target: &SealTarget<'_>,
    plaintext: &[u8],
    counter_check: fn(&RecordMeta) -> Result<(), SealError>,
) -> Result<Vec<u8>, SealError> {
    let SealTarget { context, meta } = *target;
    if !is_r15_record_class(context.record_class) {
        return Err(SealError::NotAnR15RecordClass);
    }
    counter_check(&meta)?;
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
    let aad = canonical_aad(&context, &header).map_err(SealError::InvalidContext)?;
    let mut out = Vec::with_capacity(header.len() + ciphertext_len as usize);
    out.extend_from_slice(&header);
    out.extend_from_slice(plaintext);
    let tag = cipher(key)
        .encrypt_in_place_detached(Nonce::from_slice(&nonce), &aad, &mut out[header.len()..])
        .map_err(|_| SealError::TooLarge)?;
    out.extend_from_slice(&tag);
    debug_assert_eq!(out.len() as u64, header.len() as u64 + ciphertext_len);
    Ok(out)
}

fn seal_inner(
    key: &Key,
    random: &mut impl RandomSource,
    target: &SealTarget<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    seal_inner_with_counter_policy(key, random, target, plaintext, check_counters)
}

/// Seals a §10.2 bootstrap journal manifest body whose envelope generation is exactly `0`.
pub(crate) fn seal_journal_manifest_bootstrap(
    key: &Key,
    target: &SealTarget<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    seal_journal_manifest_bootstrap_with_random(key, &mut OsRandom, target, plaintext)
}

pub(crate) fn seal_journal_manifest_bootstrap_with_random(
    key: &Key,
    random: &mut impl RandomSource,
    target: &SealTarget<'_>,
    plaintext: &[u8],
) -> Result<Vec<u8>, SealError> {
    seal_inner_with_counter_policy(
        key,
        random,
        target,
        plaintext,
        check_counters_journal_manifest_bootstrap,
    )
}

/// Authenticates and decrypts a parsed envelope under the caller's expected context. The caller must
/// have already checked `envelope.header().key_epoch` against committed authority before resolving
/// `key` (§6.4): this function never selects a key from the header. Any authentication failure —
/// wrong key, modified header or ciphertext bytes, or a different record class/logical ID/project
/// context — is `Tampered`.
///
/// Success proves only that this envelope, including the `record_generation` in its header, is
/// authentic for this key and context. It does not prove that the envelope is the latest committed
/// generation: an older authentic envelope for the same record also opens. Rejecting rollback is the
/// caller's job, by comparing `envelope.header().record_generation` with the committed record marker
/// (§5.4/§9), which later gates own.
pub fn open(
    key: &Key,
    context: &RecordContext<'_>,
    envelope: &ParsedEnvelope<'_>,
) -> Result<Vec<u8>, OpenError> {
    if !is_r15_record_class(context.record_class) {
        return Err(OpenError::NotAnR15RecordClass);
    }
    let aad = canonical_aad(context, envelope.header_bytes()).map_err(OpenError::InvalidContext)?;
    cipher(key)
        .decrypt(
            Nonce::from_slice(&envelope.header().nonce),
            Payload {
                msg: envelope.ciphertext(),
                aad: &aad,
            },
        )
        .map_err(|_| OpenError::Tampered)
}
