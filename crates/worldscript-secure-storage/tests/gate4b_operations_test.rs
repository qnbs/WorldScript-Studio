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
    poll_admitted, Event, Fixture, HookFs, ObservedProvider, Probe, CHILD_MODE, CHILD_SCOPE,
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

// Gate 4E E1: a committed root that binds a live migration refuses every ordinary operation.
//
// The barrier is the authenticated root alone (`catalog()` and `verify_transition`), so it is durable
// across a crash, needs no journal read and does not depend on the migration phase. It is stricter
// than contract §10.3, which admits ordinary reads and writes while `PREPARE` lasts (the relaxation
// is a later slice). Every storage below is built after the binding was committed: a cold start
// that never observed an unbound tree.

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

/// Every file under `dir`, with its path relative to `base` and its bytes.
fn barrier_collect(base: &Path, dir: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            barrier_collect(base, &path, out);
        } else {
            let relative = path.strip_prefix(base).unwrap().to_owned();
            out.push((relative, fs::read(&path).unwrap()));
        }
    }
}

/// The authority root, the records and the markers, sorted: what an ordinary write would change.
fn barrier_tree(fixture: &Fixture) -> Vec<(PathBuf, Vec<u8>)> {
    let mut files = Vec::new();
    for dir in [&fixture.root, &fixture.records, &fixture.markers] {
        barrier_collect(&fixture.base, dir, &mut files);
    }
    files.sort();
    files
}

#[test]
fn a_bound_root_refuses_a_write_and_writes_nothing() {
    let fixture = barrier_bound();
    let before = barrier_tree(&fixture);
    assert!(!before.is_empty(), "the root itself is part of the tree");
    let first = fixture.write_poll(&mut StdFs, None, b"first");
    let second = fixture.write_poll(&mut StdFs, Some(1), b"second");
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
