//! The preconfigured authority the admission fixtures start from: an installation scope, a key-epoch
//! registry and a first catalog, optionally bound to a live migration, holding a record page, locked,
//! or with an interrupted root commit pending. Test-only; the provider is the in-memory one.

use std::path::Path;

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::*;

/// What the preconfigured tree and provider look like when the storage is built.
#[derive(Default)]
pub struct Setup {
    /// The committed root binds this live migration (committed before the storage exists).
    pub bound: Option<LiveMigration>,
    /// The key provider is locked when the storage is built.
    pub locked: bool,
    /// The catalog holds one record, so that it has a page on disk.
    pub page: bool,
    /// After the (bound) root, a further root commit is interrupted at the anchor commit, leaving a
    /// durable preparation for the next operation's root recovery to resolve.
    pub interrupted: bool,
}

/// The catalog descriptor of one record that is committed and readable, so that it has a page.
fn one_record_descriptor() -> CatalogDescriptor {
    let record = RecordIdentity::new(RecordClass::Codex, &["a-record"]).unwrap();
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    };
    let marker = CommitMarker::new(&record, 1, body).unwrap();
    let readable = CommittedGeneration {
        generation: 1,
        epoch: 1,
        content_digest: [0xab; 32],
    };
    CatalogDescriptor::new_unverified(&record, &marker, Some(readable)).unwrap()
}

pub fn configured_provider(base: &Path, root: &Path, setup: &Setup) -> MemoryKeyProvider {
    let mut provider = MemoryKeyProvider::new();
    let scope = provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    // Test-only preconfigured authority, not first enable (which remains Gate 4E).
    let mut exclusive = ExclusiveAdmissionGuard::try_acquire(AdmissionScope {
        installation_dir: base,
        root_dir: root,
    })
    .unwrap()
    .unwrap();
    let event = exclusive.try_root_commit().unwrap().unwrap();
    write_key_epoch(
        &mut StdFs,
        &provider,
        RootLayout { root_dir: root },
        KeyEpochCommit {
            scope: &scope,
            record: &KeyEpochRecord {
                epoch: 1,
                status: KeyEpochStatus::Active,
                root_key_ref: route.clone(),
            },
            registry_generation: 1,
            root_key_ref: &route,
            key_epoch: 1,
            held: event.root_guard().unwrap(),
        },
    )
    .unwrap();
    drop(event);
    let descriptors = if setup.page {
        vec![one_record_descriptor()]
    } else {
        Vec::new()
    };
    commit_catalog_change(
        &mut StdFs,
        &mut provider,
        RootLayout { root_dir: root },
        CatalogCommit {
            change: CatalogChange {
                upsert: &descriptors,
                remove: &[],
            },
            root_key_ref: &route,
            active_key_epoch: 1,
            operation_id: "fixture-bootstrap",
        },
    )
    .unwrap();
    if let Some(live) = &setup.bound {
        // No producer of a bind exists in the crate yet, so the next root is committed directly.
        let layout = RootLayout { root_dir: root };
        let catalog = load_catalog(&mut StdFs, &provider, layout)
            .unwrap()
            .unwrap();
        let body = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: live.operation_id.clone(),
                fencing_generation: live.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(live.clone()),
            ..catalog.root
        };
        let event = exclusive.try_root_commit().unwrap().unwrap();
        commit_root(
            &mut StdFs,
            &mut provider,
            layout,
            RootCommitRequest {
                scope: &scope,
                root: &body,
                root_key_ref: &route,
                held: event.root_guard().unwrap(),
            },
        )
        .unwrap();
        drop(event);
    }
    if setup.interrupted {
        // A further ordinary root commit that stops at the anchor commit: the preparation is durable,
        // the committed root is still the previous one.
        provider.inject(Fault::BeforePersist(AnchorOp::Commit));
        let interrupted = commit_catalog_change(
            &mut StdFs,
            &mut provider,
            RootLayout { root_dir: root },
            CatalogCommit {
                change: CatalogChange {
                    upsert: &[],
                    remove: &[],
                },
                root_key_ref: &route,
                active_key_epoch: 1,
                operation_id: "fixture-interrupted",
            },
        );
        assert!(interrupted.is_err(), "the commit must stop at the anchor");
        assert!(
            provider
                .read_root_anchor_state()
                .unwrap()
                .prepared_root_commit
                .is_some(),
            "the interrupted commit leaves a durable preparation"
        );
    }
    drop(exclusive);
    provider
}
