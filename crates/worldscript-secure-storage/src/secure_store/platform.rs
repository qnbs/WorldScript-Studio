//! The real platform secure store behind the sealed [`SecretStore`](super::SecretStore) boundary
//! (§8.2.2, §8.2.5), compiled only with the `platform-keystore` feature: macOS Keychain, Windows
//! Credential Manager, and on Linux the Secret Service only.
//!
//! Each credential is constructed explicitly for its OS. `keyring`'s default credential builder is
//! never used: on a target without an enabled store it silently falls back to an in-memory mock,
//! and on Linux it could select the kernel keyring, which does not survive a reboot and is neither
//! authority nor fallback (§8.2). The version-1 item bound is enforced by the boundary itself, so
//! an oversized write never reaches the OS store.

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
compile_error!(
    "platform-keystore supports only Linux (Secret Service), macOS (Keychain) and Windows (Credential Manager)"
);

use keyring::{Entry, Error};
use zeroize::Zeroizing;

use super::backend::Backend;
use crate::error::KeyProviderError;

/// The production service name every secure-store item lives under.
pub const PRODUCTION_SERVICE: &str = "worldscript-r15";

/// The OS secure store for one service name.
pub struct PlatformSecretStore {
    service: String,
}

impl PlatformSecretStore {
    /// The store for [`PRODUCTION_SERVICE`].
    pub fn production() -> Self {
        PlatformSecretStore {
            service: PRODUCTION_SERVICE.to_owned(),
        }
    }

    /// A store under another service name, for isolated evidence runs. The name must be non-empty
    /// and must not be the production service.
    pub fn with_service(service: &str) -> Result<Self, KeyProviderError> {
        if service.is_empty() || service == PRODUCTION_SERVICE {
            return Err(KeyProviderError::SecureAnchorUnavailable);
        }
        Ok(PlatformSecretStore {
            service: service.to_owned(),
        })
    }

    fn entry(&self, account: &str) -> Result<Entry, KeyProviderError> {
        #[cfg(target_os = "linux")]
        let credential =
            keyring::secret_service::SsCredential::new_with_target(None, &self.service, account);
        #[cfg(target_os = "macos")]
        let credential =
            keyring::macos::MacCredential::new_with_target(None, &self.service, account);
        #[cfg(target_os = "windows")]
        let credential =
            keyring::windows::WinCredential::new_with_target(None, &self.service, account);
        let credential = credential.map_err(map_error)?;
        Ok(Entry::new_with_credential(Box::new(credential)))
    }
}

/// An unreachable, locked, or refusing store means protected mode is not available; anything else
/// is an ordinary failure of this call.
fn map_error(error: Error) -> KeyProviderError {
    match error {
        Error::NoStorageAccess(_) | Error::PlatformFailure(_) => {
            KeyProviderError::SecureAnchorUnavailable
        }
        _ => KeyProviderError::Unavailable,
    }
}

impl Backend for PlatformSecretStore {
    fn load(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, KeyProviderError> {
        match self.entry(account)?.get_secret() {
            Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
            Err(Error::NoEntry) => Ok(None),
            Err(other) => Err(map_error(other)),
        }
    }

    fn store(&self, account: &str, secret: &[u8]) -> Result<(), KeyProviderError> {
        self.entry(account)?.set_secret(secret).map_err(map_error)
    }

    fn remove(&self, account: &str) -> Result<(), KeyProviderError> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(other) => Err(map_error(other)),
        }
    }
}
