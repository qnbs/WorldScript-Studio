//! Gate 4 slice I1b: a streamed capture keeps the pages of the stored predecessor whose entries are
//! unchanged. Nothing is staged for a kept page, its entries still go into the inventory digest, and the
//! promotion stores it from the predecessor's own set directory, so the set reads back like any other.

#[path = "support/journal_fixture.rs"]
mod journal_fixture;

use std::ops::Range;
use std::path::Path;

use journal_fixture::*;
use worldscript_secure_storage::*;

/// The generation of the first capture's pages (the revision after the committed one).
const FIRST: u64 = COMMITTED_REVISION + 1;
/// The generation of a page the second capture stages.
const SECOND: u64 = FIRST + 1;

fn entry_n(n: u32, evidence: u8) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:06}")]).unwrap();
    let source = JournalInventorySource {
        authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
        physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
        generation: None,
        evidence_digest: Some([evidence; 32]),
        foreign: None,
    };
    JournalInventoryEntry::new(record, source).unwrap()
}

/// The entries `range`, each with the evidence its number gives it.
fn page(range: Range<u32>) -> Vec<JournalInventoryEntry> {
    range.map(|n| entry_n(n, n as u8)).collect()
}

/// The entries `range` with other evidence: the same records, changed.
fn changed(range: Range<u32>) -> Vec<JournalInventoryEntry> {
    range.map(|n| entry_n(n, 0xEE)).collect()
}

/// A journal whose first capture (three pages of two entries) is promoted and committed as the
/// root-named manifest, with that stored set verified.
struct Stored {
    journal: Journal,
    committed: JournalManifest,
    predecessor: VerifiedInventory,
}

fn stored(count: u32) -> Stored {
    let base = manifest_at(COMMITTED_REVISION);
    let dir = TempDir::new();
    let live = commit_into(&dir.0, &base);
    let mut journal = Journal { dir, live };
    let pages = (0..count / 2).map(|i| page(2 * i..2 * i + 2)).collect();
    let staged = stream(&journal, &base, pages, None).unwrap();
    promote(&journal, &base, &staged).unwrap();
    let committed = staged.successor().clone();
    journal.live = commit_into(journal.path(), &committed);
    let predecessor = verify(&journal);
    Stored {
        journal,
        committed,
        predecessor,
    }
}

fn context_over<T>(
    journal: &Journal,
    run: impl FnOnce(&mut JournalDurableContext<'_, StdFs>) -> T,
) -> T {
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = StdFs;
    run(&mut JournalDurableContext::new(
        &mut fs,
        &key,
        journal.path(),
        &op,
    ))
}

fn verify(journal: &Journal) -> VerifiedInventory {
    context_over(journal, |ctx| {
        verify_stored_inventory(ctx, &journal.live).unwrap()
    })
}

/// Stages `pages` over `committed`, keeping the unchanged ones when a `predecessor` is given.
fn stream(
    journal: &Journal,
    committed: &JournalManifest,
    pages: Vec<Vec<JournalInventoryEntry>>,
    predecessor: Option<&VerifiedInventory>,
) -> Result<StagedCapture, JournalDurableError> {
    let total = pages.iter().map(Vec::len).sum::<usize>() as u32;
    let fence = MigrationFence::from_manifest(committed);
    let start = CaptureStart {
        committed_manifest: committed,
        fence: &fence,
        live: &journal.live,
        entry_count: total,
    };
    context_over(journal, |ctx| {
        let mut capture = StreamedCapture::begin(ctx, &start)?;
        for entries in pages {
            capture = match predecessor {
                Some(known) => capture.push_page_inheriting(ctx, entries, known)?,
                None => capture.push_page(ctx, entries)?,
            };
        }
        capture.finish(ctx)
    })
}

fn promote(
    journal: &Journal,
    committed: &JournalManifest,
    staged: &StagedCapture,
) -> Result<DirectoryDurability, JournalDurableError> {
    let fence = MigrationFence::from_manifest(committed);
    let promotion = StagedPromotion {
        committed_manifest: committed,
        fence: &fence,
        committed: &journal.live,
        staged,
    };
    context_over(journal, |ctx| {
        promote_staged_inventory_fenced(ctx, &promotion)
    })
}

fn files_below(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().path())
                .map(|path| if path.is_dir() { files_below(&path) } else { 1 })
                .sum()
        })
        .unwrap_or(0)
}

fn kept(staged: &StagedCapture) -> Vec<bool> {
    (0..staged.page_refs().len() as u32)
        .map(|index| staged.is_inherited(index))
        .collect()
}

fn generations(staged: &StagedCapture) -> Vec<u64> {
    staged
        .page_refs()
        .iter()
        .map(|reference| reference.page_generation)
        .collect()
}

/// Every staged page read back, as the in-memory capture would hold it.
fn read_back(journal: &Journal, staged: &StagedCapture) -> Vec<StagedPage> {
    context_over(journal, |ctx| {
        (0..staged.page_refs().len() as u32)
            .map(|index| load_staged_page(ctx, staged, index).unwrap())
            .collect()
    })
}

#[test]
fn unchanged_pages_are_kept_and_changed_pages_are_staged_and_the_set_reads_back() {
    let mut first = stored(6);
    let pages = vec![page(0..2), changed(2..4), page(4..6)];
    let staged = stream(
        &first.journal,
        &first.committed,
        pages,
        Some(&first.predecessor),
    )
    .unwrap();
    // The successor is exactly what the in-memory capture builds from the same pages.
    let read = read_back(&first.journal, &staged);
    let sealed: Vec<SealedPage<'_>> = read
        .iter()
        .map(|staged_page| SealedPage {
            page: &staged_page.page,
            envelope: &staged_page.envelope,
        })
        .collect();
    let fence = MigrationFence::from_manifest(&first.committed);
    let in_memory = capture_inventory(&first.committed, &fence, &sealed).unwrap();
    assert_eq!(
        (
            staged.inherited_pages(),
            kept(&staged),
            generations(&staged),
            files_below(staged.pending_dir()),
            &in_memory == staged.successor(),
        ),
        (
            2,
            vec![true, false, true],
            vec![FIRST, SECOND, FIRST],
            1,
            true
        )
    );
    promote(&first.journal, &first.committed, &staged).unwrap();
    first.journal.live = commit_into(first.journal.path(), staged.successor());
    let verified = verify(&first.journal);
    let stored_generations: Vec<u64> = verified
        .page_refs()
        .iter()
        .map(|reference| reference.page_generation)
        .collect();
    let same_first_page = context_over(&first.journal, |ctx| {
        let kept_page = load_inventory_page(ctx, &verified, 0).unwrap();
        let known_page = load_inventory_page(ctx, &first.predecessor, 0).unwrap();
        kept_page == known_page
    });
    assert_eq!(
        (stored_generations, same_first_page),
        (vec![FIRST, SECOND, FIRST], true)
    );
}

#[test]
fn an_unchanged_inventory_stages_nothing_and_its_set_still_verifies() {
    let mut first = stored(6);
    let pages = vec![page(0..2), page(2..4), page(4..6)];
    let staged = stream(
        &first.journal,
        &first.committed,
        pages,
        Some(&first.predecessor),
    )
    .unwrap();
    assert_eq!(
        (staged.inherited_pages(), files_below(staged.pending_dir())),
        (3, 0)
    );
    promote(&first.journal, &first.committed, &staged).unwrap();
    first.journal.live = commit_into(first.journal.path(), staged.successor());
    let verified = verify(&first.journal);
    assert_eq!(verified.page_refs(), first.predecessor.page_refs());
}

#[test]
fn only_a_page_equal_to_the_predecessors_page_of_the_same_index_is_kept() {
    let first = stored(6);
    // A fourth page beyond the predecessor's three is staged; so is every page of a shifted cut.
    let longer = vec![page(0..2), page(2..4), page(4..6), page(6..8)];
    let shifted = vec![page(0..1), page(1..3), page(3..5), page(5..6)];
    let outcomes: Vec<(usize, Vec<bool>)> = [longer, shifted]
        .into_iter()
        .map(|pages| {
            let staged = stream(
                &first.journal,
                &first.committed,
                pages,
                Some(&first.predecessor),
            )
            .unwrap();
            let outcome = (staged.inherited_pages(), kept(&staged));
            staged.discard(&mut StdFs);
            outcome
        })
        .collect();
    assert_eq!(
        outcomes,
        vec![
            (3, vec![true, true, true, false]),
            (0, vec![false, false, false, false])
        ]
    );
}

#[test]
fn a_predecessor_of_another_manifest_or_a_foreign_key_keeps_nothing_and_stages_nothing() {
    let first = stored(6);
    let other = stored(8);
    let fence = MigrationFence::from_manifest(&first.committed);
    let start = CaptureStart {
        committed_manifest: &first.committed,
        fence: &fence,
        live: &first.journal.live,
        entry_count: 2,
    };
    let begin = || {
        context_over(&first.journal, |ctx| {
            StreamedCapture::begin(ctx, &start).unwrap()
        })
    };
    let (op, journal_key, foreign_key) =
        (WriteOperationId::generate().unwrap(), key(), other_key());
    let mut observed = ObservedFs::new();
    let mut ctx =
        JournalDurableContext::new(&mut observed, &journal_key, first.journal.path(), &op);
    let wrong_manifest = begin()
        .push_page_inheriting(&mut ctx, page(0..2), &other.predecessor)
        .err();
    let mut foreign_ctx =
        JournalDurableContext::new(&mut observed, &foreign_key, first.journal.path(), &op);
    let foreign = begin()
        .push_page_inheriting(&mut foreign_ctx, page(0..2), &first.predecessor)
        .is_err();
    assert_eq!(
        (wrong_manifest, foreign, observed.created_nothing()),
        (
            Some(JournalDurableError::Authority(
                MigrationExecutionError::LiveBindingMismatch
            )),
            true,
            true
        )
    );
}

#[test]
fn discarding_a_capture_removes_what_it_staged_and_never_the_predecessors_pages() {
    let first = stored(6);
    let pages = vec![page(0..2), changed(2..4), page(4..6)];
    let staged = stream(
        &first.journal,
        &first.committed,
        pages,
        Some(&first.predecessor),
    )
    .unwrap();
    let pending = staged.pending_dir().to_path_buf();
    let before = files_below(&pending);
    staged.discard(&mut StdFs);
    assert_eq!(
        (
            before,
            files_below(&pending),
            verify(&first.journal).page_refs() == first.predecessor.page_refs()
        ),
        (1, 0, true)
    );
}
