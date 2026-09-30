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
    /// scope or bootstrap keys exist. Store and format failures are errors, never states.
    pub fn state(&self) -> Result<KeyState, KeyProviderError> {
        let anchor = match self.authority.read_root_anchor_state() {
            Ok(anchor) => anchor,
            Err(KeyProviderError::RecoveryRequired) => return Ok(KeyState::RecoveryRequired),
            Err(KeyProviderError::KeyLost) => return Ok(KeyState::KeyLost),
            Err(other) => return Err(other),
        };
        let Some(root) = anchor.committed_root else {
            return Ok(KeyState::Unconfigured);
        };
        if !self.unlocked {
            return Ok(KeyState::Locked);
        }
        let epochs = self.authority.list_epochs()?;
        let Some(entry) = epochs
            .iter()
            .find(|entry| entry.key_ref == root.root_key_ref)
        else {
            return Ok(KeyState::RecoveryRequired);
        };
        match self.checked_material(&root.root_key_ref) {
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
        self.authority.read_root_anchor_state()?;
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
        self.state()
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
        if !self
            .issued_routes()?
            .iter()
            .any(|entry| &entry.key_ref == key_ref)
        {
            return Err(KeyProviderError::UnknownKeyRef);
        }
        self.key_for(key_ref)
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

    /// The cached handle, only while its durable item still holds the same bytes. A handle that
    /// was never loaded is `Locked`; a durable item that differs from it is `RecoveryRequired`.
    fn checked_material(
        &self,
        key_ref: &RootKeyRefV1,
    ) -> Result<&Zeroizing<[u8; KEY_LEN]>, KeyProviderError> {
        let cached = self
            .runtime
            .iter()
            .find(|key| &key.key_ref == key_ref)
            .ok_or(KeyProviderError::Locked)?;
        let durable = self.authority.key_material(key_ref)?;
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
