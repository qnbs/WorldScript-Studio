//! Gate 4D C2a: the entry gate of the exclusive conversion driver (§10.3 `ADMIT`, `CONVERT`). The gate
//! needs the installation's exclusive admission, re-reads the journal the committed root vouches for
//! and refuses anything but the owner's conversion; it writes nothing. Every scenario therefore
//! commits a real root that binds a real journal.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::{
    begin_conversion, commit_catalog_change, commit_root, content_digest, empty_inventory_digest,
    empty_journal_page_set_digest, generation_path, load_catalog, operation_type, phase_code,
    write_key_epoch, AdmissionScope, AuthorityError, CatalogChange, CatalogCommit, ConversionBegin,
    ConversionError, DirectoryDurability, DurableFs, ExclusiveAdmissionGuard, InstallationScopeId,
    JournalDurableError, JournalManifest, JournalRouteError, JournalSource, Key, KeyEpochCommit,
    KeyEpochRecord, KeyEpochStatus, KeyProvider, LiveMigration, MigrationExecutionError,
    MigrationFence, RecordClass, RecordIdentity, RecordMeta, RootBody, RootCommitEvidence,
    RootCommitGuard, RootCommitRequest, RootCommitState, RootKeyRefV1, RootLayout, StdFs,
    WriteOperationId, JOURNAL_MANIFEST_RECORD_SCHEMA, OPERATION_ADMISSION_LOCK_FILE,
};

const OPERATION: &str = "conversion-op";
const OWNER: &str = "owner-a";
const REVISION: u64 = 3;
const FENCE: u64 = 4;
/// A lease long past its expiry: the gate reads no clock, so it is still the owner's.
const LEASE_EXPIRY: u64 = 1_000;
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

    /// The gate as `owner` under this installation's own admission, over the real file system.
    fn begin(&self, owner: &str) -> Result<(), ConversionError> {
        let paths = self.paths();
        let mut held = paths.admission();
        begin_conversion(&mut held, &mut StdFs, &self.provider, paths.begin(owner)).map(|_| ())
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

/// The real file system, reporting to `on_read` after every read has happened.
struct WatchedFs<H: FnMut(&Path)> {
    on_read: H,
}

impl<H: FnMut(&Path)> DurableFs for WatchedFs<H> {
    type File = File;

    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        let bytes = StdFs.read(path);
        (self.on_read)(path);
        bytes
    }

    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        let bytes = StdFs.read_at_most(path, limit);
        (self.on_read)(path);
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
fn begin_watched<H: FnMut(&Path)>(
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
    let outcome = begin_watched(&fixture, &mut other.paths().admission(), |_| reads += 1);
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
    begin_watched(&counted, &mut counted.paths().admission(), |_| total += 1).unwrap();
    let fixture = Fixture::bound(&committed);
    let installation = fixture.base.0.clone();
    let moved = installation.with_extension("moved");
    let mut seen = 0;
    let outcome = begin_watched(&fixture, &mut fixture.paths().admission(), |_| {
        seen += 1;
        if seen == total {
            fs::rename(&installation, &moved).unwrap();
        }
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
