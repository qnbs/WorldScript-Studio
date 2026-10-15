//! Unix removal, test-support only: move the object into a quarantine directory, identify the open
//! object there, and only then unlink it. See the parent `removal` module for the reasoning and for the
//! one residual that no Unix primitive removes.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use rustix::fs::{mkdirat, openat, renameat_with, unlinkat, AtFlags, Mode, RenameFlags};
use rustix::io::Errno;
use rustix::process::geteuid;

use super::{dir_flags, file_flags, io_error, kind_of, stat_child, widen, DirHandle};
use crate::durable::{DirectoryDurability, EntryKind};
use crate::pinned::{
    ObjectIdentity, Observer, PinnedDir, PinnedError, PinnedFile, RemovalOutcome, RemovalStage,
    QUARANTINE_PREFIX,
};
use crate::random::{OsRandom, RandomSource};

/// The name an object has inside the quarantine directory.
pub(in crate::pinned) const INSIDE: &str = "x";

/// A quarantine directory inside the pinned parent, held by descriptor. Whatever it holds is outside
/// every name grammar of the store and is never removed by a sweep.
struct Quarantine {
    fd: File,
    name: OsString,
}

/// What is bound to the quarantine name right now.
enum Inside {
    Absent,
    /// Not the kind that was asked for (a link, a directory instead of a file, a FIFO).
    Foreign,
    /// Opened, with the identity of the open object.
    Object(File, ObjectIdentity),
}

/// How a removal ended before the durability of the parent directory was settled.
enum Step {
    Finished(RemovalOutcome),
    Unlinked,
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
        match Self::open_private(parent, &name) {
            Ok(fd) => Ok(Quarantine { fd, name }),
            Err(error) => {
                let _ = unlinkat(parent, &name, AtFlags::REMOVEDIR);
                Err(error)
            }
        }
    }

    /// An existing quarantine directory of `parent`, found by its name.
    fn open_existing(parent: &DirHandle, name: &OsStr) -> Result<Self, PinnedError> {
        if !name.as_bytes().starts_with(QUARANTINE_PREFIX.as_bytes()) {
            return Err(PinnedError::InvalidName);
        }
        let fd = Self::open_private(parent, name)?;
        Ok(Quarantine {
            fd,
            name: name.to_os_string(),
        })
    }

    /// The directory `name`, if it is a directory of this process's user that has no access for group
    /// or others. That keeps out a directory of another user that was swapped in; it does not keep out
    /// the same user, which the removal does not rely on.
    fn open_private(parent: &DirHandle, name: &OsStr) -> Result<File, PinnedError> {
        let fd = File::from(openat(parent, name, dir_flags(), Mode::empty()).map_err(io_error)?);
        let stat = rustix::fs::fstat(&fd).map_err(io_error)?;
        let private = kind_of(&stat) == EntryKind::Directory
            && stat.st_uid == geteuid().as_raw()
            && widen(stat.st_mode)? & 0o077 == 0;
        if private {
            Ok(fd)
        } else {
            Err(PinnedError::Unsupported)
        }
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
            // Swapped between the look and the open.
            Err(Errno::LOOP | Errno::NOTDIR | Errno::ISDIR | Errno::NXIO) => {
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

    /// Moves the object back under `name`; `false` if the name is taken (or anything else prevents it),
    /// in which case the object stays here.
    fn restore(&self, parent: &DirHandle, name: &OsStr) -> bool {
        renameat_with(&self.fd, INSIDE, parent, name, RenameFlags::NOREPLACE).is_ok()
    }

    fn path_inside(&self, parent_path: &Path) -> PathBuf {
        parent_path.join(&self.name).join(INSIDE)
    }

    /// Removes this directory if it is empty. A directory that still holds an object is left.
    fn discard(self, parent: &DirHandle) {
        let _ = unlinkat(parent, &self.name, AtFlags::REMOVEDIR);
    }
}

/// Unlinks the object `object` that was identified in the quarantine directory. Afterwards the link
/// count of the open file must have dropped by one: if it did not, the name was bound to another
/// object when it was unlinked.
fn unlink_verified(
    quarantine: &Quarantine,
    object: &File,
    kind: EntryKind,
) -> Result<RemovalOutcome, PinnedError> {
    if kind == EntryKind::Directory {
        return match unlinkat(&quarantine.fd, INSIDE, AtFlags::REMOVEDIR) {
            Ok(()) => Ok(RemovalOutcome::Removed(DirectoryDurability::Confirmed)),
            Err(Errno::NOTEMPTY | Errno::EXIST) => Ok(RemovalOutcome::NotEmpty),
            Err(Errno::NOENT) => Ok(RemovalOutcome::Vanished),
            Err(errno) => Err(io_error(errno)),
        };
    }
    let before = object.metadata().map_err(PinnedError::from)?.nlink();
    match unlinkat(&quarantine.fd, INSIDE, AtFlags::empty()) {
        Ok(()) => {}
        Err(Errno::NOENT) => return Ok(RemovalOutcome::Vanished),
        Err(errno) => return Err(io_error(errno)),
    }
    let after = object.metadata().map_err(PinnedError::from)?.nlink();
    if after + 1 == before {
        Ok(RemovalOutcome::Removed(DirectoryDurability::Confirmed))
    } else {
        Ok(RemovalOutcome::Disturbed)
    }
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
    remove_moved(dir, name, file.identity(), EntryKind::File, observer)
}

pub(in crate::pinned) fn remove_dir(
    dir: &PinnedDir,
    name: &OsStr,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    let child = dir.open_dir(name)?;
    match child.entries(0) {
        Ok(_) => {}
        Err(PinnedError::TooManyEntries) => return Ok(RemovalOutcome::NotEmpty),
        Err(error) => return Err(error),
    }
    observer(RemovalStage::Checked)?;
    remove_moved(dir, name, child.identity(), EntryKind::Directory, observer)
}

/// Removes the leftover file of the quarantine directory `quarantine` after authenticating it again.
pub(in crate::pinned) fn remove_leftover(
    dir: &PinnedDir,
    quarantine: &OsStr,
    authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    let held = Quarantine::open_existing(&dir.handle, quarantine)?;
    let step = leftover_step(&held, dir, authenticate, observer);
    held.discard(&dir.handle);
    settle(dir, step?, observer)
}

fn leftover_step(
    held: &Quarantine,
    dir: &PinnedDir,
    authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    observer: Observer<'_>,
) -> Result<Step, PinnedError> {
    let (file, identity) = match held.inspect(EntryKind::File)? {
        Inside::Absent => return Ok(Step::Finished(RemovalOutcome::Vanished)),
        Inside::Foreign => return Ok(Step::Finished(RemovalOutcome::Refused)),
        Inside::Object(file, identity) => (file, identity),
    };
    let mut pinned = PinnedFile { file, identity };
    if !authenticate(&mut pinned)? {
        return Ok(Step::Finished(RemovalOutcome::Refused));
    }
    observer(RemovalStage::Identified {
        quarantined: &held.path_inside(&dir.path),
    })?;
    unlinked(unlink_verified(held, &pinned.file, EntryKind::File)?)
}

/// Removes the entry `name` of `dir` if, once moved aside, it is the object `expected` of kind `kind`.
fn remove_moved(
    dir: &PinnedDir,
    name: &OsStr,
    expected: ObjectIdentity,
    kind: EntryKind,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    let quarantine = Quarantine::create(&dir.handle)?;
    let step = detach(&quarantine, dir, name, expected, kind, observer);
    quarantine.discard(&dir.handle);
    settle(dir, step?, observer)
}

fn detach(
    quarantine: &Quarantine,
    dir: &PinnedDir,
    name: &OsStr,
    expected: ObjectIdentity,
    kind: EntryKind,
    observer: Observer<'_>,
) -> Result<Step, PinnedError> {
    if !quarantine.adopt(&dir.handle, name)? {
        return Ok(Step::Finished(RemovalOutcome::Vanished));
    }
    let inside = quarantine.path_inside(&dir.path);
    rolled_back(
        quarantine,
        dir,
        name,
        observer(RemovalStage::MovedAside {
            quarantined: &inside,
        }),
    )?;
    match quarantine.inspect(kind)? {
        Inside::Absent => Ok(Step::Finished(RemovalOutcome::Vanished)),
        Inside::Object(object, found) if found == expected => {
            conclude(quarantine, dir, name, &object, kind, observer)
        }
        Inside::Object(..) | Inside::Foreign => {
            let restored = quarantine.restore(&dir.handle, name);
            Ok(Step::Finished(RemovalOutcome::Swapped { restored }))
        }
    }
}

/// The last window: the object in the quarantine directory is the authenticated one.
fn conclude(
    quarantine: &Quarantine,
    dir: &PinnedDir,
    name: &OsStr,
    object: &File,
    kind: EntryKind,
    observer: Observer<'_>,
) -> Result<Step, PinnedError> {
    let inside = quarantine.path_inside(&dir.path);
    rolled_back(
        quarantine,
        dir,
        name,
        observer(RemovalStage::Identified {
            quarantined: &inside,
        }),
    )?;
    match unlink_verified(quarantine, object, kind) {
        Ok(RemovalOutcome::NotEmpty) => {
            // A directory that filled after the check goes back where it was.
            quarantine.restore(&dir.handle, name);
            Ok(Step::Finished(RemovalOutcome::NotEmpty))
        }
        Ok(outcome) => unlinked(outcome),
        Err(error) => {
            quarantine.restore(&dir.handle, name);
            Err(error)
        }
    }
}

fn unlinked(outcome: RemovalOutcome) -> Result<Step, PinnedError> {
    Ok(match outcome {
        RemovalOutcome::Removed(_) => Step::Unlinked,
        other => Step::Finished(other),
    })
}

/// `result`, and if it is an error the object is put back first: a failure after the move leaves the
/// directory as it was found.
fn rolled_back(
    quarantine: &Quarantine,
    dir: &PinnedDir,
    name: &OsStr,
    result: Result<(), PinnedError>,
) -> Result<(), PinnedError> {
    if result.is_err() {
        quarantine.restore(&dir.handle, name);
    }
    result
}

/// Settles the durability of the parent directory after the quarantine directory was dealt with. A sync
/// that fails is an error although the object is gone: a crash may undo the removal, and a rerun
/// converges.
fn settle(
    dir: &PinnedDir,
    step: Step,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    match step {
        Step::Finished(outcome) => Ok(outcome),
        Step::Unlinked => {
            observer(RemovalStage::BeforeSync)?;
            Ok(RemovalOutcome::Removed(dir.sync()?))
        }
    }
}
