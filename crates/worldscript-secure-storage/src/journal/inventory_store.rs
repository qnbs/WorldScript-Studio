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

use std::path::{Path, PathBuf};

use crate::durable::{
    stage_and_promote_envelope, DirectoryDurability, DurableFs, PromotedGeneration,
};
use crate::marker::content_digest;
use crate::root::LiveMigration;
use crate::seal::Key;

use super::durable::{
    migration_page_identity, page_meta, stage_io, stage_request, with_fence, JournalDurableContext,
    JournalDurableError,
};
use super::manifest::JournalManifest;
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationFence};
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
/// caller seals first, captures the inventory from these bytes, and promotes these same bytes.
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

/// One sealed inventory page to promote into the directory its page set determines.
#[derive(Clone, Copy)]
pub struct InventoryPageWrite<'a> {
    /// The manifest the root names: the page is written under it (R4's page rule).
    pub manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    pub committed: Option<&'a LiveMigration>,
    pub page: &'a JournalPage,
    /// The page exactly as [`seal_inventory_pages`] sealed it.
    pub envelope: &'a [u8],
    /// `journal_page_set_digest` of the manifest that will name this page set.
    pub page_set_digest: [u8; 32],
}

/// Promotes one sealed inventory page, fenced, into `inventory/<digest>/page-<index>/`.
///
/// Under the journal mutex and before any I/O the caller must be the committed owner writing under
/// the committed manifest ([`assert_page_promote_authority`]) and the page generation must lie in
/// `1..=committed revision + 1`. Nothing is created for a refused write. The page is a candidate
/// until a manifest naming the digest is committed (§10.1.1), so it is written before that
/// manifest; the directory chain up to the journal directory is synced so the page cannot vanish
/// after the manifest that names it is durable.
pub fn promote_inventory_page_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    write: &InventoryPageWrite<'_>,
) -> Result<PromotedGeneration, JournalDurableError> {
    with_fence(write.manifest, write.fence, || {
        assert_page_promote_authority(write.manifest, write.committed)
            .map_err(JournalDurableError::Authority)?;
        assert_page_generation(write.manifest, write.page)?;
        let dir = inventory_page_dir(ctx.dir, &write.page_set_digest, write.page.page_index());
        ctx.fs
            .create_dir_all(&dir)
            .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
        let identity =
            migration_page_identity(&write.manifest.operation_id, write.page.page_index())?;
        let request = stage_request(&dir, &identity, page_meta(write.page), ctx.operation);
        let mut promoted =
            stage_and_promote_envelope(ctx.fs, ctx.key, &request, write.envelope.to_vec())?;
        debug_assert_eq!(promoted.content_digest, content_digest(write.envelope));
        promoted.directory = sync_parents(ctx, &dir, promoted.directory)?;
        Ok(promoted)
    })
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

/// Syncs every directory from the page directory's parent up to the journal directory.
fn sync_parents<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    page_dir: &Path,
    promoted: DirectoryDurability,
) -> Result<DirectoryDurability, JournalDurableError> {
    let mut durability = promoted;
    let mut current = page_dir.parent();
    while let Some(dir) = current {
        let synced = ctx
            .fs
            .sync_dir(dir)
            .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
        if synced != DirectoryDurability::Confirmed {
            durability = DirectoryDurability::NotConfirmed;
        }
        if dir == ctx.dir {
            break;
        }
        current = dir.parent();
    }
    Ok(durability)
}
