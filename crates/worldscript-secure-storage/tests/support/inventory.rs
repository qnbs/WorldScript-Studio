//! Shared Gate 4D inventory fixtures: a real committed journal, a captured and sealed inventory, a
//! file system that observes what a store creates, and the fenced store drivers.

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
    JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage, Key,
    LiveMigration, MigrationFence, RecordClass, RecordIdentity, RecordMeta, SealedPage, StdFs,
    WriteOperationId,
};

pub const OPERATION: &str = "store-op";
pub const COMMITTED_REVISION: u64 = 3;

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new() -> Self {
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
pub struct ObservedFs {
    pub inner: StdFs,
    pub creates: u32,
    pub dirs_created: u32,
    pub synced: Vec<PathBuf>,
    pub fail_sync_of: Option<PathBuf>,
    pub fail_create_at: Option<u32>,
    pub fail_remove: bool,
}

impl ObservedFs {
    pub fn new() -> Self {
        Self {
            inner: StdFs,
            creates: 0,
            dirs_created: 0,
            synced: Vec::new(),
            fail_sync_of: None,
            fail_create_at: None,
            fail_remove: false,
        }
    }

    pub fn created_nothing(&self) -> bool {
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
        if self.fail_remove {
            return Err(io::Error::other("injected file removal failure"));
        }
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

pub fn key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

pub fn manifest_at(revision: u64) -> JournalManifest {
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
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
}

pub fn entry(n: u32) -> JournalInventoryEntry {
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
pub fn pages_of(count: u32, per_page: usize, generation: u64) -> Vec<JournalPage> {
    let all: Vec<JournalInventoryEntry> = (0..count).map(entry).collect();
    let sorted = JournalPage::new(0, 1, all).unwrap().entries().to_vec();
    sorted
        .chunks(per_page)
        .enumerate()
        .map(|(index, chunk)| JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap())
        .collect()
}

/// A captured inventory over the committed manifest, sealed once.
pub struct Captured {
    pub committed_manifest: JournalManifest,
    pub fence: MigrationFence,
    pub successor: JournalManifest,
    pub pages: Vec<JournalPage>,
    pub envelopes: Vec<Vec<u8>>,
}

impl Captured {
    pub fn new(count: u32, per_page: usize) -> Self {
        Self::on(manifest_at(COMMITTED_REVISION), count, per_page)
    }

    /// Pages at the next revision's generation, captured over `committed_manifest`.
    pub fn on(committed_manifest: JournalManifest, count: u32, per_page: usize) -> Self {
        let generation = committed_manifest.journal_revision + 1;
        Self::on_pages(committed_manifest, pages_of(count, per_page, generation))
    }

    /// `pages` sealed once and captured over `committed_manifest`.
    pub fn on_pages(committed_manifest: JournalManifest, pages: Vec<JournalPage>) -> Self {
        let envelopes = seal_inventory_pages(&key(), &committed_manifest, &pages).unwrap();
        Self::from_sealed(committed_manifest, pages, envelopes)
    }

    /// Already sealed pages captured over `committed_manifest`.
    pub fn from_sealed(
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

    pub fn digest(&self) -> [u8; 32] {
        self.successor.journal_page_set_digest
    }

    pub fn sealed(&self) -> Vec<SealedPage<'_>> {
        seal_all(&self.pages, &self.envelopes)
    }
}

pub fn seal_all<'a>(pages: &'a [JournalPage], envelopes: &'a [Vec<u8>]) -> Vec<SealedPage<'a>> {
    pages
        .iter()
        .zip(envelopes)
        .map(|(page, envelope)| SealedPage { page, envelope })
        .collect()
}

/// A journal directory whose root-named generation is a committed manifest.
pub struct Journal {
    pub dir: TempDir,
    pub live: LiveMigration,
}

impl Journal {
    pub fn path(&self) -> &Path {
        &self.dir.0
    }
}

/// Commits `captured`'s committed manifest to a fresh directory and returns the binding naming it.
pub fn journal_of(captured: &Captured) -> Journal {
    let dir = TempDir::new();
    let live = commit_into(&dir.0, &captured.committed_manifest);
    Journal { dir, live }
}

/// Commits `manifest` as the root-named generation of `dir`; returns the binding that names it.
pub fn commit_into(dir: &Path, manifest: &JournalManifest) -> LiveMigration {
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
pub fn store<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    captured: &Captured,
) -> Result<DirectoryDurability, JournalDurableError> {
    store_as(fs, journal, captured, Some(&journal.live))
}

/// The same, presenting `committed` as the root's binding.
pub fn store_as<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    captured: &Captured,
    committed: Option<&LiveMigration>,
) -> Result<DirectoryDurability, JournalDurableError> {
    let pages = captured.sealed();
    promote(fs, journal.path(), &set_of(captured, committed, &pages))
}

pub fn set_of<'a>(
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

pub fn promote<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    set: &InventorySetWrite<'_>,
) -> Result<DirectoryDurability, JournalDurableError> {
    promote_as(fs, dir, set, &WriteOperationId::generate().unwrap())
}

/// The same under a given write operation id, so a retry can reuse the one of an earlier attempt.
pub fn promote_as<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    set: &InventorySetWrite<'_>,
    op: &WriteOperationId,
) -> Result<DirectoryDurability, JournalDurableError> {
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, dir, op);
    promote_inventory_set_fenced(&mut ctx, set)
}

pub fn page_file(dir: &Path, digest: &[u8; 32], index: u32) -> PathBuf {
    inventory_page_dir(dir, digest, index).join("generation-4.wsr1")
}

/// Page 0's envelope sealed for `epoch` under the journal key.
pub fn sealed_at_epoch(captured: &Captured, epoch: u64) -> Vec<u8> {
    sealed_under(captured, &key(), epoch)
}

/// Page 0's envelope sealed for `epoch` under `key`: with another key it is what a page of another
/// epoch really looks like, which authenticates only under that epoch's own key.
pub fn sealed_under(captured: &Captured, key: &Key, epoch: u64) -> Vec<u8> {
    let parsed = parse_envelope(&captured.envelopes[0]).unwrap();
    let meta = RecordMeta {
        key_epoch: epoch,
        record_generation: parsed.header().record_generation,
        record_schema: parsed.header().record_schema,
    };
    let identity = RecordIdentity::new(RecordClass::MigrationPage, &[OPERATION, "0"]).unwrap();
    captured.pages[0].seal(key, &identity, meta).unwrap()
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
