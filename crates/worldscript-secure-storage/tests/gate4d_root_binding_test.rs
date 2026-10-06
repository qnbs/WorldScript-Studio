//! Gate 4D B2b-1: advancing the root's live-migration binding to the journal owner's next revision
//! (§5.4, §10.1.1).

use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    advance_live_migration, commit_catalog_change, commit_root, content_digest,
    empty_inventory_digest, empty_journal_page_set_digest, generation_path, load_catalog,
    operation_type, phase_code, promote_manifest_fenced, write_key_epoch, AuthorityError,
    BindingAdvance, CatalogChange, CatalogCommit, DirectoryDurability, DurableFs,
    InstallationScopeId, JournalDurableContext, JournalDurableError, JournalManifest,
    JournalSource, KeyEpochCommit, KeyEpochRecord, KeyEpochStatus, KeyProvider, LiveMigration,
    LoadedCatalog, MigrationExecutionError, MigrationFence, RootBody, RootCommitEvidence,
    RootCommitGuard, RootCommitRequest, RootCommitState, RootCommitted, RootKeyRefV1, RootLayout,
    StdFs, WriteOperationId,
};

const OPERATION: &str = "binding-op";
const FENCE: u64 = 4;

fn journal_key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

fn manifest_at(operation_id: &str, revision: u64, fencing_generation: u64) -> JournalManifest {
    JournalManifest {
        operation_id: operation_id.into(),
        journal_revision: revision,
        operation_type: operation_type::ENABLE,
        phase: if revision == 0 {
            phase_code::BOOTSTRAP_TARGET
        } else {
            phase_code::PREPARE
        },
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation,
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

fn promote(dir: &Path, manifest: &JournalManifest, committed: Option<&LiveMigration>) {
    let fence = MigrationFence::from_manifest(manifest);
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, dir, &op);
    promote_manifest_fenced(&mut ctx, manifest, &fence, committed).unwrap();
}

fn digest_of(dir: &Path, revision: u64) -> [u8; 32] {
    content_digest(&fs::read(generation_path(dir, revision)).unwrap())
}

fn binding_of(manifest: &JournalManifest, digest: [u8; 32]) -> LiveMigration {
    LiveMigration {
        operation_id: manifest.operation_id.clone(),
        fencing_generation: manifest.fencing_generation,
        journal_revision: manifest.journal_revision,
        manifest_digest: digest,
    }
}

fn temp_base() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let base = std::env::temp_dir().join(format!(
        "wss-gate4d-binding-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&base);
    base
}

/// A provisioned provider with an epoch-1 `ACTIVE` key-epoch record, a root directory and a
/// separate journal directory.
struct Fixture {
    base: PathBuf,
    root_dir: PathBuf,
    journal_dir: PathBuf,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    key_ref: RootKeyRefV1,
}

impl Fixture {
    fn new() -> Self {
        let base = temp_base();
        let root_dir = base.join("authority");
        let journal_dir = base.join("journal");
        for slot in ["slot-a", "slot-b"] {
            fs::create_dir_all(root_dir.join(slot)).unwrap();
        }
        fs::create_dir_all(&journal_dir).unwrap();
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let key_ref = provider.provision_epoch_key(1).unwrap();
        provider.unlock().unwrap();
        let record = KeyEpochRecord {
            epoch: 1,
            status: KeyEpochStatus::Active,
            root_key_ref: key_ref.clone(),
        };
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let commit = KeyEpochCommit {
            scope: &scope,
            record: &record,
            registry_generation: 1,
            root_key_ref: &key_ref,
            key_epoch: 1,
            held: &guard,
        };
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        write_key_epoch(&mut StdFs, &provider, layout, commit).unwrap();
        drop(guard);
        Fixture {
            base,
            root_dir,
            journal_dir,
            provider,
            scope,
            key_ref,
        }
    }

    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.root_dir,
        }
    }

    fn loaded(&self) -> LoadedCatalog {
        load_catalog(&mut StdFs, &self.provider, self.layout())
            .unwrap()
            .unwrap()
    }

    /// An ordinary catalog commit with no descriptor change.
    fn ordinary_commit(&mut self, operation_id: &str) -> u64 {
        let root_dir = self.root_dir.clone();
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &self.key_ref,
            active_key_epoch: 1,
            operation_id,
        };
        commit_catalog_change(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            commit,
        )
        .unwrap()
        .root_generation
    }

    /// Commits the first ordinary root, then a root that binds `binding` (no producer exists in
    /// the crate yet, so the test writes the root directly).
    fn bind(&mut self, binding: &LiveMigration) {
        self.ordinary_commit("bootstrap-root");
        let catalog = self.loaded();
        let root = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: binding.operation_id.clone(),
                fencing_generation: binding.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(binding.clone()),
            ..catalog.root
        };
        let root_dir = self.root_dir.clone();
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &self.key_ref,
            held: &guard,
        };
        commit_root(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            request,
        )
        .unwrap();
    }

    fn advance(&mut self, next: &LiveMigration) -> Result<u64, AuthorityError> {
        let key_ref = self.key_ref.clone();
        self.advance_with(&mut StdFs, next, &key_ref, 1)
            .map(|committed| committed.root_generation)
    }

    /// An advance over `fs` under the given key route and epoch.
    fn advance_with<F: DurableFs>(
        &mut self,
        fs: &mut F,
        next: &LiveMigration,
        root_key_ref: &RootKeyRefV1,
        active_key_epoch: u64,
    ) -> Result<RootCommitted, AuthorityError> {
        let root_dir = self.root_dir.clone();
        let key = journal_key();
        let op = WriteOperationId::generate().unwrap();
        let advance = BindingAdvance {
            next,
            journal: JournalSource {
                key: &key,
                dir: &self.journal_dir,
                operation: &op,
            },
            root_key_ref,
            active_key_epoch,
        };
        advance_live_migration(
            fs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            advance,
        )
    }

    fn journal_files(&self) -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<(String, Vec<u8>)> = fs::read_dir(&self.journal_dir)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    fs::read(&path).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

/// Records every directory sync and every atomic rename (the root pointer move), in call order.
struct RecordingFs {
    inner: StdFs,
    log: Vec<String>,
}

impl RecordingFs {
    fn new() -> Self {
        Self {
            inner: StdFs,
            log: Vec::new(),
        }
    }
}

impl DurableFs for RecordingFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
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
        self.log.push(format!("sync_dir {}", dir.display()));
        self.inner.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        self.inner.list_dir(dir)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.log.push(format!("rename_replace {}", to.display()));
        self.inner.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.inner.create_dir_all(dir)
    }
}

/// A root that binds revision 0 of `OPERATION`, with revision 1 durable as the next candidate.
struct Scenario {
    fixture: Fixture,
    bound: LiveMigration,
    next: LiveMigration,
}

fn scenario() -> Scenario {
    let mut fixture = Fixture::new();
    let dir = fixture.journal_dir.clone();
    let zero = manifest_at(OPERATION, 0, FENCE);
    promote(&dir, &zero, None);
    let bound = binding_of(&zero, digest_of(&dir, 0));
    fixture.bind(&bound);
    let one = manifest_at(OPERATION, 1, FENCE);
    promote(&dir, &one, Some(&bound));
    let next = binding_of(&one, digest_of(&dir, 1));
    Scenario {
        fixture,
        bound,
        next,
    }
}

fn authority_refusal(error: MigrationExecutionError) -> AuthorityError {
    AuthorityError::LiveMigration(error)
}

#[test]
fn advance_commits_the_next_revision_and_changes_nothing_else() {
    let mut s = scenario();
    let before = s.fixture.loaded().root;
    assert_eq!(before.live_migration, Some(s.bound.clone()));
    let journal_before = s.fixture.journal_files();
    let generation = s.fixture.advance(&s.next).unwrap();
    let after = s.fixture.loaded().root;
    assert_eq!(generation, before.root_generation + 1);
    assert_eq!(after.root_generation, generation);
    assert_eq!(after.live_migration, Some(s.next.clone()));
    assert_eq!(
        after.commit_evidence,
        RootCommitEvidence {
            operation_id: OPERATION.to_owned(),
            fencing_generation: FENCE,
            state: RootCommitState::Committed,
        }
    );
    assert_eq!(after.active_key_epoch, before.active_key_epoch);
    assert_eq!(after.root_key_ref_digest, before.root_key_ref_digest);
    assert_eq!(after.marker_set_digest, before.marker_set_digest);
    assert_eq!(after.catalog_set_digest, before.catalog_set_digest);
    assert_eq!(after.key_epoch_set_digest, before.key_epoch_set_digest);
    assert_eq!(s.fixture.journal_files(), journal_before);
}

#[test]
fn advance_refuses_when_no_migration_is_bound() {
    let mut fixture = Fixture::new();
    let generation = fixture.ordinary_commit("bootstrap-root");
    let next = binding_of(&manifest_at(OPERATION, 1, FENCE), [0x11; 32]);
    assert_eq!(fixture.advance(&next), Err(AuthorityError::NoLiveMigration));
    let root = fixture.loaded().root;
    assert_eq!(root.root_generation, generation);
    assert_eq!(root.live_migration, None);
}

#[test]
fn advance_refuses_what_is_not_the_owners_next_revision() {
    let mut s = scenario();
    let dir = s.fixture.journal_dir.clone();
    promote(
        &dir,
        &manifest_at(OPERATION, 2, FENCE),
        Some(&s.next.clone()),
    );
    let two = binding_of(&manifest_at(OPERATION, 2, FENCE), digest_of(&dir, 2));
    let before = s.fixture.loaded().root;
    let cases = [
        (
            "another operation",
            binding_of(&manifest_at("other-op", 1, FENCE), s.next.manifest_digest),
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "another fencing generation",
            binding_of(
                &manifest_at(OPERATION, 1, FENCE + 1),
                s.next.manifest_digest,
            ),
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "the revision the root already names",
            s.bound.clone(),
            MigrationExecutionError::StaleJournalRevision,
        ),
        (
            "a skipped revision, although it is durable",
            two,
            MigrationExecutionError::LiveBindingMismatch,
        ),
    ];
    for (name, next, expected) in cases {
        assert_eq!(
            s.fixture.advance(&next),
            Err(authority_refusal(expected)),
            "{name}"
        );
        assert_eq!(s.fixture.loaded().root, before, "{name}");
    }
}

#[test]
fn advance_refuses_a_digest_that_is_not_the_durable_generation() {
    let mut s = scenario();
    let before = s.fixture.loaded().root;
    let mut wrong = s.next.clone();
    wrong.manifest_digest[0] ^= 0xff;
    assert_eq!(
        s.fixture.advance(&wrong),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::LiveBindingMismatch
        )))
    );
    assert_eq!(s.fixture.loaded().root, before);
}

#[test]
fn advance_refuses_when_the_named_generation_is_not_durable() {
    let mut s = scenario();
    let dir = s.fixture.journal_dir.clone();
    fs::remove_file(generation_path(&dir, 1)).unwrap();
    let before = s.fixture.loaded().root;
    assert_eq!(
        s.fixture.advance(&s.next),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::RecoveryRequired
        )))
    );
    assert_eq!(s.fixture.loaded().root, before);
}

#[test]
fn a_stale_owner_cannot_advance_after_the_root_moved_on() {
    let mut s = scenario();
    s.fixture.advance(&s.next).unwrap();
    let after_first = s.fixture.loaded().root;
    // The stale owner still holds the binding it advanced from; the root has moved past it.
    assert_eq!(
        s.fixture.advance(&s.next),
        Err(authority_refusal(
            MigrationExecutionError::StaleJournalRevision
        ))
    );
    assert_eq!(s.fixture.loaded().root, after_first);
}

#[test]
fn an_ordinary_catalog_commit_keeps_the_advanced_binding() {
    let mut s = scenario();
    s.fixture.advance(&s.next).unwrap();
    let advanced = s.fixture.loaded().root;
    let generation = s.fixture.ordinary_commit("ordinary-op");
    let after = s.fixture.loaded().root;
    assert_eq!(generation, advanced.root_generation + 1);
    assert_eq!(after.live_migration, Some(s.next.clone()));
    assert_eq!(after.commit_evidence.operation_id, "ordinary-op");
    assert_eq!(after.commit_evidence.fencing_generation, 0);
}

#[test]
fn advance_syncs_the_journal_directory_before_the_root_is_published() {
    let mut s = scenario();
    let key_ref = s.fixture.key_ref.clone();
    let mut fs = RecordingFs::new();
    s.fixture
        .advance_with(&mut fs, &s.next, &key_ref, 1)
        .unwrap();
    let journal_sync = format!("sync_dir {}", s.fixture.journal_dir.display());
    let synced = fs
        .log
        .iter()
        .position(|entry| *entry == journal_sync)
        .unwrap_or_else(|| panic!("journal directory not synced: {:?}", fs.log));
    let published = fs
        .log
        .iter()
        .position(|entry| entry.starts_with("rename_replace"))
        .unwrap_or_else(|| panic!("root pointer not published: {:?}", fs.log));
    assert!(synced < published, "{:?}", fs.log);
}

#[test]
fn advance_cannot_change_the_key_route_or_epoch() {
    let mut s = scenario();
    let before = s.fixture.loaded().root;
    let key_ref = s.fixture.key_ref.clone();
    assert_eq!(
        s.fixture
            .advance_with(&mut StdFs, &s.next, &key_ref, 2)
            .unwrap_err(),
        AuthorityError::KeyRotationNotAdmitted
    );
    let other_route = s.fixture.provider.provision_epoch_key(2).unwrap();
    assert_eq!(
        s.fixture
            .advance_with(&mut StdFs, &s.next, &other_route, 1)
            .unwrap_err(),
        AuthorityError::KeyRotationNotAdmitted
    );
    assert_eq!(s.fixture.loaded().root, before);
}
