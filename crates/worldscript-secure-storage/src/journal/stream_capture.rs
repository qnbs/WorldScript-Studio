//! Gate 4D streaming capture, stage one: building and staging a captured inventory one page at a time
//! (§10.1.1, §10.3).
//!
//! [`capture_inventory`](super::capture::capture_inventory) and the inventory store hold every sealed
//! page in memory, which the format does not bound: it allows a million entries of up to a kilobyte in
//! pages of up to 4096 entries. A page cannot be written to its final place as it is sealed, because
//! that place is keyed by the page-set digest, which needs the envelope digest of every page, and a
//! second sealing pass would use fresh nonces and give different bytes. So each envelope is kept on
//! disk, in a private pending directory, between "sealed and hashed" and "digest known":
//!
//! ```text
//! <journal-dir>/inventory/pending-<revision>-<random>/page-<index>/generation-<g>.wsr1
//! ```
//!
//! The pending directory has the layout of a digest directory, so the final promotion (stage two) is
//! the same store of the same bytes. Nothing in it is authority: the manifest never names it, no
//! reader looks for it, and an attempt that is abandoned leaves inert files that nothing trusts.
//!
//! The inventory digest commits to the total entry count before any entry (§5.4), so the total is
//! given up front and checked at the end. Memory is one page and one reference per page; the builder
//! holds no page and no envelope after a push returns. No lock is taken while pages are staged; the
//! authority checks made by [`StreamedCapture::begin`] only refuse early, and stage two repeats them
//! under the root lock and the journal mutex.

use std::path::{Path, PathBuf};

use crate::durable::{generation_path, DurableFs, WriteOperationId};
use crate::marker::content_digest;
use crate::root::LiveMigration;

use super::capture::{
    assert_inventory_open, assert_page_not_empty, capture_successor, next_revision,
    CapturedInventory, SealedPage,
};
use super::digest::{page_ref_for, InventoryDigestVerifier};
use super::durable::{
    assert_root_named_manifest, with_fence, JournalDurableContext, JournalDurableError,
};
use super::inventory::JournalInventoryEntry;
use super::inventory_read::{open_stored_page, read_envelope};
use super::inventory_store::{seal_inventory_pages, store_page_at};
use super::manifest::{JournalManifest, JournalPageRef};
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationFence};
use super::JournalError;

/// A capture whose pages are being staged. Every push consumes the builder and returns it, so a
/// builder that failed partway cannot be pushed to again.
pub struct StreamedCapture {
    committed: JournalManifest,
    revision: u64,
    entry_count: u32,
    pending: PathBuf,
    refs: Vec<JournalPageRef>,
    verifier: InventoryDigestVerifier,
}

// The verifier is deliberately left out: it is a running hash, not state worth printing.
impl std::fmt::Debug for StreamedCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamedCapture")
            .field("revision", &self.revision)
            .field("entry_count", &self.entry_count)
            .field("pages_staged", &self.refs.len())
            .field("pending", &self.pending)
            .finish_non_exhaustive()
    }
}

/// A finished capture: the successor manifest that names the page set, and where the staged pages
/// are. Nothing is published yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedCapture {
    successor: JournalManifest,
    pending: PathBuf,
    refs: Vec<JournalPageRef>,
}

/// A staged page read back and confirmed against its reference: the decoded page and the exact
/// envelope bytes the page set binds.
#[derive(Clone, PartialEq, Eq)]
pub struct StagedPage {
    pub page: JournalPage,
    pub envelope: Vec<u8>,
}

impl StagedCapture {
    /// The successor manifest that captures the staged inventory.
    pub fn successor(&self) -> &JournalManifest {
        &self.successor
    }

    /// The reference of every staged page, in page-index order.
    pub fn page_refs(&self) -> &[JournalPageRef] {
        &self.refs
    }

    /// The private pending directory the pages are staged in.
    pub fn pending_dir(&self) -> &Path {
        &self.pending
    }
}

impl StreamedCapture {
    /// Starts a capture of `entry_count` entries over `committed`, the manifest the root binding
    /// `live` names.
    ///
    /// Refused before anything is created: a stale fence, a caller that is not the committed owner
    /// writing under the committed manifest, a manifest that is not the exact root-named generation,
    /// an inventory that is not open (`DISCOVER` or `ADMIT`, not yet captured as final, nothing
    /// converted) and a total above the format's bound. These are early refusals only: whoever
    /// promotes the staged pages repeats them under the locks.
    pub fn begin<F: DurableFs>(
        ctx: &mut JournalDurableContext<'_, F>,
        committed: &JournalManifest,
        fence: &MigrationFence,
        live: &LiveMigration,
        entry_count: u32,
    ) -> Result<Self, JournalDurableError> {
        let verifier = with_fence(committed, fence, || {
            assert_page_promote_authority(committed, Some(live))
                .map_err(JournalDurableError::Authority)?;
            assert_root_named_manifest(ctx, committed, live)?;
            assert_inventory_open(committed).map_err(JournalDurableError::Authority)?;
            Ok(InventoryDigestVerifier::new(
                committed.inventory_version,
                entry_count,
            )?)
        })?;
        let revision = next_revision(committed).map_err(JournalDurableError::Authority)?;
        // A fresh random tag, never the caller's operation id: two attempts must never share a
        // pending directory, because each seals its pages with its own nonces.
        let tag = WriteOperationId::generate()
            .map_err(|error| JournalDurableError::Journal(JournalError::Seal(error)))?;
        let pending = ctx
            .dir
            .join("inventory")
            .join(format!("pending-{revision}-{}", tag.as_str()));
        Ok(Self {
            committed: committed.clone(),
            revision,
            entry_count,
            pending,
            refs: Vec::new(),
            verifier,
        })
    }

    /// Stages the next page. The page takes the next index and the capture's generation; its
    /// entries must be valid and strictly ascending after every earlier entry, and the running total
    /// must stay within the count given at the start. The sealed envelope is staged, synced, and
    /// dropped.
    pub fn push_page<F: DurableFs>(
        mut self,
        ctx: &mut JournalDurableContext<'_, F>,
        entries: Vec<JournalInventoryEntry>,
    ) -> Result<Self, JournalDurableError> {
        let index = u32::try_from(self.refs.len()).map_err(|_| JournalError::InvalidPageIndex)?;
        let page = JournalPage::new(index, self.revision, entries)?;
        assert_page_not_empty(&page)?;
        self.verifier.absorb_page(&page)?;
        let envelope =
            seal_inventory_pages(ctx.key, &self.committed, std::slice::from_ref(&page))?.remove(0);
        let reference = page_ref_for(&page, &envelope)?;
        let dir = self.pending.join(format!("page-{index}"));
        let sealed = SealedPage {
            page: &page,
            envelope: &envelope,
        };
        store_page_at(ctx, &dir, &self.committed, &sealed)?;
        self.refs.push(reference);
        Ok(self)
    }

    /// Ends the capture: exactly the announced number of entries must have been staged. Returns the
    /// successor manifest, built and checked exactly as
    /// [`capture_inventory`](super::capture::capture_inventory) builds it from the same pages.
    pub fn finish(self) -> Result<StagedCapture, JournalDurableError> {
        let inventory_digest = self.verifier.finish_digest()?;
        let parts = CapturedInventory {
            refs: &self.refs,
            entry_count: self.entry_count,
            inventory_digest,
        };
        let successor =
            capture_successor(&self.committed, &parts).map_err(JournalDurableError::Authority)?;
        Ok(StagedCapture {
            successor,
            pending: self.pending,
            refs: self.refs,
        })
    }
}

/// Reads staged page `page_index` back by the exact path of its reference, bounded.
///
/// The envelope must hash to the reference before it is opened, and it opens only as this
/// operation's page at this index and generation, under the journal key and at the operation's
/// journal envelope epoch (compared before the key is used), so a staged file that changed after it
/// was written is refused rather than trusted.
pub fn load_staged_page<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    staged: &StagedCapture,
    page_index: u32,
) -> Result<StagedPage, JournalDurableError> {
    let reference = usize::try_from(page_index)
        .ok()
        .and_then(|index| staged.refs.get(index))
        .ok_or(JournalError::InvalidPageIndex)?;
    let dir = staged.pending.join(format!("page-{page_index}"));
    let envelope = read_envelope(ctx, &generation_path(&dir, reference.page_generation))?;
    if content_digest(&envelope) != reference.page_content_digest {
        return Err(JournalError::PageSetMismatch.into());
    }
    let page = open_stored_page(
        ctx,
        &staged.successor,
        page_index,
        reference.page_generation,
        &envelope,
    )?;
    if page.entries().len() as u64 != u64::from(reference.page_entry_count) {
        return Err(JournalError::EntryCountMismatch.into());
    }
    Ok(StagedPage { page, envelope })
}
