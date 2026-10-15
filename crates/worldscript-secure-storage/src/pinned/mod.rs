//! Gate 4 slice H1a: handle-relative access to a directory tree.
//!
//! A path names an object only at the instant it is resolved. A walk that lists a directory, checks an
//! entry and then acts on the *path* of that entry can end up acting on something else that took the
//! name in between, so no check made on a path proves anything about the object a later path-based call
//! reaches. This module is the narrow seam the Gate 4 reclamation will use instead of
//! [`DurableFs`](crate::DurableFs): [`PinnedDir::open_root`] opens one directory, and everything below it
//! is reached **through the handle of a directory that was opened**, never through a path string again.
//! What is read is the object that was opened and identified, and a link or reparse point at any
//! component below the root is refused instead of followed.
//!
//! The ancestors of the root are resolved by the operating system once, when the root is opened, exactly
//! as for every other file operation of the crate; the root's own final component is not followed if it
//! is a link. Nothing here is a general file API: only the operations the reclamation needs exist, and
//! [`DurableFs`](crate::DurableFs) is not changed.
//!
//! **Platforms.** On Unix every step is an `*at` call on a descriptor of the directory that was opened.
//! On Windows a directory is pinned by an open handle without delete sharing, so neither it nor any of
//! its ancestors can be renamed or replaced while it is held, and the names below it can only be bound to
//! other objects through that pinned directory.
//!
//! This slice (H1a-1) has no removal: nothing here changes the file system, and nothing calls it yet.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use crate::durable::EntryKind;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
use unix as sys;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as sys;

#[cfg(test)]
mod tests;

/// Why a pinned operation did not produce its object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinnedError {
    /// The name is not exactly one ordinary path component (a separator, `.`/`..`, a NUL, or on Windows
    /// a stream, device or otherwise reinterpreted name).
    InvalidName,
    NotFound,
    /// The entry is not a directory.
    NotDirectory,
    /// The entry is not a regular file.
    NotRegularFile,
    /// The entry is a symbolic link, a junction or another reparse point; it is never followed.
    Redirected,
    /// Another handle holds the object in a way that forbids the operation (Windows sharing).
    Busy,
    /// A file holds more bytes than the caller allowed.
    TooLarge,
    /// A directory holds more entries than the caller allowed.
    TooManyEntries,
    /// The platform or the file system cannot give the guarantee, so nothing was done.
    Unsupported,
    Io(io::ErrorKind),
}

impl From<io::Error> for PinnedError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => PinnedError::NotFound,
            io::ErrorKind::Unsupported => PinnedError::Unsupported,
            kind => PinnedError::Io(kind),
        }
    }
}

/// Which object an open handle refers to: the file system and the object in it. Two handles with equal
/// identities refer to the same object for as long as one of them is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ObjectIdentity {
    volume: u64,
    object: u128,
}

impl ObjectIdentity {
    pub(crate) fn new(volume: u64, object: u128) -> Self {
        ObjectIdentity { volume, object }
    }
}

/// A directory held open. Children are opened through it, not through its path.
#[derive(Debug)]
pub struct PinnedDir {
    handle: sys::DirHandle,
    path: PathBuf,
    identity: ObjectIdentity,
}

/// A regular file opened through a [`PinnedDir`], identified when it was opened.
#[derive(Debug)]
pub struct PinnedFile {
    file: File,
    identity: ObjectIdentity,
}

/// `name` if it is exactly one ordinary component that this platform does not reinterpret.
fn checked_name(name: &OsStr) -> Result<&OsStr, PinnedError> {
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(Component::Normal(only)), None) if only == name && sys::name_is_plain(name) => {
            Ok(name)
        }
        _ => Err(PinnedError::InvalidName),
    }
}

impl PinnedDir {
    /// Opens the directory `path`. A symbolic link, junction or reparse point as the final component is
    /// refused. The ancestors of `path` are resolved once, by the operating system.
    pub fn open_root(path: &Path) -> Result<Self, PinnedError> {
        let (handle, identity) = sys::open_root(path)?;
        Ok(PinnedDir {
            handle,
            path: path.to_path_buf(),
            identity,
        })
    }

    /// The path this directory was opened by (for messages; no operation re-resolves it).
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn identity(&self) -> ObjectIdentity {
        self.identity
    }

    /// Opens the child directory `name` through this directory. A link or reparse point is refused.
    pub fn open_dir(&self, name: impl AsRef<OsStr>) -> Result<PinnedDir, PinnedError> {
        let name = checked_name(name.as_ref())?;
        let (handle, identity) = sys::open_dir(&self.handle, &self.path, name)?;
        Ok(PinnedDir {
            handle,
            path: self.path.join(name),
            identity,
        })
    }

    /// What the entry `name` of this directory is itself, without following it; `None` if absent.
    pub fn entry_kind(&self, name: impl AsRef<OsStr>) -> Result<Option<EntryKind>, PinnedError> {
        let name = checked_name(name.as_ref())?;
        sys::entry_kind(&self.handle, &self.path, name)
    }

    /// Opens the regular file `name` of this directory for reading. A link, reparse point or anything
    /// that is not a regular file is refused.
    pub fn open_file(&self, name: impl AsRef<OsStr>) -> Result<PinnedFile, PinnedError> {
        let name = checked_name(name.as_ref())?;
        let (file, identity) = sys::open_file(&self.handle, &self.path, name)?;
        Ok(PinnedFile { file, identity })
    }

    /// The names of the entries of this directory if there are at most `limit` of them.
    pub fn entries(&self, limit: usize) -> Result<Vec<OsString>, PinnedError> {
        sys::entries(&self.handle, &self.path, limit)
    }

    /// Whether the path this directory was opened by still names this very directory. `false` when it
    /// was renamed away, replaced or removed, and also when an ancestor was redirected.
    pub fn is_still_named(&self) -> Result<bool, PinnedError> {
        sys::is_still_named(&self.handle, &self.path)
    }
}

impl PinnedFile {
    pub fn identity(&self) -> ObjectIdentity {
        self.identity
    }

    /// The number of names the file has (a hard link adds one).
    pub fn link_count(&self) -> Result<u64, PinnedError> {
        sys::link_count(&self.file)
    }

    /// The whole file if it holds at most `max` bytes.
    pub fn read_at_most(&mut self, max: usize) -> Result<Vec<u8>, PinnedError> {
        let allowed = u64::try_from(max).map_or(u64::MAX, |max| max.saturating_add(1));
        let mut bytes = Vec::new();
        (&mut self.file)
            .take(allowed)
            .read_to_end(&mut bytes)
            .map_err(PinnedError::from)?;
        if bytes.len() > max {
            return Err(PinnedError::TooLarge);
        }
        Ok(bytes)
    }
}
