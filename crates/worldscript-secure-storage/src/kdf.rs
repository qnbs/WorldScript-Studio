use argon2::{Algorithm, Argon2, Params, Version};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::error::KdfError;

/// Encoded length of a [`KdfProfile`]: five `u32be` fields and the one-byte Argon2 version.
pub const PROFILE_ENCODED_LEN: usize = 21;
/// §8.2.1: at least 16 random salt bytes; the upper bound keeps the recovery header bounded.
pub const MIN_SALT_LEN: usize = 16;
pub const MAX_SALT_LEN: usize = 64;
/// §8.2.1: maximum passphrase length in bytes after NFC normalization.
pub const MAX_PASSPHRASE_LEN: usize = 1024;
/// Length of the derived key-encryption key.
pub const KEK_LEN: usize = 32;

/// A versioned native recovery KDF profile (§8.2.1). The whole profile is authenticated metadata:
/// a reader accepts only an exact admitted profile, never a variant with changed parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfProfile {
    pub profile_id: u32,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub output_len: u32,
    pub argon2_version: u8,
}

/// `WSS_ARGON2ID_V1`: Argon2id v1.3, 64 MiB, t=3, p=1, 32-byte output.
pub const WSS_ARGON2ID_V1: KdfProfile = KdfProfile {
    profile_id: 1,
    memory_kib: 64 * 1024,
    iterations: 3,
    parallelism: 1,
    output_len: KEK_LEN as u32,
    argon2_version: 0x13,
};

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

impl KdfProfile {
    /// Canonical encoding: `u32be` profile ID, memory KiB, iterations, parallelism, output length,
    /// then the Argon2 version byte.
    pub fn encode(&self) -> [u8; PROFILE_ENCODED_LEN] {
        let mut out = [0u8; PROFILE_ENCODED_LEN];
        out[0..4].copy_from_slice(&self.profile_id.to_be_bytes());
        out[4..8].copy_from_slice(&self.memory_kib.to_be_bytes());
        out[8..12].copy_from_slice(&self.iterations.to_be_bytes());
        out[12..16].copy_from_slice(&self.parallelism.to_be_bytes());
        out[16..20].copy_from_slice(&self.output_len.to_be_bytes());
        out[20] = self.argon2_version;
        out
    }

    /// Strict decode: only an admitted profile is returned. A known ID with different parameters is
    /// refused, so a stored profile can never silently weaken the derivation.
    pub fn decode(bytes: &[u8; PROFILE_ENCODED_LEN]) -> Result<Self, KdfError> {
        let profile = KdfProfile {
            profile_id: be_u32(&bytes[0..4]),
            memory_kib: be_u32(&bytes[4..8]),
            iterations: be_u32(&bytes[8..12]),
            parallelism: be_u32(&bytes[12..16]),
            output_len: be_u32(&bytes[16..20]),
            argon2_version: bytes[20],
        };
        admitted(&profile)?;
        Ok(profile)
    }
}

fn admitted(profile: &KdfProfile) -> Result<(), KdfError> {
    if *profile == WSS_ARGON2ID_V1 {
        Ok(())
    } else {
        Err(KdfError::UnsupportedProfile)
    }
}

/// §8.2.1 passphrase encoding: the Unicode NFC normalization of the passphrase, encoded as UTF-8.
/// It must be non-empty and at most [`MAX_PASSPHRASE_LEN`] bytes. The buffer is sized up front (NFC
/// output is at most three times the input) so it never reallocates and leaves no unzeroized copy.
pub fn passphrase_bytes(passphrase: &str) -> Result<Zeroizing<String>, KdfError> {
    let mut normalized = Zeroizing::new(String::with_capacity(passphrase.len().saturating_mul(3)));
    normalized.extend(passphrase.nfc());
    if normalized.is_empty() {
        return Err(KdfError::EmptyPassphrase);
    }
    if normalized.len() > MAX_PASSPHRASE_LEN {
        return Err(KdfError::PassphraseTooLong);
    }
    Ok(normalized)
}

/// Derives the 32-byte recovery key-encryption key from the passphrase (encoded per
/// [`passphrase_bytes`]) and salt. The result is zeroized on drop, and with the `zeroize` feature
/// Argon2 clears its working memory blocks.
pub fn derive_kek(
    profile: &KdfProfile,
    passphrase: &str,
    salt: &[u8],
) -> Result<Zeroizing<[u8; KEK_LEN]>, KdfError> {
    admitted(profile)?;
    if passphrase.len() > MAX_PASSPHRASE_LEN.saturating_mul(4) {
        return Err(KdfError::PassphraseTooLong);
    }
    let passphrase = passphrase_bytes(passphrase)?;
    if !(MIN_SALT_LEN..=MAX_SALT_LEN).contains(&salt.len()) {
        return Err(KdfError::InvalidSalt);
    }
    let params = Params::new(
        profile.memory_kib,
        profile.iterations,
        profile.parallelism,
        Some(KEK_LEN),
    )
    .map_err(|_| KdfError::UnsupportedProfile)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut kek = Zeroizing::new([0u8; KEK_LEN]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, kek.as_mut())
        .map_err(|_| KdfError::DerivationFailed)?;
    Ok(kek)
}
