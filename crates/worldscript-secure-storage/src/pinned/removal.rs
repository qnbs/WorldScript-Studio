//! Gate 4 slice H1a-2, test-support only: removal that is bound to the object that was authenticated.
//!
//! **Availability.** Everything in this module exists only with the test-only `test-support` feature,
//! has no caller, and is not part of any production build. Reclamation of a real store is not admitted.
//!
//! **The two designs this replaces, and why.** Removing "the entry that was checked" with
//! `unlinkat(parent, name)` after a check on the name is exposed to a swap of the last component: POSIX
//! has no unlink-by-inode, so the call removes whatever is bound to the name at that instant, which may
//! be a live object another actor put there after the check. `FILE_FLAG_DELETE_ON_CLOSE` is chosen when
//! the handle is opened and cannot be taken back, so a file opened with it before the authentication is
//! deleted when the handle closes even if the authentication fails.
//!
//! **Unix: move aside, identify, then unlink.** The authenticated file is held open with identity `I`.
//! A quarantine directory (a random name, mode 0700, owned by the process; this is a convenience, not
//! exclusivity: another process of the same user can find and enter it) is created in the pinned parent
//! and held by descriptor, and `renameat2(RENAME_NOREPLACE)` moves whatever the name is bound to *right
//! now* into it, atomically. Only there is the object identified, by opening it and comparing the
//! identity of the open object. If it is the authenticated object it is unlinked from the quarantine
//! directory, and the link count of the open object proves afterwards that this very object lost a name;
//! if it is anything else (a live file, a link, a directory) it is moved back under its name, or left
//! in the quarantine directory if the name was taken meanwhile, and in no case unlinked.
//!
//! *Residual, stated plainly.* No Unix primitive unlinks "this inode": `unlinkat` removes the name's
//! current binding. Between the last identification and the unlink, an actor that can write into the
//! quarantine directory (same user; it has to find the random name) and wins that one-syscall race
//! can have its own regular file unlinked instead. That is detected after the fact (the link count of
//! the authenticated object did not drop) and reported as [`RemovalOutcome::Disturbed`]; it cannot be
//! undone, and it gives that actor nothing it could not do directly (it can unlink its own file and,
//! being the same user, the live one). The observer forces this window in a test, with the outcome pinned.
//!
//! **Windows: authenticate on the handle, then a disposition on that handle.** The object is opened
//! through the same handle-relative lookup as every child, with delete access and a share mode of read
//! only: no other handle can write to it, rename it or delete it while this one is held (a writer that
//! already has it open makes the open fail with [`PinnedError::Busy`]), so the bytes that were
//! authenticated are the bytes that are deleted. Only then `FileDispositionInfoEx` (delete, POSIX
//! semantics) is set on that handle. Failing authentication, an error or dropping the handle deletes
//! nothing; there is no fallback to the classic disposition.
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
    /// The authenticated object, and only it, lost this name; the durability of the directory entry
    /// change as far as the platform can confirm it.
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
    /// Unix only: the unlink removed a name of an object other than the authenticated one (see the
    /// residual in the module documentation). Nothing can be undone; the caller must treat the
    /// directory as tampered with.
    Disturbed,
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
    /// Unix only: the object is gone and the directory is about to be synced.
    BeforeSync,
}

/// Called at each [`RemovalStage`]. An error stops the removal there: before the object was moved
/// nothing has happened, after it the object is put back (a rollback); after the removal it is reported
/// and a rerun converges.
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
