//! Gate 4D successor relation (§10.3): what a manifest may change between two committed revisions.
//!
//! One pure predicate over the committed manifest and its successor, mirroring what the transition
//! constructors in `state.rs` produce plus the freezes §10.3 states. Publishing and the root binding
//! advance both enforce it.

use super::manifest::JournalManifest;
use super::phase_code;
use super::state::{
    allows_phase_transition, is_terminal_phase, manifest_phase, phase_reached,
    validate_checkpoint_cursor, JournalCheckpointCursor, MigrationExecutionError,
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

/// Refuses a manifest that is not a valid successor of `prev` that leaves the inventory alone (§10.3).
///
/// A progress checkpoint (phase, cursor, lease, recovery) never changes the inventory fields (page
/// count, entry count, `inventory_digest`, `journal_page_set_digest`): only a capture does, and a
/// capture writes its pages first (`commit_inventory_capture`). The root enforces this where it
/// starts to trust a manifest, so it never names a page set that no capture wrote.
pub fn assert_progress_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    assert_manifest_successor(prev, next)?;
    frozen_when(true, inventory(prev) == inventory(next))
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
    frozen_when(true, identity(prev) == identity(next))
}

/// Operation type, epochs and inventory version: fixed for the life of the operation.
fn identity(manifest: &JournalManifest) -> (u32, u64, u64, u32) {
    (
        manifest.operation_type,
        manifest.source_epoch,
        manifest.target_epoch,
        manifest.inventory_version,
    )
}

/// `Ok` unless the freeze applies (`frozen`) and the field group changed (`!kept`).
fn frozen_when(frozen: bool, kept: bool) -> Result<(), MigrationExecutionError> {
    if frozen && !kept {
        Err(MigrationExecutionError::FrozenFieldChanged)
    } else {
        Ok(())
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

fn assert_frozen_fields_kept(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    // The freezes bind the successor's phase: entering `ADMIT` already keeps the key made durable in
    // `PREPARE`, and entering `CONVERT` already keeps the inventory captured in `ADMIT`.
    let phase = manifest_phase(next);
    frozen_when(
        phase_reached(phase, phase_code::ADMIT),
        target_key(prev) == target_key(next),
    )?;
    frozen_when(
        phase_reached(phase, phase_code::CONVERT),
        inventory(prev) == inventory(next),
    )?;
    frozen_when(
        next.phase != phase_code::RECOVERY_REQUIRED,
        next.recovery_reason_code == prev.recovery_reason_code,
    )
}

/// The target key reference made durable in `PREPARE`.
fn target_key(manifest: &JournalManifest) -> (bool, Option<[u8; 32]>) {
    (
        manifest.has_target_root_key_ref,
        manifest.target_root_key_ref_digest,
    )
}

/// The inventory captured in `ADMIT`: digest, counts and page-set digest.
fn inventory(manifest: &JournalManifest) -> ([u8; 32], u32, u32, [u8; 32]) {
    (
        manifest.inventory_digest,
        manifest.entry_count,
        manifest.page_count,
        manifest.journal_page_set_digest,
    )
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
