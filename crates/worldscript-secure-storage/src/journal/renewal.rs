//! Gate 4D same-owner lease renewal (§10.1, maintainer decision C): the predicate that lets the owner
//! extend a lease it holds without a takeover.
//!
//! Ownership changes only by takeover ([`assert_takeover_successor`](super::takeover::assert_takeover_successor));
//! an ordinary successor leaves the lease alone ([`assert_manifest_successor`](super::succession::assert_manifest_successor)).
//! A renewal is the one other change of the lease: the same owner under the same fence moves the expiry
//! strictly forward and nothing else changes. The predicate takes no clock: whether a lapsed lease may
//! still be renewed is arbitrated by the fence, because a takeover by another owner advances it.

use super::manifest::JournalManifest;
use super::state::{is_terminal_phase, manifest_phase, MigrationExecutionError};
use super::succession::assert_successor_revision;

/// Refuses a manifest that is not the same owner's renewal of the lease `prev` holds.
///
/// `prev` is the committed manifest. The renewal carries `journal_revision + 1`, the same fencing
/// generation, the same named owner and an expiry strictly after the committed one
/// (`InvalidLeaseRenewal` if there is no lease to renew or the expiry does not move forward), and
/// changes nothing else (`FrozenFieldChanged`): phase, cursor, inventory, target key and recovery reason
/// are the committed ones. A terminal journal has nothing left to renew.
pub fn assert_renewal_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    if is_terminal_phase(manifest_phase(prev)) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    assert_successor_revision(prev, next)?;
    let held = held_expiry(prev).ok_or(MigrationExecutionError::InvalidLeaseRenewal)?;
    let renewed = next
        .lease_expires_unix_ms
        .filter(|renewed| *renewed > held)
        .ok_or(MigrationExecutionError::InvalidLeaseRenewal)?;
    if renews_only_the_expiry(prev, next, renewed) {
        Ok(())
    } else {
        Err(MigrationExecutionError::FrozenFieldChanged)
    }
}

/// The expiry of a lease with a named owner.
fn held_expiry(manifest: &JournalManifest) -> Option<u64> {
    let owner_named = manifest
        .lease_owner_id
        .as_deref()
        .is_some_and(|owner| !owner.is_empty());
    if manifest.has_lease_owner && owner_named {
        manifest.lease_expires_unix_ms
    } else {
        None
    }
}

/// Whether `next` is `prev` with only the revision and the expiry replaced.
fn renews_only_the_expiry(prev: &JournalManifest, next: &JournalManifest, renewed: u64) -> bool {
    let mut expected = prev.clone();
    expected.journal_revision = next.journal_revision;
    expected.lease_expires_unix_ms = Some(renewed);
    expected == *next
}
