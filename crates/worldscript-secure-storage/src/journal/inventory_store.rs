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

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::durable::{
    generation_path, stage_and_promote_envelope, staging_path, DirectoryDurability, DurableFs,
    StageFailure, StageFailureKind, StageStep, StagingResidue,
};
use crate::envelope::parse_envelope;
use crate::root::LiveMigration;
use crate::seal::Key;

use super::capture::{assert_capture_successor, assert_page_not_empty, ordered_pages, SealedPage};
use super::digest::{page_ref_for, InventoryDigestVerifier};
use super::durable::{
    load_authoritative_manifest, migration_page_identity, page_meta, stage_io, stage_request,
    with_fence, JournalDurableContext, JournalDurableError,
};
use super::manifest::{journal_envelope_epoch, JournalManifest};
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationExecutionError, MigrationFence};
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

/// Seals each page once, as `migration-page:<operation-id>:<index>` of `manifest`'s operation at its
/// own generation and under the operation's journal envelope epoch.
///
/// The set digest binds the exact envelope bytes and sealing uses a fresh nonce each time, so the
/// caller seals first, captures the inventory from these bytes, and stores these same bytes.
pub fn seal_inventory_pages(
    key: &Key,
    manifest: &JournalManifest,
    pages: &[JournalPage],
) -> Result<Vec<Vec<u8>>, JournalError> {
    let epoch = journal_envelope_epoch(manifest)?;
    pages
        .iter()
        .map(|page| {
            let identity = migration_page_identity(&manifest.operation_id, page.page_index())?;
            page.seal(key, &identity, page_meta(page, epoch))
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
/// Under the journal mutex and before any write: the caller must be the committed owner writing under
/// the committed manifest ([`assert_page_promote_authority`]), and that manifest must be the exact
/// generation the root binding names (read back and compared, bounded); `successor` must be a valid successor
/// of it and exactly what [`capture_inventory`](super::capture::capture_inventory) would build
/// (inventory still open, only the revision and the inventory fields changed) and must encode; the
/// pages must be indexed `0..n`, non-empty, and exactly the page set and inventory `successor` names
/// (so the directory key cannot disagree with the pages); each page generation must be exactly the
/// successor's revision (no page is inherited from the predecessor yet); and each envelope must open
/// under the journal key, at its pinned key epoch, to exactly its page. A store refused by these checks creates nothing, not even the
/// directory.
///
/// The pages are then written one by one, before the manifest that names the digest is committed
/// (§10.1.1: candidates until then). An I/O failure partway leaves a durable prefix; a retry of the
/// same set adopts every page whose exact bytes are already on disk (no new staging, its directory
/// chain synced again) and continues with the first missing one, while a different file at a page
/// generation is never replaced. Every directory up to the journal directory is synced so a page
/// cannot vanish after the manifest that names it is durable.
pub fn promote_inventory_set_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    with_fence(set.committed_manifest, set.fence, || {
        assert_page_promote_authority(set.committed_manifest, set.committed)
            .map_err(JournalDurableError::Authority)?;
        assert_root_named_predecessor(ctx, set)?;
        assert_capture_successor(set.committed_manifest, set.successor)
            .map_err(JournalDurableError::Authority)?;
        let ordered = verify_set(ctx, set)?;
        let mut durability = DirectoryDurability::Confirmed;
        for sealed in ordered {
            durability = both(durability, store_page(ctx, set, sealed)?);
        }
        Ok(durability)
    })
}

/// The committed manifest the caller supplied must be the very generation the root binding names:
/// the binding carries only the operation, fence, revision and envelope digest, so a manifest at the
/// same revision with other fields would otherwise pass the capture checks against a predecessor
/// that does not exist. Reads only the root-named generation, bounded, and never creates anything.
fn assert_root_named_predecessor<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'_>,
) -> Result<(), JournalDurableError> {
    let mismatch = JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch);
    let live = set.committed.ok_or(mismatch.clone())?;
    if load_authoritative_manifest(ctx, live)? == *set.committed_manifest {
        Ok(())
    } else {
        Err(mismatch)
    }
}

/// Everything that can be refused without touching the disk; returns the pages by index.
fn verify_set<'a, F: DurableFs>(
    ctx: &JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'a>,
) -> Result<Vec<&'a SealedPage<'a>>, JournalDurableError> {
    // The successor must be a manifest that can be sealed: the successor relation leaves the lease
    // fields unconstrained, so a set could otherwise be stored for a manifest that never encodes.
    set.successor.encode()?;
    let ordered = ordered_pages(set.pages)?;
    let mut refs = Vec::with_capacity(ordered.len());
    let mut verifier =
        InventoryDigestVerifier::new(set.successor.inventory_version, set.successor.entry_count)?;
    for sealed in &ordered {
        assert_page_not_empty(sealed.page)?;
        assert_page_generation(set.successor, sealed.page)?;
        assert_envelope_is_page(ctx, set.committed_manifest, sealed)?;
        refs.push(page_ref_for(sealed.page, sealed.envelope)?);
        verifier.absorb_page(sealed.page)?;
    }
    set.successor.verify_page_set(&refs)?;
    verifier.finish(set.successor.inventory_digest)?;
    Ok(ordered)
}

/// A page of this capture carries exactly the successor's revision as its generation. `capture_inventory`
/// also lets an unchanged page keep the earlier generation that still names it, but proving that the
/// predecessor's page set really contains those bytes needs the predecessor's authenticated page
/// references, which only a verified reader of the stored set can provide (the next slice). Until then
/// an older generation is refused, so one page identity and generation can never stand for different
/// content across page sets.
fn assert_page_generation(
    successor: &JournalManifest,
    page: &JournalPage,
) -> Result<(), JournalDurableError> {
    if page.page_generation() == successor.journal_revision {
        Ok(())
    } else {
        Err(JournalDurableError::Journal(
            JournalError::GenerationMismatch,
        ))
    }
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
    if opened != *sealed.page {
        return Err(JournalDurableError::Journal(
            JournalError::InconsistentInventory,
        ));
    }
    assert_key_epoch(sealed, journal_envelope_epoch(manifest)?)
}

/// Whether the envelope's header carries `epoch`, the operation's journal envelope epoch.
/// `JournalPage::open` does not compare it, but the stage step does (after a staging file exists),
/// and a reader must not accept a page sealed for another epoch.
pub(super) fn has_epoch(envelope: &[u8], epoch: u64) -> Result<bool, JournalError> {
    let parsed = parse_envelope(envelope).map_err(JournalError::Open)?;
    Ok(parsed.header().key_epoch == epoch)
}

/// Refuses an envelope sealed for another key epoch before any staging file exists, so a refused
/// store leaves no residue.
fn assert_key_epoch(sealed: &SealedPage<'_>, epoch: u64) -> Result<(), JournalDurableError> {
    if has_epoch(sealed.envelope, epoch)? {
        return Ok(());
    }
    Err(JournalDurableError::Stage(StageFailure {
        step: StageStep::ValidateStaging,
        kind: StageFailureKind::StagedEnvelopeMismatch,
        promoted: false,
        staging: StagingResidue::None,
    }))
}

/// Stores one page: adopts an identical page an earlier attempt already promoted, otherwise
/// creates the page directory and promotes the envelope into it. Either way the directory chain up
/// to the journal directory is synced.
fn store_page<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    set: &InventorySetWrite<'_>,
    sealed: &SealedPage<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let dir = inventory_page_dir(
        ctx.dir,
        &set.successor.journal_page_set_digest,
        sealed.page.page_index(),
    );
    if holds_envelope(ctx, &dir, sealed)? {
        // The earlier attempt may have stopped before its directories were durable, and, under the
        // same operation id, may have left its own staging link behind.
        let staging = staging_residue(ctx, &dir, sealed.page.page_generation());
        return sync_chain(ctx, &dir, staging);
    }
    ctx.fs
        .create_dir_all(&dir)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    let identity = migration_page_identity(
        &set.committed_manifest.operation_id,
        sealed.page.page_index(),
    )?;
    let epoch = journal_envelope_epoch(set.committed_manifest)?;
    let request = stage_request(
        &dir,
        &identity,
        page_meta(sealed.page, epoch),
        ctx.operation,
    );
    let promoted = stage_and_promote_envelope(ctx.fs, ctx.key, &request, sealed.envelope.to_vec())?;
    let above = dir.parent().unwrap_or(ctx.dir);
    let synced = sync_chain(ctx, above, promoted.staging)?;
    Ok(both(promoted.directory, synced))
}

/// Whether `page_dir` already holds this page generation with exactly the envelope's bytes, left by
/// an earlier attempt at the same set (a failure partway through the pages leaves a prefix). The read
/// is bounded by the envelope's own length;
/// an absent or different file is `false`, and a different file is never replaced (the immutable
/// generation refuses the promotion and the bytes already there stay untouched).
fn holds_envelope<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    page_dir: &Path,
    sealed: &SealedPage<'_>,
) -> Result<bool, JournalDurableError> {
    let path = generation_path(page_dir, sealed.page.page_generation());
    match ctx.fs.read_at_most(&path, sealed.envelope.len()) {
        Ok(found) => Ok(found.is_some_and(|bytes| bytes == sealed.envelope)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(JournalDurableError::Stage(stage_io(error))),
    }
}

/// Whether this operation's own staging link for the page generation is still on disk: an earlier
/// attempt under the same operation id may have promoted the page and failed to remove it. A path
/// that cannot be inspected is reported as present, never as absent.
fn staging_residue<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    page_dir: &Path,
    generation: u64,
) -> StagingResidue {
    let path = staging_path(page_dir, generation, ctx.operation);
    match ctx.fs.read_at_most(&path, 0) {
        Err(error) if error.kind() == ErrorKind::NotFound => StagingResidue::None,
        _ => StagingResidue::Present,
    }
}

/// Syncs `start` and every directory above it up to the journal directory. A failure here happens
/// after the page was promoted, so it is reported as one (`promoted`, with the real staging
/// residue), never as an absent page.
fn sync_chain<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    start: &Path,
    staging: StagingResidue,
) -> Result<DirectoryDurability, JournalDurableError> {
    let mut durability = DirectoryDurability::Confirmed;
    let mut current = Some(start);
    while let Some(dir) = current {
        let synced = ctx.fs.sync_dir(dir).map_err(|error| {
            JournalDurableError::Stage(StageFailure {
                step: StageStep::SyncDirectory,
                kind: StageFailureKind::Io(error.kind()),
                promoted: true,
                staging,
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
