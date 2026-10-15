//! Windows: a directory is pinned by an open handle that does not share delete, so neither it nor any of
//! its ancestors can be renamed or replaced while the handle is held. A reparse point (symbolic link,
//! junction, mount point) is opened as itself (`FILE_FLAG_OPEN_REPARSE_POINT`) and refused, never
//! followed. The identity of an object is the volume serial and 128-bit file id of the open handle.
//!
//! A child is opened by the path of its pinned parent, not by an NT call relative to the parent handle:
//! the root is resolved once, from the object that was opened, to a path without any link
//! ([`open_root`]). No directory on that path can be renamed or removed while a handle below it is open
//! without delete sharing, and every `PinnedDir`, a child too, holds such a handle of its own, so this
//! does not depend on its parent staying alive. It is proven on NTFS by the tests that a pinned
//! directory and its ancestors cannot be renamed, also after the parent was dropped, and that a
//! retargeted ancestor link does not redirect a child; a file system that does not enforce the sharing
//! rule is outside the claim.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{ERROR_DELETE_PENDING, ERROR_SHARING_VIOLATION};
use windows_sys::Win32::Storage::FileSystem::{
    FileStandardInfo, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_GENERIC_READ,
    FILE_STANDARD_INFO,
};

use super::names;
use super::{ObjectIdentity, PinnedError};
use crate::durable::{DurableFs, EntryKind, StdFs};
use crate::root_lock::sys::{file_identity, open_as_itself, query_handle, still_named};

pub(super) type DirHandle = File;

/// Whether Win32 takes `name` as exactly the entry it spells (see [`names`]).
pub(super) fn name_is_plain(name: &OsStr) -> bool {
    name.to_str().is_some_and(names::is_plain_windows_name)
}

/// The error a failed open or delete maps to.
pub(super) fn io_error(error: io::Error) -> PinnedError {
    match error.raw_os_error().map(|code| code as u32) {
        Some(ERROR_SHARING_VIOLATION | ERROR_DELETE_PENDING) => PinnedError::Busy,
        _ => PinnedError::from(error),
    }
}

/// Opens `path` as itself with `access`, sharing read and write but never delete.
pub(super) fn open_exact(path: &Path, access: u32) -> Result<File, PinnedError> {
    open_as_itself(path, access).map_err(io_error)
}

/// `file` if it is neither a reparse point nor of another kind than `wanted`.
pub(super) fn expect_kind(file: File, wanted: EntryKind) -> Result<File, PinnedError> {
    let attributes = file
        .metadata()
        .map_err(PinnedError::from)?
        .file_attributes();
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(PinnedError::Redirected);
    }
    match (wanted, attributes & FILE_ATTRIBUTE_DIRECTORY != 0) {
        (EntryKind::Directory, true) | (EntryKind::File, false) => Ok(file),
        (EntryKind::Directory, false) => Err(PinnedError::NotDirectory),
        _ => Err(PinnedError::NotRegularFile),
    }
}

pub(super) fn identity_of(file: &File) -> Result<ObjectIdentity, PinnedError> {
    let (volume, id) = file_identity(file).map_err(PinnedError::from)?;
    Ok(ObjectIdentity::new(volume, u128::from_le_bytes(id)))
}

pub(super) fn open_kind(
    path: &Path,
    access: u32,
    wanted: EntryKind,
) -> Result<(File, ObjectIdentity), PinnedError> {
    let file = expect_kind(open_exact(path, access)?, wanted)?;
    let identity = identity_of(&file)?;
    Ok((file, identity))
}

/// Opens the directory `path` and resolves it once to the path of the object itself, which has no link
/// in it. No directory on that path can be renamed or removed while the open handle (or one of a child)
/// is held, so a later join with a child name cannot lead anywhere else, and a relative `path` or a
/// link among its ancestors cannot redirect it afterwards.
pub(super) fn open_root(path: &Path) -> Result<(DirHandle, ObjectIdentity, PathBuf), PinnedError> {
    let (dir, identity) = open_kind(path, FILE_GENERIC_READ, EntryKind::Directory)?;
    let resolved = std::fs::canonicalize(path).map_err(PinnedError::from)?;
    if !still_named(&dir, &resolved).map_err(PinnedError::from)? {
        return Err(PinnedError::Redirected);
    }
    Ok((dir, identity, resolved))
}

/// Opens the child `name` as `wanted` (a directory or a regular file); a reparse point is refused.
pub(super) fn open_child(
    _parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
    wanted: EntryKind,
) -> Result<(File, ObjectIdentity), PinnedError> {
    open_kind(&parent_path.join(name), FILE_GENERIC_READ, wanted)
}

pub(super) fn entry_kind(
    _parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
) -> Result<Option<EntryKind>, PinnedError> {
    match StdFs.entry_kind(&parent_path.join(name)) {
        Ok(kind) => Ok(Some(kind)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(PinnedError::from(error)),
    }
}

pub(super) fn entries(
    _parent: &DirHandle,
    parent_path: &Path,
    limit: usize,
) -> Result<Vec<OsString>, PinnedError> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(parent_path).map_err(PinnedError::from)? {
        let name = entry.map_err(PinnedError::from)?.file_name();
        if names.len() == limit {
            return Err(PinnedError::TooManyEntries);
        }
        names.push(name);
    }
    Ok(names)
}

pub(super) fn is_still_named(handle: &DirHandle, path: &Path) -> Result<bool, PinnedError> {
    still_named(handle, path).map_err(PinnedError::from)
}

pub(super) fn link_count(file: &File) -> Result<u64, PinnedError> {
    Ok(u64::from(
        standard_info(file)
            .map_err(PinnedError::from)?
            .NumberOfLinks,
    ))
}

fn standard_info(file: &File) -> io::Result<FILE_STANDARD_INFO> {
    let mut info = FILE_STANDARD_INFO {
        AllocationSize: 0,
        EndOfFile: 0,
        NumberOfLinks: 0,
        DeletePending: 0,
        Directory: 0,
    };
    query_handle(file, FileStandardInfo, &mut info)?;
    Ok(info)
}
