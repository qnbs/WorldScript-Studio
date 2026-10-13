//! Gate 4E E2 follow-up: a phase change is published only by the exclusively admitted phase-transition
//! commit (§10.3). The progress checkpoint, the binding advance and the journal-level checkpoint
//! publish all refuse it, and the transition refuses what keeps the phase, each before a journal byte
//! is written. The shared and the exclusive admission exclude each other, so a transition cannot
//! start while an ordinary operation is in flight.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    advance_live_migration, commit_catalog_change, commit_journal_checkpoint,
    commit_phase_transition, commit_root, content_digest, empty_inventory_digest,
    empty_journal_page_set_digest, generation_path, load_authoritative_manifest, load_catalog,
    operation_type, phase_code, promote_manifest_fenced, publish_manifest_fenced,
    publish_phase_transition_fenced, transition_phase, write_key_epoch, AdmissionScope,
    AuthorityError, BindingAdvance, CandidateConflict, CatalogChange, CatalogCommit,
    ExclusiveAdmissionGuard, InstallationScopeId, JournalCheckpoint, JournalDurableContext,
    JournalDurableError, JournalManifest, JournalSource, KeyEpochCommit, KeyEpochRecord,
    KeyEpochStatus, KeyProvider, LiveMigration, MigrationExecutionError, MigrationFence,
    MigrationPhase, RootBody, RootCommitEvidence, RootCommitGuard, RootCommitRequest,
    RootCommitState, RootCommitted, RootKeyRefV1, RootLayout, SharedAdmissionGuard, StdFs,
    WriteOperationId,
};

const OPERATION: &str = "phase-op";
const FENCE: u64 = 4;

const CHECKPOINT_REFUSED: AuthorityError = AuthorityError::Journal(JournalDurableError::Authority(
    MigrationExecutionError::PhaseChangeNotACheckpoint,
));
const TRANSITION_REFUSED: AuthorityError = AuthorityError::Journal(JournalDurableError::Authority(
    MigrationExecutionError::NotAPhaseChange,
));

fn journal_key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

fn manifest_at(revision: u64, phase: u32) -> JournalManifest {
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: revision,
        operation_type: operation_type::ENABLE,
        phase,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: FENCE,
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

/// The valid successor of `prev` that enters `phase`.
fn entering(prev: &JournalManifest, phase: u32) -> JournalManifest {
    let fence = MigrationFence::from_manifest(prev);
    transition_phase(prev, &fence, MigrationPhase::from_wire(phase)).unwrap()
}

/// The valid successor of `prev` that stays in its phase: the next revision, nothing else.
fn progressing(prev: &JournalManifest) -> JournalManifest {
    let mut next = prev.clone();
    next.journal_revision += 1;
    next
}

fn digest_of(dir: &Path, revision: u64) -> [u8; 32] {
    content_digest(&fs::read(generation_path(dir, revision)).unwrap())
}

fn binding_of(manifest: &JournalManifest, dir: &Path) -> LiveMigration {
    LiveMigration {
        operation_id: manifest.operation_id.clone(),
        fencing_generation: manifest.fencing_generation,
        journal_revision: manifest.journal_revision,
        manifest_digest: digest_of(dir, manifest.journal_revision),
    }
}

fn checkpoint_of<'a>(
    journal_dir: &'a Path,
    key_ref: &'a RootKeyRefV1,
    manifest: &'a JournalManifest,
    fence: &'a MigrationFence,
    operation: &'a WriteOperationId,
) -> JournalCheckpoint<'a> {
    JournalCheckpoint {
        manifest,
        fence,
        journal: JournalSource {
            dir: journal_dir,
            operation,
        },
        root_key_ref: key_ref,
        active_key_epoch: 1,
        conflict: CandidateConflict::Refuse,
    }
}

/// A dedicated installation directory holding an authority root and a journal directory.
struct Installation {
    base: PathBuf,
    root_dir: PathBuf,
    journal_dir: PathBuf,
}

impl Installation {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let base = std::env::temp_dir().join(format!(
            "wss-gate4e-phase-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&base);
        let root_dir = base.join("authority");
        let journal_dir = base.join("journal");
        for dir in [
            root_dir.join("slot-a"),
            root_dir.join("slot-b"),
            journal_dir.clone(),
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        Installation {
            base,
            root_dir,
            journal_dir,
        }
    }

    fn scope(&self) -> AdmissionScope<'_> {
        AdmissionScope {
            installation_dir: &self.base,
            root_dir: &self.root_dir,
        }
    }

    fn exclusive(&self) -> ExclusiveAdmissionGuard {
        ExclusiveAdmissionGuard::try_acquire(self.scope())
            .unwrap()
            .expect("nothing else holds the admission")
    }

    fn journal_names(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(&self.journal_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }
}

impl Drop for Installation {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

/// A provisioned root that binds revision 0 (`BOOTSTRAP_TARGET`) of `OPERATION`.
struct Bound {
    installation: Installation,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    key_ref: RootKeyRefV1,
    zero: JournalManifest,
}

impl Bound {
    fn new() -> Self {
        let installation = Installation::new();
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let key_ref = provider.import_epoch_key(1, [9u8; 32]).unwrap();
        provider.unlock().unwrap();
        let mut bound = Bound {
            installation,
            provider,
            scope,
            key_ref,
            zero: manifest_at(0, phase_code::BOOTSTRAP_TARGET),
        };
        bound.register_epoch();
        bound.bind_zero();
        bound
    }

    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.installation.root_dir,
        }
    }

    fn register_epoch(&mut self) {
        let record = KeyEpochRecord {
            epoch: 1,
            status: KeyEpochStatus::Active,
            root_key_ref: self.key_ref.clone(),
        };
        let guard = RootCommitGuard::acquire(&self.installation.root_dir).unwrap();
        let commit = KeyEpochCommit {
            scope: &self.scope,
            record: &record,
            registry_generation: 1,
            root_key_ref: &self.key_ref,
            key_epoch: 1,
            held: &guard,
        };
        write_key_epoch(&mut StdFs, &self.provider, self.layout(), commit).unwrap();
    }

    /// Commits the first ordinary root, then a root that binds revision 0 of the journal.
    fn bind_zero(&mut self) {
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &self.key_ref,
            active_key_epoch: 1,
            operation_id: "bootstrap-root",
        };
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        commit_catalog_change(&mut StdFs, &mut self.provider, layout, commit).unwrap();
        let zero = self.zero.clone();
        self.promote(&zero, None);
        let binding = binding_of(&zero, &self.installation.journal_dir);
        let catalog = self.root();
        let root = RootBody {
            root_generation: catalog.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: binding.operation_id.clone(),
                fencing_generation: binding.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(binding),
            ..catalog
        };
        let guard = RootCommitGuard::acquire(&self.installation.root_dir).unwrap();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &self.key_ref,
            held: &guard,
        };
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        commit_root(&mut StdFs, &mut self.provider, layout, request).unwrap();
    }

    fn root(&self) -> RootBody {
        load_catalog(&mut StdFs, &self.provider, self.layout())
            .unwrap()
            .unwrap()
            .root
    }

    /// The manifest the committed root names.
    fn committed(&self) -> JournalManifest {
        let live = self.root().live_migration.unwrap();
        let operation = WriteOperationId::generate().unwrap();
        let key = journal_key();
        let mut fs = StdFs;
        let mut ctx =
            JournalDurableContext::new(&mut fs, &key, &self.installation.journal_dir, &operation);
        load_authoritative_manifest(&mut ctx, &live).unwrap()
    }

    /// The plain fenced promote: it writes a generation and decides nothing about authority.
    fn promote(&self, manifest: &JournalManifest, committed: Option<&LiveMigration>) {
        let fence = MigrationFence::from_manifest(manifest);
        let operation = WriteOperationId::generate().unwrap();
        let key = journal_key();
        let mut fs = StdFs;
        let mut ctx =
            JournalDurableContext::new(&mut fs, &key, &self.installation.journal_dir, &operation);
        promote_manifest_fenced(&mut ctx, manifest, &fence, committed).unwrap();
    }

    fn checkpoint(&mut self, next: &JournalManifest) -> Result<RootCommitted, AuthorityError> {
        let fence = MigrationFence::from_manifest(next);
        let operation = WriteOperationId::generate().unwrap();
        let checkpoint = checkpoint_of(
            &self.installation.journal_dir,
            &self.key_ref,
            next,
            &fence,
            &operation,
        );
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        commit_journal_checkpoint(&mut StdFs, &mut self.provider, layout, checkpoint)
    }

    fn transition(
        &mut self,
        admission: &mut ExclusiveAdmissionGuard,
        next: &JournalManifest,
    ) -> Result<RootCommitted, AuthorityError> {
        let fence = MigrationFence::from_manifest(next);
        let operation = WriteOperationId::generate().unwrap();
        let checkpoint = checkpoint_of(
            &self.installation.journal_dir,
            &self.key_ref,
            next,
            &fence,
            &operation,
        );
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        commit_phase_transition(
            admission,
            &mut StdFs,
            &mut self.provider,
            layout,
            checkpoint,
        )
    }

    fn advance(&mut self, next: &LiveMigration) -> Result<RootCommitted, AuthorityError> {
        let operation = WriteOperationId::generate().unwrap();
        let advance = BindingAdvance {
            next,
            journal: JournalSource {
                dir: &self.installation.journal_dir,
                operation: &operation,
            },
            root_key_ref: &self.key_ref,
            active_key_epoch: 1,
        };
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        advance_live_migration(&mut StdFs, &mut self.provider, layout, advance)
    }

    /// What the root and the journal directory hold, to prove a refusal changed neither.
    fn state(&self) -> (RootBody, Vec<String>) {
        (self.root(), self.installation.journal_names())
    }
}

#[test]
fn the_exclusive_transition_publishes_a_phase_change_and_binds_the_root_to_it() {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let before = bound.root();
    let mut admission = bound.installation.exclusive();
    let committed = bound.transition(&mut admission, &discover).unwrap();
    assert_eq!(committed.root_generation, before.root_generation + 1);
    assert_eq!(
        bound.root().live_migration,
        Some(binding_of(&discover, &bound.installation.journal_dir))
    );
    assert_eq!(bound.committed(), discover);
    // The next phase change goes through the same admission, one call after the other.
    let prepare = entering(&discover, phase_code::PREPARE);
    bound.transition(&mut admission, &prepare).unwrap();
    assert_eq!(bound.committed(), prepare);
}

#[test]
fn the_checkpoint_refuses_a_phase_change_and_writes_nothing() {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let before = bound.state();
    assert_eq!(bound.checkpoint(&discover), Err(CHECKPOINT_REFUSED));
    assert_eq!(bound.state(), before);
}

#[test]
fn the_transition_refuses_a_successor_that_keeps_the_phase_while_the_checkpoint_takes_it() {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let mut admission = bound.installation.exclusive();
    bound.transition(&mut admission, &discover).unwrap();
    let progress = progressing(&discover);
    let before = bound.state();
    assert_eq!(
        bound.transition(&mut admission, &progress),
        Err(TRANSITION_REFUSED)
    );
    assert_eq!(bound.state(), before);
    // The same successor is an ordinary progress checkpoint, which holds no admission.
    bound.checkpoint(&progress).unwrap();
    assert_eq!(bound.committed(), progress);
}

#[test]
fn an_admission_for_another_root_is_refused_before_anything_is_written() {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let foreign = Installation::new();
    let mut admission = foreign.exclusive();
    let before = bound.state();
    assert_eq!(
        bound.transition(&mut admission, &discover),
        Err(AuthorityError::NotAdmitted)
    );
    assert_eq!(bound.state(), before);
}

#[test]
fn a_phase_change_promoted_directly_becomes_authoritative_only_through_the_exclusive_transition() {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let committed = bound.root().live_migration.unwrap();
    bound.promote(&discover, Some(&committed));
    let named = binding_of(&discover, &bound.installation.journal_dir);
    let before = bound.state();
    // The root refuses to name it: through the binding advance, and through the checkpoint that
    // would adopt the identical candidate.
    assert_eq!(
        bound.advance(&named),
        Err(AuthorityError::LiveMigration(
            MigrationExecutionError::PhaseChangeNotACheckpoint
        ))
    );
    assert_eq!(bound.checkpoint(&discover), Err(CHECKPOINT_REFUSED));
    assert_eq!(bound.state(), before);
    // The exclusive transition adopts the identical candidate without a journal write.
    let mut admission = bound.installation.exclusive();
    bound.transition(&mut admission, &discover).unwrap();
    assert_eq!(bound.installation.journal_names(), before.1);
    assert_eq!(bound.root().live_migration, Some(named));
}

#[test]
fn the_journal_publishers_split_the_same_way_before_any_write() {
    let bound = Bound::new();
    let live = bound.root().live_migration.unwrap();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let names = bound.installation.journal_names();
    let operation = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let fence = MigrationFence::from_manifest(&discover);
    let mut fs = StdFs;
    let mut ctx =
        JournalDurableContext::new(&mut fs, &key, &bound.installation.journal_dir, &operation);
    assert_eq!(
        publish_manifest_fenced(&mut ctx, &discover, &fence, Some(&live)),
        Err(JournalDurableError::Authority(
            MigrationExecutionError::PhaseChangeNotACheckpoint
        ))
    );
    assert_eq!(bound.installation.journal_names(), names);
    let kept = progressing(&bound.zero);
    let kept_fence = MigrationFence::from_manifest(&kept);
    assert_eq!(
        publish_phase_transition_fenced(&mut ctx, &kept, &kept_fence, Some(&live)),
        Err(JournalDurableError::Authority(
            MigrationExecutionError::NotAPhaseChange
        ))
    );
    assert_eq!(bound.installation.journal_names(), names);
    publish_phase_transition_fenced(&mut ctx, &discover, &fence, Some(&live)).unwrap();
}

#[test]
fn no_transition_can_start_while_an_ordinary_operation_holds_the_shared_admission() {
    let bound = Bound::new();
    let shared = SharedAdmissionGuard::try_acquire(bound.installation.scope())
        .unwrap()
        .expect("no exclusive holder");
    assert!(
        ExclusiveAdmissionGuard::try_acquire(bound.installation.scope())
            .unwrap()
            .is_none()
    );
    drop(shared);
    assert!(
        ExclusiveAdmissionGuard::try_acquire(bound.installation.scope())
            .unwrap()
            .is_some()
    );
}
