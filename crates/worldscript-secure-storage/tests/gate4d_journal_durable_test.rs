//! Gate 4D slice B: durable journal promotion and in-process fence boundary.

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use worldscript_secure_storage::{
    empty_inventory_digest, empty_journal_page_set_digest, generation_path,
    load_manifest_generation, operation_type, phase_code, promote_manifest_fenced,
    promote_page_fenced, with_fence, DirectoryDurability, DurableFs, JournalDurableContext,
    JournalDurableError, JournalManifest, JournalPage, MigrationExecutionError, MigrationFence,
    RecordClass, RecordIdentity, StageFailureKind, StdFs, WriteOperationId,
};

fn key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

fn target_key_digest() -> [u8; 32] {
    [0x42; 32]
}

fn bootstrap_manifest(operation_id: &str) -> JournalManifest {
    JournalManifest {
        operation_id: operation_id.into(),
        journal_revision: 0,
        operation_type: operation_type::ENABLE,
        phase: phase_code::BOOTSTRAP_TARGET,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some(target_key_digest()),
        fencing_generation: 1,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 0,
        entry_count: 0,
        journal_page_set_digest: empty_journal_page_set_digest(),
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
}

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "wss-gate4d-journal-durable-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_op() -> WriteOperationId {
    WriteOperationId::generate().unwrap()
}

fn durable_ctx<'a>(
    fs: &'a mut StdFs,
    key: &'a worldscript_secure_storage::Key,
    dir: &'a Path,
    operation: &'a WriteOperationId,
) -> JournalDurableContext<'a, StdFs> {
    JournalDurableContext::new(fs, key, dir, operation)
}

struct CountingFs {
    inner: StdFs,
    creates: AtomicUsize,
}

impl CountingFs {
    fn new() -> Self {
        Self {
            inner: StdFs,
            creates: AtomicUsize::new(0),
        }
    }

    fn create_count(&self) -> usize {
        self.creates.load(Ordering::SeqCst)
    }
}

impl DurableFs for CountingFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.creates.fetch_add(1, Ordering::SeqCst);
        self.inner.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.inner.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
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

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.inner.create_dir_all(dir)
    }
}

fn durable_ctx_counting<'a>(
    fs: &'a mut CountingFs,
    key: &'a worldscript_secure_storage::Key,
    dir: &'a Path,
    operation: &'a WriteOperationId,
) -> JournalDurableContext<'a, CountingFs> {
    JournalDurableContext::new(fs, key, dir, operation)
}

#[test]
fn bootstrap_manifest_revision_zero_durable_roundtrip() {
    let dir = TempDir::new();
    let manifest = bootstrap_manifest("rev0-durable");
    let fence = MigrationFence::from_manifest(&manifest);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, &dir.0, &op);
    promote_manifest_fenced(&mut ctx, &manifest, &fence).unwrap();
    assert!(generation_path(&dir.0, 0).is_file());
    let loaded = load_manifest_generation(&mut ctx, "rev0-durable", 0).unwrap();
    assert_eq!(loaded, manifest);
}

#[test]
fn non_bootstrap_manifest_revision_promotes_and_refuses_overwrite() {
    let dir = TempDir::new();
    let mut manifest = bootstrap_manifest("rev1-durable");
    manifest.journal_revision = 1;
    manifest.phase = phase_code::DISCOVER;
    let fence = MigrationFence::from_manifest(&manifest);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, &dir.0, &op);
    promote_manifest_fenced(&mut ctx, &manifest, &fence).unwrap();
    let loaded = load_manifest_generation(&mut ctx, "rev1-durable", 1).unwrap();
    assert_eq!(loaded.journal_revision, 1);
    let err = promote_manifest_fenced(&mut ctx, &manifest, &fence).unwrap_err();
    assert!(matches!(
        err,
        JournalDurableError::Stage(stage)
            if matches!(stage.kind, StageFailureKind::GenerationExists)
    ));
}

#[test]
fn journal_page_durable_roundtrip() {
    let dir = TempDir::new();
    let manifest = bootstrap_manifest("page-durable-op");
    let fence = MigrationFence::from_manifest(&manifest);
    let page = JournalPage::new(0, 1, vec![]).unwrap();
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, &dir.0, &op);
    promote_page_fenced(&mut ctx, &manifest, &fence, &page).unwrap();
    let identity =
        RecordIdentity::new(RecordClass::MigrationPage, &["page-durable-op", "0"]).unwrap();
    let bytes = std::fs::read(generation_path(&dir.0, 1)).unwrap();
    let opened = JournalPage::open(&key, &identity, 1, &bytes).unwrap();
    assert_eq!(opened.page_index(), 0);
}

#[test]
fn stale_fence_rejects_before_durable_io() {
    let dir = TempDir::new();
    let manifest = bootstrap_manifest("stale-fence");
    let stale = MigrationFence {
        fencing_generation: manifest.fencing_generation,
        journal_revision: manifest.journal_revision + 1,
    };
    let mut fs = CountingFs::new();
    let op = write_op();
    let key = key();
    let mut ctx = durable_ctx_counting(&mut fs, &key, &dir.0, &op);
    let err = promote_manifest_fenced(&mut ctx, &manifest, &stale).unwrap_err();
    assert_eq!(fs.create_count(), 0);
    assert!(matches!(
        err,
        JournalDurableError::Fence(MigrationExecutionError::StaleMigrationOwner)
    ));
}

#[test]
fn with_fence_excludes_second_holder_until_first_releases() {
    let manifest = bootstrap_manifest("mutex-op");
    let fence = MigrationFence::from_manifest(&manifest);
    let (held_tx, held_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let manifest1 = manifest.clone();
    let t1 = thread::spawn(move || {
        with_fence(&manifest1, &fence, || {
            held_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            Ok::<(), JournalDurableError>(())
        })
    });
    held_rx.recv().unwrap();
    let entered = Arc::new(AtomicBool::new(false));
    let entered2 = entered.clone();
    let manifest2 = manifest.clone();
    let t2 = thread::spawn(move || {
        with_fence(&manifest2, &fence, || {
            entered2.store(true, Ordering::SeqCst);
            Ok(())
        })
    });
    assert!(
        !entered.load(Ordering::SeqCst),
        "second holder must not enter while the first still holds the journal mutex"
    );
    release_tx.send(()).unwrap();
    t1.join().unwrap().unwrap();
    t2.join().unwrap().unwrap();
    assert!(entered.load(Ordering::SeqCst));
}
