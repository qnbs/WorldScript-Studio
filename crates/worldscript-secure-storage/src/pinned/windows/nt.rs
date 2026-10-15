//! Windows: operations that go through the handle of a directory that is held open, never through its
//! path. This is what keeps a child or a listing in the directory that was opened even if that
//! directory is converted into a reparse point in place after the check: the system looks the name up
//! in the directory object the handle refers to, not in whatever its path leads to now.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_OPEN, FILE_OPEN_FOR_BACKUP_INTENT, FILE_OPEN_REPARSE_POINT,
    FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{ERROR_NO_MORE_FILES, HANDLE, UNICODE_STRING};
use windows_sys::Win32::Storage::FileSystem::{
    FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo, GetFileInformationByHandleEx,
    FILE_ACCESS_RIGHTS, FILE_INFO_BY_HANDLE_CLASS, FILE_SHARE_MODE, SYNCHRONIZE,
};
use windows_sys::Win32::System::IO::{IO_STATUS_BLOCK, IO_STATUS_BLOCK_0};

use crate::pinned::{dirbuf, PinnedError};

/// `OBJ_CASE_INSENSITIVE`, as `CreateFile` asks for it.
const CASE_INSENSITIVE: u32 = 0x40;

const STATUS_OBJECT_NAME_NOT_FOUND: i32 = 0xC000_0034_u32 as i32;
const STATUS_OBJECT_PATH_NOT_FOUND: i32 = 0xC000_003A_u32 as i32;
const STATUS_SHARING_VIOLATION: i32 = 0xC000_0043_u32 as i32;
const STATUS_DELETE_PENDING: i32 = 0xC000_0056_u32 as i32;
const STATUS_ACCESS_DENIED: i32 = 0xC000_0022_u32 as i32;
const STATUS_NAME_TOO_LONG: i32 = 0xC000_0106_u32 as i32;
const STATUS_REPARSE_POINT_ENCOUNTERED: i32 = 0xC000_050B_u32 as i32;

fn status_error(status: i32) -> PinnedError {
    match status {
        STATUS_OBJECT_NAME_NOT_FOUND | STATUS_OBJECT_PATH_NOT_FOUND => PinnedError::NotFound,
        STATUS_SHARING_VIOLATION | STATUS_DELETE_PENDING => PinnedError::Busy,
        STATUS_REPARSE_POINT_ENCOUNTERED => PinnedError::Redirected,
        STATUS_ACCESS_DENIED => PinnedError::Io(io::ErrorKind::PermissionDenied),
        STATUS_NAME_TOO_LONG => PinnedError::InvalidName,
        _ => PinnedError::Io(io::ErrorKind::Other),
    }
}

/// Opens the entry `name` of the directory `parent` itself, relative to the handle `parent`: a reparse
/// point at `name` is opened, not followed. `name` is a single component (checked by the caller).
#[allow(unsafe_code)]
pub(in crate::pinned) fn open_relative(
    parent: &File,
    name: &OsStr,
    access: FILE_ACCESS_RIGHTS,
    share: FILE_SHARE_MODE,
) -> Result<File, PinnedError> {
    let mut wide: Vec<u16> = name.encode_wide().collect();
    let bytes = u16::try_from(wide.len() * 2).map_err(|_| PinnedError::InvalidName)?;
    let object_name = UNICODE_STRING {
        Length: bytes,
        MaximumLength: bytes,
        Buffer: wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle() as HANDLE,
        ObjectName: &object_name,
        Attributes: CASE_INSENSITIVE,
        SecurityDescriptor: std::ptr::null(),
        SecurityQualityOfService: std::ptr::null(),
    };
    let mut block = IO_STATUS_BLOCK {
        Anonymous: IO_STATUS_BLOCK_0 { Status: 0 },
        Information: 0,
    };
    let mut opened: HANDLE = 0;
    // SAFETY: every pointer refers to a live local that outlives this synchronous call: `attributes`
    // (whose `ObjectName` points at `object_name`, whose buffer is `wide`), `block` and `opened`; the
    // root directory handle stays valid because `parent` is borrowed; no allocation size, extended
    // attributes or security descriptor are passed.
    let status = unsafe {
        NtCreateFile(
            &mut opened,
            access | SYNCHRONIZE,
            &attributes,
            &mut block,
            std::ptr::null(),
            0,
            share,
            FILE_OPEN,
            FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_FOR_BACKUP_INTENT,
            std::ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(status_error(status));
    }
    if opened == 0 {
        // A success code that opened nothing (`STATUS_REPARSE`): the name led somewhere else.
        return Err(PinnedError::Redirected);
    }
    // SAFETY: the call succeeded and returned a handle that nothing else owns.
    Ok(unsafe { File::from_raw_handle(opened as RawHandle) })
}

/// The names in the directory of the handle `parent`, read through that handle, if there are at most
/// `limit` of them.
pub(in crate::pinned) fn list(parent: &File, limit: usize) -> Result<Vec<OsString>, PinnedError> {
    const SIZE: usize = 32 * 1024;
    // The system writes the records 8-aligned, so the buffer starts on an 8-byte boundary.
    let mut backing = vec![0u8; SIZE + 8];
    let start = backing.as_ptr().align_offset(8);
    let buffer = &mut backing[start..start + SIZE];
    let mut names = Vec::new();
    let mut class = FileIdBothDirectoryRestartInfo;
    while read_batch(parent, buffer, class)? {
        class = FileIdBothDirectoryInfo;
        let batch =
            dirbuf::names(buffer).map_err(|_| PinnedError::Io(io::ErrorKind::InvalidData))?;
        for units in batch {
            if names.len() == limit {
                return Err(PinnedError::TooManyEntries);
            }
            names.push(OsString::from_wide(&units));
        }
    }
    Ok(names)
}

/// Fills `buffer` with the next batch of directory records of `parent`; `false` when there are no more.
#[allow(unsafe_code)]
fn read_batch(
    parent: &File,
    buffer: &mut [u8],
    class: FILE_INFO_BY_HANDLE_CLASS,
) -> Result<bool, PinnedError> {
    // SAFETY: the handle stays valid because `parent` is borrowed; `buffer` is a writable, 8-aligned
    // buffer of exactly `buffer.len()` bytes, which is the size passed.
    let success = unsafe {
        GetFileInformationByHandleEx(
            parent.as_raw_handle() as HANDLE,
            class,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
        )
    };
    if success != 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(ERROR_NO_MORE_FILES as i32) {
        return Ok(false);
    }
    Err(PinnedError::from(error))
}
