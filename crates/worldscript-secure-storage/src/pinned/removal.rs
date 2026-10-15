//! Gate 4 slice H1a-2, test-support only: the API of a removal that is bound to the object that was
//! authenticated, and the limits of what the platforms can guarantee, stated where they apply.
//!
//! **Availability.** Everything in this module exists only with the test-only `test-support` feature,
//! has no caller, and is not part of any production build. Reclamation of a real store is not admitted.
//!
//! **Status of this slice.** The API and its isolation. Every call answers [`PinnedError::Unsupported`]
//! until the platform implementations land in the successor slices (Unix files; Unix directories and
//! leftovers; Windows), so nothing is removed and nothing claims a safety it does not have yet.
//!
//! **The two designs the platform slices do not use.** Removing "the entry that was checked" with
//! `unlinkat(parent, name)` after a check on the name is exposed to a swap of the last component: POSIX
//! has no unlink-by-inode, so the call removes whatever is bound to the name at that instant, which may
//! be a live object another actor put there after the check. `FILE_FLAG_DELETE_ON_CLOSE` is chosen when
//! the handle is opened and cannot be taken back, so a file opened with it before the authentication is
//! deleted when the handle closes even if the authentication fails.
//!
//! **What the platform slices implement.** Unix: the entry is moved into a private quarantine
//! directory with `renameat2(RENAME_NOREPLACE)`, identified there by the open object, and only then
//! unlinked; anything that is not the authenticated object is put back, and every failure after the
//! move rolls back or says it could not ([`RemovalOutcome::Stranded`]). Windows: the object is opened
//! through the handle-relative lookup with delete access and read-only sharing, authenticated on that
//! handle, and then given the POSIX delete disposition on the same handle.
//!
//! **The Unix window that stays open, and who decides about it.** No Unix primitive unlinks "this
//! inode": `unlinkat` removes the name's current binding. The quarantine directory is not exclusive (its
//! mode and random name keep out other users and accidents, not another process of the same user), so
//! between the last identification and the unlink an actor that can write into it and wins that one
//! race can have its own object removed instead. That is **detected after the fact, not prevented**
//! ([`RemovalOutcome::Disturbed`]), and the detection is a heuristic. That the same user could delete
//! the object directly is a statement about a threat model, not a guarantee of identity; whether this
//! residual is acceptable for a production sweep is a decision of the maintainer, to be taken before any
//! sweep uses these primitives.
//!
//! A hard link is one name: removing it leaves the other names. [`PinnedFile::link_count`] lets a caller
//! refuse a file with more than one.

use std::ffi::OsStr;
use std::path::Path;

use super::{checked_name, sys, PinnedDir, PinnedError, PinnedFile};
use crate::durable::DirectoryDurability;

/// The name prefix of the quarantine directories a removal creates. One that is left behind (a crash,
/// or an object that could not be put back) is never removed by a sweep; see
/// [`PinnedDir::remove_leftover_file`].
pub const QUARANTINE_PREFIX: &str = ".h1q-";

/// What a removal did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemovalOutcome {
    /// The authenticated object lost this name (on Unix as far as the check after the unlink can tell,
    /// see [`Disturbed`](Self::Disturbed)); the durability of the directory entry change as far as the
    /// platform can confirm it.
    Removed(DirectoryDurability),
    /// The authentication said no; nothing was changed.
    Refused,
    /// The name no longer led to an object (someone else removed it); nothing was removed.
    Vanished,
    /// The directory still has entries; nothing was removed.
    NotEmpty,
    /// Something other than the authenticated object was bound to the name. It was not removed: it is
    /// back under its name (`restored`) or, if the name was taken meanwhile, kept in the quarantine
    /// directory (`.h1q-*`, never removed by a sweep).
    Swapped { restored: bool },
    /// Unix only: after the unlink the authenticated object had not lost a name, so the name was bound
    /// to another object when it was unlinked (see the window in the module documentation). That
    /// object is gone and nothing can be undone: the caller must treat the directory as tampered with,
    /// and never count this as a success.
    Disturbed,
    /// Unix only: an error happened after the entry was moved into the quarantine directory and it
    /// could not be put back (`cause` is the error that started it). The entry is in the quarantine
    /// directory (`.h1q-*`, as `x`), found with a listing; [`PinnedDir::remove_leftover_file`] takes it
    /// from there after authenticating it again. Nothing was removed.
    Stranded { cause: PinnedError },
}

/// The points of a removal at which a test can act, to force the exact interleavings the primitives are
/// designed against, or to inject a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemovalStage<'a> {
    /// The object was identified and (for a file) authenticated; nothing was changed yet. This is the
    /// check-then-use window of a name-based removal.
    Checked,
    /// Unix only: whatever the name was bound to has been moved into the quarantine directory, as
    /// `quarantined`; it has not been identified yet.
    MovedAside { quarantined: &'a Path },
    /// Unix only: the object in the quarantine directory was identified as the authenticated one and the
    /// unlink is next. This is the last window.
    Identified { quarantined: &'a Path },
    /// Unix only: the directory changed (an object was removed, or moved and put back) and is about to
    /// be synced.
    BeforeSync,
}

/// Called at each [`RemovalStage`]. An error stops the removal there: before the object was moved
/// nothing has happened, after it the object is put back (a rollback, or [`RemovalOutcome::Stranded`]);
/// at `BeforeSync` the change was made and the caller repeats [`PinnedDir::sync`].
pub type Observer<'a> = &'a mut dyn FnMut(RemovalStage<'_>) -> Result<(), PinnedError>;

impl PinnedDir {
    /// Removes the regular file `name` if `authenticate` accepts it, and then removes exactly the object
    /// that was authenticated. `authenticate` runs on the open file.
    pub fn remove_authenticated_file(
        &self,
        name: impl AsRef<OsStr>,
        authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    ) -> Result<RemovalOutcome, PinnedError> {
        self.remove_authenticated_file_observed(name, authenticate, &mut |_| Ok(()))
    }

    /// [`remove_authenticated_file`](Self::remove_authenticated_file), with `observer` called at each
    /// [`RemovalStage`].
    pub fn remove_authenticated_file_observed(
        &self,
        name: impl AsRef<OsStr>,
        authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
        observer: Observer<'_>,
    ) -> Result<RemovalOutcome, PinnedError> {
        let name = checked_name(name.as_ref())?;
        sys::removal::remove_file(self, name, authenticate, observer)
    }

    /// Removes the child directory `name` if it has no entries, and exactly the directory that was
    /// opened.
    pub fn remove_empty_dir(&self, name: impl AsRef<OsStr>) -> Result<RemovalOutcome, PinnedError> {
        self.remove_empty_dir_observed(name, &mut |_| Ok(()))
    }

    /// [`remove_empty_dir`](Self::remove_empty_dir), with `observer` called at each [`RemovalStage`].
    pub fn remove_empty_dir_observed(
        &self,
        name: impl AsRef<OsStr>,
        observer: Observer<'_>,
    ) -> Result<RemovalOutcome, PinnedError> {
        let name = checked_name(name.as_ref())?;
        sys::removal::remove_dir(self, name, observer)
    }

    /// Finishes what a crash or a refused put-back left in the quarantine directory `quarantine` (a
    /// `.h1q-*` entry of this directory): the file in it is authenticated again and, if `authenticate`
    /// accepts it, removed like any other. A file that is not accepted stays; an empty quarantine
    /// directory is removed. Unix only: Windows creates none (`Unsupported`).
    pub fn remove_leftover_file(
        &self,
        quarantine: impl AsRef<OsStr>,
        authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    ) -> Result<RemovalOutcome, PinnedError> {
        let quarantine = checked_name(quarantine.as_ref())?;
        sys::removal::remove_leftover(self, quarantine, authenticate, &mut |_| Ok(()))
    }
}
