//! Gate 4D C2a: the entry gate of the exclusive conversion driver (§10.3 `ADMIT`, `CONVERT`). The gate
//! needs the installation's exclusive admission, re-reads the journal the committed root vouches for
//! and refuses anything but the owner's conversion; it writes nothing. Every scenario therefore
//! commits a real root that binds a real journal. C2b-1: the session renews its lease through the
//! fenced journal-owner operation and follows the root. C2b-2: it enters `CONVERT` and moves the
//! checkpoint cursor through the same step. C2c-2: it converts the entries of the verified inventory
//! batch by batch with a caller-supplied step, resumes from the persisted cursor and leaves `CONVERT`.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::journal::renewed_lease;
use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    begin_conversion, capture_inventory, commit_catalog_change, commit_journal_takeover,
    commit_root, content_digest, empty_inventory_digest, empty_journal_page_set_digest,
    generation_path, inventory_page_dir, load_catalog, operation_type, phase_code,
    seal_inventory_pages, source_authority_kind, source_physical_authority_kind, write_key_epoch,
    AdmissionScope, AuthorityError, CandidateConflict, CatalogChange, CatalogCommit,
    ConversionBegin, ConversionError, ConversionSession, ConvertBatch, ConvertError,
    DirectoryDurability, DurableFs, EntryStep, ExclusiveAdmissionGuard, InstallationScopeId,
    JournalCheckpoint, JournalCheckpointCursor, JournalDurableError, JournalError,
    JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage, JournalRouteError,
    JournalSource, JournalTakeoverCommit, Key, KeyEpochCommit, KeyEpochRecord, KeyEpochStatus,
    KeyProvider, LiveMigration, MigrationExecutionError, MigrationFence, Progress, RecordClass,
    RecordIdentity, RecordMeta, RootBody, RootCommitEvidence, RootCommitGuard, RootCommitRequest,
    RootCommitState, RootKeyRefV1, RootLayout, SealedPage, StdFs, WriteOperationId,
    JOURNAL_MANIFEST_RECORD_SCHEMA, OPERATION_ADMISSION_LOCK_FILE,
};

const OPERATION: &str = "conversion-op";
const OWNER: &str = "owner-a";
const REVISION: u64 = 3;
const FENCE: u64 = 4;
/// A lease long past its expiry: the gate reads no clock, so it is still the owner's.
const LEASE_EXPIRY: u64 = 1_000;
/// The expiry a renewal moves the lease to.
const RENEWED_EXPIRY: u64 = 5_000;
const MATERIAL: [u8; 32] = [9; 32];
const EPOCH: u64 = 1;

/// An `ENABLE` manifest at the bound revision, owned by [`OWNER`], in `phase`. The flag follows the
/// phase: forbidden before `ADMIT`, required from `CONVERT` to `DONE`, free for `ADMIT` and
/// `RECOVERY_REQUIRED`, where it is set here.
fn manifest(phase: u32) -> JournalManifest {
    let before_admit = phase < phase_code::ADMIT;
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: REVISION,
        operation_type: operation_type::ENABLE,
        phase,
        source_epoch: 0,
        target_epoch: EPOCH,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: FENCE,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 0,
        entry_count: 0,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: !before_admit,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: true,
        lease_owner_id: Some(OWNER.into()),
        lease_expires_unix_ms: Some(LEASE_EXPIRY),
        recovery_reason_code: u32::from(phase == phase_code::RECOVERY_REQUIRED),
    }
}

fn journal_key() -> Key {
    Key::from_bytes(&mut MATERIAL.clone())
}

fn entry(n: u32) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:03}")]).unwrap();
    let source = JournalInventorySource {
        authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
        physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
        generation: None,
        evidence_digest: Some([n as u8; 32]),
        foreign: None,
    };
    JournalInventoryEntry::new(record, source).unwrap()
}

/// `count` entries in ascending pages of `per_page` (the last one shorter), every page at `generation`.
fn pages_of(count: u32, per_page: usize, generation: u64) -> Vec<JournalPage> {
    if count == 0 {
        return Vec::new();
    }
    let all: Vec<_> = (0..count).map(entry).collect();
    let sorted = JournalPage::new(0, 1, all).unwrap().entries().to_vec();
    let chunks = sorted.chunks(per_page).enumerate();
    chunks
        .map(|(index, chunk)| JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap())
        .collect()
}

/// A directory this test created; removed when dropped (`create_dir` fails on an existing path, so a
/// leftover of an earlier process is skipped, never reused or removed).
struct Dir(PathBuf);

impl Dir {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        loop {
            let path = std::env::temp_dir().join(format!(
                "wss-gate4d-conversion-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Dir(path),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("cannot create {}: {error}", path.display()),
            }
        }
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// An installation directory holding the authority root and a journal, and a provider with the
/// epoch-1 key: the root's registry, its first root and (once bound) a root binding the journal.
struct Fixture {
    base: Dir,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    key_ref: RootKeyRefV1,
}

impl Fixture {
    /// The journal stored as the root-named generation of `manifest` and a root that does not yet
    /// bind it; returns the binding that names it.
    fn unbound(manifest: &JournalManifest) -> (Self, LiveMigration) {
        let base = Dir::new();
        for slot in ["authority/slot-a", "authority/slot-b", "journal"] {
            fs::create_dir_all(base.0.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let key_ref = provider.import_epoch_key(EPOCH, MATERIAL).unwrap();
        provider.unlock().unwrap();
        let mut fixture = Fixture {
            base,
            provider,
            scope,
            key_ref,
        };
        fixture.register_epoch();
        let live = fixture.store_journal(manifest);
        fixture.commit_first_root();
        (fixture, live)
    }

    /// As [`Fixture::unbound`], with the root binding the journal.
    fn bound(manifest: &JournalManifest) -> Self {
        let (mut fixture, live) = Fixture::unbound(manifest);
        fixture.bind(&live);
        fixture
    }

    /// The journal of an `ADMIT` manifest that captured `count` entries in pages of `per_page`, the
    /// pages stored where the page-set digest names them, and a root that binds it.
    fn bound_with_inventory(count: u32, per_page: usize) -> Self {
        Self::bound_with_inventory_and(count, per_page, |_| {})
    }

    /// As [`Fixture::bound_with_inventory`], with `adjust` applied to the stored manifest (its inventory
    /// fields and the stored pages stay those of the capture).
    fn bound_with_inventory_and(
        count: u32,
        per_page: usize,
        adjust: impl FnOnce(&mut JournalManifest),
    ) -> Self {
        let mut open = manifest(phase_code::ADMIT);
        (open.journal_revision, open.final_inventory_captured) = (REVISION - 1, false);
        let pages = pages_of(count, per_page, REVISION);
        let envelopes = seal_inventory_pages(&journal_key(), &open, &pages).unwrap();
        let sealed: Vec<_> = pages
            .iter()
            .zip(&envelopes)
            .map(|(page, envelope)| SealedPage { page, envelope })
            .collect();
        let fence = MigrationFence::from_manifest(&open);
        let captured = capture_inventory(&open, &fence, &sealed).unwrap();
        let mut stored = captured.clone();
        adjust(&mut stored);
        let (mut fixture, live) = Fixture::unbound(&stored);
        for (page, envelope) in pages.iter().zip(&envelopes) {
            let digest = &captured.journal_page_set_digest;
            let dir = inventory_page_dir(&fixture.journal_dir(), digest, page.page_index());
            fs::create_dir_all(&dir).unwrap();
            fs::write(generation_path(&dir, REVISION), envelope).unwrap();
        }
        fixture.bind(&live);
        fixture
    }

    /// The stored envelope of page `index` of the captured inventory.
    fn page_file(&self, index: u32) -> PathBuf {
        let digest = self.committed(OWNER).unwrap().journal_page_set_digest;
        let dir = inventory_page_dir(&self.journal_dir(), &digest, index);
        generation_path(&dir, REVISION)
    }

    fn root_dir(&self) -> PathBuf {
        self.base.0.join("authority")
    }

    fn journal_dir(&self) -> PathBuf {
        self.base.0.join("journal")
    }

    fn register_epoch(&self) {
        let record = KeyEpochRecord {
            epoch: EPOCH,
            status: KeyEpochStatus::Active,
            root_key_ref: self.key_ref.clone(),
        };
        let root_dir = self.root_dir();
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let commit = KeyEpochCommit {
            scope: &self.scope,
            record: &record,
            registry_generation: 1,
            root_key_ref: &self.key_ref,
            key_epoch: EPOCH,
            held: &guard,
        };
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        write_key_epoch(&mut StdFs, &self.provider, layout, commit).unwrap();
    }

    fn store_journal(&self, manifest: &JournalManifest) -> LiveMigration {
        let identity = RecordIdentity::new(RecordClass::Migration, &[OPERATION]).unwrap();
        let meta = RecordMeta {
            key_epoch: EPOCH,
            record_generation: REVISION,
            record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
        };
        let sealed = manifest.seal(&journal_key(), &identity, meta).unwrap();
        fs::write(generation_path(&self.journal_dir(), REVISION), &sealed).unwrap();
        LiveMigration {
            operation_id: OPERATION.into(),
            fencing_generation: FENCE,
            journal_revision: REVISION,
            manifest_digest: content_digest(&sealed),
        }
    }

    fn commit_first_root(&mut self) {
        let root_dir = self.root_dir();
        let commit = CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &self.key_ref,
            active_key_epoch: EPOCH,
            operation_id: "first-root",
        };
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        commit_catalog_change(&mut StdFs, &mut self.provider, layout, commit).unwrap();
    }

    /// The next root, binding `live`. No producer of a bind exists in the crate yet, so the body is
    /// committed directly.
    fn bind(&mut self, live: &LiveMigration) {
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let catalog = load_catalog(&mut StdFs, &self.provider, layout)
            .unwrap()
            .unwrap();
        let root = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: live.operation_id.clone(),
                fencing_generation: live.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(live.clone()),
            ..catalog.root
        };
        let guard = RootCommitGuard::acquire(&root_dir).unwrap();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &self.key_ref,
            held: &guard,
        };
        commit_root(&mut StdFs, &mut self.provider, layout, request).unwrap();
    }

    /// The locations a gate request names, with a write operation of its own.
    fn paths(&self) -> Paths {
        Paths {
            installation: self.base.0.clone(),
            root: self.root_dir(),
            journal: self.journal_dir(),
            operation: WriteOperationId::generate().unwrap(),
        }
    }

    /// The manifest the gate returns to `owner` under this installation's own admission, which is
    /// released again: no other admission may be held.
    fn committed(&self, owner: &str) -> Result<JournalManifest, ConversionError> {
        let paths = self.paths();
        let mut held = paths.admission();
        begin_conversion(&mut held, &mut StdFs, &self.provider, paths.begin(owner))
            .map(|session| session.manifest().clone())
    }

    /// The gate as `owner` under this installation's own admission, over the real file system.
    fn begin(&self, owner: &str) -> Result<(), ConversionError> {
        self.committed(owner).map(|_| ())
    }

    /// Another owner takes the journal over from `committed`, whose lease has lapsed: the next
    /// revision at the next fence, with a lease of its own.
    fn take_over(&mut self, committed: &JournalManifest) {
        let mut claim = committed.clone();
        claim.journal_revision += 1;
        claim.fencing_generation += 1;
        claim.lease_owner_id = Some("new-owner".into());
        claim.lease_expires_unix_ms = Some(LEASE_EXPIRY + 10_000);
        let (journal_dir, operation) = (self.journal_dir(), WriteOperationId::generate().unwrap());
        let fence = MigrationFence::from_manifest(&claim);
        let takeover = JournalTakeoverCommit {
            claim: JournalCheckpoint {
                manifest: &claim,
                fence: &fence,
                journal: JournalSource {
                    dir: &journal_dir,
                    operation: &operation,
                },
                root_key_ref: &self.key_ref,
                active_key_epoch: EPOCH,
                conflict: CandidateConflict::Refuse,
            },
            now_unix_ms: LEASE_EXPIRY + 1,
        };
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        commit_journal_takeover(&mut StdFs, &mut self.provider, layout, takeover).unwrap();
    }

    /// The generation of the committed root.
    fn root_generation(&self) -> u64 {
        let root_dir = self.root_dir();
        let layout = RootLayout {
            root_dir: &root_dir,
        };
        let catalog = load_catalog(&mut StdFs, &self.provider, layout)
            .unwrap()
            .unwrap();
        catalog.root.root_generation
    }

    /// Every file under the fixture with a digest of its content.
    fn snapshot(&self) -> BTreeMap<PathBuf, [u8; 32]> {
        let mut files = BTreeMap::new();
        collect(&self.base.0, &self.base.0, &mut files);
        files
    }
}

/// The directories and the write operation a gate request refers to.
struct Paths {
    installation: PathBuf,
    root: PathBuf,
    journal: PathBuf,
    operation: WriteOperationId,
}

impl Paths {
    fn scope(&self) -> AdmissionScope<'_> {
        AdmissionScope {
            installation_dir: &self.installation,
            root_dir: &self.root,
        }
    }

    /// The exclusive admission of the installation these paths name.
    fn admission(&self) -> ExclusiveAdmissionGuard {
        ExclusiveAdmissionGuard::try_acquire(self.scope())
            .unwrap()
            .expect("nothing else holds this installation")
    }

    fn begin<'a>(&'a self, owner: &'a str) -> ConversionBegin<'a> {
        ConversionBegin {
            scope: self.scope(),
            journal: JournalSource {
                dir: &self.journal,
                operation: &self.operation,
            },
            owner_id: owner,
        }
    }
}

/// The real file system, reporting to `on_read` after every read has happened; the hook may turn the
/// read into a failure.
struct WatchedFs<H: FnMut(&Path) -> io::Result<()>> {
    on_read: H,
}

impl<H: FnMut(&Path) -> io::Result<()>> DurableFs for WatchedFs<H> {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        let bytes = StdFs.read(path);
        (self.on_read)(path)?;
        bytes
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        let bytes = StdFs.read_at_most(path, limit);
        (self.on_read)(path)?;
        bytes
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        StdFs.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        StdFs.list_dir(dir)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.rename_replace(from, to)
    }

    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        StdFs.create_dir_all(dir)
    }
    fn list_dir_at_most(
        &mut self,
        dir: &Path,
        limit: usize,
    ) -> io::Result<Option<Vec<std::ffi::OsString>>> {
        worldscript_secure_storage::durable::list_dir_at_most_via_list_dir(self, dir, limit)
    }
}

/// Collects every file below `dir` except the admission coordination file, which Windows creates when
/// an admission is acquired and whose bytes have no authority: the gate must not change anything else.
fn collect(base: &Path, dir: &Path, files: &mut BTreeMap<PathBuf, [u8; 32]>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(base, &path, files);
        } else if path
            .file_name()
            .is_some_and(|name| name != OPERATION_ADMISSION_LOCK_FILE)
        {
            let relative = path.strip_prefix(base).unwrap().to_path_buf();
            files.insert(relative, content_digest(&fs::read(&path).unwrap()));
        }
    }
}

#[test]
fn the_owner_in_admit_or_convert_gets_the_committed_state_and_nothing_is_written() {
    let mut seen = Vec::new();
    for phase in [phase_code::ADMIT, phase_code::CONVERT] {
        let committed = manifest(phase);
        let fixture = Fixture::bound(&committed);
        let before = fixture.snapshot();
        let paths = fixture.paths();
        let mut held = paths.admission();
        let session =
            begin_conversion(&mut held, &mut StdFs, &fixture.provider, paths.begin(OWNER)).unwrap();
        seen.push((
            session.manifest() == &committed,
            session.fence() == MigrationFence::from_manifest(&committed),
            session.live().journal_revision == REVISION && session.is_admitted(),
            fixture.snapshot() == before,
        ));
    }
    assert_eq!(seen, vec![(true, true, true, true); 2]);
}

#[test]
fn every_other_phase_is_refused_with_its_own_reason() {
    let phases = [
        phase_code::BOOTSTRAP_TARGET,
        phase_code::DISCOVER,
        phase_code::PREPARE,
        phase_code::VERIFY,
        phase_code::COMMIT,
        phase_code::RETIRE_OLD_AUTHORITY,
        phase_code::FINALIZE,
        phase_code::DONE,
        phase_code::RECOVERY_REQUIRED,
    ];
    let outcomes: Vec<_> = phases
        .iter()
        .map(|&phase| Fixture::bound(&manifest(phase)).begin(OWNER).unwrap_err())
        .collect();
    let mut expected = vec![ConversionError::PhaseNotConvertible; 7];
    expected.extend([
        ConversionError::TerminalPhase,
        ConversionError::RecoveryRequired,
    ]);
    assert_eq!(outcomes, expected);
}

#[test]
fn an_admit_manifest_without_the_final_inventory_is_refused() {
    let mut open = manifest(phase_code::ADMIT);
    open.final_inventory_captured = false;
    let fixture = Fixture::bound(&open);
    let before = fixture.snapshot();
    assert_eq!(
        fixture.begin(OWNER),
        Err(ConversionError::FinalInventoryNotCaptured)
    );
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn a_lease_of_another_owner_or_of_none_is_refused() {
    let mut unowned = manifest(phase_code::ADMIT);
    unowned.has_lease_owner = false;
    unowned.lease_owner_id = None;
    unowned.lease_expires_unix_ms = None;
    let outcomes = vec![
        Fixture::bound(&manifest(phase_code::ADMIT)).begin("owner-b"),
        Fixture::bound(&manifest(phase_code::CONVERT)).begin(""),
        Fixture::bound(&unowned).begin(OWNER),
    ];
    assert_eq!(outcomes, vec![Err(ConversionError::ForeignLeaseOwner); 3]);
}

/// The gate over `fixture` as its owner under `held`, reporting every read to `on_read`.
fn begin_watched<H: FnMut(&Path) -> io::Result<()>>(
    fixture: &Fixture,
    held: &mut ExclusiveAdmissionGuard,
    on_read: H,
) -> Result<(), ConversionError> {
    let paths = fixture.paths();
    let mut watched = WatchedFs { on_read };
    begin_conversion(held, &mut watched, &fixture.provider, paths.begin(OWNER)).map(|_| ())
}

#[test]
fn a_guard_admitted_for_another_installation_is_refused_before_anything_is_read() {
    let committed = manifest(phase_code::ADMIT);
    let (fixture, other) = (Fixture::bound(&committed), Fixture::bound(&committed));
    let before = fixture.snapshot();
    let mut reads = 0;
    let outcome = begin_watched(&fixture, &mut other.paths().admission(), |_| {
        reads += 1;
        Ok(())
    });
    let unchanged = fixture.snapshot() == before;
    assert_eq!(
        (outcome, reads, unchanged),
        (Err(ConversionError::NotAdmitted), 0, true)
    );
}

#[cfg(unix)]
#[test]
fn an_installation_replaced_while_the_journal_is_read_is_refused() {
    // The gate is deterministic, so a first run counts its reads and a second run moves the
    // installation directory away right after the last one: only the check after the reads sees it.
    let committed = manifest(phase_code::ADMIT);
    let counted = Fixture::bound(&committed);
    let mut total = 0;
    begin_watched(&counted, &mut counted.paths().admission(), |_| {
        total += 1;
        Ok(())
    })
    .unwrap();
    let fixture = Fixture::bound(&committed);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let mut seen = 0;
    let outcome = begin_watched(&fixture, &mut fixture.paths().admission(), |_| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
        }
        Ok(())
    });
    fs::rename(&moved, &installation).unwrap();
    assert_eq!(outcome, Err(ConversionError::NotAdmitted));
}

#[test]
fn a_root_that_binds_no_migration_is_refused() {
    let (fixture, _live) = Fixture::unbound(&manifest(phase_code::ADMIT));
    assert_eq!(
        fixture.begin(OWNER),
        Err(ConversionError::Authority(AuthorityError::NoLiveMigration))
    );
}

#[test]
fn a_journal_generation_the_root_does_not_name_is_refused() {
    let fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let mut tampered = manifest(phase_code::ADMIT);
    tampered.lease_owner_id = Some("someone-else".into());
    fixture.store_journal(&tampered);
    assert_eq!(
        fixture.begin("someone-else"),
        Err(ConversionError::Authority(AuthorityError::JournalRoute(
            JournalRouteError::Journal(JournalDurableError::Authority(
                MigrationExecutionError::LiveBindingMismatch
            ))
        )))
    );
}

#[test]
fn a_sibling_generation_is_never_read_instead_of_the_root_named_one() {
    // A newer generation in the journal directory is not authority: the gate reads the one the root
    // names, so an unrelated later file neither replaces it nor makes the gate refuse.
    let committed = manifest(phase_code::ADMIT);
    let fixture = Fixture::bound(&committed);
    let mut later = manifest(phase_code::CONVERT);
    later.journal_revision = REVISION + 1;
    later.lease_owner_id = Some("someone-else".into());
    let identity = RecordIdentity::new(RecordClass::Migration, &[OPERATION]).unwrap();
    let meta = RecordMeta {
        key_epoch: EPOCH,
        record_generation: later.journal_revision,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let sealed = later.seal(&journal_key(), &identity, meta).unwrap();
    fs::write(
        generation_path(&fixture.journal_dir(), REVISION + 1),
        sealed,
    )
    .unwrap();
    assert_eq!(fixture.begin(OWNER), Ok(()));
    assert_eq!(
        fixture.begin("someone-else"),
        Err(ConversionError::ForeignLeaseOwner)
    );
}

/// A session over `fixture`'s installation as its owner, under `held`.
fn open<'a>(
    fixture: &Fixture,
    paths: &'a Paths,
    held: &'a mut ExclusiveAdmissionGuard,
) -> ConversionSession<'a> {
    begin_conversion(held, &mut StdFs, &fixture.provider, paths.begin(OWNER)).unwrap()
}

/// The digest of the manifest generation `revision` in `dir`.
fn generation_digest(dir: &Path, revision: u64) -> [u8; 32] {
    content_digest(&fs::read(generation_path(dir, revision)).unwrap())
}

#[test]
fn the_owner_renews_its_lease_in_admit_and_in_convert_and_the_session_follows_the_root() {
    let mut seen = Vec::new();
    for phase in [phase_code::ADMIT, phase_code::CONVERT] {
        let committed = manifest(phase);
        let mut fixture = Fixture::bound(&committed);
        let mut expected = committed.clone();
        expected.journal_revision += 1;
        expected.lease_expires_unix_ms = Some(RENEWED_EXPIRY);
        let generation = fixture.root_generation();
        let followed = {
            let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
            let mut session = open(&fixture, &paths, &mut held);
            let renewed = session.renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY);
            let token = MigrationFence::from_manifest(&expected);
            (
                // The commit is returned: one root generation further.
                renewed.map(|committed| committed.root_generation == generation + 1),
                session.manifest() == &expected,
                session.fence() == token && session.is_admitted(),
            )
        };
        // A fresh gate reads what the root now names: the renewed manifest and nothing else moved.
        seen.push((followed, fixture.committed(OWNER) == Ok(expected)));
    }
    assert_eq!(seen, vec![((Ok(true), true, true), true); 2]);
}

#[test]
fn an_expiry_that_does_not_move_forward_is_refused_and_writes_nothing() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let before = fixture.snapshot();
    let outcomes: Vec<_> = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        [LEASE_EXPIRY, LEASE_EXPIRY - 1]
            .into_iter()
            .map(|expiry| {
                session
                    .renew_lease(&mut StdFs, &mut fixture.provider, expiry)
                    .map(|_| ())
            })
            .collect()
    };
    let refused = ConversionError::Migration(MigrationExecutionError::InvalidLeaseRenewal);
    assert_eq!(outcomes, vec![Err(refused); 2]);
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn a_session_that_another_owner_took_over_from_is_refused_before_any_write() {
    let committed = manifest(phase_code::ADMIT);
    let mut fixture = Fixture::bound(&committed);
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    fixture.take_over(&committed);
    let before = fixture.snapshot();
    let outcome = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    let stale = AuthorityError::Journal(JournalDurableError::Authority(
        MigrationExecutionError::StaleMigrationOwner,
    ));
    assert_eq!(outcome, Err(ConversionError::Authority(stale)));
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn a_failed_root_commit_leaves_the_session_where_it_was_and_the_retry_adopts_the_candidate() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let journal_dir = fixture.journal_dir();
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    // The anchor refuses the root's preparation: the renewal is already in the journal as revision
    // `r + 1`, the root still names `r`, and nothing is left pending.
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Prepare));
    let failed = session.renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY);
    let candidate = generation_digest(&journal_dir, REVISION + 1);
    let kept = session.manifest().journal_revision == REVISION;
    let retried = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    let adopted = generation_digest(&journal_dir, REVISION + 1) == candidate;
    let revision = session.manifest().journal_revision;
    assert_eq!(
        (failed.is_err(), kept, retried, adopted, revision),
        (true, true, Ok(()), true, REVISION + 1)
    );
}

#[cfg(unix)]
#[test]
fn a_step_after_the_installation_moved_is_refused_before_any_write() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let before = fixture.snapshot();
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    fs::rename(&installation, &moved).unwrap();
    let outcome = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    fs::rename(&moved, &installation).unwrap();
    assert_eq!(outcome, Err(ConversionError::NotAdmitted));
    assert_eq!(fixture.snapshot(), before);
}

/// A renewal over a fixture, with `on_read` told of every read it makes.
fn renewal_watched<H: FnMut(&Path) -> io::Result<()>>(
    fixture: &mut Fixture,
    on_read: H,
) -> Result<(), ConversionError> {
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(fixture, &paths, &mut held);
    let mut watched = WatchedFs { on_read };
    session
        .renew_lease(&mut watched, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ())
}

#[cfg(unix)]
#[test]
fn an_admission_lost_after_a_step_is_reported_though_the_step_committed() {
    // The step is deterministic, so a first run counts its reads and a second run moves the
    // installation away right after the last one: only the check after the step sees it.
    let committed = manifest(phase_code::ADMIT);
    let mut total = 0;
    renewal_watched(&mut Fixture::bound(&committed), |_| {
        total += 1;
        Ok(())
    })
    .unwrap();
    let mut fixture = Fixture::bound(&committed);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let mut seen = 0;
    let outcome = renewal_watched(&mut fixture, |_| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
        }
        Ok(())
    });
    fs::rename(&moved, &installation).unwrap();
    let renewed = fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms);
    assert_eq!(
        (outcome, renewed),
        (Err(ConversionError::NotAdmitted), Ok(Some(RENEWED_EXPIRY)))
    );
}

#[test]
fn the_renewal_builder_refuses_another_token_a_missing_lease_and_a_terminal_journal() {
    let committed = manifest(phase_code::ADMIT);
    let token = MigrationFence::from_manifest(&committed);
    let stale = MigrationFence {
        journal_revision: REVISION - 1,
        ..token
    };
    let mut unowned = committed.clone();
    (unowned.has_lease_owner, unowned.lease_owner_id) = (false, None);
    unowned.lease_expires_unix_ms = None;
    let done = manifest(phase_code::DONE);
    let outcomes = vec![
        renewed_lease(&committed, &stale, RENEWED_EXPIRY),
        renewed_lease(&unowned, &token, RENEWED_EXPIRY),
        renewed_lease(&done, &MigrationFence::from_manifest(&done), RENEWED_EXPIRY),
    ];
    let refusals: Vec<_> = outcomes.into_iter().map(Result::unwrap_err).collect();
    assert_eq!(
        refusals,
        vec![
            MigrationExecutionError::StaleMigrationOwner,
            MigrationExecutionError::InvalidLeaseRenewal,
            MigrationExecutionError::TerminalPhase,
        ]
    );
}

/// The names in `dir` of generations moved aside with their bytes preserved.
fn quarantined(dir: &Path) -> Vec<PathBuf> {
    let mut names: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.to_string_lossy().contains(".rejected-"))
        .collect();
    names.sort();
    names
}

#[test]
fn a_differing_candidate_of_a_crashed_attempt_is_quarantined_and_does_not_block_the_next_step() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let journal_dir = fixture.journal_dir();
    {
        // The first attempt dies after writing its candidate: the anchor refuses the root's preparation.
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        fixture
            .provider
            .inject(Fault::BeforePersist(AnchorOp::Prepare));
        session
            .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
            .unwrap_err();
    }
    let candidate = generation_digest(&journal_dir, REVISION + 1);
    // The restarted owner derives another expiry from its clock.
    let other = RENEWED_EXPIRY + 1;
    let outcome = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        session
            .renew_lease(&mut StdFs, &mut fixture.provider, other)
            .map(|_| ())
    };
    let kept: Vec<_> = quarantined(&journal_dir)
        .iter()
        .map(|path| content_digest(&fs::read(path).unwrap()))
        .collect();
    let renamed = generation_digest(&journal_dir, REVISION + 1) != candidate;
    let expiry = fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms);
    assert_eq!(
        (outcome, kept, renamed, expiry),
        (Ok(()), vec![candidate], true, Ok(Some(other)))
    );
}

#[test]
fn a_renewal_is_busy_while_another_root_commit_holds_the_lock_and_writes_nothing() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    let lock = RootCommitGuard::acquire(&fixture.root_dir()).unwrap();
    let before = fixture.snapshot();
    let busy = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    let unchanged = fixture.snapshot() == before;
    drop(lock);
    let retried = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    assert_eq!(
        (busy, unchanged, retried),
        (Err(ConversionError::RootBusy), true, Ok(()))
    );
}

/// A hook that fails the `total`-th read it is told of and lets every other one through.
fn failing_nth_read(total: usize) -> impl FnMut(&Path) -> io::Result<()> {
    let mut seen = 0;
    move |_: &Path| {
        seen += 1;
        if seen == total {
            Err(io::Error::other("injected"))
        } else {
            Ok(())
        }
    }
}

/// How many reads a renewal over a fresh fixture makes, with `fault` injected into the anchor if given.
/// The step is deterministic, so the last of them is the read-back of the committed journal.
fn renewal_reads(fault: Option<Fault>) -> usize {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    if let Some(fault) = fault {
        fixture.provider.inject(fault);
    }
    let mut total = 0;
    let _ = renewal_watched(&mut fixture, |_| {
        total += 1;
        Ok(())
    });
    total
}

#[test]
fn a_read_back_that_fails_spends_the_session_though_the_step_committed() {
    let total = renewal_reads(None);
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let mut watched = WatchedFs {
        on_read: failing_nth_read(total),
    };
    let (first, later, snapshot) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        let first = session.renew_lease(&mut watched, &mut fixture.provider, RENEWED_EXPIRY);
        let later = session.renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY + 1);
        (
            first,
            later.map(|_| ()),
            session.manifest().journal_revision,
        )
    };
    let first_is_unreadable = matches!(first, Err(ConversionError::Unreadable(_)));
    assert_eq!(
        (first_is_unreadable, later, snapshot),
        (true, Err(ConversionError::Spent), REVISION)
    );
    // The renewal itself was committed: a new gate reads it.
    assert_eq!(
        fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms),
        Ok(Some(RENEWED_EXPIRY))
    );
}

#[test]
fn a_commit_that_reports_an_error_after_it_landed_is_settled_by_the_root() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let first = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        // The anchor commits the root but reports the outcome as unavailable.
        fixture
            .provider
            .inject(Fault::AfterPersist(AnchorOp::Commit));
        let first = session.renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY);
        (first, session.manifest().journal_revision)
    };
    let is_committed = matches!(first.0, Err(ConversionError::Committed(_)));
    assert_eq!((is_committed, first.1), (true, REVISION + 1));
    // The root names the renewal, which the session followed.
    assert_eq!(
        fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms),
        Ok(Some(RENEWED_EXPIRY))
    );
}

#[test]
fn a_commit_error_whose_outcome_cannot_be_read_back_spends_the_session() {
    let anchor_fault = Fault::AfterPersist(AnchorOp::Commit);
    let total = renewal_reads(Some(anchor_fault));
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let mut watched = WatchedFs {
        on_read: failing_nth_read(total),
    };
    let (first, later) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        fixture.provider.inject(anchor_fault);
        let first = session.renew_lease(&mut watched, &mut fixture.provider, RENEWED_EXPIRY);
        let later = session.renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY + 1);
        (first, later.map(|_| ()))
    };
    let first_is_unsettled = matches!(first, Err(ConversionError::Unsettled(_)));
    assert_eq!(
        (first_is_unsettled, later),
        (true, Err(ConversionError::Spent))
    );
}

#[test]
fn a_journal_directory_outside_the_installation_or_inside_the_root_is_refused_before_anything_is_read(
) {
    let fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let outside = Dir::new();
    let mut outcomes = Vec::new();
    let root = fixture.root_dir();
    let slot = root.join("slot-a");
    for journal in [
        outside.0.clone(),
        fixture.base.0.clone(),
        root.clone(),
        slot,
    ] {
        let mut paths = fixture.paths();
        paths.journal = journal;
        let mut held = paths.admission();
        let mut reads = 0;
        let mut watched = WatchedFs {
            on_read: |_: &Path| {
                reads += 1;
                Ok(())
            },
        };
        let outcome = begin_conversion(
            &mut held,
            &mut watched,
            &fixture.provider,
            paths.begin(OWNER),
        );
        outcomes.push((outcome.map(|_| ()), reads));
    }
    let refused = (Err(ConversionError::JournalMisplaced), 0);
    assert_eq!(outcomes, vec![refused; 4]);
}

#[cfg(unix)]
#[test]
fn a_journal_directory_replaced_after_begin_is_refused_before_any_write() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let before = fixture.snapshot();
    let journal = fixture.journal_dir();
    let moved = journal.with_extension("moved");
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    // A copy of the journal takes the place of the directory the session pinned.
    fs::rename(&journal, &moved).unwrap();
    fs::create_dir(&journal).unwrap();
    fs::copy(
        generation_path(&moved, REVISION),
        generation_path(&journal, REVISION),
    )
    .unwrap();
    let outcome = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    let admitted = session.is_admitted();
    fs::remove_dir_all(&journal).unwrap();
    fs::rename(&moved, &journal).unwrap();
    assert_eq!(
        (outcome, admitted, fixture.snapshot() == before),
        (Err(ConversionError::NotAdmitted), false, true)
    );
}

#[cfg(unix)]
#[test]
fn a_symlinked_journal_directory_retargeted_after_begin_does_not_redirect_the_step() {
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    let (journal, link) = (fixture.journal_dir(), fixture.base.0.join("journal-link"));
    let other = fixture.base.0.join("journal-other");
    std::os::unix::fs::symlink(&journal, &link).unwrap();
    // A copy of the journal sits where the link will point later.
    fs::create_dir(&other).unwrap();
    fs::copy(
        generation_path(&journal, REVISION),
        generation_path(&other, REVISION),
    )
    .unwrap();
    let mut paths = fixture.paths();
    paths.journal = link.clone();
    let mut held = paths.admission();
    let mut session =
        begin_conversion(&mut held, &mut StdFs, &fixture.provider, paths.begin(OWNER)).unwrap();
    fs::remove_file(&link).unwrap();
    std::os::unix::fs::symlink(&other, &link).unwrap();
    let outcome = session
        .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
        .map(|_| ());
    let (renewed_in_pinned, untouched_copy) = (
        generation_path(&journal, REVISION + 1).exists(),
        !generation_path(&other, REVISION + 1).exists(),
    );
    assert_eq!(
        (outcome, renewed_in_pinned, untouched_copy),
        (Ok(()), true, true)
    );
}

#[cfg(unix)]
#[test]
fn an_admission_lost_after_a_commit_that_reported_an_error_is_still_reported() {
    // The anchor commits the root but reports the outcome as unavailable, and the installation is
    // moved away right after the last read of the step: the step is committed and the loss is reported.
    let anchor_fault = Fault::AfterPersist(AnchorOp::Commit);
    let total = renewal_reads(Some(anchor_fault));
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    fixture.provider.inject(anchor_fault);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let mut seen = 0;
    let outcome = renewal_watched(&mut fixture, |_| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
        }
        Ok(())
    });
    fs::rename(&moved, &installation).unwrap();
    let renewed = fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms);
    assert_eq!(
        (outcome, renewed),
        (Err(ConversionError::NotAdmitted), Ok(Some(RENEWED_EXPIRY)))
    );
}

/// A manifest of `phase` over an inventory of two pages and ten entries, so that a cursor can move.
fn with_extent(phase: u32) -> JournalManifest {
    let mut manifest = manifest(phase);
    (manifest.page_count, manifest.entry_count) = (2, 10);
    manifest
}

/// The manifest the committed `from` becomes after a step that advances its revision.
fn next_revision(from: &JournalManifest) -> JournalManifest {
    let mut next = from.clone();
    next.journal_revision += 1;
    next
}

#[test]
fn entering_convert_moves_only_the_phase_and_the_revision_and_a_second_call_writes_nothing() {
    let committed = with_extent(phase_code::ADMIT);
    let mut expected = next_revision(&committed);
    expected.phase = phase_code::CONVERT;
    let mut fixture = Fixture::bound(&committed);
    let generation = fixture.root_generation();
    let (entered, again, snapshot) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        let entered = session
            .enter_convert(&mut StdFs, &mut fixture.provider)
            .map(|commit| commit.map(|c| c.root_generation == generation + 1));
        let before = fixture.snapshot();
        let again = session.enter_convert(&mut StdFs, &mut fixture.provider);
        let unchanged = fixture.snapshot() == before;
        let token = MigrationFence::from_manifest(&expected);
        (
            entered,
            (again, unchanged),
            (session.manifest() == &expected, session.fence() == token),
        )
    };
    assert_eq!(
        (entered, again, snapshot),
        (Ok(Some(true)), (Ok(None), true), (true, true))
    );
    // A fresh gate reads what the root now names: a resumed conversion.
    assert_eq!(fixture.committed(OWNER), Ok(expected));
}

#[test]
fn a_resumed_session_in_convert_has_nothing_to_enter() {
    let mut fixture = Fixture::bound(&with_extent(phase_code::CONVERT));
    let before = fixture.snapshot();
    let outcome = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        session.enter_convert(&mut StdFs, &mut fixture.provider)
    };
    assert_eq!((outcome, fixture.snapshot() == before), (Ok(None), true));
}

#[test]
fn the_cursor_is_page_local_and_never_moves_backwards_or_outside_the_selected_page() {
    // Ten entries in pages of six and four: the index `9` is inside the manifest's total but not
    // inside page 1.
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let cursors = [
        (1, 9),
        (0, 3),
        (1, 2),
        (1, 2),
        (0, 5),
        (1, 4),
        (2, 0),
        (1, 10),
    ];
    let (outcomes, snapshot) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        session
            .verify_inventory(&mut StdFs, &fixture.provider)
            .unwrap();
        session
            .enter_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        let outcomes: Vec<_> = cursors
            .iter()
            .map(|&(page, entry)| {
                let cursor = JournalCheckpointCursor::new(page, entry);
                let step = session.advance_cursor(&mut StdFs, &mut fixture.provider, cursor);
                step.map(|_| ())
            })
            .collect();
        let manifest = session.manifest();
        (
            outcomes,
            (
                manifest.cursor_page_index,
                manifest.cursor_entry_index,
                manifest.journal_revision,
            ),
        )
    };
    let refused = |error| Err(ConversionError::Migration(error));
    let beyond_the_page = refused(MigrationExecutionError::Journal(
        JournalError::EntryCountMismatch,
    ));
    let expected = vec![
        beyond_the_page.clone(),
        Ok(()),
        Ok(()),
        Ok(()),
        refused(MigrationExecutionError::RegressiveCheckpoint),
        beyond_the_page.clone(),
        refused(MigrationExecutionError::Journal(
            JournalError::InvalidPageIndex,
        )),
        beyond_the_page,
    ];
    // Entering CONVERT and three accepted checkpoints, the last at the cursor of the one before.
    assert_eq!((outcomes, snapshot), (expected, (1, 2, REVISION + 4)));
    let committed = fixture.committed(OWNER).unwrap();
    assert_eq!(
        (committed.cursor_page_index, committed.cursor_entry_index),
        (1, 2)
    );
}

#[test]
fn the_cursor_needs_the_verified_inventory() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let before_enter = fixture.snapshot();
    let outcome = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        session
            .enter_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        let before = fixture.snapshot();
        let cursor = JournalCheckpointCursor::new(0, 1);
        let outcome = session
            .advance_cursor(&mut StdFs, &mut fixture.provider, cursor)
            .map(|_| ());
        (outcome, fixture.snapshot() == before)
    };
    assert_eq!(outcome, (Err(ConversionError::InventoryNotVerified), true));
    assert_ne!(fixture.snapshot(), before_enter);
}

#[test]
fn a_session_authenticates_the_inventory_and_reads_every_page() {
    let fixture = Fixture::bound_with_inventory(10, 6);
    let before = fixture.snapshot();
    let expected = pages_of(10, 6, REVISION);
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    let unverified = session.page(&mut StdFs, &fixture.provider, 0).map(|_| ());
    session
        .verify_inventory(&mut StdFs, &fixture.provider)
        .unwrap();
    let counts: Vec<u32> = session
        .inventory()
        .unwrap()
        .page_refs()
        .iter()
        .map(|reference| reference.page_entry_count)
        .collect();
    let read: Vec<_> = (0..2)
        .map(|index| session.page(&mut StdFs, &fixture.provider, index).unwrap())
        .collect();
    let beyond = session.page(&mut StdFs, &fixture.provider, 2).map(|_| ());
    let same_entries = read
        .iter()
        .zip(&expected)
        .all(|(page, wanted)| page.entries() == wanted.entries());
    assert_eq!(
        (
            unverified,
            counts,
            same_entries,
            fixture.snapshot() == before
        ),
        (
            Err(ConversionError::InventoryNotVerified),
            vec![6, 4],
            true,
            true
        )
    );
    assert!(matches!(
        beyond,
        Err(ConversionError::Authority(AuthorityError::Journal(_)))
    ));
}

/// How the stored envelope of a page is damaged.
#[derive(Clone, Copy)]
enum Damage {
    Tampered,
    Missing,
    Swapped,
}

impl Damage {
    /// Damages the files of pages 0 and 1, whose undamaged bytes are `originals`.
    fn apply(self, files: (&Path, &Path), originals: (&[u8], &[u8])) {
        match self {
            Damage::Tampered => {
                let mut bytes = originals.0.to_vec();
                *bytes.last_mut().unwrap() ^= 1;
                fs::write(files.0, bytes).unwrap();
            }
            Damage::Missing => fs::remove_file(files.0).unwrap(),
            Damage::Swapped => {
                fs::write(files.0, originals.1).unwrap();
                fs::write(files.1, originals.0).unwrap();
            }
        }
    }
}

#[test]
fn a_tampered_missing_or_swapped_page_is_refused_by_the_verification_and_nothing_is_written() {
    let fixture = Fixture::bound_with_inventory(10, 6);
    let files = (fixture.page_file(0), fixture.page_file(1));
    let originals = (fs::read(&files.0).unwrap(), fs::read(&files.1).unwrap());
    let before = fixture.snapshot();
    let mut refused = Vec::new();
    for damage in [Damage::Tampered, Damage::Missing, Damage::Swapped] {
        damage.apply((&files.0, &files.1), (&originals.0, &originals.1));
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        let outcome = session.verify_inventory(&mut StdFs, &fixture.provider);
        refused.push((
            matches!(outcome, Err(ConversionError::Authority(_))),
            session.inventory().is_none(),
        ));
        fs::write(&files.0, &originals.0).unwrap();
        fs::write(&files.1, &originals.1).unwrap();
    }
    assert_eq!(refused, vec![(true, true); 3]);
    // Nothing was written, and after the damage is undone the same installation verifies.
    assert_eq!(fixture.snapshot(), before);
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    assert_eq!(
        session.verify_inventory(&mut StdFs, &fixture.provider),
        Ok(())
    );
}

#[cfg(unix)]
#[test]
fn reading_the_inventory_under_a_lost_admission_is_refused() {
    let fixture = Fixture::bound_with_inventory(10, 6);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    session
        .verify_inventory(&mut StdFs, &fixture.provider)
        .unwrap();
    fs::rename(&installation, &moved).unwrap();
    let verify = session.verify_inventory(&mut StdFs, &fixture.provider);
    let page = session.page(&mut StdFs, &fixture.provider, 0).map(|_| ());
    fs::rename(&moved, &installation).unwrap();
    assert_eq!(
        (verify, page),
        (
            Err(ConversionError::NotAdmitted),
            Err(ConversionError::NotAdmitted)
        )
    );
}

#[test]
fn the_cursor_does_not_move_outside_convert() {
    let mut fixture = Fixture::bound(&with_extent(phase_code::ADMIT));
    let before = fixture.snapshot();
    let outcome = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        let cursor = JournalCheckpointCursor::new(0, 1);
        session
            .advance_cursor(&mut StdFs, &mut fixture.provider, cursor)
            .map(|_| ())
    };
    assert_eq!(
        (outcome, fixture.snapshot() == before),
        (Err(ConversionError::WrongPhase), true)
    );
}

#[test]
fn a_session_that_another_owner_took_over_from_cannot_move_the_cursor() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    session
        .verify_inventory(&mut StdFs, &fixture.provider)
        .unwrap();
    session
        .enter_convert(&mut StdFs, &mut fixture.provider)
        .unwrap();
    let converting = session.manifest().clone();
    fixture.take_over(&converting);
    let before = fixture.snapshot();
    let cursor = JournalCheckpointCursor::new(0, 1);
    let outcome = session
        .advance_cursor(&mut StdFs, &mut fixture.provider, cursor)
        .map(|_| ());
    let stale = AuthorityError::Journal(JournalDurableError::Authority(
        MigrationExecutionError::StaleMigrationOwner,
    ));
    assert_eq!(outcome, Err(ConversionError::Authority(stale)));
    assert_eq!(fixture.snapshot(), before);
}

#[test]
fn the_lease_is_renewed_after_entering_convert() {
    let committed = with_extent(phase_code::ADMIT);
    let mut expected = next_revision(&next_revision(&committed));
    expected.phase = phase_code::CONVERT;
    expected.lease_expires_unix_ms = Some(RENEWED_EXPIRY);
    let mut fixture = Fixture::bound(&committed);
    let outcome = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = open(&fixture, &paths, &mut held);
        session
            .enter_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        session
            .renew_lease(&mut StdFs, &mut fixture.provider, RENEWED_EXPIRY)
            .map(|_| ())
    };
    assert_eq!((outcome, fixture.committed(OWNER)), (Ok(()), Ok(expected)));
}

/// A hook that fails the `total`-th read and, at the same moment, moves the installation away.
#[cfg(unix)]
fn failing_and_moving(
    total: usize,
    installation: PathBuf,
    moved: PathBuf,
) -> impl FnMut(&Path) -> io::Result<()> {
    let mut seen = 0;
    move |_: &Path| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
            Err(io::Error::other("injected"))
        } else {
            Ok(())
        }
    }
}

#[cfg(unix)]
#[test]
fn an_admission_lost_after_an_unreadable_or_unsettled_step_is_reported_first() {
    // The step committed (or may have) and the read-back fails while the installation is moved away:
    // the caller is told the admission is gone, not only that the session is spent.
    let faults = [None, Some(Fault::AfterPersist(AnchorOp::Commit))];
    let mut outcomes = Vec::new();
    let mut committed = Vec::new();
    for fault in faults {
        let total = renewal_reads(fault);
        let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
        if let Some(fault) = fault {
            fixture.provider.inject(fault);
        }
        let installation = fixture.base.0.clone();
        let moved = installation.with_extension("moved");
        let hook = failing_and_moving(total, installation.clone(), moved.clone());
        outcomes.push(renewal_watched(&mut fixture, hook));
        fs::rename(&moved, &installation).unwrap();
        committed.push(fixture.committed(OWNER).map(|m| m.lease_expires_unix_ms));
    }
    assert_eq!(
        (outcomes, committed),
        (
            vec![Err(ConversionError::NotAdmitted); 2],
            vec![Ok(Some(RENEWED_EXPIRY)); 2]
        )
    );
}

#[test]
fn a_spent_session_in_convert_does_not_claim_there_is_nothing_to_enter() {
    let total = renewal_reads(None);
    let mut fixture = Fixture::bound(&with_extent(phase_code::CONVERT));
    let mut watched = WatchedFs {
        on_read: failing_nth_read(total),
    };
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    let spent = session.renew_lease(&mut watched, &mut fixture.provider, RENEWED_EXPIRY);
    let entered = session.enter_convert(&mut StdFs, &mut fixture.provider);
    let is_unreadable = matches!(spent, Err(ConversionError::Unreadable(_)));
    assert_eq!(
        (is_unreadable, entered),
        (true, Err(ConversionError::Spent))
    );
}

#[test]
fn a_no_op_enter_convert_is_not_answered_from_a_snapshot_another_owner_overtook() {
    let committed = with_extent(phase_code::CONVERT);
    let mut fixture = Fixture::bound(&committed);
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    fixture.take_over(&committed);
    let before = fixture.snapshot();
    let first = session.enter_convert(&mut StdFs, &mut fixture.provider);
    let later = session.enter_convert(&mut StdFs, &mut fixture.provider);
    assert_eq!(
        (first, later, fixture.snapshot() == before),
        (
            Err(ConversionError::Superseded),
            Err(ConversionError::Spent),
            true
        )
    );
}

#[cfg(unix)]
#[test]
fn an_admission_lost_after_a_refusal_that_left_a_candidate_is_reported_first() {
    // The anchor refuses the root's preparation: the renewal is already in the journal as revision
    // `r + 1`, the root still names `r`, and the step reports a refusal. The installation is moved away
    // right after the last read, so the loss is reported instead of the refusal.
    let refusal = Fault::BeforePersist(AnchorOp::Prepare);
    let total = renewal_reads(Some(refusal));
    let mut fixture = Fixture::bound(&manifest(phase_code::ADMIT));
    fixture.provider.inject(refusal);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let mut seen = 0;
    let outcome = renewal_watched(&mut fixture, |_| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
        }
        Ok(())
    });
    fs::rename(&moved, &installation).unwrap();
    let candidate = generation_path(&fixture.journal_dir(), REVISION + 1).exists();
    assert_eq!(
        (outcome, candidate),
        (Err(ConversionError::NotAdmitted), true)
    );
}

/// Which authenticated read of the inventory a test performs.
#[cfg(unix)]
#[derive(Clone, Copy)]
enum InventoryRead {
    Verify,
    Page,
}

/// One authenticated read over `fixture`, with `on_read` told of every read it makes.
#[cfg(unix)]
fn inventory_read_watched<H: FnMut(&Path) -> io::Result<()>>(
    fixture: &Fixture,
    read: InventoryRead,
    on_read: H,
) -> Result<(), ConversionError> {
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(fixture, &paths, &mut held);
    let mut watched = WatchedFs { on_read };
    match read {
        InventoryRead::Verify => session.verify_inventory(&mut watched, &fixture.provider),
        InventoryRead::Page => {
            session
                .verify_inventory(&mut StdFs, &fixture.provider)
                .unwrap();
            session.page(&mut watched, &fixture.provider, 0).map(|_| ())
        }
    }
}

#[cfg(unix)]
#[test]
fn an_inventory_read_that_loses_the_admission_is_not_returned() {
    // The read is deterministic, so a first run counts its reads and a second run moves the installation
    // away right after the last one: only the check after the read sees it.
    let mut outcomes = Vec::new();
    for read in [InventoryRead::Verify, InventoryRead::Page] {
        let mut total = 0;
        inventory_read_watched(&Fixture::bound_with_inventory(10, 6), read, |_| {
            total += 1;
            Ok(())
        })
        .unwrap();
        let fixture = Fixture::bound_with_inventory(10, 6);
        let installation = fixture.base.0.clone();
        let moved = installation.with_extension("moved");
        let mut seen = 0;
        let outcome = inventory_read_watched(&fixture, read, |_| {
            seen += 1;
            if seen == total {
                fs::rename(&installation, &moved).unwrap();
            }
            Ok(())
        });
        fs::rename(&moved, &installation).unwrap();
        outcomes.push(outcome);
    }
    assert_eq!(outcomes, vec![Err(ConversionError::NotAdmitted); 2]);
}

#[cfg(unix)]
#[test]
fn a_failed_inventory_read_under_a_lost_admission_reports_the_loss() {
    // The last read fails at the same moment the installation is moved away: the loss is reported, not
    // the read error.
    let mut outcomes = Vec::new();
    for read in [InventoryRead::Verify, InventoryRead::Page] {
        let mut total = 0;
        inventory_read_watched(&Fixture::bound_with_inventory(10, 6), read, |_| {
            total += 1;
            Ok(())
        })
        .unwrap();
        let fixture = Fixture::bound_with_inventory(10, 6);
        let installation = fixture.base.0.clone();
        let moved = installation.with_extension("moved");
        let hook = failing_and_moving(total, installation.clone(), moved.clone());
        outcomes.push(inventory_read_watched(&fixture, read, hook));
        fs::rename(&moved, &installation).unwrap();
    }
    assert_eq!(outcomes, vec![Err(ConversionError::NotAdmitted); 2]);
}

/// A conversion step that records the entries it is handed, and fails once on demand.
struct Recorder {
    seen: Vec<JournalInventoryEntry>,
    fences: Vec<MigrationFence>,
    calls: usize,
    fail_on_call: Option<usize>,
}

impl Recorder {
    fn new() -> Self {
        Recorder {
            seen: Vec::new(),
            fences: Vec::new(),
            calls: 0,
            fail_on_call: None,
        }
    }

    fn failing_on_call(call: usize) -> Self {
        Recorder {
            fail_on_call: Some(call),
            ..Recorder::new()
        }
    }
}

impl EntryStep for Recorder {
    type Error = &'static str;

    fn convert(
        &mut self,
        entry: &JournalInventoryEntry,
        fence: &MigrationFence,
    ) -> Result<(), &'static str> {
        let call = self.calls;
        self.calls += 1;
        if self.fail_on_call == Some(call) {
            return Err("injected");
        }
        self.seen.push(entry.clone());
        self.fences.push(*fence);
        Ok(())
    }
}

/// Every entry of the stored inventory, in order.
fn all_entries(count: u32, per_page: usize) -> Vec<JournalInventoryEntry> {
    let pages = pages_of(count, per_page, REVISION);
    pages
        .iter()
        .flat_map(|page| page.entries().to_vec())
        .collect()
}

/// A session over `fixture`'s installation that has authenticated the inventory and is in `CONVERT`.
fn converting<'a>(
    fixture: &mut Fixture,
    paths: &'a Paths,
    held: &'a mut ExclusiveAdmissionGuard,
) -> ConversionSession<'a> {
    let mut session = open(fixture, paths, held);
    session
        .verify_inventory(&mut StdFs, &fixture.provider)
        .unwrap();
    session
        .enter_convert(&mut StdFs, &mut fixture.provider)
        .unwrap();
    session
}

/// One `convert_next` call of `entries` entries over the real file system.
fn convert_once(
    session: &mut ConversionSession<'_>,
    fixture: &mut Fixture,
    recorder: &mut Recorder,
    entries: u32,
) -> Result<Progress, ConvertError<&'static str>> {
    let batch = ConvertBatch {
        step: recorder,
        entries: NonZeroU32::new(entries).unwrap(),
    };
    session.convert_next(&mut StdFs, &mut fixture.provider, batch)
}

/// The progress and the cursor after each call, until `Done`.
fn run_to_done(
    session: &mut ConversionSession<'_>,
    fixture: &mut Fixture,
    recorder: &mut Recorder,
    entries: u32,
) -> Vec<(Progress, (u32, u32))> {
    let mut rounds = Vec::new();
    loop {
        let progress = convert_once(session, fixture, recorder, entries).unwrap();
        let manifest = session.manifest();
        rounds.push((
            progress,
            (manifest.cursor_page_index, manifest.cursor_entry_index),
        ));
        if progress == Progress::Done {
            return rounds;
        }
    }
}

#[test]
fn a_whole_run_converts_every_entry_once_in_order_and_leaves_convert() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (rounds, again, phase) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let rounds = run_to_done(&mut session, &mut fixture, &mut recorder, 4);
        // A session that has seen the end converts nothing more.
        let again = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        let manifest = session.manifest();
        let phase = (
            manifest.phase,
            manifest.cursor_page_index,
            manifest.cursor_entry_index,
        );
        (rounds, again, phase)
    };
    // Batches of four over pages of six and four never cross a page boundary: 0..4, 4..6, 6..10.
    let expected_rounds = vec![
        (Progress::More, (0, 4)),
        (Progress::More, (1, 0)),
        (Progress::Done, (1, 3)),
    ];
    assert_eq!((rounds, again), (expected_rounds, Ok(Progress::Done)));
    assert!(recorder.seen == all_entries(10, 6));
    assert_eq!(phase, (phase_code::VERIFY, 0, 0));
    // The root names `VERIFY`, which the conversion gate does not admit.
    assert_eq!(
        fixture.committed(OWNER),
        Err(ConversionError::PhaseNotConvertible)
    );
}

#[test]
fn a_batch_of_one_checkpoints_after_every_entry_and_writes_nothing_when_the_cursor_stays() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (cursors, revision) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let rounds = run_to_done(&mut session, &mut fixture, &mut recorder, 1);
        let cursors: Vec<_> = rounds.iter().map(|round| round.1).collect();
        (cursors, session.manifest().journal_revision)
    };
    let expected = vec![
        (0, 1),
        (0, 2),
        (0, 3),
        (0, 4),
        (0, 5),
        (1, 0),
        (1, 1),
        (1, 2),
        (1, 3),
        // The last entry leaves the cursor on itself: no checkpoint is written for it.
        (1, 3),
    ];
    assert_eq!(cursors, expected);
    // `CONVERT` entered, then nine checkpoints.
    assert_eq!(revision, REVISION + 1 + 9);
    assert!(recorder.seen == all_entries(10, 6));
}

#[test]
fn a_failing_step_writes_nothing_and_a_restart_resumes_at_the_persisted_cursor() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut first = Recorder::failing_on_call(7);
    let (failure, before, after) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        // 0..4 and 4..6 are converted and checkpointed; the batch 6..10 fails on its second entry.
        convert_once(&mut session, &mut fixture, &mut first, 4).unwrap();
        convert_once(&mut session, &mut fixture, &mut first, 4).unwrap();
        let before = fixture.snapshot();
        let failure = convert_once(&mut session, &mut fixture, &mut first, 4);
        (failure, before, fixture.snapshot())
    };
    assert_eq!(
        (failure, before == after),
        (Err(ConvertError::Step("injected")), true)
    );
    // The process dies here; a new session resumes from the cursor the root holds, `(1, 0)`.
    let mut second = Recorder::new();
    let phase = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let rounds = run_to_done(&mut session, &mut fixture, &mut second, 4);
        assert_eq!(rounds, vec![(Progress::Done, (1, 3))]);
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        session.manifest().phase
    };
    let all = all_entries(10, 6);
    // Entries 0..6 were converted once before the crash and not again; 6 (done before the failure) again.
    assert!(first.seen == all[..7]);
    assert!(second.seen == all[6..]);
    assert_eq!(phase, phase_code::VERIFY);
}

#[test]
fn a_failed_checkpoint_leaves_the_batch_to_be_converted_again_on_retry() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (failed, kept, rounds) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        // The anchor refuses the root's preparation: the first batch is converted but not recorded.
        fixture
            .provider
            .inject(Fault::BeforePersist(AnchorOp::Prepare));
        let failed = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        let kept = session.manifest().cursor_entry_index;
        let rounds = run_to_done(&mut session, &mut fixture, &mut recorder, 4);
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        (failed, kept, rounds.len())
    };
    assert!(matches!(
        failed,
        Err(ConvertError::Session(ConversionError::Authority(_)))
    ));
    // The cursor stayed where it was, and the retry converted entries 0..4 a second time.
    let all = all_entries(10, 6);
    let mut expected = all[..4].to_vec();
    expected.extend(all.iter().cloned());
    assert_eq!((kept, rounds), (0, 3));
    assert!(recorder.seen == expected);
}

#[test]
fn leaving_convert_early_or_converting_in_the_wrong_phase_is_refused() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
    let mut session = open(&fixture, &paths, &mut held);
    // `ADMIT`: neither the iteration nor the exit exists yet.
    let converted = convert_once(&mut session, &mut fixture, &mut recorder, 4);
    let finished = session.finish_convert(&mut StdFs, &mut fixture.provider);
    session
        .enter_convert(&mut StdFs, &mut fixture.provider)
        .unwrap();
    // `CONVERT` without the verified inventory.
    let unverified = convert_once(&mut session, &mut fixture, &mut recorder, 4);
    session
        .verify_inventory(&mut StdFs, &fixture.provider)
        .unwrap();
    convert_once(&mut session, &mut fixture, &mut recorder, 4).unwrap();
    // Not at the end yet.
    let early = session.finish_convert(&mut StdFs, &mut fixture.provider);
    assert_eq!(
        (
            converted,
            finished.map(|_| ()),
            unverified,
            early.map(|_| ())
        ),
        (
            Err(ConvertError::Session(ConversionError::WrongPhase)),
            Err(ConversionError::WrongPhase),
            Err(ConvertError::Session(ConversionError::InventoryNotVerified)),
            Err(ConversionError::NotConverted)
        )
    );
}

#[test]
fn an_empty_inventory_is_done_at_once_and_leaves_convert() {
    let mut fixture = Fixture::bound_with_inventory(0, 6);
    let mut recorder = Recorder::new();
    let (progress, phase) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let progress = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        (progress, session.manifest().phase)
    };
    assert_eq!(
        (progress, recorder.calls, phase),
        (Ok(Progress::Done), 0, phase_code::VERIFY)
    );
}

#[test]
fn the_last_entry_is_converted_again_after_a_crash_that_followed_it() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        run_to_done(&mut session, &mut fixture, &mut Recorder::new(), 4);
        // The process dies before `finish_convert`.
    }
    let mut recorder = Recorder::new();
    let (progress, phase) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let progress = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .unwrap();
        (progress, session.manifest().phase)
    };
    // The cursor rests on the last entry, which is all the new session converts.
    assert!(recorder.seen == all_entries(10, 6)[9..]);
    assert_eq!((progress, phase), (Ok(Progress::Done), phase_code::VERIFY));
}

#[test]
fn moving_the_cursor_by_hand_forfeits_the_exit() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (converted, finished_early, after_done) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        // Jumping to the last entry would make one `convert_next` look like the end of a whole walk.
        let last = JournalCheckpointCursor::new(1, 3);
        session
            .advance_cursor(&mut StdFs, &mut fixture.provider, last)
            .unwrap();
        let converted = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        let finished_early = session.finish_convert(&mut StdFs, &mut fixture.provider);
        (converted, finished_early.map(|_| ()), recorder.calls)
    };
    assert_eq!(
        (converted, finished_early, after_done),
        (
            Err(ConvertError::Session(ConversionError::CursorMoved)),
            Err(ConversionError::NotConverted),
            0
        )
    );
}

#[test]
fn moving_the_cursor_by_hand_after_the_end_takes_the_exit_away_again() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let finished = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        run_to_done(&mut session, &mut fixture, &mut recorder, 4);
        // Even a checkpoint at the cursor it already has counts as moving it by hand.
        let same = JournalCheckpointCursor::new(1, 3);
        session
            .advance_cursor(&mut StdFs, &mut fixture.provider, same)
            .unwrap();
        session
            .finish_convert(&mut StdFs, &mut fixture.provider)
            .map(|_| ())
    };
    assert_eq!(finished, Err(ConversionError::NotConverted));
}

#[test]
fn a_persisted_cursor_outside_its_page_is_refused_instead_of_slicing_past_it() {
    // `(0, 9)` is inside the manifest's ten entries but outside page 0, which holds six.
    let mut fixture = Fixture::bound_with_inventory_and(10, 6, |manifest| {
        manifest.phase = phase_code::CONVERT;
        (manifest.cursor_page_index, manifest.cursor_entry_index) = (0, 9);
    });
    let mut recorder = Recorder::new();
    let (outcome, before, after) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let before = fixture.snapshot();
        let outcome = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        (outcome, before, fixture.snapshot())
    };
    let refusal = ConversionError::Migration(MigrationExecutionError::Journal(
        JournalError::EntryCountMismatch,
    ));
    assert_eq!(
        (outcome, recorder.calls, before == after),
        (Err(ConvertError::Session(refusal)), 0, true)
    );
}

#[test]
fn no_entry_is_handed_out_for_a_snapshot_another_owner_overtook() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    let (first, later) = {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        let converting = session.manifest().clone();
        fixture.take_over(&converting);
        let first = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        let later = convert_once(&mut session, &mut fixture, &mut recorder, 4);
        (first, later)
    };
    // The step never ran, and the session is spent.
    assert_eq!(
        (first, later, recorder.calls),
        (
            Err(ConvertError::Session(ConversionError::Superseded)),
            Err(ConvertError::Session(ConversionError::Spent)),
            0
        )
    );
}

#[test]
fn the_step_is_handed_the_fence_the_session_holds() {
    let mut fixture = Fixture::bound_with_inventory(10, 6);
    let mut recorder = Recorder::new();
    {
        let (paths, mut held) = (fixture.paths(), fixture.paths().admission());
        let mut session = converting(&mut fixture, &paths, &mut held);
        run_to_done(&mut session, &mut fixture, &mut recorder, 4);
    }
    // One token per entry: the batches of 0..4, 4..6 and 6..10 ran at the revisions after entering
    // `CONVERT` and after each checkpoint, all under the owner's fencing generation.
    let revisions: Vec<u64> = recorder
        .fences
        .iter()
        .map(|fence| fence.journal_revision)
        .collect();
    let generations: Vec<u64> = recorder
        .fences
        .iter()
        .map(|fence| fence.fencing_generation)
        .collect();
    let base = REVISION + 1;
    let expected_revisions = vec![
        base,
        base,
        base,
        base,
        base + 1,
        base + 1,
        base + 2,
        base + 2,
        base + 2,
        base + 2,
    ];
    assert_eq!(
        (revisions, generations),
        (expected_revisions, vec![FENCE; 10])
    );
}
