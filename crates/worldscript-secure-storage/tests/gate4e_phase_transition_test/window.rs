//! Gate 4E W1: the `PREPARE`/`DONE` window. A storage that was handed the locator of its journal admits
//! the ordinary operations over a bound root only while the authenticated journal is in `PREPARE` or
//! `DONE` and binds exactly what the root binds; in every other case the root-bound barrier of E1
//! stands and the refusal writes nothing.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use worldscript_secure_storage::commit::RecordLocation;
use worldscript_secure_storage::memory_provider::{AnchorOp, Fault};
use worldscript_secure_storage::provider::SessionBinding;
use worldscript_secure_storage::{
    EpochInfo, JournalLocator, Key, KeyProviderError, KeyState, OperationError, PrepareRootAnchor,
    ProtectedCommitted, ProtectedError, ProtectedMutation, ProtectedRead, ProtectedRecord,
    ProtectedStorage, ProtectedWrite, RecordClass, RecordIdentity,
};

use super::*;

/// The provider the storage and the fixture share, so that the fixture can read and move the
/// authority while an operation runs. Every call locks only for its own duration.
#[derive(Clone)]
pub(super) struct Shared(Arc<Mutex<MemoryKeyProvider>>);

impl Shared {
    fn new(provider: MemoryKeyProvider) -> Self {
        Shared(Arc::new(Mutex::new(provider)))
    }

    fn inner(&self) -> std::sync::MutexGuard<'_, MemoryKeyProvider> {
        self.0.lock().unwrap()
    }
}

impl KeyProvider for Shared {
    fn state(&self) -> Result<KeyState, KeyProviderError> {
        self.inner().state()
    }
    fn session_binding(&self) -> Option<SessionBinding> {
        self.inner().session_binding()
    }
    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        self.inner().resolve(epoch)
    }
    fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.inner().resolve_ref(key_ref)
    }
    fn lock(&mut self) {
        self.inner().lock();
    }
    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        self.inner().unlock()
    }
    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        self.inner().list_epochs()
    }
    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        self.inner().provision_epoch_key(epoch)
    }
    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        self.inner().read_root_anchor_state()
    }
    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        self.inner().read_or_provision_installation_scope()
    }
    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError> {
        self.inner().prepare_root_anchor(request)
    }
    fn commit_root_anchor(
        &mut self,
        operation_id: &str,
        target_root_generation: u64,
    ) -> Result<(), KeyProviderError> {
        self.inner()
            .commit_root_anchor(operation_id, target_root_generation)
    }
    fn abort_or_recover_root_anchor(&mut self, operation_id: &str) -> Result<(), KeyProviderError> {
        self.inner().abort_or_recover_root_anchor(operation_id)
    }
}

/// A root that binds revision 0 of a journal in `phase`. The journal is promoted as it is; only the
/// phases an ordinary operation must refuse are chosen for their own sake.
pub(super) fn bound_at(phase: u32) -> Bound {
    let mut bound = Bound::unbound();
    bound.zero = JournalManifest {
        final_inventory_captured: phase >= phase_code::CONVERT
            && phase != phase_code::RECOVERY_REQUIRED,
        recovery_reason_code: u32::from(phase == phase_code::RECOVERY_REQUIRED),
        ..manifest_at(0, phase)
    };
    bound.bind_zero();
    bound
}

/// A bound root whose last ordinary catalog commit stopped at the anchor: the preparation is durable
/// and the committed root is still the previous one.
fn bound_with_interrupted_commit(phase: u32, fault: Fault) -> Bound {
    let mut bound = bound_at(phase);
    bound.provider.inject(fault);
    let commit = CatalogCommit {
        change: CatalogChange {
            upsert: &[],
            remove: &[],
        },
        root_key_ref: &bound.key_ref,
        active_key_epoch: 1,
        operation_id: "w1-interrupted",
    };
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    assert!(commit_catalog_change(&mut StdFs, &mut bound.provider, layout, commit).is_err());
    let anchor = bound.provider.read_root_anchor_state().unwrap();
    assert!(
        anchor.prepared_root_commit.is_some(),
        "a durable preparation"
    );
    bound
}

fn locator(bound: &Bound) -> JournalLocator {
    JournalLocator::new(bound.scope.clone(), "journal").unwrap()
}

fn payload_of(read: ProtectedRead) -> Vec<u8> {
    match read {
        ProtectedRead::Record(record) => record.payload.to_vec(),
        _ => panic!("expected an admitted committed record"),
    }
}

/// Polls an operation that answers `None` while another holder is still releasing the admission.
pub(super) fn settled<T>(
    mut operation: impl FnMut() -> Result<Option<T>, OperationError>,
) -> Result<T, OperationError> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match operation()? {
            Some(value) => return Ok(value),
            None if Instant::now() >= deadline => panic!("the operation stayed unadmitted"),
            None => thread::sleep(Duration::from_millis(5)),
        }
    }
}

/// A bound installation behind a `ProtectedStorage` over the shared provider.
pub(super) struct Windowed {
    pub(super) installation: Installation,
    pub(super) provider: Shared,
    pub(super) storage: ProtectedStorage<Shared>,
    #[cfg(unix)]
    pub(super) key_ref: RootKeyRefV1,
    identity: RecordIdentity,
    records: PathBuf,
    markers: PathBuf,
}

impl Windowed {
    pub(super) fn new(bound: Bound, locator: Option<JournalLocator>) -> Self {
        #[cfg(unix)]
        let key_ref = bound.key_ref.clone();
        let Bound {
            installation,
            provider,
            ..
        } = bound;
        let records = installation.base.join("records");
        let markers = installation.base.join("markers");
        for dir in [&records, &markers] {
            fs::create_dir_all(dir).unwrap();
        }
        let provider = Shared::new(provider);
        let mut storage = ProtectedStorage::new(installation.scope(), provider.clone());
        if let Some(locator) = locator {
            storage = storage.with_journal_locator(locator);
        }
        Windowed {
            installation,
            provider,
            storage,
            #[cfg(unix)]
            key_ref,
            identity: RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap(),
            records,
            markers,
        }
    }

    pub(super) fn at(phase: u32) -> Self {
        let bound = bound_at(phase);
        let locator = locator(&bound);
        Self::new(bound, Some(locator))
    }

    fn location(&self) -> RecordLocation<'_> {
        RecordLocation {
            record_dir: &self.records,
            marker_dir: &self.markers,
        }
    }

    pub(super) fn record(&self) -> ProtectedRecord<'_> {
        ProtectedRecord {
            identity: &self.identity,
            location: self.location(),
        }
    }

    pub(super) fn mutation<'a>(
        &'a self,
        expected: Option<u64>,
        plaintext: &'a [u8],
    ) -> ProtectedMutation<'a> {
        ProtectedMutation {
            record: self.record(),
            expected_generation: expected,
            write: ProtectedWrite {
                record_schema: 1,
                plaintext,
            },
        }
    }

    pub(super) fn write(
        &self,
        expected: Option<u64>,
        plaintext: &[u8],
    ) -> Result<ProtectedCommitted, OperationError> {
        let mutation = self.mutation(expected, plaintext);
        settled(|| self.storage.try_write_record(&mut StdFs, mutation))
    }

    pub(super) fn read(&self) -> Result<Vec<u8>, OperationError> {
        settled(|| {
            self.storage
                .try_read_record(&mut StdFs, self.record(), payload_of)
        })
    }

    pub(super) fn list(&self) -> Result<usize, OperationError> {
        settled(|| self.storage.try_list_records(&mut StdFs)).map(|listed| listed.len())
    }

    pub(super) fn reconcile(&self) -> Result<(), OperationError> {
        settled(|| {
            self.storage
                .try_reconcile_record(&mut StdFs, &self.identity, self.location())
        })
        .map(|_| ())
    }

    /// The four ordinary data operations, in one row.
    fn outcomes(&self) -> [Result<(), OperationError>; 4] {
        [
            self.write(None, b"v").map(|_| ()),
            self.read().map(|_| ()),
            self.list().map(|_| ()),
            self.reconcile(),
        ]
    }

    /// What a refused operation must leave as it was: every file below the root, the journal, the
    /// records and the markers.
    pub(super) fn tree(&self) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        for (prefix, dir) in [
            ("root", &self.installation.root_dir),
            ("journal", &self.installation.journal_dir),
            ("records", &self.records),
            ("markers", &self.markers),
        ] {
            tree_below(dir, prefix, &mut out);
        }
        out
    }

    fn journal_tree(&self) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        tree_below(&self.installation.journal_dir, "journal", &mut out);
        out
    }

    pub(super) fn root(&self) -> RootBody {
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        load_catalog(&mut StdFs, &self.provider, layout)
            .unwrap()
            .unwrap()
            .root
    }

    /// The manifest the committed root names.
    pub(super) fn committed(&self) -> JournalManifest {
        let live = self.root().live_migration.unwrap();
        let operation = WriteOperationId::generate().unwrap();
        let key = journal_key();
        let mut fs = StdFs;
        let mut ctx =
            JournalDurableContext::new(&mut fs, &key, &self.installation.journal_dir, &operation);
        load_authoritative_manifest(&mut ctx, &live).unwrap()
    }
}

const ADMITTED: [u32; 2] = [phase_code::PREPARE, phase_code::DONE];
const BARRED: [u32; 9] = [
    phase_code::BOOTSTRAP_TARGET,
    phase_code::DISCOVER,
    phase_code::ADMIT,
    phase_code::CONVERT,
    phase_code::VERIFY,
    phase_code::COMMIT,
    phase_code::RETIRE_OLD_AUTHORITY,
    phase_code::FINALIZE,
    phase_code::RECOVERY_REQUIRED,
];

const REFUSED: [Result<(), OperationError>; 4] = [
    Err(OperationError::MigrationRequired),
    Err(OperationError::MigrationRequired),
    Err(OperationError::MigrationRequired),
    Err(OperationError::MigrationRequired),
];

#[test]
fn without_a_locator_the_barrier_stands_in_every_phase() {
    for phase in ADMITTED.into_iter().chain(BARRED) {
        let windowed = Windowed::new(bound_at(phase), None);
        let before = windowed.tree();
        assert_eq!(windowed.outcomes(), REFUSED, "phase {phase}");
        assert_eq!(windowed.tree(), before, "phase {phase}");
    }
}

#[test]
fn the_window_admits_every_ordinary_operation_in_prepare_and_in_done() {
    for phase in ADMITTED {
        let windowed = Windowed::at(phase);
        let binding = windowed.root().live_migration.unwrap();
        let manifest = windowed.committed();
        let journal = windowed.journal_tree();
        let first = windowed.write(None, b"first").unwrap();
        assert_eq!(first.generation, 1, "phase {phase}");
        assert_eq!(windowed.read().unwrap(), b"first");
        assert_eq!(windowed.list().unwrap(), 1);
        let second = windowed.write(Some(1), b"second").unwrap();
        assert_eq!(second.generation, 2);
        assert_eq!(windowed.read().unwrap(), b"second");
        windowed.reconcile().unwrap();
        // Every ordinary root copied the binding forward, and nothing of the journal moved.
        let root = windowed.root();
        assert_eq!(root.live_migration, Some(binding), "phase {phase}");
        assert!(root.root_generation > first.root_generation);
        assert_eq!(windowed.journal_tree(), journal, "phase {phase}");
        assert_eq!(windowed.committed(), manifest, "phase {phase}");
    }
}

#[test]
fn a_prepared_root_left_by_a_crash_is_recovered_by_a_write_and_the_window_reopens() {
    for (label, fault) in [
        ("completed", Fault::BeforePersist(AnchorOp::Commit)),
        ("discarded", Fault::AfterPersist(AnchorOp::Prepare)),
    ] {
        let bound = bound_with_interrupted_commit(phase_code::PREPARE, fault);
        let locator = locator(&bound);
        let windowed = Windowed::new(bound, Some(locator));
        let committed = windowed
            .write(None, b"after the crash")
            .map(|done| done.generation);
        assert_eq!(committed, Ok(1), "{label}");
        assert_eq!(windowed.read().unwrap(), b"after the crash", "{label}");
    }
}

#[test]
fn a_busy_root_event_is_an_error_to_retry_and_never_the_none_of_a_pre_observation_contention() {
    let windowed = Windowed::at(phase_code::PREPARE);
    let held = RootCommitGuard::acquire(&windowed.installation.root_dir).unwrap();
    let busy = windowed
        .storage
        .try_authority_snapshot(&mut StdFs)
        .map(|_| ());
    assert_eq!(
        busy,
        Err(OperationError::Protected(ProtectedError::RootBusy))
    );
    drop(held);
    assert_eq!(windowed.list(), Ok(0));
}

#[test]
fn every_other_phase_keeps_the_barrier_and_writes_nothing() {
    for phase in BARRED {
        let windowed = Windowed::at(phase);
        let before = windowed.tree();
        assert_eq!(windowed.outcomes(), REFUSED, "phase {phase}");
        assert_eq!(windowed.tree(), before, "phase {phase}");
    }
}

/// A locator that cannot lead to the journal the root binds leaves the barrier standing.
fn refused_with(bound: Bound, locator: JournalLocator, label: &str) {
    let windowed = Windowed::new(bound, Some(locator));
    let before = windowed.tree();
    assert_eq!(windowed.outcomes(), REFUSED, "{label}");
    assert_eq!(windowed.tree(), before, "{label}");
}

#[test]
fn a_locator_that_leads_nowhere_keeps_the_barrier() {
    let bound = bound_at(phase_code::PREPARE);
    let foreign = MemoryKeyProvider::new()
        .read_or_provision_installation_scope()
        .unwrap();
    let wrong_scope = JournalLocator::new(foreign, "journal").unwrap();
    refused_with(bound, wrong_scope, "a locator of another installation");
    for (name, label) in [
        ("no-such-journal", "a name with nothing behind it"),
        ("authority", "the authority root itself"),
        ("records", "a directory that holds no journal"),
    ] {
        let bound = bound_at(phase_code::PREPARE);
        let locator = JournalLocator::new(bound.scope.clone(), name).unwrap();
        refused_with(bound, locator, label);
    }
}

#[cfg(unix)]
#[test]
fn a_symlink_in_place_of_the_journal_directory_keeps_the_barrier() {
    let bound = bound_at(phase_code::PREPARE);
    let moved = bound.installation.base.join("moved-journal");
    fs::rename(&bound.installation.journal_dir, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &bound.installation.journal_dir).unwrap();
    let locator = locator(&bound);
    refused_with(bound, locator, "a symlink at the located name");
}

#[test]
fn a_journal_that_does_not_authenticate_keeps_the_barrier() {
    let bound = bound_at(phase_code::PREPARE);
    let generation = generation_path(&bound.installation.journal_dir, 0);
    let mut bytes = fs::read(&generation).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    fs::write(&generation, bytes).unwrap();
    let locator = locator(&bound);
    refused_with(bound, locator, "a manifest with a changed byte");
}

#[test]
fn an_operation_in_the_window_holds_the_shared_admission_so_no_phase_change_can_start() {
    let windowed = Windowed::at(phase_code::PREPARE);
    let guard = settled(|| windowed.storage.try_authority_snapshot(&mut StdFs)).unwrap();
    assert!(
        ExclusiveAdmissionGuard::try_acquire(windowed.installation.scope())
            .unwrap()
            .is_none()
    );
    drop(guard);
    assert!(
        ExclusiveAdmissionGuard::try_acquire(windowed.installation.scope())
            .unwrap()
            .is_some()
    );
}

#[test]
fn a_window_guard_reads_and_lists_under_the_binding_it_was_admitted_for() {
    let windowed = Windowed::at(phase_code::PREPARE);
    windowed.write(None, b"kept").unwrap();
    let mut guard = settled(|| windowed.storage.try_authority_snapshot(&mut StdFs)).unwrap();
    assert_eq!(guard.list_records(&mut StdFs).unwrap().len(), 1);
    let read = guard
        .read_record(&mut StdFs, windowed.record(), payload_of)
        .unwrap();
    assert_eq!(read, b"kept");
}
