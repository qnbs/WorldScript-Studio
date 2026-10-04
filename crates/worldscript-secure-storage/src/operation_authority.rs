//! One Core authority cell: snapshot capture/pin and step-F publication share this mutex.
//! No key is retained in the current snapshot cell; operation keys are zeroized before admission
//! is released. Cross-process reader lifetime is additionally protected by shared admission:
//! reclamation requires exclusive admission, so another process cannot reclaim a live read.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use crate::anchor;
use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, CommittedRoot, InstallationScopeId, KeyProvider, KeyState, SessionBinding,
};
use crate::seal::Key;

pub(crate) struct AuthorityCell<P> {
    pub(crate) provider: P,
    current: Option<Arc<Snapshot>>,
    // Only an automatic rebind may retain this non-authorizing prior session evidence. The
    // provider is private; future coordinator lifecycle locking must also discard this retry.
    rebind_retry: Option<SessionBinding>,
}

pub(crate) struct Snapshot {
    pub(crate) scope: InstallationScopeId,
    pub(crate) root: CommittedRoot,
}

/// Non-authorizing retention observation, not permission to delete bytes. A future collector must
/// also prove durable current/previous/prepared retention and every other recovery reason.
pub struct SnapshotRetention {
    pub(crate) generation: u64,
    handle: Weak<Snapshot>,
}

impl SnapshotRetention {
    pub fn root_generation(&self) -> u64 {
        self.generation
    }

    /// This witness's local reference observation only, including the current cell's reference.
    /// It does not prove caller ownership, root scope or reclamation eligibility.
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

    fn allows_same_key_forward(&self, anchor: &AnchorState) -> Result<bool, KeyProviderError> {
        anchor::validate(anchor)?;
        let (Some(scope), Some(root)) = (&anchor.installation_scope_id, &anchor.committed_root)
        else {
            return Ok(false);
        };
        Ok(self.scope == *scope
            && root.root_generation > self.root.root_generation
            && root.root_key_ref == self.root.root_key_ref)
    }

    pub(crate) fn retention(this: &Arc<Self>) -> SnapshotRetention {
        SnapshotRetention {
            generation: this.root.root_generation,
            handle: Arc::downgrade(this),
        }
    }
}

impl<P: KeyProvider> AuthorityCell<P> {
    pub(crate) fn new(provider: P) -> Self {
        Self {
            provider,
            current: None,
            rebind_retry: None,
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
        self.capture_interleaved(|| {}, || {}, before_pin)
    }

    fn capture_interleaved(
        &mut self,
        after_state: impl FnOnce(),
        after_resolve: impl FnOnce(),
        before_pin: impl FnOnce(),
    ) -> Result<(Arc<Snapshot>, Key), KeyProviderError> {
        let state = self.provider.state()?;
        match state {
            KeyState::Unlocked { .. } | KeyState::Locked => {}
            KeyState::KeyLost => return Err(KeyProviderError::KeyLost),
            _ => return Err(KeyProviderError::RecoveryRequired),
        }
        after_state();
        let anchor = self.provider.read_root_anchor_state()?;
        anchor::validate(&anchor)?;
        let (Some(scope), Some(root)) = (&anchor.installation_scope_id, &anchor.committed_root)
        else {
            return Err(KeyProviderError::RecoveryRequired);
        };
        if let Some(current) = &self.current {
            if !current.accepts(scope, root) {
                return Err(KeyProviderError::RecoveryRequired);
            }
            if root.root_key_ref != current.root.root_key_ref {
                return Err(KeyProviderError::Locked);
            }
        }
        let binding = self
            .provider
            .session_binding()
            .or_else(|| self.rebind_retry.clone())
            .ok_or(KeyProviderError::Locked)?;
        let baseline = Snapshot {
            scope: binding.scope,
            root: binding.root,
        };
        if !baseline.accepts(scope, root) {
            return Err(KeyProviderError::RecoveryRequired);
        }
        if root.root_key_ref != baseline.root.root_key_ref {
            return Err(KeyProviderError::Locked);
        }
        if root != &baseline.root {
            if !self.rebind_locked_same_key_forward(&anchor)? {
                return Err(KeyProviderError::Locked);
            }
        } else if state == KeyState::Locked {
            return Err(KeyProviderError::Locked);
        }
        // Resolve before publication: a state-to-anchor race must not poison the current cell.
        let key = match self.provider.resolve_ref(&root.root_key_ref) {
            Err(KeyProviderError::Locked) if self.rebind_locked_same_key_forward(&anchor)? => {
                self.provider.resolve_ref(&root.root_key_ref)?
            }
            result => result?,
        };
        after_resolve();
        if !anchor::same_read_authority(&anchor, &self.provider.read_root_anchor_state()?)? {
            return Err(KeyProviderError::RecoveryRequired);
        }
        self.publish(&anchor)?;
        self.rebind_retry = None;
        // Private seam for proving the exact capture-to-pin window while the cell remains held.
        before_pin();
        let snapshot = self
            .current
            .as_ref()
            .cloned()
            .ok_or(KeyProviderError::RecoveryRequired)?;
        Ok((snapshot, key))
    }

    /// An externally committed ordinary write invalidates a runtime's exact session binding. The
    /// coordinator may rebind only to a validated, same-route forward root while shared admission
    /// is already live; rotation, rollback, explicit lock, and any concurrent change refuse.
    fn rebind_locked_same_key_forward(
        &mut self,
        before: &AnchorState,
    ) -> Result<bool, KeyProviderError> {
        self.rebind_interleaved(before, || {})
    }

    fn rebind_interleaved(
        &mut self,
        before: &AnchorState,
        before_unlock: impl FnOnce(),
    ) -> Result<bool, KeyProviderError> {
        let Some(binding) = self
            .provider
            .session_binding()
            .or_else(|| self.rebind_retry.clone())
        else {
            return Ok(false);
        };
        let baseline = Snapshot {
            scope: binding.scope.clone(),
            root: binding.root.clone(),
        };
        if !baseline.allows_same_key_forward(before)? {
            return Ok(false);
        }
        self.rebind_retry = Some(binding);
        before_unlock();
        match self.provider.unlock() {
            Ok(KeyState::Unlocked { .. }) => {}
            Ok(KeyState::KeyLost) => {
                self.provider.lock();
                return Err(KeyProviderError::KeyLost);
            }
            Ok(_) => {
                self.provider.lock();
                return Err(KeyProviderError::RecoveryRequired);
            }
            Err(error) => {
                self.provider.lock();
                return Err(error);
            }
        }
        let after = match self.provider.read_root_anchor_state() {
            Ok(anchor) => anchor,
            Err(error) => {
                self.provider.lock();
                return Err(error);
            }
        };
        match anchor::same_read_authority(before, &after) {
            Ok(true) => Ok(true),
            outcome => {
                self.provider.lock();
                Err(outcome.err().unwrap_or(KeyProviderError::RecoveryRequired))
            }
        }
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
        }));
        Ok(())
    }
}

pub(crate) fn lock_cell<P>(
    cell: &Mutex<AuthorityCell<P>>,
) -> Result<MutexGuard<'_, AuthorityCell<P>>, KeyProviderError> {
    cell.lock().map_err(|_| KeyProviderError::RecoveryRequired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_provider::MemoryKeyProvider;
    use crate::provider::{PrepareRootAnchor, RootKeyRefV1, RootSlot};
    use crate::secure_store::MemorySecretStore;
    use crate::store_authority::SecureStoreAuthority;
    use crate::store_runtime::SecureStoreRuntime;
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

    fn shared_runtimes() -> (
        SecureStoreRuntime<MemorySecretStore>,
        SecureStoreRuntime<MemorySecretStore>,
        RootKeyRefV1,
    ) {
        let (writer, reader, route, _) = shared_runtimes_with_store();
        (writer, reader, route)
    }

    fn shared_runtimes_with_store() -> (
        SecureStoreRuntime<MemorySecretStore>,
        SecureStoreRuntime<MemorySecretStore>,
        RootKeyRefV1,
        MemorySecretStore,
    ) {
        let store = MemorySecretStore::new();
        let mut writer = SecureStoreRuntime::new(SecureStoreAuthority::new(store.clone()));
        writer.read_or_provision_installation_scope().unwrap();
        let route = writer.provision_epoch_key(1).unwrap();
        writer.unlock().unwrap();
        let first = request(&route, 0);
        writer.prepare_root_anchor(&first).unwrap();
        writer.commit_root_anchor(&first.operation_id, 1).unwrap();

        let mut reader = SecureStoreRuntime::new(SecureStoreAuthority::new(store.clone()));
        assert!(matches!(reader.unlock(), Ok(KeyState::Unlocked { .. })));
        (writer, reader, route, store)
    }

    #[test]
    fn failed_automatic_rebind_keeps_only_a_same_key_forward_retry_witness() {
        let (mut writer, reader, route, store) = shared_runtimes_with_store();
        let mut cell = AuthorityCell::new(reader);
        let next = request(&route, 1);
        writer.prepare_root_anchor(&next).unwrap();
        writer.commit_root_anchor(&next.operation_id, 2).unwrap();
        let candidate = writer.read_root_anchor_state().unwrap();
        assert_eq!(
            cell.rebind_interleaved(&candidate, || store.set_unavailable(true)),
            Err(KeyProviderError::SecureAnchorUnavailable)
        );
        assert!(cell.provider.session_binding().is_none());
        assert!(cell.current.is_none());
        store.set_unavailable(false);
        // Another forward commit during unlock must refuse this capture, not lose retryability.
        let third = request(&route, 2);
        assert_eq!(
            cell.rebind_interleaved(&candidate, || {
                writer.prepare_root_anchor(&third).unwrap();
                writer.commit_root_anchor(&third.operation_id, 3).unwrap();
            }),
            Err(KeyProviderError::RecoveryRequired)
        );
        assert!(cell.provider.session_binding().is_none());
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 3);
        assert!(cell.rebind_retry.is_none());
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 3);

        let fourth = request(&route, 3);
        writer.prepare_root_anchor(&fourth).unwrap();
        writer.commit_root_anchor(&fourth.operation_id, 4).unwrap();
        let candidate = writer.read_root_anchor_state().unwrap();
        let changed_route = writer.provision_epoch_key(2).unwrap();
        let rotated = request(&changed_route, 4);
        assert_eq!(
            cell.rebind_interleaved(&candidate, || {
                writer.prepare_root_anchor(&rotated).unwrap();
                writer.commit_root_anchor(&rotated.operation_id, 5).unwrap();
            }),
            Err(KeyProviderError::RecoveryRequired)
        );
        assert_eq!(cell.capture().err(), Some(KeyProviderError::Locked));
        assert_eq!(cell.current.as_ref().unwrap().root.root_generation, 3);
    }

    #[test]
    fn locked_reader_rebinds_only_to_a_same_key_forward_root() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 1);

        let next = request(&route, 1);
        writer.prepare_root_anchor(&next).unwrap();
        writer.commit_root_anchor(&next.operation_id, 2).unwrap();
        assert_eq!(cell.provider.state(), Ok(KeyState::Locked));
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 2);
        assert!(matches!(
            cell.provider.state(),
            Ok(KeyState::Unlocked { .. })
        ));
    }

    #[test]
    fn external_commit_between_state_and_anchor_does_not_poison_publication() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 1);
        let (snapshot, key) = cell
            .capture_interleaved(
                || {
                    let next = request(&route, 1);
                    writer.prepare_root_anchor(&next).unwrap();
                    writer.commit_root_anchor(&next.operation_id, 2).unwrap();
                },
                || {},
                || {},
            )
            .unwrap();
        assert_eq!(snapshot.root.root_generation, 2);
        assert!(matches!(
            cell.provider.state(),
            Ok(KeyState::Unlocked { .. })
        ));
        drop((snapshot, key));
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 2);
    }

    #[test]
    fn prepared_only_capture_race_and_abort_preserve_the_live_session() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 1);
        let next = request(&route, 1);
        let (snapshot, key) = cell
            .capture_interleaved(|| {}, || writer.prepare_root_anchor(&next).unwrap(), || {})
            .unwrap();
        assert_eq!(snapshot.root.root_generation, 1);
        assert!(matches!(
            cell.provider.state(),
            Ok(KeyState::Unlocked { .. })
        ));
        drop((snapshot, key));
        writer
            .abort_or_recover_root_anchor(&next.operation_id)
            .unwrap();
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 1);
    }

    #[test]
    fn explicit_lock_is_not_reversed_by_a_same_key_forward_commit() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 1);
        cell.provider.lock();
        assert!(cell.provider.session_binding().is_none());
        let next = request(&route, 1);
        writer.prepare_root_anchor(&next).unwrap();
        writer.commit_root_anchor(&next.operation_id, 2).unwrap();
        assert_eq!(cell.capture().err(), Some(KeyProviderError::Locked));
        assert_eq!(cell.provider.state(), Ok(KeyState::Locked));
        assert_eq!(cell.current.as_ref().unwrap().root.root_generation, 1);
    }

    #[test]
    fn live_session_rebinds_before_first_snapshot_without_a_caller_baseline() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        assert!(cell.current.is_none());
        let next = request(&route, 1);
        writer.prepare_root_anchor(&next).unwrap();
        writer.commit_root_anchor(&next.operation_id, 2).unwrap();
        assert_eq!(cell.provider.state(), Ok(KeyState::Locked));
        assert_eq!(
            cell.provider
                .session_binding()
                .unwrap()
                .root
                .root_generation,
            1
        );
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 2);
        assert_eq!(cell.capture().unwrap().0.root.root_generation, 2);
    }

    #[test]
    fn locked_reader_does_not_rebind_an_explicit_lock_or_route_change() {
        let (mut writer, reader, route) = shared_runtimes();
        let mut cell = AuthorityCell::new(reader);
        let _ = cell.capture().unwrap();
        cell.provider.lock();
        assert_eq!(cell.capture().err(), Some(KeyProviderError::Locked));
        assert_eq!(cell.provider.state(), Ok(KeyState::Locked));

        let replacement_route = writer.provision_epoch_key(2).unwrap();
        let replacement = request(&replacement_route, 1);
        writer.prepare_root_anchor(&replacement).unwrap();
        writer
            .commit_root_anchor(&replacement.operation_id, 2)
            .unwrap();
        assert_eq!(cell.capture().err(), Some(KeyProviderError::Locked));
        assert_eq!(cell.provider.state(), Ok(KeyState::Locked));
        assert_ne!(replacement_route, route);
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
            let mut held = lock_cell(&writer_cell).unwrap();
            let next = request(&route, 1);
            held.provider.prepare_root_anchor(&next).unwrap();
            held.provider
                .commit_root_anchor(&next.operation_id, 2)
                .unwrap();
            let anchor = held.provider.read_root_anchor_state().unwrap();
            held.publish(&anchor).unwrap();
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
}
