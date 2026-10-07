//! Gate 4D owner takeover (§10.1): the predicates that make a new owner the committed one.
//!
//! Lease expiry makes a new owner eligible, and the new owner must atomically advance the fencing
//! generation. These pure checks cover the claim itself, its authority against the committed binding
//! and the binding advance; the durable and root sides call them under their own locks.

use crate::root::LiveMigration;

use super::manifest::JournalManifest;
use super::state::{is_terminal_phase, manifest_phase, MigrationExecutionError};

/// Refuses a takeover manifest promotion whose caller is not the next owner of the committed binding.
///
/// A takeover is a different transition from a checkpoint (§10.1): the new owner atomically
/// advances the fencing generation, so the manifest carries the committed fence plus one and the
/// committed revision plus one. `None` is refused, because a takeover needs a committed journal.
pub fn assert_takeover_promote_authority(
    manifest: &JournalManifest,
    committed: Option<&LiveMigration>,
) -> Result<(), MigrationExecutionError> {
    let Some(live) = committed else {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    };
    assert_takeover_step(
        (
            &manifest.operation_id,
            manifest.fencing_generation,
            manifest.journal_revision,
        ),
        (
            &live.operation_id,
            live.fencing_generation,
            live.journal_revision,
        ),
    )
}

/// Refuses a root binding advance that is not the takeover of `prev` (§5.4, §10.1).
///
/// Same operation, `fencing_generation + 1` and `journal_revision + 1`: the checkpoint advance
/// ([`assert_binding_successor`]) keeps the fence, a takeover must advance it.
pub fn assert_binding_takeover(
    prev: &LiveMigration,
    next: &LiveMigration,
) -> Result<(), MigrationExecutionError> {
    assert_takeover_step(
        (
            &next.operation_id,
            next.fencing_generation,
            next.journal_revision,
        ),
        (
            &prev.operation_id,
            prev.fencing_generation,
            prev.journal_revision,
        ),
    )
}

/// `(operation id, fencing generation, journal revision)` of one side of a takeover step.
type TakeoverCoordinates<'a> = (&'a str, u64, u64);

fn assert_takeover_step(
    next: TakeoverCoordinates<'_>,
    prev: TakeoverCoordinates<'_>,
) -> Result<(), MigrationExecutionError> {
    if next.0 != prev.0 {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    }
    let (Some(fence), Some(revision)) = (prev.1.checked_add(1), prev.2.checked_add(1)) else {
        return Err(MigrationExecutionError::LiveBindingMismatch);
    };
    match next.1.cmp(&fence) {
        std::cmp::Ordering::Less => return Err(MigrationExecutionError::StaleMigrationOwner),
        std::cmp::Ordering::Equal => {}
        std::cmp::Ordering::Greater => return Err(MigrationExecutionError::LiveBindingMismatch),
    }
    match next.2.cmp(&revision) {
        std::cmp::Ordering::Less => Err(MigrationExecutionError::StaleJournalRevision),
        std::cmp::Ordering::Equal => Ok(()),
        std::cmp::Ordering::Greater => Err(MigrationExecutionError::LiveBindingMismatch),
    }
}

/// Refuses a takeover manifest that is not the next owner's claim of `prev`, the committed one (§10.1).
///
/// Lease expiry makes a new owner eligible: `prev` has no lease owner or its lease expired at
/// `now_unix_ms` (`now >= lease_expires_unix_ms`). The claim carries the fencing generation plus one
/// and the revision plus one, a lease owner whose expiry lies after `now`, and changes nothing else:
/// the phase, cursor, inventory, target key and recovery reason are the committed ones, because a
/// takeover moves ownership only and the new owner makes progress through ordinary checkpoints. A
/// terminal journal has nothing left to own. The clock is the caller's, never read here.
pub fn assert_takeover_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
    now_unix_ms: u64,
) -> Result<(), MigrationExecutionError> {
    if is_terminal_phase(manifest_phase(prev)) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if !lease_expired(prev, now_unix_ms) {
        return Err(MigrationExecutionError::LeaseNotExpired);
    }
    assert_takeover_step(
        (
            &next.operation_id,
            next.fencing_generation,
            next.journal_revision,
        ),
        (
            &prev.operation_id,
            prev.fencing_generation,
            prev.journal_revision,
        ),
    )?;
    if !holds_live_lease(next, now_unix_ms) {
        return Err(MigrationExecutionError::InvalidTakeoverLease);
    }
    if takeover_changes_only_ownership(prev, next) {
        Ok(())
    } else {
        Err(MigrationExecutionError::FrozenFieldChanged)
    }
}

/// A lease with a named owner that still runs at `now_unix_ms`.
fn holds_live_lease(manifest: &JournalManifest, now_unix_ms: u64) -> bool {
    let owner_named = manifest
        .lease_owner_id
        .as_deref()
        .is_some_and(|owner| !owner.is_empty());
    manifest.has_lease_owner
        && owner_named
        && manifest
            .lease_expires_unix_ms
            .is_some_and(|expires| expires > now_unix_ms)
}

/// No lease owner, or a lease that has run out at `now_unix_ms`.
fn lease_expired(manifest: &JournalManifest, now_unix_ms: u64) -> bool {
    if !manifest.has_lease_owner {
        return true;
    }
    manifest
        .lease_expires_unix_ms
        .is_some_and(|expires| now_unix_ms >= expires)
}

/// Whether `next` is `prev` with only the revision, the fence and the lease replaced.
fn takeover_changes_only_ownership(prev: &JournalManifest, next: &JournalManifest) -> bool {
    let mut expected = prev.clone();
    expected.journal_revision = next.journal_revision;
    expected.fencing_generation = next.fencing_generation;
    expected.has_lease_owner = next.has_lease_owner;
    expected.lease_owner_id = next.lease_owner_id.clone();
    expected.lease_expires_unix_ms = next.lease_expires_unix_ms;
    expected == *next
}
