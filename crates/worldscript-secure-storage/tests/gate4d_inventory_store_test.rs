//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    capture_inventory, content_digest, empty_inventory_digest, empty_journal_page_set_digest,
    inventory_page_dir, journal_page_set_digest, operation_type, page_ref_for, parse_envelope,
    phase_code, promote_inventory_set_fenced, seal_inventory_pages, source_authority_kind,
    source_physical_authority_kind, DirectoryDurability, DurableFs, InventorySetWrite,
    JournalDurableContext, JournalDurableError, JournalError, JournalInventoryEntry,
    JournalInventorySource, JournalManifest, JournalPage, LiveMigration, MigrationExecutionError,
    MigrationFence, RecordClass, RecordIdentity, RecordMeta, SealedPage, StageFailureKind,
    StageStep, StdFs, WriteOperationId,
};

const OPERATION: &str = "store-op";

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

fn binding_at(revision: u64) -> LiveMigration {
    LiveMigration {
        operation_id: OPERATION.into(),
        fencing_generation: 7,
        journal_revision: revision,
        manifest_digest: [0x22; 32],
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

/// A captured inventory over a committed manifest at revision 3, sealed once.
struct Captured {
    committed_manifest: JournalManifest,
    fence: MigrationFence,
    successor: JournalManifest,
    pages: Vec<JournalPage>,
    envelopes: Vec<Vec<u8>>,
}

impl Captured {
    fn new(count: u32, per_page: usize) -> Self {
        let committed_manifest = manifest_at(3);
        let pages = pages_of(count, per_page, 4);
        let envelopes = seal_inventory_pages(&key(), OPERATION, &pages).unwrap();
        let sealed = seal_all(&pages, &envelopes);
        let fence = MigrationFence::from_manifest(&committed_manifest);
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

/// The committed owner stores `captured` under `dir`.
fn store<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    captured: &Captured,
    committed: Option<&LiveMigration>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let pages = captured.sealed();
    promote(fs, dir, &set_of(captured, committed, &pages))
}

/// The committed owner (revision 3) stores `pages` instead of the captured ones.
fn store_pages<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    captured: &Captured,
    pages: &[SealedPage<'_>],
) -> Result<DirectoryDurability, JournalDurableError> {
    let committed = binding_at(3);
    promote(fs, dir, &set_of(captured, Some(&committed), pages))
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

fn page_file(dir: &Path, digest: &[u8; 32], index: u32) -> PathBuf {
    inventory_page_dir(dir, digest, index).join("generation-4.wsr1")
}

#[test]
fn a_captured_inventory_is_stored_under_the_directory_its_digest_names() {
    let dir = TempDir::new();
    let captured = Captured::new(5, 2);
    let committed = binding_at(3);
    let durability = store(&mut StdFs, &dir.0, &captured, Some(&committed)).unwrap();
    assert_eq!(durability, DirectoryDurability::Confirmed);
    assert_stored(&dir.0, &captured);
}

/// What is on disk is exactly the page set the capture bound.
fn assert_stored(dir: &Path, captured: &Captured) {
    let refs: Vec<_> = captured
        .pages
        .iter()
        .map(|page| {
            let file = page_file(dir, &captured.digest(), page.page_index());
            page_ref_for(page, &std::fs::read(file).unwrap()).unwrap()
        })
        .collect();
    captured.successor.verify_page_set(&refs).unwrap();
}

#[test]
fn the_directory_chain_up_to_the_journal_directory_is_synced() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let committed = binding_at(3);
    let mut fs = ObservedFs::new();
    store(&mut fs, &dir.0, &captured, Some(&committed)).unwrap();
    let page_dir = inventory_page_dir(&dir.0, &captured.digest(), 0);
    let set_dir = page_dir.parent().unwrap().to_path_buf();
    let inventory_dir = set_dir.parent().unwrap().to_path_buf();
    for synced in [&page_dir, &set_dir, &inventory_dir, &dir.0] {
        assert!(
            fs.synced.contains(synced),
            "{} was not synced",
            synced.display()
        );
    }
}

#[test]
fn a_directory_sync_failure_after_the_promotion_is_reported_as_promoted() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let committed = binding_at(3);
    let mut fs = ObservedFs::new();
    let page_dir = inventory_page_dir(&dir.0, &captured.digest(), 0);
    fs.fail_sync_of = Some(page_dir.parent().unwrap().to_path_buf());
    let result = store(&mut fs, &dir.0, &captured, Some(&committed));
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a failed parent sync must be reported");
    };
    assert_eq!(
        (stage.step, stage.promoted),
        (StageStep::SyncDirectory, true)
    );
    // The page is there: a retry meets the immutable generation, not an absent page.
    assert!(page_file(&dir.0, &captured.digest(), 0).is_file());
}

#[test]
fn a_store_that_the_authority_checks_refuse_creates_nothing() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let mut other_operation = binding_at(3);
    other_operation.operation_id = "other-op".into();
    let mut newer_fence = binding_at(3);
    newer_fence.fencing_generation = 8;
    let cases = [
        (
            "a later committed fence",
            Some(newer_fence),
            MigrationExecutionError::StaleMigrationOwner,
        ),
        (
            "another operation",
            Some(other_operation),
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
        let result = store(&mut fs, &dir.0, &captured, binding.as_ref());
        assert_eq!(
            result.unwrap_err(),
            JournalDurableError::Authority(error),
            "{name}"
        );
        assert!(fs.created_nothing(), "{name}");
    }
    assert!(!dir.0.join("inventory").exists());
}

#[test]
fn a_successor_that_is_not_valid_is_refused_before_any_write() {
    let dir = TempDir::new();
    let committed = binding_at(3);
    let mut captured = Captured::new(2, 2);
    captured.successor.phase = phase_code::ADMIT;
    let mut fs = ObservedFs::new();
    let result = store(&mut fs, &dir.0, &captured, Some(&committed));
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Authority(MigrationExecutionError::InvalidPhaseTransition)
    );
    assert!(fs.created_nothing());
}

#[test]
fn envelopes_of_another_capture_would_key_the_wrong_directory_and_are_refused() {
    let dir = TempDir::new();
    let captured = Captured::new(4, 2);
    // The same entries sealed again: valid pages, but not the bytes the successor's digest binds.
    let other = Captured::new(4, 2);
    let mut fs = ObservedFs::new();
    let result = store_pages(&mut fs, &dir.0, &captured, &other.sealed());
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Journal(JournalError::PageSetMismatch)
    );
    assert!(fs.created_nothing());
}

#[test]
fn an_envelope_that_is_not_the_page_it_is_stored_for_is_refused() {
    let dir = TempDir::new();
    let captured = Captured::new(4, 2);
    let swapped = [
        SealedPage {
            page: &captured.pages[0],
            envelope: &captured.envelopes[1],
        },
        SealedPage {
            page: &captured.pages[1],
            envelope: &captured.envelopes[0],
        },
    ];
    let mut fs = ObservedFs::new();
    let result = store_pages(&mut fs, &dir.0, &captured, &swapped);
    assert!(matches!(
        result,
        Err(JournalDurableError::Journal(JournalError::Open(_)))
    ));
    assert!(fs.created_nothing());
}

#[test]
fn a_page_generation_above_the_next_revision_is_refused() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let future = JournalPage::new(0, 5, captured.pages[0].entries().to_vec()).unwrap();
    let envelope = seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&future))
        .unwrap()
        .remove(0);
    let late = [SealedPage {
        page: &future,
        envelope: &envelope,
    }];
    let mut fs = ObservedFs::new();
    let result = store_pages(&mut fs, &dir.0, &captured, &late);
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Journal(JournalError::GenerationMismatch)
    );
    assert!(fs.created_nothing());
}

/// A hand-built successor naming a page set whose only page is index 1, which `capture_inventory`
/// refuses: the page-set digest and the inventory digest both verify, only the index is wrong.
fn index_one_inventory() -> Captured {
    let mut captured = Captured::new(2, 2);
    let page = JournalPage::new(1, 4, captured.pages[0].entries().to_vec()).unwrap();
    let envelopes = seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&page)).unwrap();
    let reference = page_ref_for(&page, &envelopes[0]).unwrap();
    captured.successor.journal_page_set_digest = journal_page_set_digest(&[reference]).unwrap();
    captured.pages = vec![page];
    captured.envelopes = envelopes;
    captured
}

#[test]
fn a_page_set_whose_indexes_are_not_zero_to_n_is_refused() {
    let dir = TempDir::new();
    let committed = binding_at(3);
    let captured = index_one_inventory();
    let mut fs = ObservedFs::new();
    let result = store(&mut fs, &dir.0, &captured, Some(&committed));
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Journal(JournalError::PageSetMismatch)
    );
    assert!(fs.created_nothing());
}

#[test]
fn a_successor_that_can_never_be_sealed_is_refused_before_any_write() {
    let dir = TempDir::new();
    let committed = binding_at(3);
    let mut captured = Captured::new(2, 2);
    // Only inventory fields differ, so the successor relation and the capture window accept it; the
    // manifest encoding bounds the entry count.
    captured.successor.entry_count = 1_000_001;
    let mut fs = ObservedFs::new();
    let result = store(&mut fs, &dir.0, &captured, Some(&committed));
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Journal(JournalError::TooManyEntries)
    );
    assert!(fs.created_nothing());
}

#[test]
fn an_envelope_sealed_for_another_key_epoch_is_refused_before_any_write() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let parsed = parse_envelope(&captured.envelopes[0]).unwrap();
    let meta = RecordMeta {
        key_epoch: parsed.header().key_epoch + 1,
        record_generation: parsed.header().record_generation,
        record_schema: parsed.header().record_schema,
    };
    let identity = RecordIdentity::new(RecordClass::MigrationPage, &[OPERATION, "0"]).unwrap();
    let envelope = captured.pages[0].seal(&key(), &identity, meta).unwrap();
    let other_epoch = [SealedPage {
        page: &captured.pages[0],
        envelope: &envelope,
    }];
    let mut fs = ObservedFs::new();
    let result = store_pages(&mut fs, &dir.0, &captured, &other_epoch);
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a foreign key epoch must be refused");
    };
    assert!(matches!(
        stage.kind,
        StageFailureKind::StagedEnvelopeMismatch
    ));
    assert!(!stage.promoted);
    assert!(fs.created_nothing());
}

#[test]
fn page_sets_with_different_digests_never_collide() {
    let dir = TempDir::new();
    let committed = binding_at(3);
    // Sealing uses a fresh nonce, so two attempts at the same inventory differ.
    let first = Captured::new(2, 2);
    let second = Captured::new(2, 2);
    assert_ne!(first.digest(), second.digest());
    for captured in [&first, &second] {
        store(&mut StdFs, &dir.0, captured, Some(&committed)).unwrap();
    }
    for captured in [&first, &second] {
        let file = page_file(&dir.0, &captured.digest(), 0);
        assert_eq!(
            content_digest(&std::fs::read(file).unwrap()),
            content_digest(&captured.envelopes[0])
        );
    }
}

#[test]
fn storing_the_same_set_again_adopts_the_identical_pages() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let committed = binding_at(3);
    store(&mut StdFs, &dir.0, &captured, Some(&committed)).unwrap();
    let mut fs = ObservedFs::new();
    let again = store(&mut fs, &dir.0, &captured, Some(&committed));
    assert_eq!(again.unwrap(), DirectoryDurability::Confirmed);
    // Nothing was staged, and the chain was synced again.
    assert_eq!(fs.creates, 0);
    assert!(fs
        .synced
        .contains(&inventory_page_dir(&dir.0, &captured.digest(), 0)));
    assert_stored(&dir.0, &captured);
}

#[test]
fn a_set_that_failed_partway_is_completed_by_a_retry() {
    let dir = TempDir::new();
    let captured = Captured::new(5, 2);
    let committed = binding_at(3);
    let mut broken = ObservedFs::new();
    broken.fail_create_at = Some(3);
    let first = store(&mut broken, &dir.0, &captured, Some(&committed));
    let Err(JournalDurableError::Stage(stage)) = first else {
        panic!("the third page's staging file cannot be created");
    };
    assert_eq!(
        (stage.step, stage.promoted),
        (StageStep::CreateStaging, false)
    );
    // Pages 0 and 1 are durable, page 2 is missing.
    assert!(page_file(&dir.0, &captured.digest(), 1).is_file());
    assert!(!page_file(&dir.0, &captured.digest(), 2).exists());
    let mut healthy = ObservedFs::new();
    let second = store(&mut healthy, &dir.0, &captured, Some(&committed));
    assert_eq!(second.unwrap(), DirectoryDurability::Confirmed);
    assert_eq!(healthy.creates, 1);
    assert_stored(&dir.0, &captured);
}

#[test]
fn a_different_file_at_a_page_generation_is_never_replaced() {
    let dir = TempDir::new();
    let captured = Captured::new(2, 2);
    let committed = binding_at(3);
    let file = page_file(&dir.0, &captured.digest(), 0);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, b"not the envelope").unwrap();
    let result = store(&mut StdFs, &dir.0, &captured, Some(&committed));
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a different file under the page generation must refuse the promotion");
    };
    assert!(matches!(stage.kind, StageFailureKind::GenerationExists));
    assert_eq!(std::fs::read(file).unwrap(), b"not the envelope");
}

/// A hand-built successor naming one empty page, which `capture_inventory` refuses: the counters
/// and both digests verify, only the canonical form of an empty inventory is violated.
fn empty_page_inventory() -> Captured {
    let mut captured = Captured::new(2, 2);
    let page = JournalPage::new(0, 4, Vec::new()).unwrap();
    let envelopes = seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&page)).unwrap();
    let reference = page_ref_for(&page, &envelopes[0]).unwrap();
    captured.successor.entry_count = 0;
    captured.successor.inventory_digest = empty_inventory_digest(1);
    captured.successor.journal_page_set_digest = journal_page_set_digest(&[reference]).unwrap();
    captured.pages = vec![page];
    captured.envelopes = envelopes;
    captured
}

#[test]
fn an_empty_page_is_refused_before_any_write() {
    let dir = TempDir::new();
    let committed = binding_at(3);
    let captured = empty_page_inventory();
    let mut fs = ObservedFs::new();
    let result = store(&mut fs, &dir.0, &captured, Some(&committed));
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Journal(JournalError::InvalidDescriptorCount)
    );
    assert!(fs.created_nothing());
}

#[test]
fn a_successor_outside_the_capture_window_is_refused_before_any_write() {
    type Tweak = fn(&mut Captured);
    let cases: [(&str, Tweak, MigrationExecutionError); 3] = [
        (
            "a bootstrap manifest has no inventory yet",
            |c| {
                c.committed_manifest.phase = phase_code::BOOTSTRAP_TARGET;
                c.successor.phase = phase_code::BOOTSTRAP_TARGET;
            },
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        (
            "a manifest whose cursor already advanced",
            |c| {
                c.committed_manifest.cursor_entry_index = 1;
                c.successor.cursor_entry_index = 1;
            },
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (
            "a capture that also changes the phase",
            |c| c.successor.phase = phase_code::PREPARE,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
    ];
    let committed = binding_at(3);
    for (name, tweak, error) in cases {
        let dir = TempDir::new();
        let mut captured = Captured::new(2, 2);
        tweak(&mut captured);
        let mut fs = ObservedFs::new();
        let result = store(&mut fs, &dir.0, &captured, Some(&committed));
        assert_eq!(
            result.unwrap_err(),
            JournalDurableError::Authority(error),
            "{name}"
        );
        assert!(fs.created_nothing(), "{name}");
    }
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
