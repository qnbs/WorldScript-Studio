//! Gate 4D streaming capture, stage one: an inventory built and staged one page at a time (§10.1.1,
//! §10.3). The streamed successor must be exactly what `capture_inventory` builds from the pages that
//! were staged, the staged files are inert, and a staged page is trusted only after it is confirmed
//! against its reference. Every test is a table of named cases with one assertion over all of them.

#[path = "support/journal_fixture.rs"]
mod journal_fixture;

use std::collections::BTreeSet;
use std::path::Path;

use journal_fixture::*;
use worldscript_secure_storage::*;

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
        let start = CaptureStart {
            committed_manifest: &self.committed,
            fence: &self.fence(),
            live: &self.journal.live,
            entry_count: count,
        };
        StreamedCapture::begin(&mut ctx, &start)
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
        capture.finish(&mut ctx)
    }

    /// Abandons a finished capture.
    fn discard(&self, staged: StagedCapture) {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut fs = ObservedFs::new();
        let mut ctx = JournalDurableContext::new(&mut fs, &key, self.journal.path(), &op);
        staged.discard(&mut ctx);
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
    let start = CaptureStart {
        committed_manifest: &scenario.committed,
        fence: &scenario.fence(),
        live: &scenario.journal.live,
        entry_count: 0,
    };
    let mut attempt = || {
        let capture = StreamedCapture::begin(&mut ctx, &start).unwrap();
        capture.finish(&mut ctx).unwrap()
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
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    assert!(promote_inventory_set_fenced(&mut ctx, &set).is_ok());
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
    let start = CaptureStart {
        committed_manifest: committed,
        fence: &MigrationFence::from_manifest(committed),
        live,
        entry_count: 1,
    };
    let refusal = StreamedCapture::begin(&mut ctx, &start).err();
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
        capture.finish(&mut ctx).err()
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
fn a_failure_partway_removes_the_pages_it_staged_and_a_new_attempt_is_independent() {
    let scenario = Scenario::new();
    let committed_only = files_under(scenario.journal.path());
    let mut failing = ObservedFs::new();
    failing.fail_create_at = Some(3);
    let failed = scenario.stream(&mut failing, entries(7), 3);
    let after_failure = files_under(scenario.journal.path());
    let second = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    assert_eq!(
        (failed.is_err(), after_failure, second.page_refs().len()),
        (true, committed_only, 3)
    );
}

/// The pages a handled failure of any kind takes with it: the capture that ends short of its total
/// and the finished capture that is discarded, each followed by the files left on disk.
#[test]
fn an_abandoned_capture_removes_its_staged_pages() {
    let scenario = Scenario::new();
    let committed_only = files_under(scenario.journal.path());
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = StdFs;
    let capture = scenario.begin(&mut fs, 4).unwrap();
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    let capture = capture.push_page(&mut ctx, entries(3)).unwrap();
    let staged_then_short = (
        files_under(scenario.journal.path()).len(),
        capture.finish(&mut ctx).err(),
    );
    let short = JournalDurableError::Journal(JournalError::EntryCountMismatch);
    let after_short = files_under(scenario.journal.path());
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let staged_files = files_under(scenario.journal.path()).len();
    scenario.discard(staged);
    assert_eq!(
        (
            staged_then_short,
            after_short,
            staged_files,
            files_under(scenario.journal.path())
        ),
        ((2, Some(short)), committed_only.clone(), 4, committed_only)
    );
}

#[test]
fn a_cleanup_that_cannot_remove_a_file_leaves_inert_residue_and_does_not_fail() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = ObservedFs::new();
    fs.fail_remove = true;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    staged.discard(&mut ctx);
    assert_eq!(files_under(scenario.journal.path()).len(), 4);
}

/// A push under `key` in `dir`, over a capture that began in `scenario`'s journal.
fn push_under(scenario: &Scenario, key: &Key, dir: &Path) -> Option<JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let mut fs = StdFs;
    let capture = scenario.begin(&mut fs, 3).unwrap();
    let mut ctx = JournalDurableContext::new(&mut fs, key, dir, &op);
    capture.push_page(&mut ctx, entries(3)).err()
}

#[test]
fn a_push_under_another_key_or_another_journal_is_refused_before_anything_is_staged() {
    let scenario = Scenario::new();
    // A directory that holds a byte-identical copy of the root-named generation: the manifest check
    // alone would accept it, so only the capture's own binding to its journal refuses it.
    let copy = TempDir::new();
    let generation = generation_path(scenario.journal.path(), COMMITTED_REVISION);
    std::fs::copy(&generation, generation_path(&copy.0, COMMITTED_REVISION)).unwrap();
    let committed_only = files_under(scenario.journal.path());
    let outcomes = [
        push_under(&scenario, &other_key(), scenario.journal.path()),
        push_under(&scenario, &key(), &copy.0),
    ];
    assert_eq!(
        (
            outcomes,
            files_under(scenario.journal.path()),
            files_under(&copy.0)
        ),
        (
            [
                Some(JournalDurableError::Journal(JournalError::Open(
                    OpenError::Tampered
                ))),
                Some(JournalDurableError::Authority(
                    MigrationExecutionError::LiveBindingMismatch
                )),
            ],
            committed_only.clone(),
            committed_only
        )
    );
}

#[test]
fn a_failure_after_a_page_was_promoted_removes_that_page_too() {
    let scenario = Scenario::new();
    let committed_only = files_under(scenario.journal.path());
    let mut failing = ObservedFs::new();
    failing.fail_sync_matching = Some("page-1");
    let failed = scenario.stream(&mut failing, entries(7), 3);
    assert_eq!(
        (
            matches!(failed, Err(JournalDurableError::Stage(_))),
            files_under(scenario.journal.path())
        ),
        (true, committed_only)
    );
}

#[test]
fn pushing_a_page_does_not_read_the_root_named_manifest_again() {
    let scenario = Scenario::new();
    let mut fs = ObservedFs::new();
    scenario.stream(&mut fs, entries(12), 3).unwrap();
    let generation = generation_path(scenario.journal.path(), COMMITTED_REVISION);
    // Four pages were pushed; the key check of each is made over the bytes `begin` kept.
    assert_eq!(
        fs.reads.iter().filter(|path| **path == generation).count(),
        1
    );
}

#[test]
fn a_failure_never_removes_a_file_it_did_not_write() {
    let scenario = Scenario::new();
    let (key, op) = (key(), WriteOperationId::generate().unwrap());
    let mut fs = StdFs;
    let capture = scenario.begin(&mut fs, 6).unwrap();
    let mut ctx = JournalDurableContext::new(&mut fs, &key, scenario.journal.path(), &op);
    let all = entries(6);
    let capture = capture.push_page(&mut ctx, all[0..3].to_vec()).unwrap();
    let pending = capture.pending_dir().to_path_buf();
    // A different file already sits in the slot of the next page: the push fails because of it.
    let slot = generation_path(&pending.join("page-1"), 4);
    std::fs::create_dir_all(slot.parent().unwrap()).unwrap();
    std::fs::write(&slot, b"bytes of someone else").unwrap();
    let failed = capture.push_page(&mut ctx, all[3..6].to_vec()).err();
    let first = generation_path(&pending.join("page-0"), 4);
    // Nothing of the failed attempt is left but the file it did not write: no page, and not the
    // staging link a failed promotion reports either.
    assert_eq!(
        (
            matches!(failed, Some(JournalDurableError::Stage(_))),
            std::fs::read(&slot).unwrap(),
            first.exists(),
            files_under(&pending),
        ),
        (
            true,
            b"bytes of someone else".to_vec(),
            false,
            BTreeSet::from(["page-1/generation-4.wsr1".to_owned()])
        )
    );
}

#[test]
fn a_cleanup_never_removes_a_staged_page_that_was_replaced() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let replaced = generation_path(&staged.pending_dir().join("page-1"), 4);
    std::fs::write(&replaced, b"a file that is not the staged page").unwrap();
    scenario.discard(staged);
    let committed = "generation-3.wsr1".to_owned();
    let remaining: Vec<_> = files_under(scenario.journal.path()).into_iter().collect();
    assert_eq!(
        (
            remaining.len(),
            remaining.contains(&committed),
            std::fs::read(&replaced).unwrap()
        ),
        (2, true, b"a file that is not the staged page".to_vec())
    );
}

#[test]
fn a_staging_link_left_after_a_successful_promotion_is_found_by_the_cleanup() {
    let scenario = Scenario::new();
    let committed_only = files_under(scenario.journal.path());
    // Promotion succeeds, but the staging link cannot be unlinked: the page is staged, the link stays.
    let mut failing = ObservedFs::new();
    failing.fail_remove = true;
    let staged = scenario.stream(&mut failing, entries(7), 3).unwrap();
    let with_links = files_under(scenario.journal.path()).len();
    scenario.discard(staged);
    assert_eq!(
        (with_links, files_under(scenario.journal.path())),
        (1 + 3 * 2, committed_only)
    );
}

#[test]
fn a_missing_staged_page_is_a_broken_attempt_not_a_recovery_state_of_the_journal() {
    let scenario = Scenario::new();
    let staged = scenario.stream(&mut StdFs, entries(7), 3).unwrap();
    let file = generation_path(&staged.pending_dir().join("page-1"), 4);
    std::fs::remove_file(file).unwrap();
    assert_eq!(
        scenario.read(&staged, 1).err(),
        Some(JournalDurableError::Journal(JournalError::Corrupt(
            "staged page is missing"
        )))
    );
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
