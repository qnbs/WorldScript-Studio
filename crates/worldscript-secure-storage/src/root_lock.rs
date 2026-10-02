//! Gate 4 slice 4A: the cross-process `root_commit_mutex` (§11.1).
//!
//! Every root-commit event — §5.3.1 steps C–F and the work that decides what they commit — runs
//! while one [`RootCommitGuard`] is held. The guard is an exclusive advisory lock on
//! `<root_dir>/root-commit.lock`, taken through the operating system (`flock` on Unix, `LockFileEx`
//! on Windows), so it serializes root writers across threads and processes alike, and the operating
//! system releases it when its holder exits or crashes — a dead holder never leaves a stale lock
//! behind. The lock file holds no data; its bytes and existence decide nothing.
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
    root_dir: PathBuf,
    // Held open for the guard's lifetime: closing the file releases the operating-system lock.
    _file: File,
}

impl RootCommitGuard {
    /// Blocks until the root-commit mutex of `root_dir` is acquired.
    pub fn acquire(root_dir: &Path) -> io::Result<Self> {
        let file = open_lock_file(root_dir)?;
        sys::lock(&file, true)?;
        Ok(Self::held(root_dir, file))
    }

    /// Acquires the mutex only if no other holder has it; `None` when it is held elsewhere.
    pub fn try_acquire(root_dir: &Path) -> io::Result<Option<Self>> {
        let file = open_lock_file(root_dir)?;
        match sys::lock(&file, false) {
            Ok(()) => Ok(Some(Self::held(root_dir, file))),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Whether this guard is the mutex of `root_dir`.
    pub fn guards(&self, root_dir: &Path) -> bool {
        self.root_dir == root_dir
    }

    fn held(root_dir: &Path, file: File) -> Self {
        RootCommitGuard {
            root_dir: root_dir.to_path_buf(),
            _file: file,
        }
    }
}

fn open_lock_file(root_dir: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root_dir.join(ROOT_COMMIT_LOCK_FILE))
}

#[cfg(unix)]
mod sys {
    use std::fs::File;
    use std::io;

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
}

#[cfg(windows)]
mod sys {
    use std::fs::File;
    use std::io;
    use std::os::windows::io::AsRawHandle;

    use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
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
}
