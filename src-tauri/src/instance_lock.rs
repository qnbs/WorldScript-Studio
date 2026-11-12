//! App-data instance lock (#831): one process at a time owns a WorldScript app-data directory.
//!
//! The project lock (`withProjectFileLock` in `services/fs/fsCore.ts`) is an exclusive-create file in
//! `project-locks/`. A writer that crashes while holding it leaves the file behind, and every later
//! save of that project fails, also after a restart. Neither a timestamp nor an owner token can tell
//! such an orphan from a live lock safely, and `tauri-plugin-single-instance` does not keep a second
//! process out on every platform (Linux without a D-Bus session bus, macOS when its socket notify
//! fails).
//!
//! This module adds the missing proof. The process takes an OS lock (`File::try_lock`: `flock` on
//! Unix, `LockFileEx` on Windows) on `instance.lock` in the app-data directory and keeps it for its
//! whole lifetime; the OS drops it when the process exits or crashes. While it is held no other
//! process uses this directory, so every `project-locks/*.lock` on disk is an orphan, and
//! [`reclaim_orphaned_project_locks`] removes them once, before this process admits its first
//! writer. Without the lock nothing is removed.
//!
//! The module uses only `std`, so `rustc --test` runs its tests on every OS without the Tauri build
//! (`.github/workflows/instance-lock-platforms.yml`).

use std::fmt;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::Path;

/// File in the app-data directory that the instance lock is taken on.
pub const INSTANCE_LOCK_FILE: &str = "instance.lock";
/// Directory of the project locks; equals `PROJECT_LOCKS_DIR_NAME` in `services/fs/fsCore.ts`.
pub const PROJECT_LOCKS_DIR: &str = "project-locks";
/// Suffix of a project lock file; equals `LOCK_SUFFIX` in `services/fs/fsCore.ts`.
pub const PROJECT_LOCK_SUFFIX: &str = ".lock";

/// Proof that this process holds the app-data instance lock; dropping it releases the lock.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
}

/// Takes the instance lock without waiting; `Ok(None)` means another process holds it.
pub fn try_acquire(app_data: &Path) -> io::Result<Option<InstanceLock>> {
    fs::create_dir_all(app_data)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(app_data.join(INSTANCE_LOCK_FILE))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(InstanceLock { _file: file })),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

/// A reclaim that stopped at its first failure; `removed` orphans were already gone by then.
#[derive(Debug)]
pub struct ReclaimError {
    pub removed: usize,
    pub source: io::Error,
}

impl fmt::Display for ReclaimError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "project lock reclaim stopped after {} removal(s): {}",
            self.removed, self.source
        )
    }
}

impl std::error::Error for ReclaimError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

/// Removes every regular `*.lock` file directly inside `project-locks/` and returns how many.
///
/// The `&InstanceLock` argument is the proof that no other process can hold one of these locks; the
/// caller must also run this before its own process creates any project lock. Subdirectories,
/// symlinks and other files stay, and the first failure stops the reclaim.
pub fn reclaim_orphaned_project_locks(
    app_data: &Path,
    _held: &InstanceLock,
) -> Result<usize, ReclaimError> {
    let mut removed = 0;
    let fail = |removed, source| ReclaimError { removed, source };
    let entries = match fs::read_dir(app_data.join(PROJECT_LOCKS_DIR)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(fail(0, error)),
    };
    for entry in entries {
        let entry = entry.map_err(|error| fail(removed, error))?;
        let is_lock_name = entry
            .file_name()
            .to_string_lossy()
            .ends_with(PROJECT_LOCK_SUFFIX);
        let file_type = entry.file_type().map_err(|error| fail(removed, error))?;
        if is_lock_name && file_type.is_file() {
            fs::remove_file(entry.path()).map_err(|error| fail(removed, error))?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    const CHILD_DIR_ENV: &str = "WORLDSCRIPT_INSTANCE_LOCK_CHILD_DIR";
    const CHILD_TEST: &str = "child_holds_the_instance_lock";

    fn temp_app_data(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after 1970")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ws-instance-lock-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("temp app data");
        dir
    }

    /// Kills the child on every exit path, so a failing assertion can never leave it holding the lock.
    struct KillOnDrop(std::process::Child);

    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// Windows may release a closed or killed holder's lock with a short delay; poll within a bound.
    fn acquire_within(dir: &Path, limit: Duration) -> Option<InstanceLock> {
        let deadline = Instant::now() + limit;
        loop {
            if let Some(lock) = try_acquire(dir).expect("instance lock file") {
                return Some(lock);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn a_second_holder_is_refused_until_the_first_releases() {
        let dir = temp_app_data("second");
        let first = try_acquire(&dir).unwrap().expect("first holder");
        assert!(
            try_acquire(&dir).unwrap().is_none(),
            "a held lock must refuse a second holder"
        );
        drop(first);
        assert!(acquire_within(&dir, Duration::from_secs(5)).is_some());
        fs::remove_dir_all(&dir).ok();
    }

    /// The child side of `the_os_releases_the_lock_when_its_holder_is_killed`; a no-op otherwise.
    #[test]
    #[ignore = "runs only as the child process of the crash test"]
    fn child_holds_the_instance_lock() {
        let Some(dir) = std::env::var_os(CHILD_DIR_ENV) else {
            return;
        };
        let _held = try_acquire(Path::new(&dir))
            .unwrap()
            .expect("child holds the lock");
        println!("HELD");
        // Bounded, so a parent that dies early can never leave this process holding the lock for long.
        std::thread::sleep(Duration::from_secs(120));
    }

    #[test]
    fn the_os_releases_the_lock_when_its_holder_is_killed() {
        let dir = temp_app_data("crash");
        let mut child = KillOnDrop(
            Command::new(std::env::current_exe().unwrap())
                .args(["--ignored", CHILD_TEST, "--nocapture", "--test-threads=1"])
                .env(CHILD_DIR_ENV, &dir)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let stdout = child.0.stdout.take().unwrap();
        let held = BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
            .any(|line| line.contains("HELD"));
        assert!(held, "the child never took the instance lock");
        assert!(
            try_acquire(&dir).unwrap().is_none(),
            "a live holder in another process must keep this process out"
        );
        // A kill runs no destructor: SIGKILL on Unix, TerminateProcess on Windows.
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        assert!(
            acquire_within(&dir, Duration::from_secs(10)).is_some(),
            "the OS must release the lock of a killed holder"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reclaim_removes_only_project_lock_files() {
        let dir = temp_app_data("reclaim");
        let locks = dir.join(PROJECT_LOCKS_DIR);
        fs::create_dir_all(locks.join("nested.lock")).unwrap();
        fs::write(locks.join("alpha.lock"), b"").unwrap();
        fs::write(locks.join("beta.lock"), b"").unwrap();
        fs::write(locks.join("notes.txt"), b"keep").unwrap();
        fs::write(dir.join("project.json.lock"), b"keep").unwrap();
        let held = try_acquire(&dir).unwrap().expect("instance lock");
        assert_eq!(reclaim_orphaned_project_locks(&dir, &held).unwrap(), 2);
        assert!(!locks.join("alpha.lock").exists());
        assert!(!locks.join("beta.lock").exists());
        assert!(locks.join("notes.txt").exists());
        assert!(locks.join("nested.lock").is_dir());
        assert!(dir.join("project.json.lock").exists());
        drop(held);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reclaim_without_a_locks_directory_removes_nothing() {
        let dir = temp_app_data("empty");
        let held = try_acquire(&dir).unwrap().expect("instance lock");
        assert_eq!(reclaim_orphaned_project_locks(&dir, &held).unwrap(), 0);
        drop(held);
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn reclaim_never_follows_a_symlink() {
        let dir = temp_app_data("symlink");
        let locks = dir.join(PROJECT_LOCKS_DIR);
        fs::create_dir_all(&locks).unwrap();
        let target = dir.join("target.lock");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, locks.join("link.lock")).unwrap();
        let held = try_acquire(&dir).unwrap().expect("instance lock");
        assert_eq!(reclaim_orphaned_project_locks(&dir, &held).unwrap(), 0);
        assert!(target.exists());
        assert!(fs::symlink_metadata(locks.join("link.lock")).is_ok());
        drop(held);
        fs::remove_dir_all(&dir).ok();
    }
}
