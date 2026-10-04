//! Read/snapshot proof only. Mutation/root-recovery/lifecycle remains the successor slice.
#[path = "support/read_operations.rs"]
mod support;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use support::{
    child_probe, payload, Event, Fixture, HookFs, ObservedProvider, Probe, CHILD_MODE, CHILD_SCOPE,
};
use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::secure_store::MemorySecretStore;
use worldscript_secure_storage::store_authority::SecureStoreAuthority;
use worldscript_secure_storage::store_runtime::SecureStoreRuntime;
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
fn admitted_catalog_enumeration_holds_the_read_barrier() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture
            .storage()
            .try_list_records(&mut StdFs)
            .unwrap()
            .unwrap()
            .iter()
            .map(|descriptor| descriptor.record())
            .collect::<Vec<_>>(),
        vec![&fixture.identity]
    );
    let held = ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .unwrap();
    let before = fixture.probe.observations.load(Ordering::SeqCst);
    assert_eq!(
        fixture.storage().try_list_records(&mut StdFs).unwrap(),
        None
    );
    assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), before);
    drop(held);
}

#[test]
fn external_same_key_root_commit_rebinds_the_admitted_reader() {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let base = std::env::temp_dir().join(format!(
        "wss-gate4b-runtime-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&base);
    let (root, records, markers) = (
        base.join("authority"),
        base.join("records"),
        base.join("markers"),
    );
    for path in [
        root.join("slot-a"),
        root.join("slot-b"),
        records.clone(),
        markers.clone(),
    ] {
        fs::create_dir_all(path).unwrap();
    }
    let (base, root, records, markers) = (
        fs::canonicalize(base).unwrap(),
        fs::canonicalize(root).unwrap(),
        fs::canonicalize(records).unwrap(),
        fs::canonicalize(markers).unwrap(),
    );
    let store = MemorySecretStore::new();
    let mut writer = SecureStoreRuntime::new(SecureStoreAuthority::new(store.clone()));
    let scope = writer.read_or_provision_installation_scope().unwrap();
    let route = writer.provision_epoch_key(1).unwrap();
    writer.unlock().unwrap();
    let admission = AdmissionScope {
        installation_dir: &base,
        root_dir: &root,
    };
    let mut exclusive = ExclusiveAdmissionGuard::try_acquire(admission)
        .unwrap()
        .unwrap();
    let event = exclusive.try_root_commit().unwrap().unwrap();
    write_key_epoch(
        &mut StdFs,
        &writer,
        RootLayout { root_dir: &root },
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
        &mut writer,
        RootLayout { root_dir: &root },
        CatalogCommit {
            change: CatalogChange {
                upsert: &[],
                remove: &[],
            },
            root_key_ref: &route,
            active_key_epoch: 1,
            operation_id: "runtime-fixture",
        },
    )
    .unwrap();
    drop(exclusive);
    let identity = RecordIdentity::new(RecordClass::Codex, &["runtime"]).unwrap();
    let write = |writer: &mut SecureStoreRuntime<MemorySecretStore>, plaintext: &[u8]| {
        let key = writer.resolve_ref(&route).unwrap();
        let result = protected_write(
            &mut StdFs,
            writer,
            ProtectedTarget {
                layout: RootLayout { root_dir: &root },
                store: RecordStore {
                    key: &key,
                    record: &identity,
                    location: RecordLocation {
                        record_dir: &records,
                        marker_dir: &markers,
                    },
                },
                root_key_ref: &route,
                key_epoch: 1,
            },
            ProtectedWrite {
                record_schema: 1,
                plaintext,
            },
        );
        drop(key);
        result
    };
    write(&mut writer, b"first").unwrap();
    let mut uncaptured = SecureStoreRuntime::new(SecureStoreAuthority::new(store.clone()));
    uncaptured.unlock().unwrap();
    let uncaptured = ProtectedStorage::new(admission, uncaptured);
    let mut reader = SecureStoreRuntime::new(SecureStoreAuthority::new(store));
    reader.unlock().unwrap();
    let storage = ProtectedStorage::new(admission, reader);
    assert!(storage
        .try_authority_snapshot(&mut StdFs)
        .unwrap()
        .is_some());
    let shared = SharedAdmissionGuard::try_acquire(admission)
        .unwrap()
        .unwrap();
    write(&mut writer, b"second").unwrap();
    drop(shared);
    for reader in [&storage, &uncaptured] {
        assert_eq!(
            reader
                .try_read_record(
                    &mut StdFs,
                    ProtectedRecord {
                        identity: &identity,
                        location: RecordLocation {
                            record_dir: &records,
                            marker_dir: &markers
                        }
                    },
                    payload,
                )
                .unwrap(),
            Some(b"second".to_vec())
        );
        assert!(reader.try_authority_snapshot(&mut StdFs).unwrap().is_some());
    }
    drop(uncaptured);
    drop(storage);
    let _ = fs::remove_dir_all(base);
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
        assert!(fixture.storage().try_list_records(&mut filesystem).is_err());
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
