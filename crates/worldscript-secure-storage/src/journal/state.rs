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
    /// A successor manifest changed a field that is frozen for its predecessor's phase.
    FrozenFieldChanged,
    Journal(JournalError),
}

impl From<JournalError> for MigrationExecutionError {
    fn from(value: JournalError) -> Self {
        Self::Journal(value)
    }
}

/// §10.3 phase code carried as a typed value instead of a bare `u32`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MigrationPhase(u32);

impl MigrationPhase {
    pub const fn from_wire(code: u32) -> Self {
        Self(code)
    }

    pub fn wire(self) -> u32 {
        self.0
    }
}

/// Authenticated manifest envelope `content_digest` (§5.4, §10.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ManifestEnvelopeDigest([u8; 32]);

impl ManifestEnvelopeDigest {
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Paged inventory extent named by a journal manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JournalInventoryExtent {
    pub page_count: u32,
    pub entry_count: u32,
}

impl JournalInventoryExtent {
    pub fn from_manifest(manifest: &JournalManifest) -> Self {
        Self {
            page_count: manifest.page_count,
            entry_count: manifest.entry_count,
        }
    }
}

/// Durable terminal refusal reason code stored in the manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryReasonCode(u32);

impl RecoveryReasonCode {
    pub const fn new(code: u32) -> Self {
        Self(code)
    }

    pub fn wire(self) -> u32 {
        self.0
    }
}

/// Monotonic journal manifest generation (§10.1.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct JournalRevision(u64);

impl JournalRevision {
    pub const fn from_wire(revision: u64) -> Self {
        Self(revision)
    }

    pub fn wire(self) -> u64 {
        self.0
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

    fn ensure_page_in_range(
        self,
        extent: JournalInventoryExtent,
    ) -> Result<(), MigrationExecutionError> {
        if extent.page_count > 0 && self.page_index >= extent.page_count {
            Err(JournalError::InvalidPageIndex.into())
        } else {
            Ok(())
        }
    }

    fn ensure_entry_in_range(
        self,
        extent: JournalInventoryExtent,
    ) -> Result<(), MigrationExecutionError> {
        if extent.entry_count > 0 && self.entry_index >= extent.entry_count {
            Err(JournalError::EntryCountMismatch.into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn validate_for_extent(
        self,
        extent: JournalInventoryExtent,
    ) -> Result<(), MigrationExecutionError> {
        if extent.page_count == 0 && extent.entry_count == 0 {
            return self.ensure_empty_inventory_cursor();
        }
        self.ensure_page_in_range(extent)?;
        self.ensure_entry_in_range(extent)?;
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
pub fn is_terminal_phase(phase: MigrationPhase) -> bool {
    let code = phase.wire();
    code == phase_code::DONE || code == phase_code::RECOVERY_REQUIRED
}

/// Ordinary mutating writes during `PREPARE` (before the exclusive `ADMIT` barrier) and after `DONE` (§10.3).
pub fn ordinary_mutating_writes_admitted(phase: MigrationPhase) -> bool {
    matches!(phase.wire(), phase_code::DONE | phase_code::PREPARE)
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
    manifest_content_digest: ManifestEnvelopeDigest,
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
    if manifest_content_digest.as_bytes() != &live.manifest_digest {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    Ok(())
}

/// Refuses a manifest promotion whose caller is not the committed owner's next revision (§10.1).
///
/// `committed` is the root's live-migration binding. `None` means the root names no live
/// migration, which admits only the bootstrap revision `0`. A durable generation ahead of the
/// root is a candidate, never authority (§10.1.1), so `r + 1` is the only successor of a
/// committed `r`. This compares the caller's token with the committed binding; the caller's own
/// manifest/fence pair is checked separately by [`assert_fence`].
pub fn assert_manifest_promote_authority(
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> Result<(), MigrationExecutionError> {
    assert_promote_authority(manifest, committed, 1)
}

/// Refuses a page promotion whose manifest is not the generation the committed root names.
///
/// A page is written under the committed manifest `r` and becomes reachable only when the
/// successor manifest `r + 1` names it (§10.1.1). `None` admits only the bootstrap revision `0`.
pub fn assert_page_promote_authority(
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> Result<(), MigrationExecutionError> {
    assert_promote_authority(manifest, committed, 0)
}

fn assert_promote_authority(
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
    successor_offset: u64,
) -> Result<(), MigrationExecutionError> {
    let Some(live) = committed else {
        return if manifest.journal_revision == 0 {
            Ok(())
        } else {
            Err(MigrationExecutionError::LiveBindingMismatch)
        };
    };
    if manifest.operation_id != live.operation_id {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    if manifest.fencing_generation != live.fencing_generation {
        return Err(MigrationExecutionError::StaleMigrationOwner);
    }
    let Some(expected) = live.journal_revision.checked_add(successor_offset) else {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    };
    match manifest.journal_revision.cmp(&expected) {
        std::cmp::Ordering::Less => Err(MigrationExecutionError::StaleJournalRevision),
        std::cmp::Ordering::Equal => Ok(()),
        std::cmp::Ordering::Greater => Err(MigrationExecutionError::LiveBindingMismatch),
    }
}

/// Refuses a root binding advance that is not the journal owner's next revision of `prev` (§5.4).
///
/// Same operation, same fencing generation, and `journal_revision + 1`: an owner takeover changes
/// the fence and is a different transition, and a skipped revision would name a manifest the
/// previous binding never led to.
pub fn assert_binding_successor(
    prev: &LiveMigration,
    next: &LiveMigration,
) -> Result<(), MigrationExecutionError> {
    if next.operation_id != prev.operation_id {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    if next.fencing_generation != prev.fencing_generation {
        return Err(MigrationExecutionError::StaleMigrationOwner);
    }
    let Some(expected) = prev.journal_revision.checked_add(1) else {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    };
    match next.journal_revision.cmp(&expected) {
        std::cmp::Ordering::Less => Err(MigrationExecutionError::StaleJournalRevision),
        std::cmp::Ordering::Equal => Ok(()),
        std::cmp::Ordering::Greater => Err(MigrationExecutionError::LiveBindingMismatch),
    }
}

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

/// Resolves the manifest revision the root still names (§10.1.1).
pub fn authoritative_manifest_revision(
    live: &LiveMigration,
    candidate_revision: JournalRevision,
) -> Result<JournalRevision, MigrationExecutionError> {
    let candidate = candidate_revision.wire();
    if candidate < live.journal_revision {
        return Err(MigrationExecutionError::StaleJournalRevision);
    }
    if candidate > live.journal_revision {
        Ok(JournalRevision::from_wire(live.journal_revision))
    } else {
        Ok(candidate_revision)
    }
}

fn phase_rank(phase: MigrationPhase) -> Result<u32, MigrationExecutionError> {
    Ok(match phase.wire() {
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
pub fn allows_phase_transition(from: MigrationPhase, to: MigrationPhase) -> bool {
    if from == to {
        return phase_rank(from).is_ok();
    }
    if is_terminal_phase(from) {
        return false;
    }
    if to.wire() == phase_code::RECOVERY_REQUIRED {
        return phase_rank(from).is_ok();
    }
    match (phase_rank(from), phase_rank(to)) {
        (Ok(left), Ok(right)) => right == left + 1,
        _ => false,
    }
}

fn bump_revision(manifest: &JournalManifest) -> Result<JournalRevision, MigrationExecutionError> {
    manifest
        .journal_revision
        .checked_add(1)
        .map(JournalRevision::from_wire)
        .ok_or(MigrationExecutionError::Journal(
            JournalError::InvalidCounter,
        ))
}

fn validate_checkpoint_cursor(
    manifest: &JournalManifest,
    cursor: JournalCheckpointCursor,
) -> Result<(), MigrationExecutionError> {
    cursor.validate_for_extent(JournalInventoryExtent::from_manifest(manifest))
}

fn manifest_phase(manifest: &JournalManifest) -> MigrationPhase {
    MigrationPhase::from_wire(manifest.phase)
}

/// Advances to the next migration phase, bumping `journal_revision` when the phase changes (§10.1.1).
pub fn transition_phase(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    to_phase: MigrationPhase,
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    if is_terminal_phase(manifest_phase(manifest)) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if !allows_phase_transition(manifest_phase(manifest), to_phase) {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    let mut next = manifest.clone();
    if next.phase != to_phase.wire() {
        next.journal_revision = bump_revision(manifest)?.wire();
        next.phase = to_phase.wire();
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
    if is_terminal_phase(manifest_phase(manifest)) {
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
    next.journal_revision = bump_revision(manifest)?.wire();
    next.cursor_page_index = cursor.page_index;
    next.cursor_entry_index = cursor.entry_index;
    next.encode()?;
    Ok(next)
}

/// Moves the operation into durable terminal refusal with an explicit reason code.
pub fn mark_recovery(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    recovery_reason_code: RecoveryReasonCode,
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    if is_terminal_phase(manifest_phase(manifest)) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    phase_rank(manifest_phase(manifest))?;
    let mut next = manifest.clone();
    next.journal_revision = bump_revision(manifest)?.wire();
    next.phase = phase_code::RECOVERY_REQUIRED;
    next.recovery_reason_code = recovery_reason_code.wire();
    next.encode()?;
    Ok(next)
}

/// Marks successful terminal completion; requires passing through `FINALIZE`.
pub fn mark_done(
    manifest: &JournalManifest,
    fence: &MigrationFence,
) -> Result<JournalManifest, MigrationExecutionError> {
    transition_phase(manifest, fence, MigrationPhase::from_wire(phase_code::DONE))
}
