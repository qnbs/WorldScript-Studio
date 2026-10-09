//! Admission integration fixtures: provider probes contain no keys or manuscript diagnostics.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::*;

#[derive(Default)]
pub struct Probe {
    pub observations: AtomicUsize,
    pub keys: AtomicUsize,
    pub state: Mutex<Option<KeyState>>,
    pub fail_unlock: AtomicBool,
    pub lock_calls: AtomicUsize,
    pub replace_root: Mutex<Option<(PathBuf, PathBuf)>>,
}

pub struct ObservedProvider(pub MemoryKeyProvider, pub Arc<Probe>);

impl KeyProvider for ObservedProvider {
    fn state(&self) -> Result<KeyState, KeyProviderError> {
        self.1.observations.fetch_add(1, Ordering::SeqCst);
        match *self.1.state.lock().unwrap() {
            Some(state) => Ok(state),
            None => self.0.state(),
        }
    }
    fn session_binding(&self) -> Option<provider::SessionBinding> {
        self.0.session_binding()
    }
    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError> {
        self.1.observations.fetch_add(1, Ordering::SeqCst);
        self.1.keys.fetch_add(1, Ordering::SeqCst);
        self.0.resolve(epoch)
    }
    fn resolve_ref(&self, route: &RootKeyRefV1) -> Result<Key, KeyProviderError> {
        self.1.observations.fetch_add(1, Ordering::SeqCst);
        self.1.keys.fetch_add(1, Ordering::SeqCst);
        self.0.resolve_ref(route)
    }
    fn lock(&mut self) {
        self.1.lock_calls.fetch_add(1, Ordering::SeqCst);
        self.0.lock();
    }
    fn unlock(&mut self) -> Result<KeyState, KeyProviderError> {
        self.1.observations.fetch_add(1, Ordering::SeqCst);
        if self.1.fail_unlock.load(Ordering::SeqCst) {
            Err(KeyProviderError::SecureAnchorUnavailable)
        } else {
            self.0.unlock()
        }
    }
    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError> {
        self.0.list_epochs()
    }
    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError> {
        self.0.provision_epoch_key(epoch)
    }
    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError> {
        self.1.observations.fetch_add(1, Ordering::SeqCst);
        let anchor = self.0.read_root_anchor_state()?;
        if let Some((root, moved)) = self.1.replace_root.lock().unwrap().take() {
            fs::rename(&root, moved).unwrap();
            fs::create_dir(&root).unwrap();
        }
        Ok(anchor)
    }
    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError> {
        self.0.read_or_provision_installation_scope()
    }
    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError> {
        self.0.prepare_root_anchor(request)
    }
    fn commit_root_anchor(
        &mut self,
        operation: &str,
        generation: u64,
    ) -> Result<(), KeyProviderError> {
        self.0.commit_root_anchor(operation, generation)
    }
    fn abort_or_recover_root_anchor(&mut self, operation: &str) -> Result<(), KeyProviderError> {
        self.0.abort_or_recover_root_anchor(operation)
    }
}

/// Reader half of the deterministic N=2/M=3 race. The integration test owns the writer/signals;
/// this half keeps its original pin and checks each freshly captured generation independently.
pub struct PinnedReader {
    pub storage: Arc<ProtectedStorage<ObservedProvider>>,
    pub identity: RecordIdentity,
    pub records: PathBuf,
    pub markers: PathBuf,
}

impl PinnedReader {
    fn read(&self, snapshot: &mut AuthoritySnapshotGuard) -> Vec<u8> {
        snapshot
            .read_record(
                &mut StdFs,
                ProtectedRecord {
                    identity: &self.identity,
                    location: RecordLocation {
                        record_dir: &self.records,
                        marker_dir: &self.markers,
                    },
                },
                payload,
            )
            .unwrap()
    }

    pub fn run(
        self,
        ready: std::sync::mpsc::Sender<()>,
        racing: std::sync::mpsc::Sender<()>,
        finished: Arc<AtomicBool>,
    ) {
        let mut snapshot = self
            .storage
            .try_authority_snapshot(&mut StdFs)
            .unwrap()
            .unwrap();
        ready.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut saw_pending = false;
        while !finished.load(Ordering::Acquire) && Instant::now() < deadline {
            let mut fresh = match self.storage.try_authority_snapshot(&mut StdFs) {
                Ok(Some(snapshot)) => snapshot,
                Ok(None) => {
                    thread::yield_now();
                    continue;
                }
                Err(OperationError::Root(RootStoreError::RecoveryRequired(
                    RootRecoveryReason::KeyEpochSetMismatch,
                ))) => {
                    thread::yield_now();
                    continue;
                }
                Err(error) => panic!("unexpected snapshot error: {error:?}"),
            };
            let generation = fresh.root_generation();
            assert!((3..=9).contains(&generation));
            let expected = if generation <= 4 {
                b"baseline".as_slice()
            } else {
                b"next".as_slice()
            };
            assert_eq!(self.read(&mut fresh), expected);
            if generation == 4 && !saw_pending {
                saw_pending = true;
                racing.send(()).unwrap();
            }
            thread::yield_now();
        }
        assert!(
            finished.load(Ordering::Acquire),
            "writer did not finish within the proof deadline"
        );
        assert_eq!(self.read(&mut snapshot), b"baseline");
    }
}

pub struct Fixture {
    pub base: PathBuf,
    pub root: PathBuf,
    pub records: PathBuf,
    pub markers: PathBuf,
    pub identity: RecordIdentity,
    pub probe: Arc<Probe>,
    storage: Option<Arc<ProtectedStorage<ObservedProvider>>>,
}

/// What the preconfigured tree and provider look like when the storage is built.
#[derive(Default)]
pub struct Setup {
    /// The committed root binds this live migration (committed before the storage exists).
    pub bound: Option<LiveMigration>,
    /// The key provider is locked when the storage is built.
    pub locked: bool,
    /// The catalog holds one record, so that it has a page on disk.
    pub page: bool,
    /// After the (bound) root, a further root commit is interrupted at the anchor commit, leaving a
    /// durable preparation for the next operation's root recovery to resolve.
    pub interrupted: bool,
}

impl Fixture {
    pub fn new() -> Self {
        Self::new_in(&std::env::temp_dir())
    }

    pub fn new_in(parent: &Path) -> Self {
        Self::build(parent, Setup::default())
    }

    /// A storage over a tree whose committed root already binds `live`, built after the binding
    /// was committed: it is a cold start, and it never observed an unbound tree.
    pub fn new_bound(live: LiveMigration) -> Self {
        Self::with_setup(Setup {
            bound: Some(live),
            ..Setup::default()
        })
    }

    /// Like [`Self::new_bound`], with the key provider locked when the storage is built: what a
    /// restarted process sees before anything has been unlocked.
    pub fn new_bound_locked(live: LiveMigration) -> Self {
        Self::with_setup(Setup {
            bound: Some(live),
            locked: true,
            ..Setup::default()
        })
    }

    /// Like [`Self::new`], with the key provider locked when the storage is built.
    pub fn new_locked() -> Self {
        Self::with_setup(Setup {
            locked: true,
            ..Setup::default()
        })
    }

    /// A storage built over the tree and provider that `setup` describes.
    pub fn with_setup(setup: Setup) -> Self {
        Self::build(&std::env::temp_dir(), setup)
    }

    fn build(parent: &Path, setup: Setup) -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let base = parent.join(format!(
            "wss-gate4b-ops-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&base);
        let (root, records, markers) = (
            base.join("authority"),
            base.join("records"),
            base.join("markers"),
        );
        for dir in [
            root.join("slot-a"),
            root.join("slot-b"),
            records.clone(),
            markers.clone(),
        ] {
            fs::create_dir_all(dir).unwrap();
        }
        // The production locators are canonical. Test event predicates must use the same physical
        // spelling (macOS temp_dir may be /var while filesystem callbacks use /private/var).
        let (base, root, records, markers) = (
            fs::canonicalize(base).unwrap(),
            fs::canonicalize(root).unwrap(),
            fs::canonicalize(records).unwrap(),
            fs::canonicalize(markers).unwrap(),
        );
        let mut provider = configured_provider(&base, &root, &setup);
        if setup.locked {
            provider.lock();
        }
        let probe = Arc::new(Probe::default());
        let storage = Arc::new(ProtectedStorage::new(
            AdmissionScope {
                installation_dir: &base,
                root_dir: &root,
            },
            ObservedProvider(provider, probe.clone()),
        ));
        Self {
            base,
            root,
            records,
            markers,
            probe,
            storage: Some(storage),
            identity: RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap(),
        }
    }
    pub fn storage(&self) -> &Arc<ProtectedStorage<ObservedProvider>> {
        self.storage.as_ref().unwrap()
    }
    pub fn scope(&self) -> AdmissionScope<'_> {
        AdmissionScope {
            installation_dir: &self.base,
            root_dir: &self.root,
        }
    }
    pub fn location(&self) -> RecordLocation<'_> {
        RecordLocation {
            record_dir: &self.records,
            marker_dir: &self.markers,
        }
    }
    pub fn record(&self) -> ProtectedRecord<'_> {
        ProtectedRecord {
            identity: &self.identity,
            location: self.location(),
        }
    }
    pub fn write(
        &self,
        fs: &mut impl DurableFs,
        expected: Option<u64>,
        payload: &[u8],
    ) -> Result<Option<ProtectedCommitted>, OperationError> {
        self.storage()
            .try_write_record(fs, self.mutation(expected, payload))
    }

    /// Poll until the nonblocking write resolves to `Ok(Some(_))` or `Err(_)`, skipping `Ok(None)`.
    pub fn write_poll(
        &self,
        fs: &mut impl DurableFs,
        expected: Option<u64>,
        payload: &[u8],
    ) -> Result<Option<ProtectedCommitted>, OperationError> {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            match self.write(fs, expected, payload)? {
                Some(committed) => return Ok(Some(committed)),
                None if Instant::now() >= deadline => {
                    panic!("admitted write did not resolve before deadline");
                }
                None => thread::sleep(Duration::from_millis(5)),
            }
        }
    }

    /// Nonblocking admitted writes return `Ok(None)` under shared-admission contention; poll like production retry.
    pub fn write_until_admitted(
        &self,
        fs: &mut impl DurableFs,
        expected: Option<u64>,
        payload: &[u8],
    ) -> Result<ProtectedCommitted, OperationError> {
        match self.write_poll(fs, expected, payload)? {
            Some(committed) => Ok(committed),
            None => unreachable!("write_poll returns Some or panics"),
        }
    }
    pub fn mutation<'a>(
        &'a self,
        expected: Option<u64>,
        payload: &'a [u8],
    ) -> ProtectedMutation<'a> {
        ProtectedMutation {
            record: self.record(),
            expected_generation: expected,
            write: ProtectedWrite {
                record_schema: 1,
                plaintext: payload,
            },
        }
    }
    pub fn payload(&self) -> Vec<u8> {
        self.storage()
            .try_read_record(&mut StdFs, self.record(), payload)
            .unwrap()
            .unwrap()
    }
}

/// Release is observable only eventually: a forked child keeps an inherited `flock` descriptor until exec.
const ADMISSION_RELEASE_DEADLINE: Duration = Duration::from_secs(5);
const ADMISSION_RETRY_INTERVAL: Duration = Duration::from_millis(5);

// QNBS-v3: `Ok(None)` after drop is legal until a forked sibling execs and closes the inherited flock descriptor.
fn poll_until_admitted<T>(
    expected: &str,
    scope: AdmissionScope<'_>,
    mut acquire: impl FnMut(AdmissionScope<'_>) -> Result<Option<T>, AdmissionError>,
) -> T {
    let deadline = Instant::now() + ADMISSION_RELEASE_DEADLINE;
    loop {
        match acquire(scope) {
            Ok(Some(guard)) => return guard,
            Ok(None) if Instant::now() >= deadline => {
                panic!(
                    "{expected} remained unavailable for installation {} root {} after bounded nonblocking retries",
                    scope.installation_dir.display(),
                    scope.root_dir.display()
                );
            }
            Ok(None) => thread::sleep(ADMISSION_RETRY_INTERVAL),
            Err(error) => panic!(
                "{expected} failed for installation {} root {}: {error:?}",
                scope.installation_dir.display(),
                scope.root_dir.display()
            ),
        }
    }
}

/// Exclusive admission after a holder has been released. Direct `try_acquire` stays for "unavailable now".
pub fn acquire_exclusive_until_available(scope: AdmissionScope<'_>) -> ExclusiveAdmissionGuard {
    poll_until_admitted(
        "exclusive admission",
        scope,
        ExclusiveAdmissionGuard::try_acquire,
    )
}

/// Shared admission after a conflicting holder has been released.
pub fn acquire_shared_until_available(scope: AdmissionScope<'_>) -> SharedAdmissionGuard {
    poll_until_admitted("shared admission", scope, SharedAdmissionGuard::try_acquire)
}

/// Polls a nonblocking storage operation until it resolves to `Ok(_)` or `Err(_)`, retrying `Ok(None)`.
///
/// Use it where the test holds no admission, so `Ok(None)` can only be the legal eventual-release
/// delay described above. A test that asserts `Ok(None)` because it deliberately holds admission
/// calls the operation directly instead.
pub fn poll_admitted<T, E>(mut operation: impl FnMut() -> Result<Option<T>, E>) -> Result<T, E> {
    let deadline = Instant::now() + ADMISSION_RELEASE_DEADLINE;
    loop {
        match operation()? {
            Some(value) => return Ok(value),
            None if Instant::now() >= deadline => {
                panic!("nonblocking operation stayed unadmitted after bounded retries")
            }
            None => thread::sleep(ADMISSION_RETRY_INTERVAL),
        }
    }
}

/// The catalog descriptor of one record that is committed and readable, so that it has a page.
fn one_record_descriptor() -> CatalogDescriptor {
    let record = RecordIdentity::new(RecordClass::Codex, &["a-record"]).unwrap();
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    };
    let marker = CommitMarker::new(&record, 1, body).unwrap();
    let readable = CommittedGeneration {
        generation: 1,
        epoch: 1,
        content_digest: [0xab; 32],
    };
    CatalogDescriptor::new_unverified(&record, &marker, Some(readable)).unwrap()
}

fn configured_provider(base: &Path, root: &Path, setup: &Setup) -> MemoryKeyProvider {
    let mut provider = MemoryKeyProvider::new();
    let scope = provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    // Test-only preconfigured authority, not first enable (which remains Gate 4E).
    let mut exclusive = ExclusiveAdmissionGuard::try_acquire(AdmissionScope {
        installation_dir: base,
        root_dir: root,
    })
    .unwrap()
    .unwrap();
    let event = exclusive.try_root_commit().unwrap().unwrap();
    write_key_epoch(
        &mut StdFs,
        &provider,
        RootLayout { root_dir: root },
        KeyEpochCommit {
            scope: &scope,
            record: &KeyEpochRecord {
                epoch: 1,
                status: KeyEpochStatus::Active,
                root_key_ref: route.clone(),
            },
            registry_generation: 1,
            root_key_ref: &route,
            key_epoch: 1,
            held: event.root_guard().unwrap(),
        },
    )
    .unwrap();
    drop(event);
    let descriptors = if setup.page {
        vec![one_record_descriptor()]
    } else {
        Vec::new()
    };
    commit_catalog_change(
        &mut StdFs,
        &mut provider,
        RootLayout { root_dir: root },
        CatalogCommit {
            change: CatalogChange {
                upsert: &descriptors,
                remove: &[],
            },
            root_key_ref: &route,
            active_key_epoch: 1,
            operation_id: "fixture-bootstrap",
        },
    )
    .unwrap();
    if let Some(live) = &setup.bound {
        // No producer of a bind exists in the crate yet, so the next root is committed directly.
        let layout = RootLayout { root_dir: root };
        let catalog = load_catalog(&mut StdFs, &provider, layout)
            .unwrap()
            .unwrap();
        let body = RootBody {
            root_generation: catalog.root.root_generation + 1,
            commit_evidence: RootCommitEvidence {
                operation_id: live.operation_id.clone(),
                fencing_generation: live.fencing_generation,
                state: RootCommitState::Committed,
            },
            live_migration: Some(live.clone()),
            ..catalog.root
        };
        let event = exclusive.try_root_commit().unwrap().unwrap();
        commit_root(
            &mut StdFs,
            &mut provider,
            layout,
            RootCommitRequest {
                scope: &scope,
                root: &body,
                root_key_ref: &route,
                held: event.root_guard().unwrap(),
            },
        )
        .unwrap();
        drop(event);
    }
    if setup.interrupted {
        // A further ordinary root commit that stops at the anchor commit: the preparation is durable,
        // the committed root is still the previous one.
        provider.inject(Fault::BeforePersist(AnchorOp::Commit));
        let interrupted = commit_catalog_change(
            &mut StdFs,
            &mut provider,
            RootLayout { root_dir: root },
            CatalogCommit {
                change: CatalogChange {
                    upsert: &[],
                    remove: &[],
                },
                root_key_ref: &route,
                active_key_epoch: 1,
                operation_id: "fixture-interrupted",
            },
        );
        assert!(interrupted.is_err(), "the commit must stop at the anchor");
        assert!(
            provider
                .read_root_anchor_state()
                .unwrap()
                .prepared_root_commit
                .is_some(),
            "the interrupted commit leaves a durable preparation"
        );
    }
    drop(exclusive);
    provider
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Windows pins may deny deletion: release the owning lock/provider before fixture cleanup.
        self.storage.take();
        let _ = fs::remove_dir_all(&self.base);
    }
}

pub fn payload(read: ProtectedRead) -> Vec<u8> {
    match read {
        ProtectedRead::Record(record) => record.payload.to_vec(),
        _ => panic!("expected an admitted committed record"),
    }
}

pub const CHILD_SCOPE: &str = "WSS_GATE4B_OPERATIONS_INSTALLATION";
pub const CHILD_MODE: &str = "WSS_GATE4B_OPERATIONS_MODE";

pub fn child_probe(fixture: &Fixture, mode: &str) {
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "operation_child",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_SCOPE, &fixture.base)
        .env(CHILD_MODE, mode)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success());
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("operation child did not finish");
        }
        thread::sleep(Duration::from_millis(10));
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Create,
    Renamed,
    Read,
}

pub struct HookFs<H>(pub H);

impl<H: FnMut(&Path, Event) -> io::Result<()>> DurableFs for HookFs<H> {
    type File = fs::File;
    fn create_new(&mut self, path: &Path) -> io::Result<fs::File> {
        (self.0)(path, Event::Create)?;
        StdFs.create_new(path)
    }
    fn sync_file(&mut self, file: &mut fs::File) -> io::Result<()> {
        StdFs.sync_file(file)
    }
    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        (self.0)(path, Event::Read)?;
        StdFs.read(path)
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
        StdFs.rename_replace(from, to)?;
        (self.0)(to, Event::Renamed)
    }
    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        StdFs.create_dir_all(dir)
    }
    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        worldscript_secure_storage::durable::read_at_most_via_read(self, path, limit)
    }

    fn list_dir_at_most(
        &mut self,
        dir: &Path,
        limit: usize,
    ) -> io::Result<Option<Vec<std::ffi::OsString>>> {
        worldscript_secure_storage::durable::list_dir_at_most_via_list_dir(self, dir, limit)
    }
}
