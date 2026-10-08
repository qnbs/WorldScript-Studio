//! Gate 4D streaming capture, stage two: promoting a staged capture into the digest directory
//! (§10.1.1, §10.3).
//!
//! Stage one ([`StreamedCapture`](super::StreamedCapture)) leaves the pages of a finished inventory in
//! a private pending directory. This is the step that makes them reachable: each staged page is read
//! back, confirmed against its reference, and stored under
//! `inventory/<journal_page_set_digest>/page-<i>/`, exactly where
//! [`promote_inventory_set_fenced`](super::promote_inventory_set_fenced) would have put the same
//! bytes, and with the same adoption of an identical page and refusal to replace a different file.
//!
//! Everything that can be refused from metadata alone is refused before the first write: the caller
//! must be the committed owner writing under the committed manifest, that manifest must be the exact
//! root-named generation, the successor must be the capture successor of it, and the staged
//! references must be the page set the successor names. The pages themselves are checked as they are
//! loaded, one at a time, so memory stays one page. That makes this a single pass: a staged page found
//! wrong midway leaves the verified prefix as an inert directory under the digest, as an I/O failure
//! partway through the in-memory store already does, and the inventory digest is confirmed before
//! this returns, so a manifest naming the set is never published on a set that failed it.

use crate::durable::{DirectoryDurability, DurableFs};
use crate::root::LiveMigration;

use super::capture::{assert_capture_successor, assert_page_not_empty, SealedPage};
use super::digest::InventoryDigestVerifier;
use super::durable::{
    assert_root_named_manifest, with_fence, JournalDurableContext, JournalDurableError,
};
use super::inventory_store::{assert_page_generation, both, inventory_page_dir, store_page_at};
use super::manifest::JournalManifest;
use super::state::{assert_page_promote_authority, MigrationFence};
use super::stream_capture::{load_staged_page, StagedCapture};

/// A finished streamed capture to promote: the manifest the root binding names, the owner's token
/// under it, that binding, and the staged capture built over that manifest.
#[derive(Clone, Copy)]
pub struct StagedPromotion<'a> {
    /// The manifest the root binding names: the pages are written under it (R4's page rule).
    pub committed_manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    pub committed: &'a LiveMigration,
    pub staged: &'a StagedCapture,
}

/// Stores the pages of a staged capture under the digest directory of its successor, fenced, and
/// returns whether every directory sync was confirmed. The staged files are left where they are: the
/// caller removes them after the root has committed to the set, so that a retry still has them.
pub fn promote_staged_inventory_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    promotion: &StagedPromotion<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let committed = promotion.committed_manifest;
    let successor = promotion.staged.successor();
    with_fence(committed, promotion.fence, || {
        assert_page_promote_authority(committed, Some(promotion.committed))
            .map_err(JournalDurableError::Authority)?;
        assert_root_named_manifest(ctx, committed, promotion.committed)?;
        assert_capture_successor(committed, successor).map_err(JournalDurableError::Authority)?;
        // The successor must be a manifest that can be sealed, and the staged references the page
        // set it names.
        successor.encode()?;
        successor.verify_page_set(promotion.staged.page_refs())?;
        let mut verifier =
            InventoryDigestVerifier::new(successor.inventory_version, successor.entry_count)?;
        let mut durability = DirectoryDurability::Confirmed;
        for index in 0..successor.page_count {
            let staged = load_staged_page(ctx, promotion.staged, index)?;
            assert_page_not_empty(&staged.page)?;
            assert_page_generation(successor, &staged.page)?;
            verifier.absorb_page(&staged.page)?;
            let sealed = SealedPage {
                page: &staged.page,
                envelope: &staged.envelope,
            };
            let dir = inventory_page_dir(ctx.dir, &successor.journal_page_set_digest, index);
            durability = both(durability, store_page_at(ctx, &dir, committed, &sealed)?);
        }
        verifier.finish(successor.inventory_digest)?;
        Ok(durability)
    })
}
