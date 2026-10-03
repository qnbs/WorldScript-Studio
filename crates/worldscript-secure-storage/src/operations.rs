//! Gate 4B semantic operation boundary. Admission precedes every authority/key observation.
//! The provider is private; callers supply identity and locators, never keys or epochs.
//! No current renderer uses this boundary and no production authority switch is made.
//!
//! Reads pin an exact anchor snapshot and keep shared ownership through the handoff callback.
//! Ordinary writes use the same shared admission for reconciliation, PENDING, staging and ACTIVE.
//! Version 1 additionally serializes ordinary writers on a dedicated kernel-backed child resource;
//! this deliberately favors bounded correctness over parallel staging and avoids a per-record lock
//! inventory. It is not exclusive operation admission: readers remain admitted during a write.
//! The ordering is admission -> ordinary-writer serialization -> finite root event, without upgrade.
//!
//! A confirmed lock retains exclusive ownership until verified unlock. Otherwise another process's
//! already-loaded runtime could resume while this session reports LOCKED. The barrier has no durable
//! body/authority claim; crash release comes from the kernel. Shutdown refuses unresolved authority.
//!
//! ```compile_fail
//! fn share<T: Sync>() {}
//! share::<worldscript_secure_storage::AuthoritySnapshotGuard>();
//! ```
//! ```compile_fail
//! fn clone<T: Clone>() {}
//! clone::<worldscript_secure_storage::AuthoritySnapshotGuard>();
//! ```

use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::admission::{
    AdmissionError, AdmissionScope, ExclusiveAdmissionGuard, SharedAdmissionGuard,
};
use crate::authority::{load_snapshot_catalog, AuthorityError, LoadedCatalog};
use crate::commit::{RecordLocation, RecordStore};
use crate::durable::DurableFs;
use crate::error::KeyProviderError;
use crate::identity::{has_ordinary_marker, RecordIdentity};
use crate::operation_authority::{
    lock_cell, AuthorityCell, PublishedProvider, Snapshot, SnapshotRetention,
};
use crate::protected::{
    self, ProtectedCommitted, ProtectedError, ProtectedRead, ProtectedReconciled, ProtectedTarget,
    ProtectedWrite,
};
use crate::provider::{KeyProvider, KeyState};
use crate::root::KeyEpochEntry;
use crate::root_lock::{sys, RootCommitGuard};
use crate::root_store::{load_snapshot_root, RootLayout, RootStoreError};
use crate::seal::Key;

const WRITER_RESOURCE: &str = "ordinary-writers";

/// The logical identity and physical locators of one request. Locators never supply authority.
#[derive(Clone, Copy)]
pub struct ProtectedRecord<'a> {
    pub identity: &'a RecordIdentity,
    pub location: RecordLocation<'a>,
}

/// CAS expectation and payload belong to the same logical mutation, not separate positional args.
#[derive(Clone, Copy)]
pub struct ProtectedMutation<'a> {
    pub record: ProtectedRecord<'a>,
    pub expected_generation: Option<u64>,
    pub write: ProtectedWrite<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OperationError {
    Admission(AdmissionError),
    Provider(KeyProviderError),
    Root(RootStoreError),
    Catalog(AuthorityError),
    Protected(ProtectedError),
    /// No ordinary access to an unconfigured/migrating authority or legacy plaintext fallback.
    MigrationRequired,
    /// A transition cannot claim a clean drain while a root/record commit remains unresolved.
    RecoveryPending,
    Closed,
    StaleGeneration,
}

impl From<AdmissionError> for OperationError {
    fn from(e: AdmissionError) -> Self {
        Self::Admission(e)
    }
}
impl From<KeyProviderError> for OperationError {
    fn from(e: KeyProviderError) -> Self {
        Self::Provider(e)
    }
}
impl From<RootStoreError> for OperationError {
    fn from(e: RootStoreError) -> Self {
        Self::Root(e)
    }
}
impl From<AuthorityError> for OperationError {
    fn from(e: AuthorityError) -> Self {
        Self::Catalog(e)
    }
}
impl From<ProtectedError> for OperationError {
    fn from(e: ProtectedError) -> Self {
        match e {
            ProtectedError::StaleGeneration => Self::StaleGeneration,
            other => Self::Protected(other),
        }
    }
}

#[derive(Clone)]
struct Scope {
    installation: PathBuf,
    root: PathBuf,
}

impl Scope {
    fn validate(&self) -> Result<(), OperationError> {
        let root = std::fs::canonicalize(&self.root).map_err(AdmissionError::from)?;
        let installation =
            std::fs::canonicalize(&self.installation).map_err(AdmissionError::from)?;
        if root == installation.join(WRITER_RESOURCE) {
            return Err(AdmissionError::InvalidScope.into());
        }
        Ok(())
    }
    fn admission(&self) -> AdmissionScope<'_> {
        AdmissionScope {
            installation_dir: &self.installation,
            root_dir: &self.root,
        }
    }
    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.root,
        }
    }
}

#[derive(Default)]
struct Lifecycle {
    locked: Option<ExclusiveAdmissionGuard>,
    pending_record: Option<(RecordIdentity, LocationPins)>,
    /// A lock that authenticated a quiescent catalog may close without unlocking keys again.
    quiescent: bool,
    closed: bool,
}

/// Failed or unwound unlock attempts clear runtime keys; the lifecycle retains its kernel fence.
struct UnlockAttempt<'a, P: KeyProvider> {
    provider: PublishedProvider<'a, P>,
    completed: bool,
}

impl<P: KeyProvider> Drop for UnlockAttempt<'_, P> {
    fn drop(&mut self) {
        if !self.completed {
            self.provider.lock();
        }
    }
}

/// Renderer-neutral owner of a provider and its snapshot publication cell. Constructing it performs
/// no authority/key observation. There is deliberately no accessor that exposes the provider.
pub struct ProtectedStorage<P> {
    scope: Scope,
    cell: Mutex<AuthorityCell<P>>,
    lifecycle: Mutex<Lifecycle>,
}

/// A reader's opaque snapshot/key and admission. Field order zeroizes the key and releases the pin
/// BEFORE releasing shared admission. Not Sync/Clone; no raw key or epoch-selection API exists.
pub struct AuthoritySnapshotGuard {
    key: Key,
    snapshot: Arc<Snapshot>,
    epochs: Vec<KeyEpochEntry>,
    admission: SharedAdmissionGuard,
    scope: Scope,
}

impl<P: KeyProvider> ProtectedStorage<P> {
    pub fn new(scope: AdmissionScope<'_>, provider: P) -> Self {
        Self {
            scope: Scope {
                installation: scope.installation_dir.to_owned(),
                root: scope.root_dir.to_owned(),
            },
            cell: Mutex::new(AuthorityCell::new(provider)),
            lifecycle: Mutex::new(Lifecycle::default()),
        }
    }

    fn ordinary_allowed(&self) -> Result<(), OperationError> {
        let state = self
            .lifecycle
            .lock()
            .map_err(|_| OperationError::RecoveryPending)?;
        if state.closed {
            return Err(OperationError::Closed);
        }
        if state.locked.is_some() {
            return Err(KeyProviderError::Locked.into());
        }
        Ok(())
    }

    /// One unresolved record at most: writer serialization forbids starting another until recovery.
    fn track_mutation(
        &self,
        record: ProtectedRecord<'_>,
        unresolved: bool,
    ) -> Result<(), OperationError> {
        let mut state = self
            .lifecycle
            .lock()
            .map_err(|_| OperationError::RecoveryPending)?;
        if let Some((identity, pins)) = &state.pending_record {
            if identity != record.identity {
                return Err(OperationError::RecoveryPending);
            }
            pins.check(record.location)?;
        }
        if !unresolved {
            state.pending_record = None;
        } else if state.pending_record.is_none() {
            state.pending_record = Some((
                record.identity.clone(),
                LocationPins::open(&self.scope, record.location)?,
            ));
        }
        Ok(())
    }

    /// None is contention BEFORE any provider observation, never record absence. Once admitted,
    /// the snapshot pin and its key are captured atomically with respect to local step F.
    pub fn try_authority_snapshot<F: DurableFs>(
        &self,
        fs: &mut F,
    ) -> Result<Option<AuthoritySnapshotGuard>, OperationError> {
        self.ordinary_allowed()?;
        let Some(admission) = SharedAdmissionGuard::try_acquire(self.scope.admission())? else {
            return Ok(None);
        };
        self.capture(fs, admission).map(Some)
    }

    fn capture<F: DurableFs>(
        &self,
        fs: &mut F,
        admission: SharedAdmissionGuard,
    ) -> Result<AuthoritySnapshotGuard, OperationError> {
        if !admission.guards(self.scope.admission()) {
            return Err(AdmissionError::IdentityChanged.into());
        }
        self.scope.validate()?;
        let mut cell = lock_cell(&self.cell)?;
        match cell.provider.state()? {
            KeyState::Unconfigured | KeyState::Migrating { .. } => {
                return Err(OperationError::MigrationRequired)
            }
            _ => {}
        }
        let (snapshot, key) = cell.capture()?;
        drop(cell);
        let (_, epochs) = load_snapshot_root(
            fs,
            self.scope.layout(),
            &snapshot.scope,
            &snapshot.root,
            &key,
            None,
        )?;
        if !admission.guards(self.scope.admission()) {
            return Err(AdmissionError::IdentityChanged.into());
        }
        Ok(AuthoritySnapshotGuard {
            key,
            snapshot,
            epochs,
            admission,
            scope: self.scope.clone(),
        })
    }

    /// The handoff runs while admission, key and snapshot are all live. Returning None means the
    /// callback was not called (contention), not that the record was absent.
    pub fn try_read_record<F: DurableFs, T>(
        &self,
        fs: &mut F,
        record: ProtectedRecord<'_>,
        handoff: impl FnOnce(ProtectedRead) -> T,
    ) -> Result<Option<T>, OperationError> {
        if !has_ordinary_marker(record.identity.class()) {
            return Err(ProtectedError::NotAnOrdinaryRecord.into());
        }
        let Some(mut read) = self.try_authority_snapshot(fs)? else {
            return Ok(None);
        };
        read.read_record(fs, record, handoff).map(Some)
    }

    pub fn try_write_record<F: DurableFs>(
        &self,
        fs: &mut F,
        mutation: ProtectedMutation<'_>,
    ) -> Result<Option<ProtectedCommitted>, OperationError> {
        let ProtectedMutation {
            record,
            expected_generation,
            write,
        } = mutation;
        let ProtectedRecord { identity, location } = record;
        if !has_ordinary_marker(identity.class()) {
            return Err(ProtectedError::NotAnOrdinaryRecord.into());
        }
        self.ordinary_allowed()?;
        let Some(admission) = SharedAdmissionGuard::try_acquire(self.scope.admission())? else {
            return Ok(None);
        };
        // This kernel resource serializes mutation/reconciliation, not reader admission. It is
        // acquired before observing authority and never while a root event is held.
        let Some(writer) = WriterGuard::try_acquire(fs, &self.scope, &admission)? else {
            return Ok(None);
        };
        let mut operation = self.capture(fs, admission)?;
        let pins = LocationPins::open(&operation.scope, location)?;
        let catalog = operation.catalog(fs)?;
        let target = ProtectedTarget {
            layout: operation.scope.layout(),
            store: RecordStore {
                key: &operation.key,
                record: identity,
                location,
            },
            root_key_ref: &operation.snapshot.root.root_key_ref,
            key_epoch: catalog.root.active_key_epoch,
        };
        let mut provider = PublishedProvider(&self.cell);
        self.track_mutation(record, true)?;
        let result = protected::protected_write_admitted(
            fs,
            &mut provider,
            target,
            write,
            expected_generation,
            &mut operation.admission,
        )?;
        pins.check(location)?;
        writer.check()?;
        operation.check()?;
        self.track_mutation(record, false)?;
        Ok(Some(result))
    }

    /// Recover one record only after obtaining the same writer serialization as ordinary writes.
    pub fn try_reconcile_record<F: DurableFs>(
        &self,
        fs: &mut F,
        identity: &RecordIdentity,
        location: RecordLocation<'_>,
    ) -> Result<Option<ProtectedReconciled>, OperationError> {
        if !has_ordinary_marker(identity.class()) {
            return Err(ProtectedError::NotAnOrdinaryRecord.into());
        }
        self.ordinary_allowed()?;
        let Some(admission) = SharedAdmissionGuard::try_acquire(self.scope.admission())? else {
            return Ok(None);
        };
        let Some(writer) = WriterGuard::try_acquire(fs, &self.scope, &admission)? else {
            return Ok(None);
        };
        let mut operation = self.capture(fs, admission)?;
        let pins = LocationPins::open(&operation.scope, location)?;
        let catalog = operation.catalog(fs)?;
        let target = ProtectedTarget {
            layout: operation.scope.layout(),
            store: RecordStore {
                key: &operation.key,
                record: identity,
                location,
            },
            root_key_ref: &operation.snapshot.root.root_key_ref,
            key_epoch: catalog.root.active_key_epoch,
        };
        let mut provider = PublishedProvider(&self.cell);
        let record = ProtectedRecord { identity, location };
        self.track_mutation(record, true)?;
        let result = protected::reconcile_protected_admitted(
            fs,
            &mut provider,
            target,
            &mut operation.admission,
        )?;
        pins.check(location)?;
        writer.check()?;
        operation.check()?;
        self.track_mutation(record, false)?;
        Ok(Some(result))
    }

    /// Exclusive drain, verified quiescence, key clearing, then retained cross-process exclusion.
    /// None leaves the prior state unchanged; it does not acknowledge LOCKED.
    pub fn try_lock<F: DurableFs>(&self, fs: &mut F) -> Result<Option<KeyState>, OperationError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| OperationError::RecoveryPending)?;
        if lifecycle.closed {
            return Err(OperationError::Closed);
        }
        if let Some(held) = &lifecycle.locked {
            self.check_exclusive(held)?;
            return Ok(Some(KeyState::Locked));
        }
        let Some(held) = ExclusiveAdmissionGuard::try_acquire(self.scope.admission())? else {
            return Ok(None);
        };
        self.check_exclusive(&held)?;
        if lifecycle.pending_record.is_some() {
            return Err(OperationError::RecoveryPending);
        }
        let provider = PublishedProvider(&self.cell);
        let quiescent = match provider.state()? {
            KeyState::Unlocked { .. } => {
                self.verify_transition(fs, &provider, true)?;
                true
            }
            KeyState::Locked => false,
            _ => return Err(OperationError::RecoveryPending),
        };
        self.check_exclusive(&held)?;
        lock_cell(&self.cell)?.provider.lock();
        lifecycle.quiescent = quiescent;
        lifecycle.locked = Some(held);
        Ok(Some(KeyState::Locked))
    }

    /// Only a verified configured authority resumes ordinary admission. A failed unlock clears
    /// handles and retains the exclusive barrier; a future recovery owner can retry deterministically.
    pub fn try_unlock<F: DurableFs>(&self, fs: &mut F) -> Result<Option<KeyState>, OperationError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| OperationError::RecoveryPending)?;
        if lifecycle.closed {
            return Err(OperationError::Closed);
        }
        if lifecycle.locked.is_none() {
            let Some(held) = ExclusiveAdmissionGuard::try_acquire(self.scope.admission())? else {
                return Ok(None);
            };
            self.check_exclusive(&held)?;
            lifecycle.locked = Some(held);
        }
        lifecycle.quiescent = false;
        let mut attempt = UnlockAttempt {
            provider: PublishedProvider(&self.cell),
            completed: false,
        };
        let state = self.verify_unlock(
            fs,
            &mut attempt.provider,
            lifecycle
                .locked
                .as_ref()
                .ok_or(OperationError::RecoveryPending)?,
        )?;
        attempt.completed = true;
        lifecycle.locked = None;
        Ok(Some(state))
    }

    fn verify_unlock<F: DurableFs>(
        &self,
        fs: &mut F,
        provider: &mut PublishedProvider<'_, P>,
        held: &ExclusiveAdmissionGuard,
    ) -> Result<KeyState, OperationError> {
        self.check_exclusive(held)?;
        let state = provider.unlock()?;
        if !matches!(state, KeyState::Unlocked { .. }) {
            return Err(OperationError::MigrationRequired);
        }
        self.verify_transition(fs, provider, false)?;
        self.check_exclusive(held)?;
        Ok(state)
    }

    fn check_exclusive(&self, held: &ExclusiveAdmissionGuard) -> Result<(), OperationError> {
        if !held.guards(self.scope.admission()) {
            return Err(AdmissionError::IdentityChanged.into());
        }
        self.scope.validate()
    }

    /// Closes this coordinator after an authenticated drain, clears its keys and releases admission.
    /// It is session termination, not an installation-wide LOCKED state or durable authority change.
    pub fn try_shutdown<F: DurableFs>(&self, fs: &mut F) -> Result<Option<()>, OperationError> {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| OperationError::RecoveryPending)?;
        if lifecycle.closed {
            return Ok(Some(()));
        }
        if let Some(held) = &lifecycle.locked {
            self.check_exclusive(held)?;
            if !lifecycle.quiescent {
                return Err(OperationError::RecoveryPending);
            }
        } else {
            let Some(held) = ExclusiveAdmissionGuard::try_acquire(self.scope.admission())? else {
                return Ok(None);
            };
            self.check_exclusive(&held)?;
            if lifecycle.pending_record.is_some() {
                return Err(OperationError::RecoveryPending);
            }
            let provider = PublishedProvider(&self.cell);
            self.verify_transition(fs, &provider, true)?;
            self.check_exclusive(&held)?;
            lock_cell(&self.cell)?.provider.lock();
            lifecycle.closed = true;
            return Ok(Some(()));
        }
        lock_cell(&self.cell)?.provider.lock();
        lifecycle.closed = true;
        lifecycle.locked = None;
        Ok(Some(()))
    }

    fn verify_transition<F: DurableFs>(
        &self,
        fs: &mut F,
        provider: &PublishedProvider<'_, P>,
        require_quiescent: bool,
    ) -> Result<(), OperationError> {
        let catalog = crate::authority::load_catalog(fs, provider, self.scope.layout())?
            .ok_or(OperationError::MigrationRequired)?;
        if catalog.root.live_migration.is_some()
            || (require_quiescent
                && catalog
                    .descriptors()
                    .any(|d| d.marker_state() != crate::marker::state_code::ACTIVE))
        {
            return Err(OperationError::RecoveryPending);
        }
        Ok(())
    }

    /// Eligibility of an old root handle only, never a byte-deletion API. Exclusive admission
    /// supplies the cross-process no-reader proof; the witness supplies the local pin proof.
    pub fn root_reclamation_eligible(
        &self,
        held: &ExclusiveAdmissionGuard,
        witness: &SnapshotRetention,
        other_recovery_reason: bool,
    ) -> Result<bool, OperationError> {
        self.check_exclusive(held)?;
        let mut cell = lock_cell(&self.cell)?;
        if !cell.owns_retention(witness) {
            return Err(AdmissionError::InvalidScope.into());
        }
        let anchor = cell.provider.read_root_anchor_state()?;
        crate::anchor::validate(&anchor)?;
        cell.publish(&anchor)?;
        if anchor.installation_scope_id.as_ref() != Some(&witness.scope) {
            return Err(OperationError::RecoveryPending);
        }
        let eligible = !other_recovery_reason
            && !witness.is_referenced()
            && witness.generation < anchor.committed_floor.saturating_sub(1)
            && !anchor
                .prepared_root_commit
                .as_ref()
                .is_some_and(|p| p.target_root_generation == witness.generation);
        self.check_exclusive(held)?;
        Ok(eligible)
    }
}

impl AuthoritySnapshotGuard {
    pub fn root_generation(&self) -> u64 {
        self.snapshot.root.root_generation
    }
    pub fn retention(&self) -> SnapshotRetention {
        Snapshot::retention(&self.snapshot)
    }

    fn check(&self) -> Result<(), OperationError> {
        if self.admission.guards(self.scope.admission()) {
            Ok(())
        } else {
            Err(AdmissionError::IdentityChanged.into())
        }
    }

    fn catalog<F: DurableFs>(&self, fs: &mut F) -> Result<LoadedCatalog, OperationError> {
        self.check()?;
        let (view, _) = load_snapshot_root(
            fs,
            self.scope.layout(),
            &self.snapshot.scope,
            &self.snapshot.root,
            &self.key,
            Some(&self.epochs),
        )?;
        if view.root.live_migration.is_some() {
            return Err(OperationError::MigrationRequired);
        }
        let catalog = load_snapshot_catalog(fs, self.scope.layout(), view, &self.key)?;
        self.check()?;
        Ok(catalog)
    }

    pub fn read_record<F: DurableFs, T>(
        &mut self,
        fs: &mut F,
        record: ProtectedRecord<'_>,
        handoff: impl FnOnce(ProtectedRead) -> T,
    ) -> Result<T, OperationError> {
        let ProtectedRecord { identity, location } = record;
        if !has_ordinary_marker(identity.class()) {
            return Err(ProtectedError::NotAnOrdinaryRecord.into());
        }
        let pins = LocationPins::open(&self.scope, location)?;
        let catalog = self.catalog(fs)?;
        let Some(named) = catalog.descriptors().find(|d| d.record() == identity) else {
            self.check()?;
            pins.check(location)?;
            return Ok(handoff(ProtectedRead::NotCatalogued));
        };
        if named.marker_state() == crate::marker::state_code::RECOVERY_REQUIRED {
            return Err(OperationError::RecoveryPending);
        }
        if named
            .readable()
            .is_some_and(|g| g.epoch != catalog.root.active_key_epoch)
        {
            return Err(OperationError::MigrationRequired);
        }
        let store = RecordStore {
            key: &self.key,
            record: identity,
            location,
        };
        let result = protected::read_named_protected(fs, store, named)?;
        pins.check(location)?;
        self.check()?;
        Ok(handoff(result))
    }
}

struct WriterGuard {
    held: RootCommitGuard,
    pin: File,
    dir: PathBuf,
}

impl WriterGuard {
    fn try_acquire<F: DurableFs>(
        fs: &mut F,
        scope: &Scope,
        admission: &SharedAdmissionGuard,
    ) -> Result<Option<Self>, OperationError> {
        if !admission.guards(scope.admission()) {
            return Err(AdmissionError::IdentityChanged.into());
        }
        let dir = scope.installation.join(WRITER_RESOURCE);
        fs.create_dir_all(&dir)
            .map_err(|e| AdmissionError::Io(e.kind()))?;
        let pin = sys::open_directory(&dir).map_err(AdmissionError::from)?;
        let canonical = std::fs::canonicalize(&dir).map_err(AdmissionError::from)?;
        let installation =
            std::fs::canonicalize(&scope.installation).map_err(AdmissionError::from)?;
        let root = std::fs::canonicalize(&scope.root).map_err(AdmissionError::from)?;
        if canonical != installation.join(WRITER_RESOURCE) || canonical == root {
            return Err(AdmissionError::InvalidScope.into());
        }
        let Some(held) = RootCommitGuard::try_acquire(&dir).map_err(AdmissionError::from)? else {
            return Ok(None);
        };
        let guard = Self { held, pin, dir };
        guard.check()?;
        if !admission.guards(scope.admission()) {
            return Err(AdmissionError::IdentityChanged.into());
        }
        Ok(Some(guard))
    }
    fn check(&self) -> Result<(), OperationError> {
        if self.held.guards(&self.dir) && sys::still_named(&self.pin, &self.dir).unwrap_or(false) {
            Ok(())
        } else {
            Err(AdmissionError::IdentityChanged.into())
        }
    }
}

struct LocationPins {
    record: File,
    marker: File,
}

impl LocationPins {
    fn open(scope: &Scope, location: RecordLocation<'_>) -> Result<Self, OperationError> {
        let pins = Self {
            record: sys::open_directory(location.record_dir).map_err(AdmissionError::from)?,
            marker: sys::open_directory(location.marker_dir).map_err(AdmissionError::from)?,
        };
        let installation =
            std::fs::canonicalize(&scope.installation).map_err(AdmissionError::from)?;
        let root = std::fs::canonicalize(&scope.root).map_err(AdmissionError::from)?;
        let record = std::fs::canonicalize(location.record_dir).map_err(AdmissionError::from)?;
        let marker = std::fs::canonicalize(location.marker_dir).map_err(AdmissionError::from)?;
        let valid = |path: &Path| {
            path.starts_with(&installation)
                && path != installation
                && !path.starts_with(&root)
                && !path.starts_with(installation.join(WRITER_RESOURCE))
        };
        for path in [&record, &marker] {
            if !valid(path) {
                return Err(AdmissionError::InvalidScope.into());
            }
        }
        if record == marker {
            return Err(AdmissionError::InvalidScope.into());
        }
        pins.check(location)?;
        Ok(pins)
    }
    fn check(&self, location: RecordLocation<'_>) -> Result<(), OperationError> {
        if sys::still_named(&self.record, location.record_dir).unwrap_or(false)
            && sys::still_named(&self.marker, location.marker_dir).unwrap_or(false)
        {
            Ok(())
        } else {
            Err(AdmissionError::IdentityChanged.into())
        }
    }
}
