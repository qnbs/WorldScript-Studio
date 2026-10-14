//! Gate 4D fixtures for the inventory under a real journal directory: a committed owner that stages and
//! promotes captures, moves its committed revision on, and sweeps what attempts left behind.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use worldscript_secure_storage::*;

use super::journal_fixture::{commit_into, key, manifest_at, Journal, TempDir, COMMITTED_REVISION};

/// `count` ascending entries (six digits, so the order is the numeric one for any count).
pub fn entries(count: u32) -> Vec<JournalInventoryEntry> {
    (0..count)
        .map(|n| {
            let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:06}")]).unwrap();
            let source = JournalInventorySource {
                authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
                physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
                generation: None,
                evidence_digest: Some([n as u8; 32]),
                foreign: None,
            };
            JournalInventoryEntry::new(record, source).unwrap()
        })
        .collect()
}

/// A real journal whose root-named generation is `committed`, moved on by [`Self::advance`].
pub struct Scenario {
    pub journal: Journal,
    pub committed: JournalManifest,
}

impl Scenario {
    pub fn new() -> Self {
        let committed = manifest_at(COMMITTED_REVISION);
        let dir = TempDir::new();
        let live = commit_into(&dir.0, &committed);
        Scenario {
            journal: Journal { dir, live },
            committed,
        }
    }

    pub fn path(&self) -> &Path {
        self.journal.path()
    }

    pub fn inventory(&self) -> PathBuf {
        self.path().join("inventory")
    }

    pub fn fence(&self) -> MigrationFence {
        MigrationFence::from_manifest(&self.committed)
    }

    /// Stages `count` entries in pages of two: a finished capture, not promoted, not discarded.
    pub fn stage(&self, count: u32) -> StagedCapture {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut fs = StdFs;
        let mut ctx = JournalDurableContext::new(&mut fs, &key, self.path(), &op);
        let start = CaptureStart {
            committed_manifest: &self.committed,
            fence: &self.fence(),
            live: &self.journal.live,
            entry_count: count,
        };
        let mut capture = StreamedCapture::begin(&mut ctx, &start).unwrap();
        for chunk in entries(count).chunks(2) {
            capture = capture.push_page(&mut ctx, chunk.to_vec()).unwrap();
        }
        capture.finish(&mut ctx).unwrap()
    }

    /// Stores `staged` under its digest directory, as the committed owner.
    pub fn promote(&self, staged: &StagedCapture) {
        let (key, op) = (key(), WriteOperationId::generate().unwrap());
        let mut fs = StdFs;
        let mut ctx = JournalDurableContext::new(&mut fs, &key, self.path(), &op);
        let promotion = StagedPromotion {
            committed_manifest: &self.committed,
            fence: &self.fence(),
            committed: &self.journal.live,
            staged,
        };
        promote_staged_inventory_fenced(&mut ctx, &promotion).unwrap();
    }

    /// Commits `manifest` as the next root-named generation: the journal moves on.
    pub fn advance(&mut self, manifest: &JournalManifest) {
        self.journal.live = commit_into(self.path(), manifest);
        self.committed = manifest.clone();
    }

    /// The sweep as the committed owner over `fs`.
    pub fn sweep<F: DurableFs>(&self, fs: &mut F) -> Result<Reclaimed, ReclaimError> {
        self.sweep_as(fs, &self.fence(), &key())
    }

    /// The sweep of a caller that presents `fence` and opens the journal with `key`.
    pub fn sweep_as<F: DurableFs>(
        &self,
        fs: &mut F,
        fence: &MigrationFence,
        key: &Key,
    ) -> Result<Reclaimed, ReclaimError> {
        let op = WriteOperationId::generate().unwrap();
        let mut ctx = JournalDurableContext::new(fs, key, self.path(), &op);
        let request = ReclaimRequest {
            committed_manifest: &self.committed,
            fence,
            committed: &self.journal.live,
        };
        reclaim_abandoned_inventory(&mut ctx, &request)
    }
}

/// Every file and directory below `root` (a directory ends in `/`), relative to it.
pub fn tree_under(root: &Path) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for item in std::fs::read_dir(&dir).unwrap() {
            let path = item.unwrap().path();
            let relative = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if path.is_dir() {
                found.insert(format!("{relative}/"));
                stack.push(path);
            } else {
                found.insert(relative);
            }
        }
    }
    found
}

/// The names of the entries directly below `dir`.
pub fn names_in(dir: &Path) -> BTreeSet<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}
