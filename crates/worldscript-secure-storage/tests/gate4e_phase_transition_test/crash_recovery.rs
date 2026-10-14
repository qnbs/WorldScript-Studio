//! Gate 4E E2c: recovering a prepared root that changes the live-migration binding needs the exclusive
//! admission. A crash between the anchor's preparation and its commit leaves such a root prepared. The
//! shared recovery refuses it and writes nothing, the exclusive recovery completes it, and a prepared
//! root that keeps the binding is still completed under a shared admission.

use std::collections::BTreeMap;

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault};
use worldscript_secure_storage::{
    recover_root, recover_root_exclusive, OperationError, ProtectedStorage, RecordClass,
    RecordIdentity, RecordLocation, RootRecovery, RootStoreError,
};

use super::faulty_fs::FaultyFs;
use super::*;

fn preparation_pending(bound: &Bound) -> bool {
    bound
        .provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_some()
}

/// The recovery of the holder of a shared admission, such as an ordinary operation.
fn recover_shared(bound: &mut Bound) -> Result<RootRecovery, RootStoreError> {
    let mut shared = SharedAdmissionGuard::try_acquire(bound.installation.scope())
        .unwrap()
        .expect("no exclusive holder");
    let event = shared.try_root_commit().unwrap().expect("root idle");
    let held = event.root_guard().unwrap();
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    recover_root(&mut StdFs, &mut bound.provider, layout, held)
}

/// The recovery of the holder of the exclusive admission.
fn recover_exclusive(bound: &mut Bound) -> Result<RootRecovery, RootStoreError> {
    let mut admission = bound.installation.exclusive();
    let event = admission.try_root_commit().unwrap().expect("root idle");
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    recover_root_exclusive(&mut StdFs, &mut bound.provider, layout, &event)
}

/// The transition into `DISCOVER`, stopped by `fault` at the anchor; returns the manifest it carried.
fn interrupted_transition(bound: &mut Bound, fault: Fault) -> JournalManifest {
    let next = entering(&bound.zero, phase_code::DISCOVER);
    let mut admission = bound.installation.exclusive();
    bound.provider.inject(fault);
    assert!(bound.transition(&mut admission, &next).is_err());
    next
}

/// The same transition, stopped by the file system `fs` instead.
fn transition_stopped_by(bound: &mut Bound, fs: &mut FaultyFs) -> JournalManifest {
    let next = entering(&bound.zero, phase_code::DISCOVER);
    let mut admission = bound.installation.exclusive();
    let root_dir = bound.installation.root_dir.clone();
    let attempt = Attempt {
        fs,
        root_dir: &root_dir,
    };
    assert!(bound
        .transition_through(&mut admission, attempt, &next)
        .is_err());
    next
}

/// A prepared phase change: the shared recovery refuses it and changes nothing, the exclusive one
/// completes exactly it.
fn assert_refused_then_completed(bound: &mut Bound, next: &JournalManifest) {
    assert!(preparation_pending(bound));
    let before = snapshot(bound);
    assert_eq!(
        recover_shared(bound),
        Err(RootStoreError::BindingChangeNeedsExclusiveRecovery)
    );
    assert_eq!(snapshot(bound), before);
    assert!(matches!(
        recover_exclusive(bound),
        Ok(RootRecovery::Completed { .. })
    ));
    assert_eq!(bound.committed(), *next);
}

#[test]
fn the_shared_recovery_refuses_a_prepared_phase_change_and_the_exclusive_one_completes_it() {
    let mut bound = Bound::new();
    let next = interrupted_transition(&mut bound, Fault::BeforePersist(AnchorOp::Commit));
    assert_refused_then_completed(&mut bound, &next);
}

#[test]
fn a_crash_before_the_anchor_commit_ends_as_its_recovery_decides() {
    // (fault, shared recovery, whether the phase change landed)
    let cases = [
        (
            Fault::BeforePersist(AnchorOp::Prepare),
            Ok(RootRecovery::NothingPending),
            false,
        ),
        (
            Fault::AfterPersist(AnchorOp::Prepare),
            Ok(RootRecovery::Discarded),
            false,
        ),
        (
            Fault::AfterPersist(AnchorOp::Commit),
            Ok(RootRecovery::NothingPending),
            true,
        ),
    ];
    for (fault, expected, landed) in cases {
        let mut bound = Bound::new();
        let generation = bound.root().root_generation;
        let next = interrupted_transition(&mut bound, fault);
        assert_eq!(recover_shared(&mut bound), expected, "{fault:?}");
        let committed = bound.committed();
        let (phase, generations) = (committed.phase, bound.root().root_generation);
        let expected_phase = if landed { next.phase } else { bound.zero.phase };
        let expected_generation = generation + u64::from(landed);
        assert_eq!(
            (phase, generations),
            (expected_phase, expected_generation),
            "{fault:?}"
        );
    }
}

#[test]
fn a_slot_that_was_never_written_is_discarded_by_either_recovery() {
    let mut bound = Bound::new();
    let before_phase = bound.committed().phase;
    transition_stopped_by(&mut bound, &mut FaultyFs::failing_creation_below("slot-"));
    assert!(preparation_pending(&bound));
    assert_eq!(recover_shared(&mut bound), Ok(RootRecovery::Discarded));
    assert_eq!(bound.committed().phase, before_phase);
    assert_eq!(
        recover_exclusive(&mut bound),
        Ok(RootRecovery::NothingPending)
    );
}

#[test]
fn a_pointer_that_was_never_moved_leaves_a_phase_change_for_the_exclusive_recovery() {
    let mut bound = Bound::new();
    let next = transition_stopped_by(&mut bound, &mut FaultyFs::failing_rename_to("pointer"));
    assert_refused_then_completed(&mut bound, &next);
}

/// The root a raw commit would publish, and that commit stopped at the anchor.
fn raw_commit_stopped(bound: &mut Bound, binding: Option<LiveMigration>) {
    let catalog = bound.root();
    let evidence = binding
        .as_ref()
        .map_or(catalog.commit_evidence.clone(), |live| RootCommitEvidence {
            operation_id: live.operation_id.clone(),
            fencing_generation: live.fencing_generation,
            state: RootCommitState::Committed,
        });
    let root = RootBody {
        root_generation: catalog.root_generation + 1,
        commit_evidence: evidence,
        live_migration: binding,
        ..catalog
    };
    bound
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Commit));
    let guard = RootCommitGuard::acquire(&bound.installation.root_dir).unwrap();
    let request = RootCommitRequest {
        scope: &bound.scope,
        root: &root,
        root_key_ref: &bound.key_ref,
        held: &guard,
    };
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    let result = commit_root(&mut StdFs, &mut bound.provider, layout, request);
    assert!(result.is_err());
}

/// A binding that names another revision than `live`.
fn another_binding(live: &LiveMigration) -> LiveMigration {
    LiveMigration {
        journal_revision: live.journal_revision + 1,
        manifest_digest: [0x77; 32],
        ..live.clone()
    }
}

#[test]
fn only_a_change_of_the_binding_needs_the_exclusive_recovery() {
    // Bound to another binding, bound to none, bound to the same one, unbound to a binding, unbound to
    // none: whether the shared recovery refused.
    let mut refusals = Vec::new();
    for case in 0..5 {
        let mut bound = if case < 3 {
            Bound::new()
        } else {
            Bound::unbound()
        };
        let committed = bound.root().live_migration;
        let target = match case {
            0 => committed.as_ref().map(another_binding),
            2 => committed.clone(),
            3 => {
                let zero = bound.zero.clone();
                bound.promote(&zero, None);
                Some(binding_of(&zero, &bound.installation.journal_dir))
            }
            _ => None,
        };
        raw_commit_stopped(&mut bound, target.clone());
        let shared = recover_shared(&mut bound);
        let refused = shared == Err(RootStoreError::BindingChangeNeedsExclusiveRecovery);
        if refused {
            assert!(matches!(
                recover_exclusive(&mut bound),
                Ok(RootRecovery::Completed { .. })
            ));
        } else {
            assert!(matches!(shared, Ok(RootRecovery::Completed { .. })));
        }
        assert_eq!(bound.root().live_migration, target, "case {case}");
        refusals.push(refused);
    }
    assert_eq!(refusals, vec![true, true, false, true, false]);
}

#[test]
fn a_held_shared_admission_stops_the_exclusive_recovery_from_starting() {
    let mut bound = Bound::new();
    interrupted_transition(&mut bound, Fault::BeforePersist(AnchorOp::Commit));
    let before = snapshot(&bound);
    let shared = SharedAdmissionGuard::try_acquire(bound.installation.scope())
        .unwrap()
        .expect("no exclusive holder");
    assert!(
        ExclusiveAdmissionGuard::try_acquire(bound.installation.scope())
            .unwrap()
            .is_none()
    );
    drop(shared);
    assert_eq!(snapshot(&bound), before);
}

#[test]
fn an_ordinary_operation_over_a_prepared_phase_change_is_refused_and_writes_nothing() {
    let mut bound = Bound::new();
    interrupted_transition(&mut bound, Fault::BeforePersist(AnchorOp::Commit));
    let (records, markers) = (
        bound.installation.base.join("records"),
        bound.installation.base.join("markers"),
    );
    fs::create_dir_all(&records).unwrap();
    fs::create_dir_all(&markers).unwrap();
    let identity = RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap();
    let storage = ProtectedStorage::new(bound.installation.scope(), bound.provider);
    let mut files = BTreeMap::new();
    tree_below(&bound.installation.root_dir, "", &mut files);
    let journal = bound.installation.journal_names();
    // The root recovery that an ordinary operation runs first refuses the prepared phase change.
    for _ in 0..2 {
        let location = RecordLocation {
            record_dir: &records,
            marker_dir: &markers,
        };
        assert_eq!(
            storage
                .try_reconcile_record(&mut StdFs, &identity, location)
                .map(|_| ()),
            Err(OperationError::RecoveryPending)
        );
    }
    let mut after = BTreeMap::new();
    tree_below(&bound.installation.root_dir, "", &mut after);
    assert_eq!(
        (after, bound.installation.journal_names()),
        (files, journal)
    );
}
