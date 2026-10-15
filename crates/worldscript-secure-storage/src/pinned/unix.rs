//! Unix: every step is an `*at` call on a descriptor of the directory that was opened, and a link is
//! never followed (`O_NOFOLLOW`, `AT_SYMLINK_NOFOLLOW`).

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::os::fd::AsFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use rustix::fs::{fstat, open, openat, statat, AtFlags, Dir, FileType, Mode, OFlags, Stat};
use rustix::io::Errno;

use super::{ObjectIdentity, PinnedError};
use crate::durable::EntryKind;

pub(super) type DirHandle = File;

pub(super) fn name_is_plain(name: &OsStr) -> bool {
    !name.as_bytes().contains(&0)
}

fn dir_flags() -> OFlags {
    OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC
}

/// Non-blocking and without a controlling terminal, so that opening a FIFO or a device that a swap put
/// at the name cannot hang or attach; the type is checked on the descriptor right after.
fn file_flags() -> OFlags {
    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::NOCTTY | OFlags::CLOEXEC
}

fn io_error(errno: Errno) -> PinnedError {
    PinnedError::from(std::io::Error::from(errno))
}

/// `value` as a `u64`; the integer types of `stat` differ between systems.
pub(super) fn widen<T: TryInto<u64>>(value: T) -> Result<u64, PinnedError> {
    value.try_into().map_err(|_| PinnedError::Unsupported)
}

pub(super) fn identity_from(stat: &Stat) -> Result<ObjectIdentity, PinnedError> {
    Ok(ObjectIdentity::new(
        widen(stat.st_dev)?,
        u128::from(widen(stat.st_ino)?),
    ))
}

pub(super) fn kind_of(stat: &Stat) -> EntryKind {
    match FileType::from_raw_mode(stat.st_mode) {
        FileType::RegularFile => EntryKind::File,
        FileType::Directory => EntryKind::Directory,
        FileType::Symlink => EntryKind::Link,
        _ => EntryKind::Other,
    }
}

fn identity_of(fd: &impl AsFd) -> Result<ObjectIdentity, PinnedError> {
    identity_from(&fstat(fd).map_err(io_error)?)
}

/// The error for an entry that exists but is not of the kind that was asked for.
fn wrong_kind(wanted: EntryKind) -> PinnedError {
    if wanted == EntryKind::Directory {
        PinnedError::NotDirectory
    } else {
        PinnedError::NotRegularFile
    }
}

/// Opens the directory `path` and resolves it once to the path of the object itself, which has no link
/// in it. Children are reached through the descriptor, never through this path; it serves
/// [`is_still_named`].
pub(super) fn open_root(path: &Path) -> Result<(DirHandle, ObjectIdentity, PathBuf), PinnedError> {
    let fd = open(path, dir_flags(), Mode::empty()).map_err(|errno| match errno {
        Errno::LOOP | Errno::NOTDIR => match std::fs::symlink_metadata(path) {
            Ok(named) if named.file_type().is_symlink() => PinnedError::Redirected,
            Ok(_) => PinnedError::NotDirectory,
            Err(error) => PinnedError::from(error),
        },
        other => io_error(other),
    })?;
    let dir = File::from(fd);
    let identity = identity_of(&dir)?;
    let resolved = std::fs::canonicalize(path).map_err(PinnedError::from)?;
    let named = std::fs::metadata(&resolved).map_err(PinnedError::from)?;
    if ObjectIdentity::new(named.dev(), u128::from(named.ino())) != identity {
        return Err(PinnedError::Redirected);
    }
    Ok((dir, identity, resolved))
}

/// Why `openat` refused `name`: a link, an entry of another kind, or an ordinary error.
fn refuse_open(parent: &DirHandle, name: &OsStr, errno: Errno, wanted: EntryKind) -> PinnedError {
    if !matches!(
        errno,
        Errno::LOOP | Errno::NOTDIR | Errno::ISDIR | Errno::NXIO
    ) {
        return io_error(errno);
    }
    match stat_child(parent, name) {
        Ok(Some(stat)) => match kind_of(&stat) {
            EntryKind::Link => PinnedError::Redirected,
            found if found == wanted => io_error(errno),
            _ => wrong_kind(wanted),
        },
        Ok(None) => PinnedError::NotFound,
        Err(error) => error,
    }
}

fn stat_child(parent: &DirHandle, name: &OsStr) -> Result<Option<Stat>, PinnedError> {
    match statat(parent, name, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(stat) => Ok(Some(stat)),
        Err(Errno::NOENT) => Ok(None),
        Err(errno) => Err(io_error(errno)),
    }
}

pub(super) fn entry_kind(
    parent: &DirHandle,
    _parent_path: &Path,
    name: &OsStr,
) -> Result<Option<EntryKind>, PinnedError> {
    Ok(stat_child(parent, name)?.map(|stat| kind_of(&stat)))
}

/// Opens the child `name` of `parent` as `wanted` (a directory or a regular file), never following a
/// link, and identifies it.
pub(super) fn open_child(
    parent: &DirHandle,
    _parent_path: &Path,
    name: &OsStr,
    wanted: EntryKind,
) -> Result<(File, ObjectIdentity), PinnedError> {
    let flags = if wanted == EntryKind::Directory {
        dir_flags()
    } else {
        file_flags()
    };
    let fd = openat(parent, name, flags, Mode::empty())
        .map_err(|errno| refuse_open(parent, name, errno, wanted))?;
    let file = File::from(fd);
    let metadata = file.metadata().map_err(PinnedError::from)?;
    let kind_matches = if wanted == EntryKind::Directory {
        metadata.is_dir()
    } else {
        metadata.is_file()
    };
    if !kind_matches {
        return Err(wrong_kind(wanted));
    }
    let identity = ObjectIdentity::new(metadata.dev(), u128::from(metadata.ino()));
    Ok((file, identity))
}

pub(super) fn entries(
    parent: &DirHandle,
    _parent_path: &Path,
    limit: usize,
) -> Result<Vec<OsString>, PinnedError> {
    let mut names = Vec::new();
    for entry in Dir::read_from(parent).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = OsStr::from_bytes(entry.file_name().to_bytes());
        if name == "." || name == ".." {
            continue;
        }
        if names.len() == limit {
            return Err(PinnedError::TooManyEntries);
        }
        names.push(name.to_os_string());
    }
    Ok(names)
}

/// Whether `path`, walked from `/` one component at a time without following a link, still leads to
/// the directory of `handle`: an ancestor that was renamed away, replaced or turned into a link says no.
pub(super) fn is_still_named(handle: &DirHandle, path: &Path) -> Result<bool, PinnedError> {
    let held = identity_of(handle)?;
    let mut current = File::from(open("/", dir_flags(), Mode::empty()).map_err(io_error)?);
    for component in path.components() {
        let name = match component {
            Component::RootDir => continue,
            Component::Normal(name) => name,
            _ => return Ok(false),
        };
        current = match openat(&current, name, dir_flags(), Mode::empty()) {
            Ok(next) => File::from(next),
            Err(Errno::NOENT | Errno::LOOP | Errno::NOTDIR) => return Ok(false),
            Err(errno) => return Err(io_error(errno)),
        };
    }
    Ok(identity_of(&current)? == held)
}

pub(super) fn link_count(file: &File) -> Result<u64, PinnedError> {
    Ok(file.metadata().map_err(PinnedError::from)?.nlink())
}
