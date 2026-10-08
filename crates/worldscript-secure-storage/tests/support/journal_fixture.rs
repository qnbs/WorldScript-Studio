//! Shared Gate 4D journal fixtures: a real committed journal directory, a file system that observes
//! what a store creates, and the keys and manifests the journal tests start from.

use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    content_digest, empty_inventory_digest, empty_journal_page_set_digest, generation_path,
    operation_type, phase_code, promote_manifest_fenced, DirectoryDurability, DurableFs,
    JournalDurableContext, JournalManifest, LiveMigration, MigrationFence, StdFs, WriteOperationId,
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

/// A key that is not the journal key: what another epoch's pages are sealed under.
pub fn other_key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [10u8; 32])
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
