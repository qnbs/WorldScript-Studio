//! The preconfigured authority the admission fixtures start from: an installation scope, a key-epoch
//! registry and a first catalog, optionally bound to a live migration, holding a record page, locked,
//! or with an interrupted root commit pending. Test-only; the provider is the in-memory one.

use std::path::Path;

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::*;

/// Where an interrupted root commit stopped.
#[derive(Clone, Copy)]
pub enum Interruption {
    /// At the anchor commit, after the target slot and the pointer were written: the root's recovery
    /// completes the commit.
    AtAnchorCommit,
    /// Right after the preparation was persisted, before any slot was written: the root's recovery
    /// discards it.
    AfterPrepare,
}

/// What the preconfigured tree and provider look like when the storage is built.
#[derive(Default)]
pub struct Setup {
    /// The committed root binds this live migration (committed before the storage exists).
    pub bound: Option<LiveMigration>,
    /// The key provider is locked when the storage is built.
    pub locked: bool,
    /// The catalog holds one record, so that it has a page on disk.
    pub page: bool,
    /// After the (bound) root, a further ordinary root commit is interrupted here, leaving a durable
    /// preparation for the next operation's root recovery to resolve.
    pub interrupted: Option<Interruption>,
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

/// The authority being built: where its root lives and the scope and key route its roots name.
struct Authority<'a> {
    root: &'a Path,
    scope: InstallationScopeId,
    route: RootKeyRefV1,
}

impl Authority<'_> {
    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: self.root,
        }
    }

    /// The registry's first generation: epoch 1, active, under the authority's route.
    fn register_epoch(
        &self,
        provider: &MemoryKeyProvider,
        exclusive: &mut ExclusiveAdmissionGuard,
    ) {
        let event = exclusive.try_root_commit().unwrap().unwrap();
        write_key_epoch(
            &mut StdFs,
            provider,
            self.layout(),
            KeyEpochCommit {
                scope: &self.scope,
                record: &KeyEpochRecord {
                    epoch: 1,
                    status: KeyEpochStatus::Active,
                    root_key_ref: self.route.clone(),
                },
                registry_generation: 1,
                root_key_ref: &self.route,
                key_epoch: 1,
                held: event.root_guard().unwrap(),
            },
        )
        .unwrap();
    }

    /// An ordinary catalog commit, naming `operation_id`, that upserts `descriptors`.
    fn commit_catalog(
        &self,
        provider: &mut MemoryKeyProvider,
        descriptors: &[CatalogDescriptor],
        operation_id: &str,
    ) -> Result<RootCommitted, AuthorityError> {
        commit_catalog_change(
            &mut StdFs,
            provider,
            self.layout(),
            CatalogCommit {
                change: CatalogChange {
                    upsert: descriptors,
                    remove: &[],
                },
                root_key_ref: &self.route,
                active_key_epoch: 1,
                operation_id,
            },
        )
    }

    /// The next root, binding `live`. No producer of a bind exists in the crate yet, so the root
    /// is committed directly.
    fn bind(
        &self,
        provider: &mut MemoryKeyProvider,
        exclusive: &mut ExclusiveAdmissionGuard,
        live: &LiveMigration,
    ) {
        let catalog = load_catalog(&mut StdFs, provider, self.layout())
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
            provider,
            self.layout(),
            RootCommitRequest {
                scope: &self.scope,
                root: &body,
                root_key_ref: &self.route,
                held: event.root_guard().unwrap(),
            },
        )
        .unwrap();
    }

    /// A further ordinary root commit that stops where `how` says: the preparation is durable, the
    /// committed root is still the previous one.
    fn interrupt_root_commit(&self, provider: &mut MemoryKeyProvider, how: Interruption) {
        provider.inject(match how {
            Interruption::AtAnchorCommit => Fault::BeforePersist(AnchorOp::Commit),
            Interruption::AfterPrepare => Fault::AfterPersist(AnchorOp::Prepare),
        });
        let interrupted = self.commit_catalog(provider, &[], "fixture-interrupted");
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
}

/// A provider with the registry, the first catalog and, as `setup` says, a bound root and an
/// interrupted root commit. Test-only preconfigured authority, not first enable (which remains
/// Gate 4E).
pub fn configured_provider(base: &Path, root: &Path, setup: &Setup) -> MemoryKeyProvider {
    let mut provider = MemoryKeyProvider::new();
    let scope = provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    let authority = Authority { root, scope, route };
    let mut exclusive = ExclusiveAdmissionGuard::try_acquire(AdmissionScope {
        installation_dir: base,
        root_dir: root,
    })
    .unwrap()
    .unwrap();
    authority.register_epoch(&provider, &mut exclusive);
    let descriptors = if setup.page {
        vec![one_record_descriptor()]
    } else {
        Vec::new()
    };
    authority
        .commit_catalog(&mut provider, &descriptors, "fixture-bootstrap")
        .unwrap();
    if let Some(live) = &setup.bound {
        authority.bind(&mut provider, &mut exclusive, live);
    }
    if let Some(how) = setup.interrupted {
        authority.interrupt_root_commit(&mut provider, how);
    }
    drop(exclusive);
    provider
}
