//! Gate 4 slice I1a: a later capture keeps the pages the predecessor's authenticated references name
//! exactly. Every refusal happens before the first byte, and an inherited page is stored again under
//! the new set's own directory, so each stored set stays self-contained.

#[path = "support/journal_fixture.rs"]
mod journal_fixture;
#[path = "support/inventory.rs"]
mod support;

use journal_fixture::*;
use support::*;
use worldscript_secure_storage::*;

/// The generation of the first capture's pages (the revision after the committed one).
const FIRST: u64 = COMMITTED_REVISION + 1;
/// The generation of a page the second capture writes.
const SECOND: u64 = FIRST + 1;

/// A journal in which a first capture of `count` entries (two per page) is stored and committed,
/// with that stored set verified.
fn stored(count: u32) -> (Journal, Captured, VerifiedInventory) {
    let first = Captured::new(count, 2);
    let mut journal = journal_of(&first);
    store(&mut StdFs, &journal, &first).unwrap();
    journal.live = commit_into(journal.path(), &first.successor);
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, journal.path(), &op);
    let verified = verify_stored_inventory(&mut ctx, &journal.live).unwrap();
    (journal, first, verified)
}

/// Entry `n` as the first capture holds it, but with other evidence: the same record, changed.
fn changed_entry(n: u32) -> JournalInventoryEntry {
    let unchanged = entry(n);
    let source = JournalInventorySource {
        authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
        physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
        generation: None,
        evidence_digest: Some([0xEE; 32]),
        foreign: None,
    };
    JournalInventoryEntry::new(unchanged.record.clone(), source).unwrap()
}

/// A page sealed under the journal key over `committed`.
fn sealed_page(committed: &JournalManifest, page: &JournalPage) -> Vec<u8> {
    let sealed = seal_inventory_pages(&key(), committed, std::slice::from_ref(page)).unwrap();
    sealed.into_iter().next().unwrap()
}

/// A second capture over the first one's successor: pages 0 and 2 are the first capture's own bytes,
/// page 1 is written for this capture.
fn recapture(first: &Captured) -> Captured {
    let committed = first.successor.clone();
    let rewritten = JournalPage::new(1, SECOND, vec![changed_entry(2), changed_entry(3)]).unwrap();
    let rewritten_bytes = sealed_page(&committed, &rewritten);
    let pages = vec![first.pages[0].clone(), rewritten, first.pages[2].clone()];
    let envelopes = vec![
        first.envelopes[0].clone(),
        rewritten_bytes,
        first.envelopes[2].clone(),
    ];
    Captured::from_sealed(committed, pages, envelopes)
}

fn inheriting<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    captured: &Captured,
    predecessor: &VerifiedInventory,
) -> Result<DirectoryDurability, JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, journal.path(), &op);
    let pages = captured.sealed();
    let set = set_of(captured, Some(&journal.live), &pages);
    promote_inventory_set_inheriting_fenced(&mut ctx, &set, predecessor)
}

fn refused_without_a_byte(
    journal: &Journal,
    captured: &Captured,
    predecessor: &VerifiedInventory,
) -> bool {
    let mut fs = ObservedFs::new();
    let outcome = inheriting(&mut fs, journal, captured, predecessor);
    let mismatch = matches!(
        outcome,
        Err(JournalDurableError::Journal(
            JournalError::GenerationMismatch
        ))
    );
    mismatch && fs.created_nothing()
}

fn generation_file(journal: &Journal, captured: &Captured, index: u32, generation: u64) -> Vec<u8> {
    let dir = inventory_page_dir(journal.path(), &captured.digest(), index);
    std::fs::read(generation_path(&dir, generation)).unwrap()
}

#[test]
fn an_inherited_page_is_stored_again_and_the_set_reads_back_with_mixed_generations() {
    let (mut journal, first, predecessor) = stored(6);
    let second = recapture(&first);
    inheriting(&mut StdFs, &journal, &second, &predecessor).unwrap();
    let stored_again = generation_file(&journal, &second, 0, FIRST) == first.envelopes[0]
        && generation_file(&journal, &second, 2, FIRST) == first.envelopes[2];
    journal.live = commit_into(journal.path(), &second.successor);
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, journal.path(), &op);
    let verified = verify_stored_inventory(&mut ctx, &journal.live).unwrap();
    let generations: Vec<u64> = verified
        .page_refs()
        .iter()
        .map(|reference| reference.page_generation)
        .collect();
    let first_page = load_inventory_page(&mut ctx, &verified, 0).unwrap();
    assert_eq!(
        (stored_again, generations, first_page == first.pages[0]),
        (true, vec![FIRST, SECOND, FIRST], true)
    );
}

#[test]
fn the_strict_store_still_refuses_an_older_generation_and_creates_nothing() {
    let (journal, first, _) = stored(6);
    let second = recapture(&first);
    let mut fs = ObservedFs::new();
    let outcome = store(&mut fs, &journal, &second);
    assert!(matches!(
        outcome,
        Err(JournalDurableError::Journal(
            JournalError::GenerationMismatch
        ))
    ));
    assert!(fs.created_nothing());
}

#[test]
fn only_a_page_the_predecessor_names_exactly_may_keep_an_older_generation() {
    let (journal, first, predecessor) = stored(6);
    let committed = first.successor.clone();
    // The same entries sealed again carry other bytes: a new page, not the inherited one.
    let resealed = sealed_page(&committed, &first.pages[0]);
    let resealed_capture = Captured::from_sealed(
        committed.clone(),
        recapture(&first).pages,
        vec![
            resealed,
            recapture(&first).envelopes[1].clone(),
            first.envelopes[2].clone(),
        ],
    );
    // A changed page that claims the first capture's generation.
    let claimed = JournalPage::new(1, FIRST, vec![changed_entry(2), changed_entry(3)]).unwrap();
    let claimed_bytes = sealed_page(&committed, &claimed);
    let claiming_capture = Captured::from_sealed(
        committed.clone(),
        vec![first.pages[0].clone(), claimed, first.pages[2].clone()],
        vec![
            first.envelopes[0].clone(),
            claimed_bytes,
            first.envelopes[2].clone(),
        ],
    );
    // A fourth page, beyond the three the predecessor holds, that claims the first generation.
    let extra = JournalPage::new(3, FIRST, vec![entry(6), entry(7)]).unwrap();
    let extra_bytes = sealed_page(&committed, &extra);
    let mut pages = first.pages.clone();
    pages.push(extra);
    let mut envelopes = first.envelopes.clone();
    envelopes.push(extra_bytes);
    let extending_capture = Captured::from_sealed(committed, pages, envelopes);
    // The same entries sealed under a key that is not the journal key.
    let foreign_key_capture = Captured::from_sealed(
        first.successor.clone(),
        recapture(&first).pages,
        vec![
            sealed_under(&first, &other_key(), 1),
            recapture(&first).envelopes[1].clone(),
            first.envelopes[2].clone(),
        ],
    );
    let refused = [
        resealed_capture,
        claiming_capture,
        extending_capture,
        foreign_key_capture,
    ]
    .iter()
    .map(|captured| refused_without_a_byte(&journal, captured, &predecessor))
    .collect::<Vec<_>>();
    assert_eq!(refused, [true, true, true, true]);
}

/// The first capture's own pages, stored and verified under a manifest that is not the first
/// capture's successor (one revision later): same page references, other manifest.
fn verified_under_a_later_manifest(first: &Captured) -> VerifiedInventory {
    let mut journal = journal_of(first);
    store(&mut StdFs, &journal, first).unwrap();
    let mut later = first.successor.clone();
    later.journal_revision += 1;
    journal.live = commit_into(journal.path(), &later);
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, journal.path(), &op);
    verify_stored_inventory(&mut ctx, &journal.live).unwrap()
}

#[test]
fn a_predecessor_verified_for_another_manifest_is_no_proof() {
    let (journal, first, _) = stored(6);
    let (_, _, other_content) = stored(8);
    let same_pages_later_manifest = verified_under_a_later_manifest(&first);
    let second = recapture(&first);
    let refused = [other_content, same_pages_later_manifest]
        .iter()
        .map(|predecessor| refused_without_a_byte(&journal, &second, predecessor))
        .collect::<Vec<_>>();
    assert_eq!(refused, [true, true]);
}
