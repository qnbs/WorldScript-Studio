//! Shared Gate 4D inventory fixtures: a captured and sealed inventory over a committed journal (see
//! `journal_fixture`) and the fenced store drivers.

use std::path::{Path, PathBuf};

use crate::journal_fixture::*;
use worldscript_secure_storage::{
    capture_inventory, inventory_page_dir, journal_page_set_digest, page_ref_for, parse_envelope,
    promote_inventory_set_fenced, seal_inventory_pages, source_authority_kind,
    source_physical_authority_kind, DirectoryDurability, DurableFs, InventorySetWrite,
    JournalDurableContext, JournalDurableError, JournalInventoryEntry, JournalInventorySource,
    JournalManifest, JournalPage, Key, LiveMigration, MigrationFence, RecordClass, RecordIdentity,
    RecordMeta, SealedPage, WriteOperationId,
};

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

/// Commits `captured`'s committed manifest to a fresh directory and returns the binding naming it.
pub fn journal_of(captured: &Captured) -> Journal {
    let dir = TempDir::new();
    let live = commit_into(&dir.0, &captured.committed_manifest);
    Journal { dir, live }
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
