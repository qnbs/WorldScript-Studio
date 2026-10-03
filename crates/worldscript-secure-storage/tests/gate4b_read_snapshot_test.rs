//! Read/snapshot proof only. Mutation/root-recovery/lifecycle remains the successor slice.
#[path = "support/read_operations.rs"]
mod support;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use support::{
    child_probe, payload, Event, Fixture, HookFs, ObservedProvider, Probe, CHILD_MODE, CHILD_SCOPE,
};
use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::*;

#[test]
fn read_handoff_holds_admission_until_consumer_returns() {
    let fixture = Fixture::new();
    let result = fixture
        .storage()
        .try_read_record(&mut StdFs, fixture.record(), |read| {
            assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
                .unwrap()
                .is_none());
            child_probe(&fixture, "transition");
            payload(read)
        })
        .unwrap()
        .unwrap();
    assert_eq!(result, b"value");
    let exclusive = ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .unwrap();
    child_probe(&fixture, "read");
    drop(exclusive);
    assert!(fixture
        .storage()
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .is_some());
}

#[test]
fn shared_readers_are_send_and_retain_admission_and_non_authorizing_witness() {
    fn send<T: Send>() {}
    send::<AuthoritySnapshotGuard>();
    let fixture = Fixture::new();
    let mut first = fixture
        .storage()
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .unwrap();
    let second = fixture
        .storage()
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .unwrap();
    let witness = first.retention();
    assert_eq!(witness.root_generation(), first.root_generation());
    assert!(witness.is_referenced());
    assert_eq!(
        first
            .read_record(&mut StdFs, fixture.record(), payload)
            .unwrap(),
        b"value"
    );
    assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    drop(first);
    assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    drop(second);
    assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_some());
    // The current authority cell still owns its local reference; this is not deletion permission.
    assert!(witness.is_referenced());
}

#[test]
fn retained_epoch_read_distinguishes_absence_from_transient_io() {
    let fixture = Fixture::new();
    let mut snapshot = fixture
        .storage()
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .unwrap();
    for kind in [
        io::ErrorKind::PermissionDenied,
        io::ErrorKind::Interrupted,
        io::ErrorKind::NotFound,
    ] {
        let mut filesystem = HookFs(|path: &std::path::Path, event| {
            if event == Event::Read && path.starts_with(fixture.root.join("key-epoch")) {
                return Err(io::Error::from(kind));
            }
            Ok(())
        });
        let expected = if kind == io::ErrorKind::NotFound {
            RootStoreError::RecoveryRequired(RootRecoveryReason::KeyEpochSetMismatch)
        } else {
            RootStoreError::Io {
                step: RootStep::ReadKeyEpoch,
                kind,
            }
        };
        assert_eq!(
            snapshot.read_record(&mut filesystem, fixture.record(), |_| ()),
            Err(OperationError::Root(expected))
        );
    }
    assert!(snapshot
        .read_record(&mut StdFs, fixture.record(), |_| ())
        .is_ok());
}

#[test]
fn exclusive_and_locked_or_migrating_plaintext_never_bypass_policy() {
    let fixture = Fixture::new();
    let legacy = fixture.records.join("legacy.txt");
    fs::write(&legacy, b"legacy plaintext fixture").unwrap();
    let held = ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .unwrap();
    let before = fixture.probe.observations.load(Ordering::SeqCst);
    let mut called = false;
    assert_eq!(
        fixture
            .storage()
            .try_read_record(&mut StdFs, fixture.record(), |_| { called = true })
            .unwrap(),
        None
    );
    assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), before);
    assert!(!called);
    drop(held);
    for state in [
        KeyState::Unconfigured,
        KeyState::Locked,
        KeyState::Migrating {
            source: 1,
            target: 2,
        },
    ] {
        *fixture.probe.state.lock().unwrap() = Some(state);
        let keys = fixture.probe.keys.load(Ordering::SeqCst);
        let mut filesystem = HookFs(|_: &std::path::Path, _| -> io::Result<()> {
            panic!("refused read performed filesystem access")
        });
        assert!(fixture
            .storage()
            .try_read_record(&mut filesystem, fixture.record(), |_| called = true)
            .is_err());
        assert!(!called);
        assert_eq!(fixture.probe.keys.load(Ordering::SeqCst), keys);
        assert_eq!(fs::read(&legacy).unwrap(), b"legacy plaintext fixture");
    }
}

#[test]
fn absent_misrouted_or_reserved_read_is_not_ordinary_absence() {
    let fixture = Fixture::new();
    let foreign = Fixture::new();
    let absent = RecordIdentity::new(RecordClass::Codex, &["absent"]).unwrap();
    assert_eq!(
        fixture.storage().try_read_record(
            &mut StdFs,
            ProtectedRecord {
                identity: &absent,
                location: foreign.location(),
            },
            |_| ()
        ),
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    );
    let reserved = fixture.base.join("ordinary-writers");
    fs::create_dir(&reserved).unwrap();
    assert_eq!(
        fixture.storage().try_read_record(
            &mut StdFs,
            ProtectedRecord {
                identity: &absent,
                location: RecordLocation {
                    record_dir: &reserved,
                    ..fixture.location()
                },
            },
            |_| ()
        ),
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    );
    let probe = Arc::new(Probe::default());
    let collision = ProtectedStorage::new(
        AdmissionScope {
            installation_dir: &fixture.base,
            root_dir: &reserved,
        },
        ObservedProvider(MemoryKeyProvider::new(), probe.clone()),
    );
    assert!(matches!(
        collision.try_authority_snapshot(&mut StdFs),
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    ));
    assert_eq!(probe.observations.load(Ordering::SeqCst), 0);
    assert_eq!(
        fixture
            .storage()
            .try_read_record(
                &mut StdFs,
                ProtectedRecord {
                    identity: &absent,
                    ..fixture.record()
                },
                |r| r
            )
            .unwrap(),
        Some(ProtectedRead::NotCatalogued)
    );
}

#[test]
fn nonordinary_member_is_refused_before_authority_observation() {
    let fixture = Fixture::new();
    let member = RecordIdentity::new(RecordClass::Asset, &["p1", "a1"]).unwrap();
    let before = fixture.probe.observations.load(Ordering::SeqCst);
    assert_eq!(
        fixture.storage().try_read_record(
            &mut StdFs,
            ProtectedRecord {
                identity: &member,
                ..fixture.record()
            },
            |_| ()
        ),
        Err(OperationError::Protected(
            ProtectedError::NotAnOrdinaryRecord
        ))
    );
    assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), before);
}

#[cfg(unix)]
#[test]
fn pinned_snapshot_refuses_replaced_authority_directory() {
    let fixture = Fixture::new();
    let mut snapshot = fixture
        .storage()
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .unwrap();
    fs::rename(&fixture.root, fixture.base.join("moved-root")).unwrap();
    fs::create_dir(&fixture.root).unwrap();
    assert_eq!(
        snapshot.read_record(&mut StdFs, fixture.record(), |_| ()),
        Err(OperationError::Admission(AdmissionError::IdentityChanged))
    );
}

#[test]
fn operation_child() {
    let Ok(base) = std::env::var(CHILD_SCOPE) else {
        return;
    };
    let base = PathBuf::from(base);
    let scope = AdmissionScope {
        installation_dir: &base,
        root_dir: &base.join("authority"),
    };
    let probe = Arc::new(Probe::default());
    let storage = ProtectedStorage::new(
        scope,
        ObservedProvider(MemoryKeyProvider::new(), probe.clone()),
    );
    match std::env::var(CHILD_MODE).unwrap().as_str() {
        "transition" => assert!(ExclusiveAdmissionGuard::try_acquire(scope)
            .unwrap()
            .is_none()),
        "read" => assert!(storage
            .try_authority_snapshot(&mut StdFs)
            .unwrap()
            .is_none()),
        _ => panic!("unknown child mode"),
    }
    assert_eq!(probe.observations.load(Ordering::SeqCst), 0);
}
