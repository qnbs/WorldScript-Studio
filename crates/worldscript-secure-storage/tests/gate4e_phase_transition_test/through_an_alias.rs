//! Gate 4E E2 follow-up: the phase transition commits on the root the admission was proven for,
//! not on a spelling of it that a symbolic link can retarget. Unix only: these cases need a symbolic
//! link, which only Unix creates without a privilege.

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::os::unix::fs::symlink;

use worldscript_secure_storage::DirectoryDurability;

use super::*;

/// A file system that, on its first read, points the alias at another root, as a local attacker
/// with write access to the installation could between the admission proof and the first write.
struct RetargetingFs {
    inner: StdFs,
    alias: PathBuf,
    other: PathBuf,
    fired: bool,
}

impl RetargetingFs {
    fn new(alias: &Path, other: &Path) -> Self {
        RetargetingFs {
            inner: StdFs,
            alias: alias.to_path_buf(),
            other: other.to_path_buf(),
            fired: false,
        }
    }

    fn retarget_once(&mut self) {
        if !self.fired {
            self.fired = true;
            fs::remove_file(&self.alias).unwrap();
            symlink(&self.other, &self.alias).unwrap();
        }
    }
}

impl DurableFs for RetargetingFs {
    type File = File;

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.retarget_once();
        self.inner.read(path)
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        self.retarget_once();
        self.inner.read_at_most(path, limit)
    }

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.inner.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.inner.sync_file(file)
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

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.inner.create_dir_all(dir)
    }
}

/// Every path below `dir`, relative to it, to prove that nothing was created.
fn tree_of(dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
            out.push(name.clone());
            if entry.file_type().unwrap().is_dir() {
                walk(&entry.path(), &name, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, "", &mut out);
    out.sort();
    out
}

#[test]
fn a_root_alias_retargeted_during_the_commit_cannot_redirect_it() {
    let mut bound = Bound::new();
    let foreign = Installation::new();
    let alias = bound.installation.base.join("alias");
    symlink(&bound.installation.root_dir, &alias).unwrap();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let foreign_before = tree_of(&foreign.base);
    let mut admission = bound.installation.exclusive();
    let mut fs = RetargetingFs::new(&alias, &foreign.root_dir);
    let attempt = Attempt {
        fs: &mut fs,
        root_dir: &alias,
    };
    let result = bound.transition_through(&mut admission, attempt, &discover);
    assert!(fs.fired, "the alias was retargeted during the call");
    result.unwrap();
    assert_eq!(bound.committed(), discover);
    assert_eq!(tree_of(&foreign.base), foreign_before);
}

#[test]
fn a_root_alias_that_leads_to_another_root_is_refused_before_anything_is_written() {
    let mut bound = Bound::new();
    let foreign = Installation::new();
    let alias = bound.installation.base.join("alias");
    symlink(&foreign.root_dir, &alias).unwrap();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let (before, foreign_before) = (bound.state(), tree_of(&foreign.base));
    let mut admission = bound.installation.exclusive();
    let attempt = Attempt {
        fs: &mut StdFs,
        root_dir: &alias,
    };
    assert_eq!(
        bound.transition_through(&mut admission, attempt, &discover),
        Err(AuthorityError::NotAdmitted)
    );
    assert_eq!(bound.state(), before);
    assert_eq!(tree_of(&foreign.base), foreign_before);
}

#[test]
fn an_exclusive_recovery_through_a_root_alias_retargeted_during_it_stays_on_the_admitted_root() {
    use worldscript_secure_storage::memory_provider::{AnchorOp, Fault};
    use worldscript_secure_storage::{recover_root_exclusive, RootRecovery};

    let mut bound = Bound::new();
    let foreign = Installation::new();
    let next = entering(&bound.zero, phase_code::DISCOVER);
    {
        let mut admission = bound.installation.exclusive();
        bound
            .provider
            .inject(Fault::BeforePersist(AnchorOp::Commit));
        assert!(bound.transition(&mut admission, &next).is_err());
    }
    let alias = bound.installation.base.join("alias");
    symlink(&bound.installation.root_dir, &alias).unwrap();
    let foreign_before = tree_of(&foreign.base);
    let mut admission = bound.installation.exclusive();
    let event = admission.try_root_commit().unwrap().expect("root idle");
    let mut fs = RetargetingFs::new(&alias, &foreign.root_dir);
    let layout = RootLayout { root_dir: &alias };
    let recovery = recover_root_exclusive(&mut fs, &mut bound.provider, layout, &event);
    assert!(fs.fired, "the alias was retargeted during the recovery");
    assert!(matches!(recovery, Ok(RootRecovery::Completed { .. })));
    drop(event);
    drop(admission);
    assert_eq!(bound.committed(), next);
    assert_eq!(tree_of(&foreign.base), foreign_before);
}
