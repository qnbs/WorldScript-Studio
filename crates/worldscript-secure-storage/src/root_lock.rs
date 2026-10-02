//! Gate 4 slice 4A: the cross-process `root_commit_mutex` (§11.1).
//!
//! Every root-commit event — §5.3.1 steps C–F and the work that decides what they commit — runs
//! while one [`RootCommitGuard`] is held. The guard is an exclusive advisory lock on
//! `<root_dir>/root-commit.lock`, taken through the operating system (`flock` on Unix, `LockFileEx`
//! on Windows), so it serializes root writers across threads and processes alike, and the operating
//! system releases it when its holder exits or crashes — a dead holder never leaves a stale lock
//! behind. The lock file holds no data; its bytes and existence decide nothing. The root directory is
//! resolved before the lock file is opened, and a guard authorizes nothing once the lock file it
//! locked is no longer the one at that path (Unix compares device and inode; on Windows the file is
//! opened without delete sharing, so it cannot be replaced while held). A child process forked while
//! a guard is held briefly shares its descriptor until it execs (Rust opens it close-on-exec), which
//! can only delay a release, never share the lock.
//!
//! The functions that publish or recover root state ([`commit_root`](crate::root_store::commit_root),
//! [`recover_root`](crate::root_store::recover_root),
//! [`write_key_epoch`](crate::root_store::write_key_epoch)) take the guard, so they cannot run
//! without it, and refuse a guard for another root directory. The guard serializes root writers
//! only; readers never take it (§5.3.3), and operation admission above it is slice 4B.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// The lock file's name inside the root directory.
pub const ROOT_COMMIT_LOCK_FILE: &str = "root-commit.lock";

/// Proof that this holder owns the root-commit mutex of `root_dir`. Dropping it releases the lock.
#[derive(Debug)]
pub struct RootCommitGuard {
    /// The canonical root directory, resolved before the lock file was opened.
    root_dir: PathBuf,
    // Held open for the guard's lifetime: closing the file releases the operating-system lock.
    file: File,
}

impl RootCommitGuard {
    /// Blocks until the root-commit mutex of `root_dir` is acquired.
    pub fn acquire(root_dir: &Path) -> io::Result<Self> {
        Self::lock(root_dir, true)?.ok_or_else(|| io::Error::from(io::ErrorKind::WouldBlock))
    }

    /// Acquires the mutex only if no other holder has it; `None` when it is held elsewhere.
    pub fn try_acquire(root_dir: &Path) -> io::Result<Option<Self>> {
        Self::lock(root_dir, false)
    }

    /// Whether this guard is the mutex of `root_dir`: the same directory by its canonical path (so
    /// another spelling of it still matches and a different directory never does), and the lock
    /// file there is still the very file this guard locked — a lock file replaced while held would
    /// let another holder lock the replacement, so the guard then authorizes nothing. A path that
    /// cannot be resolved never matches.
    pub fn guards(&self, root_dir: &Path) -> bool {
        std::fs::canonicalize(root_dir).is_ok_and(|canonical| canonical == self.root_dir)
            && sys::still_named(&self.file, &self.root_dir.join(ROOT_COMMIT_LOCK_FILE))
                .unwrap_or(false)
    }

    /// Resolves the root first, then opens and locks the lock file there. If the file was replaced
    /// between opening and locking, the lock is on an orphan: release it and lock the file the path
    /// names now.
    fn lock(root_dir: &Path, wait: bool) -> io::Result<Option<Self>> {
        let root_dir = std::fs::canonicalize(root_dir)?;
        let path = root_dir.join(ROOT_COMMIT_LOCK_FILE);
        loop {
            let file = open_lock_file(&path)?;
            match sys::lock(&file, wait) {
                Ok(()) => {}
                Err(error) if !wait && error.kind() == io::ErrorKind::WouldBlock => {
                    return Ok(None)
                }
                Err(error) => return Err(error),
            }
            if sys::still_named(&file, &path)? {
                return Ok(Some(RootCommitGuard { root_dir, file }));
            }
        }
    }
}

fn open_lock_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    sys::exclusive_share(&mut options);
    options.open(path)
}

#[cfg(unix)]
mod sys {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    use rustix::fs::{flock, FlockOperation};

    /// An exclusive `flock` on the open file description; `WouldBlock` when `wait` is false and
    /// another description holds it.
    pub(super) fn lock(file: &File, wait: bool) -> io::Result<()> {
        let operation = if wait {
            FlockOperation::LockExclusive
        } else {
            FlockOperation::NonBlockingLockExclusive
        };
        flock(file, operation).map_err(io::Error::from)
    }

    /// Whether `path` still names the open `file` (same device and inode).
    pub(super) fn still_named(file: &File, path: &Path) -> io::Result<bool> {
        let held = file.metadata()?;
        match std::fs::metadata(path) {
            Ok(named) => Ok(held.dev() == named.dev() && held.ino() == named.ino()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    /// Unix needs no share mode: replacement is detected by [`still_named`].
    pub(super) fn exclusive_share(_options: &mut OpenOptions) {}
}

#[cfg(windows)]
mod sys {
    use std::fs::{File, OpenOptions};
    use std::io;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, FILE_SHARE_READ, FILE_SHARE_WRITE, LOCKFILE_EXCLUSIVE_LOCK,
        LOCKFILE_FAIL_IMMEDIATELY,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    /// An exclusive `LockFileEx` over the whole file; `WouldBlock` when `wait` is false and another
    /// handle holds it.
    #[allow(unsafe_code)]
    pub(super) fn lock(file: &File, wait: bool) -> io::Result<()> {
        let mut flags = LOCKFILE_EXCLUSIVE_LOCK;
        if !wait {
            flags |= LOCKFILE_FAIL_IMMEDIATELY;
        }
        // SAFETY: `OVERLAPPED` is a plain C struct for which all-zero is the documented initial
        // value (offset 0, no event).
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        let handle = file.as_raw_handle() as HANDLE;
        // SAFETY: `handle` is a valid, open file handle owned by `file` for the whole call, and
        // `overlapped` outlives the call; a synchronous handle completes the lock before returning.
        let locked = unsafe { LockFileEx(handle, flags, 0, u32::MAX, u32::MAX, &mut overlapped) };
        if locked != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION as i32) {
            Err(io::Error::from(io::ErrorKind::WouldBlock))
        } else {
            Err(error)
        }
    }

    /// Opened without delete sharing, the lock file cannot be deleted or renamed while any holder
    /// has it open, so the path always names the locked file.
    pub(super) fn exclusive_share(options: &mut OpenOptions) {
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    }

    /// The path cannot name another file while `_file` is open (see [`exclusive_share`]); it is
    /// still checked to exist.
    pub(super) fn still_named(_file: &File, path: &Path) -> io::Result<bool> {
        match std::fs::metadata(path) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }
}
