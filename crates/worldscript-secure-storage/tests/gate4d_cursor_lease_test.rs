//! Gate 4D Slice D3a: what a successor may do to the cursor and the lease (§10.1, §10.3, maintainer
//! decision C). Within a phase the cursor only moves forward; a forward phase change enters the new
//! phase at `(0, 0)`; entering `RECOVERY_REQUIRED` keeps the last cursor. An ordinary successor never
//! touches the lease: the owner and the fence change only by takeover, the expiry only by renewal.

use worldscript_secure_storage::{
    assert_manifest_successor, assert_renewal_successor, assert_takeover_successor,
    empty_journal_page_set_digest, mark_recovery, operation_type, phase_code, transition_phase,
    JournalCheckpointCursor, JournalManifest, MigrationExecutionError, MigrationFence,
    MigrationPhase, RecoveryReasonCode,
};

type Outcome = Result<(), MigrationExecutionError>;

/// A journal in `CONVERT` owned by "owner-a" until 10 000, two pages and five entries long, with the
/// cursor at page 1, entry 2.
fn converting() -> JournalManifest {
    JournalManifest {
        operation_id: "cursor-lease-op".into(),
        journal_revision: 7,
        operation_type: operation_type::ENABLE,
        phase: phase_code::CONVERT,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 4,
        inventory_version: 1,
        inventory_digest: [3; 32],
        page_count: 2,
        entry_count: 5,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: true,
        cursor_page_index: 1,
        cursor_entry_index: 2,
        has_lease_owner: true,
        lease_owner_id: Some("owner-a".into()),
        lease_expires_unix_ms: Some(10_000),
        recovery_reason_code: 0,
    }
}

/// The relation's verdict on `prev` and its successor after `change`.
fn verdict(prev: &JournalManifest, change: impl FnOnce(&mut JournalManifest)) -> Outcome {
    let mut next = prev.clone();
    next.journal_revision += 1;
    change(&mut next);
    assert_manifest_successor(prev, &next)
}

fn forward(next: &mut JournalManifest) {
    next.phase = phase_code::VERIFY;
}

fn start(next: &mut JournalManifest) {
    next.cursor_page_index = 0;
    next.cursor_entry_index = 0;
}

fn recovery(next: &mut JournalManifest) {
    next.phase = phase_code::RECOVERY_REQUIRED;
    next.recovery_reason_code = 3;
}

#[test]
fn a_forward_phase_change_enters_the_new_phase_at_the_start() {
    let prev = converting();
    assert_eq!(
        verdict(&prev, forward),
        Err(MigrationExecutionError::CursorNotReset)
    );
    assert_eq!(
        verdict(&prev, |next| {
            forward(next);
            next.cursor_page_index = 0;
        }),
        Err(MigrationExecutionError::CursorNotReset)
    );
    assert_eq!(
        verdict(&prev, |next| {
            forward(next);
            start(next);
        }),
        Ok(())
    );
}

#[test]
fn the_constructor_enters_a_forward_phase_at_the_start() {
    let prev = converting();
    let fence = MigrationFence::from_manifest(&prev);
    let verify = MigrationPhase::from_wire(phase_code::VERIFY);
    let next = transition_phase(&prev, &fence, verify).unwrap();
    assert_eq!((next.cursor_page_index, next.cursor_entry_index), (0, 0));
    // The relation and the constructor agree, and the lease is the committed one.
    assert_eq!(assert_manifest_successor(&prev, &next), Ok(()));
    assert_eq!(next.lease_owner_id, prev.lease_owner_id);
    assert_eq!(next.lease_expires_unix_ms, prev.lease_expires_unix_ms);
}

#[test]
fn entering_recovery_keeps_the_last_cursor() {
    let prev = converting();
    assert_eq!(verdict(&prev, recovery), Ok(()));
    assert_eq!(
        verdict(&prev, |next| {
            recovery(next);
            start(next);
        }),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
    let fence = MigrationFence::from_manifest(&prev);
    let marked = mark_recovery(&prev, &fence, RecoveryReasonCode::new(3)).unwrap();
    assert_eq!(
        (marked.cursor_page_index, marked.cursor_entry_index),
        (1, 2)
    );
    assert_eq!(assert_manifest_successor(&prev, &marked), Ok(()));
}

#[test]
fn within_a_phase_the_cursor_only_moves_forward() {
    let prev = converting();
    let at = |page, entry| {
        verdict(&prev, move |next| {
            next.cursor_page_index = page;
            next.cursor_entry_index = entry;
        })
    };
    assert_eq!(at(1, 3), Ok(()));
    assert_eq!(at(1, 2), Ok(()));
    assert_eq!(at(1, 1), Err(MigrationExecutionError::RegressiveCheckpoint));
    assert_eq!(at(0, 4), Err(MigrationExecutionError::RegressiveCheckpoint));
    // The constructor of a progress checkpoint agrees with the same relation.
    let fence = MigrationFence::from_manifest(&prev);
    let moved = worldscript_secure_storage::checkpoint_progress(
        &prev,
        &fence,
        JournalCheckpointCursor::new(1, 4),
    )
    .unwrap();
    assert_eq!(assert_manifest_successor(&prev, &moved), Ok(()));
}

type Change = fn(&mut JournalManifest);

#[test]
fn an_ordinary_successor_cannot_change_the_lease() {
    // Ownership and expiry move only by takeover and renewal, so none of the ordinary successors (a
    // progress checkpoint, a forward phase change, entering recovery) may carry another lease.
    let other_owner: Change = |m| m.lease_owner_id = Some("owner-b".into());
    let longer: Change = |m| m.lease_expires_unix_ms = Some(20_000);
    let shorter: Change = |m| m.lease_expires_unix_ms = Some(5_000);
    let dropped: Change = |m| {
        m.has_lease_owner = false;
        m.lease_owner_id = None;
        m.lease_expires_unix_ms = None;
    };
    let progress: Change = |m| m.cursor_entry_index = 3;
    let steps: [(&str, Change); 3] = [
        ("checkpoint", progress),
        ("forward change", |m| {
            forward(m);
            start(m);
        }),
        ("recovery", recovery),
    ];
    for (step, base) in steps {
        for (name, lease) in [
            ("another owner", other_owner),
            ("a longer expiry", longer),
            ("a shorter expiry", shorter),
            ("a dropped lease", dropped),
        ] {
            assert_eq!(
                verdict(&converting(), |next| {
                    base(next);
                    lease(next);
                }),
                Err(MigrationExecutionError::FrozenFieldChanged),
                "{step} with {name}"
            );
        }
    }
    // A lease cannot appear from nothing either: its first owner is the bootstrap or a takeover.
    let mut unowned = converting();
    unowned.has_lease_owner = false;
    unowned.lease_owner_id = None;
    unowned.lease_expires_unix_ms = None;
    assert_eq!(
        verdict(&unowned, |next| {
            next.has_lease_owner = true;
            next.lease_owner_id = Some("owner-a".into());
            next.lease_expires_unix_ms = Some(10_000);
        }),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
}

/// The renewal of `prev` after `change`.
fn renewal(prev: &JournalManifest, change: impl FnOnce(&mut JournalManifest)) -> Outcome {
    let mut next = prev.clone();
    next.journal_revision += 1;
    change(&mut next);
    assert_renewal_successor(prev, &next)
}

fn extend(next: &mut JournalManifest) {
    next.lease_expires_unix_ms = Some(10_001);
}

#[test]
fn a_renewal_moves_only_the_expiry_forward() {
    let prev = converting();
    assert_eq!(renewal(&prev, extend), Ok(()));
    for expiry in [10_000, 9_999, 0] {
        assert_eq!(
            renewal(&prev, |next| next.lease_expires_unix_ms = Some(expiry)),
            Err(MigrationExecutionError::InvalidLeaseRenewal),
            "expiry {expiry}"
        );
    }
    // Dropping the lease is not a renewal.
    assert_eq!(
        renewal(&prev, |next| {
            next.has_lease_owner = false;
            next.lease_owner_id = None;
            next.lease_expires_unix_ms = None;
        }),
        Err(MigrationExecutionError::InvalidLeaseRenewal)
    );
}

#[test]
fn a_renewal_needs_a_lease_that_is_held() {
    let mut unowned = converting();
    unowned.has_lease_owner = false;
    unowned.lease_owner_id = None;
    unowned.lease_expires_unix_ms = None;
    let claim: Change = |next| {
        next.has_lease_owner = true;
        next.lease_owner_id = Some("owner-a".into());
        next.lease_expires_unix_ms = Some(10_000);
    };
    assert_eq!(
        renewal(&unowned, claim),
        Err(MigrationExecutionError::InvalidLeaseRenewal)
    );
    let mut nameless = converting();
    nameless.lease_owner_id = Some(String::new());
    assert_eq!(
        renewal(&nameless, extend),
        Err(MigrationExecutionError::InvalidLeaseRenewal)
    );
}

#[test]
fn a_renewal_changes_nothing_else() {
    let prev = converting();
    let others: [(&str, Change); 5] = [
        ("another owner", |m| {
            m.lease_owner_id = Some("owner-b".into())
        }),
        ("another fence", |m| m.fencing_generation += 1),
        ("a cursor move", |m| m.cursor_entry_index = 3),
        ("a phase change", forward),
        ("a recovery reason", recovery),
    ];
    for (name, change) in others {
        assert_eq!(
            renewal(&prev, |next| {
                extend(next);
                change(next);
            }),
            Err(MigrationExecutionError::FrozenFieldChanged),
            "{name}"
        );
    }
}

#[test]
fn a_renewal_is_the_next_revision_of_a_live_journal() {
    let prev = converting();
    let mut same = prev.clone();
    extend(&mut same);
    assert_eq!(
        assert_renewal_successor(&prev, &same),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
    let mut skipped = prev.clone();
    skipped.journal_revision += 2;
    extend(&mut skipped);
    assert_eq!(
        assert_renewal_successor(&prev, &skipped),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
    let mut done = prev.clone();
    done.phase = phase_code::DONE;
    assert_eq!(
        renewal(&done, extend),
        Err(MigrationExecutionError::TerminalPhase)
    );
}

#[test]
fn renewal_takeover_and_ordinary_successor_are_three_different_things() {
    let prev = converting();
    let mut renewed = prev.clone();
    renewed.journal_revision += 1;
    extend(&mut renewed);
    // A renewal is not an ordinary successor ...
    assert_eq!(
        assert_manifest_successor(&prev, &renewed),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
    // ... and a takeover claim is not a renewal.
    let mut claim = prev.clone();
    claim.journal_revision += 1;
    claim.fencing_generation += 1;
    claim.lease_owner_id = Some("owner-b".into());
    claim.lease_expires_unix_ms = Some(30_000);
    assert_eq!(assert_takeover_successor(&prev, &claim, 10_000), Ok(()));
    assert_eq!(
        assert_renewal_successor(&prev, &claim),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
}
