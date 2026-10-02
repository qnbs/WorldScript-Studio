//! Gate 4 slice 4A: the cross-process `root_commit_mutex` (§11.1) — mutual exclusion across
//! threads and processes, release when a holder crashes, and refusal of a guard for another root.
//!
//! The cross-process cases re-run this test binary as a child holder (selected by an environment
//! variable), so the lock is contended by a genuinely separate process.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    recover_root, KeyProvider, RootCommitGuard, RootLayout, RootStoreError, StdFs,
};

const CHILD_DIR: &str = "WSS_GATE4A_CHILD_ROOT";
const CHILD_MODE: &str = "WSS_GATE4A_CHILD_MODE";

fn temp_root() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "wss-gate4a-lock-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

/// Whether the mutex of `root` becomes free within the polling window. Release is checked by
/// polling, not once: a sibling test spawning a child process (fork, then exec) briefly duplicates
/// every open descriptor, including a just-dropped guard's, until the child execs — the lock is
/// then held a moment longer, never shared.
fn becomes_free(root: &Path) -> bool {
    wait_for(|| matches!(RootCommitGuard::try_acquire(root), Ok(Some(_))))
}

/// Polls `condition` for up to 30 s.
fn wait_for(condition: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

/// Not a test of its own: when started as a child holder it takes the lock, signals `held`, then
/// either waits for `release` or crashes while holding it.
#[test]
fn child_holder() {
    let Ok(root) = std::env::var(CHILD_DIR) else {
        return;
    };
    let root = PathBuf::from(root);
    let _guard = RootCommitGuard::acquire(&root).unwrap();
    fs::write(root.join("held"), b"").unwrap();
    if std::env::var(CHILD_MODE).as_deref() == Ok("crash") {
        std::process::abort();
    }
    assert!(wait_for(|| root.join("release").exists()));
}

/// A child holder process that is released and reaped on every exit path, including a failed
/// assertion, so it never outlives the test still holding the lock.
struct Holder {
    child: Child,
    root: PathBuf,
}

impl Holder {
    fn spawn(root: &Path, mode: &str) -> Self {
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "child_holder", "--nocapture", "--test-threads=1"])
            .env(CHILD_DIR, root)
            .env(CHILD_MODE, mode)
            .spawn()
            .unwrap();
        Holder {
            child,
            root: root.to_path_buf(),
        }
    }

    /// Releases the child and returns whether it exited successfully.
    fn release(&mut self) -> bool {
        let _ = fs::write(self.root.join("release"), b"");
        self.child.wait().is_ok_and(|status| status.success())
    }
}

impl Drop for Holder {
    fn drop(&mut self) {
        let _ = fs::write(self.root.join("release"), b"");
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[test]
fn a_held_mutex_excludes_a_second_holder_until_released() {
    let root = temp_root();
    let guard = RootCommitGuard::acquire(&root).unwrap();
    assert!(RootCommitGuard::try_acquire(&root).unwrap().is_none());
    drop(guard);
    assert!(becomes_free(&root), "root mutex never became free");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn another_process_holding_the_mutex_excludes_this_one() {
    let root = temp_root();
    let mut holder = Holder::spawn(&root, "hold");
    assert!(wait_for(|| root.join("held").exists()), "child never held");
    assert!(RootCommitGuard::try_acquire(&root).unwrap().is_none());
    assert!(holder.release());
    assert!(becomes_free(&root), "root mutex never became free");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn a_crashed_holder_never_leaves_the_mutex_held() {
    let root = temp_root();
    let mut holder = Holder::spawn(&root, "crash");
    assert!(!holder.release());
    assert!(root.join("held").exists(), "child crashed while holding");
    assert!(becomes_free(&root), "root mutex never became free");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn holders_on_separate_threads_never_overlap() {
    let root = Arc::new(temp_root());
    let counter = root.join("counter");
    fs::write(&counter, b"0").unwrap();
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let root = Arc::clone(&root);
            thread::spawn(move || {
                for _ in 0..25 {
                    let _guard = RootCommitGuard::acquire(&root).unwrap();
                    // A read-modify-write that loses updates unless the mutex excludes.
                    let path = root.join("counter");
                    let value: u32 = fs::read_to_string(&path).unwrap().parse().unwrap();
                    thread::yield_now();
                    fs::write(&path, (value + 1).to_string()).unwrap();
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    assert_eq!(fs::read_to_string(&counter).unwrap(), "100");
    let _ = fs::remove_dir_all(&*root);
}

#[test]
fn a_guard_for_another_root_is_refused() {
    let root = temp_root();
    let other = temp_root();
    let mut provider = MemoryKeyProvider::new();
    provider.read_or_provision_installation_scope().unwrap();
    let guard = RootCommitGuard::acquire(&other).unwrap();
    let layout = RootLayout { root_dir: &root };
    assert_eq!(
        recover_root(&mut StdFs, &mut provider, layout, &guard),
        Err(RootStoreError::MutexNotHeld)
    );
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&other);
}

#[cfg(unix)]
#[test]
fn a_replaced_root_directory_voids_the_guard_that_locked_the_old_one() {
    let root = temp_root();
    let guard = RootCommitGuard::acquire(&root).unwrap();
    assert!(guard.guards(&root));
    // Unix locks the root directory itself: a directory put in its place is a different mutex, so
    // the old guard must stop authorizing root writes and the new directory is free.
    let moved = root.with_extension("moved");
    fs::rename(&root, &moved).unwrap();
    fs::create_dir_all(&root).unwrap();
    assert!(!guard.guards(&root));
    assert!(becomes_free(&root), "replacement root never became free");
    let replacement = RootCommitGuard::acquire(&root).unwrap();
    assert!(replacement.guards(&root));
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&moved);
}
