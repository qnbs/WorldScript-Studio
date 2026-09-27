//! The §8.2 [`KeyProvider`] over any [`SecretStore`] (§8.2.2). Anchor state, the epoch index and
//! every random 256-bit key live as items in the secure store — never in the WorldScript data
//! directory. Platform adapters differ only in the `SecretStore` they supply.

use zeroize::Zeroizing;

use crate::anchor;
use crate::anchor_codec;
use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, EpochInfo, InstallationScopeId, KeyProvider, KeyState, PrepareRootAnchor,
    RootKeyRefV1,
};
use crate::random::{OsRandom, RandomSource};
use crate::seal::Key;
use crate::secure_store::SecretStore;

/// Store item holding the `WSA1`-encoded anchor.
pub const ANCHOR_ACCOUNT: &str = "r15-anchor-v1";
/// Store item holding the `WSE1`-encoded epoch-to-route index.
pub const EPOCH_INDEX_ACCOUNT: &str = "r15-epochs-v1";
const KEY_ACCOUNT_PREFIX: &str = "r15-key-";
const ROUTE_PREFIX: &str = "wss-kr1-";
const EPOCH_INDEX_MAGIC: [u8; 4] = *b"WSE1";
const KEY_LEN: usize = 32;

fn random_error<T>(_: T) -> KeyProviderError {
    KeyProviderError::RandomnessUnavailable
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// One indexed epoch key: its epoch and the opaque route this provider issued for it.
#[derive(Clone)]
struct IndexEntry {
    epoch: u64,
    key_ref: RootKeyRefV1,
}

fn encode_index(entries: &[IndexEntry]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + entries.len() * 64);
    out.extend_from_slice(&EPOCH_INDEX_MAGIC);
    out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
    for entry in entries {
        out.extend_from_slice(&entry.epoch.to_be_bytes());
        out.extend_from_slice(&(entry.key_ref.as_bytes().len() as u16).to_be_bytes());
        out.extend_from_slice(entry.key_ref.as_bytes());
    }
    out
}

fn decode_index(bytes: &[u8]) -> Result<Vec<IndexEntry>, KeyProviderError> {
    let corrupt = || KeyProviderError::RecoveryRequired;
    let mut at = 0usize;
    let mut take = |len: usize| -> Result<&[u8], KeyProviderError> {
        let end = at
            .checked_add(len)
            .filter(|e| *e <= bytes.len())
            .ok_or_else(corrupt)?;
        let slice = &bytes[at..end];
        at = end;
        Ok(slice)
    };
    if take(4)? != EPOCH_INDEX_MAGIC {
        return Err(KeyProviderError::UnsupportedAnchorFormat);
    }
    let count = u32::from_be_bytes(take(4)?.try_into().map_err(|_| corrupt())?);
    let mut entries: Vec<IndexEntry> = Vec::new();
    for _ in 0..count {
        let epoch = u64::from_be_bytes(take(8)?.try_into().map_err(|_| corrupt())?);
        let len = usize::from(u16::from_be_bytes(
            take(2)?.try_into().map_err(|_| corrupt())?,
        ));
        let key_ref = RootKeyRefV1::new(take(len)?.to_vec()).map_err(|_| corrupt())?;
        let duplicate = entries
            .iter()
            .any(|e| e.epoch == epoch || e.key_ref == key_ref);
        if duplicate || epoch == 0 || epoch == u64::MAX {
            return Err(corrupt());
        }
        entries.push(IndexEntry { epoch, key_ref });
    }
    if at != bytes.len() {
        return Err(corrupt());
    }
    Ok(entries)
}

/// The §8.2 provider over a platform [`SecretStore`].
pub struct SecureStoreKeyProvider<S: SecretStore> {
    store: S,
    runtime: Vec<(RootKeyRefV1, Zeroizing<[u8; KEY_LEN]>)>,
    unlocked: bool,
}

impl<S: SecretStore> SecureStoreKeyProvider<S> {
    pub fn new(store: S) -> Self {
        SecureStoreKeyProvider {
            store,
            runtime: Vec::new(),
            unlocked: false,
        }
    }

    /// Number of runtime key handles currently held (`0` after [`KeyProvider::lock`]).
    pub fn runtime_key_count(&self) -> usize {
        self.runtime.len()
    }

    fn read_anchor(&self) -> Result<AnchorState, KeyProviderError> {
        match self.store.get(ANCHOR_ACCOUNT)? {
            None => Ok(AnchorState::empty()),
            Some(bytes) => anchor_codec::decode(&bytes),
        }
    }

    fn apply(
        &mut self,
        transition: impl FnOnce(&AnchorState) -> Result<AnchorState, KeyProviderError>,
    ) -> Result<AnchorState, KeyProviderError> {
        let next = transition(&self.read_anchor()?)?;
        self.store
            .set(ANCHOR_ACCOUNT, &anchor_codec::encode(&next)?)?;
        Ok(next)
    }

    fn read_index(&self) -> Result<Vec<IndexEntry>, KeyProviderError> {
        match self.store.get(EPOCH_INDEX_ACCOUNT)? {
            None => Ok(Vec::new()),
            Some(bytes) => decode_index(&bytes),
        }
    }

    /// Store item name for an issued route. Only routes found in the index reach this, so an
    /// account name is never built from caller-supplied bytes.
    fn key_account(key_ref: &RootKeyRefV1) -> String {
        format!("{KEY_ACCOUNT_PREFIX}{}", hex(key_ref.as_bytes()))
    }

    fn read_key(
        &self,
        key_ref: &RootKeyRefV1,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, KeyProviderError> {
        let bytes = self
            .store
            .get(&Self::key_account(key_ref))?
            .ok_or(KeyProviderError::KeyLost)?;
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        if bytes.len() != KEY_LEN {
            return Err(KeyProviderError::RecoveryRequired);
        }
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    fn issued(&self, key_ref: &RootKeyRefV1) -> Result<IndexEntry, KeyProviderError> {
        self.read_index()?
            .into_iter()
            .find(|e| &e.key_ref == key_ref)
            .ok_or(KeyProviderError::UnknownKeyRef)
    }

    fn runtime_key(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        let (_, material) = self
            .runtime
            .iter()
            .find(|(r, _)| r == key_ref)
            .ok_or(KeyProviderError::UnknownKeyRef)?;
        let mut copy = **material;
        Ok(Key::from_bytes(&mut copy))
    }

    fn committed_state(&self, anchor: &AnchorState) -> Result<KeyState, KeyProviderError> {
        let Some(root) = &anchor.committed_root else {
            return Ok(KeyState::Unconfigured);
        };
        let Some(entry) = self
            .read_index()?
            .into_iter()
            .find(|e| e.key_ref == root.root_key_ref)
        else {
            return Ok(KeyState::RecoveryRequired);
        };
        match self.read_key(&entry.key_ref) {
            Err(KeyProviderError::KeyLost) => Ok(KeyState::KeyLost),
            Err(other) => Err(other),
            Ok(_) if !self.unlocked => Ok(KeyState::Locked),
            Ok(_) => Ok(KeyState::Unlocked { epoch: entry.epoch }),
        }
    }
}

impl<S: SecretStore> KeyProvider for SecureStoreKeyProvider<S> {
    fn state(&self) -> Result<KeyState, KeyProviderError> {
        match self.read_anchor() {
            Ok(anchor) => self.committed_state(&anchor),
            Err(KeyProviderError::RecoveryRequired) => Ok(KeyState::RecoveryRequired),
            Err(other) => Err(other),
        }
    }

    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        let entry = self
            .read_index()?
            .into_iter()
            .find(|e| e.epoch == epoch)
            .ok_or(KeyProviderError::UnknownEpoch)?;
        self.runtime_key(&entry.key_ref)
    }

    fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.runtime_key(key_ref)
    }

    fn lock(&mut self) {
        // Dropping each Zeroizing handle clears its bytes.
        self.runtime.clear();
        self.unlocked = false;
    }

    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        let anchor = self.read_anchor()?;
        let mut runtime = Vec::new();
        for entry in self.read_index()? {
            match self.read_key(&entry.key_ref) {
                Ok(key) => runtime.push((entry.key_ref, key)),
                Err(KeyProviderError::KeyLost) => {}
                Err(other) => return Err(other),
            }
        }
        if let Some(root) = &anchor.committed_root {
            if !runtime.iter().any(|(r, _)| r == &root.root_key_ref) {
                return Err(KeyProviderError::KeyLost);
            }
        }
        self.runtime = runtime;
        self.unlocked = true;
        self.committed_state(&anchor)
    }

    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        let mut out = Vec::new();
        for entry in self.read_index()? {
            let available = self
                .store
                .get(&Self::key_account(&entry.key_ref))?
                .is_some();
            out.push(EpochInfo {
                epoch: entry.epoch,
                key_ref: entry.key_ref,
                available,
            });
        }
        Ok(out)
    }

    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        let mut index = self.read_index()?;
        let assigned = epoch != 0 && epoch != u64::MAX;
        if !assigned || index.iter().any(|e| e.epoch == epoch) {
            return Err(KeyProviderError::AnchorConflict(
                "epoch is unassigned or already provisioned",
            ));
        }
        let mut route = [0u8; 16];
        let mut material = Zeroizing::new([0u8; KEY_LEN]);
        OsRandom.fill(&mut route).map_err(random_error)?;
        OsRandom.fill(material.as_mut()).map_err(random_error)?;
        let key_ref = RootKeyRefV1::new(format!("{ROUTE_PREFIX}{}", hex(&route)).into_bytes())?;
        // Key first, then index: a crash in between leaves only an unreferenced item.
        self.store
            .set(&Self::key_account(&key_ref), material.as_ref())?;
        index.push(IndexEntry {
            epoch,
            key_ref: key_ref.clone(),
        });
        self.store.set(EPOCH_INDEX_ACCOUNT, &encode_index(&index))?;
        if self.unlocked {
            self.runtime.push((key_ref.clone(), material));
        }
        Ok(key_ref)
    }

    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        self.read_anchor()
    }

    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        if let Some(scope) = anchor::existing_installation_scope(&self.read_anchor()?)? {
            return Ok(scope);
        }
        let mut bits = [0u8; 16];
        OsRandom.fill(&mut bits).map_err(random_error)?;
        let written = self.apply(|state| {
            anchor::provision_installation_scope(state, bits).map(|(next, _)| next)
        })?;
        // §5.3.2: read the scope back to confirm it is durable before returning it.
        let durable = self.read_anchor()?.installation_scope_id;
        match (written.installation_scope_id, durable) {
            (Some(w), Some(d)) if w == d => Ok(d),
            _ => Err(KeyProviderError::Unavailable),
        }
    }

    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError> {
        let entry = self.issued(&request.target_root_key_ref)?;
        self.read_key(&entry.key_ref)?;
        self.apply(|state| anchor::prepare(state, request))
            .map(|_| ())
    }

    fn commit_root_anchor(
        &mut self,
        operation_id: &str,
        target_root_generation: u64,
    ) -> Result<(), KeyProviderError> {
        self.apply(|state| anchor::commit(state, operation_id, target_root_generation))
            .map(|_| ())
    }

    fn abort_or_recover_root_anchor(&mut self, operation_id: &str) -> Result<(), KeyProviderError> {
        self.apply(|state| anchor::abort_or_recover(state, operation_id))
            .map(|_| ())
    }
}
