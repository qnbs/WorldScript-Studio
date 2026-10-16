//! Windows removal, test-support only: authenticate on the handle, then an explicit disposition on that
//! same handle. See the parent `removal` module for the reasoning.
//!
//! The object is opened through the handle-relative lookup of every child, with delete access and a
//! share mode of **read only**. Sharing write would let another handle change the bytes between the
//! authentication and the disposition; read-only sharing makes a writer that has the file open fail
//! this open (`Busy`) and every later writer fail its own, and no delete sharing keeps the binding of the
//! name to the object in place. That sharing rule is about handles: a writable memory-mapped view that
//! another process created before and keeps after closing its handle is not stopped by it, so such a
//! writer can still change the authenticated bytes (a same-user residual, stated in the evidence document;
//! no sharing mode closes it). The disposition is set only after authentication succeeded; failing
//! authentication, an error or dropping the handle deletes nothing (there is deliberately no
//! `FILE_FLAG_DELETE_ON_CLOSE`, and no fallback to the classic disposition: a Windows or file system
//! without POSIX delete semantics is `Unsupported`).

use std::ffi::OsStr;
use std::fs::File;
use std::io;
use std::os::windows::io::AsRawHandle;

use windows_sys::Win32::Foundation::{
    ERROR_DIR_NOT_EMPTY, ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED,
    HANDLE,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileDispositionInfoEx, SetFileInformationByHandle, DELETE, FILE_DISPOSITION_FLAG_DELETE,
    FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO_EX, FILE_GENERIC_READ,
    FILE_SHARE_READ, FILE_SHARE_WRITE,
};

use super::{assert_not_converted, expect_kind, identity_of, io_error, nt};
use crate::durable::{DirectoryDurability, EntryKind};
use crate::pinned::{Observer, PinnedDir, PinnedError, PinnedFile, RemovalOutcome, RemovalStage};

pub(in crate::pinned) fn remove_file(
    dir: &PinnedDir,
    name: &OsStr,
    authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    assert_not_converted(&dir.handle)?;
    let file = nt::open_relative(
        &dir.handle,
        name,
        FILE_GENERIC_READ | DELETE,
        FILE_SHARE_READ,
    )?;
    let file = expect_kind(file, EntryKind::File)?;
    let identity = identity_of(&file)?;
    let mut pinned = PinnedFile { file, identity };
    if !authenticate(&mut pinned)? {
        return Ok(RemovalOutcome::Refused);
    }
    observer(RemovalStage::Checked)?;
    dispose(&pinned.file)
}

pub(in crate::pinned) fn remove_dir(
    dir: &PinnedDir,
    name: &OsStr,
    observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    assert_not_converted(&dir.handle)?;
    let handle = nt::open_relative(
        &dir.handle,
        name,
        FILE_GENERIC_READ | DELETE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
    )?;
    let handle = expect_kind(handle, EntryKind::Directory)?;
    observer(RemovalStage::Checked)?;
    // Nothing in the sharing rule stops a writer from converting the empty directory into a reparse point
    // in place, and the observer (a caller's code) runs in between: the held handle is looked at again right
    // before the disposition. That narrows the window and does not close it; a file cannot be converted,
    // because its handle shares no write access.
    let handle = expect_kind(handle, EntryKind::Directory)?;
    dispose(&handle)
}

/// Windows creates no quarantine directory, so there is nothing to finish.
pub(in crate::pinned) fn remove_leftover(
    _dir: &PinnedDir,
    _quarantine: &OsStr,
    _authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}

/// Deletes the object of `file`, which a non-empty directory refuses.
fn dispose(file: &File) -> Result<RemovalOutcome, PinnedError> {
    match set_posix_delete(file) {
        Ok(()) => Ok(RemovalOutcome::Removed(DirectoryDurability::NotConfirmed)),
        Err(error) => known_refusal(error.raw_os_error().map(|code| code as u32))
            .unwrap_or_else(|| Err(io_error(error))),
    }
}

/// What a refusal of the disposition means, for the codes the system uses for it; `None` for any other
/// error, which stays an error. A directory with entries is `NotEmpty`. A Windows version or a file system
/// (or driver) without POSIX delete semantics answers with one of three codes, and nothing was deleted:
/// `Unsupported`. `ERROR_INVALID_FUNCTION` is the one an older Windows or a driver gives when it does not
/// implement the information class at all.
pub(in crate::pinned) fn known_refusal(
    code: Option<u32>,
) -> Option<Result<RemovalOutcome, PinnedError>> {
    match code? {
        ERROR_DIR_NOT_EMPTY => Some(Ok(RemovalOutcome::NotEmpty)),
        ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED | ERROR_INVALID_FUNCTION => {
            Some(Err(PinnedError::Unsupported))
        }
        _ => None,
    }
}

/// `FileDispositionInfoEx` with delete and POSIX semantics, on exactly this handle.
#[allow(unsafe_code)]
fn set_posix_delete(file: &File) -> io::Result<()> {
    let info = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS,
    };
    // SAFETY: `file` keeps the handle open, with delete access, for the whole call; `info` is a live,
    // aligned FILE_DISPOSITION_INFO_EX of exactly the size passed, which is the structure
    // FileDispositionInfoEx reads (its layout is pinned by a test), and it outlives this synchronous call.
    let success = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle() as HANDLE,
            FileDispositionInfoEx,
            (&info as *const FILE_DISPOSITION_INFO_EX).cast(),
            std::mem::size_of::<FILE_DISPOSITION_INFO_EX>() as u32,
        )
    };
    if success == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
