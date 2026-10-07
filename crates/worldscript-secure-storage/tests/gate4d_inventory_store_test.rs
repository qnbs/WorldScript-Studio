//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).

#[path = "support/inventory.rs"]
mod support;

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
