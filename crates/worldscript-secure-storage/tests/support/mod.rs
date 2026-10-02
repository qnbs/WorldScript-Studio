//! Shared fixtures for the Gate 3 slice 3B commit tests: temporary record/marker directories, the
//! fault-injecting filesystem, and intent-level assertions.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    commit_write, load_authority, read_committed, reconcile, Authority, CommitError, CommitMarker,
    DebrisKind, DirectoryDurability, DurableFs, Key, MarkerBody, RecordClass, RecordIdentity,
    RecordLocation, RecordStore, RecoveryReason, Resolution, StdFs, WriteRequest,
};

pub const FIRST: &[u8] = b"{\"theme\":\"dark\"}";
pub const SECOND: &[u8] = b"{\"theme\":\"light\"}";
pub const THIRD: &[u8] = b"{\"theme\":\"sepia\"}";
pub const REQUEST: WriteRequest = WriteRequest {
    key_epoch: 1,
    record_schema: 1,
};

pub fn key() -> Key {
    Key::from_bytes(&mut [9u8; 32])
}

pub fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

/// A record directory and a marker directory under a fresh temp root, removed on drop.
pub struct Dirs {
    pub root: PathBuf,
    pub record: PathBuf,
    pub marker: PathBuf,
    key: Key,
    identity: RecordIdentity,
}

impl Dirs {
    pub fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "wss-gate3b-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        // A root left by an aborted earlier run (same PID, same counter) is cleared first.
        let _ = fs::remove_dir_all(&root);
        let (record, marker) = (root.join("record"), root.join("marker"));
        fs::create_dir_all(&record).unwrap();
        fs::create_dir_all(&marker).unwrap();
        Dirs {
            root,
            record,
            marker,
            key: key(),
            identity: settings(),
        }
    }

    pub fn store(&self) -> RecordStore<'_> {
        RecordStore {
            key: &self.key,
            record: &self.identity,
            location: RecordLocation {
                record_dir: &self.record,
                marker_dir: &self.marker,
            },
        }
    }
}

impl Drop for Dirs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub fn write(fs: &mut impl DurableFs, dirs: &Dirs, plaintext: &[u8]) -> Result<u64, CommitError> {
    commit_write(fs, dirs.store(), REQUEST, plaintext).map(|committed| committed.generation)
}

pub fn read(dirs: &Dirs) -> Result<Option<Vec<u8>>, CommitError> {
    read_committed(&mut StdFs, dirs.store()).map(|opened| opened.map(|record| record.payload))
}

pub fn authority(dirs: &Dirs) -> Result<Authority, CommitError> {
    load_authority(&mut StdFs, dirs.store())
}

/// Reconciles and returns the resolution and the kinds of the debris found, in path order.
pub fn startup(dirs: &Dirs) -> (Resolution, Vec<DebrisKind>) {
    let reconciled = reconcile(&mut StdFs, dirs.store(), 1).unwrap();
    let kinds = reconciled.debris.iter().map(|debris| debris.kind).collect();
    (reconciled.resolution, kinds)
}

/// Startup resolves as `resolution`, leaving exactly the debris `kinds`, and then serves `payload`.
pub fn assert_startup(dirs: &Dirs, resolution: Resolution, kinds: &[DebrisKind], payload: &[u8]) {
    assert_eq!(startup(dirs), (resolution, kinds.to_vec()));
    assert_eq!(read(dirs).unwrap().as_deref(), Some(payload));
}

pub fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

pub fn rejected_files(dir: &Path) -> Vec<Vec<u8>> {
    names(dir)
        .iter()
        .filter(|name| name.contains(".rejected-"))
        .map(|name| fs::read(dir.join(name)).unwrap())
        .collect()
}

pub fn assert_no_plaintext(dirs: &Dirs) {
    for dir in [&dirs.record, &dirs.marker] {
        for name in names(dir) {
            let bytes = fs::read(dir.join(&name)).unwrap();
            for plaintext in [FIRST, SECOND, THIRD] {
                assert!(
                    !bytes.windows(plaintext.len()).any(|w| w == plaintext),
                    "plaintext in {name}"
                );
            }
        }
    }
}

pub fn marker_bytes(marker_generation: u64, body: MarkerBody) -> Vec<u8> {
    CommitMarker::new(&settings(), marker_generation, body)
        .unwrap()
        .seal(&key(), 1)
        .unwrap()
}

pub fn recovery_required(reason: RecoveryReason) -> Result<Authority, CommitError> {
    Err(CommitError::RecoveryRequired(reason))
}

/// The filesystem operations a fault can target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Create,
    Read,
    Link,
    SyncDir,
}

/// The real filesystem, failing the `nth` (0-based) operation `op` whose path is inside `dir`.
pub struct FaultFs {
    op: Op,
    dir: PathBuf,
    nth: u32,
    seen: u32,
}

impl FaultFs {
    pub fn new(op: Op, dir: &Path, nth: u32) -> Self {
        FaultFs {
            op,
            dir: dir.to_path_buf(),
            nth,
            seen: 0,
        }
    }

    fn trips(&mut self, op: Op, path: &Path) -> bool {
        let inside = path == self.dir || path.parent() == Some(self.dir.as_path());
        if op != self.op || !inside {
            return false;
        }
        self.seen += 1;
        self.seen == self.nth + 1
    }
}

pub fn injected() -> io::Error {
    io::Error::other("injected fault")
}

impl DurableFs for FaultFs {
    type File = fs::File;

    fn create_new(&mut self, path: &Path) -> io::Result<fs::File> {
        if self.trips(Op::Create, path) {
            return Err(injected());
        }
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut fs::File) -> io::Result<()> {
        file.flush()?;
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        if self.trips(Op::Read, path) {
            return Err(injected());
        }
        StdFs.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        if self.trips(Op::Link, to) {
            return Err(injected());
        }
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        if self.trips(Op::SyncDir, dir) {
            return Err(injected());
        }
        StdFs.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        StdFs.list_dir(dir)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        StdFs.create_dir_all(dir)
    }
}

/// Marker-directory syncs in one write: the chain loads of the initial reconciliation and of the
/// write itself (0, 1), then the PENDING (2) and ACTIVE (3) marker promotions.
pub const ACTIVE_MARKER_SYNC: u32 = 3;

/// A replacement write of `SECOND` over a committed `FIRST`, interrupted by `fault`.
pub fn interrupted_replacement(dirs: &Dirs, mut fault: FaultFs) -> CommitError {
    write(&mut StdFs, dirs, FIRST).unwrap();
    write(&mut fault, dirs, SECOND).unwrap_err()
}

/// The staging file of the pending write's target generation 2.
pub fn pending_staging(dirs: &Dirs) -> PathBuf {
    let name = names(&dirs.record)
        .into_iter()
        .find(|name| name.starts_with("generation-2.wsr1.tmp-"))
        .expect("the pending write's staging file");
    dirs.record.join(name)
}

pub fn replace(path: &Path, bytes: &[u8]) {
    fs::remove_file(path).unwrap();
    fs::write(path, bytes).unwrap();
}

/// The record serves exactly `payload`.
pub fn assert_serves(dirs: &Dirs, payload: &[u8]) {
    assert_eq!(read(dirs).unwrap().as_deref(), Some(payload));
}

/// A retried write of `plaintext` commits as `generation` and is then served.
pub fn assert_retry(dirs: &Dirs, plaintext: &[u8], generation: u64) {
    assert_eq!(write(&mut StdFs, dirs, plaintext).unwrap(), generation);
    assert_serves(dirs, plaintext);
}
