//! Gate 1b-platform Slice C1: runtime key handles over the validated durable authority (§8.2).
//!
//! This layer only reads the secure store. `unlock` loads key handles after a complete authority
//! read, `resolve`/`resolve_ref` resolve exactly one issued route and re-check the cached material
//! against its durable item on every call, and `lock` drops every handle. Anchor transitions and
//! the [`crate::KeyProvider`] implementation belong to Slice C2.

use zeroize::Zeroizing;

use crate::error::KeyProviderError;
use crate::provider::{EpochInfo, KeyState, RootKeyRefV1};
use crate::random::{OsRandom, RandomSource};
use crate::seal::Key;
use crate::secure_store::SecretStore;
use crate::store_authority::SecureStoreAuthority;
use crate::store_layout::KEY_LEN;

struct RuntimeKey {
    key_ref: RootKeyRefV1,
    material: Zeroizing<[u8; KEY_LEN]>,
}

/// Runtime key handles over one [`SecureStoreAuthority`]. It has no `Debug` implementation, so key
/// material cannot reach a formatter.
pub struct SecureStoreRuntime<S, R = OsRandom> {
    authority: SecureStoreAuthority<S, R>,
    runtime: Vec<RuntimeKey>,
    unlocked: bool,
}

impl<S, R> SecureStoreRuntime<S, R>
where
    S: SecretStore,
    R: RandomSource,
{
    /// Wraps an authority; the runtime starts locked.
    pub fn new(authority: SecureStoreAuthority<S, R>) -> Self {
        Self {
            authority,
            runtime: Vec::new(),
            unlocked: false,
        }
    }

    /// The durable authority, for reads.
    pub fn authority(&self) -> &SecureStoreAuthority<S, R> {
        &self.authority
    }

    /// The durable authority, for provisioning. A key provisioned after `unlock` stays `Locked`
    /// until the next `unlock` validates and loads it; the runtime never loads keys lazily.
    pub fn authority_mut(&mut self) -> &mut SecureStoreAuthority<S, R> {
        &mut self.authority
    }

    /// §8.1 state over the validated anchor: `Unconfigured` until a root is committed, whatever
    /// scope or bootstrap keys exist. Only the committed root decides key loss; a prepared target is
    /// recovery authorization only (§5.3.1). Store and format failures are errors, never states.
    pub fn state(&self) -> Result<KeyState, KeyProviderError> {
        let root = match self.committed_root() {
            Ok(root) => root,
            Err(KeyProviderError::RecoveryRequired) => return Ok(KeyState::RecoveryRequired),
            Err(KeyProviderError::KeyLost) => return Ok(KeyState::KeyLost),
            Err(other) => return Err(other),
        };
        let Some(root) = root else {
            return Ok(KeyState::Unconfigured);
        };
        if !self.unlocked {
            return Ok(KeyState::Locked);
        }
        let epochs = self.authority.list_epochs()?;
        let Some(entry) = epochs.iter().find(|entry| entry.key_ref == root) else {
            return Ok(KeyState::RecoveryRequired);
        };
        match self.checked_material(&root) {
            Ok(_) => Ok(KeyState::Unlocked { epoch: entry.epoch }),
            Err(KeyProviderError::Locked) => Ok(KeyState::Locked),
            Err(KeyProviderError::RecoveryRequired) => Ok(KeyState::RecoveryRequired),
            Err(KeyProviderError::KeyLost) => Ok(KeyState::KeyLost),
            Err(other) => Err(other),
        }
    }

    /// Loads the handles of every available indexed key after a complete authority read (§8.2; no
    /// passphrase). A lost committed root key is `KeyLost`, and any failure grants nothing.
    pub fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        self.lock();
        self.committed_root()?;
        let epochs = self.authority.list_epochs()?;
        let mut loaded = Vec::with_capacity(epochs.len());
        for entry in epochs.iter().filter(|entry| entry.available) {
            loaded.push(RuntimeKey {
                key_ref: entry.key_ref.clone(),
                material: self.authority.key_material(&entry.key_ref)?,
            });
        }
        // The keys were read in several store calls; a changed route set in between grants nothing.
        if epochs != self.authority.list_epochs()? {
            return Err(KeyProviderError::Unavailable);
        }
        self.runtime = loaded;
        self.unlocked = true;
        let outcome = self.state();
        self.settle_unlock(outcome)
    }

    /// Only a usable final state keeps the loaded handles. `KeyLost`, `RecoveryRequired`, any
    /// other state, or an error in the final validation drops every handle and fails the unlock.
    fn settle_unlock(
        &mut self,
        outcome: Result<KeyState, KeyProviderError>,
    ) -> Result<KeyState, KeyProviderError> {
        let failure = match outcome {
            Ok(state @ (KeyState::Unconfigured | KeyState::Unlocked { .. })) => return Ok(state),
            Ok(KeyState::KeyLost) => KeyProviderError::KeyLost,
            Ok(KeyState::RecoveryRequired) => KeyProviderError::RecoveryRequired,
            Ok(_) => KeyProviderError::Unavailable,
            Err(error) => error,
        };
        self.lock();
        Err(failure)
    }

    /// Clears every runtime handle; the material is zeroized on drop. Afterwards every resolve is
    /// `Locked`.
    pub fn lock(&mut self) {
        self.runtime.clear();
        self.unlocked = false;
    }

    /// The key of a data epoch, taken from the validated index only.
    pub fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        self.ensure_root_usable()?;
        let key_ref = self
            .issued_routes()?
            .into_iter()
            .find(|entry| entry.epoch == epoch)
            .map(|entry| entry.key_ref)
            .ok_or(KeyProviderError::UnknownEpoch)?;
        self.key_for(&key_ref)
    }

    /// Resolves exactly this route, which must be issued (indexed); never a search (§5.3.1).
    pub fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        self.ensure_root_usable()?;
        if !self
            .issued_routes()?
            .iter()
            .any(|entry| &entry.key_ref == key_ref)
        {
            return Err(KeyProviderError::UnknownKeyRef);
        }
        self.key_for(key_ref)
    }

    /// The committed root's route after its durable key was found intact, or `None` before the first
    /// root is committed. Only the committed root is ordinary authority; the loss of a prepared
    /// target key is left to the anchor-transition recovery (§5.3.1).
    fn committed_root(&self) -> Result<Option<RootKeyRefV1>, KeyProviderError> {
        let Some(root) = self.authority.validated_anchor()?.committed_root else {
            return Ok(None);
        };
        self.authority.key_material(&root.root_key_ref)?;
        Ok(Some(root.root_key_ref))
    }

    /// Every resolution is refused while the committed root is lost, replaced, or not loaded, so no
    /// other epoch key outlives the authority it belongs to. `resolve` cannot clear the handles
    /// (`&self`); `lock` does.
    fn ensure_root_usable(&self) -> Result<(), KeyProviderError> {
        match self.committed_root()? {
            Some(root) => self.checked_material(&root).map(|_| ()),
            None => Ok(()),
        }
    }

    fn issued_routes(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        self.authority.list_epochs()
    }

    fn key_for(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        let material = self.checked_material(key_ref)?;
        let mut bytes = Zeroizing::new([0u8; KEY_LEN]);
        bytes.copy_from_slice(material.as_ref());
        Ok(Key::from_bytes(&mut bytes))
    }

    /// The cached handle, only while its durable item still holds the same bytes. The durable item
    /// is read first, so a missing key is `KeyLost` whether or not it was loaded; a present key
    /// that was never loaded is `Locked`, and one that differs from its handle is
    /// `RecoveryRequired`.
    fn checked_material(
        &self,
        key_ref: &RootKeyRefV1,
    ) -> Result<&Zeroizing<[u8; KEY_LEN]>, KeyProviderError> {
        let durable = self.authority.key_material(key_ref)?;
        let cached = self
            .runtime
            .iter()
            .find(|key| &key.key_ref == key_ref)
            .ok_or(KeyProviderError::Locked)?;
        if !same_material(&cached.material, &durable) {
            return Err(KeyProviderError::RecoveryRequired);
        }
        Ok(&cached.material)
    }
}

/// Compares two keys without an early exit on the first differing byte.
fn same_material(left: &[u8; KEY_LEN], right: &[u8; KEY_LEN]) -> bool {
    left.iter()
        .zip(right.iter())
        .fold(0u8, |diff, (a, b)| diff | (a ^ b))
        == 0
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use crate::secure_store::MemorySecretStore;

    fn unlocked_runtime() -> SecureStoreRuntime<MemorySecretStore> {
        let mut authority = SecureStoreAuthority::new(MemorySecretStore::new());
        authority.read_or_provision_installation_scope().unwrap();
        authority.provision_epoch_key(1).unwrap();
        let mut runtime = SecureStoreRuntime::new(authority);
        runtime.unlock().unwrap();
        runtime
    }

    // The final validation can observe a concurrent change after the handles were installed; every
    // outcome other than a usable state must leave nothing resolvable.
    #[test]
    fn a_failed_final_validation_drops_every_handle() {
        for outcome in [
            Ok(KeyState::KeyLost),
            Ok(KeyState::RecoveryRequired),
            Ok(KeyState::Locked),
            Err(KeyProviderError::SecureAnchorUnavailable),
        ] {
            let mut runtime = unlocked_runtime();
            assert!(runtime.settle_unlock(outcome).is_err());
            assert!(!runtime.unlocked);
            assert!(runtime.runtime.is_empty());
            assert_eq!(runtime.resolve(1).err(), Some(KeyProviderError::Locked));
        }
    }

    #[test]
    fn a_usable_final_state_keeps_the_handles() {
        let mut runtime = unlocked_runtime();
        assert_eq!(
            runtime.settle_unlock(Ok(KeyState::Unconfigured)),
            Ok(KeyState::Unconfigured)
        );
        assert!(runtime.resolve(1).is_ok());
    }
}
