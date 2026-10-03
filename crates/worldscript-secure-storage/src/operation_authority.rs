//! One Core authority cell: snapshot capture/pin and step-F publication share this mutex.
//! No key is retained in the current snapshot cell; operation keys are zeroized before admission
//! is released. Cross-process reader lifetime is additionally protected by shared admission:
//! reclamation requires exclusive admission, so another process cannot reclaim a live read.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use crate::anchor;
use crate::error::KeyProviderError;
use crate::provider::{AnchorState, CommittedRoot, InstallationScopeId, KeyProvider, KeyState};
use crate::seal::Key;

pub(crate) struct AuthorityCell<P> {
    pub(crate) provider: P,
    current: Option<Arc<Snapshot>>,
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
            KeyState::Locked if self.rebind_locked_same_key_forward()? => {}
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

    /// An externally committed ordinary write invalidates a runtime's exact session binding. The
    /// coordinator may rebind only to a validated, same-route forward root while shared admission
    /// is already live; rotation, rollback, explicit lock, and any concurrent change refuse.
    fn rebind_locked_same_key_forward(&mut self) -> Result<bool, KeyProviderError> {
        let before = self.provider.read_root_anchor_state()?;
        let Some(current) = self.current.as_ref() else {
            return Ok(false);
        };
        if !current.allows_same_key_forward(&before)? {
            return Ok(false);
        }
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
        if after != before || !current.allows_same_key_forward(&after)? {
            self.provider.lock();
            return Err(KeyProviderError::RecoveryRequired);
        }
        if let Err(error) = self.publish(&after) {
            self.provider.lock();
            return Err(error);
        }
        Ok(true)
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
        let store = MemorySecretStore::new();
        let mut writer = SecureStoreRuntime::new(SecureStoreAuthority::new(store.clone()));
        writer.read_or_provision_installation_scope().unwrap();
        let route = writer.provision_epoch_key(1).unwrap();
        writer.unlock().unwrap();
        let first = request(&route, 0);
        writer.prepare_root_anchor(&first).unwrap();
        writer.commit_root_anchor(&first.operation_id, 1).unwrap();

        let mut reader = SecureStoreRuntime::new(SecureStoreAuthority::new(store));
        assert!(matches!(reader.unlock(), Ok(KeyState::Unlocked { .. })));
        (writer, reader, route)
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
