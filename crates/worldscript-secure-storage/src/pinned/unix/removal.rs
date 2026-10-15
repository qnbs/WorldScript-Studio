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

/// How many hexadecimal digits follow the prefix in the name of a quarantine directory.
const SUFFIX_DIGITS: usize = 32;

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
    /// by this process although the authenticated object was. It carries what the name led to when this
    /// was seen (a look that does not follow a link), so that a replacement can be noticed later. That is
    /// weaker than for an opened object: a foreign entry is not opened (opening a link, a FIFO or a device
    /// node has effects), so no handle keeps its identity unique, and a file system may give the identity
    /// of an object that was removed to its replacement, which this look cannot tell apart.
    Foreign(ObjectIdentity),
    /// Opened, with the identity of the open object.
    Object(File, ObjectIdentity),
}

/// How a removal ended before the parent directory was synced.
enum Step {
    /// Nothing changed (a leftover that was refused); the outcome is final and nothing is synced.
    Unchanged(RemovalOutcome),
    /// The directory changed (a quarantine directory came and went, the name led nowhere, or tampering
    /// was found); the outcome is final.
    Changed(RemovalOutcome),
    /// The entry was moved aside and then put back, kept aside or found gone, so the quarantine directory
    /// changed as well as the parent; the outcome is final, and `held` is how syncing the quarantine
    /// directory went. A sync that failed does not change what the outcome says about where the entry is,
    /// and is reported after the parent was synced.
    Moved(RemovalOutcome, Result<(), PinnedError>),
    /// The object lost its name; whether the quarantine directory it was unlinked from was synced.
    Unlinked(DirectoryDurability),
    /// The entry was moved aside and put back; this is why the removal stopped.
    RolledBack(PinnedError),
    /// The entry could not be put back and stays in the quarantine directory.
    Stranded(PinnedError),
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
        // `mkdirat` returns no descriptor, so what the name leads to right now stands for the directory
        // that was made; a setup that fails removes the name again only if it still leads to that.
        let made = identity_at(parent, &name);
        match Self::made_usable(parent, &name).and_then(|fd| Self::held(fd, name.clone())) {
            Ok(held) => Ok(held),
            Err(error) => {
                if remove_if_named(parent, &name, made) {
                    // The directory came and went: sync the parent best effort, so the error does not
                    // leave an unsynced quarantine directory behind.
                    let _ = parent.sync_all();
                }
                Err(error)
            }
        }
    }

    fn held(fd: File, name: OsString) -> Result<Self, PinnedError> {
        let identity = identity_from(&fstat(&fd).map_err(io_error)?)?;
        Ok(Quarantine { fd, name, identity })
    }

    /// An existing quarantine directory of `parent`, found by its generated name: a directory of this
    /// process's user that no one else can enter. Its identity is the one seen now.
    fn open_existing(parent: &DirHandle, name: &OsStr) -> Result<Self, PinnedError> {
        if !is_generated_name(name) {
            return Err(PinnedError::InvalidName);
        }
        let fd = Self::open_owned(parent, name)?;
        if Self::mode_of(&fd)? & 0o077 != 0 {
            return Err(PinnedError::Unsupported);
        }
        Self::held(fd, name.to_os_string())
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
            Some(stat) if kind_of(&stat) != kind => return self.foreign(),
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
                return self.foreign()
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
            return self.foreign();
        }
        let identity = ObjectIdentity::new(metadata.dev(), u128::from(metadata.ino()));
        Ok(Inside::Object(object, identity))
    }

    /// An entry that is not the kind asked for, with the identity the name leads to now (a look that does
    /// not follow a link). An entry whose identity cannot be taken could not be told from a replacement
    /// later and would count as retained whatever it is, so a look that fails is an error like any other
    /// failed inspection (the entry is put back or stays aside as a failure), and a name that leads
    /// nowhere by now is `Absent`.
    fn foreign(&self) -> Result<Inside, PinnedError> {
        Ok(match stat_child(&self.fd, OsStr::new(INSIDE))? {
            None => Inside::Absent,
            Some(stat) => Inside::Foreign(identity_from(&stat)?),
        })
    }

    /// Moves the entry back under `name`; an error if that was not possible (the name is taken, or
    /// anything else prevents it), in which case the entry stays here. Only the rename: the sync of this
    /// directory is [`sync`](Self::sync), kept apart so that a sync that fails cannot be taken for a
    /// put-back that did not happen.
    fn restore(&self, parent: &DirHandle, name: &OsStr) -> Result<(), PinnedError> {
        renameat_with(&self.fd, INSIDE, parent, name, RenameFlags::NOREPLACE).map_err(io_error)
    }

    /// Syncs this directory. Every move into or out of it changes it, and the sync of the parent does
    /// not cover that: without it a crash can undo the removal of `x` after the parent shows the name
    /// again (or leave `x` missing after the parent shows the name gone).
    fn sync(&self) -> Result<(), PinnedError> {
        if let Some(error) = forced_sync_failure() {
            return Err(error);
        }
        self.fd.sync_all().map_err(PinnedError::from)
    }

    fn path_inside(&self, parent_path: &Path) -> PathBuf {
        parent_path.join(&self.name).join(INSIDE)
    }

    /// Removes this directory if it is empty. A directory that still holds an entry is left, and so is
    /// whatever the name leads to if that is no longer the directory that was created (see
    /// [`remove_if_named`]).
    fn discard(&self, parent: &DirHandle) {
        remove_if_named(parent, &self.name, Some(self.identity));
    }

    /// Whether the entry is inside, as far as a look at the name can prove it: it was looked at and is
    /// `expected`. Gone, another object, and a look that fails (a permission lost) all give `false`: an
    /// outcome that says where the entry is needs a proof, and a failed look proves nothing.
    fn holds(&self, expected: ObjectIdentity) -> bool {
        matches!(
            stat_child(&self.fd, OsStr::new(INSIDE)),
            Ok(Some(stat)) if identity_from(&stat).is_ok_and(|found| found == expected)
        )
    }

    /// Whether the name still leads to the directory that was created.
    fn is_named(&self, parent: &DirHandle) -> bool {
        identity_at(parent, &self.name) == Some(self.identity)
    }
}

/// The identity of what `name` of `parent` leads to right now, without following a link; `None` if it
/// leads nowhere or cannot be looked at.
fn identity_at(parent: &DirHandle, name: &OsStr) -> Option<ObjectIdentity> {
    stat_child(parent, name)
        .ok()
        .flatten()
        .and_then(|stat| identity_from(&stat).ok())
}

/// Removes the directory `name` of `parent` if it is empty and still leads to `expected`; whether it was
/// removed. Without an identity nothing is removed. The check narrows the race and does not close it
/// (`rmdir` takes a name, not a descriptor): what a lost race can remove is at most an empty directory.
pub(in crate::pinned) fn remove_if_named(
    parent: &DirHandle,
    name: &OsStr,
    expected: Option<ObjectIdentity>,
) -> bool {
    expected.is_some()
        && identity_at(parent, name) == expected
        && unlinkat(parent, name, AtFlags::REMOVEDIR).is_ok()
}

/// Makes the quarantine directory `name` of `parent` usable the way [`Quarantine::create`] does: the
/// owner's access is set explicitly, whatever the umask did to the mode it was created with.
#[cfg(test)]
pub(in crate::pinned) fn make_usable(parent: &DirHandle, name: &OsStr) -> Result<(), PinnedError> {
    Quarantine::made_usable(parent, name).map(|_| ())
}

/// The durability of a removal that touched two directories: confirmed only if both were synced.
pub(in crate::pinned) fn both_confirmed(
    first: DirectoryDurability,
    second: DirectoryDurability,
) -> DirectoryDurability {
    if first == DirectoryDurability::Confirmed && second == DirectoryDurability::Confirmed {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    }
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

/// Looks at what a crash or a refused put-back left in `held`, authenticates it again and unlinks it
/// like any other removal: the quarantine directory is synced for what the unlink changed in it.
fn leftover_step(
    held: &Quarantine,
    dir: &PinnedDir,
    authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    observer: Observer<'_>,
) -> Result<Step, PinnedError> {
    let (file, identity) = match held.inspect(EntryKind::File)? {
        // An empty quarantine directory is junk and goes with `discard`.
        Inside::Absent => return Ok(Step::Changed(RemovalOutcome::Vanished)),
        Inside::Foreign(_) => return Ok(Step::Unchanged(RemovalOutcome::Refused)),
        Inside::Object(file, identity) => (file, identity),
    };
    let mut pinned = PinnedFile { file, identity };
    if !authenticate(&mut pinned)? {
        return Ok(Step::Unchanged(RemovalOutcome::Refused));
    }
    observer(RemovalStage::Identified {
        quarantined: &held.path_inside(&dir.path),
    })?;
    let outcome = unlink_verified(held, &pinned.file, EntryKind::File)?;
    Ok(unlinked(outcome, held.sync()))
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
        match self.quarantine.adopt(&self.dir.handle, self.target.name) {
            // Nothing was moved, but the quarantine directory came and went: the parent changed.
            Err(cause) => return Ok(Step::RolledBack(cause)),
            Ok(false) => return Ok(Step::Changed(RemovalOutcome::Vanished)),
            Ok(true) => {}
        }
        match self.judge(observer) {
            Err(cause) => {
                let put_back = self.restore();
                // The failure that is reported is `cause`, and a sync that fails does not replace it.
                let _ = self.quarantine.sync();
                match put_back {
                    Ok(()) => Ok(Step::RolledBack(cause)),
                    Err(_) if self.retained(self.target.expected) => Ok(Step::Stranded(cause)),
                    Err(_) => Ok(Step::Changed(RemovalOutcome::Disturbed)),
                }
            }
            step => step,
        }
    }

    fn judge(&self, observer: Observer<'_>) -> Result<Step, PinnedError> {
        let inside = self.quarantine.path_inside(&self.dir.path);
        observer(RemovalStage::MovedAside {
            quarantined: &inside,
        })?;
        match self.quarantine.inspect(self.target.kind)? {
            // An actor removed the entry after it was moved here: that moved it into this directory, and
            // out again, without the sync of the parent covering either.
            Inside::Absent => Ok(Step::Moved(
                RemovalOutcome::Vanished,
                self.quarantine.sync(),
            )),
            Inside::Object(object, found) if found == self.target.expected => {
                self.conclude(&object, observer)
            }
            Inside::Object(_, found) => self.swapped(found),
            Inside::Foreign(seen) => self.swapped(seen),
        }
    }

    /// What arrived is not the authenticated object: it goes back under its name, or stays aside if
    /// that is impossible (and is then still `arrived`, the identity it was seen with). Either way the
    /// quarantine directory changed (the entry left it, or arrived in it), and it is synced after the
    /// rename was tried: the rename alone decides `restored`, so a sync that fails is neither a put-back
    /// that did not happen nor a reason to call the entry tampered with.
    fn swapped(&self, arrived: ObjectIdentity) -> Result<Step, PinnedError> {
        let restored = self.restore().is_ok();
        let held = self.quarantine.sync();
        if !restored && !self.retained(arrived) {
            return Ok(Step::Changed(RemovalOutcome::Disturbed));
        }
        Ok(Step::Moved(RemovalOutcome::Swapped { restored }, held))
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
                Ok(Step::Moved(
                    RemovalOutcome::NotEmpty,
                    self.quarantine.sync(),
                ))
            }
            outcome => {
                // The unlink changed the directory that is held, and that directory can outlive the
                // removal (an actor renamed it away, or put an entry into it so that it cannot be
                // removed). The parent sync does not cover it, so it is synced here, and a sync that
                // fails leaves the removal unconfirmed.
                Ok(unlinked(outcome, self.quarantine.sync()))
            }
        }
    }

    fn restore(&self) -> Result<(), PinnedError> {
        self.quarantine.restore(&self.dir.handle, self.target.name)
    }

    /// The entry stays in the quarantine directory: the outcome may only say where the entry is if the
    /// recorded name still leads to the directory that holds it and the entry in it was looked at and is
    /// still `expected`. If an actor renamed that directory away, or removed or replaced the entry, or
    /// the look fails, the entry cannot be shown where the outcome would say, and that is reported as
    /// tampering (it is not known to be absent, but nothing can be proved). Syncing that directory,
    /// which changed as well as the parent, is up to the caller.
    fn retained(&self, expected: ObjectIdentity) -> bool {
        self.quarantine.is_named(&self.dir.handle) && self.quarantine.holds(expected)
    }
}

/// What the unlink came to, with how syncing the quarantine directory it was made in went: a removal is
/// confirmed only if that sync worked, and an entry that was gone by the time of the unlink is reported
/// like one that was gone before it. Tampering (`Disturbed`) outranks a failed sync.
fn unlinked(outcome: RemovalOutcome, held: Result<(), PinnedError>) -> Step {
    match outcome {
        RemovalOutcome::Removed(_) => Step::Unlinked(match held {
            Ok(()) => DirectoryDurability::Confirmed,
            Err(_) => DirectoryDurability::NotConfirmed,
        }),
        RemovalOutcome::Vanished => Step::Moved(outcome, held),
        other => Step::Changed(other),
    }
}

/// Syncs the parent directory if anything in it changed. A sync that fails is an error although the
/// entry is gone or back: a crash may undo that, and the caller repeats [`PinnedDir::sync`] (a rerun of
/// the removal finds nothing to do and would not sync). The same holds for the quarantine directory of an
/// entry that was put back or kept aside; it is reported after the parent was synced, whether or not the
/// directory is removed afterwards, since a sync that failed proves nothing about what reached the disk.
fn settle(
    dir: &PinnedDir,
    step: Step,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    match step {
        Step::Unchanged(outcome) => Ok(outcome),
        Step::RolledBack(cause) => {
            sync_after_failure(dir, observer);
            Err(cause)
        }
        Step::Stranded(cause) => {
            sync_after_failure(dir, observer);
            Ok(RemovalOutcome::Stranded { cause })
        }
        Step::Changed(outcome) => {
            observer(RemovalStage::BeforeSync)?;
            dir.sync()?;
            Ok(outcome)
        }
        Step::Moved(outcome, held) => {
            observer(RemovalStage::BeforeSync)?;
            dir.sync()?;
            held.map(|()| outcome)
        }
        Step::Unlinked(held) => {
            observer(RemovalStage::BeforeSync)?;
            Ok(RemovalOutcome::Removed(both_confirmed(dir.sync()?, held)))
        }
    }
}

/// After a failure that moved an entry aside and back (or left it aside) the directory has changed too:
/// the sync is attempted, and its own failure does not replace the failure that is being reported.
fn sync_after_failure(dir: &PinnedDir, observer: Observer<'_>) {
    let _ = observer(RemovalStage::BeforeSync);
    let _ = dir.sync();
}

/// The failure a test forced on the sync of a quarantine directory, if any. An `fsync` error on a
/// directory cannot be provoked portably, so the sync asks here first; a build without tests never does.
#[cfg(test)]
fn forced_sync_failure() -> Option<PinnedError> {
    sync_fault::asked()
}

#[cfg(not(test))]
fn forced_sync_failure() -> Option<PinnedError> {
    None
}

/// The seam behind [`forced_sync_failure`]: a test runs a removal with the sync of the quarantine
/// directory failing (or not), and learns how often that sync was asked for.
#[cfg(test)]
pub(in crate::pinned) mod sync_fault {
    use std::cell::Cell;
    use std::fs;
    use std::path::PathBuf;

    use crate::pinned::PinnedError;

    thread_local! {
        static FAILURE: Cell<Option<PinnedError>> = const { Cell::new(None) };
        static ASKED: Cell<usize> = const { Cell::new(0) };
        static REPLACE: Cell<Option<PathBuf>> = const { Cell::new(None) };
    }

    /// Disarms the seam when the removal under test ends, also by a panic.
    struct Disarm;

    impl Drop for Disarm {
        fn drop(&mut self) {
            FAILURE.set(None);
            REPLACE.set(None);
        }
    }

    /// Makes the next sync of a quarantine directory replace the entry at `entry` by another object
    /// first, the way an actor could after the entry was inspected and before it is looked at again:
    /// no stage of the observer sits between the two.
    pub(in crate::pinned) fn replace_at_next_sync(entry: PathBuf) {
        REPLACE.set(Some(entry));
    }

    /// Runs `body` with every sync of a quarantine directory failing with `failure` (none: succeeding),
    /// and returns what it returned with the number of syncs that were asked for.
    pub(in crate::pinned) fn during<T>(
        failure: Option<PinnedError>,
        body: impl FnOnce() -> T,
    ) -> (T, usize) {
        FAILURE.set(failure);
        ASKED.set(0);
        let _disarm = Disarm;
        let result = body();
        (result, ASKED.get())
    }

    pub(super) fn asked() -> Option<PinnedError> {
        ASKED.set(ASKED.get() + 1);
        if let Some(entry) = REPLACE.take() {
            fs::rename(&entry, entry.with_extension("moved")).unwrap();
            fs::write(&entry, b"impostor").unwrap();
        }
        FAILURE.get()
    }
}
