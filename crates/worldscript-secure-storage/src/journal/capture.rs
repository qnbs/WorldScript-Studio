//! Gate 4D Slice C1a: capturing a paged inventory into the journal manifest (§10.1.1, §10.3).
//!
//! §10.3 freezes the inventory at `ADMIT`: `DISCOVER` records a preliminary inventory and `ADMIT`
//! captures the final one. This is the manifest-side constructor of that capture: given the sealed
//! pages it computes the page set, the entry count and the inventory digest and returns the
//! predecessor's successor that carries them. It is pure; promoting the pages and reading them back
//! is a later slice.

use super::digest::{journal_page_set_digest, page_ref_for, InventoryDigestVerifier};
use super::manifest::{JournalManifest, JournalPageRef};
use super::page::JournalPage;
use super::phase_code;
use super::state::{
    assert_fence, is_terminal_phase, manifest_phase, phase_reached, JournalCheckpointCursor,
    MigrationExecutionError, MigrationFence,
};
use super::succession::assert_manifest_successor;
use super::JournalError;

/// An inventory page as it was or will be promoted: the decoded page and the exact envelope bytes
/// whose `content_digest` the page set binds.
#[derive(Clone, Copy)]
pub struct SealedPage<'a> {
    pub page: &'a JournalPage,
    pub envelope: &'a [u8],
}

/// Builds the manifest successor that captures `pages` as the journal's inventory.
///
/// Refused: a stale fence, a terminal journal (`TerminalPhase`), `BOOTSTRAP_TARGET` (no inventory
/// exists yet, `InvalidPhaseTransition`), `CONVERT` or later and a journal that already made
/// conversion progress (`FrozenFieldChanged`: the inventory is frozen). The pages must be indexed
/// `0..n` without gap or duplicate, hold globally ascending valid entries, and each carry a
/// generation between `1` and the new revision: a page written for this capture carries the new
/// revision, an unchanged one keeps the earlier generation that still names it. The result is the
/// predecessor with `journal_revision + 1` and the page count, entry count, `inventory_digest` and
/// `journal_page_set_digest` replaced, and is itself checked as a valid successor.
pub fn capture_inventory(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    pages: &[SealedPage<'_>],
) -> Result<JournalManifest, MigrationExecutionError> {
    assert_fence(manifest, fence)?;
    assert_inventory_open(manifest)?;
    let revision = manifest
        .journal_revision
        .checked_add(1)
        .ok_or(JournalError::InvalidCounter)?;
    let ordered = ordered_pages(pages)?;
    let refs = page_refs(&ordered, revision)?;
    let mut next = manifest.clone();
    next.journal_revision = revision;
    next.page_count = u32::try_from(ordered.len()).map_err(|_| JournalError::TooManyEntries)?;
    next.entry_count = entry_total(&ordered)?;
    next.inventory_digest =
        inventory_digest_of(manifest.inventory_version, &ordered, next.entry_count)?;
    next.journal_page_set_digest = journal_page_set_digest(&refs)?;
    next.encode()?;
    next.verify_page_set(&refs)?;
    assert_manifest_successor(manifest, &next)?;
    Ok(next)
}

/// The inventory may change only before conversion starts and while nothing has been converted.
fn assert_inventory_open(manifest: &JournalManifest) -> Result<(), MigrationExecutionError> {
    let phase = manifest_phase(manifest);
    if is_terminal_phase(phase) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    if manifest.phase == phase_code::BOOTSTRAP_TARGET {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    let cursor =
        JournalCheckpointCursor::new(manifest.cursor_page_index, manifest.cursor_entry_index);
    if phase_reached(phase, phase_code::CONVERT) || cursor != JournalCheckpointCursor::EMPTY {
        return Err(MigrationExecutionError::FrozenFieldChanged);
    }
    Ok(())
}

/// The pages by index, which must be exactly `0..n`.
fn ordered_pages<'a>(
    pages: &'a [SealedPage<'a>],
) -> Result<Vec<&'a SealedPage<'a>>, MigrationExecutionError> {
    let mut ordered: Vec<&SealedPage<'_>> = pages.iter().collect();
    ordered.sort_by_key(|sealed| sealed.page.page_index());
    let contiguous = ordered
        .iter()
        .zip(0u32..)
        .all(|(sealed, index)| sealed.page.page_index() == index);
    if contiguous {
        Ok(ordered)
    } else {
        Err(JournalError::PageSetMismatch.into())
    }
}

fn page_refs(
    ordered: &[&SealedPage<'_>],
    revision: u64,
) -> Result<Vec<JournalPageRef>, MigrationExecutionError> {
    ordered
        .iter()
        .map(|sealed| {
            let generation = sealed.page.page_generation();
            if generation == 0 || generation > revision {
                return Err(JournalError::GenerationMismatch.into());
            }
            page_ref_for(sealed.page, sealed.envelope).map_err(MigrationExecutionError::from)
        })
        .collect()
}

fn entry_total(ordered: &[&SealedPage<'_>]) -> Result<u32, MigrationExecutionError> {
    let total: usize = ordered
        .iter()
        .map(|sealed| sealed.page.entries().len())
        .sum();
    u32::try_from(total).map_err(|_| JournalError::TooManyEntries.into())
}

/// The streaming digest of the pages in index order, which also proves the entries are valid and
/// globally ascending.
fn inventory_digest_of(
    inventory_version: u32,
    ordered: &[&SealedPage<'_>],
    entry_count: u32,
) -> Result<[u8; 32], MigrationExecutionError> {
    let mut verifier = InventoryDigestVerifier::new(inventory_version, entry_count)?;
    for sealed in ordered {
        verifier.absorb_page(sealed.page)?;
    }
    verifier.finish_digest().map_err(Into::into)
}
