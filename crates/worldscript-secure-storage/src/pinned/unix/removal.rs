//! Unix removal, test-support only: move the entry into a quarantine directory, identify the open
//! object there, and only then unlink it. See the parent `removal` module for the reasoning and for the
//! one window that no Unix primitive closes. This part removes files; directories and the leftover
//! recovery follow and refuse with `Unsupported` until then.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use rustix::fs::{
    fchmod, fstat, mkdirat, openat, renameat_with, unlinkat, AtFlags, Mode, RenameFlags,
};
use rustix::io::Errno;
use rustix::process::geteuid;

use super::{
    dir_flags, file_flags, identity_from, io_error, kind_of, stat_child, widen, DirHandle,
};
use crate::durable::{DirectoryDurability, EntryKind};
use crate::pinned::{
    ObjectIdentity, Observer, PinnedDir, PinnedError, PinnedFile, RemovalOutcome, RemovalStage,
    QUARANTINE_PREFIX,
};
use crate::random::{OsRandom, RandomSource};

/// The name an entry has inside the quarantine directory.
pub(in crate::pinned) const INSIDE: &str = "x";

/// A quarantine directory inside the pinned parent, held by descriptor. Whatever it holds is outside
/// every name grammar of the store and is never removed by a sweep.
struct Quarantine {
    fd: File,
    name: OsString,
    /// The directory that was created, to tell it from whatever the name leads to later.
    identity: ObjectIdentity,
}

/// What is bound to the quarantine name right now.
enum Inside {
    Absent,
    /// Not the kind that was asked for (a link, a directory instead of a file, a FIFO), or not openable
    /// by this process although the authenticated object was.
    Foreign,
    /// Opened, with the identity of the open object.
    Object(File, ObjectIdentity),
}

/// How a removal ended before the parent directory was synced.
enum Step {
    /// Nothing in the directory changed.
    Unchanged(RemovalOutcome),
    /// The directory changed (an entry was moved and put back, or a quarantine directory came and
    /// went); the outcome is final.
    Changed(RemovalOutcome),
    /// The object lost its name.
    Unlinked,
    /// The entry was moved aside and put back; this is why the removal stopped.
    RolledBack(PinnedError),
    /// The entry could not be put back and stays in the quarantine directory.
    Stranded(PinnedError),
}

impl Quarantine {
    fn create(parent: &DirHandle) -> Result<Self, PinnedError> {
        let mut bits = [0u8; 16];
        OsRandom
            .fill(&mut bits)
            .map_err(|_| PinnedError::Unsupported)?;
        let suffix: String = bits.iter().map(|byte| format!("{byte:02x}")).collect();
        let name = OsString::from(format!("{QUARANTINE_PREFIX}{suffix}"));
        mkdirat(parent, &name, Mode::RWXU).map_err(io_error)?;
        match Self::made_usable(parent, &name).and_then(|fd| Self::held(fd, name.clone())) {
            Ok(held) => Ok(held),
            Err(error) => {
                let _ = unlinkat(parent, &name, AtFlags::REMOVEDIR);
                Err(error)
            }
        }
    }

    fn held(fd: File, name: OsString) -> Result<Self, PinnedError> {
        let identity = identity_from(&fstat(&fd).map_err(io_error)?)?;
        Ok(Quarantine { fd, name, identity })
    }

    /// The directory just created, with the owner's access set explicitly (a restrictive umask would
    /// otherwise leave a directory that nothing can be moved into) and checked.
    fn made_usable(parent: &DirHandle, name: &OsStr) -> Result<File, PinnedError> {
        let fd = Self::open_owned(parent, name)?;
        fchmod(&fd, Mode::RWXU).map_err(io_error)?;
        let mode = Self::mode_of(&fd)?;
        if mode & 0o077 == 0 && mode & 0o700 == 0o700 {
            Ok(fd)
        } else {
            Err(PinnedError::Unsupported)
        }
    }

    /// The directory `name`, if it is a directory of this process's user (one of another user that was
    /// swapped in is refused; the same user is not kept out, which the removal does not rely on).
    fn open_owned(parent: &DirHandle, name: &OsStr) -> Result<File, PinnedError> {
        let fd = File::from(openat(parent, name, dir_flags(), Mode::empty()).map_err(io_error)?);
        let stat = fstat(&fd).map_err(io_error)?;
        if kind_of(&stat) == EntryKind::Directory && stat.st_uid == geteuid().as_raw() {
            Ok(fd)
        } else {
            Err(PinnedError::Unsupported)
        }
    }

    fn mode_of(fd: &File) -> Result<u64, PinnedError> {
        widen(fstat(fd).map_err(io_error)?.st_mode)
    }

    /// Moves what `name` of `parent` is bound to right now into this directory; `false` if the name
    /// leads nowhere.
    fn adopt(&self, parent: &DirHandle, name: &OsStr) -> Result<bool, PinnedError> {
        match renameat_with(parent, name, &self.fd, INSIDE, RenameFlags::NOREPLACE) {
            Ok(()) => Ok(true),
            Err(Errno::NOENT) => Ok(false),
            // No RENAME_NOREPLACE here: nothing was moved, so nothing can be identified safely.
            Err(Errno::INVAL | Errno::NOSYS | Errno::NOTSUP) => Err(PinnedError::Unsupported),
            Err(errno) => Err(io_error(errno)),
        }
    }

    /// Looks at the entry before it is opened (opening a device node runs its driver), then opens it
    /// without following a link and reports the identity of the open object.
    fn inspect(&self, kind: EntryKind) -> Result<Inside, PinnedError> {
        let inside = OsStr::new(INSIDE);
        match stat_child(&self.fd, inside)? {
            None => return Ok(Inside::Absent),
            Some(stat) if kind_of(&stat) != kind => return Ok(Inside::Foreign),
            Some(_) => {}
        }
        let flags = if kind == EntryKind::Directory {
            dir_flags()
        } else {
            file_flags()
        };
        let object = match openat(&self.fd, inside, flags, Mode::empty()) {
            Ok(fd) => File::from(fd),
            Err(Errno::NOENT) => return Ok(Inside::Absent),
            // Swapped between the look and the open, or not openable: not the object that was opened
            // before, which this process could open.
            Err(Errno::LOOP | Errno::NOTDIR | Errno::ISDIR | Errno::NXIO | Errno::ACCESS) => {
                return Ok(Inside::Foreign)
            }
            Err(errno) => return Err(io_error(errno)),
        };
        let metadata = object.metadata().map_err(PinnedError::from)?;
        let right_kind = if kind == EntryKind::Directory {
            metadata.is_dir()
        } else {
            metadata.is_file()
        };
        if !right_kind {
            return Ok(Inside::Foreign);
        }
        let identity = ObjectIdentity::new(metadata.dev(), u128::from(metadata.ino()));
        Ok(Inside::Object(object, identity))
    }

    /// Moves the entry back under `name`; an error if that was not possible (the name is taken, or
    /// anything else prevents it), in which case the entry stays here.
    fn restore(&self, parent: &DirHandle, name: &OsStr) -> Result<(), PinnedError> {
        renameat_with(&self.fd, INSIDE, parent, name, RenameFlags::NOREPLACE).map_err(io_error)
    }

    fn path_inside(&self, parent_path: &Path) -> PathBuf {
        parent_path.join(&self.name).join(INSIDE)
    }

    /// Removes this directory if it is empty. A directory that still holds an entry is left, and so is
    /// whatever the name leads to if that is no longer the directory that was created (the name is all
    /// there is to remove it by; what is removed is at most an empty directory).
    fn discard(&self, parent: &DirHandle) {
        let still_ours = stat_child(parent, &self.name)
            .ok()
            .flatten()
            .and_then(|stat| identity_from(&stat).ok())
            .is_some_and(|found| found == self.identity);
        if still_ours {
            let _ = unlinkat(parent, &self.name, AtFlags::REMOVEDIR);
        }
    }
}

/// Makes the quarantine directory `name` of `parent` usable the way [`Quarantine::create`] does: the
/// owner's access is set explicitly, whatever the umask did to the mode it was created with.
#[cfg(test)]
pub(in crate::pinned) fn make_usable(parent: &DirHandle, name: &OsStr) -> Result<(), PinnedError> {
    Quarantine::made_usable(parent, name).map(|_| ())
}

/// Unlinks the entry that was identified in the quarantine directory and asks the open object whether
/// it was the one that lost a name: its link count must have dropped. That is a check after the fact
/// and a heuristic, not a proof of identity (see the residual in the parent module): an actor that also
/// changes the link count of the authenticated object in the same window is not noticed.
fn unlink_verified(
    quarantine: &Quarantine,
    object: &File,
    kind: EntryKind,
) -> Result<RemovalOutcome, PinnedError> {
    let before = object.metadata().map_err(PinnedError::from)?.nlink();
    let flags = if kind == EntryKind::Directory {
        AtFlags::REMOVEDIR
    } else {
        AtFlags::empty()
    };
    match unlinkat(&quarantine.fd, INSIDE, flags) {
        Ok(()) => {}
        Err(Errno::NOTEMPTY | Errno::EXIST) if kind == EntryKind::Directory => {
            return Ok(RemovalOutcome::NotEmpty)
        }
        Err(Errno::NOENT) => return Ok(RemovalOutcome::Vanished),
        Err(errno) => return Err(io_error(errno)),
    }
    // Nothing can be said about a removal that cannot be checked afterwards.
    let Ok(after) = object.metadata().map(|metadata| metadata.nlink()) else {
        return Ok(RemovalOutcome::Disturbed);
    };
    if after < before {
        Ok(RemovalOutcome::Removed(DirectoryDurability::Confirmed))
    } else {
        Ok(RemovalOutcome::Disturbed)
    }
}

/// The entry of a removal: its name, the object it must turn out to be and the kind it must have.
struct Target<'a> {
    name: &'a OsStr,
    expected: ObjectIdentity,
    kind: EntryKind,
}

/// One removal in progress: the directory, the entry and the quarantine directory it moves through.
struct Removal<'a> {
    dir: &'a PinnedDir,
    target: Target<'a>,
    quarantine: Quarantine,
}

pub(in crate::pinned) fn remove_file(
    dir: &PinnedDir,
    name: &OsStr,
    authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    let mut file = dir.open_file(name)?;
    if !authenticate(&mut file)? {
        return Ok(RemovalOutcome::Refused);
    }
    observer(RemovalStage::Checked)?;
    let target = Target {
        name,
        expected: file.identity(),
        kind: EntryKind::File,
    };
    remove_moved(dir, target, observer)
}

/// Removes the entry of `target` from `dir` if, once moved aside, it is the object it must be.
fn remove_moved(
    dir: &PinnedDir,
    target: Target<'_>,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    let removal = Removal {
        dir,
        target,
        quarantine: Quarantine::create(&dir.handle)?,
    };
    let step = removal.detach(observer);
    removal.quarantine.discard(&dir.handle);
    settle(dir, step?, observer)
}

impl Removal<'_> {
    /// Moves the entry into the quarantine directory and judges what arrived there. Whatever fails after
    /// the move puts the entry back first; if that is impossible the removal says so
    /// ([`RemovalOutcome::Stranded`]) instead of reporting an error that hides where the entry is.
    fn detach(&self, observer: Observer<'_>) -> Result<Step, PinnedError> {
        if !self.quarantine.adopt(&self.dir.handle, self.target.name)? {
            return Ok(Step::Unchanged(RemovalOutcome::Vanished));
        }
        match self.judge(observer) {
            Err(cause) => match self.restore() {
                Ok(()) => Ok(Step::RolledBack(cause)),
                Err(_) => Ok(Step::Stranded(cause)),
            },
            step => step,
        }
    }

    fn judge(&self, observer: Observer<'_>) -> Result<Step, PinnedError> {
        let inside = self.quarantine.path_inside(&self.dir.path);
        observer(RemovalStage::MovedAside {
            quarantined: &inside,
        })?;
        match self.quarantine.inspect(self.target.kind)? {
            Inside::Absent => Ok(Step::Changed(RemovalOutcome::Vanished)),
            Inside::Object(object, found) if found == self.target.expected => {
                self.conclude(&object, observer)
            }
            Inside::Object(..) | Inside::Foreign => {
                let restored = self.restore().is_ok();
                Ok(Step::Changed(RemovalOutcome::Swapped { restored }))
            }
        }
    }

    /// The last window: the entry in the quarantine directory is the authenticated object.
    fn conclude(&self, object: &File, observer: Observer<'_>) -> Result<Step, PinnedError> {
        let inside = self.quarantine.path_inside(&self.dir.path);
        observer(RemovalStage::Identified {
            quarantined: &inside,
        })?;
        match unlink_verified(&self.quarantine, object, self.target.kind)? {
            // A directory that filled after the check goes back where it was.
            RemovalOutcome::NotEmpty => {
                self.restore()?;
                Ok(Step::Changed(RemovalOutcome::NotEmpty))
            }
            outcome => Ok(unlinked(outcome)),
        }
    }

    fn restore(&self) -> Result<(), PinnedError> {
        self.quarantine.restore(&self.dir.handle, self.target.name)
    }
}

fn unlinked(outcome: RemovalOutcome) -> Step {
    match outcome {
        RemovalOutcome::Removed(_) => Step::Unlinked,
        other => Step::Changed(other),
    }
}

/// Syncs the parent directory if anything in it changed. A sync that fails is an error although the
/// entry is gone or back: a crash may undo that, and the caller repeats [`PinnedDir::sync`] (a rerun of
/// the removal finds nothing to do and would not sync).
fn settle(
    dir: &PinnedDir,
    step: Step,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    match step {
        Step::RolledBack(cause) => {
            sync_after_failure(dir, observer);
            Err(cause)
        }
        Step::Stranded(cause) => {
            sync_after_failure(dir, observer);
            Ok(RemovalOutcome::Stranded { cause })
        }
        Step::Unchanged(outcome) => Ok(outcome),
        Step::Changed(outcome) => {
            observer(RemovalStage::BeforeSync)?;
            dir.sync()?;
            Ok(outcome)
        }
        Step::Unlinked => {
            observer(RemovalStage::BeforeSync)?;
            Ok(RemovalOutcome::Removed(dir.sync()?))
        }
    }
}

/// Removing a directory follows in the next part.
pub(in crate::pinned) fn remove_dir(
    _dir: &PinnedDir,
    _name: &OsStr,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}

/// Finishing a leftover quarantine directory follows in the next part.
pub(in crate::pinned) fn remove_leftover(
    _dir: &PinnedDir,
    _quarantine: &OsStr,
    _authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}

/// After a failure that moved an entry aside and back (or left it aside) the directory has changed too:
/// the sync is attempted, and its own failure does not replace the failure that is being reported.
fn sync_after_failure(dir: &PinnedDir, observer: Observer<'_>) {
    let _ = observer(RemovalStage::BeforeSync);
    let _ = dir.sync();
}
