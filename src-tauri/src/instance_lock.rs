//! App-data writers lock (#831): crash-safe recovery of project locks a crashed writer left behind.
//!
//! The project lock (`withProjectFileLock` in `services/fs/fsCore.ts`) is an exclusive-create file in
//! `project-locks/`. A writer that crashes while holding it leaves the file behind, and every later
//! save of that project fails, also after a restart. Neither a timestamp nor an owner token can tell
//! such an orphan from a live lock safely, and `tauri-plugin-single-instance` does not keep a second
//! process out on every platform (Linux without a D-Bus session bus, macOS when its socket notify
//! fails).
//!
//! Protocol: every WorldScript process that writes an app-data directory holds a **shared** OS lock
//! (`File::lock_shared`: `flock` on Unix, `LockFileEx` on Windows) on `writers.lock` for its whole
//! lifetime; the OS drops it when the process exits or crashes. A starting process first tries an
//! **exclusive** lock on the same file. That succeeds only when no other process holds the shared
//! lock, i.e. no other writer is alive, so every `project-locks/*.lock` on disk is an orphan;
//! [`join_writers`] removes them while it still holds the exclusive lock, then takes its own shared
//! lock. If any other writer is alive, nothing is removed. A process that cannot hold the shared lock
//! must not write at all, because a later process could then reclaim its live locks.
//!
//! The lock file must outlive every writer: Factory Reset skips it (`APP_DATA_WRITERS_LOCK_FILE`).
//! The module uses only `std`, so `rustc --test` runs its tests on every OS without the Tauri build
//! (`.github/workflows/instance-lock-platforms.yml`).

use std::fmt;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

/// File in the app-data directory every writer holds a shared lock on; equals
/// `APP_DATA_WRITERS_LOCK_FILE` in `services/fs/fsCore.ts`.
pub const WRITERS_LOCK_FILE: &str = "writers.lock";
/// Directory of the project locks; equals `PROJECT_LOCKS_DIR_NAME` in `services/fs/fsCore.ts`.
pub const PROJECT_LOCKS_DIR: &str = "project-locks";
/// Suffix of a project lock file; equals `LOCK_SUFFIX` in `services/fs/fsCore.ts`.
pub const PROJECT_LOCK_SUFFIX: &str = ".lock";
/// How long a joining process waits for another one that is reclaiming right now.
const SHARED_LOCK_WAIT: Duration = Duration::from_secs(5);

/// Held by a writing process for its whole lifetime; dropping it lets a later process reclaim.
#[derive(Debug)]
pub struct WriterLock {
    _file: File,
}

/// How a process joined the writers of an app-data directory.
#[derive(Debug)]
pub enum Joined {
    /// No other writer was alive: orphaned project locks were reclaimed (or the reclaim stopped).
    Alone(Result<usize, ReclaimError>),
    /// Another writer is alive: nothing was removed.
    WithOthers,
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

fn open_lock_file(app_data: &Path) -> io::Result<File> {
    fs::create_dir_all(app_data)?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(app_data.join(WRITERS_LOCK_FILE))
}

/// Joins the writers of `app_data`: reclaims orphaned project locks when no other writer is alive,
/// then holds a shared lock for as long as the returned [`WriterLock`] lives. Call it once per process,
/// before the process creates any project lock.
pub fn join_writers(app_data: &Path) -> io::Result<(WriterLock, Joined)> {
    let probe = open_lock_file(app_data)?;
    let joined = match probe.try_lock() {
        Ok(()) => Joined::Alone(reclaim_orphaned_project_locks(app_data)),
        Err(TryLockError::WouldBlock) => Joined::WithOthers,
        Err(TryLockError::Error(error)) => return Err(error),
    };
    drop(probe);
    let file = open_lock_file(app_data)?;
    take_shared(&file)?;
    Ok((WriterLock { _file: file }, joined))
}

/// Waits a bounded time for a shared lock; another process only holds it exclusively while reclaiming.
fn take_shared(file: &File) -> io::Result<()> {
    let deadline = Instant::now() + SHARED_LOCK_WAIT;
    loop {
        match file.try_lock_shared() {
            Ok(()) => return Ok(()),
            Err(TryLockError::Error(error)) => return Err(error),
            Err(TryLockError::WouldBlock) if Instant::now() >= deadline => {
                return Err(io::Error::new(
                    io::ErrorKind::WouldBlock,
                    "another process held the writers lock exclusively for too long",
                ));
            }
            Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Removes every regular `*.lock` file directly inside `project-locks/`; only called under the
/// exclusive lock. Subdirectories, symlinks and other files stay, and the first failure stops it.
fn reclaim_orphaned_project_locks(app_data: &Path) -> Result<usize, ReclaimError> {
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
    use std::time::{SystemTime, UNIX_EPOCH};

    const CHILD_DIR_ENV: &str = "WORLDSCRIPT_WRITERS_LOCK_CHILD_DIR";
    const CHILD_TEST: &str = "child_holds_the_writers_lock";

    fn temp_app_data(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after 1970")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ws-writers-lock-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(dir.join(PROJECT_LOCKS_DIR)).expect("temp app data");
        dir
    }

    fn reclaimed(joined: &Joined) -> Option<usize> {
        match joined {
            Joined::Alone(Ok(count)) => Some(*count),
            _ => None,
        }
    }

    /// Kills the child on every exit path, so a failing assertion can never leave it holding the lock.
    struct KillOnDrop(std::process::Child);

    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// Joins again until it is alone; Windows may release a dead holder's lock with a short delay.
    fn join_alone_within(dir: &Path, limit: Duration) -> Option<(WriterLock, usize)> {
        let deadline = Instant::now() + limit;
        loop {
            let (lock, joined) = join_writers(dir).expect("writers lock");
            if let Some(count) = reclaimed(&joined) {
                return Some((lock, count));
            }
            drop(lock);
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn a_live_writer_keeps_a_new_one_from_reclaiming_its_locks() {
        let dir = temp_app_data("live");
        let (first, joined) = join_writers(&dir).unwrap();
        assert_eq!(reclaimed(&joined), Some(0));
        fs::write(dir.join(PROJECT_LOCKS_DIR).join("live.lock"), b"").unwrap();
        let (second, joined) = join_writers(&dir).unwrap();
        assert!(matches!(joined, Joined::WithOthers));
        assert!(dir.join(PROJECT_LOCKS_DIR).join("live.lock").exists());
        drop(first);
        drop(second);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_shared_writer_also_keeps_later_writers_from_reclaiming() {
        // A (alone) and B (with others) both write; A exits; C must still see B and remove nothing.
        let dir = temp_app_data("shared");
        let (a, _) = join_writers(&dir).unwrap();
        let (b, joined) = join_writers(&dir).unwrap();
        assert!(matches!(joined, Joined::WithOthers));
        fs::write(dir.join(PROJECT_LOCKS_DIR).join("b-live.lock"), b"").unwrap();
        drop(a);
        let (c, joined) = join_writers(&dir).unwrap();
        assert!(matches!(joined, Joined::WithOthers));
        assert!(dir.join(PROJECT_LOCKS_DIR).join("b-live.lock").exists());
        drop(b);
        drop(c);
        fs::remove_dir_all(&dir).ok();
    }

    /// The child side of `the_os_releases_a_killed_writer_so_its_orphans_are_reclaimed`; a no-op otherwise.
    #[test]
    #[ignore = "runs only as the child process of the crash test"]
    fn child_holds_the_writers_lock() {
        let Some(dir) = std::env::var_os(CHILD_DIR_ENV) else {
            return;
        };
        let (_held, _) = join_writers(Path::new(&dir)).expect("child joins the writers");
        fs::write(
            Path::new(&dir).join(PROJECT_LOCKS_DIR).join("orphan.lock"),
            b"",
        )
        .expect("child creates a project lock");
        println!("HELD");
        // Bounded, so a parent that dies early can never leave this process holding the lock for long.
        std::thread::sleep(Duration::from_secs(120));
    }

    #[test]
    fn the_os_releases_a_killed_writer_so_its_orphans_are_reclaimed() {
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
        assert!(held, "the child never joined the writers");
        let (probe, joined) = join_writers(&dir).unwrap();
        assert!(
            matches!(joined, Joined::WithOthers),
            "a live writer in another process must keep this one from reclaiming"
        );
        assert!(dir.join(PROJECT_LOCKS_DIR).join("orphan.lock").exists());
        drop(probe);
        // A kill runs no destructor: SIGKILL on Unix, TerminateProcess on Windows.
        child.0.kill().unwrap();
        child.0.wait().unwrap();
        let (_lock, count) = join_alone_within(&dir, Duration::from_secs(10))
            .expect("the OS must release the lock of a killed writer");
        assert_eq!(count, 1);
        assert!(!dir.join(PROJECT_LOCKS_DIR).join("orphan.lock").exists());
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
        let (held, joined) = join_writers(&dir).unwrap();
        assert_eq!(reclaimed(&joined), Some(2));
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
        fs::remove_dir_all(dir.join(PROJECT_LOCKS_DIR)).unwrap();
        let (held, joined) = join_writers(&dir).unwrap();
        assert_eq!(reclaimed(&joined), Some(0));
        drop(held);
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn reclaim_never_follows_a_symlink() {
        let dir = temp_app_data("symlink");
        let locks = dir.join(PROJECT_LOCKS_DIR);
        let target = dir.join("target.lock");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, locks.join("link.lock")).unwrap();
        let (held, joined) = join_writers(&dir).unwrap();
        assert_eq!(reclaimed(&joined), Some(0));
        assert!(target.exists());
        assert!(fs::symlink_metadata(locks.join("link.lock")).is_ok());
        drop(held);
        fs::remove_dir_all(&dir).ok();
    }
}
