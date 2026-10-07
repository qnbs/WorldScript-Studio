//! Gate 4D Slice C1b-1: where the pages of a captured inventory live, and writing them (§10.1.1).

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    capture_inventory, content_digest, empty_inventory_digest, empty_journal_page_set_digest,
    inventory_page_dir, operation_type, page_ref_for, phase_code, promote_inventory_page_fenced,
    seal_inventory_pages, source_authority_kind, source_physical_authority_kind,
    DirectoryDurability, DurableFs, InventoryPageWrite, JournalDurableContext, JournalDurableError,
    JournalError, JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage,
    LiveMigration, MigrationExecutionError, MigrationFence, RecordClass, RecordIdentity,
    SealedPage, StageFailureKind, StdFs, WriteOperationId,
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

/// A real file system that counts what a refused write must never do, and logs directory syncs.
struct ObservedFs {
    inner: StdFs,
    creates: u32,
    dirs_created: u32,
    synced: Vec<PathBuf>,
}

impl ObservedFs {
    fn new() -> Self {
        Self {
            inner: StdFs,
            creates: 0,
            dirs_created: 0,
            synced: Vec::new(),
        }
    }
}

impl DurableFs for ObservedFs {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        self.creates += 1;
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

fn committed_at(revision: u64) -> LiveMigration {
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
fn pages(count: u32, per_page: usize, generation: u64) -> Vec<JournalPage> {
    let all: Vec<JournalInventoryEntry> = (0..count).map(entry).collect();
    let sorted = JournalPage::new(0, 1, all).unwrap().entries().to_vec();
    sorted
        .chunks(per_page)
        .enumerate()
        .map(|(index, chunk)| JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap())
        .collect()
}

/// The captured successor of `manifest` over `pages` sealed once, and the sealed bytes.
fn captured(manifest: &JournalManifest, pages: &[JournalPage]) -> (JournalManifest, Vec<Vec<u8>>) {
    let envelopes = seal_inventory_pages(&key(), OPERATION, pages).unwrap();
    let sealed: Vec<SealedPage<'_>> = pages
        .iter()
        .zip(&envelopes)
        .map(|(page, envelope)| SealedPage { page, envelope })
        .collect();
    let next =
        capture_inventory(manifest, &MigrationFence::from_manifest(manifest), &sealed).unwrap();
    (next, envelopes)
}

/// One write the authority checks must refuse before anything is created.
struct Refusal<'a> {
    name: &'a str,
    binding: &'a LiveMigration,
    fence: MigrationFence,
    page: &'a JournalPage,
    envelope: &'a [u8],
    error: JournalDurableError,
}

struct Written<'a> {
    committed: Option<&'a LiveMigration>,
    fence: MigrationFence,
}

fn write_page<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    manifest: &JournalManifest,
    page: &JournalPage,
    envelope: &[u8],
    set_digest: [u8; 32],
    written: &Written<'_>,
) -> Result<worldscript_secure_storage::PromotedGeneration, JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, dir, &op);
    promote_inventory_page_fenced(
        &mut ctx,
        &InventoryPageWrite {
            manifest,
            fence: &written.fence,
            committed: written.committed,
            page,
            envelope,
            page_set_digest: set_digest,
        },
    )
}

#[test]
fn pages_are_promoted_into_the_directory_their_set_digest_names() {
    let dir = TempDir::new();
    let committed = committed_at(3);
    let prev = manifest_at(3);
    let pages = pages(5, 2, 4);
    let (next, envelopes) = captured(&prev, &pages);
    let written = Written {
        committed: Some(&committed),
        fence: MigrationFence::from_manifest(&prev),
    };
    let mut fs = StdFs;
    let refs: Vec<_> = pages
        .iter()
        .zip(&envelopes)
        .map(|(page, envelope)| {
            write_page(
                &mut fs,
                &dir.0,
                &prev,
                page,
                envelope,
                next.journal_page_set_digest,
                &written,
            )
            .unwrap();
            let file = inventory_page_dir(&dir.0, &next.journal_page_set_digest, page.page_index())
                .join("generation-4.wsr1");
            page_ref_for(page, &std::fs::read(file).unwrap()).unwrap()
        })
        .collect();
    // What is on disk is exactly what the capture bound.
    next.verify_page_set(&refs).unwrap();
}

#[test]
fn the_directory_chain_up_to_the_journal_directory_is_synced() {
    let dir = TempDir::new();
    let committed = committed_at(3);
    let prev = manifest_at(3);
    let pages = pages(2, 2, 4);
    let (next, envelopes) = captured(&prev, &pages);
    let written = Written {
        committed: Some(&committed),
        fence: MigrationFence::from_manifest(&prev),
    };
    let mut fs = ObservedFs::new();
    write_page(
        &mut fs,
        &dir.0,
        &prev,
        &pages[0],
        &envelopes[0],
        next.journal_page_set_digest,
        &written,
    )
    .unwrap();
    let page_dir = inventory_page_dir(&dir.0, &next.journal_page_set_digest, 0);
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
fn a_refused_write_creates_nothing() {
    let dir = TempDir::new();
    let committed = committed_at(3);
    let prev = manifest_at(3);
    let pages = pages(2, 2, 4);
    let (next, envelopes) = captured(&prev, &pages);
    let digest = next.journal_page_set_digest;
    let mut other_operation = committed_at(3);
    other_operation.operation_id = "other-op".into();
    let mut newer_fence = committed_at(3);
    newer_fence.fencing_generation = 8;
    let future = JournalPage::new(0, 5, pages[0].entries().to_vec()).unwrap();
    let future_envelope = seal_inventory_pages(&key(), OPERATION, std::slice::from_ref(&future))
        .unwrap()
        .remove(0);
    let own_fence = MigrationFence::from_manifest(&prev);
    let cases = vec![
        Refusal {
            name: "a later committed fence",
            binding: &newer_fence,
            fence: own_fence,
            page: &pages[0],
            envelope: &envelopes[0],
            error: JournalDurableError::Authority(MigrationExecutionError::StaleMigrationOwner),
        },
        Refusal {
            name: "another operation",
            binding: &other_operation,
            fence: own_fence,
            page: &pages[0],
            envelope: &envelopes[0],
            error: JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch),
        },
        Refusal {
            name: "a fence token that is not the manifest's",
            binding: &committed,
            fence: MigrationFence {
                fencing_generation: 6,
                journal_revision: 3,
            },
            page: &pages[0],
            envelope: &envelopes[0],
            error: JournalDurableError::Fence(MigrationExecutionError::StaleMigrationOwner),
        },
        Refusal {
            name: "a generation above the next revision",
            binding: &committed,
            fence: own_fence,
            page: &future,
            envelope: &future_envelope,
            error: JournalDurableError::Journal(JournalError::GenerationMismatch),
        },
    ];
    for case in cases {
        let mut fs = ObservedFs::new();
        let written = Written {
            committed: Some(case.binding),
            fence: case.fence,
        };
        let result = write_page(
            &mut fs,
            &dir.0,
            &prev,
            case.page,
            case.envelope,
            digest,
            &written,
        );
        assert_eq!(result.unwrap_err(), case.error, "{}", case.name);
        assert_eq!((fs.creates, fs.dirs_created), (0, 0), "{}", case.name);
    }
    assert!(!dir.0.join("inventory").exists());
}

#[test]
fn a_journal_without_a_committed_binding_admits_no_inventory_page() {
    let dir = TempDir::new();
    let prev = manifest_at(3);
    let pages = pages(2, 2, 4);
    let (next, envelopes) = captured(&prev, &pages);
    let written = Written {
        committed: None,
        fence: MigrationFence::from_manifest(&prev),
    };
    let mut fs = ObservedFs::new();
    let result = write_page(
        &mut fs,
        &dir.0,
        &prev,
        &pages[0],
        &envelopes[0],
        next.journal_page_set_digest,
        &written,
    );
    assert_eq!(
        result.unwrap_err(),
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
    assert_eq!((fs.creates, fs.dirs_created), (0, 0));
}

#[test]
fn page_sets_with_different_digests_never_collide() {
    let dir = TempDir::new();
    let committed = committed_at(3);
    let prev = manifest_at(3);
    let pages = pages(2, 2, 4);
    let written = Written {
        committed: Some(&committed),
        fence: MigrationFence::from_manifest(&prev),
    };
    // Sealing uses a fresh nonce, so two attempts at the same inventory differ.
    let (first, first_bytes) = captured(&prev, &pages);
    let (second, second_bytes) = captured(&prev, &pages);
    assert_ne!(
        first.journal_page_set_digest,
        second.journal_page_set_digest
    );
    let mut fs = StdFs;
    for (next, bytes) in [(&first, &first_bytes), (&second, &second_bytes)] {
        write_page(
            &mut fs,
            &dir.0,
            &prev,
            &pages[0],
            &bytes[0],
            next.journal_page_set_digest,
            &written,
        )
        .unwrap();
    }
    for (next, bytes) in [(&first, &first_bytes), (&second, &second_bytes)] {
        let file =
            inventory_page_dir(&dir.0, &next.journal_page_set_digest, 0).join("generation-4.wsr1");
        assert_eq!(
            content_digest(&std::fs::read(file).unwrap()),
            content_digest(&bytes[0])
        );
    }
}

#[test]
fn a_promoted_page_generation_is_never_replaced() {
    let dir = TempDir::new();
    let committed = committed_at(3);
    let prev = manifest_at(3);
    let pages = pages(2, 2, 4);
    let (next, envelopes) = captured(&prev, &pages);
    let written = Written {
        committed: Some(&committed),
        fence: MigrationFence::from_manifest(&prev),
    };
    let mut fs = StdFs;
    let digest = next.journal_page_set_digest;
    write_page(
        &mut fs,
        &dir.0,
        &prev,
        &pages[0],
        &envelopes[0],
        digest,
        &written,
    )
    .unwrap();
    let again = seal_inventory_pages(&key(), OPERATION, &pages[..1])
        .unwrap()
        .remove(0);
    let result = write_page(&mut fs, &dir.0, &prev, &pages[0], &again, digest, &written);
    let Err(JournalDurableError::Stage(stage)) = result else {
        panic!("a second promotion of the same generation must fail");
    };
    assert!(matches!(stage.kind, StageFailureKind::GenerationExists));
    let file = inventory_page_dir(&dir.0, &digest, 0).join("generation-4.wsr1");
    assert_eq!(std::fs::read(file).unwrap(), envelopes[0]);
}

#[test]
fn sealed_pages_bind_their_identity_and_generation() {
    let pages = pages(4, 2, 4);
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
