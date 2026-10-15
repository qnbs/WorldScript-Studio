//! Unix removal, test-support only: move the entry into a quarantine directory, identify the open
//! object there, and only then unlink it. See the parent `removal` module for the reasoning and for the
//! one window that no Unix primitive closes.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use rustix::fs::{
    fchmod, fstat, mkdirat, openat, renameat_with, unlinkat, AtFlags, Mode, RenameFlags,
};
use rustix::io::Errno;
use rustix::process::geteuid;

use super::{dir_flags, file_flags, io_error, kind_of, stat_child, widen, DirHandle};
use crate::durable::{DirectoryDurability, EntryKind};
use crate::pinned::{
    ObjectIdentity, Observer, PinnedDir, PinnedError, PinnedFile, RemovalOutcome, RemovalStage,
    QUARANTINE_PREFIX,
};
use crate::random::{OsRandom, RandomSource};

/// The name an entry has inside the quarantine directory.
pub(in crate::pinned) const INSIDE: &str = "x";

/// How many hexadecimal digits follow the prefix in the name of a quarantine directory.
const SUFFIX_DIGITS: usize = 32;

/// A quarantine directory inside the pinned parent, held by descriptor. Whatever it holds is outside
/// every name grammar of the store and is never removed by a sweep.
struct Quarantine {
    fd: File,
    name: OsString,
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
}

/// Whether `name` is exactly what [`Quarantine::create`] produces.
fn is_generated_name(name: &OsStr) -> bool {
    let bytes = name.as_bytes();
    let prefix = QUARANTINE_PREFIX.as_bytes();
    bytes.len() == prefix.len() + SUFFIX_DIGITS
        && bytes.starts_with(prefix)
        && bytes[prefix.len()..]
            .iter()
            .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
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
        match Self::made_usable(parent, &name) {
            Ok(fd) => Ok(Quarantine { fd, name }),
            Err(error) => {
                let _ = unlinkat(parent, &name, AtFlags::REMOVEDIR);
                Err(error)
            }
        }
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

    /// An existing quarantine directory of `parent`, found by its generated name.
    fn open_existing(parent: &DirHandle, name: &OsStr) -> Result<Self, PinnedError> {
        if !is_generated_name(name) {
            return Err(PinnedError::InvalidName);
        }
        let fd = Self::open_owned(parent, name)?;
        if Self::mode_of(&fd)? & 0o077 != 0 {
            return Err(PinnedError::Unsupported);
        }
        Ok(Quarantine {
            fd,
            name: name.to_os_string(),
        })
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

    /// Removes this directory if it is empty. A directory that still holds an entry is left.
    fn discard(&self, parent: &DirHandle) {
        let _ = unlinkat(parent, &self.name, AtFlags::REMOVEDIR);
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
    let target = Target {
        name,
        expected: child.identity(),
        kind: EntryKind::Directory,
    };
    remove_moved(dir, target, observer)
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
        // An empty quarantine directory is junk and goes with `discard`.
        Inside::Absent => return Ok(Step::Changed(RemovalOutcome::Vanished)),
        Inside::Foreign => return Ok(Step::Unchanged(RemovalOutcome::Refused)),
        Inside::Object(file, identity) => (file, identity),
    };
    let mut pinned = PinnedFile { file, identity };
    if !authenticate(&mut pinned)? {
        return Ok(Step::Unchanged(RemovalOutcome::Refused));
    }
    observer(RemovalStage::Identified {
        quarantined: &held.path_inside(&dir.path),
    })?;
    Ok(unlinked(unlink_verified(
        held,
        &pinned.file,
        EntryKind::File,
    )?))
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
                Ok(()) => Err(cause),
                Err(_) => Ok(Step::Unchanged(RemovalOutcome::Stranded { cause })),
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
