//! Durable Gate 1b-platform authority and bootstrap primitives.
//!
//! This module owns only the secure-store relationships between the validated anchor, epoch index,
//! and per-route key items. Runtime key handles live in `store_runtime` (Slice C1); anchor
//! transitions remain in a later slice.

use zeroize::Zeroizing;

use crate::anchor;
use crate::anchor_codec;
use crate::error::KeyProviderError;
use crate::provider::{AnchorState, EpochInfo, InstallationScopeId, RootKeyRefV1};
use crate::random::{OsRandom, RandomSource, RandomnessUnavailable};
use crate::secure_store::SecretStore;
use crate::store_layout::{
    decode_index, encode_index, key_account, route_from_bits, IndexEntry, ANCHOR_ACCOUNT,
    EPOCH_INDEX_ACCOUNT, KEY_LEN, MAX_INDEXED_EPOCHS,
};

/// The durable authority surface admitted by Gate 1b-platform Slice B.
pub struct SecureStoreAuthority<S, R = OsRandom> {
    store: S,
    random: R,
}

impl<S: SecretStore> SecureStoreAuthority<S, OsRandom> {
    /// Creates a production authority using the operating system CSPRNG.
    pub fn new(store: S) -> Self {
        Self {
            store,
            random: OsRandom,
        }
    }
}

impl<S, R> SecureStoreAuthority<S, R>
where
    S: SecretStore,
    R: RandomSource,
{
    /// Creates an authority with an injected randomness source for deterministic tests.
    #[cfg(feature = "test-randomness")]
    pub fn with_random(store: S, random: R) -> Self {
        Self { store, random }
    }

    /// Reads the validated cold-start anchor without selecting runtime authority.
    pub fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        let (anchor_state, index) = self.read_authority()?;
        self.validate_root_routes(&anchor_state, &index, true)?;
        self.validate_indexed_keys(&index)?;
        Ok(anchor_state)
    }

    /// Lists non-secret epoch identities while preserving the distinct key-loss result.
    pub fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        let (_, index) = self.read_authority()?;
        index
            .into_iter()
            .map(|entry| {
                let available = match self.read_key(&entry.key_ref) {
                    Ok(_) => true,
                    Err(KeyProviderError::KeyLost) => false,
                    Err(other) => return Err(other),
                };
                Ok(EpochInfo {
                    epoch: entry.epoch,
                    key_ref: entry.key_ref,
                    available,
                })
            })
            .collect()
    }

    /// Returns the exact durable scope, or provisions it once before any epoch/index write.
    ///
    /// Cross-process bootstrap serialization is a later Gate 4 responsibility. This Slice B
    /// boundary never treats concurrent empty-state observations as an authority guarantee.
    pub fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        let (anchor_state, index) = self.read_authority()?;
        self.validate_root_routes(&anchor_state, &index, true)?;
        if let Some(scope) = anchor_state.installation_scope_id.clone() {
            return Ok(scope);
        }
        if !index.is_empty() {
            return Err(KeyProviderError::RecoveryRequired);
        }
        if anchor_state.committed_root.is_some() {
            return Err(KeyProviderError::RecoveryRequired);
        }
        if anchor_state.prepared_root_commit.is_some() {
            return Err(KeyProviderError::RecoveryRequired);
        }

        let mut bits = [0u8; 16];
        self.random
            .fill(&mut bits)
            .map_err(|_| KeyProviderError::RandomnessUnavailable)?;
        let (next, scope) = anchor::provision_installation_scope(&anchor_state, bits)?;
        self.write_anchor(&next)?;

        // An ambiguous store result is never treated as fresh state; only the exact read-back is.
        let durable = self.read_anchor()?.installation_scope_id;
        match durable {
            Some(found) if found == scope => Ok(found),
            _ => Err(KeyProviderError::Unavailable),
        }
    }

    /// Provisions one epoch without replacing any existing route or key material.
    ///
    /// Key material is written before its index relationship so an index can never authorize a
    /// missing key. If the later index write fails, the unreferenced key is preserved and no
    /// authority is granted; journaled orphan reconciliation belongs to a later bootstrap gate.
    pub fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        let (anchor_state, mut index) = self.read_authority()?;
        self.validate_indexed_key_material(&index)?;
        self.validate_root_routes(&anchor_state, &index, true)?;
        if anchor_state.installation_scope_id.is_none() {
            return Err(KeyProviderError::AnchorConflict(
                "the installation scope must be provisioned first",
            ));
        }
        if epoch == 0 || epoch == u64::MAX {
            return Err(KeyProviderError::AnchorConflict("epoch is unassigned"));
        }

        if let Some(existing) = index.iter().find(|entry| entry.epoch == epoch) {
            self.read_key(&existing.key_ref)?;
            return Ok(existing.key_ref.clone());
        }
        if index.len() >= MAX_INDEXED_EPOCHS {
            return Err(KeyProviderError::AnchorConflict("the epoch index is full"));
        }

        let key_ref = self.fresh_route(&index)?;
        let mut material = Zeroizing::new([0u8; KEY_LEN]);
        self.random
            .fill(material.as_mut())
            .map_err(|_| KeyProviderError::RandomnessUnavailable)?;
        index.push(IndexEntry {
            epoch,
            key_ref: key_ref.clone(),
        });
        let encoded = encode_index(&index)?;

        // Key-first leaves only unreferenced debris if index persistence fails; it never grants it authority.
        self.store.set(&key_account(&key_ref), material.as_ref())?;
        self.store.set(EPOCH_INDEX_ACCOUNT, &encoded)?;
        Ok(key_ref)
    }

    /// The structurally validated anchor for the Slice C1 runtime layer: the scope, index and
    /// root-route relationships are checked, but key presence is left to the caller, so the loss of
    /// a prepared (recovery-only, §5.3.1) target key is not mistaken for loss of the committed root.
    pub(crate) fn validated_anchor(&self) -> Result<AnchorState, KeyProviderError> {
        Ok(self.read_authority()?.0)
    }

    /// The durable bytes of one route for the Slice C1 runtime layer: `KeyLost` when the item is
    /// missing, `RecoveryRequired` when it is not exactly one key.
    pub(crate) fn key_material(
        &self,
        key_ref: &RootKeyRefV1,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, KeyProviderError> {
        self.read_key(key_ref)
    }

    fn read_anchor(&self) -> Result<AnchorState, KeyProviderError> {
        match self.store.get(ANCHOR_ACCOUNT)? {
            Some(bytes) => anchor_codec::decode(&bytes),
            None => Ok(AnchorState::empty()),
        }
    }

    fn read_index(&self) -> Result<Vec<IndexEntry>, KeyProviderError> {
        match self.store.get(EPOCH_INDEX_ACCOUNT)? {
            Some(bytes) => decode_index(&bytes),
            None => Ok(Vec::new()),
        }
    }

    /// One read validates all durable relationships before any caller receives an ordinary answer.
    fn read_authority(&self) -> Result<(AnchorState, Vec<IndexEntry>), KeyProviderError> {
        let anchor_state = self.read_anchor()?;
        let index = self.read_index()?;
        self.validate_scope_index(&anchor_state, &index)?;
        self.validate_indexed_keys(&index)?;
        self.validate_root_routes(&anchor_state, &index, false)?;
        Ok((anchor_state, index))
    }

    fn validate_scope_index(
        &self,
        anchor_state: &AnchorState,
        index: &[IndexEntry],
    ) -> Result<(), KeyProviderError> {
        match (
            anchor_state.installation_scope_id.is_some(),
            index.is_empty(),
        ) {
            (false, false) => Err(KeyProviderError::RecoveryRequired),
            _ => Ok(()),
        }
    }

    fn validate_indexed_keys(&self, index: &[IndexEntry]) -> Result<(), KeyProviderError> {
        for entry in index {
            match self.read_key(&entry.key_ref) {
                Ok(_) | Err(KeyProviderError::KeyLost) => {}
                Err(other) => return Err(other),
            }
        }
        Ok(())
    }

    fn validate_indexed_key_material(&self, index: &[IndexEntry]) -> Result<(), KeyProviderError> {
        for entry in index {
            self.read_key(&entry.key_ref)?;
        }
        Ok(())
    }

    fn validate_root_routes(
        &self,
        anchor_state: &AnchorState,
        index: &[IndexEntry],
        require_key_material: bool,
    ) -> Result<(), KeyProviderError> {
        for route in Self::root_routes(anchor_state) {
            self.require_indexed_route(index, route)?;
            if require_key_material {
                self.read_key(route)?;
            }
        }
        Ok(())
    }

    fn root_routes(anchor_state: &AnchorState) -> impl Iterator<Item = &RootKeyRefV1> {
        anchor_state
            .committed_root
            .iter()
            .map(|root| &root.root_key_ref)
            .chain(
                anchor_state
                    .prepared_root_commit
                    .iter()
                    .map(|prepared| &prepared.target_root_key_ref),
            )
    }

    fn require_indexed_route(
        &self,
        index: &[IndexEntry],
        route: &RootKeyRefV1,
    ) -> Result<(), KeyProviderError> {
        if index.iter().any(|entry| &entry.key_ref == route) {
            Ok(())
        } else {
            Err(KeyProviderError::RecoveryRequired)
        }
    }

    fn read_key(
        &self,
        key_ref: &RootKeyRefV1,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, KeyProviderError> {
        let bytes = self
            .store
            .get(&key_account(key_ref))?
            .ok_or(KeyProviderError::KeyLost)?;
        if bytes.len() != KEY_LEN {
            return Err(KeyProviderError::RecoveryRequired);
        }
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    fn write_anchor(&self, state: &AnchorState) -> Result<(), KeyProviderError> {
        let encoded = anchor_codec::encode(state)?;
        self.store.set(ANCHOR_ACCOUNT, &encoded)
    }

    fn fresh_route(&mut self, index: &[IndexEntry]) -> Result<RootKeyRefV1, KeyProviderError> {
        for _ in 0..4 {
            let mut bits = [0u8; 16];
            self.random
                .fill(&mut bits)
                .map_err(|_| KeyProviderError::RandomnessUnavailable)?;
            let route = route_from_bits(bits)?;
            if index.iter().all(|entry| entry.key_ref != route)
                && self.store.get(&key_account(&route))?.is_none()
            {
                return Ok(route);
            }
        }
        Err(KeyProviderError::Unavailable)
    }
}

impl From<RandomnessUnavailable> for KeyProviderError {
    fn from(_: RandomnessUnavailable) -> Self {
        KeyProviderError::RandomnessUnavailable
    }
}
