//! Windows: a directory is pinned by an open handle that does not share delete, so neither it nor any of
//! its ancestors can be renamed or replaced while the handle is held. A reparse point (symbolic link,
//! junction, mount point) is opened as itself (`FILE_FLAG_OPEN_REPARSE_POINT`) and refused, never
//! followed. The identity of an object is the volume serial and 128-bit file id of the open handle.

use std::ffi::{OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::{ERROR_DELETE_PENDING, ERROR_SHARING_VIOLATION, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{
    FileStandardInfo, GetFileInformationByHandleEx, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_STANDARD_INFO,
};

use super::{ObjectIdentity, PinnedError};
use crate::durable::{DurableFs, EntryKind, StdFs};
use crate::root_lock::sys::{file_identity, still_named};

pub(super) type DirHandle = File;

/// Names the Win32 path layer maps to a device whatever the directory or extension.
const DEVICE_NAMES: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", "COM1", "COM2", "COM3", "COM4", "COM5",
    "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
    "LPT9",
];

/// Whether Win32 takes `name` as exactly the entry it spells: no stream (`:`), wildcard, control
/// character or separator, no trailing dot or space that the path layer strips, and no device name.
pub(super) fn name_is_plain(name: &OsStr) -> bool {
    let Some(text) = name.to_str() else {
        return false;
    };
    let forbidden = |c: char| c.is_control() || "<>:\"/\\|?*".contains(c);
    !text.chars().any(forbidden) && !text.ends_with(['.', ' ']) && !is_device_name(text)
}

fn is_device_name(text: &str) -> bool {
    let stem = text.split('.').next().unwrap_or(text).trim_end_matches(' ');
    let upper = stem.to_ascii_uppercase();
    DEVICE_NAMES.contains(&upper.as_str())
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
    OpenOptions::new()
        .access_mode(access)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(io_error)
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

pub(super) fn open_root(path: &Path) -> Result<(DirHandle, ObjectIdentity), PinnedError> {
    open_kind(path, FILE_GENERIC_READ, EntryKind::Directory)
}

pub(super) fn open_dir(
    _parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
) -> Result<(DirHandle, ObjectIdentity), PinnedError> {
    open_kind(
        &parent_path.join(name),
        FILE_GENERIC_READ,
        EntryKind::Directory,
    )
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

pub(super) fn open_file(
    _parent: &DirHandle,
    parent_path: &Path,
    name: &OsStr,
) -> Result<(File, ObjectIdentity), PinnedError> {
    open_kind(&parent_path.join(name), FILE_GENERIC_READ, EntryKind::File)
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

#[allow(unsafe_code)]
fn standard_info(file: &File) -> io::Result<FILE_STANDARD_INFO> {
    let mut info = FILE_STANDARD_INFO {
        AllocationSize: 0,
        EndOfFile: 0,
        NumberOfLinks: 0,
        DeletePending: 0,
        Directory: 0,
    };
    // SAFETY: `file` keeps the handle open for the whole call; `info` is a correctly sized and aligned
    // FILE_STANDARD_INFO buffer, which is exactly what FileStandardInfo writes, and it outlives this
    // synchronous call.
    let success = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle() as HANDLE,
            FileStandardInfo,
            (&mut info as *mut FILE_STANDARD_INFO).cast(),
            std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
        )
    };
    if success == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info)
}
