//! Gate 4D Slice D3a: what a successor may do to the cursor and the lease (§10.1, §10.3, maintainer
//! decision C). Within a phase the cursor only moves forward; a forward phase change enters the new
//! phase at `(0, 0)`; entering `RECOVERY_REQUIRED` keeps the last cursor. An ordinary successor never
//! touches the lease: the owner and the fence change only by takeover, the expiry only by renewal.
//! Every test is a table of named cases with one assertion over all of them.

use worldscript_secure_storage::{
    assert_manifest_successor, assert_renewal_successor, assert_takeover_successor,
    checkpoint_progress, empty_journal_page_set_digest, mark_recovery, operation_type, phase_code,
    transition_phase, JournalCheckpointCursor, JournalManifest, MigrationExecutionError,
    MigrationFence, MigrationPhase, RecoveryReasonCode,
};

type Outcome = Result<(), MigrationExecutionError>;
type Change = fn(&mut JournalManifest);

/// A journal in `CONVERT` owned by "owner-a" until 10 000, two pages and five entries long, with the
/// cursor at page 1, entry 2.
fn converting() -> JournalManifest {
    JournalManifest {
        operation_id: "cursor-lease-op".into(),
        journal_revision: 7,
        operation_type: operation_type::ENABLE,
        phase: phase_code::CONVERT,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 4,
        inventory_version: 1,
        inventory_digest: [3; 32],
        page_count: 2,
        entry_count: 5,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: true,
        cursor_page_index: 1,
        cursor_entry_index: 2,
        has_lease_owner: true,
        lease_owner_id: Some("owner-a".into()),
        lease_expires_unix_ms: Some(10_000),
        recovery_reason_code: 0,
    }
}

/// The same journal without a lease.
fn unowned() -> JournalManifest {
    let mut manifest = converting();
    drop_lease(&mut manifest);
    manifest
}

fn drop_lease(manifest: &mut JournalManifest) {
    manifest.has_lease_owner = false;
    manifest.lease_owner_id = None;
    manifest.lease_expires_unix_ms = None;
}

/// `prev` and its successor after `change`.
fn successor(prev: &JournalManifest, change: Change) -> JournalManifest {
    let mut next = prev.clone();
    next.journal_revision += 1;
    change(&mut next);
    next
}

fn forward(next: &mut JournalManifest) {
    next.phase = phase_code::VERIFY;
}

fn start(next: &mut JournalManifest) {
    next.cursor_page_index = 0;
    next.cursor_entry_index = 0;
}

fn recovery(next: &mut JournalManifest) {
    next.phase = phase_code::RECOVERY_REQUIRED;
    next.recovery_reason_code = 3;
}

fn extend(next: &mut JournalManifest) {
    next.lease_expires_unix_ms = Some(10_001);
}

/// Runs every case of a table through `judge` and returns the cases whose verdict is not the expected one.
fn mismatches(
    cases: &[(&'static str, Change, Outcome)],
    judge: impl Fn(&JournalManifest, &JournalManifest) -> Outcome,
) -> Vec<(&'static str, Outcome)> {
    let prev = converting();
    cases
        .iter()
        .filter_map(|(name, change, expected)| {
            let verdict = judge(&prev, &successor(&prev, *change));
            (verdict != *expected).then_some((*name, verdict))
        })
        .collect()
}

#[test]
fn the_cursor_follows_the_phase_rules() {
    let cases: [(&str, Change, Outcome); 9] = [
        (
            "forward keeping the cursor",
            forward,
            Err(MigrationExecutionError::CursorNotReset),
        ),
        (
            "forward resetting only the page",
            |m| {
                forward(m);
                m.cursor_page_index = 0;
            },
            Err(MigrationExecutionError::CursorNotReset),
        ),
        (
            "forward resetting both",
            |m| {
                forward(m);
                start(m);
            },
            Ok(()),
        ),
        ("recovery keeping the cursor", recovery, Ok(())),
        (
            "recovery resetting the cursor",
            |m| {
                recovery(m);
                start(m);
            },
            Err(MigrationExecutionError::FrozenFieldChanged),
        ),
        (
            "same phase, entry forward",
            |m| m.cursor_entry_index = 3,
            Ok(()),
        ),
        ("same phase, unchanged", |_| {}, Ok(())),
        (
            "same phase, entry back",
            |m| m.cursor_entry_index = 1,
            Err(MigrationExecutionError::RegressiveCheckpoint),
        ),
        (
            "same phase, page back",
            |m| {
                m.cursor_page_index = 0;
                m.cursor_entry_index = 4;
            },
            Err(MigrationExecutionError::RegressiveCheckpoint),
        ),
    ];
    assert_eq!(mismatches(&cases, assert_manifest_successor), vec![]);
}

#[test]
fn the_constructors_agree_with_the_relation() {
    let prev = converting();
    let fence = MigrationFence::from_manifest(&prev);
    let verify = MigrationPhase::from_wire(phase_code::VERIFY);
    let products = [
        transition_phase(&prev, &fence, verify).unwrap(),
        mark_recovery(&prev, &fence, RecoveryReasonCode::new(3)).unwrap(),
        checkpoint_progress(&prev, &fence, JournalCheckpointCursor::new(1, 4)).unwrap(),
    ];
    let seen: Vec<_> = products
        .iter()
        .map(|next| {
            let lease_kept = next.lease_owner_id == prev.lease_owner_id
                && next.lease_expires_unix_ms == prev.lease_expires_unix_ms;
            (
                (next.cursor_page_index, next.cursor_entry_index),
                lease_kept,
                assert_manifest_successor(&prev, next),
            )
        })
        .collect();
    // A forward change enters at the start, recovery and progress keep or advance the cursor, none
    // touches the lease, and the relation accepts every product.
    let expected = vec![
        ((0, 0), true, Ok(())),
        ((1, 2), true, Ok(())),
        ((1, 4), true, Ok(())),
    ];
    assert_eq!(seen, expected);
}

#[test]
fn an_ordinary_successor_cannot_change_the_lease() {
    // Ownership and expiry move only by takeover and renewal, so none of the ordinary successors (a
    // progress checkpoint, a forward phase change, entering recovery) may carry another lease.
    let steps: [(&str, Change); 3] = [
        ("checkpoint", |m| m.cursor_entry_index = 3),
        ("forward change", |m| {
            forward(m);
            start(m);
        }),
        ("recovery", recovery),
    ];
    let leases: [(&str, Change); 4] = [
        ("another owner", |m| {
            m.lease_owner_id = Some("owner-b".into())
        }),
        ("a longer expiry", |m| {
            m.lease_expires_unix_ms = Some(20_000)
        }),
        ("a shorter expiry", |m| {
            m.lease_expires_unix_ms = Some(5_000)
        }),
        ("a dropped lease", drop_lease),
    ];
    let prev = converting();
    let mut accepted = Vec::new();
    for (step, base) in steps {
        for (name, lease) in leases {
            let mut next = successor(&prev, base);
            lease(&mut next);
            if assert_manifest_successor(&prev, &next).is_ok() {
                accepted.push(format!("{step} with {name}"));
            }
        }
    }
    assert_eq!(accepted, Vec::<String>::new());
}

#[test]
fn a_lease_cannot_appear_from_nothing_through_a_checkpoint() {
    // Its first owner is the bootstrap manifest or a takeover.
    let prev = unowned();
    let next = successor(&prev, |m| {
        m.has_lease_owner = true;
        m.lease_owner_id = Some("owner-a".into());
        m.lease_expires_unix_ms = Some(10_000);
    });
    assert_eq!(
        assert_manifest_successor(&prev, &next),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
}

/// One renewal scenario: the committed manifest, the candidate and the verdict it must get.
type Renewal = (&'static str, JournalManifest, JournalManifest, Outcome);

/// A renewal candidate for the journal `prev`, built by `change` on top of a valid successor.
fn renewal(
    name: &'static str,
    prev: JournalManifest,
    change: Change,
    expected: Outcome,
) -> Renewal {
    let next = successor(&prev, change);
    (name, prev, next, expected)
}

/// Candidates that are about the shape of the lease itself.
fn lease_shape_cases() -> Vec<Renewal> {
    let invalid = Err(MigrationExecutionError::InvalidLeaseRenewal);
    let claim: Change = |m| {
        m.has_lease_owner = true;
        m.lease_owner_id = Some("owner-a".into());
        m.lease_expires_unix_ms = Some(10_000);
    };
    let mut nameless = converting();
    nameless.lease_owner_id = Some(String::new());
    vec![
        renewal("expiry forward", converting(), extend, Ok(())),
        renewal(
            "expiry unchanged",
            converting(),
            |m| m.lease_expires_unix_ms = Some(10_000),
            invalid,
        ),
        renewal(
            "expiry earlier",
            converting(),
            |m| m.lease_expires_unix_ms = Some(9_999),
            invalid,
        ),
        renewal("lease dropped", converting(), drop_lease, invalid),
        renewal("no lease to renew", unowned(), claim, invalid),
        renewal("owner not named", nameless, extend, invalid),
    ]
}

/// Candidates that renew the expiry and change anything else.
fn frozen_field_cases() -> Vec<Renewal> {
    let frozen = Err(MigrationExecutionError::FrozenFieldChanged);
    vec![
        renewal(
            "another owner",
            converting(),
            |m| {
                extend(m);
                m.lease_owner_id = Some("owner-b".into());
            },
            frozen,
        ),
        renewal(
            "another fence",
            converting(),
            |m| {
                extend(m);
                m.fencing_generation += 1;
            },
            frozen,
        ),
        renewal(
            "with a cursor move",
            converting(),
            |m| {
                extend(m);
                m.cursor_entry_index = 3;
            },
            frozen,
        ),
        renewal(
            "with a phase change",
            converting(),
            |m| {
                extend(m);
                forward(m);
            },
            frozen,
        ),
        renewal(
            "with a recovery reason",
            converting(),
            |m| {
                extend(m);
                recovery(m);
            },
            frozen,
        ),
    ]
}

/// Candidates that are about the revision and the state of the journal they follow.
fn revision_and_terminal_cases() -> Vec<Renewal> {
    let mut done = converting();
    done.phase = phase_code::DONE;
    vec![
        renewal(
            "same revision",
            converting(),
            |m| {
                extend(m);
                m.journal_revision -= 1;
            },
            Err(MigrationExecutionError::StaleJournalRevision),
        ),
        renewal(
            "revision skipped",
            converting(),
            |m| {
                extend(m);
                m.journal_revision += 1;
            },
            Err(MigrationExecutionError::LiveBindingMismatch),
        ),
        renewal(
            "terminal journal",
            done,
            extend,
            Err(MigrationExecutionError::TerminalPhase),
        ),
    ]
}

fn renewals() -> Vec<Renewal> {
    [
        lease_shape_cases(),
        frozen_field_cases(),
        revision_and_terminal_cases(),
    ]
    .concat()
}

#[test]
fn a_renewal_moves_only_the_expiry_forward_of_a_lease_that_is_held() {
    let wrong: Vec<_> = renewals()
        .into_iter()
        .filter_map(|(name, prev, next, expected)| {
            let verdict = assert_renewal_successor(&prev, &next);
            (verdict != expected).then_some((name, verdict))
        })
        .collect();
    assert_eq!(wrong, vec![]);
}

#[test]
fn renewal_takeover_and_ordinary_successor_are_three_different_things() {
    let prev = converting();
    let renewed = successor(&prev, extend);
    let claim = successor(&prev, |m| {
        m.fencing_generation += 1;
        m.lease_owner_id = Some("owner-b".into());
        m.lease_expires_unix_ms = Some(30_000);
    });
    // Each transition is judged by all three predicates: only its own accepts it.
    let verdicts = [
        (
            "renewal",
            assert_manifest_successor(&prev, &renewed).is_ok(),
            assert_renewal_successor(&prev, &renewed).is_ok(),
            assert_takeover_successor(&prev, &renewed, 10_000).is_ok(),
        ),
        (
            "takeover",
            assert_manifest_successor(&prev, &claim).is_ok(),
            assert_renewal_successor(&prev, &claim).is_ok(),
            assert_takeover_successor(&prev, &claim, 10_000).is_ok(),
        ),
    ];
    assert_eq!(
        verdicts,
        [
            ("renewal", false, true, false),
            ("takeover", false, false, true)
        ]
    );
}
