//! Gate 4D successor relation (§10.3): what a manifest may change between two committed revisions.
//!
//! One pure predicate over the committed manifest and its successor, mirroring what the transition
//! constructors in `state.rs` produce plus the freezes §10.3 states. Publishing and the root binding
//! advance both enforce it.

use super::manifest::JournalManifest;
use super::phase_code;
use super::state::{
    allows_phase_transition, is_terminal_phase, manifest_phase, phase_rank,
    validate_checkpoint_cursor, JournalCheckpointCursor, MigrationExecutionError, MigrationPhase,
};

/// Refuses a manifest that is not a valid successor of `prev`, the manifest the root names (§10.3).
///
/// The rules mirror what [`transition_phase`], [`checkpoint_progress`] and [`mark_recovery`]
/// produce, plus the freezes §10.3 states: the successor carries `journal_revision + 1`; the
/// operation, type, epochs, fencing generation and inventory version never change; the phase is
/// unchanged, the next one, or `RECOVERY_REQUIRED`, and never leaves a terminal phase; the cursor
/// lies inside the successor's own inventory and does not regress within a phase; the target key
/// reference is frozen once the successor is at `ADMIT` or later and the inventory fields once it
/// is at `CONVERT` or later (the target key is durable in `PREPARE`, the final inventory is
/// captured in `ADMIT`); the recovery reason changes only on entering
/// `RECOVERY_REQUIRED`. Lease fields and the cursor across a phase change are not constrained here.
pub fn assert_manifest_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    assert_successor_revision(prev, next)?;
    assert_operation_kept(prev, next)?;
    assert_phase_successor(prev, next)?;
    assert_frozen_fields_kept(prev, next)?;
    assert_cursor_successor(prev, next)
}

fn assert_successor_revision(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    let Some(expected) = prev.journal_revision.checked_add(1) else {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    };
    match next.journal_revision.cmp(&expected) {
        std::cmp::Ordering::Less => Err(MigrationExecutionError::StaleJournalRevision),
        std::cmp::Ordering::Equal => Ok(()),
        std::cmp::Ordering::Greater => Err(MigrationExecutionError::LiveBindingMismatch),
    }
}

fn assert_operation_kept(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    if next.operation_id != prev.operation_id {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    if next.fencing_generation != prev.fencing_generation {
        return Err(MigrationExecutionError::StaleMigrationOwner);
    }
    let kept = next.operation_type == prev.operation_type
        && next.source_epoch == prev.source_epoch
        && next.target_epoch == prev.target_epoch
        && next.inventory_version == prev.inventory_version;
    if kept {
        Ok(())
    } else {
        Err(MigrationExecutionError::FrozenFieldChanged)
    }
}

fn assert_phase_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    let (from, to) = (manifest_phase(prev), manifest_phase(next));
    if is_terminal_phase(from) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if !allows_phase_transition(from, to) {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    Ok(())
}

/// Whether `phase` is at or past `milestone` in the §10.3 order.
fn phase_reached(phase: MigrationPhase, milestone: u32) -> bool {
    match (
        phase_rank(phase),
        phase_rank(MigrationPhase::from_wire(milestone)),
    ) {
        (Ok(rank), Ok(floor)) => rank >= floor,
        _ => false,
    }
}

fn assert_frozen_fields_kept(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    // The freezes bind the successor's phase: entering `ADMIT` already keeps the key made durable in
    // `PREPARE`, and entering `CONVERT` already keeps the inventory captured in `ADMIT`.
    let phase = manifest_phase(next);
    let target_key_kept = next.has_target_root_key_ref == prev.has_target_root_key_ref
        && next.target_root_key_ref_digest == prev.target_root_key_ref_digest;
    let inventory_kept = next.inventory_digest == prev.inventory_digest
        && next.entry_count == prev.entry_count
        && next.page_count == prev.page_count
        && next.journal_page_set_digest == prev.journal_page_set_digest;
    let recovery_kept = next.phase == phase_code::RECOVERY_REQUIRED
        || next.recovery_reason_code == prev.recovery_reason_code;
    let frozen_ok = (target_key_kept || !phase_reached(phase, phase_code::ADMIT))
        && (inventory_kept || !phase_reached(phase, phase_code::CONVERT))
        && recovery_kept;
    if frozen_ok {
        Ok(())
    } else {
        Err(MigrationExecutionError::FrozenFieldChanged)
    }
}

fn assert_cursor_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    // The cursor must lie inside the successor's own inventory, exactly as `checkpoint_progress` requires.
    validate_checkpoint_cursor(
        next,
        JournalCheckpointCursor::new(next.cursor_page_index, next.cursor_entry_index),
    )?;
    if next.phase != prev.phase {
        return Ok(());
    }
    let before = JournalCheckpointCursor::new(prev.cursor_page_index, prev.cursor_entry_index);
    let after = JournalCheckpointCursor::new(next.cursor_page_index, next.cursor_entry_index);
    if after < before {
        Err(MigrationExecutionError::RegressiveCheckpoint)
    } else {
        Ok(())
    }
}
