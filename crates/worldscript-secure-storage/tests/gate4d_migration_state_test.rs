use worldscript_secure_storage::{
    allows_phase_transition, assert_binding_takeover, assert_live_binding,
    assert_manifest_successor, assert_takeover_promote_authority, assert_takeover_successor,
    authoritative_manifest_revision, checkpoint_progress, empty_inventory_digest,
    empty_journal_page_set_digest, is_terminal_phase, mark_done, mark_recovery, operation_type,
    ordinary_mutating_writes_admitted, phase_code, transition_phase, JournalCheckpointCursor,
    JournalError, JournalManifest, JournalRevision, LiveMigration, ManifestEnvelopeDigest,
    MigrationExecutionError, MigrationFence, MigrationPhase, RecoveryReasonCode,
};

struct RotateFixture {
    operation_id: &'static str,
    phase: u32,
    revision: u64,
    fencing_generation: u64,
    page_count: u32,
    entry_count: u32,
}

impl RotateFixture {
    fn manifest(&self) -> JournalManifest {
        JournalManifest {
            operation_id: self.operation_id.into(),
            journal_revision: self.revision,
            operation_type: operation_type::ROTATE,
            phase: self.phase,
            source_epoch: 1,
            target_epoch: 2,
            has_target_root_key_ref: true,
            target_root_key_ref_digest: Some([0x42; 32]),
            fencing_generation: self.fencing_generation,
            inventory_version: 1,
            inventory_digest: empty_inventory_digest(1),
            page_count: self.page_count,
            entry_count: self.entry_count,
            journal_page_set_digest: empty_journal_page_set_digest(),
            cursor_page_index: 0,
            cursor_entry_index: 0,
            has_lease_owner: false,
            lease_owner_id: None,
            lease_expires_unix_ms: None,
            recovery_reason_code: 0,
        }
    }
}

fn phase(code: u32) -> MigrationPhase {
    MigrationPhase::from_wire(code)
}

#[test]
fn happy_path_phase_sequence_is_forward_only() {
    let phases = [
        phase_code::BOOTSTRAP_TARGET,
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
    for window in phases.windows(2) {
        assert!(allows_phase_transition(phase(window[0]), phase(window[1])));
    }
    assert!(!allows_phase_transition(
        phase(phase_code::DISCOVER),
        phase(phase_code::CONVERT)
    ));
    assert!(allows_phase_transition(
        phase(phase_code::CONVERT),
        phase(phase_code::RECOVERY_REQUIRED)
    ));
    assert!(!allows_phase_transition(phase(999), phase(999)));
}

#[test]
fn transition_phase_bumps_revision_on_forward_change() {
    let manifest = RotateFixture {
        operation_id: "op-a",
        phase: phase_code::BOOTSTRAP_TARGET,
        revision: 1,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    let fence = MigrationFence::from_manifest(&manifest);
    let discover = transition_phase(&manifest, &fence, phase(phase_code::DISCOVER)).unwrap();
    assert_eq!(discover.phase, phase_code::DISCOVER);
    assert_eq!(discover.journal_revision, 2);
}

#[test]
fn checkpoint_bumps_revision_and_moves_cursor_within_inventory() {
    let manifest = RotateFixture {
        operation_id: "op-b",
        phase: phase_code::CONVERT,
        revision: 4,
        fencing_generation: 2,
        page_count: 1,
        entry_count: 5,
    }
    .manifest();
    let fence = MigrationFence::from_manifest(&manifest);
    let checkpoint =
        checkpoint_progress(&manifest, &fence, JournalCheckpointCursor::new(0, 3)).unwrap();
    assert_eq!(checkpoint.journal_revision, 5);
    assert_eq!(checkpoint.cursor_entry_index, 3);
    assert_eq!(checkpoint.fencing_generation, 2);
}

#[test]
fn empty_inventory_accepts_only_canonical_empty_cursor() {
    let manifest = RotateFixture {
        operation_id: "op-empty",
        phase: phase_code::CONVERT,
        revision: 1,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    let fence = MigrationFence::from_manifest(&manifest);
    assert!(checkpoint_progress(&manifest, &fence, JournalCheckpointCursor::EMPTY).is_ok());
    assert!(checkpoint_progress(&manifest, &fence, JournalCheckpointCursor::new(0, 1)).is_err());
}

#[test]
fn checkpoint_refuses_regressive_cursor_and_out_of_range_entry() {
    let manifest = RotateFixture {
        operation_id: "op-reg",
        phase: phase_code::CONVERT,
        revision: 2,
        fencing_generation: 1,
        page_count: 1,
        entry_count: 2,
    }
    .manifest();
    let fence = MigrationFence::from_manifest(&manifest);
    let advanced =
        checkpoint_progress(&manifest, &fence, JournalCheckpointCursor::new(0, 1)).unwrap();
    let advanced_fence = MigrationFence::from_manifest(&advanced);
    assert_eq!(
        checkpoint_progress(
            &advanced,
            &advanced_fence,
            JournalCheckpointCursor::new(0, 0)
        ),
        Err(MigrationExecutionError::RegressiveCheckpoint)
    );
    assert!(
        checkpoint_progress(&manifest, &fence, JournalCheckpointCursor::new(0, u32::MAX)).is_err()
    );
}

#[test]
fn stale_fence_is_refused_before_mutation() {
    let manifest = RotateFixture {
        operation_id: "op-c",
        phase: phase_code::PREPARE,
        revision: 2,
        fencing_generation: 5,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    let stale = MigrationFence {
        fencing_generation: 4,
        journal_revision: 2,
    };
    assert_eq!(
        transition_phase(&manifest, &stale, phase(phase_code::ADMIT)),
        Err(MigrationExecutionError::StaleMigrationOwner)
    );
}

#[test]
fn live_binding_requires_exact_manifest_digest_and_revision() {
    let digest = ManifestEnvelopeDigest::from_bytes([0x11; 32]);
    let live = LiveMigration {
        operation_id: "op-d".into(),
        fencing_generation: 1,
        journal_revision: 3,
        manifest_digest: [0x11; 32],
    };
    assert_eq!(
        authoritative_manifest_revision(&live, JournalRevision::from_wire(3)).unwrap(),
        JournalRevision::from_wire(3)
    );
    assert_eq!(
        authoritative_manifest_revision(&live, JournalRevision::from_wire(5)).unwrap(),
        JournalRevision::from_wire(3)
    );
    assert_eq!(
        authoritative_manifest_revision(&live, JournalRevision::from_wire(2)),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
    let manifest = RotateFixture {
        operation_id: "op-d",
        phase: phase_code::CONVERT,
        revision: 3,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    assert!(assert_live_binding(&manifest, &live, digest).is_ok());
    assert_eq!(
        assert_live_binding(
            &manifest,
            &live,
            ManifestEnvelopeDigest::from_bytes([0x22; 32])
        ),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
    let ahead = RotateFixture {
        operation_id: "op-d",
        phase: phase_code::CONVERT,
        revision: 4,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    assert_eq!(
        assert_live_binding(&ahead, &live, digest),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
}

#[test]
fn mark_recovery_refuses_unsupported_source_phase() {
    let mut manifest = RotateFixture {
        operation_id: "op-bad-phase",
        phase: phase_code::CONVERT,
        revision: 1,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    manifest.phase = 999;
    let fence = MigrationFence::from_manifest(&manifest);
    assert_eq!(
        mark_recovery(&manifest, &fence, RecoveryReasonCode::new(7)),
        Err(MigrationExecutionError::Journal(
            JournalError::UnsupportedPhase(999)
        ))
    );
}

#[test]
fn recovery_and_done_are_terminal_and_prepare_admits_writes() {
    let manifest = RotateFixture {
        operation_id: "op-e",
        phase: phase_code::FINALIZE,
        revision: 9,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    let fence = MigrationFence::from_manifest(&manifest);
    let recovery = mark_recovery(&manifest, &fence, RecoveryReasonCode::new(42)).unwrap();
    assert_eq!(recovery.phase, phase_code::RECOVERY_REQUIRED);
    assert_eq!(recovery.recovery_reason_code, 42);
    assert!(is_terminal_phase(phase(recovery.phase)));
    assert!(!ordinary_mutating_writes_admitted(phase(recovery.phase)));
    let recovery_fence = MigrationFence::from_manifest(&recovery);
    assert_eq!(
        mark_recovery(&recovery, &recovery_fence, RecoveryReasonCode::new(99)),
        Err(MigrationExecutionError::TerminalPhase)
    );
    assert!(ordinary_mutating_writes_admitted(phase(
        phase_code::PREPARE
    )));
    let done_manifest = RotateFixture {
        operation_id: "op-f",
        phase: phase_code::FINALIZE,
        revision: 9,
        fencing_generation: 1,
        page_count: 0,
        entry_count: 0,
    }
    .manifest();
    let done_fence = MigrationFence::from_manifest(&done_manifest);
    let done = mark_done(&done_manifest, &done_fence).unwrap();
    assert_eq!(done.phase, phase_code::DONE);
    assert_eq!(done.journal_revision, 10);
    assert!(ordinary_mutating_writes_admitted(phase(done.phase)));
}

/// A field change applied to a successor candidate.
type Change = fn(&mut JournalManifest);

fn rotate_at(phase: u32, revision: u64) -> JournalManifest {
    RotateFixture {
        operation_id: "successor-op",
        phase,
        revision,
        fencing_generation: 7,
        page_count: 0,
        entry_count: 0,
    }
    .manifest()
}

/// A successor of `prev` that changes nothing but the revision.
fn bumped(prev: &JournalManifest) -> JournalManifest {
    let mut next = prev.clone();
    next.journal_revision += 1;
    next
}

fn refused(
    prev: &JournalManifest,
    change: impl FnOnce(&mut JournalManifest),
) -> Result<(), MigrationExecutionError> {
    let mut next = bumped(prev);
    change(&mut next);
    assert_manifest_successor(prev, &next)
}

#[test]
fn every_constructor_product_is_a_valid_successor() {
    let phases = [
        phase_code::BOOTSTRAP_TARGET,
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
    let mut current = rotate_at(phase_code::BOOTSTRAP_TARGET, 0);
    for next_phase in &phases[1..] {
        let fence = MigrationFence::from_manifest(&current);
        let next = transition_phase(&current, &fence, phase(*next_phase)).unwrap();
        assert_eq!(assert_manifest_successor(&current, &next), Ok(()));
        current = next;
    }
    // Progress within a phase and the move into recovery come from the other two constructors.
    let working = rotate_at(phase_code::CONVERT, 5);
    let fence = MigrationFence::from_manifest(&working);
    let progressed =
        checkpoint_progress(&working, &fence, JournalCheckpointCursor::new(0, 0)).unwrap();
    assert_eq!(assert_manifest_successor(&working, &progressed), Ok(()));
    let recovering = mark_recovery(&working, &fence, RecoveryReasonCode::new(1)).unwrap();
    assert_eq!(assert_manifest_successor(&working, &recovering), Ok(()));
}

#[test]
fn a_successor_carries_exactly_the_next_revision() {
    let prev = rotate_at(phase_code::PREPARE, 4);
    for (revision, expected) in [
        (4, MigrationExecutionError::StaleJournalRevision),
        (3, MigrationExecutionError::StaleJournalRevision),
        (6, MigrationExecutionError::LiveBindingMismatch),
        (u64::MAX, MigrationExecutionError::LiveBindingMismatch),
    ] {
        let mut next = prev.clone();
        next.journal_revision = revision;
        assert_eq!(assert_manifest_successor(&prev, &next), Err(expected));
    }
    let top = rotate_at(phase_code::PREPARE, u64::MAX);
    assert_eq!(
        assert_manifest_successor(&top, &top),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
}

#[test]
fn the_operation_and_its_identity_never_change() {
    let prev = rotate_at(phase_code::PREPARE, 4);
    assert_eq!(
        refused(&prev, |next| next.operation_id = "other-op".into()),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!(
        refused(&prev, |next| next.fencing_generation += 1),
        Err(MigrationExecutionError::StaleMigrationOwner)
    );
    let changes: [(&str, Change); 4] = [
        ("operation type", |m| {
            m.operation_type = operation_type::ENABLE
        }),
        ("source epoch", |m| m.source_epoch += 1),
        ("target epoch", |m| m.target_epoch += 1),
        ("inventory version", |m| m.inventory_version += 1),
    ];
    for (name, change) in changes {
        assert_eq!(
            refused(&prev, change),
            Err(MigrationExecutionError::FrozenFieldChanged),
            "{name}"
        );
    }
}

#[test]
fn the_phase_moves_one_step_forward_or_into_recovery_and_never_leaves_a_terminal_phase() {
    let prev = rotate_at(phase_code::CONVERT, 4);
    for (name, target) in [
        ("a jump over a phase", phase_code::COMMIT),
        ("a step back", phase_code::ADMIT),
        ("an unknown phase", 999),
    ] {
        assert_eq!(
            refused(&prev, |next| next.phase = target),
            Err(MigrationExecutionError::InvalidPhaseTransition),
            "{name}"
        );
    }
    for allowed in [
        phase_code::CONVERT,
        phase_code::VERIFY,
        phase_code::RECOVERY_REQUIRED,
    ] {
        assert_eq!(
            refused(&prev, |next| next.phase = allowed),
            Ok(()),
            "{allowed}"
        );
    }
    for terminal in [phase_code::DONE, phase_code::RECOVERY_REQUIRED] {
        let ended = rotate_at(terminal, 9);
        assert_eq!(
            refused(&ended, |_| {}),
            Err(MigrationExecutionError::TerminalPhase),
            "{terminal}"
        );
    }
}

#[test]
fn the_cursor_never_regresses_within_a_phase_and_is_free_across_a_phase_change() {
    let mut prev = rotate_at(phase_code::CONVERT, 4);
    prev.page_count = 3;
    prev.entry_count = 10;
    prev.cursor_page_index = 1;
    prev.cursor_entry_index = 5;
    for (page, entry) in [(1, 4), (0, 9)] {
        assert_eq!(
            refused(&prev, |next| {
                next.cursor_page_index = page;
                next.cursor_entry_index = entry;
            }),
            Err(MigrationExecutionError::RegressiveCheckpoint),
            "({page}, {entry})"
        );
    }
    for (page, entry) in [(1, 5), (1, 6), (2, 0)] {
        assert_eq!(
            refused(&prev, |next| {
                next.cursor_page_index = page;
                next.cursor_entry_index = entry;
            }),
            Ok(()),
            "({page}, {entry})"
        );
    }
    assert_eq!(
        refused(&prev, |next| {
            next.phase = phase_code::VERIFY;
            next.cursor_page_index = 0;
            next.cursor_entry_index = 0;
        }),
        Ok(())
    );
}

#[test]
fn the_cursor_lies_inside_the_successors_own_inventory() {
    let mut prev = rotate_at(phase_code::CONVERT, 4);
    prev.page_count = 3;
    prev.entry_count = 10;
    // Beyond the entry count or the page count, in the same phase and across a phase change.
    for (page, entry, error) in [
        (1, u32::MAX, JournalError::EntryCountMismatch),
        (1, 10, JournalError::EntryCountMismatch),
        (3, 0, JournalError::InvalidPageIndex),
    ] {
        for phase in [phase_code::CONVERT, phase_code::VERIFY] {
            assert_eq!(
                refused(&prev, |next| {
                    next.phase = phase;
                    next.cursor_page_index = page;
                    next.cursor_entry_index = entry;
                }),
                Err(MigrationExecutionError::Journal(error)),
                "({page}, {entry}) into phase {phase}"
            );
        }
    }
    // An empty inventory accepts only the canonical empty cursor, as `checkpoint_progress` does.
    let empty = rotate_at(phase_code::CONVERT, 4);
    assert_eq!(
        refused(&empty, |next| next.cursor_entry_index = 1),
        Err(MigrationExecutionError::Journal(
            JournalError::InvalidPageIndex
        ))
    );
}

#[test]
fn the_target_key_is_frozen_from_admit_and_the_inventory_from_convert() {
    let target_key: Change = |m| m.target_root_key_ref_digest = Some([0x43; 32]);
    let has_target_key: Change = |m| m.has_target_root_key_ref = false;
    let inventory_changes: [Change; 4] = [
        |m| m.inventory_digest = [0x11; 32],
        |m| m.entry_count += 1,
        |m| m.page_count += 1,
        |m| m.journal_page_set_digest = [0x22; 32],
    ];
    let verdict = |frozen: bool| {
        if frozen {
            Err(MigrationExecutionError::FrozenFieldChanged)
        } else {
            Ok(())
        }
    };
    // (phase of the predecessor, phase of the successor, target key frozen, inventory frozen):
    // the freezes bind the successor's phase, so entering ADMIT keeps the key and entering CONVERT
    // keeps the inventory.
    let table = [
        (phase_code::DISCOVER, phase_code::DISCOVER, false, false),
        (phase_code::DISCOVER, phase_code::PREPARE, false, false),
        (phase_code::PREPARE, phase_code::PREPARE, false, false),
        (phase_code::PREPARE, phase_code::ADMIT, true, false),
        (phase_code::ADMIT, phase_code::ADMIT, true, false),
        (phase_code::ADMIT, phase_code::CONVERT, true, true),
        (phase_code::CONVERT, phase_code::CONVERT, true, true),
        (phase_code::CONVERT, phase_code::VERIFY, true, true),
        (phase_code::VERIFY, phase_code::COMMIT, true, true),
        (
            phase_code::COMMIT,
            phase_code::RETIRE_OLD_AUTHORITY,
            true,
            true,
        ),
        (
            phase_code::RETIRE_OLD_AUTHORITY,
            phase_code::FINALIZE,
            true,
            true,
        ),
        (
            phase_code::PREPARE,
            phase_code::RECOVERY_REQUIRED,
            true,
            true,
        ),
    ];
    for (from, to, key_frozen, inventory_frozen) in table {
        let prev = rotate_at(from, 4);
        for change in [target_key, has_target_key] {
            assert_eq!(
                refused(&prev, |next| {
                    next.phase = to;
                    change(next);
                }),
                verdict(key_frozen),
                "target key {from} -> {to}"
            );
        }
        for change in inventory_changes {
            assert_eq!(
                refused(&prev, |next| {
                    next.phase = to;
                    change(next);
                }),
                verdict(inventory_frozen),
                "inventory {from} -> {to}"
            );
        }
    }
}

#[test]
fn the_recovery_reason_changes_only_when_entering_recovery_and_leases_are_unconstrained() {
    let prev = rotate_at(phase_code::PREPARE, 4);
    assert_eq!(
        refused(&prev, |next| next.recovery_reason_code = 3),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
    assert_eq!(
        refused(&prev, |next| {
            next.phase = phase_code::RECOVERY_REQUIRED;
            next.recovery_reason_code = 3;
        }),
        Ok(())
    );
    assert_eq!(
        refused(&prev, |next| {
            next.has_lease_owner = true;
            next.lease_owner_id = Some("owner-b".into());
            next.lease_expires_unix_ms = Some(1_000);
        }),
        Ok(())
    );
}

/// A committed manifest whose lease runs out at `expires`.
fn leased_until(expires: u64) -> JournalManifest {
    let mut prev = rotate_at(phase_code::PREPARE, 4);
    prev.has_lease_owner = true;
    prev.lease_owner_id = Some("old-owner".into());
    prev.lease_expires_unix_ms = Some(expires);
    prev
}

/// The claim a new owner would publish at `now`: fence + 1, revision + 1, its own lease.
fn claim(prev: &JournalManifest, now: u64) -> JournalManifest {
    let mut next = bumped(prev);
    next.fencing_generation += 1;
    next.has_lease_owner = true;
    next.lease_owner_id = Some("new-owner".into());
    next.lease_expires_unix_ms = Some(now + 100);
    next
}

fn claim_with(
    prev: &JournalManifest,
    now: u64,
    change: impl FnOnce(&mut JournalManifest),
) -> Result<(), MigrationExecutionError> {
    let mut next = claim(prev, now);
    change(&mut next);
    assert_takeover_successor(prev, &next, now)
}

#[test]
fn a_takeover_needs_an_expired_lease() {
    let prev = leased_until(1_000);
    assert_eq!(
        assert_takeover_successor(&prev, &claim(&prev, 999), 999),
        Err(MigrationExecutionError::LeaseNotExpired)
    );
    // A lease is expired when `now >= expires`, so the boundary itself is eligible.
    for now in [1_000, 1_001, 5_000] {
        assert_eq!(
            assert_takeover_successor(&prev, &claim(&prev, now), now),
            Ok(()),
            "now {now}"
        );
    }
    // A manifest without a lease owner has no unexpired lease to wait for.
    let unowned = rotate_at(phase_code::PREPARE, 4);
    assert_eq!(
        assert_takeover_successor(&unowned, &claim(&unowned, 0), 0),
        Ok(())
    );
}

#[test]
fn a_takeover_advances_the_fence_and_the_revision_by_exactly_one() {
    let prev = leased_until(1_000);
    let now = 2_000;
    let cases: [(&str, Change, MigrationExecutionError); 6] = [
        (
            "the same fence",
            |m| m.fencing_generation -= 1,
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "an older fence",
            |m| m.fencing_generation -= 2,
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "a skipped fence",
            |m| m.fencing_generation += 1,
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "the committed revision",
            |m| m.journal_revision -= 1,
            MigrationExecutionError::StaleJournalRevision,
        ),
        (
            "a skipped revision",
            |m| m.journal_revision += 1,
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "another operation",
            |m| m.operation_id = "other-op".into(),
            MigrationExecutionError::LiveBindingMismatch,
        ),
    ];
    for (name, change, expected) in cases {
        assert_eq!(claim_with(&prev, now, change), Err(expected), "{name}");
    }
}

#[test]
fn the_new_owner_must_hold_a_lease_that_outlives_now() {
    let prev = leased_until(1_000);
    let now = 2_000;
    let no_owner: Change = |m| {
        m.has_lease_owner = false;
        m.lease_owner_id = None;
        m.lease_expires_unix_ms = None;
    };
    let expiring_now: Change = |m| m.lease_expires_unix_ms = Some(2_000);
    let already_expired: Change = |m| m.lease_expires_unix_ms = Some(1_999);
    for (name, change) in [
        ("no lease owner", no_owner),
        ("a lease that expires at now", expiring_now),
        ("a lease that already expired", already_expired),
    ] {
        assert_eq!(
            claim_with(&prev, now, change),
            Err(MigrationExecutionError::InvalidTakeoverLease),
            "{name}"
        );
    }
}

#[test]
fn a_takeover_moves_ownership_only_and_never_a_terminal_journal() {
    let prev = leased_until(1_000);
    let now = 2_000;
    let changes: [(&str, Change); 6] = [
        ("the phase", |m| m.phase = phase_code::ADMIT),
        ("the cursor", |m| m.cursor_entry_index = 1),
        ("the inventory", |m| m.entry_count += 1),
        ("the target key", |m| {
            m.target_root_key_ref_digest = Some([0x43; 32])
        }),
        ("the recovery reason", |m| m.recovery_reason_code = 3),
        ("the operation type", |m| {
            m.operation_type = operation_type::ENABLE
        }),
    ];
    for (name, change) in changes {
        assert_eq!(
            claim_with(&prev, now, change),
            Err(MigrationExecutionError::FrozenFieldChanged),
            "{name}"
        );
    }
    for terminal in [phase_code::DONE, phase_code::RECOVERY_REQUIRED] {
        let mut ended = leased_until(1_000);
        ended.phase = terminal;
        assert_eq!(
            assert_takeover_successor(&ended, &claim(&ended, now), now),
            Err(MigrationExecutionError::TerminalPhase),
            "{terminal}"
        );
    }
}

#[test]
fn takeover_authority_is_the_committed_binding_plus_one_fence_and_one_revision() {
    let committed = LiveMigration {
        operation_id: "successor-op".into(),
        fencing_generation: 7,
        journal_revision: 4,
        manifest_digest: [0x22; 32],
    };
    let at = |operation: &str, fence: u64, revision: u64| LiveMigration {
        operation_id: operation.into(),
        fencing_generation: fence,
        journal_revision: revision,
        manifest_digest: [0x33; 32],
    };
    let table = [
        ("the takeover", at("successor-op", 8, 5), Ok(())),
        (
            "the same fence",
            at("successor-op", 7, 5),
            Err(MigrationExecutionError::StaleMigrationOwner),
        ),
        (
            "a skipped fence",
            at("successor-op", 9, 5),
            Err(MigrationExecutionError::LiveBindingMismatch),
        ),
        (
            "the committed revision",
            at("successor-op", 8, 4),
            Err(MigrationExecutionError::StaleJournalRevision),
        ),
        (
            "a skipped revision",
            at("successor-op", 8, 6),
            Err(MigrationExecutionError::LiveBindingMismatch),
        ),
        (
            "another operation",
            at("other-op", 8, 5),
            Err(MigrationExecutionError::LiveBindingMismatch),
        ),
        (
            "an overflowing fence",
            at("successor-op", u64::MAX, 5),
            Err(MigrationExecutionError::LiveBindingMismatch),
        ),
    ];
    for (name, next, expected) in table {
        assert_eq!(
            assert_binding_takeover(&committed, &next),
            expected,
            "{name}"
        );
        let mut manifest = rotate_at(phase_code::PREPARE, next.journal_revision);
        manifest.operation_id = next.operation_id.clone();
        manifest.fencing_generation = next.fencing_generation;
        assert_eq!(
            assert_takeover_promote_authority(&manifest, Some(&committed)),
            expected,
            "{name}"
        );
    }
    // A takeover needs a committed journal.
    let manifest = rotate_at(phase_code::PREPARE, 1);
    assert_eq!(
        assert_takeover_promote_authority(&manifest, None),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
}
