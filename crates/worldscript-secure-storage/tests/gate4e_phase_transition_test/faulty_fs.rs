//! A file system that stops a root commit where the anchor does not: it fails the creation of a file
//! below a named fragment, or the rename onto a named target, and delegates everything else. It also
//! counts every call it serves, and the bounded reads separately, and can run an action right after the
//! n-th bounded read.

use std::ffi::OsString;
use std::fs::File;
use std::io;

use worldscript_secure_storage::DirectoryDurability;

use super::*;

pub struct FaultyFs {
    inner: StdFs,
    fail_create_below: Option<&'static str>,
    fail_rename_to: Option<&'static str>,
    calls: usize,
    #[cfg(unix)]
    reads: usize,
    #[cfg(unix)]
    after_reads: Option<(usize, Box<dyn FnMut()>)>,
    #[cfg(unix)]
    served: usize,
    #[cfg(unix)]
    after_served: Option<(usize, Box<dyn FnMut()>)>,
}

impl FaultyFs {
    /// Delegates everything and counts the bounded reads.
    pub fn observing() -> Self {
        FaultyFs {
            inner: StdFs,
            fail_create_below: None,
            fail_rename_to: None,
            calls: 0,
            #[cfg(unix)]
            reads: 0,
            #[cfg(unix)]
            after_reads: None,
            #[cfg(unix)]
            served: 0,
            #[cfg(unix)]
            after_served: None,
        }
    }

    /// Delegates everything and runs `action` right after the `count`-th bounded read. Only Unix tests
    /// swap a directory under the file system's feet: Windows refuses to rename a pinned directory.
    #[cfg(unix)]
    pub fn acting_after_reads(count: usize, action: impl FnMut() + 'static) -> Self {
        FaultyFs {
            after_reads: Some((count, Box::new(action))),
            ..Self::observing()
        }
    }

    /// Delegates everything and runs `action` right after the `count`-th read of any kind, bounded or
    /// not. Only Unix tests act from inside the file system.
    #[cfg(unix)]
    pub fn acting_after_served_reads(count: usize, action: impl FnMut() + 'static) -> Self {
        FaultyFs {
            after_served: Some((count, Box::new(action))),
            ..Self::observing()
        }
    }

    /// How many reads of any kind were served.
    #[cfg(unix)]
    pub fn served(&self) -> usize {
        self.served
    }

    #[cfg(unix)]
    fn after_served_read(&mut self) {
        self.served += 1;
        if let Some((count, action)) = self.after_served.as_mut() {
            if self.served == *count {
                action();
            }
        }
    }

    /// How many calls of any kind were served: zero means the file system was never touched.
    pub fn calls(&self) -> usize {
        self.calls
    }

    /// How many bounded reads were served.
    #[cfg(unix)]
    pub fn reads(&self) -> usize {
        self.reads
    }

    #[cfg(unix)]
    fn after_read(&mut self) {
        self.reads += 1;
        if let Some((count, action)) = self.after_reads.as_mut() {
            if self.reads == *count {
                action();
            }
        }
    }

    /// Fails the creation of every file whose path contains `fragment`.
    pub fn failing_creation_below(fragment: &'static str) -> Self {
        FaultyFs {
            fail_create_below: Some(fragment),
            ..Self::observing()
        }
    }

    /// Fails every rename onto a path that contains `fragment`.
    pub fn failing_rename_to(fragment: &'static str) -> Self {
        FaultyFs {
            fail_rename_to: Some(fragment),
            ..Self::observing()
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
        self.calls += 1;
        if contains(path, self.fail_create_below) {
            return Err(injected());
        }
        self.inner.create_new(path)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.calls += 1;
        if contains(to, self.fail_rename_to) {
            return Err(injected());
        }
        self.inner.rename_replace(from, to)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.calls += 1;
        self.inner.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.calls += 1;
        let served = self.inner.read(path);
        #[cfg(unix)]
        self.after_served_read();
        served
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        self.calls += 1;
        let served = self.inner.read_at_most(path, limit);
        #[cfg(unix)]
        self.after_read();
        #[cfg(unix)]
        self.after_served_read();
        served
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.calls += 1;
        self.inner.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        self.calls += 1;
        self.inner.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        self.calls += 1;
        self.inner.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        self.calls += 1;
        self.inner.list_dir(dir)
    }

    fn list_dir_at_most(&mut self, dir: &Path, limit: usize) -> io::Result<Option<Vec<OsString>>> {
        self.calls += 1;
        self.inner.list_dir_at_most(dir, limit)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.calls += 1;
        self.inner.create_dir_all(dir)
    }
}
