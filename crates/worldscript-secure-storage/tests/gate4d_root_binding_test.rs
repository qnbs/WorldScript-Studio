//! Gate 4D B2b-1: advancing the root's live-migration binding to the journal owner's next revision
//! (§5.4, §10.1.1), and the composed commits of the journal owner built on it: checkpoint, takeover
//! and inventory capture.

use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    advance_live_migration, capture_inventory, commit_catalog_change, commit_inventory_capture,
    commit_journal_checkpoint, commit_journal_takeover, commit_root, content_digest,
    empty_inventory_digest, empty_journal_page_set_digest, generation_path, inventory_page_dir,
    load_authoritative_manifest, load_catalog, operation_type, phase_code, promote_manifest_fenced,
    seal_inventory_pages, source_authority_kind, source_physical_authority_kind, transition_phase,
    verify_stored_inventory, write_key_epoch, AuthorityError, BindingAdvance, CandidateConflict,
    CatalogChange, CatalogCommit, DirectoryDurability, DurableFs, InstallationScopeId,
    InventoryCapture, JournalCheckpoint, JournalDurableContext, JournalDurableError, JournalError,
    JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage, JournalSource,
    JournalTakeoverCommit, KeyEpochCommit, KeyEpochRecord, KeyEpochStatus, KeyProvider,
    LiveMigration, LoadedCatalog, MigrationExecutionError, MigrationFence, MigrationPhase,
    RecordClass, RecordIdentity, RootBody, RootCommitEvidence, RootCommitGuard, RootCommitRequest,
    RootCommitState, RootCommitted, RootKeyRefV1, RootLayout, SealedPage, StageFailureKind, StdFs,
    WriteOperationId,
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
            phase_code::DISCOVER
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
    /// What the next checkpoint or takeover does with a differing durable candidate.
    conflict: CandidateConflict,
    /// A write operation id every checkpoint and takeover reuses; a fresh one per call when `None`.
    operation: Option<WriteOperationId>,
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
            conflict: CandidateConflict::Refuse,
            operation: None,
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
        let route = Route {
            key_ref: &key_ref,
            epoch: 1,
        };
        self.advance_with(&mut StdFs, next, route)
            .map(|committed| committed.root_generation)
    }

    /// An advance over `fs` under the given key route and epoch.
    fn advance_with<F: DurableFs>(
        &mut self,
        fs: &mut F,
        next: &LiveMigration,
        route: Route<'_>,
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
            root_key_ref: route.key_ref,
            active_key_epoch: route.epoch,
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

    /// A checkpoint of `manifest` under its own fence and the committed key route and epoch.
    fn checkpoint(&mut self, manifest: &JournalManifest) -> Result<RootCommitted, AuthorityError> {
        let key_ref = self.key_ref.clone();
        let route = Route {
            key_ref: &key_ref,
            epoch: 1,
        };
        self.checkpoint_with(manifest, &MigrationFence::from_manifest(manifest), route)
    }

    fn checkpoint_with(
        &mut self,
        manifest: &JournalManifest,
        fence: &MigrationFence,
        route: Route<'_>,
    ) -> Result<RootCommitted, AuthorityError> {
        let root_dir = self.root_dir.clone();
        let key = journal_key();
        let op = self
            .operation
            .clone()
            .unwrap_or_else(|| WriteOperationId::generate().unwrap());
        let checkpoint = JournalCheckpoint {
            manifest,
            fence,
            journal: JournalSource {
                key: &key,
                dir: &self.journal_dir,
                operation: &op,
            },
            root_key_ref: route.key_ref,
            active_key_epoch: route.epoch,
            conflict: self.conflict,
        };
        commit_journal_checkpoint(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            checkpoint,
        )
    }

    /// A takeover claim of `claim` under its own fence, the committed key route and `now_unix_ms`.
    fn takeover(
        &mut self,
        claim: &JournalManifest,
        now_unix_ms: u64,
    ) -> Result<RootCommitted, AuthorityError> {
        let key_ref = self.key_ref.clone();
        let route = Route {
            key_ref: &key_ref,
            epoch: 1,
        };
        self.takeover_with(claim, now_unix_ms, route)
    }

    fn takeover_with(
        &mut self,
        claim: &JournalManifest,
        now_unix_ms: u64,
        route: Route<'_>,
    ) -> Result<RootCommitted, AuthorityError> {
        let root_dir = self.root_dir.clone();
        let key = journal_key();
        let op = self
            .operation
            .clone()
            .unwrap_or_else(|| WriteOperationId::generate().unwrap());
        let fence = MigrationFence::from_manifest(claim);
        let takeover = JournalTakeoverCommit {
            claim: JournalCheckpoint {
                manifest: claim,
                fence: &fence,
                journal: JournalSource {
                    key: &key,
                    dir: &self.journal_dir,
                    operation: &op,
                },
                root_key_ref: route.key_ref,
                active_key_epoch: route.epoch,
                conflict: self.conflict,
            },
            now_unix_ms,
        };
        commit_journal_takeover(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            takeover,
        )
    }

    /// The relocated candidates in the journal directory, with their bytes.
    fn rejected_files(&self) -> Vec<(String, Vec<u8>)> {
        self.journal_files()
            .into_iter()
            .filter(|(name, _)| name.contains(".rejected-"))
            .collect()
    }

    fn journal_files(&self) -> Vec<(String, Vec<u8>)> {
        let mut files: Vec<(String, Vec<u8>)> = fs::read_dir(&self.journal_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.is_file())
            .map(|path| {
                (
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    fs::read(&path).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    }

    /// Every file under the journal directory, pages included, with its bytes.
    fn journal_tree(&self) -> Vec<(PathBuf, Vec<u8>)> {
        let mut files = Vec::new();
        collect_files(&self.journal_dir, &mut files);
        files.sort();
        files
    }

    /// A capture of `captured` under its own fence and the committed key route and epoch.
    fn capture(&mut self, captured: &Capture) -> Result<RootCommitted, AuthorityError> {
        self.capture_over(&mut StdFs, captured)
    }

    fn capture_over<F: DurableFs>(
        &mut self,
        fs: &mut F,
        captured: &Capture,
    ) -> Result<RootCommitted, AuthorityError> {
        let key = journal_key();
        let op = self
            .operation
            .clone()
            .unwrap_or_else(|| WriteOperationId::generate().unwrap());
        let fence = MigrationFence::from_manifest(&captured.successor);
        let sealed = captured.sealed();
        let capture = InventoryCapture {
            checkpoint: JournalCheckpoint {
                manifest: &captured.successor,
                fence: &fence,
                journal: JournalSource {
                    key: &key,
                    dir: &self.journal_dir,
                    operation: &op,
                },
                root_key_ref: &self.key_ref,
                active_key_epoch: 1,
                conflict: self.conflict,
            },
            committed_manifest: &captured.committed,
            pages: &sealed,
        };
        commit_inventory_capture(
            fs,
            &mut self.provider,
            RootLayout {
                root_dir: &self.root_dir,
            },
            capture,
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

/// The key route and active epoch an advance is committed under.
#[derive(Clone, Copy)]
struct Route<'a> {
    key_ref: &'a RootKeyRefV1,
    epoch: u64,
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
    let route = Route {
        key_ref: &key_ref,
        epoch: 1,
    };
    let mut fs = RecordingFs::new();
    s.fixture.advance_with(&mut fs, &s.next, route).unwrap();
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
    let other_epoch = Route {
        key_ref: &key_ref,
        epoch: 2,
    };
    assert_eq!(
        s.fixture
            .advance_with(&mut StdFs, &s.next, other_epoch)
            .unwrap_err(),
        AuthorityError::KeyRotationNotAdmitted
    );
    let other_key_ref = s.fixture.provider.provision_epoch_key(2).unwrap();
    let other_route = Route {
        key_ref: &other_key_ref,
        epoch: 1,
    };
    assert_eq!(
        s.fixture
            .advance_with(&mut StdFs, &s.next, other_route)
            .unwrap_err(),
        AuthorityError::KeyRotationNotAdmitted
    );
    assert_eq!(s.fixture.loaded().root, before);
}

// ---- B2b-2: the journal-owner checkpoint (promote r+1, then advance the binding) ----

/// A root that binds revision 0 of `OPERATION`, with no candidate revision published yet.
fn bound_at_zero() -> (Fixture, LiveMigration) {
    let mut fixture = Fixture::new();
    let dir = fixture.journal_dir.clone();
    let zero = manifest_at(OPERATION, 0, FENCE);
    promote(&dir, &zero, None);
    let bound = binding_of(&zero, digest_of(&dir, 0));
    fixture.bind(&bound);
    (fixture, bound)
}

fn resumed_revision(fixture: &Fixture, binding: &LiveMigration) -> u64 {
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &fixture.journal_dir, &op);
    load_authoritative_manifest(&mut ctx, binding)
        .unwrap()
        .journal_revision
}

#[test]
fn checkpoint_publishes_the_next_manifest_and_advances_the_binding() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    let committed = fixture.checkpoint(&one).unwrap();
    let dir = fixture.journal_dir.clone();
    let after = fixture.loaded().root;
    assert_eq!(committed.root_generation, before.root_generation + 1);
    assert!(generation_path(&dir, 1).is_file());
    let advanced = binding_of(&one, digest_of(&dir, 1));
    assert_eq!(after.live_migration, Some(advanced.clone()));
    assert_eq!(
        after.commit_evidence,
        RootCommitEvidence {
            operation_id: OPERATION.to_owned(),
            fencing_generation: FENCE,
            state: RootCommitState::Committed,
        }
    );
    assert_eq!(after.catalog_set_digest, before.catalog_set_digest);
    assert_eq!(after.key_epoch_set_digest, before.key_epoch_set_digest);
    assert_eq!(resumed_revision(&fixture, &advanced), 1);
}

#[test]
fn checkpoint_refuses_without_a_bound_migration_and_writes_no_journal_byte() {
    let mut fixture = Fixture::new();
    let generation = fixture.ordinary_commit("bootstrap-root");
    let one = manifest_at(OPERATION, 1, FENCE);
    assert_eq!(
        fixture.checkpoint(&one),
        Err(AuthorityError::NoLiveMigration)
    );
    assert!(fixture.journal_files().is_empty());
    assert_eq!(fixture.loaded().root.root_generation, generation);
}

#[test]
fn checkpoint_refuses_stale_wrong_or_skipped_manifests_before_any_journal_write() {
    let (mut fixture, _) = bound_at_zero();
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    let cases = [
        (
            "a stale owner whose own fence agrees with its manifest",
            manifest_at(OPERATION, 1, FENCE - 1),
            JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner),
        ),
        (
            "another operation",
            manifest_at("other-op", 1, FENCE),
            JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch),
        ),
        (
            "the revision the root already names",
            manifest_at(OPERATION, 0, FENCE),
            JournalDurableError::Authority(MigrationExecutionError::StaleJournalRevision),
        ),
        (
            "a skipped revision",
            manifest_at(OPERATION, 2, FENCE),
            JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch),
        ),
    ];
    for (name, manifest, expected) in cases {
        assert_eq!(
            fixture.checkpoint(&manifest),
            Err(AuthorityError::Journal(expected)),
            "{name}"
        );
        assert_eq!(fixture.journal_files(), journal_before, "{name}");
        assert_eq!(fixture.loaded().root, before, "{name}");
    }
    let one = manifest_at(OPERATION, 1, FENCE);
    let key_ref = fixture.key_ref.clone();
    let route = Route {
        key_ref: &key_ref,
        epoch: 1,
    };
    let mismatched = MigrationFence {
        fencing_generation: FENCE + 5,
        journal_revision: 1,
    };
    assert_eq!(
        fixture.checkpoint_with(&one, &mismatched, route),
        Err(AuthorityError::Journal(JournalDurableError::Fence(
            MigrationExecutionError::StaleMigrationOwner
        )))
    );
    assert_eq!(fixture.journal_files(), journal_before);
}

#[test]
fn checkpoint_cannot_change_the_key_route_and_writes_no_journal_byte() {
    let (mut fixture, _) = bound_at_zero();
    let journal_before = fixture.journal_files();
    let one = manifest_at(OPERATION, 1, FENCE);
    let fence = MigrationFence::from_manifest(&one);
    let key_ref = fixture.key_ref.clone();
    let other_epoch = Route {
        key_ref: &key_ref,
        epoch: 2,
    };
    assert_eq!(
        fixture.checkpoint_with(&one, &fence, other_epoch),
        Err(AuthorityError::KeyRotationNotAdmitted)
    );
    let other_key_ref = fixture.provider.provision_epoch_key(2).unwrap();
    let other_route = Route {
        key_ref: &other_key_ref,
        epoch: 1,
    };
    assert_eq!(
        fixture.checkpoint_with(&one, &fence, other_route),
        Err(AuthorityError::KeyRotationNotAdmitted)
    );
    assert_eq!(fixture.journal_files(), journal_before);
}

/// Fails the root commit after the journal generation is durable, leaving an unadopted candidate.
fn fail_root_commit_after_promote(fixture: &mut Fixture, manifest: &JournalManifest) {
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    let error = fixture.checkpoint(manifest).unwrap_err();
    assert!(matches!(error, AuthorityError::Root(_)), "{error:?}");
}

fn assert_generation_exists(result: Result<RootCommitted, AuthorityError>, case: &str) {
    assert!(
        matches!(
            result,
            Err(AuthorityError::Journal(JournalDurableError::Stage(ref stage)))
                if matches!(stage.kind, StageFailureKind::GenerationExists)
        ),
        "{case}: {result:?}"
    );
}

#[test]
fn a_failed_root_commit_leaves_the_published_manifest_as_an_unadopted_candidate() {
    let (mut fixture, bound) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    // The crash window: revision 1 is durable, the root still names revision 0 and resumes it.
    let dir = fixture.journal_dir.clone();
    assert!(generation_path(&dir, 1).is_file());
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(resumed_revision(&fixture, &bound), 0);
}

#[test]
fn a_retry_after_a_failed_root_commit_adopts_the_candidate_without_a_journal_write() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    let dir = fixture.journal_dir.clone();
    let candidate_digest = digest_of(&dir, 1);
    let committed = fixture.checkpoint(&one).unwrap();
    // No journal byte was written or added: the candidate is adopted as it is.
    assert_eq!(fixture.journal_files(), journal_after_failure);
    assert_eq!(committed.root_generation, before.root_generation + 1);
    let adopted = binding_of(&one, candidate_digest);
    assert_eq!(fixture.loaded().root.live_migration, Some(adopted.clone()));
    assert_eq!(resumed_revision(&fixture, &adopted), 1);
    // The adopted revision is now committed, so it cannot be published a third time.
    assert_eq!(
        fixture.checkpoint(&one),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::StaleJournalRevision
        )))
    );
}

#[test]
fn repeated_failed_retries_leave_no_journal_residue_and_the_next_retry_still_adopts() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    // The retry itself fails at the root commit again: still adopting, still no journal write.
    fail_root_commit_after_promote(&mut fixture, &one);
    assert_eq!(fixture.journal_files(), journal_after_failure);
    assert_eq!(fixture.loaded().root, before);
    fixture.checkpoint(&one).unwrap();
    assert_eq!(fixture.journal_files(), journal_after_failure);
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&one, digest_of(&dir, 1)))
    );
}

#[test]
fn a_retry_whose_manifest_differs_from_the_candidate_is_refused_and_nothing_moves() {
    let (mut fixture, bound) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    let mut leased = one.clone();
    leased.has_lease_owner = true;
    leased.lease_owner_id = Some("owner-b".into());
    leased.lease_expires_unix_ms = Some(1_000);
    assert_generation_exists(fixture.checkpoint(&leased), "different lease");
    let mut moved_phase = one.clone();
    moved_phase.phase = phase_code::BOOTSTRAP_TARGET;
    assert_generation_exists(fixture.checkpoint(&moved_phase), "different phase");
    // The different candidate is neither adopted nor replaced, and the root is untouched.
    assert_eq!(fixture.journal_files(), journal_after_failure);
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(resumed_revision(&fixture, &bound), 0);
    // The original candidate can still be adopted afterwards.
    fixture.checkpoint(&one).unwrap();
    assert_eq!(fixture.journal_files(), journal_after_failure);
}

#[test]
fn a_candidate_that_cannot_be_opened_is_refused_and_left_untouched() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    let dir = fixture.journal_dir.clone();
    let zero_bytes = fs::read(generation_path(&dir, 0)).unwrap();
    for (case, bytes) in [
        ("garbage", vec![0xAA; 48]),
        ("wrong generation", zero_bytes),
    ] {
        let path = generation_path(&dir, 1);
        fs::remove_file(&path).unwrap();
        fs::write(&path, &bytes).unwrap();
        let journal_before = fixture.journal_files();
        assert_generation_exists(fixture.checkpoint(&one), case);
        assert_eq!(fixture.journal_files(), journal_before, "{case}");
        assert_eq!(fs::read(&path).unwrap(), bytes, "{case}");
        assert_eq!(fixture.loaded().root, before, "{case}");
    }
}

#[test]
fn a_stale_owner_cannot_adopt_the_candidate_of_the_committed_owner() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let before = fixture.loaded().root;
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    // An older owner holds a self-consistent manifest for the same revision.
    let stale = manifest_at(OPERATION, 1, FENCE - 1);
    assert_eq!(
        fixture.checkpoint(&stale),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::StaleMigrationOwner
        )))
    );
    assert_eq!(fixture.journal_files(), journal_after_failure);
    assert_eq!(fixture.loaded().root, before);
}

#[test]
fn checkpoints_chain_and_a_repeated_revision_is_refused_once_the_root_moved_on() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    let two = manifest_at(OPERATION, 2, FENCE);
    fixture.checkpoint(&one).unwrap();
    fixture.checkpoint(&two).unwrap();
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&two, digest_of(&dir, 2)))
    );
    let after = fixture.loaded().root;
    assert_eq!(
        fixture.checkpoint(&one),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::StaleJournalRevision
        )))
    );
    assert_eq!(fixture.loaded().root, after);
}

#[test]
fn checkpoint_refuses_a_manifest_that_is_not_a_valid_successor_before_any_journal_write() {
    let (mut fixture, _) = bound_at_zero();
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    let mut jump = manifest_at(OPERATION, 1, FENCE);
    jump.phase = phase_code::ADMIT;
    let mut rewritten = manifest_at(OPERATION, 1, FENCE);
    rewritten.target_epoch = 2;
    for (name, manifest, error) in [
        (
            "a phase jump",
            jump,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        (
            "a changed epoch",
            rewritten,
            MigrationExecutionError::FrozenFieldChanged,
        ),
    ] {
        assert_eq!(
            fixture.checkpoint(&manifest),
            Err(AuthorityError::Journal(JournalDurableError::Authority(
                error
            ))),
            "{name}"
        );
        assert_eq!(fixture.journal_files(), journal_before, "{name}");
        assert_eq!(fixture.loaded().root, before, "{name}");
    }
}

#[test]
fn a_candidate_that_is_not_a_valid_successor_is_not_adopted() {
    let (mut fixture, bound) = bound_at_zero();
    let dir = fixture.journal_dir.clone();
    // A phase-jumping revision 1 is already durable, as a failed older attempt could have left it.
    let mut jump = manifest_at(OPERATION, 1, FENCE);
    jump.phase = phase_code::ADMIT;
    promote(&dir, &jump, Some(&bound));
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    assert_eq!(
        fixture.checkpoint(&jump),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::InvalidPhaseTransition
        )))
    );
    assert_eq!(fixture.journal_files(), journal_before);
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(resumed_revision(&fixture, &bound), 0);
}

#[test]
fn a_chain_built_by_the_transition_constructors_is_accepted_to_done_and_no_further() {
    let (mut fixture, _) = bound_at_zero();
    let mut current = manifest_at(OPERATION, 0, FENCE);
    let phases = [
        phase_code::DISCOVER,
        phase_code::PREPARE,
        phase_code::ADMIT,
        phase_code::CONVERT,
        phase_code::VERIFY,
        phase_code::COMMIT,
        phase_code::RETIRE_OLD_AUTHORITY,
        phase_code::FINALIZE,
        phase_code::DONE,
    ];
    for target in phases {
        let fence = MigrationFence::from_manifest(&current);
        current = transition_phase(&current, &fence, MigrationPhase::from_wire(target)).unwrap();
        fixture.checkpoint(&current).unwrap();
        assert_eq!(current.phase, target);
    }
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(
            &current,
            digest_of(&dir, current.journal_revision)
        ))
    );
    // DONE is terminal: even the plain next revision is refused.
    let mut after_done = current.clone();
    after_done.journal_revision += 1;
    assert_eq!(
        fixture.checkpoint(&after_done),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::TerminalPhase
        )))
    );
}

#[test]
fn an_advance_to_a_non_successor_generation_is_refused_even_when_it_was_promoted_directly() {
    let (mut fixture, bound) = bound_at_zero();
    let dir = fixture.journal_dir.clone();
    // The plain fenced promote only checks who may publish; the root must still refuse to trust it.
    let mut jump = manifest_at(OPERATION, 1, FENCE);
    jump.phase = phase_code::ADMIT;
    promote(&dir, &jump, Some(&bound));
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    let named = binding_of(&jump, digest_of(&dir, 1));
    assert_eq!(
        fixture.advance(&named),
        Err(authority_refusal(
            MigrationExecutionError::InvalidPhaseTransition
        ))
    );
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(fixture.journal_files(), journal_before);
    assert_eq!(resumed_revision(&fixture, &bound), 0);
}

/// The claim a new owner publishes over `prev` at `now`: fence + 1, revision + 1, its own lease.
fn claim_over(prev: &JournalManifest, now: u64) -> JournalManifest {
    let mut claim = prev.clone();
    claim.journal_revision += 1;
    claim.fencing_generation += 1;
    claim.has_lease_owner = true;
    claim.lease_owner_id = Some("new-owner".into());
    claim.lease_expires_unix_ms = Some(now + 100);
    claim
}

#[test]
fn a_takeover_publishes_the_claim_and_binds_the_root_to_the_new_fence() {
    let (mut fixture, bound) = bound_at_zero();
    let zero = manifest_at(OPERATION, 0, FENCE);
    let claim = claim_over(&zero, 1_000);
    let before = fixture.loaded().root;
    let committed = fixture.takeover(&claim, 1_000).unwrap();
    let dir = fixture.journal_dir.clone();
    let after = fixture.loaded().root;
    assert_eq!(committed.root_generation, before.root_generation + 1);
    assert!(generation_path(&dir, 1).is_file());
    assert_eq!(
        after.live_migration,
        Some(binding_of(&claim, digest_of(&dir, 1)))
    );
    assert_eq!(
        after.commit_evidence,
        RootCommitEvidence {
            operation_id: OPERATION.to_owned(),
            fencing_generation: FENCE + 1,
            state: RootCommitState::Committed,
        }
    );
    // Nothing but the binding and its evidence moved, and the claim is what a restart resumes.
    assert_eq!(after.catalog_set_digest, before.catalog_set_digest);
    assert_eq!(after.marker_set_digest, before.marker_set_digest);
    assert_ne!(Some(bound), after.live_migration);
    assert_eq!(
        resumed_revision(&fixture, &after.live_migration.unwrap()),
        1
    );
}

#[test]
fn a_lease_that_has_not_expired_refuses_the_takeover_before_any_journal_write() {
    let (mut fixture, _) = bound_at_zero();
    let mut one = manifest_at(OPERATION, 1, FENCE);
    one.has_lease_owner = true;
    one.lease_owner_id = Some("old-owner".into());
    one.lease_expires_unix_ms = Some(10_000);
    fixture.checkpoint(&one).unwrap();
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    let claim = claim_over(&one, 9_999);
    assert_eq!(
        fixture.takeover(&claim, 9_999),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::LeaseNotExpired
        )))
    );
    assert_eq!(fixture.journal_files(), journal_before);
    assert_eq!(fixture.loaded().root, before);
    // The lease is expired exactly at its expiry.
    let claim = claim_over(&one, 10_000);
    fixture.takeover(&claim, 10_000).unwrap();
    assert_eq!(
        fixture
            .loaded()
            .root
            .live_migration
            .map(|binding| binding.fencing_generation),
        Some(FENCE + 1)
    );
}

#[test]
fn the_former_owner_is_refused_after_a_takeover_and_the_new_owner_continues() {
    let (mut fixture, _) = bound_at_zero();
    let zero = manifest_at(OPERATION, 0, FENCE);
    let claim = claim_over(&zero, 1_000);
    fixture.takeover(&claim, 1_000).unwrap();
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    // The former owner still holds a self-consistent manifest and fence for the next revision.
    let stale = manifest_at(OPERATION, 2, FENCE);
    assert_eq!(
        fixture.checkpoint(&stale),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::StaleMigrationOwner
        )))
    );
    assert_eq!(fixture.journal_files(), journal_before);
    assert_eq!(fixture.loaded().root, before);
    // The new owner makes progress through the ordinary checkpoint under its own fence.
    let fence = MigrationFence::from_manifest(&claim);
    let next = transition_phase(
        &claim,
        &fence,
        MigrationPhase::from_wire(phase_code::DISCOVER),
    )
    .unwrap();
    fixture.checkpoint(&next).unwrap();
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&next, digest_of(&dir, 2)))
    );
}

#[test]
fn a_retry_after_a_failed_root_commit_adopts_the_takeover_candidate() {
    let (mut fixture, _) = bound_at_zero();
    let zero = manifest_at(OPERATION, 0, FENCE);
    let claim = claim_over(&zero, 1_000);
    let before = fixture.loaded().root;
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    let error = fixture.takeover(&claim, 1_000).unwrap_err();
    assert!(matches!(error, AuthorityError::Root(_)), "{error:?}");
    assert_eq!(fixture.loaded().root, before);
    let journal_after_failure = fixture.journal_files();
    fixture.takeover(&claim, 1_000).unwrap();
    assert_eq!(fixture.journal_files(), journal_after_failure);
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&claim, digest_of(&dir, 1)))
    );
}

#[test]
fn a_refused_takeover_writes_no_journal_byte() {
    let (mut fixture, _) = bound_at_zero();
    let zero = manifest_at(OPERATION, 0, FENCE);
    let before = fixture.loaded().root;
    let journal_before = fixture.journal_files();
    let mut same_fence = claim_over(&zero, 1_000);
    same_fence.fencing_generation = FENCE;
    let mut skipped_fence = claim_over(&zero, 1_000);
    skipped_fence.fencing_generation = FENCE + 2;
    let mut moved_phase = claim_over(&zero, 1_000);
    moved_phase.phase = phase_code::DISCOVER;
    let mut no_lease = claim_over(&zero, 1_000);
    no_lease.has_lease_owner = false;
    no_lease.lease_owner_id = None;
    no_lease.lease_expires_unix_ms = None;
    let cases = [
        (
            "the same fence",
            same_fence,
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "a skipped fence",
            skipped_fence,
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "a claim that also moves the phase",
            moved_phase,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (
            "a claim without a lease",
            no_lease,
            MigrationExecutionError::InvalidTakeoverLease,
        ),
    ];
    for (name, claim, error) in cases {
        assert_eq!(
            fixture.takeover(&claim, 1_000),
            Err(AuthorityError::Journal(JournalDurableError::Authority(
                error
            ))),
            "{name}"
        );
        assert_eq!(fixture.journal_files(), journal_before, "{name}");
        assert_eq!(fixture.loaded().root, before, "{name}");
    }
    // A different key route or epoch is refused before the publish as well.
    let claim = claim_over(&zero, 1_000);
    let key_ref = fixture.key_ref.clone();
    let other_epoch = Route {
        key_ref: &key_ref,
        epoch: 2,
    };
    assert_eq!(
        fixture.takeover_with(&claim, 1_000, other_epoch),
        Err(AuthorityError::KeyRotationNotAdmitted)
    );
    assert_eq!(fixture.journal_files(), journal_before);
}

#[test]
fn a_takeover_needs_a_bound_migration() {
    let mut fixture = Fixture::new();
    fixture.ordinary_commit("bootstrap-root");
    let zero = manifest_at(OPERATION, 0, FENCE);
    let claim = claim_over(&zero, 1_000);
    assert_eq!(
        fixture.takeover(&claim, 1_000),
        Err(AuthorityError::NoLiveMigration)
    );
    assert!(fixture.journal_files().is_empty());
}

/// A copy of `manifest` that a different attempt would publish: another lease owner.
fn rival_of(manifest: &JournalManifest) -> JournalManifest {
    let mut rival = manifest.clone();
    rival.has_lease_owner = true;
    rival.lease_owner_id = Some("owner-b".into());
    rival.lease_expires_unix_ms = Some(1_000);
    rival
}

fn candidate_bytes(fixture: &Fixture, revision: u64) -> Vec<u8> {
    fs::read(generation_path(&fixture.journal_dir, revision)).unwrap()
}

#[test]
fn a_retry_with_a_different_manifest_replaces_the_candidate_and_preserves_its_bytes() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    fail_root_commit_after_promote(&mut fixture, &one);
    let stale = candidate_bytes(&fixture, 1);
    let rival = rival_of(&one);
    // The default policy still refuses and touches nothing.
    assert_generation_exists(fixture.checkpoint(&rival), "refuse");
    assert_eq!(candidate_bytes(&fixture, 1), stale);
    assert!(fixture.rejected_files().is_empty());
    fixture.conflict = CandidateConflict::Quarantine;
    fixture.checkpoint(&rival).unwrap();
    let rejected = fixture.rejected_files();
    assert_eq!(rejected.len(), 1);
    assert_eq!(rejected[0].1, stale);
    assert_ne!(candidate_bytes(&fixture, 1), stale);
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&rival, digest_of(&dir, 1)))
    );
}

#[test]
fn a_takeover_claim_after_the_first_claims_lease_expired_succeeds_with_a_new_claim() {
    let (mut fixture, _) = bound_at_zero();
    let zero = manifest_at(OPERATION, 0, FENCE);
    let first = claim_over(&zero, 1_000);
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    let error = fixture.takeover(&first, 1_000).unwrap_err();
    assert!(matches!(error, AuthorityError::Root(_)), "{error:?}");
    let stale = candidate_bytes(&fixture, 1);
    // The restart comes after the first claim's lease ran out: that claim cannot be retried, and a
    // new claim differs from the durable one.
    let later = 5_000;
    assert_eq!(
        fixture.takeover(&first, later),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::InvalidTakeoverLease
        )))
    );
    let second = claim_over(&zero, later);
    assert_generation_exists(fixture.takeover(&second, later), "refuse");
    fixture.conflict = CandidateConflict::Quarantine;
    fixture.takeover(&second, later).unwrap();
    let rejected = fixture.rejected_files();
    assert_eq!(rejected.len(), 1);
    assert_eq!(rejected[0].1, stale);
    let dir = fixture.journal_dir.clone();
    assert_eq!(
        fixture.loaded().root.live_migration,
        Some(binding_of(&second, digest_of(&dir, 1)))
    );
}

#[test]
fn unopenable_and_oversized_candidates_are_preserved_exactly_and_replaced() {
    let oversized = vec![0xAA; worldscript_secure_storage::MAX_JOURNAL_MANIFEST_ENVELOPE_BYTES + 1];
    for (case, bytes) in [("garbage", vec![0x5A; 48]), ("oversized", oversized)] {
        let (mut fixture, _) = bound_at_zero();
        let one = manifest_at(OPERATION, 1, FENCE);
        fail_root_commit_after_promote(&mut fixture, &one);
        let path = generation_path(&fixture.journal_dir, 1);
        fs::remove_file(&path).unwrap();
        fs::write(&path, &bytes).unwrap();
        fixture.conflict = CandidateConflict::Quarantine;
        fixture.checkpoint(&one).unwrap();
        let rejected = fixture.rejected_files();
        assert_eq!(rejected.len(), 1, "{case}");
        assert_eq!(rejected[0].1, bytes, "{case}");
        let dir = fixture.journal_dir.clone();
        assert_eq!(
            fixture.loaded().root.live_migration,
            Some(binding_of(&one, digest_of(&dir, 1))),
            "{case}"
        );
    }
}

#[test]
fn an_identical_candidate_is_adopted_and_never_discarded() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    fixture.conflict = CandidateConflict::Quarantine;
    fixture.checkpoint(&one).unwrap();
    assert_eq!(fixture.journal_files(), journal_after_failure);
    assert!(fixture.rejected_files().is_empty());
}

#[test]
fn a_refused_manifest_never_discards_a_candidate() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    fail_root_commit_after_promote(&mut fixture, &one);
    let journal_after_failure = fixture.journal_files();
    let before = fixture.loaded().root;
    fixture.conflict = CandidateConflict::Quarantine;
    // Neither a phase jump nor a stale owner reaches the candidate.
    let mut jump = manifest_at(OPERATION, 1, FENCE);
    jump.phase = phase_code::ADMIT;
    let stale = manifest_at(OPERATION, 1, FENCE - 1);
    for (name, manifest, error) in [
        (
            "a phase jump",
            jump,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        (
            "a stale owner",
            stale,
            MigrationExecutionError::StaleMigrationOwner,
        ),
    ] {
        assert_eq!(
            fixture.checkpoint(&manifest),
            Err(AuthorityError::Journal(JournalDurableError::Authority(
                error
            ))),
            "{name}"
        );
        assert_eq!(fixture.journal_files(), journal_after_failure, "{name}");
    }
    assert_eq!(fixture.loaded().root, before);
}

#[test]
fn two_discards_at_one_revision_keep_both_candidates() {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    fail_root_commit_after_promote(&mut fixture, &one);
    let first = candidate_bytes(&fixture, 1);
    fixture.conflict = CandidateConflict::Quarantine;
    // The second attempt replaces the first candidate, and its own root commit fails as well.
    let second = rival_of(&one);
    fail_root_commit_after_promote(&mut fixture, &second);
    let second_bytes = candidate_bytes(&fixture, 1);
    let mut third = rival_of(&one);
    third.lease_owner_id = Some("owner-c".into());
    fixture.checkpoint(&third).unwrap();
    let mut rejected: Vec<Vec<u8>> = fixture
        .rejected_files()
        .into_iter()
        .map(|(_, bytes)| bytes)
        .collect();
    rejected.sort();
    let mut expected = vec![first, second_bytes];
    expected.sort();
    assert_eq!(rejected, expected);
    let names: std::collections::BTreeSet<String> = fixture
        .rejected_files()
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    assert_eq!(names.len(), 2);
}

#[test]
fn a_reused_operation_id_still_keeps_every_discarded_candidate() {
    let (mut fixture, _) = bound_at_zero();
    // Every call below reuses one write operation id; each relocation still gets its own name.
    fixture.operation = Some(WriteOperationId::generate().unwrap());
    fixture.conflict = CandidateConflict::Quarantine;
    let one = manifest_at(OPERATION, 1, FENCE);
    fail_root_commit_after_promote(&mut fixture, &one);
    let first = candidate_bytes(&fixture, 1);
    let second = rival_of(&one);
    fail_root_commit_after_promote(&mut fixture, &second);
    let second_bytes = candidate_bytes(&fixture, 1);
    let mut third = rival_of(&one);
    third.lease_owner_id = Some("owner-c".into());
    fixture.checkpoint(&third).unwrap();
    let mut rejected: Vec<Vec<u8>> = fixture
        .rejected_files()
        .into_iter()
        .map(|(_, bytes)| bytes)
        .collect();
    rejected.sort();
    let mut expected = vec![first, second_bytes];
    expected.sort();
    assert_eq!(rejected, expected);
}

// ---- C1c: the composed capture commit (pages, then manifest, then the binding) ----

fn collect_files(dir: &Path, files: &mut Vec<(PathBuf, Vec<u8>)>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect_files(&path, files);
        } else {
            files.push((path.clone(), fs::read(&path).unwrap()));
        }
    }
}

fn entry(n: u32) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:03}")]).unwrap();
    JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
            physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
            generation: None,
            evidence_digest: Some([n as u8; 32]),
            foreign: None,
        },
    )
    .unwrap()
}

/// An inventory captured over `committed`: its pages (two entries each) sealed once, and the
/// manifest successor that names them.
struct Capture {
    committed: JournalManifest,
    successor: JournalManifest,
    pages: Vec<JournalPage>,
    envelopes: Vec<Vec<u8>>,
}

impl Capture {
    fn over(committed: &JournalManifest, entries: u32) -> Self {
        let all: Vec<JournalInventoryEntry> = (0..entries).map(entry).collect();
        let sorted = JournalPage::new(0, 1, all).unwrap().entries().to_vec();
        let generation = committed.journal_revision + 1;
        let pages: Vec<JournalPage> = sorted
            .chunks(2)
            .enumerate()
            .map(|(index, chunk)| {
                JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap()
            })
            .collect();
        let envelopes = seal_inventory_pages(&journal_key(), OPERATION, &pages).unwrap();
        let fence = MigrationFence::from_manifest(committed);
        let sealed = seal_all(&pages, &envelopes);
        let successor = capture_inventory(committed, &fence, &sealed).unwrap();
        Capture {
            committed: committed.clone(),
            successor,
            pages,
            envelopes,
        }
    }

    fn sealed(&self) -> Vec<SealedPage<'_>> {
        seal_all(&self.pages, &self.envelopes)
    }
}

fn seal_all<'a>(pages: &'a [JournalPage], envelopes: &'a [Vec<u8>]) -> Vec<SealedPage<'a>> {
    pages
        .iter()
        .zip(envelopes)
        .map(|(page, envelope)| SealedPage { page, envelope })
        .collect()
}

/// A root that binds revision 1 (`DISCOVER`, an open inventory) of `OPERATION`.
fn bound_at_one() -> (Fixture, JournalManifest, LiveMigration) {
    let (mut fixture, _) = bound_at_zero();
    let one = manifest_at(OPERATION, 1, FENCE);
    fixture.checkpoint(&one).unwrap();
    let bound = binding_of(&one, digest_of(&fixture.journal_dir, 1));
    (fixture, one, bound)
}

fn verified_refs(fixture: &Fixture, binding: &LiveMigration) -> usize {
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &fixture.journal_dir, &op);
    verify_stored_inventory(&mut ctx, binding)
        .unwrap()
        .page_refs()
        .len()
}

#[test]
fn a_capture_stores_the_pages_publishes_the_manifest_and_advances_the_binding() {
    let (mut fixture, one, _) = bound_at_one();
    let captured = Capture::over(&one, 5);
    let before = fixture.loaded().root;
    let committed = fixture.capture(&captured).unwrap();
    let dir = fixture.journal_dir.clone();
    let advanced = binding_of(&captured.successor, digest_of(&dir, 2));
    let after = fixture.loaded().root;
    assert_eq!(committed.root_generation, before.root_generation + 1);
    assert_eq!(after.live_migration, Some(advanced.clone()));
    // The root names a manifest whose pages are all there and authenticate against it.
    assert_eq!(verified_refs(&fixture, &advanced), captured.pages.len());
    let page_dir = inventory_page_dir(&dir, &captured.successor.journal_page_set_digest, 0);
    assert!(page_dir.is_dir());
}

#[test]
fn a_capture_refuses_without_a_bound_migration_and_writes_nothing() {
    let mut fixture = Fixture::new();
    let generation = fixture.ordinary_commit("bootstrap-root");
    let captured = Capture::over(&manifest_at(OPERATION, 1, FENCE), 3);
    assert_eq!(
        fixture.capture(&captured),
        Err(AuthorityError::NoLiveMigration)
    );
    assert!(fixture.journal_tree().is_empty());
    assert_eq!(fixture.loaded().root.root_generation, generation);
}

#[test]
fn a_capture_that_is_refused_before_the_store_writes_no_page_and_no_manifest() {
    let (mut fixture, one, _) = bound_at_one();
    let before = fixture.loaded().root;
    let tree_before = fixture.journal_tree();
    // The pages of another capture: authentic, but not the page set the successor names.
    let mut foreign = Capture::over(&one, 3);
    let other = Capture::over(&one, 3);
    (foreign.pages, foreign.envelopes) = (other.pages, other.envelopes);
    // A stale owner: built over a committed manifest of an older fence.
    let stale = Capture::over(&manifest_at(OPERATION, 1, FENCE - 1), 3);
    let cases = [
        (
            "the pages of another capture",
            foreign,
            JournalDurableError::Journal(JournalError::PageSetMismatch),
        ),
        (
            "a stale owner",
            stale,
            JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner),
        ),
    ];
    for (name, captured, expected) in cases {
        assert_eq!(
            fixture.capture(&captured),
            Err(AuthorityError::Journal(expected)),
            "{name}"
        );
        assert_eq!(fixture.journal_tree(), tree_before, "{name}");
        assert_eq!(fixture.loaded().root, before, "{name}");
    }
}

#[test]
fn a_failed_root_commit_after_the_capture_is_retried_and_adopts_pages_and_manifest() {
    let (mut fixture, one, bound) = bound_at_one();
    let captured = Capture::over(&one, 5);
    let before = fixture.loaded().root;
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    let error = fixture.capture(&captured).unwrap_err();
    assert!(matches!(error, AuthorityError::Root(_)), "{error:?}");
    // The crash window: pages and manifest are durable, the root still names revision 1.
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(resumed_revision(&fixture, &bound), 1);
    let tree_after_failure = fixture.journal_tree();
    fixture.capture(&captured).unwrap();
    // The retry wrote nothing: both the pages and the manifest were adopted as they are.
    assert_eq!(fixture.journal_tree(), tree_after_failure);
    let dir = fixture.journal_dir.clone();
    let advanced = binding_of(&captured.successor, digest_of(&dir, 2));
    assert_eq!(fixture.loaded().root.live_migration, Some(advanced.clone()));
    assert_eq!(verified_refs(&fixture, &advanced), captured.pages.len());
}

/// Fails the creation of any file directly in the journal directory, which is where a manifest
/// generation is staged; the page files are staged in subdirectories.
struct FailManifestFs {
    inner: StdFs,
    journal_dir: PathBuf,
}

impl DurableFs for FailManifestFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        if path.parent() == Some(self.journal_dir.as_path()) {
            return Err(io::Error::other("injected manifest staging failure"));
        }
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

#[test]
fn a_failure_between_the_pages_and_the_manifest_is_retried_and_completes() {
    let (mut fixture, one, bound) = bound_at_one();
    let captured = Capture::over(&one, 5);
    let before = fixture.loaded().root;
    let mut failing = FailManifestFs {
        inner: StdFs,
        journal_dir: fixture.journal_dir.clone(),
    };
    let error = fixture.capture_over(&mut failing, &captured).unwrap_err();
    assert!(matches!(error, AuthorityError::Journal(_)), "{error:?}");
    // The pages are durable before the manifest; the manifest and the binding are not.
    let dir = fixture.journal_dir.clone();
    let digest = captured.successor.journal_page_set_digest;
    assert!(inventory_page_dir(&dir, &digest, 0).is_dir());
    assert!(!generation_path(&dir, 2).exists());
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(resumed_revision(&fixture, &bound), 1);
    fixture.capture(&captured).unwrap();
    let advanced = binding_of(&captured.successor, digest_of(&dir, 2));
    assert_eq!(verified_refs(&fixture, &advanced), captured.pages.len());
}

#[test]
fn a_progress_checkpoint_cannot_change_the_inventory() {
    let (mut fixture, one, bound) = bound_at_one();
    let tree_before = fixture.journal_tree();
    let before = fixture.loaded().root;
    // Naming a page set nobody wrote: the successor relation alone would accept it before CONVERT.
    let mut claims_pages = manifest_at(OPERATION, 2, FENCE);
    claims_pages.page_count = 1;
    claims_pages.entry_count = 2;
    claims_pages.inventory_digest = [0x77; 32];
    claims_pages.journal_page_set_digest = [0x88; 32];
    assert_eq!(
        fixture.checkpoint(&claims_pages),
        Err(AuthorityError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::FrozenFieldChanged
        )))
    );
    assert_eq!(fixture.journal_tree(), tree_before);
    assert_eq!(fixture.loaded().root, before);
    // The root refuses it too when the manifest got there through the plain fenced promote.
    promote(&fixture.journal_dir, &claims_pages, Some(&bound));
    let named = binding_of(&claims_pages, digest_of(&fixture.journal_dir, 2));
    assert_eq!(
        fixture.advance(&named),
        Err(AuthorityError::LiveMigration(
            MigrationExecutionError::FrozenFieldChanged
        ))
    );
    assert_eq!(fixture.loaded().root, before);
    assert_eq!(one.page_count, 0);
}

#[test]
fn a_capture_cannot_change_the_key_route() {
    let (mut fixture, one, _) = bound_at_one();
    let captured = Capture::over(&one, 3);
    let tree_before = fixture.journal_tree();
    let other_key_ref = fixture.provider.provision_epoch_key(2).unwrap();
    fixture.key_ref = other_key_ref;
    assert_eq!(
        fixture.capture(&captured),
        Err(AuthorityError::KeyRotationNotAdmitted)
    );
    assert_eq!(fixture.journal_tree(), tree_before);
}
