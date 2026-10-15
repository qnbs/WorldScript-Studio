//! Windows: a directory is pinned by an open handle that does not share delete, so neither it nor any of
//! its ancestors can be renamed or replaced while the handle is held. A reparse point (symbolic link,
//! junction, mount point) is opened as itself (`FILE_FLAG_OPEN_REPARSE_POINT`) and refused, never
//! followed. The identity of an object is the volume serial and 128-bit file id of the open handle.
//!
//! A child is opened by the path of its pinned parent, not by an NT call relative to the parent handle,
//! and what was opened is then verified to be where it should be. The root is resolved once, from the
//! object that was opened, to a path without any link ([`open_root`]). No directory on that path can be
//! renamed or removed while a handle below it is open without delete sharing, and every `PinnedDir`, a
//! child too, holds such a handle of its own, so this does not depend on its parent staying alive. The
//! sharing rule does not stop a writer from turning an empty directory into a reparse point *in place*,
//! which would make the join lead into another tree: so the parent handle is checked for reparse data
//! before each use, and every child that is opened must report, by its own handle, a real path whose
//! parent is the path of the pinned directory (`open_child`); anything reached through a redirection
//! reports another parent and is refused. A listing and `entry_kind` only name entries; acting on one
//! goes through such an open. It is proven on NTFS by the tests that a pinned directory and its
//! ancestors cannot be renamed, also after the parent was dropped, that a retargeted ancestor link does
//! not redirect a child, and that a directory converted in place is refused; a file system that does
//! not enforce the sharing rule is outside the claim.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{ERROR_DELETE_PENDING, ERROR_SHARING_VIOLATION, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{
    FileStandardInfo, GetFinalPathNameByHandleW, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_GENERIC_READ, FILE_INFO_BY_HANDLE_CLASS,
    FILE_NAME_NORMALIZED, FILE_STANDARD_INFO, VOLUME_NAME_DOS,
};

use super::names;
use super::{ObjectIdentity, PinnedError};
use crate::durable::{DurableFs, EntryKind, StdFs};
use crate::root_lock::sys::{file_identity, open_as_itself, query_handle, still_named, HandleInfo};

pub(super) type DirHandle = File;

/// Whether Win32 takes `name` as exactly the entry it spells (see [`names`]). A name with an unpaired
/// surrogate is a valid NTFS name that a listing returns, so it is judged by its other characters.
pub(super) fn name_is_plain(name: &OsStr) -> bool {
    let units: Vec<u16> = name.encode_wide().collect();
    names::is_plain_windows_name(&String::from_utf16_lossy(&units))
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

/// Opens the child `name` as `wanted` (a directory or a regular file) and returns it with its real
/// path. A reparse point is refused, and so is a child that is not physically directly in the pinned
/// directory: its own handle must report a path whose parent is `parent_path`.
pub(super) fn open_child(
    parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
    wanted: EntryKind,
) -> Result<(File, ObjectIdentity, PathBuf), PinnedError> {
    assert_not_converted(parent)?;
    let (file, identity) = open_kind(&parent_path.join(name), FILE_GENERIC_READ, wanted)?;
    let real = final_path(&file).map_err(PinnedError::from)?;
    if real.parent() != Some(parent_path) {
        return Err(PinnedError::Redirected);
    }
    Ok((file, identity, real))
}

/// The pinned directory must still be a plain directory. Nothing in the sharing rule stops a writer
/// from converting an empty directory into a reparse point in place, after which a join with a name
/// would lead into another tree.
fn assert_not_converted(dir: &DirHandle) -> Result<(), PinnedError> {
    let attributes = dir.metadata().map_err(PinnedError::from)?.file_attributes();
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(PinnedError::Redirected);
    }
    Ok(())
}

/// The real path of the object `file` is open on, as the system reports it for the handle (the form
/// `canonicalize` returns).
#[allow(unsafe_code)]
fn final_path(file: &File) -> io::Result<PathBuf> {
    const LIMIT: usize = 32 * 1024;
    let handle = file.as_raw_handle() as HANDLE;
    let mut buffer: Vec<u16> = vec![0; 512];
    loop {
        // SAFETY: `handle` stays valid because `file` is borrowed; `buffer` is a writable buffer of
        // exactly `buffer.len()` UTF-16 units, which is the length passed.
        let written = unsafe {
            GetFinalPathNameByHandleW(
                handle,
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                FILE_NAME_NORMALIZED | VOLUME_NAME_DOS,
            )
        } as usize;
        if written == 0 || written > LIMIT {
            return Err(io::Error::last_os_error());
        }
        if written < buffer.len() {
            buffer.truncate(written);
            return Ok(PathBuf::from(OsString::from_wide(&buffer)));
        }
        // Too small: the call returned the size it needs, with the terminator.
        buffer.resize(written, 0);
    }
}

pub(super) fn entry_kind(
    parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
) -> Result<Option<EntryKind>, PinnedError> {
    assert_not_converted(parent)?;
    match StdFs.entry_kind(&parent_path.join(name)) {
        Ok(kind) => Ok(Some(kind)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(PinnedError::from(error)),
    }
}

pub(super) fn entries(
    parent: &DirHandle,
    parent_path: &Path,
    limit: usize,
) -> Result<Vec<OsString>, PinnedError> {
    assert_not_converted(parent)?;
    let mut names = Vec::new();
    for entry in std::fs::read_dir(parent_path).map_err(PinnedError::from)? {
        let name = entry.map_err(PinnedError::from)?.file_name();
        if names.len() == limit {
            return Err(PinnedError::TooManyEntries);
        }
        names.push(name);
    }
    assert_not_converted(parent)?;
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
    query_handle(file, &mut info)?;
    Ok(info)
}

#[allow(unsafe_code)]
// SAFETY: FILE_STANDARD_INFO is the structure of `FileStandardInfo`: integers and two byte-sized booleans,
// valid for every bit pattern.
unsafe impl HandleInfo for FILE_STANDARD_INFO {
    const CLASS: FILE_INFO_BY_HANDLE_CLASS = FileStandardInfo;
}
