//! Gate 4E W1: the `PREPARE`/`DONE` window. A storage that was handed the locator of its journal admits
//! the ordinary operations over a bound root only while the authenticated journal is in `PREPARE` or
//! `DONE` and binds exactly what the root binds; in every other case the root-bound barrier of E1
//! stands and the refusal writes nothing.

#[cfg(unix)]
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use worldscript_secure_storage::commit::RecordLocation;
use worldscript_secure_storage::provider::SessionBinding;
use worldscript_secure_storage::{
    EpochInfo, JournalLocator, Key, KeyProviderError, KeyState, OperationError, PrepareRootAnchor,
    ProtectedCommitted, ProtectedMutation, ProtectedRead, ProtectedRecord, ProtectedStorage,
    ProtectedWrite, RecordClass, RecordIdentity,
};

use super::*;

/// The provider the storage and the fixture share, so that the fixture can read and move the
/// authority while an operation runs. Every call locks only for its own duration.
#[derive(Clone)]
struct Shared(Arc<Mutex<MemoryKeyProvider>>);

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
fn bound_at(phase: u32) -> Bound {
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
fn settled<T>(
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
struct Windowed {
    installation: Installation,
    provider: Shared,
    storage: ProtectedStorage<Shared>,
    #[cfg(unix)]
    key_ref: RootKeyRefV1,
    identity: RecordIdentity,
    records: PathBuf,
    markers: PathBuf,
}

impl Windowed {
    fn new(bound: Bound, locator: Option<JournalLocator>) -> Self {
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

    fn at(phase: u32) -> Self {
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

    fn record(&self) -> ProtectedRecord<'_> {
        ProtectedRecord {
            identity: &self.identity,
            location: self.location(),
        }
    }

    fn write(
        &self,
        expected: Option<u64>,
        plaintext: &[u8],
    ) -> Result<ProtectedCommitted, OperationError> {
        let mutation = ProtectedMutation {
            record: self.record(),
            expected_generation: expected,
            write: ProtectedWrite {
                record_schema: 1,
                plaintext,
            },
        };
        settled(|| self.storage.try_write_record(&mut StdFs, mutation))
    }

    fn read(&self) -> Result<Vec<u8>, OperationError> {
        settled(|| {
            self.storage
                .try_read_record(&mut StdFs, self.record(), payload_of)
        })
    }

    fn list(&self) -> Result<usize, OperationError> {
        settled(|| self.storage.try_list_records(&mut StdFs)).map(|listed| listed.len())
    }

    fn reconcile(&self) -> Result<(), OperationError> {
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
    fn tree(&self) -> BTreeMap<String, Vec<u8>> {
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

    fn root(&self) -> RootBody {
        let layout = RootLayout {
            root_dir: &self.installation.root_dir,
        };
        load_catalog(&mut StdFs, &self.provider, layout)
            .unwrap()
            .unwrap()
            .root
    }

    /// The manifest the committed root names.
    fn committed(&self) -> JournalManifest {
        let live = self.root().live_migration.unwrap();
        let operation = WriteOperationId::generate().unwrap();
        let key = journal_key();
        let mut fs = StdFs;
        let mut ctx =
            JournalDurableContext::new(&mut fs, &key, &self.installation.journal_dir, &operation);
        load_authoritative_manifest(&mut ctx, &live).unwrap()
    }
}

/// The journal owner's progress checkpoint: the next revision, the same phase, no admission.
#[cfg(unix)]
fn progress_checkpoint(
    mut provider: Shared,
    root_dir: PathBuf,
    journal_dir: PathBuf,
    key_ref: RootKeyRefV1,
    next: JournalManifest,
) {
    let fence = MigrationFence::from_manifest(&next);
    let operation = WriteOperationId::generate().unwrap();
    let journal = JournalSource {
        dir: &journal_dir,
        operation: &operation,
    };
    let checkpoint = checkpoint_of(journal, &key_ref, &next, &fence);
    let layout = RootLayout {
        root_dir: &root_dir,
    };
    commit_journal_checkpoint(&mut StdFs, &mut provider, layout, checkpoint).unwrap();
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

/// An action for `FaultyFs` that runs the journal owner's progress checkpoint on another thread and waits
/// for it, so the checkpoint lands exactly between two reads. The flag says whether it finished in time,
/// which it cannot while the operation itself holds the root event.
#[cfg(unix)]
fn owner_progresses(windowed: &Windowed) -> (impl FnMut() + 'static, Arc<AtomicBool>) {
    use std::sync::atomic::Ordering;
    use std::sync::mpsc;

    let finished = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&finished);
    let provider = windowed.provider.clone();
    let root_dir = windowed.installation.root_dir.clone();
    let journal_dir = windowed.installation.journal_dir.clone();
    let key_ref = windowed.key_ref.clone();
    let next = progressing(&windowed.committed());
    let action = move || {
        let (sender, receiver) = mpsc::channel();
        let (provider, root_dir) = (provider.clone(), root_dir.clone());
        let (journal_dir, key_ref, next) = (journal_dir.clone(), key_ref.clone(), next.clone());
        thread::spawn(move || {
            progress_checkpoint(provider, root_dir, journal_dir, key_ref, next);
            let _ = sender.send(());
        });
        if receiver.recv_timeout(Duration::from_secs(30)).is_ok() {
            flag.store(true, Ordering::SeqCst);
        }
    };
    (action, finished)
}

/// A binding that moved after the snapshot was taken and before the journal was read is not the binding
/// the operation holds: the window is not opened for that operation, and the next one is admitted.
#[cfg(unix)]
#[test]
fn a_binding_that_moved_before_the_journal_was_read_keeps_the_barrier_for_that_operation() {
    use std::sync::atomic::Ordering;

    use super::faulty_fs::FaultyFs;

    // The reads of a capture up to the point where the journal would be read are those of a storage
    // that has no locator.
    let plain = Windowed::new(bound_at(phase_code::PREPARE), None);
    let mut observing = FaultyFs::observing();
    drop(settled(|| plain.storage.try_authority_snapshot(&mut observing)).unwrap());
    let before_the_journal = observing.served();
    assert!(before_the_journal > 0);

    let windowed = Windowed::at(phase_code::PREPARE);
    let (action, finished) = owner_progresses(&windowed);
    let mut fs = FaultyFs::acting_after_served_reads(before_the_journal, action);
    let mut guard = settled(|| windowed.storage.try_authority_snapshot(&mut fs)).unwrap();
    assert!(
        finished.load(Ordering::SeqCst),
        "the checkpoint landed between two reads"
    );
    assert_eq!(
        guard.list_records(&mut StdFs).map(|_| ()),
        Err(OperationError::MigrationRequired)
    );
    drop(guard);
    assert_eq!(windowed.committed().journal_revision, 1);
    assert_eq!(windowed.list(), Ok(0));
}

/// The write repeats the verdict right before its first root commit: a binding that moved in between
/// refuses it, and nothing of the record or its marker exists afterwards.
#[cfg(unix)]
#[test]
fn a_write_whose_binding_moved_before_its_first_commit_is_refused_and_writes_nothing() {
    use std::sync::atomic::Ordering;

    use super::faulty_fs::FaultyFs;

    // A write reads what a snapshot and the listing of its catalog read before it revalidates.
    let calibration = Windowed::at(phase_code::PREPARE);
    let mut observing = FaultyFs::observing();
    let mut guard = settled(|| calibration.storage.try_authority_snapshot(&mut observing)).unwrap();
    guard.list_records(&mut observing).unwrap();
    drop(guard);
    let before_revalidation = observing.served();

    let windowed = Windowed::at(phase_code::PREPARE);
    let (action, finished) = owner_progresses(&windowed);
    let mut fs = FaultyFs::acting_after_served_reads(before_revalidation, action);
    let mutation = ProtectedMutation {
        record: windowed.record(),
        expected_generation: None,
        write: ProtectedWrite {
            record_schema: 1,
            plaintext: b"moved",
        },
    };
    let outcome = settled(|| windowed.storage.try_write_record(&mut fs, mutation));
    assert!(
        finished.load(Ordering::SeqCst),
        "the checkpoint landed between two reads"
    );
    assert_eq!(outcome.map(|_| ()), Err(OperationError::MigrationRequired));
    let data: Vec<_> = windowed
        .tree()
        .into_keys()
        .filter(|name| name.starts_with("records") || name.starts_with("markers"))
        .collect();
    assert!(data.is_empty(), "{data:?}");
    let progressed = windowed.committed();
    assert_eq!(progressed.journal_revision, 1);
    assert_eq!(
        windowed.root().live_migration,
        Some(binding_of(&progressed, &windowed.installation.journal_dir))
    );
    assert_eq!(windowed.list(), Ok(0));
}

/// A progress checkpoint that lands at any point of a write, from another thread of the journal owner
/// (it holds no admission), is never lost and never written over: the write either commits on top of
/// it or is refused before its first root commit, and the root ends up binding the owner's revision.
#[cfg(unix)]
#[test]
fn a_progress_checkpoint_during_a_write_is_neither_lost_nor_written_over() {
    use super::faulty_fs::FaultyFs;
    use worldscript_secure_storage::{ProtectedError, RootStoreError};

    let undisturbed = Windowed::at(phase_code::PREPARE);
    let mut observing = FaultyFs::observing();
    let mutation = ProtectedMutation {
        record: undisturbed.record(),
        expected_generation: None,
        write: ProtectedWrite {
            record_schema: 1,
            plaintext: b"calibration",
        },
    };
    settled(|| {
        undisturbed
            .storage
            .try_write_record(&mut observing, mutation)
    })
    .unwrap();
    let reads = observing.served();
    assert!(
        reads > 20,
        "a write reads the root, the journal and the catalog: {reads}"
    );
    // Every sixth read, and the last one: each position builds a fresh bound installation.
    for position in (1..=reads).step_by(6).chain([reads]) {
        let windowed = Windowed::at(phase_code::PREPARE);
        let handles = Arc::new(Mutex::new(Vec::new()));
        let action = {
            let handles = Arc::clone(&handles);
            let provider = windowed.provider.clone();
            let root_dir = windowed.installation.root_dir.clone();
            let journal_dir = windowed.installation.journal_dir.clone();
            let key_ref = windowed.key_ref.clone();
            let next = progressing(&windowed.committed());
            move || {
                let (provider, root_dir) = (provider.clone(), root_dir.clone());
                let (journal_dir, key_ref) = (journal_dir.clone(), key_ref.clone());
                let next = next.clone();
                let handle = thread::spawn(move || {
                    progress_checkpoint(provider, root_dir, journal_dir, key_ref, next);
                });
                handles.lock().unwrap().push(handle);
            }
        };
        let mut fs = FaultyFs::acting_after_served_reads(position, action);
        let mutation = ProtectedMutation {
            record: windowed.record(),
            expected_generation: None,
            write: ProtectedWrite {
                record_schema: 1,
                plaintext: b"raced",
            },
        };
        let outcome = settled(|| windowed.storage.try_write_record(&mut fs, mutation));
        let spawned: Vec<_> = handles.lock().unwrap().drain(..).collect();
        assert_eq!(spawned.len(), 1, "the checkpoint ran at read {position}");
        for handle in spawned {
            handle.join().unwrap();
        }
        let progressed = windowed.committed();
        assert_eq!(progressed.journal_revision, 1, "read {position}");
        assert_eq!(
            windowed.root().live_migration,
            Some(binding_of(&progressed, &windowed.installation.journal_dir)),
            "the root binds the owner's revision after a write at read {position}"
        );
        match outcome {
            Ok(committed) => {
                assert_eq!(committed.generation, 1, "read {position}");
                assert_eq!(windowed.read().unwrap(), b"raced");
            }
            // Refused before the first root commit.
            Err(OperationError::MigrationRequired) => {
                assert_eq!(windowed.list().unwrap(), 0, "read {position}");
            }
            // The owner's checkpoint held the root: the write stops where it is and is recoverable.
            Err(OperationError::Protected(ProtectedError::RootBusy))
            | Err(OperationError::Protected(ProtectedError::Authority(AuthorityError::Root(
                RootStoreError::PreparationPending,
            )))) => {
                windowed.reconcile().unwrap();
                let expected = (windowed.list().unwrap() == 1).then_some(1);
                windowed.write(expected, b"final").unwrap();
                assert_eq!(windowed.read().unwrap(), b"final", "read {position}");
            }
            Err(other) => panic!("read {position}: unexpected refusal {other:?}"),
        }
        assert_eq!(
            windowed.root().live_migration,
            Some(binding_of(&progressed, &windowed.installation.journal_dir)),
            "the recovery kept the owner's revision after a write at read {position}"
        );
    }
}
