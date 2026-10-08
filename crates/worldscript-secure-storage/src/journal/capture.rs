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
/// Allowed only in `DISCOVER` (the preliminary inventory) and `ADMIT` (the final one, behind the write
/// barrier, §10.3). Refused: a stale fence, a terminal journal (`TerminalPhase`), `CONVERT` or
/// later and a journal that already made conversion progress (`FrozenFieldChanged`: the inventory
/// is frozen), and every other phase (`InvalidPhaseTransition`): `BOOTSTRAP_TARGET` has no inventory
/// yet and in `PREPARE` ordinary writes are admitted, so a snapshot taken there would go stale.
/// The capture that runs in `ADMIT` is the final one: it sets `final_inventory_captured` in the same
/// successor, and once that is set the inventory is immutable, so a further capture is refused
/// (`FrozenFieldChanged`). The pages must be indexed
/// `0..n` without gap or duplicate, hold globally ascending valid entries, and each carry a
/// generation between `1` and the new revision and at least one entry (an empty inventory is no
/// page at all, its canonical form): a page written for this capture carries the new
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
    let revision = next_revision(manifest)?;
    let ordered = ordered_pages(pages)?;
    let refs = page_refs(&ordered, revision)?;
    let entry_count = entry_total(&ordered)?;
    let inventory_digest = inventory_digest_of(manifest.inventory_version, &ordered, entry_count)?;
    let parts = CapturedInventory {
        refs: &refs,
        entry_count,
        inventory_digest,
    };
    capture_successor(manifest, &parts)
}

/// What a capture of the inventory consists of, however its pages were produced: one reference per
/// page, the entry total and the inventory digest over the entries.
pub(super) struct CapturedInventory<'a> {
    pub refs: &'a [JournalPageRef],
    pub entry_count: u32,
    pub inventory_digest: [u8; 32],
}

/// The revision a capture of `manifest` is published at: the next one, and the generation of every
/// page the capture writes.
pub(super) fn next_revision(manifest: &JournalManifest) -> Result<u64, MigrationExecutionError> {
    manifest
        .journal_revision
        .checked_add(1)
        .ok_or_else(|| JournalError::InvalidCounter.into())
}

/// The successor of `manifest` that carries `parts` as its inventory, checked as a valid successor.
/// Both the capture from pages in memory and the streamed capture end here.
pub(super) fn capture_successor(
    manifest: &JournalManifest,
    parts: &CapturedInventory<'_>,
) -> Result<JournalManifest, MigrationExecutionError> {
    let mut next = manifest.clone();
    // Only the capture that runs behind `ADMIT`'s barrier is the final one (§10.3).
    next.final_inventory_captured = manifest.phase == phase_code::ADMIT;
    next.journal_revision = next_revision(manifest)?;
    next.page_count = u32::try_from(parts.refs.len()).map_err(|_| JournalError::TooManyEntries)?;
    next.entry_count = parts.entry_count;
    next.inventory_digest = parts.inventory_digest;
    next.journal_page_set_digest = journal_page_set_digest(parts.refs)?;
    next.encode()?;
    next.verify_page_set(parts.refs)?;
    assert_manifest_successor(manifest, &next)?;
    Ok(next)
}

/// The inventory is captured in `DISCOVER` (preliminary) or `ADMIT` (final), before conversion
/// starts, while nothing has been converted and, because the final inventory is immutable once
/// captured, before the final capture. `PREPARE` is excluded: ordinary writes are admitted
/// there until `ADMIT`'s barrier, so only the `ADMIT` snapshot can be the commit inventory.
pub(super) fn assert_inventory_open(
    manifest: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    let phase = manifest_phase(manifest);
    if is_terminal_phase(phase) {
        return Err(MigrationExecutionError::TerminalPhase);
    }
    let cursor =
        JournalCheckpointCursor::new(manifest.cursor_page_index, manifest.cursor_entry_index);
    // The final inventory is the commit inventory: once captured it is immutable, so it is captured once.
    if phase_reached(phase, phase_code::CONVERT)
        || cursor != JournalCheckpointCursor::EMPTY
        || manifest.final_inventory_captured
    {
        return Err(MigrationExecutionError::FrozenFieldChanged);
    }
    if manifest.phase != phase_code::DISCOVER && manifest.phase != phase_code::ADMIT {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    Ok(())
}

/// The pages by index, which must be exactly `0..n`: neither the page-set digest nor the inventory
/// digest pins the indexes, so every writer of a page set checks this itself.
pub(super) fn ordered_pages<'a>(
    pages: &'a [SealedPage<'a>],
) -> Result<Vec<&'a SealedPage<'a>>, JournalError> {
    let mut ordered: Vec<&SealedPage<'_>> = pages.iter().collect();
    ordered.sort_by_key(|sealed| sealed.page.page_index());
    let contiguous = ordered
        .iter()
        .zip(0u32..)
        .all(|(sealed, index)| sealed.page.page_index() == index);
    if contiguous {
        Ok(ordered)
    } else {
        Err(JournalError::PageSetMismatch)
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
            assert_page_not_empty(sealed.page)?;
            page_ref_for(sealed.page, sealed.envelope).map_err(MigrationExecutionError::from)
        })
        .collect()
}

/// The canonical form of an empty inventory is no page at all; an empty page would give it a second
/// page-set digest.
pub(super) fn assert_page_not_empty(page: &JournalPage) -> Result<(), JournalError> {
    if page.entries().is_empty() {
        Err(JournalError::InvalidDescriptorCount)
    } else {
        Ok(())
    }
}

/// Refuses a successor that is not what [`capture_inventory`] would build from `prev`: it must be a
/// valid successor ([`assert_manifest_successor`], so `prev + 1` and the rest of the relation), the
/// inventory must still be open ([`assert_inventory_open`]) and the successor may differ only in the revision
/// and the four inventory fields, never in phase, cursor, lease or any other field. Whoever stores
/// the pages of a capture applies this, because the generic successor relation alone would accept a
/// hand-built manifest that changes the inventory outside the capture window.
pub fn assert_capture_successor(
    prev: &JournalManifest,
    next: &JournalManifest,
) -> Result<(), MigrationExecutionError> {
    assert_manifest_successor(prev, next)?;
    assert_inventory_open(prev)?;
    if next.phase != prev.phase {
        return Err(MigrationExecutionError::InvalidPhaseTransition);
    }
    let mut expected = prev.clone();
    expected.journal_revision = next.journal_revision;
    expected.page_count = next.page_count;
    expected.entry_count = next.entry_count;
    expected.inventory_digest = next.inventory_digest;
    expected.journal_page_set_digest = next.journal_page_set_digest;
    // The capture sets the flag exactly when it runs in `ADMIT`.
    expected.final_inventory_captured = prev.phase == phase_code::ADMIT;
    if *next == expected {
        Ok(())
    } else {
        Err(MigrationExecutionError::FrozenFieldChanged)
    }
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
