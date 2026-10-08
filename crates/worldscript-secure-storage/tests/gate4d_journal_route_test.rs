//! Gate 4D Slice D2b-3a: the key route of a bound migration journal (§6, §8.3, §10.1.1). The journal
//! of a rotation is sealed under its source epoch's key; the route finds that key through the
//! committed root's own binding and the key-epoch registry the root commits to, never through the
//! root's active epoch and never through anything the caller supplies. Every scenario therefore
//! commits a real root that binds the journal. Slice D2b-3b: the four composed journal operations
//! use that route, so an unroutable epoch refuses each of them before a journal write.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    advance_live_migration, commit_catalog_change, commit_inventory_capture,
    commit_journal_checkpoint, commit_journal_takeover, commit_root, content_digest,
    empty_inventory_digest, empty_journal_page_set_digest, generation_path, load_catalog,
    operation_type, phase_code, resolve_journal_key, write_key_epoch, AuthorityError,
    BindingAdvance, CandidateConflict, CatalogChange, CatalogCommit, InstallationScopeId,
    InventoryCapture, JournalCheckpoint, JournalDurableError, JournalError, JournalManifest,
    JournalRoute, JournalRouteError, JournalSource, JournalTakeoverCommit, Key, KeyEpochCommit,
    KeyEpochRecord, KeyEpochStatus, KeyProvider, LiveMigration, ManifestRead,
    MigrationExecutionError, MigrationFence, OpenError, RecordClass, RecordIdentity, RecordMeta,
    RootBody, RootCommitEvidence, RootCommitGuard, RootCommitRequest, RootCommitState,
    RootKeyRefV1, RootLayout, StdFs, WriteOperationId, JOURNAL_MANIFEST_RECORD_SCHEMA,
};

const OPERATION: &str = "route-op";
const REVISION: u64 = 3;
const SOURCE_EPOCH: u64 = 1;
const TARGET_EPOCH: u64 = 2;
/// The key material of the source epoch: the journal of the rotation is sealed under it.
const SOURCE_MATERIAL: [u8; 32] = [9; 32];
const TARGET_MATERIAL: [u8; 32] = [7; 32];

fn source_key() -> Key {
    Key::from_bytes(&mut SOURCE_MATERIAL.clone())
}

/// A rotation from epoch 1 to 2: its journal envelope epoch is 1, whatever the root's active epoch.
fn rotation() -> JournalManifest {
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: REVISION,
        operation_type: operation_type::ROTATE,
        phase: phase_code::DISCOVER,
        source_epoch: SOURCE_EPOCH,
        target_epoch: TARGET_EPOCH,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 4,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 0,
        entry_count: 0,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
}

fn identity() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Migration, &[OPERATION]).unwrap()
}

/// A directory this test created; removed when dropped (`create_dir` fails on an existing path, so a
/// leftover of an earlier process is skipped, never reused or removed).
struct Dir(PathBuf);

impl Dir {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        loop {
            let path = std::env::temp_dir().join(format!(
                "wss-gate4d-route-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Dir(path),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("cannot create {}: {error}", path.display()),
            }
        }
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A root directory, a journal directory and a provider holding the keys of epochs 1 and 2. The
/// root's active epoch is `root_epoch`; the registry records are sealed under that epoch's route.
struct Fixture {
    base: Dir,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    root_epoch: u64,
    source_ref: RootKeyRefV1,
    target_ref: RootKeyRefV1,
}

impl Fixture {
    fn new(root_epoch: u64) -> Self {
        Self::with_source_material(root_epoch, SOURCE_MATERIAL)
    }

    /// As [`Fixture::new`], but the provider holds `material` as the source epoch's key: the journal
    /// is still sealed under [`SOURCE_MATERIAL`], so a different value is a route to the wrong key.
    fn with_source_material(root_epoch: u64, material: [u8; 32]) -> Self {
        let base = Dir::new();
        for slot in ["authority/slot-a", "authority/slot-b", "journal"] {
            fs::create_dir_all(base.0.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let source_ref = provider.import_epoch_key(SOURCE_EPOCH, material).unwrap();
        let target_ref = provider
            .import_epoch_key(TARGET_EPOCH, TARGET_MATERIAL)
            .unwrap();
        provider.unlock().unwrap();
        Fixture {
            base,
            provider,
            scope,
            root_epoch,
            source_ref,
            target_ref,
        }
    }

    /// Before cutover: the root is at the source epoch, which is `Active`, and the target is only
    /// `Prepared`.
    fn pre_cutover() -> Self {
        let fixture = Fixture::new(SOURCE_EPOCH);
        fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
        fixture.register(TARGET_EPOCH, KeyEpochStatus::Prepared, 1);
        fixture
    }

    /// After cutover: the root is at the target epoch, which is `Active`, and the source is retained
    /// with `source_status`.
    fn post_cutover(source_status: KeyEpochStatus) -> Self {
        let fixture = Fixture::new(TARGET_EPOCH);
        fixture.register(SOURCE_EPOCH, source_status, 1);
        fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
        fixture
    }

    /// The root's own route, under which the registry is sealed.
    fn root_ref(&self) -> &RootKeyRefV1 {
        if self.root_epoch == SOURCE_EPOCH {
            &self.source_ref
        } else {
            &self.target_ref
        }
    }

    fn root_dir(&self) -> PathBuf {
        self.base.0.join("authority")
    }

    fn journal_dir(&self) -> PathBuf {
        self.base.0.join("journal")
    }

    fn register(&self, epoch: u64, status: KeyEpochStatus, generation: u64) {
        let route = if epoch == SOURCE_EPOCH {
            &self.source_ref
        } else {
            &self.target_ref
        };
        let record = KeyEpochRecord {
            epoch,
            status,
            root_key_ref: route.clone(),
        };
        let root_dir = self.root_dir();
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let commit = KeyEpochCommit {
            scope: &self.scope,
            record: &record,
            registry_generation: generation,
            root_key_ref: self.root_ref(),
            key_epoch: self.root_epoch,
            held: &guard,
        };
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        write_key_epoch(&mut StdFs, &self.provider, layout, commit).unwrap();
    }

    /// The rotation's manifest sealed under the source epoch's key and stored as the root-named
    /// generation; returns the binding that names it.
    fn store_journal(&self) -> LiveMigration {
        let manifest = rotation();
        let meta = RecordMeta {
            key_epoch: SOURCE_EPOCH,
            record_generation: REVISION,
            record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
        };
        let sealed = manifest.seal(&source_key(), &identity(), meta).unwrap();
        fs::write(generation_path(&self.journal_dir(), REVISION), &sealed).unwrap();
        LiveMigration {
            operation_id: OPERATION.into(),
            fencing_generation: manifest.fencing_generation,
            journal_revision: REVISION,
            manifest_digest: content_digest(&sealed),
        }
    }

    fn route(&self) -> Result<Key, JournalRouteError> {
        let root_dir = self.root_dir();
        let journal_dir = self.journal_dir();
        resolve_journal_key(
            &mut StdFs,
            &self.provider,
            JournalRoute {
                layout: RootLayout {
                    root_dir: &root_dir,
                },
                journal_dir: &journal_dir,
            },
        )
    }

    /// Every file under the fixture with a digest of its content.
    fn snapshot(&self) -> BTreeMap<PathBuf, [u8; 32]> {
        let mut files = BTreeMap::new();
        collect(&self.base.0, &self.base.0, &mut files);
        files
    }
}

fn collect(base: &Path, dir: &Path, files: &mut BTreeMap<PathBuf, [u8; 32]>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(base, &path, files);
        } else {
            let relative = path.strip_prefix(base).unwrap().to_path_buf();
            files.insert(relative, content_digest(&fs::read(&path).unwrap()));
        }
    }
}

impl Fixture {
    /// The first root, committed at the fixture's active epoch over the registry as it is now.
    fn commit_first_root(&mut self) {
        let root_ref = self.root_ref().clone();
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &root_ref,
            active_key_epoch: self.root_epoch,
            operation_id: "first-root",
        };
        commit_catalog_change(&mut StdFs, &mut self.provider, layout, commit).unwrap();
    }

    /// The next root, binding `live`. No producer of a bind exists in the crate yet, so the body is
    /// committed directly.
    fn bind(&mut self, live: &LiveMigration) {
        let root_ref = self.root_ref().clone();
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let catalog = load_catalog(&mut StdFs, &self.provider, layout)
            .unwrap()
            .unwrap();
        let root = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: live.operation_id.clone(),
                fencing_generation: live.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(live.clone()),
            ..catalog.root
        };
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &root_ref,
            held: &guard,
        };
        commit_root(&mut StdFs, &mut self.provider, layout, request).unwrap();
    }

    /// The journal in place and a root that binds it.
    fn bound(&mut self) {
        let live = self.store_journal();
        self.commit_first_root();
        self.bind(&live);
    }

    /// Whether `key` opens the stored rotation manifest, which only the source epoch's key does.
    fn opens_the_journal(&self, key: &Key) -> bool {
        let sealed = fs::read(generation_path(&self.journal_dir(), REVISION)).unwrap();
        let record = identity();
        let read = ManifestRead {
            record: &record,
            journal_revision: REVISION,
            key_epoch: SOURCE_EPOCH,
            envelope: &sealed,
        };
        JournalManifest::open(key, &read).is_ok()
    }
}

fn refusal(result: Result<Key, JournalRouteError>) -> JournalRouteError {
    result.err().expect("the route must be refused")
}

#[test]
fn every_usable_status_routes_to_the_journals_own_epoch_key() {
    for status in [
        KeyEpochStatus::Prepared,
        KeyEpochStatus::Active,
        KeyEpochStatus::RetiredRecoveryOnly,
    ] {
        // `Active` is the pre-cutover shape (root and registry at the source epoch); the others are
        // retained beside an `Active` target.
        let mut fixture = if status == KeyEpochStatus::Active {
            Fixture::pre_cutover()
        } else {
            Fixture::post_cutover(status)
        };
        fixture.bound();
        let key = fixture.route().unwrap_or_else(|_| panic!("{status:?}"));
        assert!(fixture.opens_the_journal(&key), "{status:?}");
    }
}

#[test]
fn after_cutover_the_bound_journal_resolves_under_its_source_epoch() {
    // The root points at the target epoch (route and active epoch 2), the source epoch is only
    // retained for recovery, and the journal is still bound.
    let mut fixture = Fixture::post_cutover(KeyEpochStatus::RetiredRecoveryOnly);
    fixture.bound();
    let root_dir = fixture.root_dir();
    let layout = RootLayout {
        root_dir: &root_dir,
    };
    let root = load_catalog(&mut StdFs, &fixture.provider, layout)
        .unwrap()
        .unwrap()
        .root;
    assert_eq!(root.active_key_epoch, TARGET_EPOCH);
    let key = fixture.route().unwrap_or_else(|_| panic!("routed"));
    assert!(fixture.opens_the_journal(&key));
}

#[test]
fn a_revoked_epoch_is_refused_whatever_older_generations_say() {
    // The newest generation of the epoch is the registry's word: Active at generation 1, Revoked at 2.
    let mut fixture = Fixture::new(TARGET_EPOCH);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    assert_eq!(
        refusal(fixture.route()),
        JournalRouteError::EpochRevoked(SOURCE_EPOCH)
    );
}

#[test]
fn an_unregistered_epoch_is_refused() {
    let mut fixture = Fixture::new(TARGET_EPOCH);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    assert_eq!(
        refusal(fixture.route()),
        JournalRouteError::EpochNotRegistered(SOURCE_EPOCH)
    );
}

#[test]
fn removing_the_newest_generation_does_not_expose_an_older_usable_record() {
    // The root commits the registry with the epoch Revoked; a storage attacker deleting that newest
    // generation would leave the older Active one as the newest, so the registry no longer hashes to
    // the root's set digest and the route refuses instead of returning the key.
    let mut fixture = Fixture::new(TARGET_EPOCH);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    fs::remove_file(generation_path(
        &fixture.root_dir().join("key-epoch").join("1"),
        2,
    ))
    .unwrap();
    assert!(matches!(
        refusal(fixture.route()),
        JournalRouteError::Registry(_)
    ));
}

#[test]
fn a_generation_promoted_without_its_root_commit_is_not_authority() {
    // A crash between promoting a registry generation and committing the root that names it leaves the
    // registry ahead of the root; the route does not follow it.
    let mut fixture = Fixture::pre_cutover();
    fixture.bound();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::RetiredRecoveryOnly, 2);
    assert!(matches!(
        refusal(fixture.route()),
        JournalRouteError::Registry(_)
    ));
}

#[test]
fn a_journal_the_binding_does_not_name_is_refused() {
    // The root binds a digest that is not the bytes in the journal directory.
    let mut fixture = Fixture::post_cutover(KeyEpochStatus::RetiredRecoveryOnly);
    let mut live = fixture.store_journal();
    live.manifest_digest = [0x11; 32];
    fixture.commit_first_root();
    fixture.bind(&live);
    assert_eq!(
        refusal(fixture.route()),
        JournalRouteError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::LiveBindingMismatch
        ))
    );
}

#[test]
fn a_missing_root_named_generation_needs_recovery() {
    let mut fixture = Fixture::post_cutover(KeyEpochStatus::RetiredRecoveryOnly);
    let live = fixture.store_journal();
    fixture.commit_first_root();
    fixture.bind(&live);
    fs::remove_file(generation_path(&fixture.journal_dir(), REVISION)).unwrap();
    assert_eq!(
        refusal(fixture.route()),
        JournalRouteError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::RecoveryRequired
        ))
    );
}

#[test]
fn nothing_is_routed_without_a_committed_root_or_a_bound_migration() {
    let mut fixture = Fixture::post_cutover(KeyEpochStatus::RetiredRecoveryOnly);
    fixture.store_journal();
    assert_eq!(refusal(fixture.route()), JournalRouteError::NoCommittedRoot);
    fixture.commit_first_root();
    assert_eq!(refusal(fixture.route()), JournalRouteError::NoLiveMigration);
}

#[test]
fn the_route_creates_and_changes_nothing() {
    let mut fixture = Fixture::post_cutover(KeyEpochStatus::RetiredRecoveryOnly);
    fixture.bound();
    let before = fixture.snapshot();
    assert!(fixture.route().is_ok());
    fs::remove_file(generation_path(&fixture.journal_dir(), REVISION)).unwrap();
    let after_removal = fixture.snapshot();
    assert!(fixture.route().is_err());
    assert_eq!(fixture.snapshot(), after_removal);
    assert_ne!(after_removal, before);
}

/// The next revision of the bound rotation, under the same owner and fence.
fn successor() -> JournalManifest {
    let mut next = rotation();
    next.journal_revision = REVISION + 1;
    next
}

impl Fixture {
    /// The successor sealed under the source epoch's key and stored as the next generation, with the
    /// binding that names it: the input a binding advance needs.
    fn store_successor(&self) -> LiveMigration {
        let next = successor();
        let meta = RecordMeta {
            key_epoch: SOURCE_EPOCH,
            record_generation: next.journal_revision,
            record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
        };
        let sealed = next.seal(&source_key(), &identity(), meta).unwrap();
        fs::write(
            generation_path(&self.journal_dir(), next.journal_revision),
            &sealed,
        )
        .unwrap();
        LiveMigration {
            operation_id: OPERATION.into(),
            fencing_generation: next.fencing_generation,
            journal_revision: next.journal_revision,
            manifest_digest: content_digest(&sealed),
        }
    }

    /// The four composed journal operations over valid inputs for each (a checkpoint and a capture of
    /// the next revision, a takeover claim by a new owner at fence plus one, an advance to the stored
    /// successor): each is expected to be refused, and the error of each is returned, in that order.
    fn every_operation_is_refused(&mut self, stored: &LiveMigration) -> Vec<AuthorityError> {
        let root_ref = self.root_ref().clone();
        let root_epoch = self.root_epoch;
        let root_dir = self.root_dir();
        let journal_dir = self.journal_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let committed = rotation();
        let next = successor();
        let fence = MigrationFence::from_manifest(&next);
        let mut claim = successor();
        claim.fencing_generation += 1;
        claim.has_lease_owner = true;
        claim.lease_owner_id = Some("new-owner".into());
        claim.lease_expires_unix_ms = Some(u64::MAX / 2);
        let claim_fence = MigrationFence::from_manifest(&claim);
        let operation = WriteOperationId::generate().unwrap();
        let journal = JournalSource {
            dir: &journal_dir,
            operation: &operation,
        };
        let checkpoint = JournalCheckpoint {
            manifest: &next,
            fence: &fence,
            journal,
            root_key_ref: &root_ref,
            active_key_epoch: root_epoch,
            conflict: CandidateConflict::Refuse,
        };
        let takeover = JournalCheckpoint {
            manifest: &claim,
            fence: &claim_fence,
            ..checkpoint
        };
        let provider = &mut self.provider;
        vec![
            commit_journal_checkpoint(&mut StdFs, provider, layout, checkpoint).unwrap_err(),
            commit_journal_takeover(
                &mut StdFs,
                provider,
                layout,
                JournalTakeoverCommit {
                    claim: takeover,
                    now_unix_ms: 0,
                },
            )
            .unwrap_err(),
            commit_inventory_capture(
                &mut StdFs,
                provider,
                layout,
                InventoryCapture {
                    checkpoint,
                    committed_manifest: &committed,
                    pages: &[],
                },
            )
            .unwrap_err(),
            advance_live_migration(
                &mut StdFs,
                provider,
                layout,
                BindingAdvance {
                    next: stored,
                    journal,
                    root_key_ref: &root_ref,
                    active_key_epoch: root_epoch,
                },
            )
            .unwrap_err(),
        ]
    }
}

#[test]
fn a_revoked_journal_epoch_refuses_every_journal_operation_before_a_write() {
    let mut fixture = Fixture::new(TARGET_EPOCH);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    let stored = fixture.store_successor();
    let before = fixture.snapshot();
    for error in fixture.every_operation_is_refused(&stored) {
        assert_eq!(
            error,
            AuthorityError::JournalRoute(JournalRouteError::EpochRevoked(SOURCE_EPOCH))
        );
    }
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn an_unregistered_journal_epoch_refuses_every_journal_operation_before_a_write() {
    let mut fixture = Fixture::new(TARGET_EPOCH);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    let stored = fixture.store_successor();
    let before = fixture.snapshot();
    for error in fixture.every_operation_is_refused(&stored) {
        assert_eq!(
            error,
            AuthorityError::JournalRoute(JournalRouteError::EpochNotRegistered(SOURCE_EPOCH))
        );
    }
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn a_route_to_another_key_is_refused_by_the_authenticated_load_before_a_write() {
    // The registry routes the source epoch to a key the journal was not sealed under: the route
    // itself resolves, but the manifest of the bound journal does not authenticate under it.
    let mut fixture = Fixture::with_source_material(TARGET_EPOCH, [0x55; 32]);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::RetiredRecoveryOnly, 1);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    fixture.bound();
    let stored = fixture.store_successor();
    let before = fixture.snapshot();
    // Every operation has valid inputs, so the key is the only thing left to refuse them.
    for error in fixture.every_operation_is_refused(&stored) {
        assert_eq!(
            error,
            AuthorityError::Journal(JournalDurableError::Journal(JournalError::Open(
                OpenError::Tampered
            )))
        );
    }
    assert_eq!(fixture.snapshot(), before);
}
