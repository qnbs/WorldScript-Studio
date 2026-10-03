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

use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
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
            let mut fresh = self
                .storage
                .try_authority_snapshot(&mut StdFs)
                .unwrap()
                .unwrap();
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

impl Fixture {
    pub fn new() -> Self {
        Self::new_in(&std::env::temp_dir())
    }

    pub fn new_in(parent: &Path) -> Self {
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
        let provider = configured_provider(&base, &root);
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

fn configured_provider(base: &Path, root: &Path) -> MemoryKeyProvider {
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
    commit_catalog_change(
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
            operation_id: "fixture-bootstrap",
        },
    )
    .unwrap();
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
}
