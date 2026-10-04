use worldscript_secure_storage::{
    allows_phase_transition, assert_live_binding, authoritative_manifest_revision,
    checkpoint_progress, empty_inventory_digest, empty_journal_page_set_digest, is_terminal_phase,
    mark_done, mark_recovery, operation_type, ordinary_mutating_writes_admitted, phase_code,
    transition_phase, JournalManifest, LiveMigration, MigrationExecutionError, MigrationFence,
};

fn rotate_bootstrap(operation_id: &str, phase: u32, revision: u64, fence: u64) -> JournalManifest {
    rotate_with_inventory(operation_id, phase, revision, fence, 0, 0)
}

fn rotate_with_inventory(
    operation_id: &str,
    phase: u32,
    revision: u64,
    fence: u64,
    page_count: u32,
    entry_count: u32,
) -> JournalManifest {
    JournalManifest {
        operation_id: operation_id.into(),
        journal_revision: revision,
        operation_type: operation_type::ROTATE,
        phase,
        source_epoch: 1,
        target_epoch: 2,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: fence,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count,
        entry_count,
        journal_page_set_digest: empty_journal_page_set_digest(),
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
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
        assert!(allows_phase_transition(window[0], window[1]));
    }
    assert!(!allows_phase_transition(
        phase_code::DISCOVER,
        phase_code::CONVERT
    ));
    assert!(allows_phase_transition(
        phase_code::CONVERT,
        phase_code::RECOVERY_REQUIRED
    ));
    assert!(!allows_phase_transition(999, 999));
}

#[test]
fn transition_phase_bumps_revision_on_forward_change() {
    let manifest = rotate_bootstrap("op-a", phase_code::BOOTSTRAP_TARGET, 1, 1);
    let fence = MigrationFence::from_manifest(&manifest);
    let discover = transition_phase(&manifest, &fence, phase_code::DISCOVER).unwrap();
    assert_eq!(discover.phase, phase_code::DISCOVER);
    assert_eq!(discover.journal_revision, 2);
}

#[test]
fn checkpoint_bumps_revision_and_moves_cursor_within_inventory() {
    let manifest = rotate_with_inventory("op-b", phase_code::CONVERT, 4, 2, 1, 5);
    let fence = MigrationFence::from_manifest(&manifest);
    let checkpoint = checkpoint_progress(&manifest, &fence, 0, 3).unwrap();
    assert_eq!(checkpoint.journal_revision, 5);
    assert_eq!(checkpoint.cursor_entry_index, 3);
    assert_eq!(checkpoint.fencing_generation, 2);
}

#[test]
fn empty_inventory_accepts_only_canonical_empty_cursor() {
    let manifest = rotate_bootstrap("op-empty", phase_code::CONVERT, 1, 1);
    let fence = MigrationFence::from_manifest(&manifest);
    assert!(checkpoint_progress(&manifest, &fence, 0, 0).is_ok());
    assert!(checkpoint_progress(&manifest, &fence, 0, 1).is_err());
}

#[test]
fn checkpoint_refuses_regressive_cursor_and_out_of_range_entry() {
    let manifest = rotate_with_inventory("op-reg", phase_code::CONVERT, 2, 1, 1, 2);
    let fence = MigrationFence::from_manifest(&manifest);
    let advanced = checkpoint_progress(&manifest, &fence, 0, 1).unwrap();
    let advanced_fence = MigrationFence::from_manifest(&advanced);
    assert_eq!(
        checkpoint_progress(&advanced, &advanced_fence, 0, 0),
        Err(MigrationExecutionError::RegressiveCheckpoint)
    );
    assert!(checkpoint_progress(&manifest, &fence, 0, u32::MAX).is_err());
}

#[test]
fn stale_fence_is_refused_before_mutation() {
    let manifest = rotate_bootstrap("op-c", phase_code::PREPARE, 2, 5);
    let stale = MigrationFence {
        fencing_generation: 4,
        journal_revision: 2,
    };
    assert_eq!(
        transition_phase(&manifest, &stale, phase_code::ADMIT),
        Err(MigrationExecutionError::StaleMigrationOwner)
    );
}

#[test]
fn live_binding_requires_exact_manifest_digest_and_revision() {
    let digest = [0x11; 32];
    let live = LiveMigration {
        operation_id: "op-d".into(),
        fencing_generation: 1,
        journal_revision: 3,
        manifest_digest: digest,
    };
    assert_eq!(authoritative_manifest_revision(&live, 3).unwrap(), 3);
    assert_eq!(authoritative_manifest_revision(&live, 5).unwrap(), 3);
    assert_eq!(
        authoritative_manifest_revision(&live, 2),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
    let manifest = rotate_bootstrap("op-d", phase_code::CONVERT, 3, 1);
    assert!(assert_live_binding(&manifest, &live, digest).is_ok());
    assert_eq!(
        assert_live_binding(&manifest, &live, [0x22; 32]),
        Err(MigrationExecutionError::LiveBindingMismatch)
    );
    let ahead = rotate_bootstrap("op-d", phase_code::CONVERT, 4, 1);
    assert_eq!(
        assert_live_binding(&ahead, &live, digest),
        Err(MigrationExecutionError::StaleJournalRevision)
    );
}

#[test]
fn recovery_and_done_are_terminal_and_prepare_admits_writes() {
    let manifest = rotate_bootstrap("op-e", phase_code::FINALIZE, 9, 1);
    let fence = MigrationFence::from_manifest(&manifest);
    let recovery = mark_recovery(&manifest, &fence, 42).unwrap();
    assert_eq!(recovery.phase, phase_code::RECOVERY_REQUIRED);
    assert_eq!(recovery.recovery_reason_code, 42);
    assert!(is_terminal_phase(recovery.phase));
    assert!(!ordinary_mutating_writes_admitted(recovery.phase));
    let recovery_fence = MigrationFence::from_manifest(&recovery);
    assert_eq!(
        mark_recovery(&recovery, &recovery_fence, 99),
        Err(MigrationExecutionError::TerminalPhase)
    );
    assert!(ordinary_mutating_writes_admitted(phase_code::PREPARE));
    let done_manifest = rotate_bootstrap("op-f", phase_code::FINALIZE, 9, 1);
    let done_fence = MigrationFence::from_manifest(&done_manifest);
    let done = mark_done(&done_manifest, &done_fence).unwrap();
    assert_eq!(done.phase, phase_code::DONE);
    assert_eq!(done.journal_revision, 10);
    assert!(ordinary_mutating_writes_admitted(done.phase));
}
