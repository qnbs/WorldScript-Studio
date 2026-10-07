//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    capture_inventory, content_digest, empty_inventory_digest, empty_journal_page_set_digest,
    generation_path, inventory_page_dir, journal_page_set_digest, operation_type, page_ref_for,
    parse_envelope, phase_code, promote_inventory_set_fenced, promote_manifest_fenced,
    seal_inventory_pages, source_authority_kind, source_physical_authority_kind,
    DirectoryDurability, DurableFs, InventorySetWrite, JournalDurableContext, JournalDurableError,
    JournalError, JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage,
    LiveMigration, MigrationExecutionError, MigrationFence, RecordClass, RecordIdentity,
    RecordMeta, SealedPage, StageFailureKind, StageStep, StdFs, WriteOperationId,
};

const OPERATION: &str = "store-op";
const COMMITTED_REVISION: u64 = 3;

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "wss-gate4d-store-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A real file system that counts what a refused store must never do, logs directory syncs and can
/// fail the sync of one directory or the n-th file creation.
struct ObservedFs {
    inner: StdFs,
    creates: u32,
    dirs_created: u32,
    synced: Vec<PathBuf>,
    fail_sync_of: Option<PathBuf>,
    fail_create_at: Option<u32>,
}

impl ObservedFs {
    fn new() -> Self {
        Self {
            inner: StdFs,
            creates: 0,
            dirs_created: 0,
            synced: Vec::new(),
            fail_sync_of: None,
            fail_create_at: None,
        }
    }

    fn created_nothing(&self) -> bool {
        (self.creates, self.dirs_created) == (0, 0)
    }
}

impl DurableFs for ObservedFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.creates += 1;
        if self.fail_create_at == Some(self.creates) {
            return Err(io::Error::other("injected file creation failure"));
        }
        self.inner.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        self.inner.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        self.inner.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        self.inner.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        self.synced.push(dir.to_path_buf());
        if self.fail_sync_of.as_deref() == Some(dir) {
            return Err(io::Error::other("injected directory sync failure"));
        }
        self.inner.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        self.inner.list_dir(dir)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        self.inner.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        self.dirs_created += 1;
        self.inner.create_dir_all(dir)
    }
}

fn key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

fn manifest_at(revision: u64) -> JournalManifest {
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: revision,
        operation_type: operation_type::ROTATE,
        phase: phase_code::DISCOVER,
        source_epoch: 1,
        target_epoch: 2,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 7,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 0,
        entry_count: 0,
        journal_page_set_digest: empty_journal_page_set_digest(),
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
}

fn entry(n: u32) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:03}")]).unwrap();
    JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
            physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
            generation: None,
            evidence_digest: Some([n as u8; 32]),
            foreign: None,
        },
    )
    .unwrap()
}

/// `count` entries cut into ascending pages of `per_page`, every page at `generation`.
fn pages_of(count: u32, per_page: usize, generation: u64) -> Vec<JournalPage> {
    let all: Vec<JournalInventoryEntry> = (0..count).map(entry).collect();
    let sorted = JournalPage::new(0, 1, all).unwrap().entries().to_vec();
    sorted
        .chunks(per_page)
        .enumerate()
        .map(|(index, chunk)| JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap())
        .collect()
}

/// A captured inventory over the committed manifest, sealed once.
struct Captured {
    committed_manifest: JournalManifest,
    fence: MigrationFence,
    successor: JournalManifest,
    pages: Vec<JournalPage>,
    envelopes: Vec<Vec<u8>>,
}

impl Captured {
    fn new(count: u32, per_page: usize) -> Self {
        Self::on(manifest_at(COMMITTED_REVISION), count, per_page)
    }

    /// Pages at the next revision's generation, captured over `committed_manifest`.
    fn on(committed_manifest: JournalManifest, count: u32, per_page: usize) -> Self {
        let generation = committed_manifest.journal_revision + 1;
        Self::on_pages(committed_manifest, pages_of(count, per_page, generation))
    }

    /// `pages` sealed once and captured over `committed_manifest`.
    fn on_pages(committed_manifest: JournalManifest, pages: Vec<JournalPage>) -> Self {
        let envelopes = seal_inventory_pages(&key(), OPERATION, &pages).unwrap();
        Self::from_sealed(committed_manifest, pages, envelopes)
    }

    /// Already sealed pages captured over `committed_manifest`.
    fn from_sealed(
        committed_manifest: JournalManifest,
        pages: Vec<JournalPage>,
        envelopes: Vec<Vec<u8>>,
    ) -> Self {
        let fence = MigrationFence::from_manifest(&committed_manifest);
        let sealed = seal_all(&pages, &envelopes);
        let successor = capture_inventory(&committed_manifest, &fence, &sealed).unwrap();
        Captured {
            committed_manifest,
            fence,
            successor,
            pages,
            envelopes,
        }
    }

    fn digest(&self) -> [u8; 32] {
        self.successor.journal_page_set_digest
    }

    fn sealed(&self) -> Vec<SealedPage<'_>> {
        seal_all(&self.pages, &self.envelopes)
    }
}

fn seal_all<'a>(pages: &'a [JournalPage], envelopes: &'a [Vec<u8>]) -> Vec<SealedPage<'a>> {
    pages
        .iter()
        .zip(envelopes)
        .map(|(page, envelope)| SealedPage { page, envelope })
        .collect()
}

/// A journal directory whose root-named generation is a committed manifest.
struct Journal {
    dir: TempDir,
    live: LiveMigration,
}

impl Journal {
    fn path(&self) -> &Path {
        &self.dir.0
    }
}

/// Commits `captured`'s committed manifest to a fresh directory and returns the binding naming it.
fn journal_of(captured: &Captured) -> Journal {
    let dir = TempDir::new();
    let live = commit_into(&dir.0, &captured.committed_manifest);
    Journal { dir, live }
}

/// Commits `manifest` as the root-named generation of `dir`; returns the binding that names it.
fn commit_into(dir: &Path, manifest: &JournalManifest) -> LiveMigration {
    let previous = LiveMigration {
        operation_id: manifest.operation_id.clone(),
        fencing_generation: manifest.fencing_generation,
        journal_revision: manifest.journal_revision - 1,
        manifest_digest: [0x11; 32],
    };
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, dir, &op);
    let fence = MigrationFence::from_manifest(manifest);
    promote_manifest_fenced(&mut ctx, manifest, &fence, Some(&previous)).unwrap();
    let bytes = std::fs::read(generation_path(dir, manifest.journal_revision)).unwrap();
    LiveMigration {
        manifest_digest: content_digest(&bytes),
        journal_revision: manifest.journal_revision,
        ..previous
    }
}

/// The committed owner stores `captured` into `journal`.
fn store<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    captured: &Captured,
) -> Result<DirectoryDurability, JournalDurableError> {
    store_as(fs, journal, captured, Some(&journal.live))
}

/// The same, presenting `committed` as the root's binding.
fn store_as<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    captured: &Captured,
    committed: Option<&LiveMigration>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let pages = captured.sealed();
    promote(fs, journal.path(), &set_of(captured, committed, &pages))
}

fn set_of<'a>(
    captured: &'a Captured,
    committed: Option<&'a LiveMigration>,
    pages: &'a [SealedPage<'a>],
) -> InventorySetWrite<'a> {
    InventorySetWrite {
        committed_manifest: &captured.committed_manifest,
        fence: &captured.fence,
        committed,
        successor: &captured.successor,
        pages,
    }
}

fn promote<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    set: &InventorySetWrite<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, dir, &op);
    promote_inventory_set_fenced(&mut ctx, set)
}

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

fn page_file(dir: &Path, digest: &[u8; 32], index: u32) -> PathBuf {
    inventory_page_dir(dir, digest, index).join("generation-4.wsr1")
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

/// Replaces the captured pages by `page`, sealed; the successor is left as it was.
fn reseal(captured: &mut Captured, page: JournalPage) {
    captured.envelopes =
        seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&page)).unwrap();
    captured.pages = vec![page];
}

/// Binds the successor's page-set digest to the pages as they are now, as a hand-built manifest
/// would.
fn rebind(captured: &mut Captured) {
    let refs: Vec<_> = captured
        .pages
        .iter()
        .zip(&captured.envelopes)
        .map(|(page, envelope)| page_ref_for(page, envelope).unwrap())
        .collect();
    captured.successor.journal_page_set_digest = journal_page_set_digest(&refs).unwrap();
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

/// Page 0's envelope sealed for `epoch`.
fn sealed_at_epoch(captured: &Captured, epoch: u64) -> Vec<u8> {
    let parsed = parse_envelope(&captured.envelopes[0]).unwrap();
    let meta = RecordMeta {
        key_epoch: epoch,
        record_generation: parsed.header().record_generation,
        record_schema: parsed.header().record_schema,
    };
    let identity = RecordIdentity::new(RecordClass::MigrationPage, &[OPERATION, "0"]).unwrap();
    captured.pages[0].seal(&key(), &identity, meta).unwrap()
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
    let JournalDurableError::Stage(stage) = error else {
        panic!("a foreign key epoch must be refused as a staged-envelope mismatch");
    };
    assert!(matches!(
        stage.kind,
        StageFailureKind::StagedEnvelopeMismatch
    ));
    assert!(!stage.promoted);
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
    let fresh = seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&rewritten)).unwrap();
    let pages = vec![first.pages[0].clone(), rewritten];
    let envelopes = vec![first.envelopes[0].clone(), fresh[0].clone()];
    Captured::from_sealed(committed, pages, envelopes)
}

#[test]
fn an_unchanged_page_keeps_the_generation_the_predecessor_named() {
    let (journal, first) = after_first_capture();
    let second = recapture(&first);
    store(&mut StdFs, &journal, &second).unwrap();
    assert_stored(journal.path(), &second);
}

#[test]
fn a_page_claiming_an_older_generation_the_predecessor_never_named_is_refused() {
    let mismatch = JournalDurableError::Journal(JournalError::GenerationMismatch);
    // The predecessor stored no pages at all.
    let early = Captured::on_pages(manifest_at(COMMITTED_REVISION), pages_of(2, 2, 3));
    assert_eq!(refusal_in(&journal_of(&early), &early), mismatch);
    // The predecessor's page 0 holds other bytes than the ones claimed as unchanged.
    let (journal, first) = after_first_capture();
    let mut forged = recapture(&first);
    forged.envelopes[0] = seal_inventory_pages(&key(), OPERATION, &forged.pages[..1])
        .unwrap()
        .remove(0);
    rebind(&mut forged);
    assert_eq!(refusal_in(&journal, &forged), mismatch);
}

#[test]
fn sealed_pages_bind_their_identity_and_generation() {
    let pages = pages_of(4, 2, 4);
    let envelopes = seal_inventory_pages(&key(), OPERATION, &pages).unwrap();
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
