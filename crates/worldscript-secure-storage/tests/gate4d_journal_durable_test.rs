//! Gate 4D slice B: durable journal promotion and in-process fence boundary.

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use worldscript_secure_storage::{
    content_digest, empty_inventory_digest, empty_journal_page_set_digest, generation_path,
    load_authoritative_manifest, load_manifest_generation, operation_type, phase_code,
    promote_manifest_fenced, promote_page_fenced, DirectoryDurability, DurableFs,
    JournalDurableContext, JournalDurableError, JournalError, JournalManifest, JournalPage,
    LiveMigration, MigrationExecutionError, MigrationFence, OpenError, RecordClass, RecordIdentity,
    StageFailureKind, StdFs, WriteOperationId,
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

fn manifest_at(operation_id: &str, revision: u64, fencing_generation: u64) -> JournalManifest {
    let mut manifest = bootstrap_manifest(operation_id);
    manifest.journal_revision = revision;
    manifest.phase = phase_code::PREPARE;
    manifest.fencing_generation = fencing_generation;
    manifest
}

fn promote(dir: &Path, manifest: &JournalManifest) {
    let fence = MigrationFence::from_manifest(manifest);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, dir, &op);
    promote_manifest_fenced(&mut ctx, manifest, &fence).unwrap();
}

fn file_bytes(dir: &Path, revision: u64) -> Vec<u8> {
    std::fs::read(generation_path(dir, revision)).unwrap()
}

fn binding(manifest: &JournalManifest, digest: [u8; 32]) -> LiveMigration {
    LiveMigration {
        operation_id: manifest.operation_id.clone(),
        fencing_generation: manifest.fencing_generation,
        journal_revision: manifest.journal_revision,
        manifest_digest: digest,
    }
}

struct NoListFs(StdFs);

impl DurableFs for NoListFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.0.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.0.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.0.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.0.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        self.0.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        self.0.sync_dir(dir)
    }

    fn list_dir(&mut self, _dir: &Path) -> io::Result<Vec<OsString>> {
        panic!("resume must not enumerate the record directory");
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.0.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.0.create_dir_all(dir)
    }
}

struct DenyRead;

impl DurableFs for DenyRead {
    type File = File;

    fn create_new(&mut self, _path: &Path) -> io::Result<File> {
        Err(io::Error::other("unused"))
    }

    fn sync_file(&mut self, _file: &mut File) -> io::Result<()> {
        Err(io::Error::other("unused"))
    }

    fn read(&mut self, _path: &Path) -> io::Result<Vec<u8>> {
        Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"))
    }

    fn link_no_replace(&mut self, _from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::Error::other("unused"))
    }

    fn remove_file(&mut self, _path: &Path) -> io::Result<()> {
        Err(io::Error::other("unused"))
    }

    fn sync_dir(&mut self, _dir: &Path) -> io::Result<DirectoryDurability> {
        Err(io::Error::other("unused"))
    }

    fn list_dir(&mut self, _dir: &Path) -> io::Result<Vec<OsString>> {
        panic!("resume must not enumerate the record directory");
    }

    fn rename_replace(&mut self, _from: &Path, _to: &Path) -> io::Result<()> {
        Err(io::Error::other("unused"))
    }

    fn create_dir_all(&mut self, _dir: &Path) -> io::Result<()> {
        Err(io::Error::other("unused"))
    }
}

fn resume(dir: &Path, live: &LiveMigration) -> Result<JournalManifest, JournalDurableError> {
    let op = write_op();
    let key = key();
    let mut fs = NoListFs(StdFs);
    let mut ctx = JournalDurableContext::new(&mut fs, &key, dir, &op);
    load_authoritative_manifest(&mut ctx, live)
}

#[test]
fn resume_returns_only_the_root_named_generation() {
    let dir = TempDir::new();
    let older = manifest_at("resume-op", 1, 4);
    let current = manifest_at("resume-op", 2, 4);
    let newer = manifest_at("resume-op", 3, 4);
    promote(&dir.0, &older);
    promote(&dir.0, &current);
    promote(&dir.0, &newer);
    let older_bytes = file_bytes(&dir.0, 1);
    let newer_bytes = file_bytes(&dir.0, 3);
    let live = binding(&current, content_digest(&file_bytes(&dir.0, 2)));
    let loaded = resume(&dir.0, &live).unwrap();
    assert_eq!(loaded, current);
    assert_eq!(file_bytes(&dir.0, 1), older_bytes);
    assert_eq!(file_bytes(&dir.0, 3), newer_bytes);
}

#[test]
fn resume_returns_the_root_named_generation_when_it_is_the_only_file() {
    let dir = TempDir::new();
    let current = manifest_at("resume-only", 2, 4);
    promote(&dir.0, &current);
    let live = binding(&current, content_digest(&file_bytes(&dir.0, 2)));
    assert_eq!(resume(&dir.0, &live).unwrap(), current);
}

#[test]
fn resume_returns_the_newer_generation_only_when_the_root_names_it() {
    let dir = TempDir::new();
    let current = manifest_at("resume-advanced", 2, 4);
    let named = manifest_at("resume-advanced", 3, 4);
    promote(&dir.0, &current);
    promote(&dir.0, &named);
    let live = binding(&named, content_digest(&file_bytes(&dir.0, 3)));
    assert_eq!(resume(&dir.0, &live).unwrap(), named);
}

#[test]
fn missing_root_named_generation_is_recovery_required() {
    let dir = TempDir::new();
    let older = manifest_at("resume-missing", 1, 4);
    promote(&dir.0, &older);
    let older_bytes = file_bytes(&dir.0, 1);
    let mut live = binding(&older, content_digest(&older_bytes));
    live.journal_revision = 2;
    let err = resume(&dir.0, &live).unwrap_err();
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::RecoveryRequired)
    );
    assert_eq!(file_bytes(&dir.0, 1), older_bytes);
    assert!(!generation_path(&dir.0, 2).exists());
}

#[test]
fn resume_refuses_operation_fence_and_digest_mismatches() {
    let dir = TempDir::new();
    let current = manifest_at("resume-match", 2, 4);
    promote(&dir.0, &current);
    let digest = content_digest(&file_bytes(&dir.0, 2));
    let mut wrong_operation = binding(&current, digest);
    wrong_operation.operation_id = "resume-other".into();
    assert!(matches!(
        resume(&dir.0, &wrong_operation).unwrap_err(),
        JournalDurableError::Journal(JournalError::Open(OpenError::Tampered))
    ));
    let mut wrong_fence = binding(&current, digest);
    wrong_fence.fencing_generation = 9;
    assert_eq!(
        resume(&dir.0, &wrong_fence).unwrap_err(),
        JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner)
    );
    let mut wrong_digest = binding(&current, digest);
    wrong_digest.manifest_digest[0] ^= 0xff;
    assert_eq!(
        resume(&dir.0, &wrong_digest).unwrap_err(),
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
}

#[test]
fn semantic_open_failure_does_not_become_recovery_required_or_adopt_a_sibling() {
    let dir = TempDir::new();
    let current = manifest_at("resume-open", 2, 4);
    let newer = manifest_at("resume-open", 3, 4);
    promote(&dir.0, &current);
    promote(&dir.0, &newer);
    let newer_bytes = file_bytes(&dir.0, 3);
    std::fs::write(generation_path(&dir.0, 2), b"not-a-wsr1-envelope").unwrap();
    let live = binding(&current, content_digest(b"not-a-wsr1-envelope"));
    let err = resume(&dir.0, &live).unwrap_err();
    assert!(matches!(
        err,
        JournalDurableError::Journal(JournalError::Open(_))
    ));
    assert!(!matches!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::RecoveryRequired)
    ));
    assert_eq!(file_bytes(&dir.0, 3), newer_bytes);
}

#[test]
fn permission_denied_stays_a_stage_io_error() {
    let dir = TempDir::new();
    let current = manifest_at("resume-denied", 2, 4);
    let live = binding(&current, [0x11; 32]);
    let op = write_op();
    let key = key();
    let mut fs = DenyRead;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    let err = load_authoritative_manifest(&mut ctx, &live).unwrap_err();
    assert!(matches!(
        err,
        JournalDurableError::Stage(stage)
            if matches!(stage.kind, StageFailureKind::Io(io::ErrorKind::PermissionDenied))
                && !stage.promoted
    ));
}
