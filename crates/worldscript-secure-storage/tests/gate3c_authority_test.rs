//! Gate 3 slice 3C part 3c-2a: the persisted record catalog under the authority root (§5.5,
//! §5.5.1) — page persistence, root-verified loading, `list_records` and catalog commits.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::PageAddress;
use worldscript_secure_storage::{
    catalog_set_digest, commit_catalog_change, commit_root, list_records, load_catalog,
    write_key_epoch, AuthorityError, CatalogChange, CatalogCommit, CatalogDescriptor,
    CatalogRecoveryReason, CatalogShard, CommitMarker, CommittedGeneration, InstallationScopeId,
    KeyEpochCommit, KeyEpochRecord, KeyEpochStatus, KeyProvider, LoadedCatalog, MarkerBody,
    RecordClass, RecordIdentity, RootBody, RootCommitEvidence, RootCommitRequest, RootCommitState,
    RootKeyRefV1, RootLayout, RootRecoveryReason, RootStoreError, StdFs,
};

/// A fresh temporary root directory, cleared first and removed by `Drop for Fixture`.
fn temp_root() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "wss-gate3c-authority-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

fn codex(project: &str) -> RecordIdentity {
    RecordIdentity::new(RecordClass::Codex, &[project]).unwrap()
}

/// An `ACTIVE` descriptor whose marker generation is `marker_generation`.
fn active(record: &RecordIdentity, marker_generation: u64) -> CatalogDescriptor {
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    };
    let marker = CommitMarker::new(record, marker_generation, body).unwrap();
    let readable = CommittedGeneration {
        generation: 1,
        epoch: 1,
        content_digest: [0xab; 32],
    };
    CatalogDescriptor::new_unverified(record, &marker, Some(readable)).unwrap()
}

/// A provisioned, unlocked provider with an epoch-1 `ACTIVE` key-epoch record and both root slots.
struct Fixture {
    root_dir: PathBuf,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    key_ref: RootKeyRefV1,
    next_operation: u32,
}

impl Fixture {
    fn new() -> Self {
        let root_dir = temp_root().join("authority");
        for slot in ["slot-a", "slot-b"] {
            fs::create_dir_all(root_dir.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
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
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        write_key_epoch(&mut StdFs, &provider, layout, commit).unwrap();
        Fixture {
            root_dir,
            provider,
            scope,
            key_ref,
            next_operation: 0,
        }
    }

    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.root_dir,
        }
    }

    fn change(
        &mut self,
        upsert: &[CatalogDescriptor],
        remove: &[RecordIdentity],
    ) -> Result<u64, AuthorityError> {
        self.next_operation += 1;
        let operation_id = format!("catalog-op-{}", self.next_operation);
        let root_dir = self.root_dir.clone();
        let commit = CatalogCommit {
            change: CatalogChange { upsert, remove },
            root_key_ref: &self.key_ref,
            active_key_epoch: 1,
            operation_id: &operation_id,
        };
        commit_catalog_change(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            commit,
        )
        .map(|committed| committed.root_generation)
    }

    fn load(&self) -> Result<Option<LoadedCatalog>, AuthorityError> {
        load_catalog(&mut StdFs, &self.provider, self.layout())
    }

    fn loaded(&self) -> LoadedCatalog {
        self.load().unwrap().unwrap()
    }

    fn list(&self) -> Vec<CatalogDescriptor> {
        list_records(&mut StdFs, &self.provider, self.layout()).unwrap()
    }

    fn shard_dir(&self, shard_id: u32) -> PathBuf {
        self.root_dir.join("catalog").join(shard_id.to_string())
    }

    fn page_file(&self, shard_id: u32, generation: u64) -> PathBuf {
        self.shard_dir(shard_id)
            .join(format!("generation-{generation}.wsr1"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(parent) = self.root_dir.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}

/// `(shard_id, catalog_generation, descriptor_count)` of every committed shard.
fn shape(catalog: &LoadedCatalog) -> Vec<(u32, u64, usize)> {
    catalog
        .shards
        .iter()
        .map(|committed| {
            (
                committed.shard.shard_id,
                committed.shard.catalog_generation,
                committed.page.descriptors().len(),
            )
        })
        .collect()
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn recovery(reason: CatalogRecoveryReason) -> AuthorityError {
    AuthorityError::RecoveryRequired(reason)
}

#[test]
fn nothing_is_catalogued_before_the_first_root() {
    let fixture = Fixture::new();
    assert_eq!(fixture.load(), Ok(None));
    assert!(fixture.list().is_empty());
}

#[test]
fn a_change_commits_pages_and_the_root_that_names_them() {
    let mut fixture = Fixture::new();
    let descriptors = [active(&settings(), 1), active(&codex("p1"), 1)];
    assert_eq!(fixture.change(&descriptors, &[]), Ok(1));
    let catalog = fixture.loaded();
    assert_eq!(catalog.root.root_generation, 1);
    // settings -> shard 85, codex:p1 -> shard 228 (the catalog-page shard vectors).
    assert_eq!(shape(&catalog), vec![(85, 1, 1), (228, 1, 1)]);
    let listed = fixture.list();
    assert_eq!(listed.len(), 2);
    assert!(listed.contains(&descriptors[0]) && listed.contains(&descriptors[1]));
}

#[test]
fn a_page_generation_is_the_root_generation_that_publishes_it() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    // codex:p2 -> shard 39; shard 85 keeps its generation-1 page.
    assert_eq!(fixture.change(&[active(&codex("p2"), 1)], &[]), Ok(2));
    assert_eq!(shape(&fixture.loaded()), vec![(39, 2, 1), (85, 1, 1)]);
    assert_eq!(names(&fixture.shard_dir(85)), vec!["generation-1.wsr1"]);
}

#[test]
fn an_upsert_replaces_the_same_records_descriptor() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&codex("p1"), 1)], &[]).unwrap();
    let replaced = active(&codex("p1"), 2);
    fixture
        .change(std::slice::from_ref(&replaced), &[])
        .unwrap();
    assert_eq!(fixture.list(), vec![replaced]);
}

#[test]
fn an_emptied_shard_keeps_a_zero_descriptor_page() {
    let mut fixture = Fixture::new();
    fixture
        .change(&[active(&settings(), 1), active(&codex("p1"), 1)], &[])
        .unwrap();
    assert_eq!(fixture.change(&[], &[settings()]), Ok(2));
    assert_eq!(shape(&fixture.loaded()), vec![(85, 2, 0), (228, 1, 1)]);
    assert_eq!(fixture.list(), vec![active(&codex("p1"), 1)]);
}

#[test]
fn a_refused_change_writes_nothing() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    assert_eq!(
        fixture.change(&[], &[codex("p1")]),
        Err(AuthorityError::NotCatalogued)
    );
    assert_eq!(
        fixture.change(&[active(&codex("p1"), 1)], &[codex("p1")]),
        Err(AuthorityError::DuplicateChange)
    );
    let catalog = fixture.loaded();
    assert_eq!(catalog.root.root_generation, 1);
    assert!(!fixture.shard_dir(228).exists());
    assert_eq!(names(&fixture.shard_dir(85)), vec!["generation-1.wsr1"]);
}

#[test]
fn pages_of_an_uncommitted_change_are_ignored_then_relocated() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    // The pages are written, then the root never prepares: the prior root stays authority.
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    assert!(matches!(
        fixture.change(&[active(&codex("p1"), 1)], &[settings()]),
        Err(AuthorityError::Root(RootStoreError::Anchor(_)))
    ));
    assert!(fixture.page_file(228, 2).exists());
    assert_eq!(shape(&fixture.loaded()), vec![(85, 1, 1)]);
    assert_eq!(fixture.list(), vec![active(&settings(), 1)]);

    // The next change moves the leftovers aside (never deleting them) before writing generation 2.
    assert_eq!(fixture.change(&[active(&codex("p2"), 1)], &[]), Ok(2));
    assert_eq!(shape(&fixture.loaded()), vec![(39, 2, 1), (85, 1, 1)]);
    let shard_228 = names(&fixture.shard_dir(228));
    assert_eq!(shard_228.len(), 1);
    assert!(shard_228[0].starts_with("generation-2.wsr1.rejected-"));
    assert!(names(&fixture.shard_dir(85))
        .iter()
        .any(|name| name.contains(".rejected-")));
}

#[test]
fn a_tampered_page_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    let path = fixture.page_file(85, 1);
    let mut bytes = fs::read(&path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    fs::write(&path, bytes).unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}

#[test]
fn a_replayed_older_page_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&codex("p1"), 1)], &[]).unwrap();
    // codex:p18 shares shard 228 with codex:p1.
    fixture.change(&[active(&codex("p18"), 1)], &[]).unwrap();
    fs::remove_file(fixture.page_file(228, 2)).unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}

#[test]
fn a_removed_shard_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture
        .change(&[active(&settings(), 1), active(&codex("p1"), 1)], &[])
        .unwrap();
    fs::remove_dir_all(fixture.shard_dir(85)).unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}

#[test]
fn an_unexpected_catalog_entry_is_recovery_required() {
    for name in ["007", "256", "notes"] {
        let mut fixture = Fixture::new();
        fixture.change(&[active(&settings(), 1)], &[]).unwrap();
        fs::create_dir_all(fixture.root_dir.join("catalog").join(name)).unwrap();
        assert_eq!(
            fixture.load(),
            Err(recovery(CatalogRecoveryReason::CatalogSetMismatch)),
            "{name}"
        );
    }
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    fs::write(fixture.shard_dir(85).join("stray"), b"x").unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}

#[test]
fn a_root_whose_marker_set_disagrees_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    let catalog = fixture.loaded();
    let shards: Vec<CatalogShard> = catalog.shards.iter().map(|c| c.shard).collect();
    let root = RootBody {
        root_generation: 2,
        marker_set_digest: [0x5a; 32],
        catalog_set_digest: catalog_set_digest(&shards).unwrap(),
        commit_evidence: RootCommitEvidence {
            operation_id: "forged-markers".to_owned(),
            fencing_generation: 0,
            state: RootCommitState::Committed,
        },
        ..catalog.root
    };
    let root_dir = fixture.root_dir.clone();
    let request = RootCommitRequest {
        scope: &fixture.scope,
        root: &root,
        root_key_ref: &fixture.key_ref,
    };
    commit_root(
        &mut StdFs,
        &mut fixture.provider,
        RootLayout {
            root_dir: &root_dir,
        },
        request,
    )
    .unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::MarkerSetMismatch))
    );
}

#[test]
fn a_commit_that_commit_root_would_refuse_writes_no_page() {
    let mut fixture = Fixture::new();
    let root_dir = fixture.root_dir.clone();
    let upsert = [active(&settings(), 1)];
    let mut commit = CatalogCommit {
        change: CatalogChange {
            upsert: &upsert,
            remove: &[],
        },
        root_key_ref: &fixture.key_ref.clone(),
        // No KEY_EPOCH_ACTIVE record exists for epoch 2.
        active_key_epoch: 2,
        operation_id: "catalog-op-epoch",
    };
    let layout = RootLayout {
        root_dir: &root_dir,
    };
    assert_eq!(
        commit_catalog_change(&mut StdFs, &mut fixture.provider, layout, commit),
        Err(AuthorityError::Root(RootStoreError::RecoveryRequired(
            RootRecoveryReason::ActiveEpochNotBound
        )))
    );
    commit.active_key_epoch = 1;
    commit.operation_id = "";
    assert_eq!(
        commit_catalog_change(&mut StdFs, &mut fixture.provider, layout, commit),
        Err(AuthorityError::InvalidOperationId)
    );
    assert!(!root_dir.join("catalog").exists());
    assert_eq!(fixture.load(), Ok(None));
}

#[test]
fn a_page_sealed_under_another_epoch_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    let catalog = fixture.loaded();
    let key = fixture.provider.resolve_ref(&fixture.key_ref).unwrap();
    let address = PageAddress {
        scope: &fixture.scope,
        shard_id: 85,
        catalog_generation: 1,
    };
    let resealed = catalog.shards[0].page.seal(&key, &address, 2).unwrap();
    fs::write(fixture.page_file(85, 1), resealed).unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}

#[test]
fn a_file_where_a_shard_directory_belongs_is_recovery_required() {
    let mut fixture = Fixture::new();
    fixture.change(&[active(&settings(), 1)], &[]).unwrap();
    fs::write(fixture.root_dir.join("catalog").join("7"), b"x").unwrap();
    assert_eq!(
        fixture.load(),
        Err(recovery(CatalogRecoveryReason::CatalogSetMismatch))
    );
}
