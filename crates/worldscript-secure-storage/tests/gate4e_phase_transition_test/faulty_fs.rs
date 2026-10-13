//! A file system that stops a root commit where the anchor does not: it fails the creation of a file
//! below a named fragment, or the rename onto a named target, and delegates everything else.

use std::ffi::OsString;
use std::fs::File;
use std::io;

use worldscript_secure_storage::DirectoryDurability;

use super::*;

pub struct FaultyFs {
    inner: StdFs,
    fail_create_below: Option<&'static str>,
    fail_rename_to: Option<&'static str>,
}

impl FaultyFs {
    /// Fails the creation of every file whose path contains `fragment`.
    pub fn failing_creation_below(fragment: &'static str) -> Self {
        FaultyFs {
            inner: StdFs,
            fail_create_below: Some(fragment),
            fail_rename_to: None,
        }
    }

    /// Fails every rename onto a path that contains `fragment`.
    pub fn failing_rename_to(fragment: &'static str) -> Self {
        FaultyFs {
            inner: StdFs,
            fail_create_below: None,
            fail_rename_to: Some(fragment),
        }
    }
}

fn injected() -> io::Error {
    io::Error::other("injected file system failure")
}

fn contains(path: &Path, fragment: Option<&str>) -> bool {
    fragment.is_some_and(|needle| path.to_string_lossy().contains(needle))
}

impl DurableFs for FaultyFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        if contains(path, self.fail_create_below) {
            return Err(injected());
        }
        self.inner.create_new(path)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        if contains(to, self.fail_rename_to) {
            return Err(injected());
        }
        self.inner.rename_replace(from, to)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.inner.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        self.inner.read_at_most(path, limit)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        self.inner.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        self.inner.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        self.inner.list_dir(dir)
    }

    fn list_dir_at_most(&mut self, dir: &Path, limit: usize) -> io::Result<Option<Vec<OsString>>> {
        self.inner.list_dir_at_most(dir, limit)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.inner.create_dir_all(dir)
    }
}
