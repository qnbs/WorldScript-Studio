//! Gate 4B foundation: kernel-backed operation admission above the root-commit mutex.
//!
//! An installation owns one dedicated directory; its authority root is an immediate child.
//! Unix locks the installation directory itself with shared/exclusive `flock`, while 4A locks
//! the distinct root directory. Windows locks `operation-admission.lock` without delete sharing
//! and pins both directories with no-delete-share handles. No lock body is read or written.
//! Windows also compares volume + 128-bit file IDs from held/reopened handles; an existing path
//! alone never proves identity, and an unsupported identity query fails closed.
//! Directory handles are pinned before canonicalization: later path resolution cannot silently
//! replace the objects selected at acquisition. A replacement fails closed, without retrying it.
//! The installation locator is not an authenticated `InstallationScopeId`; the integration layer
//! must validate the anchor and select keys only AFTER obtaining admission.
//!
//! Acquisition is nonblocking: contention is `Ok(None)`, never record absence. Callers can cancel
//! a pending request without a queued kernel wait. Dropping an acquired guard (including unwind),
//! process exit or process crash releases ownership. No timestamp or stale-file deletion exists.
//! There is no fairness promise or upgrade operation. Every operation obtains its mode once.
//!
//! Guards are `Send` but not `Sync` or `Clone`: one held guard cannot authorize concurrent callers.
//! A root event borrows its admission mutably, so admission outlives that event by construction.
//! The old low-level 4A entry points remain available; integration of protected operations and
//! lock/unlock/shutdown is the next 4B proof boundary, not claimed by this foundation.
//!
//! ```compile_fail
//! fn shared<T: Sync>() {}
//! shared::<worldscript_secure_storage::SharedAdmissionGuard>();
//! ```
//! ```compile_fail
//! fn shared<T: Sync>() {}
//! shared::<worldscript_secure_storage::ExclusiveAdmissionGuard>();
//! ```
//! ```compile_fail
//! fn cloneable<T: Clone>() {}
//! cloneable::<worldscript_secure_storage::SharedAdmissionGuard>();
//! ```
//! ```compile_fail
//! fn cloneable<T: Clone>() {}
//! cloneable::<worldscript_secure_storage::ExclusiveAdmissionGuard>();
//! ```
//! ```compile_fail
//! fn release_too_soon(mut admission: worldscript_secure_storage::SharedAdmissionGuard) {
//!     let event = admission.try_root_commit().unwrap().unwrap();
//!     drop(admission);
//!     event.root_guard().unwrap();
//! }
//! ```

use std::cell::Cell;
use std::fs::File;
use std::io;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};

use crate::root_lock::{sys, RootCommitGuard};

/// Windows coordination filename. Its bytes have no authority; Unix uses no lock file.
pub const OPERATION_ADMISSION_LOCK_FILE: &str = "operation-admission.lock";

/// A dedicated installation directory and its immediate-child authority root.
#[derive(Debug, Clone, Copy)]
pub struct AdmissionScope<'a> {
    pub installation_dir: &'a Path,
    pub root_dir: &'a Path,
}

/// Admission failures never stand for a missing record or permission to use plaintext.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionError {
    Io(io::ErrorKind),
    /// A root outside the dedicated installation directory (path I/O has its own typed error).
    InvalidScope,
    /// A held path no longer names the directory/file originally opened.
    IdentityChanged,
}

impl From<io::Error> for AdmissionError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.kind())
    }
}

/// Type-level shared ordinary-operation mode.
#[derive(Debug)]
pub enum SharedAdmission {}
/// Type-level exclusive authority-transition mode.
#[derive(Debug)]
pub enum ExclusiveAdmission {}

pub type SharedAdmissionGuard = AdmissionGuard<SharedAdmission>;
pub type ExclusiveAdmissionGuard = AdmissionGuard<ExclusiveAdmission>;

/// One operation's ownership, never a key or authority snapshot.
#[derive(Debug)]
pub struct AdmissionGuard<Mode> {
    held: HeldAdmission,
    mode: PhantomData<Mode>,
}

#[derive(Debug)]
struct HeldAdmission {
    installation_dir: PathBuf,
    root_dir: PathBuf,
    installation_pin: File,
    root_pin: File,
    lock: File,
    not_sync: PhantomData<Cell<()>>,
}

impl SharedAdmissionGuard {
    /// Shared holders coexist; an exclusive holder returns `Ok(None)`.
    pub fn try_acquire(scope: AdmissionScope<'_>) -> Result<Option<Self>, AdmissionError> {
        Self::acquire(scope, true)
    }
}

impl ExclusiveAdmissionGuard {
    /// Succeeds only after every ordinary holder and conflicting transition has released.
    pub fn try_acquire(scope: AdmissionScope<'_>) -> Result<Option<Self>, AdmissionError> {
        Self::acquire(scope, false)
    }
}

impl<Mode> AdmissionGuard<Mode> {
    fn acquire(scope: AdmissionScope<'_>, shared: bool) -> Result<Option<Self>, AdmissionError> {
        let installation_pin = sys::open_directory(scope.installation_dir)?;
        let root_pin = sys::open_directory(scope.root_dir)?;
        Self::acquire_pinned(scope, shared, installation_pin, root_pin)
    }

    fn acquire_pinned(
        scope: AdmissionScope<'_>,
        shared: bool,
        installation_pin: File,
        root_pin: File,
    ) -> Result<Option<Self>, AdmissionError> {
        let installation_dir = std::fs::canonicalize(scope.installation_dir)?;
        let root_dir = std::fs::canonicalize(scope.root_dir)?;
        if root_dir.parent() != Some(installation_dir.as_path()) {
            return Err(AdmissionError::InvalidScope);
        }
        let target = sys::admission_target(&installation_dir);
        // Windows shares 4A's no-delete-share file mechanism; Unix opens the directory itself.
        let lock = sys::open_admission_target(&target)?;
        match sys::lock_mode(&lock, false, shared) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        let held = HeldAdmission {
            installation_dir,
            root_dir,
            installation_pin,
            root_pin,
            lock,
            not_sync: PhantomData,
        };
        if !held.guards(scope) {
            return Err(AdmissionError::IdentityChanged);
        }
        Ok(Some(Self {
            held,
            mode: PhantomData,
        }))
    }

    /// Canonical spelling and both still-open directory identities must agree.
    pub fn guards(&self, scope: AdmissionScope<'_>) -> bool {
        self.held.guards(scope)
    }

    /// One finite root event below the SAME admission. Busy never upgrades or releases admission.
    pub fn try_root_commit(
        &mut self,
    ) -> Result<Option<AdmittedRootCommitGuard<'_>>, AdmissionError> {
        if !self.held.is_current() {
            return Err(AdmissionError::IdentityChanged);
        }
        let Some(root) = RootCommitGuard::try_acquire(&self.held.root_dir)? else {
            return Ok(None);
        };
        if !self.held.is_current() || !root.guards(&self.held.root_dir) {
            return Err(AdmissionError::IdentityChanged);
        }
        Ok(Some(AdmittedRootCommitGuard {
            root,
            admission: &mut self.held,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_between_pinning_and_canonicalization_cannot_be_admitted() {
        let fixture =
            std::env::temp_dir().join(format!("wss-gate4b-acquisition-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&fixture);
        std::fs::create_dir_all(&fixture).unwrap();
        for replace_installation in [false, true] {
            for shared in [false, true] {
                let installation = fixture.join(format!("install-{replace_installation}-{shared}"));
                let root = installation.join("authority");
                std::fs::create_dir_all(&root).unwrap();
                let scope = AdmissionScope {
                    installation_dir: &installation,
                    root_dir: &root,
                };
                let installation_pin = sys::open_directory(&installation).unwrap();
                let root_pin = sys::open_directory(&root).unwrap();
                let replaced = if replace_installation {
                    &installation
                } else {
                    &root
                };
                let moved = fixture.join(format!("moved-{replace_installation}-{shared}"));
                // Interrupt the production acquisition exactly after its first identity observations.
                // Windows may prevent replacement via no-delete-share; Unix permits the race.
                let replaced = match std::fs::rename(replaced, &moved) {
                    Ok(()) => {
                        std::fs::create_dir_all(&root).unwrap();
                        true
                    }
                    Err(_) if cfg!(windows) => false,
                    Err(error) => panic!("unexpected rename failure: {error}"),
                };
                let result = if shared {
                    SharedAdmissionGuard::acquire_pinned(scope, true, installation_pin, root_pin)
                        .map(|guard| guard.map(|guard| guard.guards(scope)))
                } else {
                    ExclusiveAdmissionGuard::acquire_pinned(
                        scope,
                        false,
                        installation_pin,
                        root_pin,
                    )
                    .map(|guard| guard.map(|guard| guard.guards(scope)))
                };
                if replaced {
                    assert_eq!(result, Err(AdmissionError::IdentityChanged));
                } else {
                    assert_eq!(result, Ok(Some(true)));
                }
                assert!(ExclusiveAdmissionGuard::try_acquire(scope)
                    .unwrap()
                    .is_some());
            }
        }
        std::fs::remove_dir_all(&fixture).unwrap();
    }
}

impl HeldAdmission {
    fn guards(&self, scope: AdmissionScope<'_>) -> bool {
        std::fs::canonicalize(scope.installation_dir)
            .is_ok_and(|path| path == self.installation_dir)
            && std::fs::canonicalize(scope.root_dir).is_ok_and(|path| path == self.root_dir)
            && self.is_current()
    }

    fn is_current(&self) -> bool {
        sys::still_named(&self.installation_pin, &self.installation_dir).unwrap_or(false)
            && sys::still_named(&self.root_pin, &self.root_dir).unwrap_or(false)
            && sys::still_named(&self.lock, &sys::admission_target(&self.installation_dir))
                .unwrap_or(false)
    }
}

/// A root mutex event that cannot outlive its operation admission.
#[derive(Debug)]
pub struct AdmittedRootCommitGuard<'a> {
    root: RootCommitGuard,
    admission: &'a mut HeldAdmission,
}

impl AdmittedRootCommitGuard<'_> {
    /// The 4A guard, only while both identities still match. Root APIs also revalidate their guard.
    pub fn root_guard(&self) -> Result<&RootCommitGuard, AdmissionError> {
        if self.admission.is_current() && self.root.guards(&self.admission.root_dir) {
            Ok(&self.root)
        } else {
            Err(AdmissionError::IdentityChanged)
        }
    }
}
