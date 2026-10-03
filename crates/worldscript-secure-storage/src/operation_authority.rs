//! One Core authority cell: snapshot capture/pin and step-F publication share this mutex.
//! No key is retained in the current snapshot cell; operation keys are zeroized before admission
//! is released. Cross-process reader lifetime is additionally protected by shared admission:
//! reclamation requires exclusive admission, so another process cannot reclaim a live read.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use crate::anchor;
use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, CommittedRoot, EpochInfo, InstallationScopeId, KeyProvider, KeyState,
    PrepareRootAnchor, RootKeyRefV1,
};
use crate::seal::Key;

pub(crate) struct AuthorityCell<P> {
    pub(crate) provider: P,
    current: Option<Arc<Snapshot>>,
    namespace: Arc<()>,
}

pub(crate) struct Snapshot {
    pub(crate) scope: InstallationScopeId,
    pub(crate) root: CommittedRoot,
    namespace: Arc<()>,
}

/// Non-authorizing retention observation, not permission to delete bytes. A future collector must
/// also prove durable current/previous/prepared retention and every other recovery reason.
pub struct SnapshotRetention {
    pub(crate) generation: u64,
    pub(crate) scope: InstallationScopeId,
    handle: Weak<Snapshot>,
    namespace: Weak<()>,
}

impl SnapshotRetention {
    pub fn root_generation(&self) -> u64 {
        self.generation
    }

    /// Conservative: includes the current cell's own reference while this root is current.
    pub fn is_referenced(&self) -> bool {
        self.handle.strong_count() != 0
    }
}

impl fmt::Debug for SnapshotRetention {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SnapshotRetention")
            .field("root_generation", &self.generation)
            .field("referenced", &self.is_referenced())
            .finish_non_exhaustive()
    }
}

impl Snapshot {
    fn accepts(&self, scope: &InstallationScopeId, root: &CommittedRoot) -> bool {
        if &self.scope != scope {
            return false;
        }
        match root.root_generation.cmp(&self.root.root_generation) {
            std::cmp::Ordering::Less => false,
            std::cmp::Ordering::Equal => root == &self.root,
            std::cmp::Ordering::Greater => true,
        }
    }
    pub(crate) fn retention(this: &Arc<Self>) -> SnapshotRetention {
        SnapshotRetention {
            generation: this.root.root_generation,
            scope: this.scope.clone(),
            handle: Arc::downgrade(this),
            namespace: Arc::downgrade(&this.namespace),
        }
    }
}

impl<P: KeyProvider> AuthorityCell<P> {
    pub(crate) fn new(provider: P) -> Self {
        Self {
            provider,
            current: None,
            namespace: Arc::new(()),
        }
    }

    /// Called only under the cell mutex. Capture and Arc::clone cannot race a local step F.
    pub(crate) fn capture(&mut self) -> Result<(Arc<Snapshot>, Key), KeyProviderError> {
        self.capture_pinned(|| {})
    }

    fn capture_pinned(
        &mut self,
        before_pin: impl FnOnce(),
    ) -> Result<(Arc<Snapshot>, Key), KeyProviderError> {
        match self.provider.state()? {
            KeyState::Unlocked { .. } => {}
            KeyState::Locked => return Err(KeyProviderError::Locked),
            KeyState::KeyLost => return Err(KeyProviderError::KeyLost),
            _ => return Err(KeyProviderError::RecoveryRequired),
        }
        let anchor = self.provider.read_root_anchor_state()?;
        self.publish(&anchor)?;
        // Private seam for proving the exact capture-to-pin window while the cell remains held.
        before_pin();
        let snapshot = self
            .current
            .as_ref()
            .cloned()
            .ok_or(KeyProviderError::RecoveryRequired)?;
        // Only the anchor route, never a route/epoch supplied by the caller or filesystem header.
        let key = self.provider.resolve_ref(&snapshot.root.root_key_ref)?;
        Ok((snapshot, key))
    }

    pub(crate) fn publish(&mut self, anchor: &AnchorState) -> Result<(), KeyProviderError> {
        anchor::validate(anchor)?;
        let (Some(scope), Some(root)) = (&anchor.installation_scope_id, &anchor.committed_root)
        else {
            if self.current.is_some() {
                return Err(KeyProviderError::RecoveryRequired);
            }
            return Ok(());
        };
        if let Some(current) = &self.current {
            if !current.accepts(scope, root) {
                return Err(KeyProviderError::RecoveryRequired);
            }
            if root == &current.root {
                return Ok(());
            }
        }
        self.current = Some(Arc::new(Snapshot {
            scope: scope.clone(),
            root: root.clone(),
            namespace: self.namespace.clone(),
        }));
        Ok(())
    }

    pub(crate) fn owns_retention(&self, witness: &SnapshotRetention) -> bool {
        Weak::ptr_eq(&witness.namespace, &Arc::downgrade(&self.namespace))
    }
}

pub(crate) fn lock_cell<P>(
    cell: &Mutex<AuthorityCell<P>>,
) -> Result<MutexGuard<'_, AuthorityCell<P>>, KeyProviderError> {
    cell.lock().map_err(|_| KeyProviderError::RecoveryRequired)
}

/// Private mechanism adapter. Core constructs it only beneath operation admission. Each store
/// call is short; filesystem staging never holds the authority-cell mutex. In particular, readers
/// may capture the prior snapshot during C/E; only F's store write + current replacement are atomic.
pub(crate) struct PublishedProvider<'a, P>(pub(crate) &'a Mutex<AuthorityCell<P>>);

impl<P: KeyProvider> PublishedProvider<'_, P> {
    fn commit_with_refresh(
        &mut self,
        operation: &str,
        generation: u64,
        after_commit: impl FnOnce(&mut P),
    ) -> Result<(), KeyProviderError> {
        let mut cell = lock_cell(self.0)?;
        let result = cell.provider.commit_root_anchor(operation, generation);
        // Private fault seam: tests can make the refresh fail after the actual durable attempt.
        after_commit(&mut cell.provider);
        let refreshed = cell
            .provider
            .read_root_anchor_state()
            .and_then(|anchor| cell.publish(&anchor));
        match result {
            Err(original) => Err(original),
            Ok(()) => refreshed.map_err(|_| KeyProviderError::CommittedRefreshRequired),
        }
    }
}

impl<P: KeyProvider> KeyProvider for PublishedProvider<'_, P> {
    fn state(&self) -> Result<KeyState, KeyProviderError> {
        lock_cell(self.0)?.provider.state()
    }
    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        lock_cell(self.0)?.provider.resolve(epoch)
    }
    fn resolve_ref(&self, route: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        lock_cell(self.0)?.provider.resolve_ref(route)
    }
    fn lock(&mut self) {
        // Poison still refuses every future observation. Cleanup alone may access the provider:
        // never leave runtime keys loaded merely because a prior operation unwound under this mutex.
        let mut cell = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        cell.provider.lock();
    }
    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        lock_cell(self.0)?.provider.unlock()
    }
    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        lock_cell(self.0)?.provider.list_epochs()
    }
    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        lock_cell(self.0)?.provider.provision_epoch_key(epoch)
    }
    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        lock_cell(self.0)?.provider.read_root_anchor_state()
    }
    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        lock_cell(self.0)?
            .provider
            .read_or_provision_installation_scope()
    }
    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError> {
        lock_cell(self.0)?.provider.prepare_root_anchor(request)
    }
    fn commit_root_anchor(
        &mut self,
        operation: &str,
        generation: u64,
    ) -> Result<(), KeyProviderError> {
        self.commit_with_refresh(operation, generation, |_| {})
    }
    fn abort_or_recover_root_anchor(&mut self, operation: &str) -> Result<(), KeyProviderError> {
        lock_cell(self.0)?
            .provider
            .abort_or_recover_root_anchor(operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_provider::MemoryKeyProvider;
    use crate::memory_provider::{AnchorOp, Fault};
    use crate::provider::RootSlot;
    use std::sync::{mpsc, TryLockError};
    use std::thread;
    use std::time::Duration;

    fn request(route: &RootKeyRefV1, floor: u64) -> PrepareRootAnchor {
        PrepareRootAnchor {
            operation_id: format!("cell-publication-{}", floor + 1),
            expected_floor: floor,
            target_root_generation: floor + 1,
            target_final_root_digest: [floor as u8 + 1; 32],
            target_slot: if floor % 2 == 0 {
                RootSlot::A
            } else {
                RootSlot::B
            },
            target_root_key_ref: route.clone(),
        }
    }

    fn configured() -> (MemoryKeyProvider, RootKeyRefV1) {
        let mut provider = MemoryKeyProvider::new();
        provider.read_or_provision_installation_scope().unwrap();
        let route = provider.provision_epoch_key(1).unwrap();
        provider.unlock().unwrap();
        let first = request(&route, 0);
        provider.prepare_root_anchor(&first).unwrap();
        provider.commit_root_anchor(&first.operation_id, 1).unwrap();
        (provider, route)
    }

    #[test]
    fn commit_error_is_preserved_and_durable_success_is_not_reported_as_uncommitted() {
        for fault in [
            None,
            Some(Fault::BeforePersist(AnchorOp::Commit)),
            Some(Fault::AfterPersist(AnchorOp::Commit)),
        ] {
            let (mut provider, route) = configured();
            let next = request(&route, 1);
            provider.prepare_root_anchor(&next).unwrap();
            if let Some(fault) = fault {
                provider.inject(fault);
            }
            let cell = Mutex::new(AuthorityCell::new(provider));
            let error = PublishedProvider(&cell)
                .commit_with_refresh(&next.operation_id, 2, |provider| {
                    provider.set_available(false)
                })
                .unwrap_err();
            assert_eq!(
                error,
                if fault.is_none() {
                    KeyProviderError::CommittedRefreshRequired
                } else {
                    KeyProviderError::Unavailable
                }
            );
            assert!(lock_cell(&cell).unwrap().capture().is_err());
            let mut state = lock_cell(&cell).unwrap();
            state.provider.set_available(true);
            let floor = state
                .provider
                .read_root_anchor_state()
                .unwrap()
                .committed_floor;
            assert_eq!(
                floor,
                if fault == Some(Fault::BeforePersist(AnchorOp::Commit)) {
                    1
                } else {
                    2
                }
            );
            let (snapshot, _) = state.capture().unwrap();
            assert_eq!(snapshot.root.root_generation, floor);
        }
    }

    #[test]
    fn capture_to_pin_is_atomic_with_step_f_and_old_handle_stays_live() {
        let (provider, route) = configured();
        let cell = Arc::new(Mutex::new(AuthorityCell::new(provider)));
        let (paused_tx, paused_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let reader_cell = cell.clone();
        let reader = thread::spawn(move || {
            lock_cell(&reader_cell)
                .unwrap()
                .capture_pinned(|| {
                    paused_tx.send(()).unwrap();
                    resume_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                })
                .unwrap()
        });
        paused_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(matches!(cell.try_lock(), Err(TryLockError::WouldBlock)));
        let writer_cell = cell.clone();
        let writer = thread::spawn(move || {
            let mut published = PublishedProvider(&writer_cell);
            let next = request(&route, 1);
            published.prepare_root_anchor(&next).unwrap();
            published.commit_root_anchor(&next.operation_id, 2).unwrap();
        });
        resume_tx.send(()).unwrap();
        let (old, key) = reader.join().unwrap();
        writer.join().unwrap();
        assert_eq!(old.root.root_generation, 1);
        assert_eq!(
            lock_cell(&cell)
                .unwrap()
                .current
                .as_ref()
                .unwrap()
                .root
                .root_generation,
            2
        );
        let witness = Snapshot::retention(&old);
        assert!(witness.is_referenced());
        drop(key);
        drop(old);
        assert!(!witness.is_referenced());
    }

    #[test]
    fn poisoned_cell_still_clears_keys_without_restoring_observation_authority() {
        let (provider, _) = configured();
        let cell = Mutex::new(AuthorityCell::new(provider));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _held = cell.lock().unwrap();
            panic!("injected authority cell unwind");
        }))
        .is_err());
        PublishedProvider(&cell).lock();
        assert!(matches!(
            lock_cell(&cell),
            Err(KeyProviderError::RecoveryRequired)
        ));
        let poisoned = match cell.lock() {
            Err(poison) => poison.into_inner(),
            Ok(_) => panic!("cleanup must not clear poison"),
        };
        assert_eq!(poisoned.provider.state().unwrap(), KeyState::Locked);
    }

    #[test]
    fn restarted_cell_has_no_persisted_pins_and_rebuilds_from_anchor_only() {
        let (provider, route) = configured();
        let mut prior = AuthorityCell::new(provider);
        let (snapshot, key) = prior.capture().unwrap();
        let old_witness = Snapshot::retention(&snapshot);
        let next = request(&route, 1);
        prior.provider.prepare_root_anchor(&next).unwrap();
        prior
            .provider
            .commit_root_anchor(&next.operation_id, 2)
            .unwrap();
        let anchor = prior.provider.read_root_anchor_state().unwrap();
        prior.publish(&anchor).unwrap();
        drop(key);
        drop(snapshot);
        assert!(!old_witness.is_referenced());
        let mut durable_provider = prior.provider;
        durable_provider.lock();
        durable_provider.unlock().unwrap();
        let mut restarted = AuthorityCell::new(durable_provider);
        assert!(restarted.current.is_none());
        assert!(!restarted.owns_retention(&old_witness));
        let (current, _) = restarted.capture().unwrap();
        assert_eq!(current.root.root_generation, 2);
        assert_eq!(restarted.provider.read_root_anchor_state().unwrap(), anchor);
    }
}
