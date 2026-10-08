//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).
//!
//! Streaming capture, stage one: an inventory built and staged one page at a time (§10.1.1, §10.3),
//! at the end of the file.

#[path = "support/inventory.rs"]
mod support;

use std::collections::BTreeSet;
use std::path::Path;

use support::*;
use worldscript_secure_storage::*;

/// Stores `captured` into `journal` and returns the refusal, requiring that nothing was created.
fn refusal_in(journal: &Journal, captured: &Captured) -> JournalDurableError {
    let mut fs = ObservedFs::new();
    let error = store(&mut fs, journal, captured).unwrap_err();
    assert!(fs.created_nothing(), "{error:?} must leave nothing behind");
    error
}

/// What `StdFs` reports for a synced directory chain: only Unix can confirm it.
fn confirmed_here() -> DirectoryDurability {
    if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    }
}

/// What is on disk is exactly the page set the capture bound.
fn assert_stored(dir: &Path, captured: &Captured) {
    let refs: Vec<_> = captured
        .pages
        .iter()
        .map(|page| {
            let page_dir = inventory_page_dir(dir, &captured.digest(), page.page_index());
            let file = generation_path(&page_dir, page.page_generation());
            page_ref_for(page, &std::fs::read(file).unwrap()).unwrap()
        })
        .collect();
    captured.successor.verify_page_set(&refs).unwrap();
}

#[test]
fn a_captured_inventory_is_stored_under_the_directory_its_digest_names() {
    let captured = Captured::new(5, 2);
    let journal = journal_of(&captured);
    let durability = store(&mut StdFs, &journal, &captured).unwrap();
    assert_eq!(durability, confirmed_here());
    assert_stored(journal.path(), &captured);
}

#[test]
fn the_directory_chain_up_to_the_journal_directory_is_synced() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    let mut fs = ObservedFs::new();
    store(&mut fs, &journal, &captured).unwrap();
    let page_dir = inventory_page_dir(journal.path(), &captured.digest(), 0);
    let set_dir = page_dir.parent().unwrap().to_path_buf();
    let inventory_dir = set_dir.parent().unwrap().to_path_buf();
    for synced in [
        &page_dir,
        &set_dir,
        &inventory_dir,
        &journal.path().to_path_buf(),
    ] {
        assert!(
            fs.synced.contains(synced),
            "{} was not synced",
            synced.display()
        );
    }
}

#[test]
fn a_directory_sync_failure_after_the_promotion_is_reported_as_promoted() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    let mut fs = ObservedFs::new();
    let page_dir = inventory_page_dir(journal.path(), &captured.digest(), 0);
    fs.fail_sync_of = Some(page_dir.parent().unwrap().to_path_buf());
    let Err(JournalDurableError::Stage(stage)) = store(&mut fs, &journal, &captured) else {
        panic!("a failed parent sync must be reported");
    };
    assert_eq!(
        (stage.step, stage.promoted),
        (StageStep::SyncDirectory, true)
    );
    // The page is there: a retry meets the immutable generation, not an absent page.
    assert!(page_file(journal.path(), &captured.digest(), 0).is_file());
}

/// The binding the root would hold, changed by `change`.
fn binding_with(journal: &Journal, change: fn(&mut LiveMigration)) -> Option<LiveMigration> {
    let mut live = journal.live.clone();
    change(&mut live);
    Some(live)
}

#[test]
fn a_store_that_the_authority_checks_refuse_creates_nothing() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    let cases = [
        (
            "a later committed fence",
            binding_with(&journal, |live| live.fencing_generation = 8),
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "another operation",
            binding_with(&journal, |live| live.operation_id = "other-op".into()),
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "a digest naming another manifest envelope",
            binding_with(&journal, |live| live.manifest_digest = [0x99; 32]),
            MigrationExecutionError::LiveBindingMismatch,
        ),
        (
            "no committed binding",
            None,
            MigrationExecutionError::LiveBindingMismatch,
        ),
    ];
    for (name, binding, error) in cases {
        let mut fs = ObservedFs::new();
        let result = store_as(&mut fs, &journal, &captured, binding.as_ref());
        assert_eq!(
            result.unwrap_err(),
            JournalDurableError::Authority(error),
            "{name}"
        );
        assert!(fs.created_nothing(), "{name}");
    }
    assert!(!journal.path().join("inventory").exists());
}

#[test]
fn a_predecessor_that_is_not_the_root_named_manifest_is_refused() {
    let genuine = Captured::new(2, 2);
    let journal = journal_of(&genuine);
    // Same operation, fence and revision as the binding, another target key: a successor built on
    // it passes every capture check, but it is not the manifest the root names.
    let mut forged_manifest = genuine.committed_manifest.clone();
    forged_manifest.target_root_key_ref_digest = Some([0x43; 32]);
    let forged = Captured::on(forged_manifest, 2, 2);
    assert_eq!(
        refusal_in(&journal, &forged),
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
}

/// A captured inventory after `tweak`, which may corrupt any part of it.
fn tweaked(tweak: impl FnOnce(&mut Captured)) -> Captured {
    let mut captured = Captured::new(2, 2);
    tweak(&mut captured);
    captured
}

struct Refusal {
    name: &'static str,
    captured: Captured,
    error: JournalDurableError,
}

impl Refusal {
    fn authority(name: &'static str, captured: Captured, error: MigrationExecutionError) -> Self {
        let error = JournalDurableError::Authority(error);
        Refusal {
            name,
            captured,
            error,
        }
    }

    fn journal(name: &'static str, captured: Captured, error: JournalError) -> Self {
        let error = JournalDurableError::Journal(error);
        Refusal {
            name,
            captured,
            error,
        }
    }
}

/// Every refusal must happen before the first byte is written, with exactly the stated error. The
/// committed manifest is written to disk after the tweak, so the root-named predecessor is the one
/// the tweaked fixture presents.
fn assert_all_refused(refusals: Vec<Refusal>) {
    for refusal in refusals {
        let journal = journal_of(&refusal.captured);
        assert_eq!(
            refusal_in(&journal, &refusal.captured),
            refusal.error,
            "{}",
            refusal.name
        );
    }
}

#[test]
fn a_successor_the_store_cannot_accept_is_refused_before_any_write() {
    let skipped_phase = tweaked(|c| c.successor.phase = phase_code::ADMIT);
    let bootstrap = tweaked(|c| {
        c.committed_manifest.phase = phase_code::BOOTSTRAP_TARGET;
        c.successor.phase = phase_code::BOOTSTRAP_TARGET;
    });
    let advanced = tweaked(|c| {
        c.committed_manifest.cursor_entry_index = 1;
        c.successor.cursor_entry_index = 1;
    });
    let phase_change = tweaked(|c| c.successor.phase = phase_code::PREPARE);
    // Only inventory fields differ, so the successor relation and the capture window accept it; the
    // manifest encoding bounds the entry count.
    let unencodable = tweaked(|c| c.successor.entry_count = 1_000_001);
    assert_all_refused(vec![
        Refusal::authority(
            "a successor that skips ahead in the phase order",
            skipped_phase,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        Refusal::authority(
            "a bootstrap manifest has no inventory yet",
            bootstrap,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        Refusal::authority(
            "a manifest whose cursor already advanced",
            advanced,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        Refusal::authority(
            "a capture that also changes the phase",
            phase_change,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        Refusal::journal(
            "a successor that does not encode",
            unencodable,
            JournalError::TooManyEntries,
        ),
    ]);
}

#[test]
fn a_page_set_the_successor_does_not_name_is_refused_before_any_write() {
    // The same entries sealed again: valid pages, but not the bytes the successor's digest binds.
    let foreign = tweaked(|c| {
        let other = Captured::new(2, 2);
        (c.pages, c.envelopes) = (other.pages, other.envelopes);
    });
    // Both digests verify, only the index (or the canonical form) is wrong.
    let index_one = tweaked(|c| {
        reseal(
            c,
            JournalPage::new(1, 4, c.pages[0].entries().to_vec()).unwrap(),
        );
        rebind(c);
    });
    let empty = tweaked(|c| {
        reseal(c, JournalPage::new(0, 4, Vec::new()).unwrap());
        c.successor.entry_count = 0;
        c.successor.inventory_digest = empty_inventory_digest(1);
        rebind(c);
    });
    let future = tweaked(|c| {
        reseal(
            c,
            JournalPage::new(0, 5, c.pages[0].entries().to_vec()).unwrap(),
        );
    });
    assert_all_refused(vec![
        Refusal::journal(
            "envelopes of another capture",
            foreign,
            JournalError::PageSetMismatch,
        ),
        Refusal::journal(
            "pages not indexed 0..n",
            index_one,
            JournalError::PageSetMismatch,
        ),
        Refusal::journal("an empty page", empty, JournalError::InvalidDescriptorCount),
        Refusal::journal(
            "a page generation above the next revision",
            future,
            JournalError::GenerationMismatch,
        ),
    ]);
}

#[test]
fn an_envelope_that_does_not_belong_to_its_page_is_refused_before_any_write() {
    let mut swapped = Captured::new(4, 2);
    swapped.envelopes.swap(0, 1);
    let error = refusal_in(&journal_of(&swapped), &swapped);
    assert!(matches!(
        error,
        JournalDurableError::Journal(JournalError::Open(_))
    ));
    // A foreign key epoch is caught by the preflight, not only once a staging file exists.
    let mut foreign_epoch = Captured::new(2, 2);
    foreign_epoch.envelopes[0] = sealed_at_epoch(&foreign_epoch, 2);
    let error = refusal_in(&journal_of(&foreign_epoch), &foreign_epoch);
    assert_eq!(
        error,
        JournalDurableError::Journal(JournalError::KeyEpochMismatch)
    );
}

#[test]
fn page_sets_with_different_digests_never_collide() {
    // Sealing uses a fresh nonce, so two attempts at the same inventory differ.
    let first = Captured::new(2, 2);
    let second = Captured::new(2, 2);
    assert_ne!(first.digest(), second.digest());
    let journal = journal_of(&first);
    for captured in [&first, &second] {
        store(&mut StdFs, &journal, captured).unwrap();
    }
    for captured in [&first, &second] {
        let file = page_file(journal.path(), &captured.digest(), 0);
        assert_eq!(std::fs::read(file).unwrap(), captured.envelopes[0]);
    }
}

#[test]
fn storing_the_same_set_again_adopts_the_identical_pages() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    store(&mut StdFs, &journal, &captured).unwrap();
    let mut fs = ObservedFs::new();
    let again = store(&mut fs, &journal, &captured);
    assert_eq!(again.unwrap(), confirmed_here());
    // Nothing was staged, and the chain was synced again.
    assert_eq!(fs.creates, 0);
    let page_dir = inventory_page_dir(journal.path(), &captured.digest(), 0);
    assert!(fs.synced.contains(&page_dir));
    assert_stored(journal.path(), &captured);
}

#[test]
fn a_set_that_failed_partway_is_completed_by_a_retry() {
    let captured = Captured::new(5, 2);
    let journal = journal_of(&captured);
    let mut broken = ObservedFs::new();
    broken.fail_create_at = Some(3);
    let Err(JournalDurableError::Stage(stage)) = store(&mut broken, &journal, &captured) else {
        panic!("the third page's staging file cannot be created");
    };
    assert_eq!(
        (stage.step, stage.promoted),
        (StageStep::CreateStaging, false)
    );
    // Pages 0 and 1 are durable, page 2 is missing.
    assert!(page_file(journal.path(), &captured.digest(), 1).is_file());
    assert!(!page_file(journal.path(), &captured.digest(), 2).exists());
    let mut healthy = ObservedFs::new();
    let second = store(&mut healthy, &journal, &captured);
    assert_eq!(second.unwrap(), confirmed_here());
    assert_eq!(healthy.creates, 1);
    assert_stored(journal.path(), &captured);
}

#[test]
fn an_adopted_page_reports_the_staging_link_an_earlier_attempt_left_behind() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    let page_dir = inventory_page_dir(journal.path(), &captured.digest(), 0);
    let pages = captured.sealed();
    let set = set_of(&captured, Some(&journal.live), &pages);
    let op = WriteOperationId::generate().unwrap();
    // Attempt one promotes the page, cannot remove its staging link and fails the set directory sync.
    let mut first = ObservedFs::new();
    first.fail_remove = true;
    first.fail_sync_of = Some(page_dir.parent().unwrap().to_path_buf());
    let Err(JournalDurableError::Stage(left)) = promote_as(&mut first, journal.path(), &set, &op)
    else {
        panic!("the set directory sync must fail");
    };
    assert_eq!(
        (left.promoted, left.staging),
        (true, StagingResidue::Present)
    );
    // The retry under the same operation adopts the page and must still report that link.
    let mut retry = ObservedFs::new();
    retry.fail_sync_of = first.fail_sync_of.clone();
    let Err(JournalDurableError::Stage(again)) = promote_as(&mut retry, journal.path(), &set, &op)
    else {
        panic!("the set directory sync must fail again");
    };
    assert_eq!(retry.creates, 0);
    assert_eq!(
        (again.promoted, again.staging),
        (true, StagingResidue::Present)
    );
}

#[test]
fn a_different_file_at_a_page_generation_is_never_replaced() {
    let captured = Captured::new(2, 2);
    let journal = journal_of(&captured);
    let file = page_file(journal.path(), &captured.digest(), 0);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, b"not the envelope").unwrap();
    let result = store(&mut StdFs, &journal, &captured);
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a different file under the page generation must refuse the promotion");
    };
    assert!(matches!(stage.kind, StageFailureKind::GenerationExists));
    assert_eq!(std::fs::read(file).unwrap(), b"not the envelope");
}

/// A journal whose root names the successor of a first stored capture of four entries (two pages).
fn after_first_capture() -> (Journal, Captured) {
    let first = Captured::new(4, 2);
    let mut journal = journal_of(&first);
    store(&mut StdFs, &journal, &first).unwrap();
    journal.live = commit_into(journal.path(), &first.successor);
    (journal, first)
}

/// A recapture over `first`: page 0 unchanged (its envelope and older generation kept), page 1
/// rewritten at the new revision.
fn recapture(first: &Captured) -> Captured {
    let committed = first.successor.clone();
    let generation = committed.journal_revision + 1;
    let rewritten = JournalPage::new(1, generation, first.pages[1].entries().to_vec()).unwrap();
    let fresh = seal_inventory_pages(&key(), &committed, std::slice::from_ref(&rewritten)).unwrap();
    let pages = vec![first.pages[0].clone(), rewritten];
    let envelopes = vec![first.envelopes[0].clone(), fresh[0].clone()];
    Captured::from_sealed(committed, pages, envelopes)
}

#[test]
fn a_page_keeping_an_older_generation_is_refused_until_the_predecessor_set_can_be_verified() {
    // Even a page a genuinely stored predecessor holds is not inherited yet: the store has no
    // authenticated reference to prove the predecessor's set contains those bytes.
    let (journal, first) = after_first_capture();
    let second = recapture(&first);
    assert_eq!(
        refusal_in(&journal, &second),
        JournalDurableError::Journal(JournalError::GenerationMismatch)
    );
}

#[test]
fn sealed_pages_bind_their_identity_and_generation() {
    let pages = pages_of(4, 2, 4);
    let envelopes = seal_inventory_pages(&key(), &manifest_at(COMMITTED_REVISION), &pages).unwrap();
    for (page, envelope) in pages.iter().zip(&envelopes) {
        let identity = RecordIdentity::new(
            RecordClass::MigrationPage,
            &[OPERATION, &page.page_index().to_string()],
        )
        .unwrap();
        let opened = JournalPage::open(&key(), &identity, page.page_generation(), envelope);
        assert_eq!(opened.unwrap().entries().len(), page.entries().len());
    }
    // Page 0's bytes do not open as page 1, nor as another operation's page 0.
    let page_one = RecordIdentity::new(RecordClass::MigrationPage, &[OPERATION, "1"]).unwrap();
    let other = RecordIdentity::new(RecordClass::MigrationPage, &["other-op", "0"]).unwrap();
    assert!(JournalPage::open(&key(), &page_one, 4, &envelopes[0]).is_err());
    assert!(JournalPage::open(&key(), &other, 4, &envelopes[0]).is_err());
}

/// A committed manifest of a rotation from epoch 2 to 3, whose journal is sealed under epoch 2.
fn rotation_from_epoch_two() -> JournalManifest {
    let mut manifest = manifest_at(COMMITTED_REVISION);
    manifest.operation_type = operation_type::ROTATE;
    manifest.source_epoch = 2;
    manifest.target_epoch = 3;
    manifest
}

fn header_epoch(file: &Path) -> u64 {
    parse_envelope(&std::fs::read(file).unwrap())
        .unwrap()
        .header()
        .key_epoch
}

#[test]
fn an_operation_stores_its_pages_under_its_own_journal_epoch() {
    let captured = Captured::on(rotation_from_epoch_two(), 5, 2);
    let journal = journal_of(&captured);
    store(&mut StdFs, &journal, &captured).unwrap();
    assert_stored(journal.path(), &captured);
    let page = page_file(journal.path(), &captured.digest(), 0);
    assert_eq!(header_epoch(&page), 2);
    // The committed manifest of the same operation is sealed under that epoch too.
    let manifest = generation_path(journal.path(), COMMITTED_REVISION);
    assert_eq!(header_epoch(&manifest), 2);
}

#[test]
fn pages_sealed_for_another_epoch_than_the_operations_are_refused() {
    // The right key and identity, but the epoch of an ENABLE journal instead of this rotation's.
    let mut wrong = Captured::on(rotation_from_epoch_two(), 2, 2);
    wrong.envelopes[0] = sealed_at_epoch(&wrong, 1);
    let journal = journal_of(&wrong);
    let mut fs = ObservedFs::new();
    assert_eq!(
        store(&mut fs, &journal, &wrong).unwrap_err(),
        JournalDurableError::Journal(JournalError::KeyEpochMismatch)
    );
    assert!(fs.created_nothing());
}

#[test]
fn a_page_of_another_epoch_and_key_is_an_epoch_error_not_an_authentication_failure() {
    // Sealed under the key of another epoch: opening it with the journal key would fail
    // authentication, so the epoch has to be compared before the key is used.
    let mut wrong = Captured::on(rotation_from_epoch_two(), 2, 2);
    wrong.envelopes[0] = sealed_under(&wrong, &other_key(), 1);
    let journal = journal_of(&wrong);
    let mut fs = ObservedFs::new();
    assert_eq!(
        store(&mut fs, &journal, &wrong).unwrap_err(),
        JournalDurableError::Journal(JournalError::KeyEpochMismatch)
    );
    assert!(fs.created_nothing());
}

// ---- Streaming capture, stage one ----
//
// The streamed successor must be exactly what `capture_inventory` builds from the pages that were
// staged, the staged files are inert, and a staged page is trusted only after it is confirmed against
// its reference. Every test is a table of named cases with one assertion over all of them.

/// `count` ascending entries (six digits, so the order is the numeric one for any count).
fn entries(count: u32) -> Vec<JournalInventoryEntry> {
    (0..count).map(entry_n).collect()
}

fn entry_n(n: u32) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:06}")]).unwrap();
    let source = JournalInventorySource {
        authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
        physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
        generation: None,
        evidence_digest: Some([n as u8; 32]),
        foreign: None,
    };
    JournalInventoryEntry::new(record, source).unwrap()
}

/// A change to the committed manifest a scenario starts from.
type Change = fn(&mut JournalManifest);

/// A real journal whose root-named generation is `committed`.
struct Scenario {
    journal: Journal,
    committed: JournalManifest,
}

impl Scenario {
    fn new() -> Self {
        Self::with(|_| {})
    }

    /// The committed manifest after `change`, committed as the root-named generation.
    fn with(change: Change) -> Self {
        let mut committed = manifest_at(COMMITTED_REVISION);
        change(&mut committed);
        let dir = TempDir::new();
        let live = commit_into(&dir.0, &committed);
        Scenario {
            journal: Journal { dir, live },
            committed,
        }
    }

    fn fence(&self) -> MigrationFence {
        MigrationFence::from_manifest(&self.committed)
    }

    /// Starts a capture of `count` entries over `fs`.
    fn begin<F: DurableFs>(
        &self,
        fs: &mut F,
        count: u32,
    ) -> Result<StreamedCapture, JournalDurableError> {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut ctx = JournalDurableContext::new(fs, &key, self.journal.path(), &op);
        let live = &self.journal.live;
        StreamedCapture::begin(&mut ctx, &self.committed, &self.fence(), live, count)
    }

    /// Stages `entries` cut into pages of `per_page`.
    fn stream<F: DurableFs>(
        &self,
        fs: &mut F,
        entries: Vec<JournalInventoryEntry>,
        per_page: usize,
    ) -> Result<StagedCapture, JournalDurableError> {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut capture = self.begin(fs, entries.len() as u32)?;
        let mut ctx = JournalDurableContext::new(fs, &key, self.journal.path(), &op);
        for chunk in entries.chunks(per_page) {
            capture = capture.push_page(&mut ctx, chunk.to_vec())?;
        }
        capture.finish()
    }

    /// Staged page `index`, read back under `key`.
    fn read_under(
        &self,
        key: &Key,
        staged: &StagedCapture,
        index: u32,
    ) -> Result<StagedPage, JournalDurableError> {
        let op = WriteOperationId::generate().unwrap();
        let mut fs = StdFs;
        let mut ctx = JournalDurableContext::new(&mut fs, key, self.journal.path(), &op);
        load_staged_page(&mut ctx, staged, index)
    }

    fn read(&self, staged: &StagedCapture, index: u32) -> Result<StagedPage, JournalDurableError> {
        self.read_under(&key(), staged, index)
    }

    /// Every staged page, read back and confirmed.
    fn staged_pages(&self, staged: &StagedCapture) -> Vec<StagedPage> {
        (0..staged.page_refs().len() as u32)
            .map(|index| self.read(staged, index).unwrap())
            .collect()
    }

    /// What `capture_inventory` builds from the pages the stream staged.
    fn replayed(&self, staged: &StagedCapture) -> JournalManifest {
        let pages = self.staged_pages(staged);
        let sealed: Vec<_> = pages
            .iter()
            .map(|p| SealedPage {
                page: &p.page,
                envelope: &p.envelope,
            })
            .collect();
        capture_inventory(&self.committed, &self.fence(), &sealed).unwrap()
    }
}

/// Every file under `root`, as a path relative to it.
fn files_under(root: &Path) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for item in std::fs::read_dir(&dir).unwrap() {
            let path = item.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let relative = path.strip_prefix(root).unwrap();
                found.insert(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found
}

fn admit(manifest: &mut JournalManifest) {
    manifest.phase = phase_code::ADMIT;
}

fn already_final(manifest: &mut JournalManifest) {
    manifest.phase = phase_code::ADMIT;
    manifest.final_inventory_captured = true;
}

fn converting(manifest: &mut JournalManifest) {
    manifest.phase = phase_code::CONVERT;
    manifest.final_inventory_captured = true;
}

fn preparing(manifest: &mut JournalManifest) {
    manifest.phase = phase_code::PREPARE;
}

fn finished(manifest: &mut JournalManifest) {
    manifest.phase = phase_code::DONE;
    manifest.final_inventory_captured = true;
}

#[test]
fn the_streamed_successor_is_what_capture_inventory_builds_from_the_staged_pages() {
    let cases: [(&str, u32, usize, Change); 6] = [
        ("one entry", 1, 1, |_| {}),
        ("an uneven split", 7, 3, |_| {}),
        ("an even split", 8, 4, |_| {}),
        ("one page", 5, 5, |_| {}),
        ("the final capture in ADMIT", 5, 2, admit),
        ("a full page and one more", 4097, 4096, |_| {}),
    ];
    let wrong: Vec<_> = cases
        .into_iter()
        .filter_map(|(name, count, per_page, change)| {
            let scenario = Scenario::with(change);
            let staged = scenario
                .stream(&mut StdFs, entries(count), per_page)
                .unwrap();
            let same = *staged.successor() == scenario.replayed(&staged);
            let counted = staged.successor().entry_count == count;
            (!(same && counted)).then_some(name)
        })
        .collect();
    assert_eq!(wrong, Vec::<&str>::new());
}

#[test]
fn an_empty_inventory_stages_nothing_and_matches_the_empty_capture() {
    let scenario = Scenario::new();
    let before = files_under(scenario.journal.path());
    let staged = scenario.stream(&mut StdFs, Vec::new(), 1).unwrap();
    let empty = capture_inventory(&scenario.committed, &scenario.fence(), &[]).unwrap();
    assert_eq!(
        (
            *staged.successor() == empty,
            files_under(scenario.journal.path())
        ),
        (true, before)
    );
}

#[test]
fn staged_pages_are_inert_files_in_a_private_pending_directory() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let pending = staged
        .pending_dir()
        .strip_prefix(scenario.journal.path())
        .unwrap();
    let pending = pending.to_string_lossy().replace('\\', "/");
    let mut expected = BTreeSet::from(["generation-3.wsr1".to_owned()]);
    expected.extend((0..3).map(|i| format!("{pending}/page-{i}/generation-4.wsr1")));
    // The directory is named for what it is, never like a digest directory a reader would resolve.
    assert_eq!(
        (
            pending.starts_with("inventory/pending-4-"),
            files_under(scenario.journal.path())
        ),
        (true, expected)
    );
}

#[test]
fn two_attempts_under_one_operation_id_never_share_a_pending_directory() {
    let scenario = Scenario::new();
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    let fence = scenario.fence();
    let live = &scenario.journal.live;
    let mut attempt = || {
        StreamedCapture::begin(&mut ctx, &scenario.committed, &fence, live, 0)
            .unwrap()
            .finish()
            .unwrap()
    };
    let (first, second) = (attempt(), attempt());
    assert_ne!(first.pending_dir(), second.pending_dir());
}

#[test]
fn the_staged_pages_are_accepted_by_the_existing_store() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let pages = scenario.staged_pages(&staged);
    let sealed: Vec<_> = pages
        .iter()
        .map(|p| SealedPage {
            page: &p.page,
            envelope: &p.envelope,
        })
        .collect();
    let set = InventorySetWrite {
        committed_manifest: &scenario.committed,
        fence: &scenario.fence(),
        committed: Some(&scenario.journal.live),
        successor: staged.successor(),
        pages: &sealed,
    };
    assert!(promote(&mut StdFs, scenario.journal.path(), &set).is_ok());
}

#[test]
fn a_capture_that_cannot_start_creates_nothing() {
    let refused = JournalDurableError::Authority;
    let cases: [(&str, Change, u32, JournalDurableError); 5] = [
        (
            "a capture already final",
            already_final,
            1,
            refused(MigrationExecutionError::FrozenFieldChanged),
        ),
        (
            "conversion already started",
            converting,
            1,
            refused(MigrationExecutionError::FrozenFieldChanged),
        ),
        (
            "a phase without a snapshot",
            preparing,
            1,
            refused(MigrationExecutionError::InvalidPhaseTransition),
        ),
        (
            "a finished journal",
            finished,
            1,
            refused(MigrationExecutionError::TerminalPhase),
        ),
        (
            "a total above the bound",
            |_| {},
            MAX_JOURNAL_INVENTORY_ENTRIES + 1,
            JournalDurableError::Journal(JournalError::TooManyEntries),
        ),
    ];
    let wrong: Vec<_> = cases
        .into_iter()
        .filter_map(|(name, change, count, error)| {
            let scenario = Scenario::with(change);
            let mut fs = ObservedFs::new();
            let refusal = scenario.begin(&mut fs, count).err();
            (!(refusal == Some(error) && fs.created_nothing())).then_some(name)
        })
        .collect();
    assert_eq!(wrong, Vec::<&str>::new());
}

/// The refusal of a `begin` over `committed` against the binding `live`, which must create nothing.
fn begin_refusal(
    scenario: &Scenario,
    committed: &JournalManifest,
    live: &LiveMigration,
) -> (Option<JournalDurableError>, bool) {
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = ObservedFs::new();
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    let fence = MigrationFence::from_manifest(committed);
    let refusal = StreamedCapture::begin(&mut ctx, committed, &fence, live, 1).err();
    (refusal, fs.created_nothing())
}

#[test]
fn a_caller_that_is_not_the_committed_owner_of_the_root_named_manifest_is_refused() {
    let scenario = Scenario::new();
    let mut moved = scenario.journal.live.clone();
    moved.fencing_generation += 1;
    let mut other = scenario.committed.clone();
    other.has_lease_owner = true;
    other.lease_owner_id = Some("someone".into());
    other.lease_expires_unix_ms = Some(1);
    let authority = JournalDurableError::Authority;
    assert_eq!(
        [
            begin_refusal(&scenario, &scenario.committed, &moved),
            begin_refusal(&scenario, &other, &scenario.journal.live),
        ],
        [
            (
                Some(authority(MigrationExecutionError::StaleMigrationOwner)),
                true
            ),
            (
                Some(authority(MigrationExecutionError::LiveBindingMismatch)),
                true
            ),
        ]
    );
}

#[test]
fn entries_arrive_in_order_and_the_announced_total_is_enforced_at_both_ends() {
    let scenario = Scenario::new();
    let too_many = JournalDurableError::Journal(JournalError::TooManyEntries);
    let short = JournalDurableError::Journal(JournalError::EntryCountMismatch);
    let unordered = JournalDurableError::Journal(JournalError::NotStrictlyAscending);
    let empty_page = JournalDurableError::Journal(JournalError::InvalidDescriptorCount);
    let run = |count: u32, pages: Vec<Vec<JournalInventoryEntry>>| -> Option<JournalDurableError> {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut fs = StdFs;
        let mut capture = scenario.begin(&mut fs, count).unwrap();
        let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
        for page in pages {
            capture = match capture.push_page(&mut ctx, page) {
                Ok(next) => next,
                Err(error) => return Some(error),
            };
        }
        capture.finish().err()
    };
    let all = entries(6);
    let outcomes = [
        run(6, vec![all[3..6].to_vec(), all[0..3].to_vec()]),
        run(4, vec![all[0..5].to_vec()]),
        run(4, vec![all[0..3].to_vec()]),
        run(1, vec![Vec::new()]),
        run(6, vec![all[0..3].to_vec(), all[2..6].to_vec()]),
    ];
    assert_eq!(
        outcomes,
        [
            Some(unordered.clone()),
            Some(too_many),
            Some(short),
            Some(empty_page),
            Some(unordered)
        ]
    );
}

#[test]
fn a_failure_partway_leaves_only_inert_pending_files_and_a_new_attempt_is_independent() {
    let scenario = Scenario::new();
    let mut failing = ObservedFs::new();
    failing.fail_create_at = Some(3);
    let failed = scenario.stream(&mut failing, entries(7), 3);
    let residue = files_under(scenario.journal.path());
    let second = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let after = files_under(scenario.journal.path());
    let distinct = !second.pending_dir().starts_with(
        scenario
            .journal
            .path()
            .join("inventory")
            .join(residue_dir(&residue)),
    );
    assert_eq!(
        (failed.is_err(), residue.is_subset(&after), distinct),
        (true, true, true)
    );
}

/// The one pending directory name among `files`.
fn residue_dir(files: &BTreeSet<String>) -> String {
    let pending: BTreeSet<_> = files
        .iter()
        .filter_map(|file| file.strip_prefix("inventory/"))
        .filter_map(|rest| rest.split('/').next())
        .collect();
    assert_eq!(pending.len(), 1, "{pending:?}");
    pending.into_iter().next().unwrap().to_owned()
}

#[test]
fn a_staged_page_is_trusted_only_after_it_is_confirmed_against_its_reference() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let file = |index: u32| generation_path(&staged.pending_dir().join(format!("page-{index}")), 4);
    let mut flipped = std::fs::read(file(0)).unwrap();
    flipped[20] ^= 1;
    std::fs::write(file(0), flipped).unwrap();
    std::fs::write(file(1), std::fs::read(file(2)).unwrap()).unwrap();
    let outcomes = [
        scenario.read(&staged, 0).err(),
        scenario.read(&staged, 1).err(),
        scenario.read(&staged, 7).err(),
        scenario.read_under(&other_key(), &staged, 2).err(),
    ];
    let mismatch = JournalDurableError::Journal(JournalError::PageSetMismatch);
    assert_eq!(
        outcomes,
        [
            Some(mismatch.clone()),
            Some(mismatch),
            Some(JournalDurableError::Journal(JournalError::InvalidPageIndex)),
            Some(JournalDurableError::Journal(JournalError::Open(
                OpenError::Tampered
            ))),
        ]
    );
}
