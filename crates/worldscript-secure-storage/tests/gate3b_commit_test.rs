//! Gate 3 slice 3B part 2: the commit write protocol and startup reconciliation
//! (`docs/native/R15-SECURE-STORAGE-CONTRACT.md` §8.4, §9, §9.2), proven on `settings:global`.
//!
//! Each crash state is produced by injecting an I/O error at one durability boundary of a real
//! write, then reconciling on the real filesystem. An injected error is not a power loss; what a
//! device persists across a crash is packaged evidence for Gate 6.

mod support;

use std::fs;
use std::io;
use std::path::PathBuf;

use support::*;
use worldscript_secure_storage::{
    commit_write, generation_path, read_committed, reconcile, seal_record, staging_path, Authority,
    CommitError, CommitStep, DebrisKind, DirectoryDurability, MarkerBody, MarkerError,
    MarkerOperation, OpenError, PendingBody, RecordIdentity, RecordMeta, RecoveryReason,
    Resolution, StdFs, WriteOperationId,
};

#[test]
fn a_first_write_and_a_replacement_commit_through_markers() {
    let dirs = Dirs::new();
    assert_eq!(authority(&dirs).unwrap(), Authority::Absent);
    assert_eq!(read(&dirs).unwrap(), None);

    let first = commit_write(&mut StdFs, dirs.store(), REQUEST, FIRST).unwrap();
    assert_eq!((first.generation, first.marker_generation), (1, 2));
    let expected = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    assert_eq!(first.directories, expected);

    assert_eq!(write(&mut StdFs, &dirs, SECOND).unwrap(), 2);
    assert_eq!(
        names(&dirs.record),
        ["generation-1.wsr1", "generation-2.wsr1"]
    );
    assert_eq!(names(&dirs.marker).len(), 4);
    assert_no_plaintext(&dirs);
    assert_startup(&dirs, Resolution::Unchanged, &[], SECOND);
}

#[test]
fn a_first_write_that_never_staged_rolls_back_to_no_authority() {
    let dirs = Dirs::new();
    let mut fault = FaultFs::new(Op::Create, &dirs.record, 0);
    let failed = write(&mut fault, &dirs, FIRST);
    let pending = authority(&dirs).unwrap();
    // A failed first write leaves a pending marker with nothing to serve.
    assert!(
        matches!(failed, Err(CommitError::RecordWrite(_)))
            && matches!(pending, Authority::Pending { serving: None, .. })
    );
    assert_eq!(read(&dirs).unwrap(), None);
    assert_eq!(
        startup(&dirs),
        (Resolution::RolledBack { restored: None }, vec![])
    );
    // The retry is a new first write: PENDING(none -> 1) again, then ACTIVE(1).
    assert_retry(&dirs, SECOND, 1);
}

#[test]
fn a_failed_pending_marker_write_leaves_the_old_authority() {
    let dirs = Dirs::new();
    // Marker creates in the second write: the PENDING marker's staging file is the first.
    let error = interrupted_replacement(&dirs, FaultFs::new(Op::Create, &dirs.marker, 0));
    assert!(matches!(error, CommitError::MarkerWrite(_)));
    assert!(matches!(authority(&dirs).unwrap(), Authority::Active(_)));
    assert_startup(&dirs, Resolution::Unchanged, &[], FIRST);
}

#[test]
fn a_replacement_that_never_staged_restores_the_old_generation() {
    let dirs = Dirs::new();
    let error = interrupted_replacement(&dirs, FaultFs::new(Op::Create, &dirs.record, 0));
    assert!(matches!(error, CommitError::RecordWrite(_)));
    // While pending, the old generation is served.
    assert_serves(&dirs, FIRST);
    assert_startup(
        &dirs,
        Resolution::RolledBack { restored: Some(1) },
        &[],
        FIRST,
    );
    assert_retry(&dirs, THIRD, 2);
}

#[test]
fn a_promoted_candidate_with_its_staging_provenance_is_completed() {
    // Record directory sync after promotion, the ACTIVE marker's create, and the ACTIVE marker's
    // directory sync: in each case the operation's staging file proves the candidate.
    for fault_at in ["record sync", "active create", "active sync"] {
        let dirs = Dirs::new();
        let fault = match fault_at {
            "record sync" => FaultFs::new(Op::SyncDir, &dirs.record, 0),
            "active create" => FaultFs::new(Op::Create, &dirs.marker, 1),
            _ => FaultFs::new(Op::SyncDir, &dirs.marker, ACTIVE_MARKER_SYNC),
        };
        interrupted_replacement(&dirs, fault);
        if fault_at == "active sync" {
            // The ACTIVE marker exists; the chain load makes it durable, so startup finds it
            // committed and only the redundant staging name is left to drop.
            let kinds = [DebrisKind::RedundantStagingRemoved];
            assert_startup(&dirs, Resolution::Unchanged, &kinds, SECOND);
        } else {
            let completed = Resolution::Completed { generation: 2 };
            assert_startup(&dirs, completed, &[], SECOND);
        }
        assert_eq!(
            names(&dirs.record),
            ["generation-1.wsr1", "generation-2.wsr1"]
        );
    }
}

#[test]
fn an_unsynced_marker_directory_decides_nothing() {
    let dirs = Dirs::new();
    interrupted_replacement(
        &dirs,
        FaultFs::new(Op::SyncDir, &dirs.marker, ACTIVE_MARKER_SYNC),
    );
    // The chain load syncs the marker directory first; if it cannot, nothing is served.
    let mut unsyncable = FaultFs::new(Op::SyncDir, &dirs.marker, 0);
    assert_eq!(
        read_committed(&mut unsyncable, dirs.store()).map(|_| ()),
        Err(CommitError::Io {
            step: CommitStep::SyncMarkers,
            kind: io::ErrorKind::Other
        })
    );
}

#[test]
fn a_validated_but_unpromoted_staging_file_is_promoted_at_startup() {
    let dirs = Dirs::new();
    let error = interrupted_replacement(&dirs, FaultFs::new(Op::Link, &dirs.record, 0));
    assert!(matches!(error, CommitError::RecordWrite(_)));
    assert_eq!(
        names(&dirs.record).len(),
        2,
        "generation 1 and the staging file"
    );
    assert_startup(&dirs, Resolution::Completed { generation: 2 }, &[], SECOND);
    assert_eq!(
        names(&dirs.record),
        ["generation-1.wsr1", "generation-2.wsr1"]
    );
}

#[test]
fn a_damaged_promoted_copy_is_relocated_and_the_staging_candidate_promoted() {
    let dirs = Dirs::new();
    interrupted_replacement(&dirs, FaultFs::new(Op::SyncDir, &dirs.record, 0));
    let promoted = generation_path(&dirs.record, 2);
    let mut damaged = fs::read(&promoted).unwrap();
    let last = damaged.len() - 1;
    damaged[last] ^= 1;
    replace(&promoted, &damaged);
    let kinds = [DebrisKind::Rejected];
    assert_startup(
        &dirs,
        Resolution::Completed { generation: 2 },
        &kinds,
        SECOND,
    );
    assert_eq!(
        rejected_files(&dirs.record),
        [damaged],
        "rejected bytes are kept"
    );
}

#[test]
fn a_promoted_generation_without_its_operations_staging_is_never_adopted() {
    let dirs = Dirs::new();
    interrupted_replacement(&dirs, FaultFs::new(Op::SyncDir, &dirs.record, 0));
    let promoted = fs::read(generation_path(&dirs.record, 2)).unwrap();
    // Valid bytes for the target, but nothing ties them to the pending operation (§9.2).
    fs::remove_file(pending_staging(&dirs)).unwrap();
    let kinds = [DebrisKind::Rejected];
    assert_startup(
        &dirs,
        Resolution::RolledBack { restored: Some(1) },
        &kinds,
        FIRST,
    );
    assert_eq!(rejected_files(&dirs.record), [promoted]);
    assert_retry(&dirs, THIRD, 2);
}

#[test]
fn a_staging_candidate_for_the_wrong_generation_or_epoch_is_never_adopted() {
    // Generation 1's authentic envelope, and an authentic generation-2 envelope under epoch 2.
    let wrong_generation = {
        let source = Dirs::new();
        write(&mut StdFs, &source, THIRD).unwrap();
        fs::read(generation_path(&source.record, 1)).unwrap()
    };
    let meta = RecordMeta {
        key_epoch: 2,
        record_generation: 2,
        record_schema: 1,
    };
    let wrong_epoch = seal_record(&key(), &settings(), meta, THIRD).unwrap();
    for bytes in [wrong_generation, wrong_epoch] {
        let dirs = Dirs::new();
        interrupted_replacement(&dirs, FaultFs::new(Op::Link, &dirs.record, 0));
        replace(&pending_staging(&dirs), &bytes);
        let kinds = [DebrisKind::Rejected];
        assert_startup(
            &dirs,
            Resolution::RolledBack { restored: Some(1) },
            &kinds,
            FIRST,
        );
        assert_eq!(rejected_files(&dirs.record), [bytes]);
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
    let kinds = [DebrisKind::Rejected];
    assert_startup(
        &dirs,
        Resolution::Completed { generation: 2 },
        &kinds,
        SECOND,
    );
    assert_eq!(rejected_files(&dirs.record), [b"foreign".to_vec()]);
}

#[test]
fn an_unreadable_candidate_decides_nothing() {
    let dirs = Dirs::new();
    interrupted_replacement(&dirs, FaultFs::new(Op::SyncDir, &dirs.record, 0));
    let (record_before, marker_before) = (names(&dirs.record), names(&dirs.marker));
    // Reconciliation's first record-directory read is the candidate.
    let mut unreadable = FaultFs::new(Op::Read, &dirs.record, 0);
    let result = reconcile(&mut unreadable, dirs.store(), 1);
    assert!(matches!(result, Err(CommitError::Io { .. })));
    // Nothing moved and the write is still pending.
    let after = (names(&dirs.record), names(&dirs.marker));
    assert_eq!(after, (record_before, marker_before));
    assert!(matches!(
        authority(&dirs).unwrap(),
        Authority::Pending { .. }
    ));
}

/// Both a read and a write are refused with `error`.
fn assert_read_and_write_refused(dirs: &Dirs, error: CommitError) {
    assert_eq!(read(dirs), Err(error.clone()));
    assert_eq!(write(&mut StdFs, dirs, THIRD), Err(error));
}

#[test]
fn a_write_never_builds_on_an_unverifiable_committed_generation() {
    let dirs = Dirs::new();
    write(&mut StdFs, &dirs, FIRST).unwrap();
    let committed = generation_path(&dirs.record, 1);
    let original = fs::read(&committed).unwrap();
    let markers = names(&dirs.marker);

    let other = Dirs::new();
    write(&mut StdFs, &other, SECOND).unwrap();
    replace(
        &committed,
        &fs::read(generation_path(&other.record, 1)).unwrap(),
    );
    let mismatch = CommitError::RecoveryRequired(RecoveryReason::CommittedGenerationMismatch);
    assert_read_and_write_refused(&dirs, mismatch);

    fs::remove_file(&committed).unwrap();
    let missing = CommitError::RecoveryRequired(RecoveryReason::CommittedGenerationMissing);
    assert_read_and_write_refused(&dirs, missing);
    assert_eq!(names(&dirs.marker), markers, "no marker was written");

    fs::write(&committed, original).unwrap();
    assert_serves(&dirs, FIRST);
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
        recovery_required(RecoveryReason::MarkerUnreadable {
            marker_generation: 4,
            error: MarkerError::Open(OpenError::Tampered),
        })
    );
    assert!(read(&dirs).is_err(), "no fallback to an older marker");

    // A valid marker replayed into another chain slot.
    fs::write(&latest, fs::read(generation_path(&dirs.marker, 2)).unwrap()).unwrap();
    assert_eq!(
        authority(&dirs),
        recovery_required(RecoveryReason::MarkerUnreadable {
            marker_generation: 4,
            error: MarkerError::GenerationMismatch,
        })
    );
    fs::write(&latest, &original).unwrap();

    fs::remove_file(generation_path(&dirs.marker, 2)).unwrap();
    assert_eq!(
        authority(&dirs),
        recovery_required(RecoveryReason::MarkerChainGap { missing: 2 })
    );
}

#[test]
fn every_marker_must_be_a_legal_transition() {
    let active = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0; 32],
    };
    let recovery = MarkerBody::RecoveryRequired {
        reason_code: 1,
        prior: None,
    };
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
    // ACTIVE(1) with no PENDING before it; a RECOVERY_REQUIRED marker; and, after a committed
    // first write, a PENDING that ignores the committed generation.
    let illegal = |marker_generation| RecoveryReason::IllegalTransition { marker_generation };
    let cases = [
        (false, 1, active, illegal(1)),
        (false, 1, recovery, RecoveryReason::MarkerRecoveryRequired),
        (true, 3, skipping, illegal(3)),
    ];
    for (committed_first, marker_generation, body, reason) in cases {
        let dirs = Dirs::new();
        if committed_first {
            write(&mut StdFs, &dirs, FIRST).unwrap();
        }
        let path = generation_path(&dirs.marker, marker_generation);
        fs::write(path, marker_bytes(marker_generation, body)).unwrap();
        assert_eq!(authority(&dirs), recovery_required(reason));
        assert!(
            write(&mut StdFs, &dirs, SECOND).is_err(),
            "no write past {reason:?}"
        );
    }
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
        recovery_required(RecoveryReason::MarkerUnreadable {
            marker_generation: 3,
            error: MarkerError::UnsupportedState(3),
        })
    );
    assert!(write(&mut StdFs, &dirs, SECOND).is_err());
    assert!(read(&dirs).is_err());
}

#[test]
fn a_non_canonical_operation_id_never_shapes_a_relocation_path() {
    let dirs = Dirs::new();
    // An authenticated PENDING(none -> 1) whose operation ID is path-like, with bytes already
    // under generation 1's name.
    let pending = MarkerBody::Pending(PendingBody {
        operation: MarkerOperation {
            operation_id: "../../escape".to_owned(),
            fencing_generation: 0,
        },
        old_generation: None,
        target_generation: 1,
        target_epoch: 1,
        content_digest: None,
        record_schema: 1,
    });
    fs::write(generation_path(&dirs.marker, 1), marker_bytes(1, pending)).unwrap();
    fs::write(generation_path(&dirs.record, 1), b"unrelated").unwrap();
    let rolled_back = Resolution::RolledBack { restored: None };
    assert_eq!(startup(&dirs), (rolled_back, vec![DebrisKind::Rejected]));
    let rejected = names(&dirs.record);
    assert_eq!(rejected.len(), 1);
    let tag = rejected[0]
        .strip_prefix("generation-1.wsr1.rejected-")
        .unwrap();
    assert!(
        tag.len() == 32 && tag.bytes().all(|b| b.is_ascii_hexdigit()),
        "{tag}"
    );
    assert!(!dirs.root.join("escape").exists());
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

    let reconciled = reconcile(&mut StdFs, dirs.store(), 1).unwrap();
    assert_eq!(reconciled.resolution, Resolution::Unchanged);
    let found: Vec<(PathBuf, DebrisKind)> = reconciled
        .debris
        .into_iter()
        .map(|debris| (debris.path, debris.kind))
        .collect();
    let mut expected = vec![
        (redundant.clone(), DebrisKind::RedundantStagingRemoved),
        (orphan.clone(), DebrisKind::OrphanStaging),
        (unrecognized.clone(), DebrisKind::Unrecognized),
    ];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(found, expected);
    // Only the redundant staging file is gone; the others keep their exact bytes.
    let left = (
        redundant.exists(),
        fs::read(&orphan).unwrap(),
        fs::read(&unrecognized).unwrap(),
    );
    assert_eq!(
        left,
        (false, b"not an envelope".to_vec(), b"keep me".to_vec())
    );
}

#[test]
fn a_renamed_marker_never_lets_an_older_one_look_newest() {
    for renamed in [
        "generation-04.wsr1",
        "generation-4.wsr1.bak",
        "generation-x.wsr1",
    ] {
        let dirs = Dirs::new();
        write(&mut StdFs, &dirs, FIRST).unwrap();
        write(&mut StdFs, &dirs, SECOND).unwrap();
        fs::rename(generation_path(&dirs.marker, 4), dirs.marker.join(renamed)).unwrap();
        assert_eq!(
            authority(&dirs),
            recovery_required(RecoveryReason::UnexpectedMarkerEntry),
            "{renamed}"
        );
    }
}

#[test]
fn a_rollback_never_restores_an_old_generation_that_no_longer_verifies() {
    let dirs = Dirs::new();
    interrupted_replacement(&dirs, FaultFs::new(Op::Create, &dirs.record, 0));
    let markers = names(&dirs.marker);
    fs::remove_file(generation_path(&dirs.record, 1)).unwrap();
    assert_eq!(
        reconcile(&mut StdFs, dirs.store(), 1).map(|_| ()),
        Err(CommitError::RecoveryRequired(
            RecoveryReason::CommittedGenerationMissing
        ))
    );
    assert_eq!(
        names(&dirs.marker),
        markers,
        "ACTIVE(old) was not re-recorded"
    );
}

#[test]
fn a_startup_resolution_reports_the_durability_of_the_marker_it_wrote() {
    let dirs = Dirs::new();
    interrupted_replacement(&dirs, FaultFs::new(Op::Link, &dirs.record, 0));
    let reconciled = reconcile(&mut StdFs, dirs.store(), 1).unwrap();
    let expected = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    let outcome = (reconciled.resolution, reconciled.marker_durability);
    assert_eq!(
        outcome,
        (Resolution::Completed { generation: 2 }, Some(expected))
    );
    let settled = reconcile(&mut StdFs, dirs.store(), 1).unwrap();
    assert_eq!(
        settled.marker_durability, None,
        "nothing written when settled"
    );
}
