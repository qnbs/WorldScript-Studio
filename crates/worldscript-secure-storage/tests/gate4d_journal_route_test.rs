//! Gate 4D Slice D2b-3a: the key route of a bound migration journal (§6, §8.3, §10.1.1). The journal
//! of a rotation is sealed under its source epoch's key; the route finds that key through the root
//! binding and the authenticated key-epoch registry, never through the root's active epoch.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    commit_catalog_change, commit_root, content_digest, empty_inventory_digest,
    empty_journal_page_set_digest, generation_path, load_catalog, operation_type, phase_code,
    resolve_journal_key, write_key_epoch, CatalogChange, CatalogCommit, InstallationScopeId,
    JournalDurableError, JournalManifest, JournalRoute, JournalRouteError, Key, KeyEpochCommit,
    KeyEpochRecord, KeyEpochStatus, KeyProvider, LiveMigration, ManifestRead,
    MigrationExecutionError, RecordClass, RecordIdentity, RecordMeta, RootBody, RootCommitEvidence,
    RootCommitGuard, RootCommitRequest, RootCommitState, RootKeyRefV1, RootLayout, StdFs,
    JOURNAL_MANIFEST_RECORD_SCHEMA,
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
/// registry records are sealed under the epoch-2 route, which is also the root's.
struct Fixture {
    base: Dir,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    source_ref: RootKeyRefV1,
    root_ref: RootKeyRefV1,
}

impl Fixture {
    fn new() -> Self {
        let base = Dir::new();
        for slot in ["authority/slot-a", "authority/slot-b", "journal"] {
            fs::create_dir_all(base.0.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let source_ref = provider
            .import_epoch_key(SOURCE_EPOCH, SOURCE_MATERIAL)
            .unwrap();
        let root_ref = provider
            .import_epoch_key(TARGET_EPOCH, TARGET_MATERIAL)
            .unwrap();
        provider.unlock().unwrap();
        Fixture {
            base,
            provider,
            scope,
            source_ref,
            root_ref,
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
            &self.root_ref
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
            root_key_ref: &self.root_ref,
            key_epoch: TARGET_EPOCH,
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

    fn route(&self, live: &LiveMigration) -> Result<Key, JournalRouteError> {
        let root_dir = self.root_dir();
        let journal_dir = self.journal_dir();
        resolve_journal_key(
            &mut StdFs,
            &self.provider,
            JournalRoute {
                layout: RootLayout {
                    root_dir: &root_dir,
                },
                scope: &self.scope,
                root_key_ref: &self.root_ref,
                journal_dir: &journal_dir,
                live,
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
    /// The first root, committed with the target epoch as its active epoch and route, then a root
    /// that binds `live`. No producer of a bind exists in the crate yet, so the body is committed
    /// directly.
    fn commit_root_at_target_epoch(&mut self, live: &LiveMigration) {
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &self.root_ref,
            active_key_epoch: TARGET_EPOCH,
            operation_id: "first-root",
        };
        commit_catalog_change(&mut StdFs, &mut self.provider, layout, commit).unwrap();
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
            root_key_ref: &self.root_ref,
            held: &guard,
        };
        commit_root(&mut StdFs, &mut self.provider, layout, request).unwrap();
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
        let fixture = Fixture::new();
        fixture.register(SOURCE_EPOCH, status, 1);
        fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
        let live = fixture.store_journal();
        let key = fixture
            .route(&live)
            .unwrap_or_else(|_| panic!("{status:?}"));
        assert!(fixture.opens_the_journal(&key), "{status:?}");
    }
}

#[test]
fn a_revoked_epoch_is_refused_whatever_older_generations_say() {
    // The newest generation of the epoch is the registry's word: Active at generation 1, Revoked at 2.
    let fixture = Fixture::new();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    let live = fixture.store_journal();
    assert_eq!(
        refusal(fixture.route(&live)),
        JournalRouteError::EpochRevoked(SOURCE_EPOCH)
    );
}

#[test]
fn an_unregistered_epoch_is_refused() {
    let fixture = Fixture::new();
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    let live = fixture.store_journal();
    assert_eq!(
        refusal(fixture.route(&live)),
        JournalRouteError::EpochNotRegistered(SOURCE_EPOCH)
    );
}

#[test]
fn after_cutover_the_bound_journal_resolves_under_its_source_epoch() {
    // The root already points at the target epoch (route and active epoch 2), the source epoch is
    // only retained for recovery, and the journal is still bound.
    let mut fixture = Fixture::new();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::RetiredRecoveryOnly, 1);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    let live = fixture.store_journal();
    fixture.commit_root_at_target_epoch(&live);
    let root_dir = fixture.root_dir();
    let layout = RootLayout {
        root_dir: &root_dir,
    };
    let root = load_catalog(&mut StdFs, &fixture.provider, layout)
        .unwrap()
        .unwrap()
        .root;
    assert_eq!(root.active_key_epoch, TARGET_EPOCH);
    assert_eq!(root.live_migration.as_ref(), Some(&live));
    let key = fixture.route(&live).unwrap_or_else(|_| panic!("routed"));
    assert!(fixture.opens_the_journal(&key));
}

#[test]
fn a_generation_the_root_did_not_name_is_refused_before_the_registry_is_read() {
    // A record directory that cannot be read would make the registry fail; the digest is judged first.
    let fixture = Fixture::new();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    let mut live = fixture.store_journal();
    live.manifest_digest = [0x11; 32];
    let broken = fixture.root_dir().join("key-epoch").join("9");
    fs::create_dir_all(&broken).unwrap();
    fs::write(broken.join("generation-1.wsr1"), b"not a record").unwrap();
    assert_eq!(
        refusal(fixture.route(&live)),
        JournalRouteError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::LiveBindingMismatch
        ))
    );
}

#[test]
fn a_missing_root_named_generation_needs_recovery() {
    let fixture = Fixture::new();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    let live = LiveMigration {
        operation_id: OPERATION.into(),
        fencing_generation: 4,
        journal_revision: REVISION,
        manifest_digest: [0x22; 32],
    };
    assert_eq!(
        refusal(fixture.route(&live)),
        JournalRouteError::Journal(JournalDurableError::Authority(
            MigrationExecutionError::RecoveryRequired
        ))
    );
}

#[test]
fn the_route_creates_and_changes_nothing() {
    let fixture = Fixture::new();
    fixture.register(SOURCE_EPOCH, KeyEpochStatus::Active, 1);
    fixture.register(TARGET_EPOCH, KeyEpochStatus::Active, 1);
    let live = fixture.store_journal();
    let before = fixture.snapshot();
    assert!(fixture.route(&live).is_ok());
    let mut stale = live.clone();
    stale.manifest_digest = [0x11; 32];
    assert!(fixture.route(&stale).is_err());
    assert_eq!(fixture.snapshot(), before);
}
