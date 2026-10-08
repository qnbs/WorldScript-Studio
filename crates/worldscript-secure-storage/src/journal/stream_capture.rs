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
//! reader looks for it, and a staged page is a candidate whose absence is a broken attempt, never a
//! recovery state of the journal. A failure that the caller can still handle removes the staged page
//! files on the way out (best effort), and [`StagedCapture::discard`] does the same for a finished
//! capture that is not going to be promoted. The empty directories stay, because the file system
//! abstraction has no directory removal, and so do the files of an attempt that was killed: both are
//! inert and are reclaimed by a separate cleanup (an acceptance criterion on #359).
//!
//! The inventory digest commits to the total entry count before any entry (§5.4), so the total is
//! given up front and checked at the end. Memory is one page and one reference per page; the builder
//! holds no page and no envelope after a push returns. No lock is taken while pages are staged; the
//! authority checks made by [`StreamedCapture::begin`] only refuse early, and stage two repeats them
//! under the root lock and the journal mutex.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::durable::{generation_path, staging_path, DurableFs, WriteOperationId};
use crate::marker::content_digest;
use crate::root::LiveMigration;

use super::capture::{
    assert_inventory_open, assert_page_not_empty, capture_successor, next_revision,
    CapturedInventory, SealedPage,
};
use super::digest::{page_ref_for, InventoryDigestVerifier};
use super::durable::{
    assert_anchor, root_named_anchor, stage_io, with_fence, JournalDurableContext,
    JournalDurableError,
};
use super::inventory::JournalInventoryEntry;
use super::inventory_read::{open_stored_page, MAX_PAGE_ENVELOPE_BYTES};
use super::inventory_store::{seal_inventory_pages, store_page_at};
use super::manifest::{JournalManifest, JournalPageRef};
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationExecutionError, MigrationFence};
use super::JournalError;

/// A capture whose pages are being staged. Every push consumes the builder and returns it, so a
/// builder that failed partway cannot be pushed to again. It belongs to one journal directory and to
/// the key that authenticated the manifest it started from; a push under another context is refused.
pub struct StreamedCapture {
    committed: JournalManifest,
    live: LiveMigration,
    /// The exact bytes of the root-named generation, which the capture's key must keep opening to
    /// `committed`: a few kilobytes, kept so that no push reads the journal for it.
    anchor: Vec<u8>,
    journal_dir: PathBuf,
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
/// are. Nothing is published yet. It is a handle to files on disk, so it is deliberately not
/// `Clone`: whoever holds it owns the decision to promote or to [`discard`](Self::discard) them.
#[derive(Debug, PartialEq, Eq)]
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

/// What a streamed capture starts from: the manifest the root binding names, the owner's fence, that
/// binding, and the announced total of entries.
#[derive(Clone, Copy)]
pub struct CaptureStart<'a> {
    pub committed_manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    pub live: &'a LiveMigration,
    pub entry_count: u32,
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

    /// Abandons the capture: the staged page files are removed, best effort. The empty directories
    /// stay, because the file system abstraction cannot remove a directory.
    pub fn discard<F: DurableFs>(self, ctx: &mut JournalDurableContext<'_, F>) {
        discard_staged(ctx, &self.pending, &self.refs);
    }
}

impl StreamedCapture {
    /// Starts a capture of `start.entry_count` entries over the manifest the root binding names.
    ///
    /// Refused before anything is created: a stale fence, a caller that is not the committed owner
    /// writing under the committed manifest, a manifest that is not the exact root-named generation,
    /// an inventory that is not open (`DISCOVER` or `ADMIT`, not yet captured as final, nothing
    /// converted) and a total above the format's bound. These are early refusals only: whoever
    /// promotes the staged pages repeats them under the locks.
    pub fn begin<F: DurableFs>(
        ctx: &mut JournalDurableContext<'_, F>,
        start: &CaptureStart<'_>,
    ) -> Result<Self, JournalDurableError> {
        let committed = start.committed_manifest;
        let (verifier, anchor) = with_fence(committed, start.fence, || {
            assert_page_promote_authority(committed, Some(start.live))
                .map_err(JournalDurableError::Authority)?;
            let anchor = root_named_anchor(ctx, committed, start.live)?;
            assert_inventory_open(committed).map_err(JournalDurableError::Authority)?;
            let verifier =
                InventoryDigestVerifier::new(committed.inventory_version, start.entry_count)?;
            Ok((verifier, anchor))
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
            live: start.live.clone(),
            anchor,
            journal_dir: ctx.dir.to_path_buf(),
            revision,
            entry_count: start.entry_count,
            pending,
            refs: Vec::new(),
            verifier,
        })
    }

    /// The private pending directory the pages are being staged in.
    pub fn pending_dir(&self) -> &Path {
        &self.pending
    }

    /// Stages the next page. The page takes the next index and the capture's generation; its
    /// entries must be valid and strictly ascending after every earlier entry, and the running total
    /// must stay within the count given at the start. The sealed envelope is staged, synced, and
    /// dropped. The context must be the one the capture started under: the same journal directory,
    /// and a key that authenticates the manifest the capture started from.
    ///
    /// A failure removes the staged pages with the builder, best effort, because nobody else can.
    pub fn push_page<F: DurableFs>(
        mut self,
        ctx: &mut JournalDurableContext<'_, F>,
        entries: Vec<JournalInventoryEntry>,
    ) -> Result<Self, JournalDurableError> {
        match self.stage_next(ctx, entries) {
            Ok(()) => Ok(self),
            Err(error) => {
                discard_staged(ctx, &self.pending, &self.refs);
                Err(error)
            }
        }
    }

    fn stage_next<F: DurableFs>(
        &mut self,
        ctx: &mut JournalDurableContext<'_, F>,
        entries: Vec<JournalInventoryEntry>,
    ) -> Result<(), JournalDurableError> {
        self.assert_context(ctx)?;
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
        if let Err(error) = store_page_at(ctx, &dir, &self.committed, &sealed) {
            // The page in flight may be on disk already, or the failure may be that a different file
            // sits in its slot: only a file that holds exactly the bytes staged here is ours to remove.
            let digest = &reference.page_content_digest;
            remove_if_staged(ctx, &generation_path(&dir, self.revision), digest);
            // The attempt's own staging link, which a failed promotion reports and leaves behind.
            remove_if_staged(
                ctx,
                &staging_path(&dir, self.revision, ctx.operation),
                digest,
            );
            return Err(error);
        }
        self.refs.push(reference);
        Ok(())
    }

    /// The capture belongs to one journal directory and one key. A context for another journal, or
    /// whose key does not open the manifest the capture started from, is refused before anything is
    /// sealed or written, so a page can never be staged that the journal key cannot open.
    fn assert_context<F: DurableFs>(
        &self,
        ctx: &JournalDurableContext<'_, F>,
    ) -> Result<(), JournalDurableError> {
        if ctx.dir != self.journal_dir.as_path() {
            return Err(JournalDurableError::Authority(
                MigrationExecutionError::LiveBindingMismatch,
            ));
        }
        assert_anchor(ctx.key, &self.committed, &self.live, &self.anchor)
    }

    /// Ends the capture: exactly the announced number of entries must have been staged. Returns the
    /// successor manifest, built and checked exactly as
    /// [`capture_inventory`](super::capture::capture_inventory) builds it from the same pages. A
    /// capture that does not end here is abandoned: its staged pages are removed, best effort.
    pub fn finish<F: DurableFs>(
        self,
        ctx: &mut JournalDurableContext<'_, F>,
    ) -> Result<StagedCapture, JournalDurableError> {
        let Self {
            committed,
            entry_count,
            pending,
            refs,
            verifier,
            ..
        } = self;
        let successor = verifier
            .finish_digest()
            .map_err(JournalDurableError::from)
            .and_then(|inventory_digest| {
                let parts = CapturedInventory {
                    refs: &refs,
                    entry_count,
                    inventory_digest,
                };
                capture_successor(&committed, &parts).map_err(JournalDurableError::Authority)
            });
        match successor {
            Ok(successor) => Ok(StagedCapture {
                successor,
                pending,
                refs,
            }),
            Err(error) => {
                discard_staged(ctx, &pending, &refs);
                Err(error)
            }
        }
    }
}

/// Removes the staged page files that `refs` describe. Best effort: a file that cannot be removed
/// stays as inert residue, and the error that led here is the one worth reporting, so removal
/// failures are not. A file is removed only if it still holds exactly the bytes this capture staged
/// (see [`remove_if_staged`]).
fn discard_staged<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    pending: &Path,
    refs: &[JournalPageRef],
) {
    for (index, reference) in refs.iter().enumerate() {
        let dir = pending.join(format!("page-{index}"));
        let path = generation_path(&dir, reference.page_generation);
        remove_if_staged(ctx, &path, &reference.page_content_digest);
    }
}

/// Removes the file at `path` only if its bytes hash to `digest`, the digest of what this capture
/// staged there, so a file that was replaced, or that a failure found already sitting in the slot, is
/// never deleted. The read is bounded by the largest valid page envelope.
fn remove_if_staged<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    path: &Path,
    digest: &[u8; 32],
) {
    let found = ctx.fs.read_at_most(path, MAX_PAGE_ENVELOPE_BYTES);
    if matches!(found, Ok(Some(bytes)) if content_digest(&bytes) == *digest) {
        let _ = ctx.fs.remove_file(path);
    }
}

/// The staged envelope at `path`, never larger than any valid sealed page. A staged file is a
/// candidate, not authority: a missing one is a broken attempt to abandon, never a recovery state of
/// the journal, so it is not reported as `RecoveryRequired` the way a missing authoritative page is.
fn read_staged_envelope<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    path: &Path,
) -> Result<Vec<u8>, JournalDurableError> {
    match ctx.fs.read_at_most(path, MAX_PAGE_ENVELOPE_BYTES) {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => Err(JournalError::Corrupt("staged page exceeds the envelope bound").into()),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            Err(JournalError::Corrupt("staged page is missing").into())
        }
        Err(error) => Err(JournalDurableError::Stage(stage_io(error))),
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
    let envelope = read_staged_envelope(ctx, &generation_path(&dir, reference.page_generation))?;
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
