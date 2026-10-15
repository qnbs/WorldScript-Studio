//! Windows: a directory is pinned by an open handle that does not share delete, so neither it nor any of
//! its ancestors can be renamed or replaced while the handle is held. A reparse point (symbolic link,
//! junction, mount point) is opened as itself (`FILE_FLAG_OPEN_REPARSE_POINT`) and refused, never
//! followed. The identity of an object is the volume serial and 128-bit file id of the open handle.
//!
//! Children and listings go through the handle of the pinned directory, relative to it ([`nt`]):
//! `NtCreateFile` with the directory as `RootDirectory` and the single name as the object name, and the
//! directory information of the handle. The system then looks the name up in the directory object the
//! handle refers to, so a directory that is turned into a reparse point in place after a check, or whose
//! path is redirected, cannot lead a child or a listing into another tree. Only the root is opened by
//! path, once, and resolved to a path without any link ([`open_root`]); a child's stored path is the
//! real path its own handle reports. `entry_kind` is a relative open of the entry as itself. That a
//! pinned directory and its ancestors cannot be renamed, also after the parent was dropped, and that a
//! converted directory leads nowhere are proven on NTFS by the tests; a file system that does not
//! enforce the sharing rule or the relative lookup is outside the claim.
//!
//! The parent handle is also checked for reparse data before each use. That check alone would leave a
//! window between the check and the use; it only turns what the relative lookup would answer anyway
//! (nothing: such a directory is empty) into an explicit `Redirected`.

pub(in crate::pinned) mod nt;

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{ERROR_DELETE_PENDING, ERROR_SHARING_VIOLATION, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{
    GetFinalPathNameByHandleW, FILE_ACCESS_RIGHTS, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_GENERIC_READ, FILE_NAME_NORMALIZED, FILE_READ_ATTRIBUTES,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO, VOLUME_NAME_DOS,
};

use super::names;
use super::{ObjectIdentity, PinnedError};
use crate::durable::EntryKind;
use crate::root_lock::sys::{file_identity, open_as_itself, query_handle, still_named};

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

/// Opens the directory `path` by path, once, and resolves it to the path of the object itself, which
/// has no link in it (checked to name the object that was opened). Everything below the root goes through
/// the handle, so that path is only informational.
pub(super) fn open_root(path: &Path) -> Result<(DirHandle, ObjectIdentity, PathBuf), PinnedError> {
    let (dir, identity) = open_kind(path, FILE_GENERIC_READ, EntryKind::Directory)?;
    let resolved = std::fs::canonicalize(path).map_err(PinnedError::from)?;
    if !still_named(&dir, &resolved).map_err(PinnedError::from)? {
        return Err(PinnedError::Redirected);
    }
    Ok((dir, identity, resolved))
}

/// Opens the child `name` as `wanted` (a directory or a regular file), relative to the handle `parent`,
/// and returns it with its real path. A reparse point is refused.
pub(super) fn open_child(
    parent: &DirHandle,
    _parent_path: &Path,
    name: &OsStr,
    wanted: EntryKind,
) -> Result<(File, ObjectIdentity, PathBuf), PinnedError> {
    open_child_with(parent, name, wanted, FILE_GENERIC_READ)
}

/// [`open_child`] with the access `access`, sharing read and write but never delete.
pub(super) fn open_child_with(
    parent: &DirHandle,
    name: &OsStr,
    wanted: EntryKind,
    access: FILE_ACCESS_RIGHTS,
) -> Result<(File, ObjectIdentity, PathBuf), PinnedError> {
    assert_not_converted(parent)?;
    let child = nt::open_relative(parent, name, access, FILE_SHARE_READ | FILE_SHARE_WRITE)?;
    let child = expect_kind(child, wanted)?;
    let identity = identity_of(&child)?;
    let real = final_path(&child).map_err(PinnedError::from)?;
    Ok((child, identity, real))
}

/// The pinned directory must still be a plain directory. Nothing in the sharing rule stops a writer
/// from converting an empty directory into a reparse point in place. The relative lookups below do not
/// depend on this check (a converted directory is empty); it turns their empty answer into `Redirected`.
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

/// What the entry `name` of `parent` is itself: a relative open of the entry as itself, for its
/// attributes only.
pub(super) fn entry_kind(
    parent: &DirHandle,
    _parent_path: &Path,
    name: &OsStr,
) -> Result<Option<EntryKind>, PinnedError> {
    assert_not_converted(parent)?;
    let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    let entry = match nt::open_relative(parent, name, FILE_READ_ATTRIBUTES, share) {
        Ok(entry) => entry,
        Err(PinnedError::NotFound) => return Ok(None),
        Err(error) => return Err(error),
    };
    let attributes = entry
        .metadata()
        .map_err(PinnedError::from)?
        .file_attributes();
    Ok(Some(if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        EntryKind::Link
    } else if attributes & FILE_ATTRIBUTE_DIRECTORY != 0 {
        EntryKind::Directory
    } else {
        EntryKind::File
    }))
}

pub(super) fn entries(
    parent: &DirHandle,
    _parent_path: &Path,
    limit: usize,
) -> Result<Vec<OsString>, PinnedError> {
    assert_not_converted(parent)?;
    nt::list(parent, limit)
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
