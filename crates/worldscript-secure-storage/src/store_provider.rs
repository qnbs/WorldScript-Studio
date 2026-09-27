//! The §8.2 [`KeyProvider`] over any [`SecretStore`] (§8.2.2). Anchor state, the epoch index and
//! every random 256-bit key live as items in the secure store — never in the WorldScript data
//! directory. Platform adapters differ only in the `SecretStore` they supply.
//!
//! The store has no compare-and-swap, so read-modify-write sequences are serialized in-process by a
//! mutex; across processes they rely on the caller holding the §11 operation admission that §5.3.1
//! already requires for every anchor transition.

use std::sync::Mutex;

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
/// §8.2.2: version 1 indexes at most this many epochs, so the index item stays well inside the
/// smallest platform limit (a Windows generic credential blob is 2,560 bytes). Retiring epochs is
/// part of the later rotation lifecycle.
pub const MAX_INDEXED_EPOCHS: usize = 32;
/// §8.2.2: no secure-store item this provider writes may exceed this many bytes.
pub const MAX_ITEM_LEN: usize = 2560;
const KEY_ACCOUNT_PREFIX: &str = "r15-key-";
const ROUTE_PREFIX: &str = "wss-kr1-";
const EPOCH_INDEX_MAGIC: [u8; 4] = *b"WSE1";
const KEY_LEN: usize = 32;

/// Serializes every read-modify-write of secure-store items within this process.
static STORE_WRITES: Mutex<()> = Mutex::new(());

fn write_guard() -> std::sync::MutexGuard<'static, ()> {
    // A poisoned lock only means another writer panicked; the store itself is still consistent.
    STORE_WRITES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn random_error<T>(_: T) -> KeyProviderError {
    KeyProviderError::RandomnessUnavailable
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn corrupt() -> KeyProviderError {
    KeyProviderError::RecoveryRequired
}

/// One indexed epoch key: its epoch and the opaque route this provider issued for it.
#[derive(Clone)]
struct IndexEntry {
    epoch: u64,
    key_ref: RootKeyRefV1,
}

fn encode_index(entries: &[IndexEntry]) -> Result<Vec<u8>, KeyProviderError> {
    let mut out = Vec::with_capacity(8 + entries.len() * 50);
    out.extend_from_slice(&EPOCH_INDEX_MAGIC);
    out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
    for entry in entries {
        out.extend_from_slice(&entry.epoch.to_be_bytes());
        out.extend_from_slice(&(entry.key_ref.as_bytes().len() as u16).to_be_bytes());
        out.extend_from_slice(entry.key_ref.as_bytes());
    }
    check_item_len(out)
}

fn check_item_len(item: Vec<u8>) -> Result<Vec<u8>, KeyProviderError> {
    if item.len() > MAX_ITEM_LEN {
        Err(KeyProviderError::AnchorConflict(
            "secure-store item exceeds the version-1 size bound",
        ))
    } else {
        Ok(item)
    }
}

struct IndexReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> IndexReader<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], KeyProviderError> {
        let slice = self.slice(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(slice);
        Ok(out)
    }

    fn slice(&mut self, len: usize) -> Result<&'a [u8], KeyProviderError> {
        let end = self
            .at
            .checked_add(len)
            .filter(|e| *e <= self.bytes.len())
            .ok_or_else(corrupt)?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn entry(&mut self) -> Result<IndexEntry, KeyProviderError> {
        let epoch = u64::from_be_bytes(self.take()?);
        let len = usize::from(u16::from_be_bytes(self.take()?));
        let key_ref = RootKeyRefV1::new(self.slice(len)?.to_vec()).map_err(|_| corrupt())?;
        Ok(IndexEntry { epoch, key_ref })
    }
}

/// The exact route grammar this adapter issues: `wss-kr1-` plus 32 lowercase hexadecimal characters.
fn is_issued_route(route: &[u8]) -> bool {
    route.len() == ROUTE_PREFIX.len() + 32
        && route.starts_with(ROUTE_PREFIX.as_bytes())
        && route[ROUTE_PREFIX.len()..]
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

fn admissible(entries: &[IndexEntry], entry: &IndexEntry) -> bool {
    let assigned =
        entry.epoch != 0 && entry.epoch != u64::MAX && is_issued_route(entry.key_ref.as_bytes());
    let unique = entries
        .iter()
        .all(|e| e.epoch != entry.epoch && e.key_ref != entry.key_ref);
    assigned && unique
}

/// Strict `WSE1` decode. Any malformation — including a wrong magic — is `RecoveryRequired`: the
/// index is a control item, not a versioned format a newer Core could legitimately have written.
fn decode_index(bytes: &[u8]) -> Result<Vec<IndexEntry>, KeyProviderError> {
    let mut reader = IndexReader { bytes, at: 0 };
    if reader.take::<4>()? != EPOCH_INDEX_MAGIC {
        return Err(corrupt());
    }
    let count = u32::from_be_bytes(reader.take()?) as usize;
    if count > MAX_INDEXED_EPOCHS {
        return Err(corrupt());
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let entry = reader.entry()?;
        if !admissible(&entries, &entry) {
            return Err(corrupt());
        }
        entries.push(entry);
    }
    if reader.at != bytes.len() {
        return Err(corrupt());
    }
    Ok(entries)
}

/// The §8.2 provider over a platform [`SecretStore`].
pub struct SecureStoreKeyProvider<S: SecretStore> {
    store: S,
    runtime: Vec<(RootKeyRefV1, Zeroizing<[u8; KEY_LEN]>)>,
    /// Indexed routes whose key item was missing at the last unlock (`KEY_LOST`, not unknown).
    lost: Vec<RootKeyRefV1>,
    /// The epoch-to-route bindings observed at unlock (plus this instance's own provisions). They are
    /// immutable, so a durable index that no longer contains one is `RECOVERY_REQUIRED`.
    bindings: Vec<IndexEntry>,
    unlocked: bool,
}

impl<S: SecretStore> SecureStoreKeyProvider<S> {
    pub fn new(store: S) -> Self {
        SecureStoreKeyProvider {
            store,
            runtime: Vec::new(),
            lost: Vec::new(),
            bindings: Vec::new(),
            unlocked: false,
        }
    }

    /// Number of runtime key handles currently held (`0` after [`KeyProvider::lock`]).
    pub fn runtime_key_count(&self) -> usize {
        self.runtime.len()
    }

    /// Bootstrap provisions the scope (in the anchor) before any epoch, so an epoch index next to a
    /// missing anchor, or next to an anchor without a scope, means the scope was lost: it is
    /// `RECOVERY_REQUIRED` and never silently re-provisioned (§5.3.2).
    fn read_anchor(&self) -> Result<AnchorState, KeyProviderError> {
        let anchor = match self.store.get(ANCHOR_ACCOUNT)? {
            Some(bytes) => anchor_codec::decode(&bytes)?,
            None => AnchorState::empty(),
        };
        if anchor.installation_scope_id.is_none() && self.store.get(EPOCH_INDEX_ACCOUNT)?.is_some()
        {
            return Err(corrupt());
        }
        Ok(anchor)
    }

    /// The single durable-authority check every read and write path uses:
    /// 1. the anchor decodes (and its scope is consistent with the index, see `read_anchor`);
    /// 2. the epoch index is valid;
    /// 3. every epoch-to-route binding this instance observed at unlock is still indexed unchanged;
    /// 4. every indexed key item that is present is well-formed (a missing one only makes its own
    ///    epoch `KEY_LOST`; a malformed one is `RECOVERY_REQUIRED`);
    /// 5. a committed root and a prepared target are indexed, and their key items are present
    ///    (`KEY_LOST`) and, if cached, byte-identical to the cache (`RECOVERY_REQUIRED`).
    fn authority(&self) -> Result<Authority, KeyProviderError> {
        self.authority_for(PreparedTarget::Validate)
    }

    /// [`Self::authority`], except that a transition which discards the preparation (abort /
    /// recover) does not require the prepared target it is removing to be intact; the committed
    /// authority it retains is still fully validated.
    fn authority_for(
        &self,
        prepared_target: PreparedTarget,
    ) -> Result<Authority, KeyProviderError> {
        let anchor = self.read_anchor()?;
        let index = self.read_index()?;
        self.check_bindings(&index)?;
        self.check_key_items(&index)?;
        let validate_prepared = prepared_target == PreparedTarget::Validate;
        if let Some(prepared) = anchor
            .prepared_root_commit
            .as_ref()
            .filter(|_| validate_prepared)
        {
            // An anchor that names a prepared target proves that route was issued.
            self.indexed_and_intact(&index, &prepared.target_root_key_ref)?;
        }
        let root = match &anchor.committed_root {
            None => None,
            Some(root) => Some(self.indexed_and_intact(&index, &root.root_key_ref)?),
        };
        Ok(Authority {
            anchor,
            index,
            root,
        })
    }

    /// Every epoch-to-route binding this instance has observed is still indexed unchanged.
    fn check_bindings(&self, index: &[IndexEntry]) -> Result<(), KeyProviderError> {
        let holds = |bound: &IndexEntry| {
            index
                .iter()
                .any(|e| e.epoch == bound.epoch && e.key_ref == bound.key_ref)
        };
        if self.bindings.iter().all(holds) {
            Ok(())
        } else {
            Err(corrupt())
        }
    }

    /// Every present indexed key item is well-formed; a missing one is only its own epoch's loss.
    fn check_key_items(&self, index: &[IndexEntry]) -> Result<(), KeyProviderError> {
        for entry in index {
            match self.read_key(&entry.key_ref) {
                Ok(_) | Err(KeyProviderError::KeyLost) => {}
                Err(other) => return Err(other),
            }
        }
        Ok(())
    }

    /// `route` is indexed (`RECOVERY_REQUIRED` otherwise) and its key item is present and, if cached,
    /// byte-identical.
    fn indexed_and_intact(
        &self,
        index: &[IndexEntry],
        route: &RootKeyRefV1,
    ) -> Result<IndexEntry, KeyProviderError> {
        let entry = index
            .iter()
            .find(|e| &e.key_ref == route)
            .cloned()
            .ok_or_else(corrupt)?;
        self.durable_key_matches_cache(&entry.key_ref)?;
        Ok(entry)
    }

    /// Reads, transitions and — only if the anchor actually changed — replaces the anchor item, so an
    /// exact replay never needs a write.
    fn apply(
        &mut self,
        transition: impl FnOnce(&AnchorState) -> Result<AnchorState, KeyProviderError>,
    ) -> Result<AnchorState, KeyProviderError> {
        self.apply_for(PreparedTarget::Validate, transition)
    }

    fn apply_for(
        &mut self,
        prepared_target: PreparedTarget,
        transition: impl FnOnce(&AnchorState) -> Result<AnchorState, KeyProviderError>,
    ) -> Result<AnchorState, KeyProviderError> {
        let _guard = write_guard();
        let current = self.authority_for(prepared_target)?.anchor;
        let next = transition(&current)?;
        if next != current {
            // Re-validated under the same guard: never publish a root (or preparation) whose key
            // route is no longer issued and present, e.g. after the index was lost since PREPARE.
            self.ensure_routes_resolvable(&next)?;
            let encoded = check_item_len(anchor_codec::encode(&next)?)?;
            self.store.set(ANCHOR_ACCOUNT, &encoded)?;
        }
        Ok(next)
    }

    /// Every route `anchor` references (committed root, prepared target) is issued and its key item
    /// is present.
    fn ensure_routes_resolvable(&self, anchor: &AnchorState) -> Result<(), KeyProviderError> {
        let routes = anchor
            .committed_root
            .iter()
            .map(|root| &root.root_key_ref)
            .chain(
                anchor
                    .prepared_root_commit
                    .iter()
                    .map(|p| &p.target_root_key_ref),
            );
        for route in routes {
            let entry = self.issued(route)?;
            self.durable_key_matches_cache(&entry.key_ref)?;
        }
        Ok(())
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
        if bytes.len() != KEY_LEN {
            return Err(corrupt());
        }
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    fn issued(&self, key_ref: &RootKeyRefV1) -> Result<IndexEntry, KeyProviderError> {
        self.read_index()?
            .into_iter()
            .find(|e| &e.key_ref == key_ref)
            .ok_or(KeyProviderError::UnknownKeyRef)
    }

    /// The durable key item exists and, if this instance cached the route, still holds exactly the
    /// cached bytes (key items are immutable per route: a difference is `RECOVERY_REQUIRED`).
    fn durable_key_matches_cache(&self, key_ref: &RootKeyRefV1) -> Result<(), KeyProviderError> {
        let durable = self.read_key(key_ref)?;
        match self.runtime.iter().find(|(r, _)| r == key_ref) {
            Some((_, cached)) if **cached != *durable => Err(corrupt()),
            _ => Ok(()),
        }
    }

    /// The cached handle for an issued route, re-validated against its durable item: lost at unlock
    /// or missing now is `KEY_LOST`, different bytes are `RECOVERY_REQUIRED` (key items are
    /// immutable per route), and a route this instance never cached is `LOCKED` (re-unlock).
    fn cached_key(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        if self.lost.contains(key_ref) {
            return Err(KeyProviderError::KeyLost);
        }
        let Some((_, material)) = self.runtime.iter().find(|(r, _)| r == key_ref) else {
            return Err(KeyProviderError::Locked);
        };
        let durable = self.read_key(key_ref)?;
        if *durable != **material {
            return Err(corrupt());
        }
        let mut copy = **material;
        Ok(Key::from_bytes(&mut copy))
    }

    /// Resolves a key only while the durable state still backs what this instance unlocked:
    /// 1. the anchor decodes and the index is valid;
    /// 2. every epoch-to-route binding observed at unlock is still indexed unchanged;
    /// 3. the committed root is indexed and its own key item still matches the cache;
    /// 4. only then is the requested entry looked up (`unknown` if absent) and its cached key
    ///    re-validated. Validation always precedes an "unknown" answer.
    fn resolve_validated(
        &self,
        select: impl Fn(&IndexEntry) -> bool,
        unknown: KeyProviderError,
    ) -> Result<Key, KeyProviderError> {
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        let authority = self.authority()?;
        if let Some(root) = &authority.root {
            self.cached_key(&root.key_ref)?;
        }
        let entry = authority
            .index
            .into_iter()
            .find(|e| select(e))
            .ok_or(unknown)?;
        self.cached_key(&entry.key_ref)
    }

    /// The §8.1 state from the shared authority check; every recovery-class failure — including a
    /// malformed root key item — is reported as the `RecoveryRequired` state, not as an error.
    fn authority_state(&self) -> Result<KeyState, KeyProviderError> {
        let root = match self.authority() {
            Ok(authority) => authority.root,
            Err(KeyProviderError::RecoveryRequired) => return Ok(KeyState::RecoveryRequired),
            Err(KeyProviderError::KeyLost) => return Ok(KeyState::KeyLost),
            Err(other) => return Err(other),
        };
        Ok(match root {
            None => KeyState::Unconfigured,
            Some(entry) if self.has_runtime_key(&entry.key_ref) => {
                KeyState::Unlocked { epoch: entry.epoch }
            }
            Some(_) => KeyState::Locked,
        })
    }

    /// Unlocked for this route: its handle is cached. A root committed by another instance after this
    /// provider unlocked therefore reports `Locked` until the caller re-unlocks.
    fn has_runtime_key(&self, key_ref: &RootKeyRefV1) -> bool {
        self.unlocked && self.runtime.iter().any(|(r, _)| r == key_ref)
    }

    /// Adds this instance's own provisioned key to the unlocked snapshot and cache (once).
    fn remember(&mut self, epoch: u64, key_ref: &RootKeyRefV1, material: Zeroizing<[u8; KEY_LEN]>) {
        if !self.unlocked || self.runtime.iter().any(|(r, _)| r == key_ref) {
            return;
        }
        // A route whose item was restored is no longer lost.
        self.lost.retain(|lost| lost != key_ref);
        self.runtime.push((key_ref.clone(), material));
        if !self.bindings.iter().any(|b| &b.key_ref == key_ref) {
            self.bindings.push(IndexEntry {
                epoch,
                key_ref: key_ref.clone(),
            });
        }
    }

    /// Re-validates against the existing snapshot BEFORE replacing it (the cached key bytes and
    /// bindings are authority evidence): the shared check compares the durable root with any cached
    /// root bytes, and every newly loaded key must equal previously cached bytes for its route.
    fn unlock_validated(&mut self) -> Result<KeyState, KeyProviderError> {
        let _guard = write_guard();
        let authority = self.authority()?;
        let loaded = self.load_keys(&authority.index)?;
        for (route, key) in &loaded.runtime {
            let changed = self
                .runtime
                .iter()
                .any(|(cached_route, cached)| cached_route == route && **cached != **key);
            if changed {
                return Err(corrupt());
            }
        }
        if let Some(root) = &authority.root {
            if loaded.lost.contains(&root.key_ref) {
                return Err(KeyProviderError::KeyLost);
            }
        }
        self.runtime = loaded.runtime;
        self.lost = loaded.lost;
        self.bindings = authority.index;
        self.unlocked = true;
        Ok(match authority.root {
            Some(entry) => KeyState::Unlocked { epoch: entry.epoch },
            None => KeyState::Unconfigured,
        })
    }

    /// A random route that is neither indexed nor already backed by a key item, so a repeated draw
    /// can never overwrite existing key material (retried a few times, then refused).
    fn fresh_route(&self, index: &[IndexEntry]) -> Result<RootKeyRefV1, KeyProviderError> {
        for _ in 0..4 {
            let mut route = [0u8; 16];
            OsRandom.fill(&mut route).map_err(random_error)?;
            let key_ref = RootKeyRefV1::new(format!("{ROUTE_PREFIX}{}", hex(&route)).into_bytes())?;
            let indexed = index.iter().any(|e| e.key_ref == key_ref);
            if !indexed && self.store.get(&Self::key_account(&key_ref))?.is_none() {
                return Ok(key_ref);
            }
        }
        Err(KeyProviderError::Unavailable)
    }

    /// Loads every key of `index`; a missing item is recorded as lost, anything else is an error.
    fn load_keys(&self, index: &[IndexEntry]) -> Result<LoadedKeys, KeyProviderError> {
        let mut loaded = LoadedKeys::default();
        for entry in index.iter().cloned() {
            match self.read_key(&entry.key_ref) {
                Ok(key) => loaded.runtime.push((entry.key_ref, key)),
                Err(KeyProviderError::KeyLost) => loaded.lost.push(entry.key_ref),
                Err(other) => return Err(other),
            }
        }
        Ok(loaded)
    }
}

/// Whether an authority check validates the anchor's prepared target (see `authority_for`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum PreparedTarget {
    Validate,
    Discarding,
}

/// The validated durable authority (see `SecureStoreKeyProvider::authority`).
struct Authority {
    anchor: AnchorState,
    index: Vec<IndexEntry>,
    root: Option<IndexEntry>,
}

#[derive(Default)]
struct LoadedKeys {
    runtime: Vec<(RootKeyRefV1, Zeroizing<[u8; KEY_LEN]>)>,
    lost: Vec<RootKeyRefV1>,
}

impl<S: SecretStore> KeyProvider for SecureStoreKeyProvider<S> {
    fn state(&self) -> Result<KeyState, KeyProviderError> {
        self.authority_state()
    }

    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        self.resolve_validated(|e| e.epoch == epoch, KeyProviderError::UnknownEpoch)
    }

    fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.resolve_validated(|e| &e.key_ref == key_ref, KeyProviderError::UnknownKeyRef)
    }

    fn lock(&mut self) {
        // Dropping each Zeroizing handle clears its bytes.
        // The non-secret epoch-to-route bindings are kept for this instance's lifetime, so a later
        // re-unlock can never adopt a swapped index as a fresh snapshot.
        self.runtime.clear();
        self.lost.clear();
        self.unlocked = false;
    }

    /// The provider is locked first and every check runs before runtime handles are installed, so a
    /// failed unlock leaves no runtime key handles.
    /// Any failure leaves the provider locked with no runtime key handles.
    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        let result = self.unlock_validated();
        if result.is_err() {
            self.lock();
        }
        result
    }

    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        // Diagnostics answer with the same error precedence as every other path; a lost root key
        // is still listable (that is what the listing reports).
        let index = match self.authority() {
            Ok(authority) => authority.index,
            Err(KeyProviderError::KeyLost) => self.read_index()?,
            Err(other) => return Err(other),
        };
        let mut out = Vec::new();
        for entry in index {
            let available = match self.read_key(&entry.key_ref) {
                Ok(_) => true,
                Err(KeyProviderError::KeyLost) => false,
                Err(other) => return Err(other),
            };
            out.push(EpochInfo {
                epoch: entry.epoch,
                key_ref: entry.key_ref,
                available,
            });
        }
        Ok(out)
    }

    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        let _guard = write_guard();
        // The shared authority check refuses an unindexed, lost, malformed or replaced root key and
        // broken unlock bindings, so provisioning never extends an authority `state()` refuses; the
        // scope must exist first (§5.3.2 bootstrap order), or an index would outlive its anchor.
        let authority = self.authority()?;
        if authority.anchor.installation_scope_id.is_none() {
            return Err(KeyProviderError::AnchorConflict(
                "the installation scope must be provisioned first",
            ));
        }
        let mut index = authority.index;
        if epoch == 0 || epoch == u64::MAX {
            return Err(KeyProviderError::AnchorConflict("epoch is unassigned"));
        }
        // Resumable (§10.2): a crash after the index write but before the route reached the caller
        // must not strand bootstrap. An epoch that is already indexed with an intact key item
        // returns its existing route; nothing is rewritten.
        if let Some(existing) = index.iter().find(|e| e.epoch == epoch) {
            // "Intact" includes matching this instance's cache: a replaced item is not resumed.
            self.durable_key_matches_cache(&existing.key_ref)?;
            let key = self.read_key(&existing.key_ref)?;
            let key_ref = existing.key_ref.clone();
            self.remember(epoch, &key_ref, key);
            return Ok(key_ref);
        }
        // Refuse before anything is written, so a full index never leaves an orphaned key item.
        if index.len() >= MAX_INDEXED_EPOCHS {
            return Err(KeyProviderError::AnchorConflict("the epoch index is full"));
        }
        let key_ref = self.fresh_route(&index)?;
        let mut material = Zeroizing::new([0u8; KEY_LEN]);
        OsRandom.fill(material.as_mut()).map_err(random_error)?;
        index.push(IndexEntry {
            epoch,
            key_ref: key_ref.clone(),
        });
        let encoded_index = encode_index(&index)?;
        // Key first, then index: a crash in between leaves only an unreferenced item.
        self.store
            .set(&Self::key_account(&key_ref), material.as_ref())?;
        self.store.set(EPOCH_INDEX_ACCOUNT, &encoded_index)?;
        self.remember(epoch, &key_ref, material);
        Ok(key_ref)
    }

    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        // The shared authority check validates the index even before the first root commits, so
        // corrupted control state is never returned as an ordinary bootstrap anchor.
        self.authority().map(|authority| authority.anchor)
    }

    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        // The shared check runs first so a broken installation is never answered with its scope;
        // a lost key is tolerated because the non-secret scope is still needed for recovery.
        match self.authority() {
            Ok(_) | Err(KeyProviderError::KeyLost) => {}
            Err(other) => return Err(other),
        }
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
        // The current authority is validated first, so a broken installation is always reported as
        // such rather than as an ordinary unknown target route.
        self.authority()?;
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
        // Discarding a preparation must not require its target to be intact: a lost prepared key is
        // exactly a case the retained committed authority recovers from (§5.3.1).
        self.apply_for(PreparedTarget::Discarding, |state| {
            anchor::abort_or_recover(state, operation_id)
        })
        .map(|_| ())
    }
}
