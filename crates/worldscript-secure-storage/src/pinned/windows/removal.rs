//! Windows removal, test-support only: not implemented in this slice. Every call refuses with
//! `Unsupported`; a successor slice brings the handle-relative delete. See the parent `removal` module
//! for the contract.

use std::ffi::OsStr;

use crate::pinned::{Observer, PinnedDir, PinnedError, PinnedFile, RemovalOutcome};

pub(in crate::pinned) fn remove_file(
    _dir: &PinnedDir,
    _name: &OsStr,
    _authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}

pub(in crate::pinned) fn remove_dir(
    _dir: &PinnedDir,
    _name: &OsStr,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}

pub(in crate::pinned) fn remove_leftover(
    _dir: &PinnedDir,
    _quarantine: &OsStr,
    _authenticate: impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError>,
    _observer: Observer<'_>,
) -> Result<RemovalOutcome, PinnedError> {
    Err(PinnedError::Unsupported)
}
