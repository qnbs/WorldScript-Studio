//! Tests of the pinned seam. They are unit tests so that the macOS and Windows evidence job, which runs
//! the library tests only, exercises the same cases as Linux.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

mod read;
#[cfg(feature = "test-support")]
mod remove;
#[cfg(all(feature = "test-support", unix))]
mod remove_unix;
#[cfg(all(feature = "test-support", windows))]
mod remove_windows;
#[cfg(windows)]
mod windows_redirect;

/// A scratch directory below the temp dir, removed when dropped.
pub(super) struct Scratch(PathBuf);

impl Scratch {
    pub(super) fn new(label: &str) -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let unique = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("wss-h1a-{label}-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Scratch(path)
    }

    /// The directory the tests pin.
    pub(super) fn root(&self) -> PathBuf {
        let root = self.0.join("root");
        fs::create_dir_all(&root).unwrap();
        root
    }

    /// A place outside the pinned root.
    pub(super) fn aside(&self) -> PathBuf {
        let aside = self.0.join("aside");
        fs::create_dir_all(&aside).unwrap();
        aside
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Removes the link `link` to a directory, not its target.
pub(super) fn remove_dir_link(link: &Path) {
    #[cfg(unix)]
    fs::remove_file(link).unwrap();
    #[cfg(windows)]
    fs::remove_dir(link).unwrap();
}

/// A link to the directory `target` at `link`: a symbolic link on Unix, a junction on Windows (which
/// needs no privilege).
pub(super) fn link_to_dir(target: &Path, link: &Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // `mklink` is a command of the shell, so both paths are quoted and anything the shell would still
        // interpret inside quotes is refused instead of run.
        let quoted = |path: &Path| {
            let text = path.to_str().unwrap();
            assert!(
                !text.contains(['"', '%', '^', '!']),
                "a path the shell would interpret: {text}"
            );
            format!("\"{text}\"")
        };
        let made = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .raw_arg(quoted(link))
            .raw_arg(quoted(target))
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
    }
}
