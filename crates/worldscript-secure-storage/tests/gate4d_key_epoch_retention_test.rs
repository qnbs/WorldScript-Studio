//! Gate 4D Slice D2b-1: no key-epoch revocation while the committed root binds a live migration
//! (§8.3, §10.1.1). The bound journal is sealed under the migration's source epoch, which must stay
//! resolvable until the binding is cleared.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    commit_catalog_change, commit_root, load_catalog, write_key_epoch, CatalogChange,
    CatalogCommit, InstallationScopeId, KeyEpochCommit, KeyEpochEntry, KeyEpochRecord,
    KeyEpochStatus, KeyProvider, LiveMigration, RootBody, RootCommitEvidence, RootCommitGuard,
    RootCommitRequest, RootCommitState, RootKeyRefV1, RootLayout, RootStoreError, StdFs,
};

const SOURCE_EPOCH: u64 = 1;
const TARGET_EPOCH: u64 = 2;

/// A directory this test created: `create_dir` fails when the path already exists, so a leftover of
/// an earlier process with the same id is skipped, never reused or removed.
fn temp_base() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    loop {
        let base = std::env::temp_dir().join(format!(
            "wss-gate4d-retention-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        if fs::create_dir(&base).is_ok() {
            return base;
        }
    }
}

fn binding() -> LiveMigration {
    LiveMigration {
        operation_id: "retention-op".into(),
        fencing_generation: 4,
        journal_revision: 0,
        manifest_digest: [0x11; 32],
    }
}

/// A rotation from epoch 1 (`ACTIVE`) to epoch 2 (`PREPARED`), each with a generation-1 record and
/// its own key route; the records are sealed under the epoch-1 route, which is also the root's.
struct Fixture {
    base: PathBuf,
    root_dir: PathBuf,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    source_ref: RootKeyRefV1,
    target_ref: RootKeyRefV1,
}

impl Fixture {
    fn new() -> Self {
        let base = temp_base();
        let root_dir = base.join("authority");
        for slot in ["slot-a", "slot-b"] {
            fs::create_dir_all(root_dir.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let source_ref = provider.provision_epoch_key(SOURCE_EPOCH).unwrap();
        let target_ref = provider.provision_epoch_key(TARGET_EPOCH).unwrap();
        provider.unlock().unwrap();
        let fixture = Fixture {
            base,
            root_dir,
            provider,
            scope,
            source_ref,
            target_ref,
        };
        fixture
            .write(SOURCE_EPOCH, KeyEpochStatus::Active, 1)
            .unwrap();
        fixture
            .write(TARGET_EPOCH, KeyEpochStatus::Prepared, 1)
            .unwrap();
        fixture
    }

    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.root_dir,
        }
    }

    fn write(
        &self,
        epoch: u64,
        status: KeyEpochStatus,
        registry_generation: u64,
    ) -> Result<KeyEpochEntry, RootStoreError> {
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
        let guard = RootCommitGuard::acquire(&self.root_dir).unwrap();
        let commit = KeyEpochCommit {
            scope: &self.scope,
            record: &record,
            registry_generation,
            root_key_ref: &self.source_ref,
            key_epoch: SOURCE_EPOCH,
            held: &guard,
        };
        write_key_epoch(&mut StdFs, &self.provider, self.layout(), commit)
    }

    /// The first ordinary root, naming no migration.
    fn commit_first_root(&mut self) {
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &self.source_ref,
            active_key_epoch: SOURCE_EPOCH,
            operation_id: "first-root",
        };
        let root_dir = self.root_dir.clone();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        commit_catalog_change(&mut StdFs, &mut self.provider, layout, commit).unwrap();
    }

    /// The next root, binding `live` (`None` clears the binding). No producer of bind or clear
    /// exists in the crate yet, so the test commits the root body directly.
    fn commit_binding(&mut self, live: Option<LiveMigration>) {
        let catalog = load_catalog(&mut StdFs, &self.provider, self.layout())
            .unwrap()
            .unwrap();
        let evidence = RootCommitEvidence {
            operation_id: live
                .as_ref()
                .map_or("clear-root".to_string(), |live| live.operation_id.clone()),
            fencing_generation: live.as_ref().map_or(0, |live| live.fencing_generation),
            state: RootCommitState::Committed,
        };
        let root = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: evidence,
            live_migration: live,
            ..catalog.root
        };
        let root_dir = self.root_dir.clone();
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &self.source_ref,
            held: &guard,
        };
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        commit_root(&mut StdFs, &mut self.provider, layout, request).unwrap();
    }

    fn generations(&self, epoch: u64) -> Vec<String> {
        let mut names: Vec<String> =
            fs::read_dir(self.root_dir.join("key-epoch").join(epoch.to_string()))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
        names.sort();
        names
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

#[test]
fn a_revocation_is_refused_while_a_live_migration_is_bound() {
    let mut fixture = Fixture::new();
    fixture.commit_first_root();
    fixture.commit_binding(Some(binding()));
    let source_before = fixture.generations(SOURCE_EPOCH);
    let refused = fixture.write(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2);
    assert_eq!(
        refused.unwrap_err(),
        RootStoreError::RevocationWhileMigrationBound
    );
    // Nothing was created: the generation chain of the source epoch is exactly what it was.
    assert_eq!(fixture.generations(SOURCE_EPOCH), source_before);
}

#[test]
fn the_refusal_is_not_limited_to_the_source_epoch() {
    // The binding does not name the journal's epoch, so every new revocation is refused.
    let mut fixture = Fixture::new();
    fixture.commit_first_root();
    fixture.commit_binding(Some(binding()));
    let refused = fixture.write(TARGET_EPOCH, KeyEpochStatus::Revoked, 2);
    assert_eq!(
        refused.unwrap_err(),
        RootStoreError::RevocationWhileMigrationBound
    );
    assert_eq!(fixture.generations(TARGET_EPOCH), ["generation-1.wsr1"]);
}

#[test]
fn a_retirement_is_still_written_while_a_live_migration_is_bound() {
    let mut fixture = Fixture::new();
    fixture.commit_first_root();
    fixture.commit_binding(Some(binding()));
    fixture
        .write(SOURCE_EPOCH, KeyEpochStatus::RetiredRecoveryOnly, 2)
        .unwrap();
    fixture
        .write(TARGET_EPOCH, KeyEpochStatus::Active, 2)
        .unwrap();
    assert_eq!(fixture.generations(SOURCE_EPOCH).len(), 2);
}

#[test]
fn a_revocation_is_written_once_the_binding_is_cleared() {
    let mut fixture = Fixture::new();
    fixture.commit_first_root();
    fixture.commit_binding(Some(binding()));
    fixture.commit_binding(None);
    fixture
        .write(SOURCE_EPOCH, KeyEpochStatus::Revoked, 2)
        .unwrap();
    assert_eq!(fixture.generations(SOURCE_EPOCH).len(), 2);
}

#[test]
fn a_revocation_is_written_when_no_migration_was_ever_bound() {
    let mut fixture = Fixture::new();
    // Before any root exists, and again under an ordinary root.
    fixture
        .write(TARGET_EPOCH, KeyEpochStatus::Revoked, 2)
        .unwrap();
    fixture.commit_first_root();
    fixture
        .write(TARGET_EPOCH, KeyEpochStatus::Revoked, 3)
        .unwrap();
    assert_eq!(fixture.generations(TARGET_EPOCH).len(), 3);
}
