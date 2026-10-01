use std::fmt;

/// Why canonical AAD could not be constructed (§6.2 rule E, plus empty identities).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AadError {
    EmptyLogicalRecordId,
    EmptyProjectId,
    /// An identity longer than `u32::MAX` bytes cannot be encoded as `u32be(full_byte_length)`.
    IdentityTooLong,
    ExceedsMaximum,
}

/// Why sealing failed. No partial envelope is ever returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SealError {
    /// §6.3: the provider could not supply secure randomness — never fall back to a weaker nonce.
    RandomnessUnavailable,
    /// Plaintext plus tag exceeds the 64 MiB version-1 bound; larger records need the chunked envelope.
    TooLarge,
    InvalidContext(AadError),
    /// §5.4: `key_epoch` or `record_generation` is `0` (unassigned) or `u64::MAX` (terminal).
    UnassignedCounter,
    /// §6.4/§7: the record schema is not in the version-1 compatibility registry, so no current
    /// reader could decode the record.
    UnsupportedSchema,
}

/// Semantic open/parse failures, mapped from §7. Key-resolution outcomes (locked, wrong key) belong
/// to the later key-provider gate and are deliberately not produced here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenError {
    /// Truncated or malformed bytes, including every length violation.
    Corrupt(&'static str),
    /// Unknown magic, future envelope version, or unknown suite — never parsed as legacy plaintext.
    UnsupportedVersion(&'static str),
    /// AEAD authentication failed with the supplied key and context (§7 `PROTECTED_TAMPERED`).
    Tampered,
    InvalidContext(AadError),
}

/// Why the native recovery KDF refused to derive (§8.2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KdfError {
    /// The profile is not an exactly admitted one (e.g. `WSS_ARGON2ID_V1` with changed parameters).
    UnsupportedProfile,
    EmptyPassphrase,
    /// Over 4,096 raw bytes, or over 1,024 bytes after NFC normalization.
    PassphraseTooLong,
    /// Salt shorter than 16 or longer than 64 bytes.
    InvalidSalt,
    DerivationFailed,
}

/// Recovery-package failures (§8.2.1). A wrong passphrase and tampering are deliberately one variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryError {
    /// Unknown magic or package version.
    UnsupportedFormat,
    Corrupt(&'static str),
    Kdf(KdfError),
    WrongPassphraseOrTampered,
    RandomnessUnavailable,
}

/// Key-provider and secure-anchor outcomes (§8.1, §8.2, §5.3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyProviderError {
    /// The provider could not complete this call; retrying may succeed.
    Unavailable,
    /// Configured keys exist but are not unlocked.
    Locked,
    /// Key material is gone and no recovery is implied (§8.1 `KEY_LOST`).
    KeyLost,
    /// The platform cannot provide the required secure store; protected mode is not admitted.
    SecureAnchorUnavailable,
    /// The anchor or scope format version is not one this Core admits; it is never mutated.
    UnsupportedAnchorFormat,
    /// The anchor is inconsistent or at a terminal counter (§5.3.1, §5.3.2).
    RecoveryRequired,
    /// A two-phase anchor request does not match the current anchor state.
    AnchorConflict(&'static str),
    MalformedInstallationScope,
    MalformedKeyRef,
    MalformedOperationId,
    /// A root-slot code other than `0` (A) or `1` (B).
    MalformedRootSlot,
    UnknownKeyRef,
    UnknownEpoch,
    RandomnessUnavailable,
}

impl fmt::Display for AadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl fmt::Display for SealError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for AadError {}
impl std::error::Error for SealError {}
impl std::error::Error for OpenError {}
impl fmt::Display for KdfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl fmt::Display for RecoveryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl fmt::Display for KeyProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for KdfError {}
impl std::error::Error for RecoveryError {}
impl std::error::Error for KeyProviderError {}
