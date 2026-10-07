//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).
//!
//! The manifest authenticates the page set only as `journal_page_set_digest`, and the contract says
//! that digest, not a directory listing, is authoritative without saying how a page's file is found.
//! Resolving "the highest generation not above the manifest's revision" by listing would be unsound,
//! because a discarded capture attempt leaves pages the aggregate digest cannot tell apart. So the
//! physical directory is keyed by the authenticated digest itself:
//!
//! ```text
//! <journal-dir>/inventory/<hex(journal_page_set_digest)>/page-<index>/generation-<g>.wsr1
//! ```
//!
//! Pages of another attempt live under another digest, and the path is only a locator (§3).
//!
//! This API holds the pages of one inventory in memory, which suits inventories that fit; a
//! streaming capture that seals, hashes and stages page by page is the extension for the very
//! large inventories §10.1.1 allows, needed before a caller feeds one.

use std::path::{Path, PathBuf};

use crate::durable::{
    stage_and_promote_envelope, DirectoryDurability, DurableFs, PromotedGeneration, StageFailure,
    StageFailureKind, StageStep,
};
use crate::root::LiveMigration;
use crate::seal::Key;

use super::capture::SealedPage;
use super::digest::{page_ref_for, InventoryDigestVerifier};
use super::durable::{
    migration_page_identity, page_meta, stage_io, stage_request, with_fence, JournalDurableContext,
    JournalDurableError,
};
use super::manifest::JournalManifest;
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationFence};
use super::succession::assert_manifest_successor;
use super::JournalError;

/// The directory of page `page_index` of the page set whose digest is `page_set_digest`.
pub fn inventory_page_dir(
    journal_dir: &Path,
    page_set_digest: &[u8; 32],
    page_index: u32,
) -> PathBuf {
    let hex: String = page_set_digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    journal_dir
        .join("inventory")
        .join(hex)
        .join(format!("page-{page_index}"))
}

/// Seals each page once, as `migration-page:<operation-id>:<index>` at its own generation.
///
/// The set digest binds the exact envelope bytes and sealing uses a fresh nonce each time, so the
/// caller seals first, captures the inventory from these bytes, and stores these same bytes.
pub fn seal_inventory_pages(
    key: &Key,
    operation_id: &str,
    pages: &[JournalPage],
) -> Result<Vec<Vec<u8>>, JournalError> {
    pages
        .iter()
        .map(|page| {
            let identity = migration_page_identity(operation_id, page.page_index())?;
            page.seal(key, &identity, page_meta(page))
        })
        .collect()
}

/// A captured inventory to store: the manifest the root names, the successor
/// [`capture_inventory`](super::capture::capture_inventory) built from `pages`, and those pages.
#[derive(Clone, Copy)]
pub struct InventorySetWrite<'a> {
    /// The manifest the root names: the pages are written under it (R4's page rule).
    pub committed_manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    pub committed: Option<&'a LiveMigration>,
    /// The successor that will name the page set; its `journal_page_set_digest` keys the directory.
    pub successor: &'a JournalManifest,
    /// The pages exactly as [`seal_inventory_pages`] sealed them.
    pub pages: &'a [SealedPage<'a>],
}

/// Stores a captured inventory, fenced, under `inventory/<digest>/` and returns whether every
/// directory sync was confirmed.
///
/// Under the journal mutex and before any I/O: the caller must be the committed owner writing under
/// the committed manifest ([`assert_page_promote_authority`]); `successor` must be a valid successor
/// of it; the pages must be exactly the page set and inventory `successor` names (so the directory
/// key cannot disagree with the pages); each page generation must lie in `1..=committed revision + 1`;
/// and each envelope must open under the journal key to exactly its page. A refused store creates
/// nothing, not even the directory. The pages are candidates until a manifest naming the digest is
/// committed (§10.1.1), so they are written before it; every directory up to the journal directory is
/// synced so a page cannot vanish after the manifest that names it is durable.
pub fn promote_inventory_set_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    with_fence(set.committed_manifest, set.fence, || {
        assert_page_promote_authority(set.committed_manifest, set.committed)
            .map_err(JournalDurableError::Authority)?;
        assert_manifest_successor(set.committed_manifest, set.successor)
            .map_err(JournalDurableError::Authority)?;
        let ordered = verify_set(ctx, set)?;
        let mut durability = DirectoryDurability::Confirmed;
        for sealed in ordered {
            let promoted = store_page(ctx, set, sealed)?;
            durability = both(durability, promoted.directory);
        }
        Ok(durability)
    })
}

/// Everything that can be refused without touching the disk; returns the pages by index.
fn verify_set<'a, F: DurableFs>(
    ctx: &JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'a>,
) -> Result<Vec<&'a SealedPage<'a>>, JournalDurableError> {
    let mut ordered: Vec<&SealedPage<'_>> = set.pages.iter().collect();
    ordered.sort_by_key(|sealed| sealed.page.page_index());
    let mut refs = Vec::with_capacity(ordered.len());
    let mut verifier =
        InventoryDigestVerifier::new(set.successor.inventory_version, set.successor.entry_count)?;
    for sealed in &ordered {
        assert_page_generation(set.committed_manifest, sealed.page)?;
        assert_envelope_is_page(ctx, set.committed_manifest, sealed)?;
        refs.push(page_ref_for(sealed.page, sealed.envelope)?);
        verifier.absorb_page(sealed.page)?;
    }
    set.successor.verify_page_set(&refs)?;
    verifier.finish(set.successor.inventory_digest)?;
    Ok(ordered)
}

/// A page is written for the next revision, or an earlier one, never a later one.
fn assert_page_generation(
    manifest: &JournalManifest,
    page: &JournalPage,
) -> Result<(), JournalDurableError> {
    let generation = page.page_generation();
    let within = match manifest.journal_revision.checked_add(1) {
        Some(limit) => generation <= limit,
        None => false,
    };
    if generation == 0 || !within {
        return Err(JournalDurableError::Journal(
            JournalError::GenerationMismatch,
        ));
    }
    Ok(())
}

/// The envelope must authenticate as this operation's page at this index and generation and decode
/// to exactly the page it is stored for; the record header alone would accept another payload.
fn assert_envelope_is_page<F: DurableFs>(
    ctx: &JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    sealed: &SealedPage<'_>,
) -> Result<(), JournalDurableError> {
    let identity = migration_page_identity(&manifest.operation_id, sealed.page.page_index())?;
    let opened = JournalPage::open(
        ctx.key,
        &identity,
        sealed.page.page_generation(),
        sealed.envelope,
    )?;
    if opened == *sealed.page {
        Ok(())
    } else {
        Err(JournalDurableError::Journal(
            JournalError::InconsistentInventory,
        ))
    }
}

/// Creates the page directory, promotes the envelope into it and syncs the directory chain.
fn store_page<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'_>,
    sealed: &SealedPage<'_>,
) -> Result<PromotedGeneration, JournalDurableError> {
    let dir = inventory_page_dir(
        ctx.dir,
        &set.successor.journal_page_set_digest,
        sealed.page.page_index(),
    );
    ctx.fs
        .create_dir_all(&dir)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    let identity = migration_page_identity(
        &set.committed_manifest.operation_id,
        sealed.page.page_index(),
    )?;
    let request = stage_request(&dir, &identity, page_meta(sealed.page), ctx.operation);
    let mut promoted =
        stage_and_promote_envelope(ctx.fs, ctx.key, &request, sealed.envelope.to_vec())?;
    promoted.directory = both(promoted.directory, sync_parents(ctx, &dir, &promoted)?);
    Ok(promoted)
}

/// Syncs every directory from the page directory's parent up to the journal directory. A failure
/// here happens after the page was promoted, so it is reported as one (`promoted`, the real
/// staging residue), never as an absent page.
fn sync_parents<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    page_dir: &Path,
    promoted: &PromotedGeneration,
) -> Result<DirectoryDurability, JournalDurableError> {
    let mut durability = DirectoryDurability::Confirmed;
    let mut current = page_dir.parent();
    while let Some(dir) = current {
        let synced = ctx.fs.sync_dir(dir).map_err(|error| {
            JournalDurableError::Stage(StageFailure {
                step: StageStep::SyncDirectory,
                kind: StageFailureKind::Io(error.kind()),
                promoted: true,
                staging: promoted.staging,
            })
        })?;
        durability = both(durability, synced);
        if dir == ctx.dir {
            break;
        }
        current = dir.parent();
    }
    Ok(durability)
}

fn both(left: DirectoryDurability, right: DirectoryDurability) -> DirectoryDurability {
    if left == DirectoryDurability::Confirmed && right == DirectoryDurability::Confirmed {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    }
}
