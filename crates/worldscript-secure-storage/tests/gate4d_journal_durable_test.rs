//! Gate 4D slice B: durable journal promotion and in-process fence boundary.

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use worldscript_secure_storage::{
    assert_manifest_promote_authority, assert_page_promote_authority, content_digest,
    empty_inventory_digest, empty_journal_page_set_digest, generation_path,
    load_authoritative_manifest, load_manifest_generation, operation_type, phase_code,
    promote_manifest_fenced, promote_page_fenced, publish_manifest_fenced, DirectoryDurability,
    DurableFs, JournalDurableContext, JournalDurableError, JournalError, JournalManifest,
    JournalPage, LiveMigration, MigrationExecutionError, MigrationFence, OpenError, RecordClass,
    RecordIdentity, RecordMeta, StageFailureKind, StagingResidue, StdFs, WriteOperationId,
    JOURNAL_MANIFEST_RECORD_SCHEMA, MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES,
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
    promote_manifest_fenced(&mut ctx, &manifest, &fence, None).unwrap();
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
    let committed = predecessor_binding(&manifest);
    promote_manifest_fenced(&mut ctx, &manifest, &fence, committed.as_ref()).unwrap();
    let loaded = load_manifest_generation(&mut ctx, "rev1-durable", 1).unwrap();
    assert_eq!(loaded.journal_revision, 1);
    let err = promote_manifest_fenced(&mut ctx, &manifest, &fence, committed.as_ref()).unwrap_err();
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
    promote_page_fenced(&mut ctx, &manifest, &fence, None, &page).unwrap();
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
    let err = promote_manifest_fenced(&mut ctx, &manifest, &stale, None).unwrap_err();
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

/// The committed binding the same owner would hold at `manifest`: its previous revision, or none
/// for the bootstrap revision.
fn predecessor_binding(manifest: &JournalManifest) -> Option<LiveMigration> {
    manifest
        .journal_revision
        .checked_sub(1)
        .map(|previous| LiveMigration {
            operation_id: manifest.operation_id.clone(),
            fencing_generation: manifest.fencing_generation,
            journal_revision: previous,
            manifest_digest: [0x11; 32],
        })
}

fn promote(dir: &Path, manifest: &JournalManifest) {
    let fence = MigrationFence::from_manifest(manifest);
    let committed = predecessor_binding(manifest);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, dir, &op);
    promote_manifest_fenced(&mut ctx, manifest, &fence, committed.as_ref()).unwrap();
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

const R4_PAGE_GENERATION: u64 = 7;

fn committed_at(operation_id: &str, revision: u64, fencing_generation: u64) -> LiveMigration {
    binding(
        &manifest_at(operation_id, revision, fencing_generation),
        [0x22; 32],
    )
}

fn refused_manifest(
    dir: &Path,
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> (JournalDurableError, usize) {
    let fence = MigrationFence::from_manifest(manifest);
    let mut fs = CountingFs::new();
    let op = write_op();
    let key = key();
    let mut ctx = durable_ctx_counting(&mut fs, &key, dir, &op);
    let err = promote_manifest_fenced(&mut ctx, manifest, &fence, committed).unwrap_err();
    (err, fs.create_count())
}

fn refused_page(
    dir: &Path,
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> (JournalDurableError, usize) {
    let fence = MigrationFence::from_manifest(manifest);
    let page = JournalPage::new(0, R4_PAGE_GENERATION, vec![]).unwrap();
    let mut fs = CountingFs::new();
    let op = write_op();
    let key = key();
    let mut ctx = durable_ctx_counting(&mut fs, &key, dir, &op);
    let err = promote_page_fenced(&mut ctx, manifest, &fence, committed, &page).unwrap_err();
    (err, fs.create_count())
}

#[test]
fn committed_owner_promotes_its_next_manifest_and_current_page_without_listing() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("r4-owner", 1, 4));
    promote(&dir.0, &manifest_at("r4-owner", 2, 4));
    let live = committed_at("r4-owner", 2, 4);
    let op = write_op();
    let key = key();
    let mut fs = NoListFs(StdFs);
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    let next = manifest_at("r4-owner", 3, 4);
    let next_fence = MigrationFence::from_manifest(&next);
    promote_manifest_fenced(&mut ctx, &next, &next_fence, Some(&live)).unwrap();
    assert!(generation_path(&dir.0, 3).is_file());
    let current = manifest_at("r4-owner", 2, 4);
    let current_fence = MigrationFence::from_manifest(&current);
    let page = JournalPage::new(0, R4_PAGE_GENERATION, vec![]).unwrap();
    promote_page_fenced(&mut ctx, &current, &current_fence, Some(&live), &page).unwrap();
    assert!(generation_path(&dir.0, R4_PAGE_GENERATION).is_file());
}

#[test]
fn stale_owner_with_a_matching_stale_fence_is_refused_before_io() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("r4-stale", 1, 4));
    promote(&dir.0, &manifest_at("r4-stale", 2, 4));
    let root_named = file_bytes(&dir.0, 2);
    let live = committed_at("r4-stale", 2, 4);
    // The stale owner's own manifest and fence agree with each other; only the root disagrees.
    let stale_manifest = manifest_at("r4-stale", 3, 3);
    let (err, creates) = refused_manifest(&dir.0, &stale_manifest, Some(&live));
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner)
    );
    assert_eq!(creates, 0);
    assert!(!generation_path(&dir.0, 3).exists());
    let stale_page_owner = manifest_at("r4-stale", 2, 3);
    let (err, creates) = refused_page(&dir.0, &stale_page_owner, Some(&live));
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner)
    );
    assert_eq!(creates, 0);
    assert!(!generation_path(&dir.0, R4_PAGE_GENERATION).exists());
    assert_eq!(file_bytes(&dir.0, 2), root_named);
}

#[test]
fn stale_or_non_successor_revisions_are_refused_before_io() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("r4-rev", 1, 4));
    promote(&dir.0, &manifest_at("r4-rev", 2, 4));
    promote(&dir.0, &manifest_at("r4-rev", 3, 4));
    let ahead_bytes = file_bytes(&dir.0, 3);
    let live = committed_at("r4-rev", 2, 4);
    for (revision, expected) in [
        (1, MigrationExecutionError::StaleJournalRevision),
        (2, MigrationExecutionError::StaleJournalRevision),
        (4, MigrationExecutionError::LiveBindingMismatch),
    ] {
        let manifest = manifest_at("r4-rev", revision, 4);
        let (err, creates) = refused_manifest(&dir.0, &manifest, Some(&live));
        assert_eq!(
            err,
            JournalDurableError::Authority(expected),
            "revision {revision}"
        );
        assert_eq!(creates, 0, "revision {revision}");
    }
    // A durable r+1 does not make r+2 admissible: the root still names r.
    assert!(!generation_path(&dir.0, 4).exists());
    assert_eq!(file_bytes(&dir.0, 3), ahead_bytes);
}

#[test]
fn page_promote_requires_the_manifest_generation_the_root_names() {
    let dir = TempDir::new();
    let live = committed_at("r4-page", 2, 4);
    for (revision, expected) in [
        (1, MigrationExecutionError::StaleJournalRevision),
        (3, MigrationExecutionError::LiveBindingMismatch),
    ] {
        let manifest = manifest_at("r4-page", revision, 4);
        let (err, creates) = refused_page(&dir.0, &manifest, Some(&live));
        assert_eq!(
            err,
            JournalDurableError::Authority(expected),
            "revision {revision}"
        );
        assert_eq!(creates, 0, "revision {revision}");
    }
    assert!(!generation_path(&dir.0, R4_PAGE_GENERATION).exists());
}

#[test]
fn another_operation_and_a_missing_binding_are_refused_before_io() {
    let dir = TempDir::new();
    let live = committed_at("r4-op", 2, 4);
    let other = manifest_at("r4-other", 3, 4);
    let (err, creates) = refused_manifest(&dir.0, &other, Some(&live));
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!(creates, 0);
    // No committed binding names nothing, so only the bootstrap revision may be written.
    let unbound = manifest_at("r4-op", 1, 4);
    let (err, creates) = refused_manifest(&dir.0, &unbound, None);
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!(creates, 0);
    let (err, creates) = refused_page(&dir.0, &unbound, None);
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!(creates, 0);
    assert!(!generation_path(&dir.0, 1).exists());
    assert!(!generation_path(&dir.0, 3).exists());
}

#[test]
fn promote_authority_decision_table_including_the_revision_ceiling() {
    let bootstrap = manifest_at("r4-table", 0, 4);
    assert_eq!(assert_manifest_promote_authority(&bootstrap, None), Ok(()));
    assert_eq!(assert_page_promote_authority(&bootstrap, None), Ok(()));
    // A root that already names the bootstrap revision no longer admits a second bootstrap write.
    let named_zero = committed_at("r4-table", 0, 4);
    assert_eq!(
        assert_manifest_promote_authority(&bootstrap, Some(&named_zero)),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
    assert_eq!(
        assert_page_promote_authority(&bootstrap, Some(&named_zero)),
        Ok(())
    );
    // A root naming the highest revision has no successor; the current page is still admissible.
    let ceiling = committed_at("r4-table", u64::MAX, 4);
    let at_ceiling = manifest_at("r4-table", u64::MAX, 4);
    assert_eq!(
        assert_manifest_promote_authority(&at_ceiling, Some(&ceiling)),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!(
        assert_page_promote_authority(&at_ceiling, Some(&ceiling)),
        Ok(())
    );
}

#[test]
fn a_mismatched_fence_is_reported_before_the_committed_authority_check() {
    let dir = TempDir::new();
    let live = committed_at("r4-order", 2, 4);
    let manifest = manifest_at("r4-order", 3, 3);
    let tampered = MigrationFence {
        fencing_generation: 9,
        journal_revision: manifest.journal_revision,
    };
    let mut fs = CountingFs::new();
    let op = write_op();
    let key = key();
    let mut ctx = durable_ctx_counting(&mut fs, &key, &dir.0, &op);
    let err = promote_manifest_fenced(&mut ctx, &manifest, &tampered, Some(&live)).unwrap_err();
    assert_eq!(
        err,
        JournalDurableError::Fence(MigrationExecutionError::StaleMigrationOwner)
    );
    assert_eq!(fs.create_count(), 0);
}

#[test]
fn a_candidate_promoted_ahead_of_the_root_is_not_adopted_on_resume() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("r4-crash", 1, 4));
    promote(&dir.0, &manifest_at("r4-crash", 2, 4));
    let current = manifest_at("r4-crash", 2, 4);
    let live = binding(&current, content_digest(&file_bytes(&dir.0, 2)));
    // The committed owner publishes the next candidate; the root is not advanced (crash window).
    let next = manifest_at("r4-crash", 3, 4);
    let next_fence = MigrationFence::from_manifest(&next);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, &dir.0, &op);
    promote_manifest_fenced(&mut ctx, &next, &next_fence, Some(&live)).unwrap();
    let candidate_bytes = file_bytes(&dir.0, 3);
    // Restart: the root still names r, so r is resumed and r+1 stays an unadopted candidate.
    assert_eq!(resume(&dir.0, &live).unwrap(), current);
    assert_eq!(file_bytes(&dir.0, 3), candidate_bytes);
}

#[test]
fn an_old_owner_cannot_publish_after_the_authority_moved_to_a_new_owner() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("r4-moved", 1, 4));
    promote(&dir.0, &manifest_at("r4-moved", 2, 4));
    // The committed binding now names owner 5; owner 4 still holds a matching manifest and fence.
    let moved = committed_at("r4-moved", 3, 5);
    for revision in [3, 4] {
        let old_owner = manifest_at("r4-moved", revision, 4);
        let (err, creates) = refused_manifest(&dir.0, &old_owner, Some(&moved));
        assert_eq!(
            err,
            JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner),
            "revision {revision}"
        );
        assert_eq!(creates, 0, "revision {revision}");
    }
    let (err, creates) = refused_page(&dir.0, &manifest_at("r4-moved", 3, 4), Some(&moved));
    assert_eq!(
        err,
        JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner)
    );
    assert_eq!(creates, 0);
    assert!(!generation_path(&dir.0, 3).exists());
    assert!(!generation_path(&dir.0, 4).exists());
    assert!(!generation_path(&dir.0, R4_PAGE_GENERATION).exists());
}

/// The committed binding for a generation that really exists in `dir`, digest included.
fn real_binding(dir: &Path, operation_id: &str, revision: u64, fence: u64) -> LiveMigration {
    binding(
        &manifest_at(operation_id, revision, fence),
        content_digest(&file_bytes(dir, revision)),
    )
}

fn dir_listing(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            (
                path.file_name().unwrap().to_string_lossy().into_owned(),
                std::fs::read(&path).unwrap(),
            )
        })
        .collect();
    files.sort();
    files
}

fn published(
    dir: &Path,
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> (
    Result<worldscript_secure_storage::PublishedManifest, JournalDurableError>,
    usize,
) {
    let fence = MigrationFence::from_manifest(manifest);
    let mut fs = CountingFs::new();
    let op = write_op();
    let key = key();
    let mut ctx = durable_ctx_counting(&mut fs, &key, dir, &op);
    let result = publish_manifest_fenced(&mut ctx, manifest, &fence, committed);
    (result, fs.create_count())
}

#[test]
fn publish_writes_an_absent_generation_and_adopts_an_identical_one_without_writing() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("pub-adopt", 1, 4));
    let live = real_binding(&dir.0, "pub-adopt", 1, 4);
    let next = manifest_at("pub-adopt", 2, 4);
    let (first, creates) = published(&dir.0, &next, Some(&live));
    let first = first.unwrap();
    assert!(!first.adopted);
    assert_eq!(creates, 1);
    assert_eq!(first.content_digest, content_digest(&file_bytes(&dir.0, 2)));
    let listing = dir_listing(&dir.0);
    // The same candidate again: adopted, same digest, no staging file and no journal byte written.
    let (second, creates) = published(&dir.0, &next, Some(&live));
    let second = second.unwrap();
    assert!(second.adopted);
    assert_eq!(second.content_digest, first.content_digest);
    assert_eq!(creates, 0);
    assert_eq!(dir_listing(&dir.0), listing);
}

#[test]
fn publish_refuses_a_different_or_unopenable_candidate_and_changes_nothing() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("pub-differs", 1, 4));
    let live = real_binding(&dir.0, "pub-differs", 1, 4);
    let next = manifest_at("pub-differs", 2, 4);
    published(&dir.0, &next, Some(&live)).0.unwrap();
    let listing = dir_listing(&dir.0);
    let mut leased = next.clone();
    leased.has_lease_owner = true;
    leased.lease_owner_id = Some("owner-b".into());
    leased.lease_expires_unix_ms = Some(1_000);
    let (result, creates) = published(&dir.0, &leased, Some(&live));
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a different candidate must be refused");
    };
    assert!(matches!(stage.kind, StageFailureKind::GenerationExists));
    assert!(!stage.promoted);
    assert_eq!(stage.staging, StagingResidue::None);
    assert_eq!(creates, 0);
    assert_eq!(dir_listing(&dir.0), listing);
    // Another revision's bytes under this revision's name do not open as this generation, and an
    // authentic envelope of the same manifest under another key epoch is not what a promote writes.
    let wrong = file_bytes(&dir.0, 1);
    let identity = RecordIdentity::new(RecordClass::Migration, &["pub-differs"]).unwrap();
    let other_epoch = RecordMeta {
        key_epoch: 2,
        record_generation: 2,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let epoch_two = next.seal(&key(), &identity, other_epoch).unwrap();
    for (case, bytes) in [
        ("garbage", vec![0xAA; 64]),
        ("wrong generation", wrong),
        ("another key epoch", epoch_two),
    ] {
        let path = generation_path(&dir.0, 2);
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        let (result, creates) = published(&dir.0, &next, Some(&live));
        assert!(
            matches!(
                result,
                Err(JournalDurableError::Stage(ref stage))
                    if matches!(stage.kind, StageFailureKind::GenerationExists)
            ),
            "{case}"
        );
        assert_eq!(creates, 0, "{case}");
        assert_eq!(file_bytes(&dir.0, 2), bytes, "{case}");
    }
}

/// Real file system whose reads can be forbidden: a full `read` always panics, and the bounded
/// read panics too unless `bounded_reads` allows it.
struct ReadGuardFs {
    inner: StdFs,
    bounded_reads: bool,
}

impl DurableFs for ReadGuardFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.inner.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.inner.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        panic!("unbounded read of {}", path.display());
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        assert!(self.bounded_reads, "read of {}", path.display());
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

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.inner.create_dir_all(dir)
    }
}

fn publish_guarded(
    dir: &Path,
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
    bounded_reads: bool,
) -> Result<worldscript_secure_storage::PublishedManifest, JournalDurableError> {
    let fence = MigrationFence::from_manifest(manifest);
    let mut fs = ReadGuardFs {
        inner: StdFs,
        bounded_reads,
    };
    let op = write_op();
    let key = key();
    let mut ctx = JournalDurableContext::new(&mut fs, &key, dir, &op);
    publish_manifest_fenced(&mut ctx, manifest, &fence, committed)
}

#[test]
fn publish_refuses_a_stale_owner_before_any_read_of_the_generation() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("pub-stale", 1, 4));
    let live = real_binding(&dir.0, "pub-stale", 1, 4);
    let next = manifest_at("pub-stale", 2, 4);
    published(&dir.0, &next, Some(&live)).0.unwrap();
    let listing = dir_listing(&dir.0);
    // The stale owner's manifest and fence agree and its candidate generation exists, but the
    // committed owner is a newer fence. The double panics on any read, so reaching the file fails.
    let moved = committed_at("pub-stale", 1, 5);
    assert_eq!(
        publish_guarded(&dir.0, &next, Some(&moved), false),
        Err(JournalDurableError::Authority(
            MigrationExecutionError::StaleMigrationOwner
        ))
    );
    // With no committed binding only revision 0 is publishable.
    assert_eq!(
        publish_guarded(&dir.0, &next, None, false),
        Err(JournalDurableError::Authority(
            MigrationExecutionError::LiveBindingMismatch
        ))
    );
    assert_eq!(dir_listing(&dir.0), listing);
}

#[test]
fn publish_refuses_an_oversized_candidate_without_loading_it() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("pub-big", 1, 4));
    let live = real_binding(&dir.0, "pub-big", 1, 4);
    let next = manifest_at("pub-big", 2, 4);
    let path = generation_path(&dir.0, 2);
    // One byte over the bound: only the bounded read may touch it, and it is refused untouched.
    let oversized = vec![0xAA; MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES + 1];
    std::fs::write(&path, &oversized).unwrap();
    let Err(JournalDurableError::Stage(stage)) = publish_guarded(&dir.0, &next, Some(&live), true)
    else {
        panic!("an oversized candidate must be refused");
    };
    assert!(matches!(stage.kind, StageFailureKind::GenerationExists));
    assert!(!stage.promoted);
    assert_eq!(stage.staging, StagingResidue::None);
    assert_eq!(std::fs::read(&path).unwrap(), oversized);
}

#[test]
fn std_read_at_most_never_loads_more_than_the_limit() {
    let dir = TempDir::new();
    let path = dir.0.join("bounded");
    std::fs::write(&path, [7u8; 10]).unwrap();
    let mut fs = StdFs;
    assert_eq!(fs.read_at_most(&path, 10).unwrap(), Some(vec![7u8; 10]));
    assert_eq!(fs.read_at_most(&path, 11).unwrap(), Some(vec![7u8; 10]));
    assert_eq!(fs.read_at_most(&path, 9).unwrap(), None);
    assert_eq!(fs.read_at_most(&path, 0).unwrap(), None);
    let empty = dir.0.join("empty");
    std::fs::write(&empty, []).unwrap();
    assert_eq!(fs.read_at_most(&empty, 0).unwrap(), Some(Vec::new()));
    let missing = fs.read_at_most(&dir.0.join("missing"), 10).unwrap_err();
    assert_eq!(missing.kind(), io::ErrorKind::NotFound);
}

#[test]
fn the_longest_valid_manifest_fits_the_envelope_bound() {
    let operation = "o".repeat(128);
    let mut manifest = manifest_at(&operation, 7, 4);
    manifest.has_lease_owner = true;
    manifest.lease_owner_id = Some("w".repeat(128));
    manifest.lease_expires_unix_ms = Some(u64::MAX);
    let identity = RecordIdentity::new(RecordClass::Migration, &[&operation]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 7,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let envelope = manifest.seal(&key(), &identity, meta).unwrap();
    assert!(envelope.len() <= MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES);
    // The bound is a limit on size, not a tight fit that a legitimate manifest could approach.
    assert!(envelope.len() * 4 <= MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES * 2);
}

#[test]
fn publish_reports_a_read_failure_other_than_absence_as_a_stage_io_failure() {
    let dir = TempDir::new();
    let live = committed_at("pub-denied", 1, 4);
    let next = manifest_at("pub-denied", 2, 4);
    let fence = MigrationFence::from_manifest(&next);
    let op = write_op();
    let key = key();
    let mut fs = DenyRead;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    let Err(JournalDurableError::Stage(stage)) =
        publish_manifest_fenced(&mut ctx, &next, &fence, Some(&live))
    else {
        panic!("an unreadable generation is neither absent nor adoptable");
    };
    assert!(matches!(
        stage.kind,
        StageFailureKind::Io(io::ErrorKind::PermissionDenied)
    ));
    assert!(!stage.promoted);
}

#[test]
fn publish_refuses_a_non_successor_even_when_it_already_exists_as_a_candidate() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("pub-succ", 1, 4));
    let live = real_binding(&dir.0, "pub-succ", 1, 4);
    let mut jump = manifest_at("pub-succ", 2, 4);
    jump.phase = phase_code::CONVERT;
    // The jump is already durable; it authenticates and equals the manifest, so only the
    // successor relation stops it from being adopted.
    promote_candidate(&dir.0, &jump, &live);
    let listing = dir_listing(&dir.0);
    let (result, creates) = published(&dir.0, &jump, Some(&live));
    assert_eq!(
        result,
        Err(JournalDurableError::Authority(
            MigrationExecutionError::InvalidPhaseTransition
        ))
    );
    assert_eq!(creates, 0);
    assert_eq!(dir_listing(&dir.0), listing);
}

fn promote_candidate(dir: &Path, manifest: &JournalManifest, committed: &LiveMigration) {
    let fence = MigrationFence::from_manifest(manifest);
    let op = write_op();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = durable_ctx(&mut fs, &key, dir, &op);
    promote_manifest_fenced(&mut ctx, manifest, &fence, Some(committed)).unwrap();
}

#[test]
fn an_oversized_root_named_generation_is_corrupt_and_never_loaded() {
    let dir = TempDir::new();
    promote(&dir.0, &manifest_at("big-load", 1, 4));
    let live = real_binding(&dir.0, "big-load", 1, 4);
    let path = generation_path(&dir.0, 1);
    std::fs::remove_file(&path).unwrap();
    std::fs::write(&path, vec![0xAA; MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES + 1]).unwrap();
    let op = write_op();
    let key = key();
    let mut fs = ReadGuardFs {
        inner: StdFs,
        bounded_reads: true,
    };
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    let corrupt = JournalDurableError::Journal(JournalError::Corrupt(
        "manifest generation exceeds the envelope bound",
    ));
    assert_eq!(
        load_authoritative_manifest(&mut ctx, &live),
        Err(corrupt.clone())
    );
    assert_eq!(
        load_manifest_generation(&mut ctx, "big-load", 1),
        Err(corrupt)
    );
}
