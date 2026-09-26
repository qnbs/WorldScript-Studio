use std::fmt;

/// Why canonical AAD could not be constructed (§6.2 rule E, plus empty identities).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AadError {
    EmptyLogicalRecordId,
    EmptyProjectId,
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
