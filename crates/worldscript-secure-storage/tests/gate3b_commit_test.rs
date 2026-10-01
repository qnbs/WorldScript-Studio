//! Gate 3 slice 3B part 2: the commit write protocol and startup reconciliation
//! (`docs/native/R15-SECURE-STORAGE-CONTRACT.md` §8.4, §9, §9.2), proven on `settings:global`.
//!
//! Each crash state is produced by injecting an I/O error at one durability boundary of a real
//! write, then reconciling on the real filesystem. An injected error is not a power loss; what a
//! device persists across a crash is packaged evidence for Gate 6.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    commit_write, generation_path, load_authority, read_committed, reconcile, seal_record,
    staging_path, Authority, CommitError, CommitMarker, Debris, DebrisKind, DirectoryDurability,
    DurableFs, Key, MarkerBody, MarkerError, MarkerOperation, OpenError, PendingBody, RecordClass,
    RecordIdentity, RecordLocation, RecordMeta, RecoveryReason, Resolution, StdFs,
    WriteOperationId, WriteRequest,
};

const FIRST: &[u8] = b"{\"theme\":\"dark\"}";
const SECOND: &[u8] = b"{\"theme\":\"light\"}";
const THIRD: &[u8] = b"{\"theme\":\"sepia\"}";
const REQUEST: WriteRequest = WriteRequest {
    key_epoch: 1,
    record_schema: 1,
};

fn key() -> Key {
    Key::from_bytes(&mut [9u8; 32])
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

/// A record directory and a marker directory under a fresh temp root, removed on drop.
struct Dirs {
    root: PathBuf,
    record: PathBuf,
    marker: PathBuf,
}

impl Dirs {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "wss-gate3b-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let (record, marker) = (root.join("record"), root.join("marker"));
        fs::create_dir_all(&record).unwrap();
        fs::create_dir_all(&marker).unwrap();
        Dirs {
            root,
            record,
            marker,
        }
    }

    fn location(&self) -> RecordLocation<'_> {
        RecordLocation {
            record_dir: &self.record,
            marker_dir: &self.marker,
        }
    }
}

impl Drop for Dirs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn write(fs: &mut impl DurableFs, dirs: &Dirs, plaintext: &[u8]) -> Result<u64, CommitError> {
    commit_write(fs, &key(), &settings(), dirs.location(), REQUEST, plaintext)
        .map(|committed| committed.generation)
}

fn read(dirs: &Dirs) -> Result<Option<Vec<u8>>, CommitError> {
    read_committed(&mut StdFs, &key(), &settings(), dirs.location())
        .map(|opened| opened.map(|record| record.payload))
}

fn authority(dirs: &Dirs) -> Result<Authority, CommitError> {
    load_authority(&mut StdFs, &key(), &settings(), dirs.location())
}

fn startup(dirs: &Dirs) -> Result<(Resolution, Vec<Debris>), CommitError> {
    reconcile(&mut StdFs, &key(), &settings(), dirs.location(), 1)
        .map(|reconciled| (reconciled.resolution, reconciled.debris))
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn assert_no_plaintext(dirs: &Dirs) {
    for dir in [&dirs.record, &dirs.marker] {
        for name in names(dir) {
            let bytes = fs::read(dir.join(&name)).unwrap();
            for plaintext in [FIRST, SECOND, THIRD] {
                assert!(
                    !bytes.windows(plaintext.len()).any(|w| w == plaintext),
                    "plaintext in {name}"
                );
            }
        }
    }
}

fn marker_bytes(marker_generation: u64, body: MarkerBody) -> Vec<u8> {
    CommitMarker::new(&settings(), marker_generation, body)
        .unwrap()
        .seal(&key(), 1)
        .unwrap()
}

/// The filesystem operations a fault can target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Create,
    Read,
    Link,
    SyncDir,
}

/// The real filesystem, failing the `nth` (0-based) operation `op` whose path is inside `dir`.
struct FaultFs {
    op: Op,
    dir: PathBuf,
    nth: u32,
    seen: u32,
}

impl FaultFs {
    fn new(op: Op, dir: &Path, nth: u32) -> Self {
        FaultFs {
            op,
            dir: dir.to_path_buf(),
            nth,
            seen: 0,
        }
    }

    fn trips(&mut self, op: Op, path: &Path) -> bool {
        let inside = path == self.dir || path.parent() == Some(self.dir.as_path());
        if op != self.op || !inside {
            return false;
        }
        self.seen += 1;
        self.seen == self.nth + 1
    }
}

fn injected() -> io::Error {
    io::Error::other("injected fault")
}

impl DurableFs for FaultFs {
    type File = fs::File;

    fn create_new(&mut self, path: &Path) -> io::Result<fs::File> {
        if self.trips(Op::Create, path) {
            return Err(injected());
        }
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut fs::File) -> io::Result<()> {
        file.flush()?;
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        if self.trips(Op::Read, path) {
            return Err(injected());
        }
        StdFs.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        if self.trips(Op::Link, to) {
            return Err(injected());
        }
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        if self.trips(Op::SyncDir, dir) {
            return Err(injected());
        }
        StdFs.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        StdFs.list_dir(dir)
    }
}

#[test]
fn a_first_write_and_a_replacement_commit_through_markers() {
    let dirs = Dirs::new();
    assert_eq!(authority(&dirs).unwrap(), Authority::Absent);
    assert_eq!(read(&dirs).unwrap(), None);

    let first = commit_write(
        &mut StdFs,
        &key(),
        &settings(),
        dirs.location(),
        REQUEST,
        FIRST,
    )
    .unwrap();
    assert_eq!((first.generation, first.marker_generation), (1, 2));
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));

    assert_eq!(write(&mut StdFs, &dirs, SECOND).unwrap(), 2);
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(SECOND));
    assert_eq!(
        names(&dirs.record),
        ["generation-1.wsr1", "generation-2.wsr1"]
    );
    assert_eq!(
        names(&dirs.marker),
        [
            "generation-1.wsr1",
            "generation-2.wsr1",
            "generation-3.wsr1",
            "generation-4.wsr1"
        ]
    );
    assert_no_plaintext(&dirs);
    let (resolution, debris) = startup(&dirs).unwrap();
    assert_eq!((resolution, debris), (Resolution::Unchanged, Vec::new()));
}

#[test]
fn directory_durability_is_confirmed_only_where_the_platform_confirms_it() {
    let dirs = Dirs::new();
    let committed = commit_write(
        &mut StdFs,
        &key(),
        &settings(),
        dirs.location(),
        REQUEST,
        FIRST,
    )
    .unwrap();
    let expected = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    assert_eq!(committed.directories, expected);
}

/// Leaves `PENDING(1 -> 2)` with generation 2 promoted, then replaces generation 2 with `bytes`.
fn pending_with_candidate(dirs: &Dirs, bytes: &[u8]) {
    write(&mut StdFs, dirs, FIRST).unwrap();
    let mut fault = FaultFs::new(Op::SyncDir, &dirs.record, 0);
    assert!(write(&mut fault, dirs, SECOND).is_err());
    let candidate = generation_path(&dirs.record, 2);
    fs::remove_file(&candidate).unwrap();
    fs::write(&candidate, bytes).unwrap();
}

#[test]
fn a_candidate_for_the_wrong_generation_or_epoch_is_never_adopted() {
    // Generation 1's authentic envelope under generation 2's name.
    let wrong_generation = {
        let source = Dirs::new();
        write(&mut StdFs, &source, THIRD).unwrap();
        fs::read(generation_path(&source.record, 1)).unwrap()
    };
    // An authentic generation-2 envelope of this record, but under epoch 2.
    let meta = RecordMeta {
        key_epoch: 2,
        record_generation: 2,
        record_schema: 1,
    };
    let wrong_epoch = seal_record(&key(), &settings(), meta, THIRD).unwrap();
    for bytes in [wrong_generation, wrong_epoch] {
        let dirs = Dirs::new();
        pending_with_candidate(&dirs, &bytes);
        let (resolution, debris) = startup(&dirs).unwrap();
        assert_eq!(resolution, Resolution::RolledBack { restored: Some(1) });
        assert_eq!(debris.len(), 1);
        assert_eq!(debris[0].kind, DebrisKind::Rejected);
        assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));
    }
}

#[test]
fn a_generation_name_collision_never_hides_the_operations_own_candidate() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    // Something else already holds generation 2's name: promotion is refused, never replaced.
    fs::write(generation_path(&dirs.record, 2), b"foreign").unwrap();
    assert!(matches!(
        write(&mut StdFs, &dirs, SECOND),
        Err(CommitError::RecordWrite(_))
    ));
    let (resolution, debris) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::Completed { generation: 2 });
    assert_eq!(debris.len(), 1);
    assert_eq!(debris[0].kind, DebrisKind::Rejected);
    assert_eq!(fs::read(&debris[0].path).unwrap(), b"foreign");
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(SECOND));
}

#[test]
fn a_reserved_or_future_marker_state_fails_closed() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    // A well-formed marker body with the reserved DELETE_PENDING code (3), sealed as generation 3.
    let marker_id = "record-commit:settings:settings:global";
    let mut body = 13u32.to_be_bytes().to_vec();
    body.extend_from_slice(b"record-commit");
    body.push(1);
    body.extend_from_slice(&(marker_id.len() as u32).to_be_bytes());
    body.extend_from_slice(marker_id.as_bytes());
    body.push(0);
    body.extend_from_slice(&3u64.to_be_bytes());
    body.extend_from_slice(&3u32.to_be_bytes());
    let identity = RecordIdentity::commit_marker(&settings()).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 3,
        record_schema: 1,
    };
    let sealed = seal_record(&key(), &identity, meta, &body).unwrap();
    fs::write(generation_path(&dirs.marker, 3), sealed).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::MarkerUnreadable {
                marker_generation: 3,
                error: MarkerError::UnsupportedState(3),
            }
        ))
    );
    assert!(write(&mut StdFs, &dirs, SECOND).is_err());
    assert!(read(&dirs).is_err());
}

#[test]
fn a_first_write_that_never_staged_rolls_back_to_no_authority() {
    let dirs = Dirs::new();
    let mut fault = FaultFs::new(Op::Create, &dirs.record, 0);
    assert!(matches!(
        write(&mut fault, &dirs, FIRST),
        Err(CommitError::RecordWrite(_))
    ));
    assert!(matches!(
        authority(&dirs).unwrap(),
        Authority::Pending { serving: None, .. }
    ));
    assert_eq!(read(&dirs).unwrap(), None);
    let (resolution, _) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::RolledBack { restored: None });
    // The retry is a new first write: PENDING(none -> 1) again, then ACTIVE(1).
    assert_eq!(write(&mut StdFs, &dirs, SECOND).unwrap(), 1);
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(SECOND));
}

#[test]
fn a_replacement_that_never_staged_restores_the_old_generation() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let mut fault = FaultFs::new(Op::Create, &dirs.record, 0);
    assert!(matches!(
        write(&mut fault, &dirs, SECOND),
        Err(CommitError::RecordWrite(_))
    ));
    // While pending, the old generation is served.
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));
    let (resolution, _) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::RolledBack { restored: Some(1) });
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));
    assert_eq!(write(&mut StdFs, &dirs, THIRD).unwrap(), 2);
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(THIRD));
}

#[test]
fn a_promoted_candidate_is_completed_at_startup() {
    // The record directory sync fails after promotion, and separately the ACTIVE marker write
    // fails: either way the promoted generation is the authenticated candidate.
    for fault_at in [Op::SyncDir, Op::Create] {
        let dirs = Dirs::new();
        write(&mut StdFs, &dirs, FIRST).unwrap();
        let mut fault = match fault_at {
            Op::SyncDir => FaultFs::new(Op::SyncDir, &dirs.record, 0),
            // Marker creates: generations 1 and 2 exist, 3 is PENDING, 4 is the ACTIVE marker.
            _ => FaultFs::new(Op::Create, &dirs.marker, 1),
        };
        assert!(write(&mut fault, &dirs, SECOND).is_err(), "{fault_at:?}");
        assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST), "{fault_at:?}");
        let (resolution, _) = startup(&dirs).unwrap();
        assert_eq!(resolution, Resolution::Completed { generation: 2 });
        assert_eq!(read(&dirs).unwrap().as_deref(), Some(SECOND));
    }
}

#[test]
fn a_validated_but_unpromoted_staging_file_is_promoted_at_startup() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let mut fault = FaultFs::new(Op::Link, &dirs.record, 0);
    assert!(matches!(
        write(&mut fault, &dirs, SECOND),
        Err(CommitError::RecordWrite(_))
    ));
    assert_eq!(
        names(&dirs.record).len(),
        2,
        "generation 1 and the staging file"
    );
    let (resolution, debris) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::Completed { generation: 2 });
    assert_eq!(debris, Vec::new());
    assert_eq!(
        names(&dirs.record),
        ["generation-1.wsr1", "generation-2.wsr1"]
    );
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(SECOND));
}

#[test]
fn a_tampered_candidate_is_relocated_never_deleted_and_the_retry_reuses_its_generation() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let mut fault = FaultFs::new(Op::SyncDir, &dirs.record, 0);
    assert!(write(&mut fault, &dirs, SECOND).is_err());
    let candidate = generation_path(&dirs.record, 2);
    let mut bytes = fs::read(&candidate).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    fs::remove_file(&candidate).unwrap();
    fs::write(&candidate, &bytes).unwrap();

    let (resolution, debris) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::RolledBack { restored: Some(1) });
    assert_eq!(debris.len(), 1);
    assert_eq!(debris[0].kind, DebrisKind::Rejected);
    assert_eq!(
        fs::read(&debris[0].path).unwrap(),
        bytes,
        "rejected bytes are kept"
    );
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));
    assert_eq!(write(&mut StdFs, &dirs, THIRD).unwrap(), 2);
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(THIRD));
}

#[test]
fn an_unreadable_candidate_decides_nothing() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let mut fault = FaultFs::new(Op::SyncDir, &dirs.record, 0);
    assert!(write(&mut fault, &dirs, SECOND).is_err());
    let (record_before, marker_before) = (names(&dirs.record), names(&dirs.marker));
    // Reconciliation's first record-directory read is the candidate.
    let mut unreadable = FaultFs::new(Op::Read, &dirs.record, 0);
    let result = reconcile(&mut unreadable, &key(), &settings(), dirs.location(), 1);
    assert!(matches!(result, Err(CommitError::Io { .. })));
    assert_eq!(names(&dirs.record), record_before);
    assert_eq!(names(&dirs.marker), marker_before);
    assert!(matches!(
        authority(&dirs).unwrap(),
        Authority::Pending { .. }
    ));
}

#[test]
fn a_gap_or_an_unreadable_marker_fails_closed() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    write(&mut StdFs, &dirs, SECOND).unwrap();

    let latest = generation_path(&dirs.marker, 4);
    let original = fs::read(&latest).unwrap();
    let mut corrupt = original.clone();
    let last = corrupt.len() - 1;
    corrupt[last] ^= 1;
    fs::write(&latest, &corrupt).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::MarkerUnreadable {
                marker_generation: 4,
                error: MarkerError::Open(OpenError::Tampered),
            }
        ))
    );
    assert!(read(&dirs).is_err(), "no fallback to an older marker");
    fs::write(&latest, &original).unwrap();

    fs::remove_file(generation_path(&dirs.marker, 2)).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::MarkerChainGap { missing: 2 }
        ))
    );
}

#[test]
fn every_marker_must_be_a_legal_transition() {
    let dirs = Dirs::new();
    let active = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0; 32],
    };
    // ACTIVE(1) with no PENDING before it.
    fs::write(generation_path(&dirs.marker, 1), marker_bytes(1, active)).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::IllegalTransition {
                marker_generation: 1
            }
        ))
    );

    let dirs = Dirs::new();
    let recovery = MarkerBody::RecoveryRequired {
        reason_code: 1,
        prior: None,
    };
    fs::write(generation_path(&dirs.marker, 1), marker_bytes(1, recovery)).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::MarkerRecoveryRequired
        ))
    );
    assert!(
        write(&mut StdFs, &dirs, FIRST).is_err(),
        "no write while recovery is required"
    );

    // A replacement pending marker that skips the committed generation.
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let skipping = MarkerBody::Pending(PendingBody {
        operation: MarkerOperation {
            operation_id: "f".repeat(32),
            fencing_generation: 0,
        },
        old_generation: None,
        target_generation: 1,
        target_epoch: 1,
        content_digest: None,
        record_schema: 1,
    });
    fs::write(generation_path(&dirs.marker, 3), marker_bytes(3, skipping)).unwrap();
    assert_eq!(
        authority(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::IllegalTransition {
                marker_generation: 3
            }
        ))
    );
}

#[test]
fn a_committed_generation_must_be_the_envelope_its_marker_bound() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let committed = generation_path(&dirs.record, 1);
    let original = fs::read(&committed).unwrap();

    // A different valid envelope for the same identity and generation.
    let other = Dirs::new();
    write(&mut StdFs, &other, SECOND).unwrap();
    fs::remove_file(&committed).unwrap();
    fs::copy(generation_path(&other.record, 1), &committed).unwrap();
    assert_eq!(
        read(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::CommittedGenerationMismatch
        ))
    );

    fs::remove_file(&committed).unwrap();
    assert_eq!(
        read(&dirs),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::CommittedGenerationMissing
        ))
    );
    fs::write(&committed, original).unwrap();
    assert_eq!(read(&dirs).unwrap().as_deref(), Some(FIRST));
}

#[test]
fn reconciliation_removes_only_provably_redundant_staging() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let op = |seed: u8| WriteOperationId::parse(&format!("{seed:02x}").repeat(16)).unwrap();
    let redundant = staging_path(&dirs.record, 1, &op(0xaa));
    fs::copy(generation_path(&dirs.record, 1), &redundant).unwrap();
    let orphan = staging_path(&dirs.record, 7, &op(0xbb));
    fs::write(&orphan, b"not an envelope").unwrap();
    let unrecognized = dirs.record.join("notes.txt");
    fs::write(&unrecognized, b"keep me").unwrap();

    let (resolution, debris) = startup(&dirs).unwrap();
    assert_eq!(resolution, Resolution::Unchanged);
    let kinds: Vec<(PathBuf, DebrisKind)> = debris.into_iter().map(|d| (d.path, d.kind)).collect();
    let mut expected = vec![
        (redundant.clone(), DebrisKind::RedundantStagingRemoved),
        (orphan.clone(), DebrisKind::OrphanStaging),
        (unrecognized.clone(), DebrisKind::Unrecognized),
    ];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(kinds, expected);
    assert!(!redundant.exists());
    assert_eq!(fs::read(&orphan).unwrap(), b"not an envelope");
    assert_eq!(fs::read(&unrecognized).unwrap(), b"keep me");
}
