//! Gate 4 slice 4D (part A): migration journal execution state — phase order, fence checks, and
//! authoritative revision selection against the root live-migration binding (§10.1, §10.3).
//! Durable I/O, record conversion, and root binding updates follow in later 4D slices.

use crate::root::LiveMigration;

use super::manifest::JournalManifest;
use super::{phase_code, JournalError};

/// Typed migration execution refusal; never conflated with record absence or plaintext fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MigrationExecutionError {
    StaleMigrationOwner,
    StaleJournalRevision,
    InvalidPhaseTransition,
    TerminalPhase,
    LiveBindingMismatch,
    RecoveryRequired,
    RegressiveCheckpoint,
    Journal(JournalError),
}

impl From<JournalError> for MigrationExecutionError {
    fn from(value: JournalError) -> Self {
        Self::Journal(value)
    }
}

/// Checkpoint cursor coordinates validated against manifest inventory bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct JournalCheckpointCursor {
    pub page_index: u32,
    pub entry_index: u32,
}

impl JournalCheckpointCursor {
    pub const EMPTY: Self = Self {
        page_index: 0,
        entry_index: 0,
    };

    pub fn new(page_index: u32, entry_index: u32) -> Self {
        Self {
            page_index,
            entry_index,
        }
    }

    fn ensure_empty_inventory_cursor(self) -> Result<(), MigrationExecutionError> {
        if self != Self::EMPTY {
            Err(JournalError::InvalidPageIndex.into())
        } else {
            Ok(())
        }
    }

    fn ensure_page_in_range(self, page_count: u32) -> Result<(), MigrationExecutionError> {
        if page_count > 0 && self.page_index >= page_count {
            Err(JournalError::InvalidPageIndex.into())
        } else {
            Ok(())
        }
    }

    fn ensure_entry_in_range(self, entry_count: u32) -> Result<(), MigrationExecutionError> {
        if entry_count > 0 && self.entry_index >= entry_count {
            Err(JournalError::EntryCountMismatch.into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn validate_for_inventory(
        self,
        page_count: u32,
        entry_count: u32,
    ) -> Result<(), MigrationExecutionError> {
        if page_count == 0 && entry_count == 0 {
            return self.ensure_empty_inventory_cursor();
        }
        self.ensure_page_in_range(page_count)?;
        self.ensure_entry_in_range(entry_count)?;
        Ok(())
    }
}

/// The fence token every mutation-capable migration step must match (§10.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrationFence {
    pub fencing_generation: u64,
    pub journal_revision: u64,
}

impl MigrationFence {
    pub fn from_manifest(manifest: &JournalManifest) -> Self {
        Self {
            fencing_generation: manifest.fencing_generation,
            journal_revision: manifest.journal_revision,
        }
    }
}

/// Returns whether `phase` is terminal success or terminal refusal.
pub fn is_terminal_phase(phase: u32) -> bool {
    phase == phase_code::DONE || phase == phase_code::RECOVERY_REQUIRED
}

/// Ordinary mutating writes during `PREPARE` (before the exclusive `ADMIT` barrier) and after `DONE` (§10.3).
pub fn ordinary_mutating_writes_admitted(phase: u32) -> bool {
    phase == phase_code::DONE || phase == phase_code::PREPARE
}

/// Refuses when the manifest fence/revision disagrees with the caller's token.
pub fn assert_fence(
    manifest: &JournalManifest,
    fence: &MigrationFence,
) -> Result<(), MigrationExecutionError> {
    if manifest.fencing_generation != fence.fencing_generation
        || manifest.journal_revision != fence.journal_revision
    {
        return Err(MigrationExecutionError::StaleMigrationOwner);
    }
    Ok(())
}

/// Refuses when the manifest disagrees with the committed root live-migration binding (§5.4, §10.1.1).
pub fn assert_live_binding(
    manifest: &JournalManifest,
    live: &LiveMigration,
    manifest_content_digest: [u8; 32],
) -> Result<(), MigrationExecutionError> {
    if manifest.operation_id != live.operation_id {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    if manifest.fencing_generation != live.fencing_generation {
        return Err(MigrationExecutionError::StaleMigrationOwner);
    }
    if manifest.journal_revision != live.journal_revision {
        return Err(MigrationExecutionError::StaleJournalRevision);
    }
    if manifest_content_digest != live.manifest_digest {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    Ok(())
}

/// Resolves the manifest revision the root still names (§10.1.1).
pub fn authoritative_manifest_revision(
    live: &LiveMigration,
    candidate_revision: u64,
) -> Result<u64, MigrationExecutionError> {
    if candidate_revision < live.journal_revision {
        return Err(MigrationExecutionError::StaleJournalRevision);
    }
    if candidate_revision > live.journal_revision {
        Ok(live.journal_revision)
    } else {
        Ok(candidate_revision)
    }
}

fn phase_rank(phase: u32) -> Result<u32, MigrationExecutionError> {
    Ok(match phase {
        phase_code::BOOTSTRAP_TARGET => 0,
        phase_code::DISCOVER => 1,
        phase_code::PREPARE => 2,
        phase_code::ADMIT => 3,
        phase_code::CONVERT => 4,
        phase_code::VERIFY => 5,
        phase_code::COMMIT => 6,
        phase_code::RETIRE_OLD_AUTHORITY => 7,
        phase_code::FINALIZE => 8,
        phase_code::DONE => 9,
        phase_code::RECOVERY_REQUIRED => 10,
        other => return Err(JournalError::UnsupportedPhase(other).into()),
    })
}

/// Whether `to` is an allowed idempotent or forward transition from `from` (§10.3 ordering).
pub fn allows_phase_transition(from: u32, to: u32) -> bool {
    if from == to {
        return phase_rank(from).is_ok();
    }
    if is_terminal_phase(from) {
        return false;
    }
    if to == phase_code::RECOVERY_REQUIRED {
        return phase_rank(from).is_ok();
    }
    match (phase_rank(from), phase_rank(to)) {
        (Ok(left), Ok(right)) => right == left + 1,
        _ => false,
    }
}

fn bump_revision(manifest: &JournalManifest) -> Result<u64, MigrationExecutionError> {
    manifest
        .journal_revision
        .checked_add(1)
        .ok_or(MigrationExecutionError::Journal(
            JournalError::InvalidCounter,
        ))
}

fn validate_checkpoint_cursor(
    manifest: &JournalManifest,
    cursor: JournalCheckpointCursor,
) -> Result<(), MigrationExecutionError> {
    cursor.validate_for_inventory(manifest.page_count, manifest.entry_count)
}

/// Advances to the next migration phase, bumping `journal_revision` when the phase changes (§10.1.1).
pub fn transition_phase(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    to_phase: u32,
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    if is_terminal_phase(manifest.phase) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if !allows_phase_transition(manifest.phase, to_phase) {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    let mut next = manifest.clone();
    if next.phase != to_phase {
        next.journal_revision = bump_revision(manifest)?;
        next.phase = to_phase;
    }
    next.encode()?;
    Ok(next)
}

/// Records durable progress after a verified checkpoint without changing phase.
pub fn checkpoint_progress(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    cursor: JournalCheckpointCursor,
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    if is_terminal_phase(manifest.phase) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if manifest.phase == phase_code::RECOVERY_REQUIRED {
        return Err(MigrationExecutionError::RecoveryRequired);
    }
    validate_checkpoint_cursor(manifest, cursor)?;
    let current =
        JournalCheckpointCursor::new(manifest.cursor_page_index, manifest.cursor_entry_index);
    if cursor < current {
        return Err(MigrationExecutionError::RegressiveCheckpoint);
    }
    let mut next = manifest.clone();
    next.journal_revision = bump_revision(manifest)?;
    next.cursor_page_index = cursor.page_index;
    next.cursor_entry_index = cursor.entry_index;
    next.encode()?;
    Ok(next)
}

/// Moves the operation into durable terminal refusal with an explicit reason code.
pub fn mark_recovery(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    recovery_reason_code: u32,
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    if is_terminal_phase(manifest.phase) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    phase_rank(manifest.phase)?;
    let mut next = manifest.clone();
    next.journal_revision = bump_revision(manifest)?;
    next.phase = phase_code::RECOVERY_REQUIRED;
    next.recovery_reason_code = recovery_reason_code;
    next.encode()?;
    Ok(next)
}

/// Marks successful terminal completion; requires passing through `FINALIZE`.
pub fn mark_done(
    manifest: &JournalManifest,
    fence: &MigrationFence,
) -> Result<JournalManifest, MigrationExecutionError> {
    transition_phase(manifest, fence, phase_code::DONE)
}
