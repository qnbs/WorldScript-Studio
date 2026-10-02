//! Gate 3 slice 3C part 3c-2b: the protected write and read paths through the authority root
//! (§5.4, §5.5, §9) — a root commit per marker transition, startup resolution of a chain that ran
//! ahead of the root, and reads that serve only the root-named generation.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    commit_write, list_records, protected_write, read_protected, reconcile_protected,
    write_key_epoch, AuthorityError, CatalogRecoveryReason, DirectoryDurability, DurableFs,
    InstallationScopeId, Key, KeyEpochCommit, KeyEpochRecord, KeyEpochStatus, KeyProvider,
    ProtectedError, ProtectedRead, ProtectedReconciled, ProtectedTarget, ProtectedWrite,
    RecordClass, RecordIdentity, RecordLocation, RecordStore, Resolution, RootKeyRefV1, RootLayout,
    StdFs, WriteDurability, WriteRequest,
};

/// The real filesystem, failing every file creation directly inside one directory.
struct CreateFault(PathBuf);

impl DurableFs for CreateFault {
    type File = fs::File;

    fn create_new(&mut self, path: &Path) -> io::Result<fs::File> {
        if path.parent() == Some(self.0.as_path()) {
            return Err(io::Error::other("injected create fault"));
        }
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut fs::File) -> io::Result<()> {
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        StdFs.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
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

fn temp_root() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "wss-gate3c-protected-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

/// A provisioned provider with an epoch-1 `ACTIVE` key-epoch record, both root slots, and one
/// `codex:p1` record with its record and marker directories.
struct Fixture {
    base: PathBuf,
    provider: MemoryKeyProvider,
    key_ref: RootKeyRefV1,
    key: Key,
    record: RecordIdentity,
}

impl Fixture {
    fn new() -> Self {
        let base = temp_root();
        for dir in ["authority/slot-a", "authority/slot-b", "record", "markers"] {
            fs::create_dir_all(base.join(dir)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope: InstallationScopeId = provider.read_or_provision_installation_scope().unwrap();
        let key_ref = provider.provision_epoch_key(1).unwrap();
        provider.unlock().unwrap();
        let record = KeyEpochRecord {
            epoch: 1,
            status: KeyEpochStatus::Active,
            root_key_ref: key_ref.clone(),
        };
        let commit = KeyEpochCommit {
            scope: &scope,
            record: &record,
            registry_generation: 1,
            root_key_ref: &key_ref,
            key_epoch: 1,
        };
        let root_dir = base.join("authority");
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        write_key_epoch(&mut StdFs, &provider, layout, commit).unwrap();
        let key = provider.resolve_ref(&key_ref).unwrap();
        Fixture {
            base,
            provider,
            key_ref,
            key,
            record: RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap(),
        }
    }

    fn root_dir(&self) -> PathBuf {
        self.base.join("authority")
    }

    fn record_dir(&self) -> PathBuf {
        self.base.join("record")
    }

    fn marker_dir(&self) -> PathBuf {
        self.base.join("markers")
    }

    fn write_with(
        &mut self,
        fs: &mut impl DurableFs,
        plaintext: &[u8],
    ) -> Result<(u64, u64, WriteDurability), ProtectedError> {
        let (root_dir, record_dir, marker_dir) =
            (self.root_dir(), self.record_dir(), self.marker_dir());
        let Fixture {
            provider,
            key_ref,
            key,
            record,
            ..
        } = self;
        let dirs = Dirs {
            root_dir: &root_dir,
            record_dir: &record_dir,
            marker_dir: &marker_dir,
        };
        let target = dirs.target(key, record, key_ref);
        let write = ProtectedWrite {
            record_schema: 1,
            plaintext,
        };
        protected_write(fs, provider, target, write).map(|committed| {
            (
                committed.generation,
                committed.root_generation,
                committed.durability,
            )
        })
    }

    fn read(&self) -> Result<ProtectedRead, ProtectedError> {
        let (root_dir, record_dir, marker_dir) =
            (self.root_dir(), self.record_dir(), self.marker_dir());
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let store = store(&record_dir, &marker_dir, &self.key, &self.record);
        read_protected(&mut StdFs, &self.provider, layout, store)
    }

    fn payload(&self) -> Option<Vec<u8>> {
        match self.read().unwrap() {
            ProtectedRead::Record(opened) => Some(opened.payload.to_vec()),
            _ => None,
        }
    }

    fn reconcile(&mut self) -> (Resolution, Option<u64>) {
        let reconciled = self.try_reconcile().unwrap();
        (
            reconciled.resolution,
            reconciled.descriptor.map(|d| d.marker_generation()),
        )
    }

    fn try_reconcile(&mut self) -> Result<ProtectedReconciled, ProtectedError> {
        let (root_dir, record_dir, marker_dir) =
            (self.root_dir(), self.record_dir(), self.marker_dir());
        let Fixture {
            provider,
            key_ref,
            key,
            record,
            ..
        } = self;
        let dirs = Dirs {
            root_dir: &root_dir,
            record_dir: &record_dir,
            marker_dir: &marker_dir,
        };
        let target = dirs.target(key, record, key_ref);
        reconcile_protected(&mut StdFs, provider, target)
    }

    fn listed_marker_states(&self) -> Vec<(u64, u32)> {
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        list_records(&mut StdFs, &self.provider, layout)
            .unwrap()
            .iter()
            .map(|descriptor| (descriptor.marker_generation(), descriptor.marker_state()))
            .collect()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn store<'a>(
    record_dir: &'a Path,
    marker_dir: &'a Path,
    key: &'a Key,
    record: &'a RecordIdentity,
) -> RecordStore<'a> {
    RecordStore {
        key,
        record,
        location: RecordLocation {
            record_dir,
            marker_dir,
        },
    }
}

struct Dirs<'a> {
    root_dir: &'a Path,
    record_dir: &'a Path,
    marker_dir: &'a Path,
}

impl<'a> Dirs<'a> {
    fn target(
        &self,
        key: &'a Key,
        record: &'a RecordIdentity,
        root_key_ref: &'a RootKeyRefV1,
    ) -> ProtectedTarget<'a> {
        ProtectedTarget {
            layout: RootLayout {
                root_dir: self.root_dir,
            },
            store: store(self.record_dir, self.marker_dir, key, record),
            root_key_ref,
            key_epoch: 1,
        }
    }
}

const PENDING: u32 = 2;
const ACTIVE: u32 = 1;

#[test]
fn a_first_write_commits_a_root_per_marker_transition() {
    let mut fixture = Fixture::new();
    assert_eq!(fixture.read(), Ok(ProtectedRead::NotCatalogued));
    let (generation, root_generation, durability) =
        fixture.write_with(&mut StdFs, b"first").unwrap();
    // Root 1 names PENDING(none -> 1); root 2 names ACTIVE(1).
    assert_eq!((generation, root_generation), (1, 2));
    if cfg!(any(target_os = "linux", target_os = "macos")) {
        assert_eq!(durability, WriteDurability::DurableCommitSuccess);
    }
    assert_eq!(fixture.listed_marker_states(), vec![(2, ACTIVE)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"first"[..]));
}

#[test]
fn a_replacement_serves_the_new_generation_only_after_its_root() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    let (generation, root_generation, _) = fixture.write_with(&mut StdFs, b"second").unwrap();
    assert_eq!((generation, root_generation), (2, 4));
    assert_eq!(fixture.listed_marker_states(), vec![(4, ACTIVE)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"second"[..]));
}

#[test]
fn an_interrupted_first_write_is_enumerable_not_readable_then_dropped() {
    let mut fixture = Fixture::new();
    let mut fault = CreateFault(fixture.record_dir());
    assert!(matches!(
        fixture.write_with(&mut fault, b"lost"),
        Err(ProtectedError::Commit(_))
    ));
    // The PENDING root committed before staging failed (§9 step 2).
    assert_eq!(fixture.listed_marker_states(), vec![(1, PENDING)]);
    assert_eq!(fixture.read(), Ok(ProtectedRead::NotYetReadable));

    // Startup rolls the first write back and drops the record from its shard.
    let (resolution, named) = fixture.reconcile();
    assert_eq!(resolution, Resolution::RolledBack { restored: None });
    assert_eq!(named, None);
    assert!(fixture.listed_marker_states().is_empty());
    assert_eq!(fixture.read(), Ok(ProtectedRead::NotCatalogued));

    // A later write starts over from the rolled-back chain.
    assert_eq!(fixture.write_with(&mut StdFs, b"again").unwrap().0, 1);
    assert_eq!(fixture.payload().as_deref(), Some(&b"again"[..]));
}

#[test]
fn an_interrupted_replacement_keeps_serving_the_old_generation() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    let mut fault = CreateFault(fixture.record_dir());
    assert!(fixture.write_with(&mut fault, b"lost").is_err());
    assert_eq!(fixture.listed_marker_states(), vec![(3, PENDING)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"first"[..]));

    let (resolution, named) = fixture.reconcile();
    assert_eq!(resolution, Resolution::RolledBack { restored: Some(1) });
    assert_eq!(named, Some(4));
    assert_eq!(fixture.listed_marker_states(), vec![(4, ACTIVE)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"first"[..]));
}

#[test]
fn a_chain_ahead_of_the_root_is_not_read_until_reconciled() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    // A marker-only write (no root commit), as a crash before §9 step 9 would leave it.
    unrooted_write(&fixture, b"ahead");
    assert_eq!(fixture.listed_marker_states(), vec![(2, ACTIVE)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"first"[..]));

    let (resolution, named) = fixture.reconcile();
    assert_eq!(resolution, Resolution::Unchanged);
    assert_eq!(named, Some(4));
    assert_eq!(fixture.payload().as_deref(), Some(&b"ahead"[..]));
}

#[test]
fn a_missing_root_named_marker_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    fs::remove_file(fixture.marker_dir().join("generation-2.wsr1")).unwrap();
    assert_eq!(
        fixture.read(),
        Err(ProtectedError::Authority(AuthorityError::RecoveryRequired(
            CatalogRecoveryReason::MarkerSetMismatch
        )))
    );
}

#[test]
fn a_replaced_root_named_marker_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    // Marker generation 1 (PENDING) copied over generation 2 opens as generation 1: refused.
    let pending = fs::read(fixture.marker_dir().join("generation-1.wsr1")).unwrap();
    fs::write(fixture.marker_dir().join("generation-2.wsr1"), pending).unwrap();
    assert_eq!(
        fixture.read(),
        Err(ProtectedError::Authority(AuthorityError::RecoveryRequired(
            CatalogRecoveryReason::MarkerSetMismatch
        )))
    );
}

#[test]
fn a_pending_marker_whose_root_never_committed_is_rolled_back() {
    let mut fixture = Fixture::new();
    // The PENDING marker is written, then the §9 step 2 root never prepares.
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    assert!(matches!(
        fixture.write_with(&mut StdFs, b"lost"),
        Err(ProtectedError::Authority(_))
    ));
    assert!(fixture.marker_dir().join("generation-1.wsr1").exists());
    assert_eq!(fixture.read(), Ok(ProtectedRead::NotCatalogued));
    assert_eq!(
        fixture.reconcile(),
        (Resolution::RolledBack { restored: None }, None)
    );
    assert_eq!(fixture.write_with(&mut StdFs, b"kept").unwrap().0, 1);
    assert_eq!(fixture.payload().as_deref(), Some(&b"kept"[..]));
}

/// A marker-only write (no root commit) of `plaintext` to the fixture's record.
fn unrooted_write(fixture: &Fixture, plaintext: &[u8]) {
    let (record_dir, marker_dir) = (fixture.record_dir(), fixture.marker_dir());
    let request = WriteRequest {
        key_epoch: 1,
        record_schema: 1,
    };
    let store = store(&record_dir, &marker_dir, &fixture.key, &fixture.record);
    commit_write(&mut StdFs, store, request, plaintext).unwrap();
}

#[test]
fn a_chain_no_root_ever_named_is_never_published() {
    let mut fixture = Fixture::new();
    unrooted_write(&fixture, b"orphan");
    assert_eq!(fixture.try_reconcile(), Err(ProtectedError::UnrootedChain));
    assert_eq!(fixture.read(), Ok(ProtectedRead::NotCatalogued));
    assert!(fixture.listed_marker_states().is_empty());
}

#[test]
fn a_deleted_earlier_marker_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    fs::remove_file(fixture.marker_dir().join("generation-1.wsr1")).unwrap();
    assert_eq!(
        fixture.read(),
        Err(ProtectedError::Authority(AuthorityError::RecoveryRequired(
            CatalogRecoveryReason::MarkerSetMismatch
        )))
    );
}

#[test]
fn an_ahead_generation_that_does_not_verify_is_not_published() {
    let mut fixture = Fixture::new();
    fixture.write_with(&mut StdFs, b"first").unwrap();
    unrooted_write(&fixture, b"ahead");
    let path = fixture.record_dir().join("generation-2.wsr1");
    let mut bytes = fs::read(&path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    fs::write(&path, bytes).unwrap();
    assert!(matches!(
        fixture.try_reconcile(),
        Err(ProtectedError::Commit(_))
    ));
    assert_eq!(fixture.listed_marker_states(), vec![(2, ACTIVE)]);
    assert_eq!(fixture.payload().as_deref(), Some(&b"first"[..]));
}

#[test]
fn an_asset_pair_member_is_refused_before_anything_is_written() {
    let mut fixture = Fixture::new();
    fixture.record = RecordIdentity::new(RecordClass::Asset, &["p1", "a1"]).unwrap();
    assert_eq!(
        fixture.write_with(&mut StdFs, b"bytes"),
        Err(ProtectedError::NotAnOrdinaryRecord)
    );
    assert_eq!(fixture.read(), Err(ProtectedError::NotAnOrdinaryRecord));
    assert_eq!(
        fixture.try_reconcile(),
        Err(ProtectedError::NotAnOrdinaryRecord)
    );
    assert_eq!(fs::read_dir(fixture.marker_dir()).unwrap().count(), 0);
    assert_eq!(fs::read_dir(fixture.record_dir()).unwrap().count(), 0);
    assert!(!fixture.root_dir().join("catalog").exists());
}
