use worldscript_secure_storage::{
    allows_phase_transition, assert_live_binding, authoritative_manifest_revision,
    checkpoint_progress, empty_inventory_digest, empty_journal_page_set_digest, is_terminal_phase,
    mark_done, mark_recovery, operation_type, ordinary_mutating_writes_admitted, phase_code,
    transition_phase, JournalCheckpointCursor, JournalError, JournalManifest, JournalRevision,
    LiveMigration, ManifestEnvelopeDigest, MigrationExecutionError, MigrationFence, MigrationPhase,
    RecoveryReasonCode,
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
