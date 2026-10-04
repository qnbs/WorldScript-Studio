//! Headless in-memory [`KeyProvider`] with fault injection (§16 "fake key provider"). It stands in
//! for a platform secure store in tests only and is compiled only with the `test-support` feature.

use zeroize::Zeroizing;

use crate::anchor;
use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, EpochInfo, InstallationScopeId, KeyProvider, KeyState, PrepareRootAnchor,
    RootKeyRefV1, SessionBinding,
};
use crate::random::{OsRandom, RandomSource, RandomnessUnavailable};
use crate::seal::Key;

/// Anchor operations a test can make fail, before or after the secure store persists the change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorOp {
    Provision,
    Prepare,
    Commit,
    Abort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fault {
    /// The store rejects the write: state is unchanged and the caller sees `Unavailable`.
    BeforePersist(AnchorOp),
    /// The write lands but the caller still sees `Unavailable` (ambiguous outcome); the caller
    /// must re-read the anchor to reconcile.
    AfterPersist(AnchorOp),
}

/// The provider's randomness, switchable to failing in tests.
#[derive(Clone, Copy)]
enum ScopeRandom {
    Os,
    Failing,
}

impl RandomSource for ScopeRandom {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        match self {
            ScopeRandom::Os => OsRandom.fill(buf),
            ScopeRandom::Failing => Err(RandomnessUnavailable),
        }
    }
}

struct StoredKey {
    epoch: u64,
    key_ref: RootKeyRefV1,
    material: Zeroizing<[u8; 32]>,
}

/// In-memory stand-in for a platform secure store.
pub struct MemoryKeyProvider {
    anchor: AnchorState,
    store: Vec<StoredKey>,
    runtime: Vec<(RootKeyRefV1, Zeroizing<[u8; 32]>)>,
    unlocked: bool,
    session_binding: Option<SessionBinding>,
    available: bool,
    lost: bool,
    fault: Option<Fault>,
    next_ref: u64,
    random: ScopeRandom,
}

impl Default for MemoryKeyProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryKeyProvider {
    pub fn new() -> Self {
        MemoryKeyProvider {
            anchor: AnchorState::empty(),
            store: Vec::new(),
            runtime: Vec::new(),
            unlocked: false,
            session_binding: None,
            available: true,
            lost: false,
            fault: None,
            next_ref: 1,
            random: ScopeRandom::Os,
        }
    }

    /// Simulates a platform without the required secure store (e.g. no Secret Service).
    pub fn set_available(&mut self, available: bool) {
        self.available = available;
    }

    /// Simulates the secure store losing its key material (e.g. a wiped keychain).
    pub fn lose_keys(&mut self) {
        self.store.clear();
        self.runtime.clear();
        self.session_binding = None;
        self.lost = true;
    }

    /// Makes the provider's CSPRNG fail, to prove which operations need fresh randomness.
    pub fn set_randomness_available(&mut self, available: bool) {
        self.random = if available {
            ScopeRandom::Os
        } else {
            ScopeRandom::Failing
        };
    }

    /// Arms one fault for the next matching anchor operation.
    pub fn inject(&mut self, fault: Fault) {
        self.fault = Some(fault);
    }

    /// Number of runtime key handles currently held (`0` after [`KeyProvider::lock`]).
    pub fn runtime_key_count(&self) -> usize {
        self.runtime.len()
    }

    fn ensure_available(&self) -> Result<(), KeyProviderError> {
        if self.available {
            Ok(())
        } else {
            Err(KeyProviderError::SecureAnchorUnavailable)
        }
    }

    fn take_fault(&mut self, op: AnchorOp) -> Option<Fault> {
        match self.fault {
            Some(Fault::BeforePersist(o)) | Some(Fault::AfterPersist(o)) if o == op => {
                self.fault.take()
            }
            _ => None,
        }
    }

    /// A data epoch is `1..u64::MAX` (§5.4) and gets exactly one key.
    fn epoch_is_provisionable(&self, epoch: u64) -> bool {
        let assigned = epoch != 0 && epoch != u64::MAX;
        assigned && self.store.iter().all(|k| k.epoch != epoch)
    }

    /// A preparation may only name a route this provider issued and still holds (§5.3.1: the next
    /// cold start resolves exactly that route).
    fn ensure_issued_route(&self, key_ref: &RootKeyRefV1) -> Result<(), KeyProviderError> {
        if self.lost {
            return Err(KeyProviderError::KeyLost);
        }
        if self.store.iter().any(|k| &k.key_ref == key_ref) {
            Ok(())
        } else {
            Err(KeyProviderError::UnknownKeyRef)
        }
    }

    /// Applies one anchor transition the way a real adapter would: compute, persist, report.
    fn apply(
        &mut self,
        op: AnchorOp,
        transition: impl FnOnce(&AnchorState) -> Result<AnchorState, KeyProviderError>,
    ) -> Result<(), KeyProviderError> {
        self.ensure_available()?;
        let fault = self.take_fault(op);
        if fault == Some(Fault::BeforePersist(op)) {
            return Err(KeyProviderError::Unavailable);
        }
        self.anchor = transition(&self.anchor)?;
        if fault == Some(Fault::AfterPersist(op)) {
            return Err(KeyProviderError::Unavailable);
        }
        Ok(())
    }

    fn ensure_readable(&self) -> Result<(), KeyProviderError> {
        self.ensure_available()?;
        if self.lost {
            return Err(KeyProviderError::KeyLost);
        }
        if !self.unlocked {
            return Err(KeyProviderError::Locked);
        }
        Ok(())
    }

    fn runtime_key(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.ensure_readable()?;
        let (_, material) = self
            .runtime
            .iter()
            .find(|(r, _)| r == key_ref)
            .ok_or(KeyProviderError::UnknownKeyRef)?;
        let mut copy = **material;
        Ok(Key::from_bytes(&mut copy))
    }
}

impl KeyProvider for MemoryKeyProvider {
    fn session_binding(&self) -> Option<SessionBinding> {
        self.session_binding.clone()
    }

    fn state(&self) -> Result<KeyState, KeyProviderError> {
        let anchor = match self.read_root_anchor_state() {
            Ok(anchor) => anchor,
            Err(KeyProviderError::RecoveryRequired) => return Ok(KeyState::RecoveryRequired),
            Err(other) => return Err(other),
        };
        let Some(root) = anchor.committed_root else {
            // Scope and bootstrap keys may already exist, but no root is published yet (§5.3.2).
            return Ok(KeyState::Unconfigured);
        };
        if self.lost {
            return Ok(KeyState::KeyLost);
        }
        if !self.unlocked {
            return Ok(KeyState::Locked);
        }
        Ok(
            match self.store.iter().find(|k| k.key_ref == root.root_key_ref) {
                Some(key) => KeyState::Unlocked { epoch: key.epoch },
                None => KeyState::RecoveryRequired,
            },
        )
    }

    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        // Availability, loss and lock are decided before the store is consulted, so an inaccessible
        // store never reports an epoch as unknown.
        self.ensure_readable()?;
        let key_ref = self
            .store
            .iter()
            .find(|k| k.epoch == epoch)
            .map(|k| k.key_ref.clone())
            .ok_or(KeyProviderError::UnknownEpoch)?;
        self.runtime_key(&key_ref)
    }

    fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.runtime_key(key_ref)
    }

    fn lock(&mut self) {
        // Dropping each Zeroizing handle clears its bytes.
        self.runtime.clear();
        self.unlocked = false;
        self.session_binding = None;
    }

    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        self.lock();
        self.ensure_available()?;
        if self.lost {
            return Err(KeyProviderError::KeyLost);
        }
        let anchor = self.read_root_anchor_state()?;
        self.runtime = self
            .store
            .iter()
            .map(|k| (k.key_ref.clone(), k.material.clone()))
            .collect();
        self.unlocked = true;
        let state = match self.state() {
            Ok(state @ (KeyState::Unlocked { .. } | KeyState::Unconfigured)) => state,
            outcome => {
                self.lock();
                return Err(match outcome {
                    Err(error) => error,
                    Ok(_) => KeyProviderError::RecoveryRequired,
                });
            }
        };
        self.session_binding = anchor
            .installation_scope_id
            .zip(anchor.committed_root)
            .map(|(scope, root)| SessionBinding { scope, root });
        Ok(state)
    }

    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        self.ensure_available()?;
        Ok(self
            .store
            .iter()
            .map(|k| EpochInfo {
                epoch: k.epoch,
                key_ref: k.key_ref.clone(),
                available: !self.lost,
            })
            .collect())
    }

    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        self.ensure_available()?;
        if !self.epoch_is_provisionable(epoch) {
            return Err(KeyProviderError::AnchorConflict(
                "epoch is unassigned or already provisioned",
            ));
        }
        let mut material = Zeroizing::new([0u8; 32]);
        self.random
            .fill(material.as_mut())
            .map_err(|_| KeyProviderError::RandomnessUnavailable)?;
        let key_ref =
            RootKeyRefV1::new(format!("memory-key-route-{}", self.next_ref).into_bytes())?;
        self.next_ref += 1;
        if self.unlocked {
            self.runtime.push((key_ref.clone(), material.clone()));
        }
        self.store.push(StoredKey {
            epoch,
            key_ref: key_ref.clone(),
            material,
        });
        Ok(key_ref)
    }

    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        self.ensure_available()?;
        anchor::validate(&self.anchor)?;
        Ok(self.anchor.clone())
    }

    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        self.ensure_available()?;
        // §5.3.2: reading an existing scope needs no randomness and changes nothing.
        if let Some(scope) = anchor::existing_installation_scope(&self.anchor)? {
            return Ok(scope);
        }
        let mut bits = [0u8; 16];
        self.random
            .fill(&mut bits)
            .map_err(|_| KeyProviderError::RandomnessUnavailable)?;
        let mut scope = None;
        self.apply(AnchorOp::Provision, |state| {
            let (next, provisioned) = anchor::provision_installation_scope(state, bits)?;
            scope = Some(provisioned);
            Ok(next)
        })?;
        scope.ok_or(KeyProviderError::Unavailable)
    }

    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError> {
        self.ensure_available()?;
        self.ensure_issued_route(&request.target_root_key_ref)?;
        self.apply(AnchorOp::Prepare, |state| anchor::prepare(state, request))
    }

    fn commit_root_anchor(
        &mut self,
        operation_id: &str,
        target_root_generation: u64,
    ) -> Result<(), KeyProviderError> {
        self.apply(AnchorOp::Commit, |state| {
            anchor::commit(state, operation_id, target_root_generation)
        })?;
        if self.unlocked {
            self.session_binding = self
                .anchor
                .installation_scope_id
                .clone()
                .zip(self.anchor.committed_root.clone())
                .map(|(scope, root)| SessionBinding { scope, root });
        }
        Ok(())
    }

    fn abort_or_recover_root_anchor(&mut self, operation_id: &str) -> Result<(), KeyProviderError> {
        self.apply(AnchorOp::Abort, |state| {
            anchor::abort_or_recover(state, operation_id)
        })
    }
}
