//! Gate 4D inventory tamper fixtures: the stored page file of a capture and the ways a test breaks one
//! (another epoch, a replaced page, a page-set digest bound to what the pages are now). Split from
//! `inventory` so the tests that only capture and store do not carry helpers they never use.

use std::path::{Path, PathBuf};

use crate::journal_fixture::*;
use crate::support::{sealed_under, Captured};
use worldscript_secure_storage::{
    inventory_page_dir, journal_page_set_digest, page_ref_for, seal_inventory_pages, JournalPage,
};

pub fn page_file(dir: &Path, digest: &[u8; 32], index: u32) -> PathBuf {
    inventory_page_dir(dir, digest, index).join("generation-4.wsr1")
}

/// Page 0's envelope sealed for `epoch` under the journal key.
pub fn sealed_at_epoch(captured: &Captured, epoch: u64) -> Vec<u8> {
    sealed_under(captured, &key(), epoch)
}

/// Replaces the captured pages by `page`, sealed; the successor is left as it was.
pub fn reseal(captured: &mut Captured, page: JournalPage) {
    captured.envelopes = seal_inventory_pages(
        &key(),
        &captured.committed_manifest,
        std::slice::from_ref(&page),
    )
    .unwrap();
    captured.pages = vec![page];
}

/// Binds the successor's page-set digest to the pages as they are now, as a hand-built manifest
/// would.
pub fn rebind(captured: &mut Captured) {
    let refs: Vec<_> = captured
        .pages
        .iter()
        .zip(&captured.envelopes)
        .map(|(page, envelope)| page_ref_for(page, envelope).unwrap())
        .collect();
    captured.successor.journal_page_set_digest = journal_page_set_digest(&refs).unwrap();
}
