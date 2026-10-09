//! Semantic 4B proof: admission covers observations, both root events, snapshot pins and handoff.

#[path = "support/operations.rs"]
mod support;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use support::{
    acquire_exclusive_until_available, acquire_shared_until_available, child_probe, payload,
    poll_admitted, Event, Fixture, HookFs, Interruption, ObservedProvider, Probe, Setup,
    CHILD_MODE, CHILD_SCOPE,
};
use worldscript_secure_storage::memory_provider::MemoryKeyProvider;
use worldscript_secure_storage::*;

#[test]
fn write_cas_and_two_root_events_are_one_admitted_operation() {
    let fixture = Fixture::new();
    let first = fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    assert_eq!((first.generation, first.root_generation), (1, 3));
    let second = fixture
        .write_until_admitted(&mut StdFs, Some(1), b"second")
        .unwrap();
    assert_eq!((second.generation, second.root_generation), (2, 5));
    assert_eq!(
        fixture.write_poll(&mut StdFs, Some(1), b"stale"),
        Err(OperationError::StaleGeneration)
    );
    assert_eq!(fixture.payload(), b"second");
    assert_eq!(
        poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs))
            .unwrap()
            .root_generation(),
        5
    );
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Ok(KeyState::Locked)
    );
}

#[test]
fn old_snapshot_survives_multiple_publishes_and_blocks_reclamation() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    let mut old = poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs)).unwrap();
    let witness = old.retention();
    fixture
        .write_until_admitted(&mut StdFs, Some(1), b"second")
        .unwrap();
    fixture
        .write_until_admitted(&mut StdFs, Some(2), b"third")
        .unwrap();
    assert_eq!(old.root_generation(), 3);
    assert_eq!(
        old.read_record(&mut StdFs, fixture.record(), payload)
            .unwrap(),
        b"first"
    );
    assert_eq!(fixture.payload(), b"third");
    assert!(witness.is_referenced());
    assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    drop(old);
    let held = acquire_exclusive_until_available(fixture.scope());
    assert!(!witness.is_referenced());
    assert!(fixture
        .storage()
        .root_reclamation_eligible(&held, &witness, false)
        .unwrap());
    assert!(!fixture
        .storage()
        .root_reclamation_eligible(&held, &witness, true)
        .unwrap());
    let other = Fixture::new();
    let wrong = acquire_exclusive_until_available(other.scope());
    assert_eq!(
        fixture
            .storage()
            .root_reclamation_eligible(&wrong, &witness, false),
        Err(OperationError::Admission(AdmissionError::IdentityChanged))
    );
    let foreign_witness = other
        .storage()
        .root_reclamation_eligible(&wrong, &witness, false);
    assert_eq!(
        foreign_witness,
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    );
}

#[test]
fn exclusive_admission_stays_unavailable_while_held_and_resolves_after_release() {
    let fixture = Fixture::new();
    let held = acquire_exclusive_until_available(fixture.scope());
    assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    drop(held);
    let _released = acquire_exclusive_until_available(fixture.scope());
}

#[test]
fn read_handoff_holds_admission_until_consumer_returns() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"value")
        .unwrap();
    let result = fixture
        .storage()
        .try_read_record(&mut StdFs, fixture.record(), |read| {
            assert_eq!(fixture.storage().try_lock(&mut StdFs).unwrap(), None);
            assert_eq!(fixture.storage().try_unlock(&mut StdFs).unwrap(), None);
            assert_eq!(fixture.storage().try_shutdown(&mut StdFs).unwrap(), None);
            payload(read)
        })
        .unwrap()
        .unwrap();
    assert_eq!(result, b"value");
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Ok(KeyState::Locked)
    );
}

#[test]
fn confirmed_lock_and_failed_unlock_retain_cross_process_exclusion() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"value")
        .unwrap();
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Ok(KeyState::Locked)
    );
    assert!(SharedAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    assert!(matches!(
        fixture.storage().try_authority_snapshot(&mut StdFs),
        Err(OperationError::Provider(KeyProviderError::Locked))
    ));
    child_probe(&fixture, "read");
    fixture.probe.fail_unlock.store(true, Ordering::SeqCst);
    assert!(fixture.storage().try_unlock(&mut StdFs).is_err());
    assert!(SharedAdmissionGuard::try_acquire(fixture.scope())
        .unwrap()
        .is_none());
    child_probe(&fixture, "write");
    fixture.probe.fail_unlock.store(false, Ordering::SeqCst);
    assert_eq!(
        poll_admitted(|| fixture.storage().try_unlock(&mut StdFs)),
        Ok(KeyState::Unlocked { epoch: 1 })
    );
    assert_eq!(fixture.payload(), b"value");
}

#[test]
fn retained_epoch_read_distinguishes_absence_from_transient_io() {
    let fixture = Fixture::new();
    let mut snapshot =
        poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs)).unwrap();
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
fn unwound_unlock_clears_keys_and_retains_exclusive_fence() {
    let fixture = Fixture::new();
    poll_admitted(|| fixture.storage().try_lock(&mut StdFs)).unwrap();
    let before = fixture.probe.lock_calls.load(Ordering::SeqCst);
    let mut filesystem = HookFs(|_: &std::path::Path, event| -> io::Result<()> {
        if event == Event::Read {
            panic!("injected unlock validation unwind");
        }
        Ok(())
    });
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = fixture.storage().try_unlock(&mut filesystem);
    }))
    .is_err());
    assert_eq!(fixture.probe.lock_calls.load(Ordering::SeqCst), before + 1);
    assert!(matches!(
        fixture.storage().try_authority_snapshot(&mut StdFs),
        Err(OperationError::RecoveryPending)
    ));
    child_probe(&fixture, "read");
    child_probe(&fixture, "write");
}

#[test]
fn exclusive_and_locked_or_migrating_plaintext_never_bypass_policy() {
    let fixture = Fixture::new();
    let legacy = fixture.records.join("legacy.txt");
    fs::write(&legacy, b"legacy plaintext fixture").unwrap();
    let held = acquire_exclusive_until_available(fixture.scope());
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
fn staging_keeps_shared_admission_but_not_root_mutex_and_serializes_writers() {
    let fixture = Fixture::new();
    let mut observed = false;
    let mut filesystem = HookFs(|path: &std::path::Path, event| {
        if event == Event::Create && path.parent() == Some(fixture.records.as_path()) {
            assert!(!observed);
            observed = true;
            assert!(ExclusiveAdmissionGuard::try_acquire(fixture.scope())
                .unwrap()
                .is_none());
            let shared = SharedAdmissionGuard::try_acquire(fixture.scope())
                .unwrap()
                .unwrap();
            let before = fixture.probe.observations.load(Ordering::SeqCst);
            assert!(fixture
                .write(&mut StdFs, None, b"competing")
                .unwrap()
                .is_none());
            assert!(fixture
                .storage()
                .try_reconcile_record(&mut StdFs, &fixture.identity, fixture.location())
                .unwrap()
                .is_none());
            assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), before);
            child_probe(&fixture, "transition");
            child_probe(&fixture, "write");
            // All admission probes precede this finite root guard: never invert the lock order.
            let root = RootCommitGuard::try_acquire(&fixture.root)
                .unwrap()
                .unwrap();
            drop(root);
            drop(shared);
        }
        Ok(())
    });
    fixture
        .write_until_admitted(&mut filesystem, None, b"first")
        .unwrap();
    assert!(observed);
    assert_eq!(fixture.payload(), b"first");
}

#[test]
fn pinned_reader_runs_at_both_pointer_before_anchor_windows_without_root_lock() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"prior")
        .unwrap();
    let storage = fixture.storage().clone();
    let identity = fixture.identity.clone();
    let (records, markers) = (fixture.records.clone(), fixture.markers.clone());
    let (ready_tx, ready_rx) = mpsc::channel();
    let (read_tx, read_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let reader = thread::spawn(move || {
        // Acquire admission BEFORE the writer's root event; the signal never acquires admission.
        let mut snapshot = poll_admitted(|| storage.try_authority_snapshot(&mut StdFs)).unwrap();
        ready_tx.send(()).unwrap();
        for _ in 0..2 {
            read_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            let value = snapshot
                .read_record(
                    &mut StdFs,
                    ProtectedRecord {
                        identity: &identity,
                        location: RecordLocation {
                            record_dir: &records,
                            marker_dir: &markers,
                        },
                    },
                    payload,
                )
                .unwrap();
            result_tx.send(value).unwrap();
        }
    });
    ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    let mut windows = 0;
    let mut filesystem = HookFs(|path: &std::path::Path, event| {
        if event == Event::Renamed && path == fixture.root.join("pointer") {
            windows += 1;
            read_tx.send(()).unwrap();
            assert_eq!(
                result_rx.recv_timeout(Duration::from_secs(10)).unwrap(),
                b"prior"
            );
        }
        Ok(())
    });
    fixture
        .write_until_admitted(&mut filesystem, Some(1), b"new")
        .unwrap();
    reader.join().unwrap();
    assert_eq!(windows, 2);
    assert_eq!(fixture.payload(), b"new");
}

#[test]
fn cas_is_checked_after_recovery_publishes_completed_pending_generation() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    let mut pages = 0;
    let mut filesystem = HookFs(|path: &std::path::Path, event| {
        if event == Event::Create && path.starts_with(fixture.root.join("catalog")) {
            pages += 1;
            if pages == 2 {
                return Err(io::Error::other("injected ACTIVE catalog failure"));
            }
        }
        Ok(())
    });
    assert!(fixture
        .write_poll(&mut filesystem, Some(1), b"completed pending")
        .is_err());
    assert_eq!(pages, 2);
    assert_eq!(fixture.payload(), b"first");
    assert_eq!(
        poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
        Err(OperationError::RecoveryPending)
    );
    assert_eq!(
        fixture.write_poll(&mut StdFs, Some(1), b"must not overwrite"),
        Err(OperationError::StaleGeneration)
    );
    assert_eq!(fixture.payload(), b"completed pending");
    assert_eq!(
        fixture
            .write_until_admitted(&mut StdFs, Some(2), b"third")
            .unwrap()
            .generation,
        3
    );
}

#[test]
fn cancellation_preserves_pending_data_and_releases_all_kernel_ownership() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"prior")
        .unwrap();
    let mut filesystem = HookFs(|path: &std::path::Path, event| -> io::Result<()> {
        if event == Event::Create && path.parent() == Some(fixture.records.as_path()) {
            panic!("injected cancellation during staging");
        }
        Ok(())
    });
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fixture
            .write_poll(&mut filesystem, Some(1), b"candidate")
            .unwrap();
    }))
    .is_err());
    assert_eq!(fixture.payload(), b"prior");
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Err(OperationError::RecoveryPending)
    );
    drop(acquire_exclusive_until_available(fixture.scope()));
    poll_admitted(|| {
        fixture
            .storage()
            .try_reconcile_record(&mut StdFs, &fixture.identity, fixture.location())
    })
    .unwrap();
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Ok(KeyState::Locked)
    );
    assert_eq!(
        poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
        Ok(())
    );
    assert!(matches!(
        fixture.storage().try_authority_snapshot(&mut StdFs),
        Err(OperationError::Closed)
    ));
}

#[test]
fn location_cannot_escape_installation_or_enter_reserved_writer_scope() {
    let fixture = Fixture::new();
    let foreign = Fixture::new();
    let misrouted = ProtectedRecord {
        location: foreign.location(),
        ..fixture.record()
    };
    assert_eq!(
        fixture
            .storage()
            .try_read_record(&mut StdFs, misrouted, |_| ()),
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    );
    assert_eq!(
        fixture.storage().try_write_record(
            &mut StdFs,
            ProtectedMutation {
                record: misrouted,
                ..fixture.mutation(None, b"wrong scope")
            }
        ),
        Err(OperationError::Admission(AdmissionError::InvalidScope))
    );
    let reserved = fixture.base.join("ordinary-writers");
    let probe = Arc::new(Probe::default());
    let collision = ProtectedStorage::new(
        AdmissionScope {
            installation_dir: &fixture.base,
            root_dir: &reserved,
        },
        ObservedProvider(MemoryKeyProvider::new(), probe.clone()),
    );
    for result in [
        collision
            .try_write_record(&mut StdFs, fixture.mutation(None, b"reserved root"))
            .map(|_| ()),
        collision.try_authority_snapshot(&mut StdFs).map(|_| ()),
        collision
            .try_read_record(&mut StdFs, fixture.record(), |_| ())
            .map(|_| ()),
        collision.try_lock(&mut StdFs).map(|_| ()),
        collision.try_unlock(&mut StdFs).map(|_| ()),
        collision.try_shutdown(&mut StdFs).map(|_| ()),
    ] {
        assert_eq!(
            result,
            Err(OperationError::Admission(AdmissionError::InvalidScope))
        );
    }
    assert_eq!(probe.observations.load(Ordering::SeqCst), 0);
}

#[test]
fn shutdown_is_local_idempotent_close_and_releases_admission() {
    let fixture = Fixture::new();
    assert_eq!(
        poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
        Ok(())
    );
    assert_eq!(
        poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
        Ok(())
    );
    assert_eq!(
        fixture.write(&mut StdFs, None, b"closed"),
        Err(OperationError::Closed)
    );
    drop(acquire_shared_until_available(fixture.scope()));
}

#[test]
fn snapshot_is_send_and_two_readers_pin_across_three_writer_operations() {
    fn send<T: Send>() {}
    send::<AuthoritySnapshotGuard>();
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"baseline")
        .unwrap();
    let mut readers = Vec::new();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (racing_tx, racing_rx) = mpsc::channel();
    let finished = Arc::new(AtomicBool::new(false));
    for _ in 0..2 {
        let reader = support::PinnedReader {
            storage: fixture.storage().clone(),
            identity: fixture.identity.clone(),
            records: fixture.records.clone(),
            markers: fixture.markers.clone(),
        };
        let (ready, racing, finished) = (ready_tx.clone(), racing_tx.clone(), finished.clone());
        readers.push(thread::spawn(move || reader.run(ready, racing, finished)));
    }
    for _ in 0..2 {
        ready_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    }
    let mut filesystem = HookFs(|path: &std::path::Path, event| {
        if event == Event::Create && path.parent() == Some(fixture.records.as_path()) {
            for _ in 0..2 {
                racing_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }
        }
        Ok(())
    });
    fixture
        .write_until_admitted(&mut filesystem, Some(1), b"next")
        .unwrap();
    for generation in 2..=3 {
        fixture
            .write_until_admitted(&mut StdFs, Some(generation), b"next")
            .unwrap();
    }
    assert_eq!(fixture.storage().try_lock(&mut StdFs).unwrap(), None);
    finished.store(true, Ordering::Release);
    for reader in readers {
        reader.join().unwrap();
    }
    assert_eq!(
        poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
        Ok(KeyState::Locked)
    );
}

#[test]
fn current_and_previous_root_remain_retained_after_their_reader_releases() {
    let fixture = Fixture::new();
    #[cfg(unix)]
    let fixture = {
        let alias = fixture.base.join("aliased-temp");
        std::os::unix::fs::symlink(&fixture.base, &alias).unwrap();
        assert_ne!(alias, fs::canonicalize(&alias).unwrap());
        // Deterministically exercise macOS's equivalent /var -> /private/var ancestor alias.
        let candidate = Fixture::new_in(&alias);
        let lexical_records = alias
            .join(candidate.base.file_name().unwrap())
            .join("records");
        assert_ne!(lexical_records, candidate.records);
        assert_eq!(
            fs::canonicalize(lexical_records).unwrap(),
            candidate.records
        );
        candidate
    };
    fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    let mut previous = None;
    let mut filesystem = HookFs(|path: &std::path::Path, event| {
        if event == Event::Create && path.parent() == Some(fixture.records.as_path()) {
            previous = fixture
                .storage()
                .try_authority_snapshot(&mut StdFs)
                .unwrap();
        }
        Ok(())
    });
    fixture
        .write_until_admitted(&mut filesystem, Some(1), b"second")
        .unwrap();
    let previous = previous.expect("canonical record staging hook must capture the previous root");
    assert_eq!(previous.root_generation(), 4);
    let previous_witness = previous.retention();
    drop(previous);
    let current = poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs)).unwrap();
    let current_witness = current.retention();
    drop(current);
    let held = acquire_exclusive_until_available(fixture.scope());
    assert!(!fixture
        .storage()
        .root_reclamation_eligible(&held, &previous_witness, false)
        .unwrap());
    assert!(!fixture
        .storage()
        .root_reclamation_eligible(&held, &current_witness, false)
        .unwrap());
}

#[test]
fn both_root_contention_windows_preserve_intents_and_refuse_clean_drain() {
    for blocked_marker in 1..=2 {
        let fixture = Fixture::new();
        fixture
            .write_until_admitted(&mut StdFs, None, b"prior")
            .unwrap();
        let mut held_root = None;
        let mut marker_creates = 0;
        let mut filesystem = HookFs(|path: &std::path::Path, event| {
            if event == Event::Create && path.parent() == Some(fixture.markers.as_path()) {
                marker_creates += 1;
                if marker_creates == blocked_marker {
                    // Inject at PENDING or ACTIVE, always below this operation's existing admission.
                    held_root = RootCommitGuard::try_acquire(&fixture.root).unwrap();
                    assert!(held_root.is_some());
                }
            }
            Ok(())
        });
        assert_eq!(
            fixture.write_poll(&mut filesystem, Some(1), b"candidate"),
            Err(OperationError::Protected(ProtectedError::RootBusy))
        );
        drop(held_root);
        assert_eq!(fixture.payload(), b"prior");
        let mut wrong = fixture.location();
        std::mem::swap(&mut wrong.record_dir, &mut wrong.marker_dir);
        // No admission is held here, so `Ok(None)` can only be the legal eventual-release delay.
        assert_eq!(
            poll_admitted(|| fixture.storage().try_reconcile_record(
                &mut StdFs,
                &fixture.identity,
                wrong
            )),
            Err(OperationError::Admission(AdmissionError::IdentityChanged))
        );
        assert_eq!(
            poll_admitted(|| fixture.storage().try_lock(&mut StdFs)),
            Err(OperationError::RecoveryPending)
        );
        assert_eq!(
            poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
            Err(OperationError::RecoveryPending)
        );
        poll_admitted(|| {
            fixture.storage().try_reconcile_record(
                &mut StdFs,
                &fixture.identity,
                fixture.location(),
            )
        })
        .unwrap();
        assert_eq!(
            fixture.payload(),
            if blocked_marker == 1 {
                b"prior".as_slice()
            } else {
                b"candidate"
            }
        );
        assert_eq!(
            poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
            Ok(())
        );
    }
}

#[test]
fn nonordinary_member_is_refused_before_coordination_or_authority_observation() {
    let fixture = Fixture::new();
    let member = RecordIdentity::new(RecordClass::Asset, &["p1", "a1"]).unwrap();
    let record = ProtectedRecord {
        identity: &member,
        ..fixture.record()
    };
    let error = OperationError::Protected(ProtectedError::NotAnOrdinaryRecord);
    assert_eq!(
        fixture
            .storage()
            .try_read_record(&mut StdFs, record, |_| ()),
        Err(error.clone())
    );
    assert_eq!(
        fixture.storage().try_write_record(
            &mut StdFs,
            ProtectedMutation {
                record,
                ..fixture.mutation(None, b"member")
            }
        ),
        Err(error)
    );
    assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), 0);
    assert!(!fixture.base.join("ordinary-writers").exists());
}

#[cfg(unix)]
#[test]
fn eligibility_refuses_root_replacement_during_anchor_observation() {
    let fixture = Fixture::new();
    fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    let pin = poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs)).unwrap();
    let witness = pin.retention();
    drop(pin);
    fixture
        .write_until_admitted(&mut StdFs, Some(1), b"second")
        .unwrap();
    let held = acquire_exclusive_until_available(fixture.scope());
    *fixture.probe.replace_root.lock().unwrap() =
        Some((fixture.root.clone(), fixture.base.join("moved-root")));
    assert_eq!(
        fixture
            .storage()
            .root_reclamation_eligible(&held, &witness, false),
        Err(OperationError::Admission(AdmissionError::IdentityChanged))
    );
}

#[test]
fn operation_child() {
    let Ok(base) = std::env::var(CHILD_SCOPE) else {
        return;
    };
    let base = PathBuf::from(base);
    let probe = Arc::new(Probe::default());
    let storage = ProtectedStorage::new(
        AdmissionScope {
            installation_dir: &base,
            root_dir: &base.join("authority"),
        },
        ObservedProvider(MemoryKeyProvider::new(), probe.clone()),
    );
    let identity = RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap();
    let (records, markers) = (base.join("records"), base.join("markers"));
    let location = RecordLocation {
        record_dir: &records,
        marker_dir: &markers,
    };
    let record = ProtectedRecord {
        identity: &identity,
        location,
    };
    match std::env::var(CHILD_MODE).unwrap().as_str() {
        "transition" => assert_eq!(storage.try_unlock(&mut StdFs).unwrap(), None),
        "write" => assert_eq!(
            storage
                .try_write_record(
                    &mut StdFs,
                    ProtectedMutation {
                        record,
                        expected_generation: None,
                        write: ProtectedWrite {
                            record_schema: 1,
                            plaintext: b"must not enter"
                        }
                    }
                )
                .unwrap(),
            None
        ),
        "read" => assert_eq!(
            storage
                .try_read_record(&mut StdFs, record, |_| panic!("unadmitted handoff"))
                .unwrap(),
            None
        ),
        _ => panic!("unknown child mode"),
    }
    assert_eq!(probe.observations.load(Ordering::SeqCst), 0);
}

// Gate 4E E1: a committed root that binds a live migration makes the storage refuse ordinary
// operations, under the conditions stated here.
//
// With an unlocked provider, a loadable catalog and no interrupted root commit pending, every ordinary
// operation is refused in every phase: the data operations in `catalog()` from the committed root,
// before any catalog page is read, and the lifecycle transitions in `verify_transition` after the
// catalog is loaded. The refusal is durable across a crash, needs no journal read and does not depend
// on the migration phase. The cases below also pin a provider that starts locked, a lost catalog page
// and an interrupted root commit; the codes for other catalog load failures are not pinned. It is
// stricter than contract §10.3, which admits ordinary reads and writes while `PREPARE` lasts (the
// relaxation is a later slice). Every storage below is built after the binding was committed: a cold
// start that never observed an unbound tree.

fn barrier_binding(operation: &str, fence: u64, revision: u64, digest: u8) -> LiveMigration {
    LiveMigration {
        operation_id: operation.into(),
        fencing_generation: fence,
        journal_revision: revision,
        manifest_digest: [digest; 32],
    }
}

/// A binding that names no journal at all: the storage never reads one.
fn barrier_bound() -> Fixture {
    Fixture::new_bound(barrier_binding("barrier-operation", 1, 1, 0xAB))
}

/// The writer's coordination directory inside the installation (a private constant of the crate): a
/// refused write creates it before the catalog is read. It is a lock, not state.
const BARRIER_WRITER_RESOURCE: &str = "ordinary-writers";

fn barrier_is_coordination(name: &std::ffi::OsStr) -> bool {
    name == OPERATION_ADMISSION_LOCK_FILE || name == BARRIER_WRITER_RESOURCE
}

/// What an entry of the installation tree is, recorded without following links: a symlink is its
/// target, never the directory or the bytes behind it.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BarrierNode {
    Directory,
    File(Vec<u8>),
    Link(PathBuf),
}

/// Every entry under `dir`, with its path relative to `base`. The two coordination resources are
/// skipped only where they live, directly under the installation (`dir == base`); a same-named entry
/// anywhere deeper is part of the comparison.
fn barrier_collect(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, BarrierNode)>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        if dir == base && barrier_is_coordination(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap().to_owned();
        let kind = entry.file_type().unwrap();
        if kind.is_symlink() {
            out.push((relative, BarrierNode::Link(fs::read_link(&path).unwrap())));
        } else if kind.is_dir() {
            out.push((relative, BarrierNode::Directory));
            barrier_collect(base, &path, out);
        } else {
            out.push((relative, BarrierNode::File(fs::read(&path).unwrap())));
        }
    }
}

/// The installation tree, sorted: the authority root, the records, the markers and anything else a
/// write could create, apart from the two top-level coordination resources, which are compared by
/// `barrier_coordination_holds_no_data` instead.
fn barrier_tree(fixture: &Fixture) -> Vec<(PathBuf, BarrierNode)> {
    let mut nodes = Vec::new();
    barrier_collect(&fixture.base, &fixture.base, &mut nodes);
    nodes.sort();
    nodes
}

/// Whether the coordination resources hold no data. A missing path is empty. A symlink, including a
/// dangling one or one whose target is empty, is not: `symlink_metadata` does not follow it, so the
/// link itself is the entry. A directory is empty only when every child is. Only a regular file may
/// be data-free, and only at length zero. A FIFO, socket, or device is not, even when its length is
/// zero.
fn barrier_coordination_holds_no_data(fixture: &Fixture) -> bool {
    fn holds_no_data(path: &Path) -> bool {
        let meta = match fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return true,
            Err(_) => return false,
        };
        if meta.file_type().is_symlink() {
            return false;
        }
        if meta.is_dir() {
            return fs::read_dir(path)
                .unwrap()
                .all(|entry| holds_no_data(&entry.unwrap().path()));
        }
        meta.file_type().is_file() && meta.len() == 0
    }
    holds_no_data(&fixture.base.join(BARRIER_WRITER_RESOURCE))
        && holds_no_data(&fixture.base.join(OPERATION_ADMISSION_LOCK_FILE))
}

#[test]
fn a_bound_root_refuses_a_write_and_writes_nothing() {
    let fixture = barrier_bound();
    let before = barrier_tree(&fixture);
    assert!(!before.is_empty(), "the root itself is part of the tree");
    let first = fixture.write_poll(&mut StdFs, None, b"first");
    let second = fixture.write_poll(&mut StdFs, Some(1), b"second");
    // The refusal came after the writer's coordination directory was created: a lock, holding no data.
    assert!(barrier_coordination_holds_no_data(&fixture));
    assert_eq!(
        (first, second, barrier_tree(&fixture) == before),
        (
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            true
        )
    );
}

#[test]
fn a_bound_root_refuses_a_read_a_list_and_a_reconcile_and_writes_nothing() {
    let fixture = barrier_bound();
    let before = barrier_tree(&fixture);
    let read = poll_admitted(|| {
        fixture
            .storage()
            .try_read_record(&mut StdFs, fixture.record(), payload)
    });
    let list = poll_admitted(|| fixture.storage().try_list_records(&mut StdFs));
    let reconcile = poll_admitted(|| {
        fixture
            .storage()
            .try_reconcile_record(&mut StdFs, &fixture.identity, fixture.location())
    });
    assert!(barrier_coordination_holds_no_data(&fixture));
    assert_eq!(
        (
            read,
            list.map(|_| ()),
            reconcile.map(|_| ()),
            barrier_tree(&fixture) == before
        ),
        (
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            true
        )
    );
}

#[test]
fn a_snapshot_over_a_bound_root_reads_nothing() {
    let fixture = barrier_bound();
    let before = barrier_tree(&fixture);
    let mut guard = poll_admitted(|| fixture.storage().try_authority_snapshot(&mut StdFs))
        .expect("the snapshot itself is not what the binding refuses");
    let list = guard.list_records(&mut StdFs).map(|_| ());
    let read = guard.read_record(&mut StdFs, fixture.record(), payload);
    drop(guard);
    assert_eq!(
        (list, read, barrier_tree(&fixture) == before),
        (
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            true
        )
    );
}

#[test]
fn a_bound_root_refuses_to_lock_and_the_storage_stays_usable_for_refusals() {
    let fixture = barrier_bound();
    let lock = poll_admitted(|| fixture.storage().try_lock(&mut StdFs)).map(|_| ());
    assert_eq!(lock, Err(OperationError::RecoveryPending));
    // The refusal changed nothing the next operation depends on.
    assert_eq!(
        fixture.write_poll(&mut StdFs, None, b"later"),
        Err(OperationError::MigrationRequired)
    );
}

#[test]
fn a_bound_root_refuses_to_unlock() {
    let fixture = barrier_bound();
    let unlock = poll_admitted(|| fixture.storage().try_unlock(&mut StdFs)).map(|_| ());
    assert_eq!(unlock, Err(OperationError::RecoveryPending));
}

#[test]
fn a_bound_root_refuses_to_shut_down() {
    let fixture = barrier_bound();
    let shutdown = poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs));
    assert_eq!(shutdown, Err(OperationError::RecoveryPending));
}

#[test]
fn a_provider_that_starts_locked_stays_locked_over_a_bound_root() {
    let fixture = Fixture::new_bound_locked(barrier_binding("barrier-operation", 1, 1, 0xAB));
    let before = barrier_tree(&fixture);
    // Locking a locked provider is idempotent: nothing is unlocked and nothing is admitted, so the
    // root is not consulted; the barrier shows where a key would be needed.
    let lock = poll_admitted(|| fixture.storage().try_lock(&mut StdFs));
    let unlock = poll_admitted(|| fixture.storage().try_unlock(&mut StdFs)).map(|_| ());
    let write = fixture.write_poll(&mut StdFs, None, b"v");
    assert_eq!(
        (lock, unlock, write, barrier_tree(&fixture) == before),
        (
            Ok(KeyState::Locked),
            Err(OperationError::RecoveryPending),
            Err(OperationError::Provider(KeyProviderError::Locked)),
            true
        )
    );
}

#[test]
fn a_restart_that_starts_locked_cannot_unlock_over_a_bound_root() {
    let fixture = Fixture::new_bound_locked(barrier_binding("barrier-operation", 1, 1, 0xAB));
    let before = barrier_tree(&fixture);
    let unlock = poll_admitted(|| fixture.storage().try_unlock(&mut StdFs)).map(|_| ());
    // The failed unlock cleared the runtime keys again and kept its exclusive fence.
    let keys_cleared = fixture.probe.lock_calls.load(Ordering::SeqCst) > 0;
    let write = fixture.write_poll(&mut StdFs, None, b"v");
    assert_eq!(
        (
            unlock,
            keys_cleared,
            write,
            barrier_tree(&fixture) == before
        ),
        (
            Err(OperationError::RecoveryPending),
            true,
            Err(OperationError::Provider(KeyProviderError::Locked)),
            true
        )
    );
}

#[test]
fn the_barrier_snapshot_sees_every_change_but_the_two_coordination_resources_at_the_top() {
    let fixture = barrier_bound();
    let baseline = barrier_tree(&fixture);
    // Skipped where they live: the comparison ignores the top-level writer directory, and what it
    // holds is watched by the separate data check.
    let writer = fixture.base.join(BARRIER_WRITER_RESOURCE);
    fs::create_dir_all(&writer).unwrap();
    fs::write(writer.join("lock"), b"x").unwrap();
    let skipped = (
        barrier_tree(&fixture) == baseline,
        barrier_coordination_holds_no_data(&fixture),
    );
    fs::remove_dir_all(&writer).unwrap();
    // Seen everywhere else, a same-named entry deeper down included.
    let mut seen = Vec::new();
    for (path, is_dir) in [
        (fixture.base.join("stray"), false),
        (fixture.markers.join("new-directory"), true),
        (fixture.markers.join(BARRIER_WRITER_RESOURCE), true),
        (fixture.root.join(OPERATION_ADMISSION_LOCK_FILE), false),
    ] {
        if is_dir {
            fs::create_dir(&path).unwrap();
        } else {
            fs::write(&path, b"x").unwrap();
        }
        seen.push(barrier_tree(&fixture) != baseline);
        if is_dir {
            fs::remove_dir(&path).unwrap();
        } else {
            fs::remove_file(&path).unwrap();
        }
    }
    // Changed bytes of an existing file.
    let file = baseline
        .iter()
        .find(|(path, node)| matches!(node, BarrierNode::File(_)) && path.starts_with("authority"))
        .map(|(path, _)| fixture.base.join(path))
        .unwrap();
    let original = fs::read(&file).unwrap();
    let mut changed = original.clone();
    changed.push(0);
    fs::write(&file, &changed).unwrap();
    seen.push(barrier_tree(&fixture) != baseline);
    fs::write(&file, &original).unwrap();
    #[cfg(unix)]
    let links = barrier_symlinks_are_seen(&fixture, &baseline, &file);
    #[cfg(not(unix))]
    let links = (true, true);
    assert_eq!(
        (skipped, seen, links, barrier_tree(&fixture) == baseline),
        ((true, false), vec![true; 5], (true, true), true)
    );
}

/// A file replaced by a symlink to an outside copy with the same bytes, and an empty directory
/// replaced by a symlink to another empty directory, must both change the snapshot. Unix only:
/// creating a symlink needs no privilege there.
#[cfg(unix)]
fn barrier_symlinks_are_seen(
    fixture: &Fixture,
    baseline: &[(PathBuf, BarrierNode)],
    file: &Path,
) -> (bool, bool) {
    use std::os::unix::fs::symlink;
    let outside = fixture.base.with_extension("outside");
    fs::create_dir_all(&outside).unwrap();
    let original = fs::read(file).unwrap();
    let copy = outside.join("copy");
    fs::write(&copy, &original).unwrap();
    fs::remove_file(file).unwrap();
    symlink(&copy, file).unwrap();
    let file_seen = barrier_tree(fixture) != baseline;
    fs::remove_file(file).unwrap();
    fs::write(file, &original).unwrap();
    let empty = outside.join("empty");
    fs::create_dir(&empty).unwrap();
    fs::remove_dir(&fixture.markers).unwrap();
    symlink(&empty, &fixture.markers).unwrap();
    let directory_seen = barrier_tree(fixture) != baseline;
    fs::remove_file(&fixture.markers).unwrap();
    fs::create_dir(&fixture.markers).unwrap();
    fs::remove_dir_all(&outside).unwrap();
    (file_seen, directory_seen)
}

/// A symlink at either coordination resource, or inside the writer directory, is not data-free,
/// even when the target is missing or empty.
#[cfg(unix)]
#[test]
fn a_symlink_at_a_coordination_resource_is_not_data_free() {
    use std::os::unix::fs::symlink;

    fn replace_with_link(path: &Path, target: &Path) {
        if let Ok(meta) = fs::symlink_metadata(path) {
            if meta.is_dir() && !meta.file_type().is_symlink() {
                fs::remove_dir_all(path).unwrap();
            } else {
                fs::remove_file(path).unwrap();
            }
        }
        symlink(target, path).unwrap();
    }

    let fixture = barrier_bound();
    let outside = fixture.base.with_extension("coord-outside");
    fs::create_dir_all(&outside).unwrap();
    let empty = outside.join("empty");
    fs::write(&empty, b"").unwrap();
    let writer = fixture.base.join(BARRIER_WRITER_RESOURCE);
    let lock = fixture.base.join(OPERATION_ADMISSION_LOCK_FILE);

    replace_with_link(&writer, &empty);
    let writer_link = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&writer).unwrap();

    fs::create_dir(&writer).unwrap();
    symlink(&empty, writer.join("lock")).unwrap();
    let nested_link = barrier_coordination_holds_no_data(&fixture);
    fs::remove_dir_all(&writer).unwrap();

    replace_with_link(&lock, &empty);
    let lock_link = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&lock).unwrap();

    replace_with_link(&writer, &outside.join("missing"));
    let dangling = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&writer).unwrap();

    fs::write(&lock, b"").unwrap();
    let empty_file = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&lock).unwrap();
    fs::remove_dir_all(&outside).unwrap();

    assert_eq!(
        (writer_link, nested_link, lock_link, dangling, empty_file),
        (false, false, false, false, true)
    );
}

/// A zero-length FIFO or Unix socket at a coordination resource is not data-free.
#[cfg(unix)]
#[test]
fn a_fifo_or_socket_at_a_coordination_resource_is_not_data_free() {
    use std::os::unix::net::UnixListener;
    use std::process::Command;

    fn remove_path(path: &Path) {
        if let Ok(meta) = fs::symlink_metadata(path) {
            if meta.is_dir() && !meta.file_type().is_symlink() {
                fs::remove_dir_all(path).unwrap();
            } else {
                fs::remove_file(path).unwrap();
            }
        }
    }

    let fixture = barrier_bound();
    let writer = fixture.base.join(BARRIER_WRITER_RESOURCE);
    let lock = fixture.base.join(OPERATION_ADMISSION_LOCK_FILE);

    remove_path(&lock);
    let created = Command::new("mkfifo").arg(&lock).status().unwrap();
    assert!(created.success(), "mkfifo must create the lock-path FIFO");
    let fifo = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&lock).unwrap();

    remove_path(&writer);
    fs::create_dir(&writer).unwrap();
    let socket_path = writer.join("admission.sock");
    let listener = UnixListener::bind(&socket_path).unwrap();
    let socket = barrier_coordination_holds_no_data(&fixture);
    drop(listener);
    fs::remove_dir_all(&writer).unwrap();

    fs::write(&lock, b"").unwrap();
    let empty_file = barrier_coordination_holds_no_data(&fixture);
    fs::remove_file(&lock).unwrap();

    assert_eq!((fifo, socket, empty_file), (false, false, true));
}

fn barrier_paged() -> Setup {
    Setup {
        bound: Some(barrier_binding("barrier-operation", 1, 1, 0xAB)),
        page: true,
        ..Setup::default()
    }
}

/// The catalog pages on disk under the authority root, all removed; how many there were.
fn barrier_remove_catalog_pages(fixture: &Fixture) -> usize {
    fn remove(dir: &Path) -> usize {
        let mut removed = 0;
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                removed += remove(&path);
            } else {
                fs::remove_file(&path).unwrap();
                removed += 1;
            }
        }
        removed
    }
    remove(&fixture.root.join("catalog"))
}

/// Lock (0), unlock (1) or shutdown (2) on a fresh storage built from `setup`, as its outcome.
fn barrier_transition(
    setup: Setup,
    which: usize,
    damage: impl FnOnce(&Fixture),
) -> Result<(), OperationError> {
    let fixture = Fixture::with_setup(setup);
    damage(&fixture);
    match which {
        0 => poll_admitted(|| fixture.storage().try_lock(&mut StdFs)).map(|_| ()),
        1 => poll_admitted(|| fixture.storage().try_unlock(&mut StdFs)).map(|_| ()),
        _ => poll_admitted(|| fixture.storage().try_shutdown(&mut StdFs)),
    }
}

#[test]
fn a_bound_root_with_an_intact_catalog_page_refuses_the_transitions_with_recovery_pending() {
    let outcomes: Vec<_> = (0..3)
        .map(|which| barrier_transition(barrier_paged(), which, |_| {}))
        .collect();
    assert_eq!(outcomes, vec![Err(OperationError::RecoveryPending); 3]);
}

#[test]
fn a_bound_root_that_lost_a_catalog_page_fails_the_transitions_with_the_set_mismatch() {
    let mismatch = OperationError::Catalog(AuthorityError::RecoveryRequired(
        CatalogRecoveryReason::CatalogSetMismatch,
    ));
    let outcomes: Vec<_> = (0..3)
        .map(|which| {
            barrier_transition(barrier_paged(), which, |fixture| {
                assert!(
                    barrier_remove_catalog_pages(fixture) > 0,
                    "the catalog has a page"
                );
            })
        })
        .collect();
    // `load_catalog` returns `None` only when no root is committed: this is a committed, bound
    // root, so a missing page is a set mismatch, never `MigrationRequired` and never `RecoveryPending`.
    assert_eq!(outcomes, vec![Err(mismatch); 3]);
}

#[test]
fn a_bound_root_that_lost_a_catalog_page_is_still_refused_before_any_page_is_read() {
    let fixture = Fixture::with_setup(barrier_paged());
    assert!(
        barrier_remove_catalog_pages(&fixture) > 0,
        "the catalog has a page"
    );
    let write = fixture.write_poll(&mut StdFs, None, b"v");
    let list = poll_admitted(|| fixture.storage().try_list_records(&mut StdFs)).map(|_| ());
    let read = poll_admitted(|| {
        fixture
            .storage()
            .try_read_record(&mut StdFs, fixture.record(), payload)
    });
    let reconcile = poll_admitted(|| {
        fixture
            .storage()
            .try_reconcile_record(&mut StdFs, &fixture.identity, fixture.location())
    })
    .map(|_| ());
    // The data operations check the binding in `catalog()` before the pages are read.
    assert_eq!(
        (write, list, read, reconcile),
        (
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired),
            Err(OperationError::MigrationRequired)
        )
    );
}

/// A bound root followed by an ordinary root commit that stopped as `how` says, on a fresh storage.
fn barrier_interrupted(how: Interruption) -> Fixture {
    Fixture::with_setup(Setup {
        bound: Some(barrier_binding("barrier-operation", 1, 1, 0xAB)),
        interrupted: Some(how),
        ..Setup::default()
    })
}

// The root recovers the durable preparation first (not an ordinary write). Two outcomes exist: the
// commit is completed, or it is discarded. Either way the committed root carries the binding, because
// the interrupted commit is an ordinary catalog commit that copies it forward. Each operation gets its
// own fixture, so neither runs against a root that the other already recovered.
const BARRIER_RECOVERY_OUTCOMES: [Interruption; 2] =
    [Interruption::AtAnchorCommit, Interruption::AfterPrepare];

#[test]
fn a_write_over_an_interrupted_root_commit_is_refused_whatever_the_root_recovery_decides() {
    let outcomes: Vec<_> = BARRIER_RECOVERY_OUTCOMES
        .into_iter()
        .map(|how| barrier_interrupted(how).write_poll(&mut StdFs, None, b"v"))
        .collect();
    assert_eq!(outcomes, vec![Err(OperationError::MigrationRequired); 2]);
}

#[test]
fn a_reconcile_over_an_interrupted_root_commit_is_refused_whatever_the_root_recovery_decides() {
    let outcomes: Vec<_> = BARRIER_RECOVERY_OUTCOMES
        .into_iter()
        .map(|how| {
            let fixture = barrier_interrupted(how);
            poll_admitted(|| {
                fixture.storage().try_reconcile_record(
                    &mut StdFs,
                    &fixture.identity,
                    fixture.location(),
                )
            })
            .map(|_| ())
        })
        .collect();
    assert_eq!(outcomes, vec![Err(OperationError::MigrationRequired); 2]);
}

#[test]
fn a_provider_that_starts_locked_unlocks_over_an_unbound_root() {
    let fixture = Fixture::new_locked();
    let unlocked = poll_admitted(|| fixture.storage().try_unlock(&mut StdFs))
        .map(|state| matches!(state, KeyState::Unlocked { .. }));
    assert_eq!(unlocked, Ok(true));
    let committed = fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    assert_eq!(committed.generation, 1);
}

#[test]
fn the_refusal_is_the_roots_alone_whatever_the_binding_names() {
    // Different operations, fences, revisions and digests; none names a journal that exists.
    let bindings = [
        barrier_binding("barrier-operation", 1, 1, 0xAB),
        barrier_binding("another-operation", 7, 9, 0x01),
        barrier_binding("x", 2, 100, 0xFF),
    ];
    let outcomes: Vec<_> = bindings
        .into_iter()
        .map(|binding| {
            let fixture = Fixture::new_bound(binding);
            fixture.write_poll(&mut StdFs, None, b"v")
        })
        .collect();
    assert_eq!(outcomes, vec![Err(OperationError::MigrationRequired); 3]);
}

#[test]
fn the_same_tree_without_the_binding_admits_the_operations() {
    let fixture = Fixture::new();
    let committed = fixture
        .write_until_admitted(&mut StdFs, None, b"first")
        .unwrap();
    assert_eq!(committed.generation, 1);
    assert_eq!(fixture.payload(), b"first");
    let list = poll_admitted(|| fixture.storage().try_list_records(&mut StdFs)).unwrap();
    assert_eq!(list.len(), 1);
    let lock = poll_admitted(|| fixture.storage().try_lock(&mut StdFs)).unwrap();
    assert_eq!(lock, KeyState::Locked);
}

#[test]
fn a_storage_built_over_a_bound_root_observed_nothing_before_it_refuses() {
    let fixture = barrier_bound();
    // Construction performs no observation, so the refusal below comes from what the first
    // operation reads from the tree, not from anything the storage remembered.
    assert_eq!(fixture.probe.observations.load(Ordering::SeqCst), 0);
    assert_eq!(
        fixture.write_poll(&mut StdFs, None, b"v"),
        Err(OperationError::MigrationRequired)
    );
    assert!(fixture.probe.observations.load(Ordering::SeqCst) > 0);
}
