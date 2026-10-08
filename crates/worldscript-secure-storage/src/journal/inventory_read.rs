//! Gate 4D Slice C1b-2: reading back a stored inventory page set (§10.1.1).
//!
//! The manifest authenticates the page set only as `journal_page_set_digest`, whose per-page
//! generation is bound inside the digest but not stored in the manifest, and §10.1.1 says a file name
//! or directory listing is never authoritative for page identity, generation or membership. So the
//! reader works in two passes over the digest-keyed directories [`inventory_page_dir`] names:
//!
//! 1. [`verify_stored_inventory`] loads the root-named manifest itself, finds each page's
//!    generation by listing its directory only as a hint, opens the page under its identity,
//!    streams the inventory digest one page at a time, keeps only the page references, and
//!    finally confirms both digests against the manifest. Nothing it reads is trusted until the
//!    digests confirm it.
//! 2. [`load_inventory_page`] reads one page by the exact path of its verified reference and
//!    requires the envelope to hash to the reference before it is opened.
//!
//! Memory is one envelope and one decoded page at a time plus the references. The reader creates
//! nothing and takes no lock: generations are immutable.

use std::io::ErrorKind;
use std::path::Path;

use crate::commit::parse_generation_name;
use crate::durable::{generation_path, DurableFs};
use crate::envelope::{HEADER_LEN, TAG_LEN};
use crate::marker::content_digest;
use crate::root::LiveMigration;

use super::capture::assert_page_not_empty;
use super::digest::{page_ref_for, InventoryDigestVerifier};
use super::durable::{
    load_authoritative_manifest, migration_page_identity, stage_io, JournalDurableContext,
    JournalDurableError,
};
use super::inventory_store::{has_epoch, inventory_page_dir};
use super::manifest::{journal_envelope_epoch, JournalManifest, JournalPageRef};
use super::page::JournalPage;
use super::state::MigrationExecutionError;
use super::{JournalError, MAX_JOURNAL_PAGE_BYTES};

/// The largest valid sealed page: the page encoding bound plus the envelope header and tag.
pub(super) const MAX_PAGE_ENVELOPE_BYTES: usize = MAX_JOURNAL_PAGE_BYTES + HEADER_LEN + TAG_LEN;
/// A page directory holds one generation and, at most, a few staging leftovers; a directory with
/// more entries than this is not read.
const MAX_PAGE_DIRECTORY_ENTRIES: usize = 64;

/// A stored page set that the root-named manifest authenticated. Only [`verify_stored_inventory`]
/// constructs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedInventory {
    manifest: JournalManifest,
    page_refs: Vec<JournalPageRef>,
}

impl VerifiedInventory {
    /// The root-named manifest the pages were verified against.
    pub fn manifest(&self) -> &JournalManifest {
        &self.manifest
    }

    /// The authenticated reference of every page, in page-index order.
    pub fn page_refs(&self) -> &[JournalPageRef] {
        &self.page_refs
    }
}

/// Verifies the page set the root binding `live` names, page by page.
///
/// The manifest is loaded from the root-named generation (digest-verified), never taken from the
/// caller. A missing page directory or file, no canonical generation file in a page directory, or
/// more than one (mixed generations) is `Authority(RecoveryRequired)`; a page that does not open as
/// its own identity, generation and key epoch, or whose digests do not confirm, keeps its own
/// `Journal(..)` error. Mapping these to the recovery state is the caller's.
pub fn verify_stored_inventory<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    live: &LiveMigration,
) -> Result<VerifiedInventory, JournalDurableError> {
    let manifest = load_authoritative_manifest(ctx, live)?;
    let mut verifier =
        InventoryDigestVerifier::new(manifest.inventory_version, manifest.entry_count)?;
    let mut page_refs = Vec::new();
    for index in 0..manifest.page_count {
        let dir = inventory_page_dir(ctx.dir, &manifest.journal_page_set_digest, index);
        let generation = hinted_generation(ctx, &dir)?;
        let bytes = read_envelope(ctx, &generation_path(&dir, generation))?;
        let page = open_stored_page(ctx, &manifest, index, generation, &bytes)?;
        assert_canonical_page(&manifest, &page)?;
        verifier.absorb_page(&page)?;
        page_refs.push(page_ref_for(&page, &bytes)?);
    }
    manifest.verify_page_set(&page_refs)?;
    verifier.finish(manifest.inventory_digest)?;
    Ok(VerifiedInventory {
        manifest,
        page_refs,
    })
}

/// Reads page `page_index` of a verified set by the exact path of its authenticated reference.
///
/// The envelope must hash to the reference before it is opened, so a file that changed after
/// [`verify_stored_inventory`] is refused rather than trusted.
pub fn load_inventory_page<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    verified: &VerifiedInventory,
    page_index: u32,
) -> Result<JournalPage, JournalDurableError> {
    let reference = usize::try_from(page_index)
        .ok()
        .and_then(|index| verified.page_refs.get(index))
        .ok_or(JournalError::InvalidPageIndex)?;
    let manifest = &verified.manifest;
    let dir = inventory_page_dir(ctx.dir, &manifest.journal_page_set_digest, page_index);
    let bytes = read_envelope(ctx, &generation_path(&dir, reference.page_generation))?;
    if content_digest(&bytes) != reference.page_content_digest {
        return Err(JournalError::PageSetMismatch.into());
    }
    let page = open_stored_page(ctx, manifest, page_index, reference.page_generation, &bytes)?;
    if page.entries().len() as u64 != u64::from(reference.page_entry_count) {
        return Err(JournalError::EntryCountMismatch.into());
    }
    Ok(page)
}

/// The generation of the one canonical `generation-<n>.wsr1` in `dir`. The listing is only a hint:
/// the page-set digest later confirms or refuses what it led to.
fn hinted_generation<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    dir: &Path,
) -> Result<u64, JournalDurableError> {
    // The listing is bounded while it is read, so a hostile directory cannot exhaust memory.
    let names = match ctx.fs.list_dir_at_most(dir, MAX_PAGE_DIRECTORY_ENTRIES) {
        Ok(Some(names)) => names,
        Ok(None) => return Err(recovery_required()),
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(recovery_required()),
        Err(error) => return Err(JournalDurableError::Stage(stage_io(error))),
    };
    let mut generations = names.iter().filter_map(parse_generation_name);
    match (generations.next(), generations.next()) {
        (Some(generation), None) => Ok(generation),
        _ => Err(recovery_required()),
    }
}

/// The envelope at `path`, never larger than any valid sealed page.
pub(super) fn read_envelope<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    path: &Path,
) -> Result<Vec<u8>, JournalDurableError> {
    match ctx.fs.read_at_most(path, MAX_PAGE_ENVELOPE_BYTES) {
        Ok(Some(bytes)) => Ok(bytes),
        Ok(None) => Err(JournalError::Corrupt("page generation exceeds the envelope bound").into()),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(recovery_required()),
        Err(error) => Err(JournalDurableError::Stage(stage_io(error))),
    }
}

/// Opens `bytes` as this operation's page `index` at `generation` under the journal key. Read routing
/// is authority-first (§6): the header's epoch is compared with the operation's journal envelope
/// epoch before the key is used, so a misrouted page is never decrypted.
pub(super) fn open_stored_page<F: DurableFs>(
    ctx: &JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    index: u32,
    generation: u64,
    bytes: &[u8],
) -> Result<JournalPage, JournalDurableError> {
    let identity = migration_page_identity(&manifest.operation_id, index)?;
    if !has_epoch(bytes, journal_envelope_epoch(manifest)?)? {
        return Err(JournalError::KeyEpochMismatch.into());
    }
    Ok(JournalPage::open(ctx.key, &identity, generation, bytes)?)
}

/// A page only a canonical writer produces: `capture_inventory` gives a page a generation in
/// `1..=journal_revision` and an empty inventory no page at all, so a set that both digests confirm
/// but that breaks either rule was written by something else and is not certified.
fn assert_canonical_page(
    manifest: &JournalManifest,
    page: &JournalPage,
) -> Result<(), JournalError> {
    assert_page_not_empty(page)?;
    let generation = page.page_generation();
    if generation == 0 || generation > manifest.journal_revision {
        return Err(JournalError::GenerationMismatch);
    }
    Ok(())
}

fn recovery_required() -> JournalDurableError {
    JournalDurableError::Authority(MigrationExecutionError::RecoveryRequired)
}
