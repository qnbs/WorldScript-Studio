//! Gate 4B foundation: admission mode matrix, kernel crash release, identity and lock ordering.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU32, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use worldscript_secure_storage::{
    AdmissionError, AdmissionScope, ExclusiveAdmissionGuard, RootCommitGuard, SharedAdmissionGuard,
};

const CHILD_INSTALLATION: &str = "WSS_GATE4B_CHILD_INSTALLATION";
const CHILD_MODE: &str = "WSS_GATE4B_CHILD_MODE";

struct Installation(PathBuf);

impl Installation {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "wss-gate4b-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("authority")).unwrap();
        Self(dir)
    }

    fn root(&self) -> PathBuf {
        self.0.join("authority")
    }
}

impl Drop for Installation {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn scope<'a>(installation: &'a Path, root: &'a Path) -> AdmissionScope<'a> {
    AdmissionScope {
        installation_dir: installation,
        root_dir: root,
    }
}

// A sibling fork temporarily inherits open descriptors until exec; poll release rather than
// treating that conservative delay as an abandoned lock (the same harness choice as 4A).
fn wait_for(mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn child_holder() {
    let Ok(installation) = std::env::var(CHILD_INSTALLATION) else {
        return;
    };
    let installation = PathBuf::from(installation);
    let root = installation.join("authority");
    let mode = std::env::var(CHILD_MODE).unwrap();
    let shared = if mode.starts_with("shared") {
        Some(
            SharedAdmissionGuard::try_acquire(scope(&installation, &root))
                .unwrap()
                .unwrap(),
        )
    } else {
        None
    };
    let exclusive = if mode.starts_with("exclusive") {
        Some(
            ExclusiveAdmissionGuard::try_acquire(scope(&installation, &root))
                .unwrap()
                .unwrap(),
        )
    } else {
        None
    };
    fs::write(installation.join("held"), b"").unwrap();
    assert!(
        wait_for(|| installation.join("release").exists()),
        "child release never arrived"
    );
    if mode.ends_with("crash") {
        std::process::abort();
    }
    drop((shared, exclusive));
}

struct Holder {
    child: Child,
    installation: PathBuf,
}

impl Holder {
    fn spawn(installation: &Path, mode: &str) -> Self {
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "child_holder", "--nocapture", "--test-threads=1"])
            .env(CHILD_INSTALLATION, installation)
            .env(CHILD_MODE, mode)
            .spawn()
            .unwrap();
        let holder = Self {
            child,
            installation: installation.to_path_buf(),
        };
        assert!(
            wait_for(|| installation.join("held").exists()),
            "child never held admission"
        );
        holder
    }

    fn release(&mut self) -> bool {
        fs::write(self.installation.join("release"), b"").unwrap();
        self.child.wait().unwrap().success()
    }
}

impl Drop for Holder {
    fn drop(&mut self) {
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[test]
fn shared_holders_coexist_and_exclusive_waits_for_the_last_one() {
    let installation = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let first = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    let second = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    assert!(ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_none());
    drop(first);
    assert!(ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_none());
    drop(second);
    assert!(wait_for(|| ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_some()));
}

#[test]
fn exclusive_excludes_both_modes_until_drop() {
    let installation = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let exclusive = ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .unwrap();
    assert!(SharedAdmissionGuard::try_acquire(scope).unwrap().is_none());
    assert!(ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_none());
    drop(exclusive);
    assert!(wait_for(|| SharedAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_some()));
}

#[test]
fn another_process_observes_the_complete_mode_matrix() {
    for mode in ["shared", "exclusive"] {
        let installation = Installation::new();
        let root = installation.root();
        let scope = scope(&installation.0, &root);
        let mut holder = Holder::spawn(&installation.0, mode);
        assert_eq!(
            SharedAdmissionGuard::try_acquire(scope).unwrap().is_some(),
            mode == "shared"
        );
        assert!(ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_none());
        assert!(holder.release());
        assert!(wait_for(|| ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_some()));
    }
}

#[test]
fn crashed_owners_release_both_modes_without_removing_lock_files() {
    for mode in ["shared-crash", "exclusive-crash"] {
        let installation = Installation::new();
        let root = installation.root();
        let scope = scope(&installation.0, &root);
        let mut holder = Holder::spawn(&installation.0, mode);
        assert!(ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_none());
        assert!(!holder.release());
        assert!(wait_for(|| ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_some()));
    }
}

#[test]
fn two_root_events_keep_one_shared_admission_without_upgrade() {
    let installation = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let mut admission = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    let peer = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    for _ in 0..2 {
        let event = admission.try_root_commit().unwrap().unwrap();
        assert!(event.root_guard().unwrap().guards(&root));
        assert!(RootCommitGuard::try_acquire(&root).unwrap().is_none());
        drop(event);
        assert!(wait_for(|| RootCommitGuard::try_acquire(&root)
            .unwrap()
            .is_some()));
        assert!(ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_none());
    }
    drop(peer);
    drop(admission);
    assert!(wait_for(|| ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_some()));
}

#[test]
fn wrong_root_wrong_installation_and_non_child_scopes_fail_closed() {
    let installation = Installation::new();
    let other = Installation::new();
    let root = installation.root();
    let other_root = other.root();
    let admission = SharedAdmissionGuard::try_acquire(scope(&installation.0, &root))
        .unwrap()
        .unwrap();
    assert!(!admission.guards(scope(&other.0, &other_root)));
    assert!(!admission.guards(scope(&installation.0, &other_root)));
    assert_eq!(
        SharedAdmissionGuard::try_acquire(scope(&installation.0, &other_root)).unwrap_err(),
        AdmissionError::InvalidScope
    );
    assert_eq!(
        SharedAdmissionGuard::try_acquire(scope(&root, &root)).unwrap_err(),
        AdmissionError::InvalidScope
    );
    assert!(
        ExclusiveAdmissionGuard::try_acquire(scope(&other.0, &other_root))
            .unwrap()
            .is_some()
    );
}

#[test]
fn missing_and_non_directory_scopes_are_errors_not_contention() {
    let installation = Installation::new();
    let missing = installation.0.join("missing");
    assert!(matches!(
        SharedAdmissionGuard::try_acquire(scope(&installation.0, &missing)),
        Err(AdmissionError::Io(_))
    ));
    let file = installation.0.join("ordinary-file");
    fs::write(&file, b"preserve").unwrap();
    assert!(matches!(
        SharedAdmissionGuard::try_acquire(scope(&installation.0, &file)),
        Err(AdmissionError::Io(_))
    ));
    assert_eq!(fs::read(&file).unwrap(), b"preserve");
}

#[test]
fn guards_can_move_to_another_thread_and_unwind_releases_admission() {
    fn send<T: Send>() {}
    send::<SharedAdmissionGuard>();
    send::<ExclusiveAdmissionGuard>();
    let installation = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let guard = ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .unwrap();
    let result = thread::spawn(move || {
        let _guard = guard;
        panic!("cancel operation");
    })
    .join();
    assert!(result.is_err());
    assert!(wait_for(|| ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_some()));
}

#[cfg(unix)]
#[test]
fn canonical_aliases_match_and_root_replacement_voids_old_admission() {
    let installation = Installation::new();
    let root = installation.root();
    let alias = installation.0.join("alias");
    std::os::unix::fs::symlink(&root, &alias).unwrap();
    let mut admission = SharedAdmissionGuard::try_acquire(scope(&installation.0, &alias))
        .unwrap()
        .unwrap();
    assert!(admission.guards(scope(&installation.0, &root)));
    let moved = installation.0.join("moved");
    fs::rename(&root, &moved).unwrap();
    fs::create_dir(&root).unwrap();
    assert!(!admission.guards(scope(&installation.0, &root)));
    assert!(matches!(
        admission.try_root_commit(),
        Err(AdmissionError::IdentityChanged)
    ));
    // The installation lock survives a child-root replacement: new transition owners still wait.
    assert!(
        ExclusiveAdmissionGuard::try_acquire(scope(&installation.0, &root))
            .unwrap()
            .is_none()
    );
}

#[cfg(unix)]
#[test]
fn installation_replacement_cannot_reuse_the_old_token() {
    let installation = Installation::new();
    let other = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let mut admission = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    fs::rename(&installation.0, other.0.join("moved-installation")).unwrap();
    fs::create_dir_all(&root).unwrap();
    assert!(!admission.guards(scope));
    assert!(matches!(
        admission.try_root_commit(),
        Err(AdmissionError::IdentityChanged)
    ));
    assert!(ExclusiveAdmissionGuard::try_acquire(scope)
        .unwrap()
        .is_some());
}

#[cfg(windows)]
#[test]
fn windows_ancestor_replacement_is_prevented_or_invalidates_the_guard() {
    let fixture = Installation::new();
    let parent = fixture.0.join("parent");
    let installation = parent.join("installation");
    let root = installation.join("authority");
    fs::create_dir_all(&root).unwrap();
    let scope = scope(&installation, &root);
    let mut guard = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    // Sharing semantics may refuse the ancestor rename. If allowed, existence at the original
    // spelling must not authorize the replacement objects while the old handle remains alive.
    if fs::rename(&parent, fixture.0.join("old-parent")).is_ok() {
        fs::create_dir_all(&root).unwrap();
        assert!(!guard.guards(scope));
        assert!(matches!(
            guard.try_root_commit(),
            Err(AdmissionError::IdentityChanged)
        ));
    } else {
        assert!(guard.guards(scope));
    }
}

#[cfg(windows)]
#[test]
fn windows_refuses_a_redirected_admission_file_without_touching_its_target() {
    let installation = Installation::new();
    let root = installation.root();
    let target = installation.0.join("unrelated-file");
    fs::write(&target, b"preserve").unwrap();
    // Windows CI runs with symlink creation privileges; no privilege-based skip certifies this case.
    std::os::windows::fs::symlink_file(
        &target,
        installation
            .0
            .join(worldscript_secure_storage::OPERATION_ADMISSION_LOCK_FILE),
    )
    .unwrap();
    assert!(matches!(
        SharedAdmissionGuard::try_acquire(scope(&installation.0, &root)),
        Err(AdmissionError::Io(_))
    ));
    assert_eq!(fs::read(&target).unwrap(), b"preserve");
}

#[cfg(windows)]
#[test]
fn windows_pins_both_directories_and_the_lock_file_against_replacement() {
    let installation = Installation::new();
    let root = installation.root();
    let scope = scope(&installation.0, &root);
    let guard = SharedAdmissionGuard::try_acquire(scope).unwrap().unwrap();
    assert!(fs::rename(&root, installation.0.join("moved")).is_err());
    assert!(fs::rename(&installation.0, installation.0.with_extension("moved")).is_err());
    assert!(fs::remove_file(
        installation
            .0
            .join(worldscript_secure_storage::OPERATION_ADMISSION_LOCK_FILE)
    )
    .is_err());
    assert!(guard.guards(scope));
}
