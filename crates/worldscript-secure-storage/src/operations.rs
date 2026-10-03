//! Read/snapshot half of Gate 4B. Shared admission precedes authority/key observation.
//! Provider ownership is private; the callback holds the exact snapshot, key and admission.
//! Mutation, prepared-root recovery and lifecycle closure remain a separate successor slice.
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

use crate::admission::{AdmissionError, AdmissionScope, SharedAdmissionGuard};
use crate::authority::{load_snapshot_catalog, AuthorityError, LoadedCatalog};
use crate::commit::{RecordLocation, RecordStore};
use crate::durable::DurableFs;
use crate::error::KeyProviderError;
use crate::identity::{has_ordinary_marker, RecordIdentity};
use crate::operation_authority::{lock_cell, AuthorityCell, Snapshot, SnapshotRetention};
use crate::protected::{self, ProtectedError, ProtectedRead};
use crate::provider::{KeyProvider, KeyState};
use crate::root::KeyEpochEntry;
use crate::root_lock::sys;
use crate::root_store::{load_snapshot_root, RootLayout, RootStoreError};
use crate::seal::Key;

const WRITER_RESOURCE: &str = "ordinary-writers";

/// The logical identity and physical locators of one request. Locators never supply authority.
#[derive(Clone, Copy)]
pub struct ProtectedRecord<'a> {
    pub identity: &'a RecordIdentity,
    pub location: RecordLocation<'a>,
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
    /// Authenticated marker evidence requires recovery; never absence or plaintext fallback.
    RecoveryPending,
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
        Self::Protected(e)
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

/// Renderer-neutral owner of a provider and its snapshot publication cell. Constructing it performs
/// no authority/key observation. There is deliberately no accessor that exposes the provider.
pub struct ProtectedStorage<P> {
    scope: Scope,
    cell: Mutex<AuthorityCell<P>>,
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
        }
    }

    /// Admission precedes provider observation; the snapshot pin and its key are captured atomically with respect to local step F.
    pub fn try_authority_snapshot<F: DurableFs>(
        &self,
        fs: &mut F,
    ) -> Result<Option<AuthoritySnapshotGuard>, OperationError> {
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
        Self::check_identity(sys::still_named(&self.record, location.record_dir))?;
        Self::check_identity(sys::still_named(&self.marker, location.marker_dir))
    }
    fn check_identity(identity: std::io::Result<bool>) -> Result<(), OperationError> {
        if identity.map_err(AdmissionError::from)? {
            Ok(())
        } else {
            Err(AdmissionError::IdentityChanged.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn locator_identity_io_is_preserved_and_never_authorizes_the_read() {
        for kind in [io::ErrorKind::PermissionDenied, io::ErrorKind::Interrupted] {
            assert_eq!(
                LocationPins::check_identity(Err(io::Error::from(kind))),
                Err(OperationError::Admission(AdmissionError::Io(kind)))
            );
        }
        assert_eq!(
            LocationPins::check_identity(Ok(false)),
            Err(OperationError::Admission(AdmissionError::IdentityChanged))
        );
        assert_eq!(LocationPins::check_identity(Ok(true)), Ok(()));
    }
}
