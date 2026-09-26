//! Optional portable recovery package (§8.2.1). A passphrase-derived key-encryption key wraps only
//! the 32-byte portable recovery material; record keys stay random and are never redefined as
//! passphrase-derived.

use std::fmt;

use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use zeroize::{Zeroize, Zeroizing};

use crate::envelope::{NONCE_LEN, TAG_LEN};
use crate::error::KdfError;
use crate::error::RecoveryError;
use crate::kdf::{
    derive_kek, KdfProfile, MAX_SALT_LEN, MIN_SALT_LEN, PROFILE_ENCODED_LEN, WSS_ARGON2ID_V1,
};
use crate::provider::{InstallationScopeId, INSTALLATION_SCOPE_ID_LEN};
use crate::random::{OsRandom, RandomSource};

pub const RECOVERY_MAGIC: [u8; 4] = *b"WSRP";
pub const RECOVERY_VERSION: u32 = 1;
pub const MATERIAL_LEN: usize = 32;
/// Salt length written by this implementation (the reader accepts the §8.2.1 range).
pub const WRITE_SALT_LEN: usize = 16;
const AAD_DOMAIN: &[u8] = b"worldscript-r15/recovery/v1";
const CIPHERTEXT_LEN: usize = MATERIAL_LEN + TAG_LEN;

/// The portable recovery secret, zeroized on drop. Not `Clone`, and `Debug` never prints it.
pub struct RecoveryMaterial(Zeroizing<[u8; MATERIAL_LEN]>);

impl RecoveryMaterial {
    /// Takes the material and zeroizes `source`.
    pub fn from_bytes(source: &mut [u8; MATERIAL_LEN]) -> Self {
        let material = RecoveryMaterial(Zeroizing::new(*source));
        source.zeroize();
        material
    }

    /// Fresh material from the OS CSPRNG.
    pub fn generate() -> Result<Self, RecoveryError> {
        let mut bytes = [0u8; MATERIAL_LEN];
        OsRandom
            .fill(&mut bytes)
            .map_err(|_| RecoveryError::RandomnessUnavailable)?;
        Ok(Self::from_bytes(&mut bytes))
    }

    pub fn expose_secret(&self) -> &[u8; MATERIAL_LEN] {
        &self.0
    }
}

impl fmt::Debug for RecoveryMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RecoveryMaterial(<redacted>)")
    }
}

/// A successfully authenticated package: the material and the installation it was exported from.
#[derive(Debug)]
pub struct UnwrappedRecovery {
    pub material: RecoveryMaterial,
    pub source_installation_scope_id: InstallationScopeId,
}

fn header(
    profile: &KdfProfile,
    salt: &[u8],
    source: &InstallationScopeId,
    nonce: &[u8; NONCE_LEN],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + 4 + PROFILE_ENCODED_LEN + 1 + salt.len() + 32 + 12 + 4);
    out.extend_from_slice(&RECOVERY_MAGIC);
    out.extend_from_slice(&RECOVERY_VERSION.to_be_bytes());
    out.extend_from_slice(&profile.encode());
    out.push(salt.len() as u8);
    out.extend_from_slice(salt);
    out.extend_from_slice(source.as_str().as_bytes());
    out.extend_from_slice(nonce);
    out.extend_from_slice(&(CIPHERTEXT_LEN as u32).to_be_bytes());
    out
}

fn aad(header: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + AAD_DOMAIN.len() + header.len());
    out.extend_from_slice(&(AAD_DOMAIN.len() as u32).to_be_bytes());
    out.extend_from_slice(AAD_DOMAIN);
    out.extend_from_slice(header);
    out
}

/// Wraps `material` under `passphrase` with fresh OS-random salt and nonce.
pub fn wrap_recovery(
    passphrase: &str,
    material: &RecoveryMaterial,
    source: &InstallationScopeId,
) -> Result<Vec<u8>, RecoveryError> {
    wrap_inner(passphrase, material, source, &mut OsRandom)
}

/// Test-vector hook (§16): [`wrap_recovery`] with injected salt/nonce randomness.
#[cfg(feature = "test-randomness")]
pub fn wrap_recovery_with_random(
    passphrase: &str,
    material: &RecoveryMaterial,
    source: &InstallationScopeId,
    random: &mut impl RandomSource,
) -> Result<Vec<u8>, RecoveryError> {
    wrap_inner(passphrase, material, source, random)
}

fn wrap_inner(
    passphrase: &str,
    material: &RecoveryMaterial,
    source: &InstallationScopeId,
    random: &mut impl RandomSource,
) -> Result<Vec<u8>, RecoveryError> {
    let mut salt = [0u8; WRITE_SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    random
        .fill(&mut salt)
        .and_then(|()| random.fill(&mut nonce))
        .map_err(|_| RecoveryError::RandomnessUnavailable)?;
    let kek = derive_kek(&WSS_ARGON2ID_V1, passphrase, &salt).map_err(RecoveryError::Kdf)?;
    let mut package = header(&WSS_ARGON2ID_V1, &salt, source, &nonce);
    let aad = aad(&package);
    let body_start = package.len();
    package.extend_from_slice(material.expose_secret());
    let tag = Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(kek.as_ref()))
        .encrypt_in_place_detached(Nonce::from_slice(&nonce), &aad, &mut package[body_start..])
        .map_err(|_| RecoveryError::Corrupt("encryption failed"))?;
    package.extend_from_slice(&tag);
    Ok(package)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], RecoveryError> {
        let end = self
            .at
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(RecoveryError::Corrupt("truncated recovery package"))?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, RecoveryError> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
}

/// The fields of a recognized version-1 package, borrowed from it.
struct ParsedPackage<'a> {
    profile: KdfProfile,
    salt: &'a [u8],
    source: InstallationScopeId,
    nonce: [u8; NONCE_LEN],
    header_len: usize,
    ciphertext: &'a [u8],
}

/// Everything after magic and version. The header is authenticated, so once a package is known to
/// be `WSRP` v1 any malformed field is a modification and reports `WrongPassphraseOrTampered`, like
/// a failed tag. Only an unknown KDF profile ID stays `UnsupportedProfile`: that is a newer format,
/// and reporting it reveals nothing about the passphrase.
fn parse_v1(package: &[u8]) -> Result<ParsedPackage<'_>, RecoveryError> {
    let mut cursor = Cursor {
        bytes: package,
        at: 8,
    };
    let mut profile_bytes = [0u8; PROFILE_ENCODED_LEN];
    profile_bytes.copy_from_slice(cursor.take(PROFILE_ENCODED_LEN)?);
    if profile_bytes[..4] != WSS_ARGON2ID_V1.profile_id.to_be_bytes() {
        return Err(RecoveryError::Kdf(KdfError::UnsupportedProfile));
    }
    let profile =
        KdfProfile::decode(&profile_bytes).map_err(|_| RecoveryError::WrongPassphraseOrTampered)?;
    let salt_len = usize::from(cursor.take(1)?[0]);
    if !(MIN_SALT_LEN..=MAX_SALT_LEN).contains(&salt_len) {
        return Err(RecoveryError::WrongPassphraseOrTampered);
    }
    let salt = cursor.take(salt_len)?;
    let source = std::str::from_utf8(cursor.take(INSTALLATION_SCOPE_ID_LEN)?)
        .ok()
        .and_then(|s| InstallationScopeId::parse(s).ok())
        .ok_or(RecoveryError::WrongPassphraseOrTampered)?;
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(cursor.take(NONCE_LEN)?);
    if cursor.u32()? as usize != CIPHERTEXT_LEN {
        return Err(RecoveryError::WrongPassphraseOrTampered);
    }
    let header_len = cursor.at;
    let ciphertext = cursor.take(CIPHERTEXT_LEN)?;
    if cursor.at != package.len() {
        return Err(RecoveryError::WrongPassphraseOrTampered);
    }
    Ok(ParsedPackage {
        profile,
        salt,
        source,
        nonce,
        header_len,
        ciphertext,
    })
}

/// Strictly parses, derives the key-encryption key, and authenticates the package. Unknown magic or
/// version is `UnsupportedFormat`; for a recognized v1 package a wrong passphrase and any
/// modification (including truncation or trailing bytes) are one result, `WrongPassphraseOrTampered`.
pub fn unwrap_recovery(
    passphrase: &str,
    package: &[u8],
) -> Result<UnwrappedRecovery, RecoveryError> {
    let recognized = package.len() >= 8
        && package[..4] == RECOVERY_MAGIC
        && package[4..8] == RECOVERY_VERSION.to_be_bytes();
    if !recognized {
        return Err(RecoveryError::UnsupportedFormat);
    }
    let parsed = parse_v1(package).map_err(|error| match error {
        RecoveryError::Corrupt(_) => RecoveryError::WrongPassphraseOrTampered,
        other => other,
    })?;
    let kek = derive_kek(&parsed.profile, passphrase, parsed.salt).map_err(RecoveryError::Kdf)?;
    let aad = aad(&package[..parsed.header_len]);
    let mut material = Zeroizing::new([0u8; MATERIAL_LEN]);
    material.copy_from_slice(&parsed.ciphertext[..MATERIAL_LEN]);
    Aes256Gcm::new(aes_gcm::Key::<Aes256Gcm>::from_slice(kek.as_ref()))
        .decrypt_in_place_detached(
            Nonce::from_slice(&parsed.nonce),
            &aad,
            material.as_mut(),
            Tag::from_slice(&parsed.ciphertext[MATERIAL_LEN..]),
        )
        .map_err(|_| RecoveryError::WrongPassphraseOrTampered)?;
    Ok(UnwrappedRecovery {
        material: RecoveryMaterial::from_bytes(&mut material),
        source_installation_scope_id: parsed.source,
    })
}
