//! Gate 3 slice 3B1: the `record-commit` marker codec (§5.4, §8.4).
//!
//! Every vector is assembled byte by byte from the contract's field list, not from the encoder, so
//! the encoder is checked against the specification rather than against itself.

use sha2::{Digest, Sha256};
use worldscript_secure_storage::{
    content_digest, seal_record, CommitMarker, Key, MarkerBody, MarkerError, MarkerOperation,
    OpenError, PendingBody, RecordClass, RecordIdentity, RecordMeta,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

const SETTINGS_MARKER_ID: &str = "record-commit:settings:settings:global";

/// The contract's version-1 `state_code` values and `operation_id` bound (§5.4, §6.1.2), pinned
/// here rather than imported, so a changed implementation constant fails these tests.
const ACTIVE: u32 = 1;
const PENDING: u32 = 2;
const DELETE_PENDING: u32 = 3;
const TOMBSTONED: u32 = 4;
const RECOVERY_REQUIRED: u32 = 5;
const READ_AUTHORITY_PENDING: u32 = 6;
const MAX_OPERATION_ID_LEN: usize = 128;
const OPERATION: &str = "0123456789abcdef0123456789abcdef";

fn operation(fencing_generation: u64) -> MarkerOperation {
    MarkerOperation {
        operation_id: OPERATION.to_owned(),
        fencing_generation,
    }
}

fn u32be(value: u32) -> [u8; 4] {
    value.to_be_bytes()
}

fn u64be(value: u64) -> [u8; 8] {
    value.to_be_bytes()
}

/// The common header for the `settings:global` marker: class token, direct logical binding, absent
/// project binding, marker generation and state code.
fn settings_header(marker_generation: u64, code: u32) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(&u32be(13));
    out.extend_from_slice(b"record-commit");
    out.push(1); // direct form
    out.extend_from_slice(&u32be(SETTINGS_MARKER_ID.len() as u32));
    out.extend_from_slice(SETTINGS_MARKER_ID.as_bytes());
    out.push(0); // no project scope
    out.extend_from_slice(&u64be(marker_generation));
    out.extend_from_slice(&u32be(code));
    out
}

fn push_operation(out: &mut Vec<u8>, fencing_generation: u64) {
    out.extend_from_slice(&u32be(OPERATION.len() as u32));
    out.extend_from_slice(OPERATION.as_bytes());
    out.extend_from_slice(&u64be(fencing_generation));
}

fn active_body() -> MarkerBody {
    MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    }
}

fn active_vector() -> Vec<u8> {
    let mut out = settings_header(2, ACTIVE);
    out.extend_from_slice(&u64be(1));
    out.extend_from_slice(&u64be(1));
    out.push(1);
    out.extend_from_slice(&[0xab; 32]);
    out.push(0); // is_chunked
    out
}

/// The contract's next generation: `1` for a first write, otherwise `old + 1`.
fn next(old_generation: Option<u64>) -> u64 {
    old_generation.map_or(1, |old| old + 1)
}

fn pending(old_generation: Option<u64>, content_digest: Option<[u8; 32]>) -> MarkerBody {
    MarkerBody::Pending(PendingBody {
        operation: operation(0),
        old_generation,
        target_generation: next(old_generation),
        target_epoch: 1,
        content_digest,
        record_schema: 1,
    })
}

fn pending_vector(old_generation: Option<u64>, content_digest: Option<[u8; 32]>) -> Vec<u8> {
    let mut out = settings_header(3, PENDING);
    push_operation(&mut out, 0);
    match old_generation {
        Some(old) => {
            out.push(1);
            out.extend_from_slice(&u64be(old));
        }
        None => out.push(0),
    }
    out.extend_from_slice(&u64be(next(old_generation)));
    out.extend_from_slice(&u64be(1));
    match content_digest {
        Some(digest) => {
            out.push(1);
            out.extend_from_slice(&digest);
        }
        None => out.push(0),
    }
    out.extend_from_slice(&u32be(1));
    out.push(0); // is_chunked
    out
}

fn marker(marker_generation: u64, body: MarkerBody) -> CommitMarker {
    CommitMarker::new(&settings(), marker_generation, body).unwrap()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn active_marker_matches_the_contract_vector() {
    let active = marker(2, active_body());
    assert_eq!(active.encode(), active_vector());
    // Pinned independently (Python hashlib over the same contract-assembled bytes).
    assert_eq!(
        hex(&active.entry_digest()),
        "b7adf0011be770804246b29d3e7e5488b29cb61ca15858692c5b711f7e39131b"
    );
}

#[test]
fn entry_digest_is_the_domain_separated_body_hash() {
    let active = marker(2, active_body());
    let expected: [u8; 32] = Sha256::new()
        .chain_update(b"worldscript-r15/marker-entry/v1")
        .chain_update(active_vector())
        .finalize()
        .into();
    assert_eq!(active.entry_digest(), expected);
}

#[test]
fn pending_markers_match_the_contract_vectors() {
    for (old, digest) in [(None, None), (Some(1), None), (Some(1), Some([0x11; 32]))] {
        let body = pending(old, digest);
        assert_eq!(marker(3, body).encode(), pending_vector(old, digest));
    }
}

#[test]
fn recovery_required_markers_match_the_contract_vectors() {
    let bare = marker(
        4,
        MarkerBody::RecoveryRequired {
            reason_code: 9,
            prior: None,
        },
    );
    let mut expected = settings_header(4, RECOVERY_REQUIRED);
    expected.extend_from_slice(&u32be(9));
    expected.push(0);
    assert_eq!(bare.encode(), expected);

    let with_prior = marker(
        4,
        MarkerBody::RecoveryRequired {
            reason_code: 9,
            prior: Some(operation(5)),
        },
    );
    let mut expected = settings_header(4, RECOVERY_REQUIRED);
    expected.extend_from_slice(&u32be(9));
    expected.push(1);
    push_operation(&mut expected, 5);
    assert_eq!(with_prior.encode(), expected);
}

#[test]
fn over_cap_identities_use_hashed_bindings_for_both_fields() {
    // §6.2 rule D: a marker ID over 256 bytes hashes both present identity fields.
    let long_project = "p".repeat(300);
    let project = RecordIdentity::new(RecordClass::Project, &[&long_project]).unwrap();
    let encoded = CommitMarker::new(&project, 1, active_body())
        .unwrap()
        .encode();
    let class_len = 4 + "record-commit".len();
    assert_eq!(encoded[class_len], 2, "logical binding is hashed");
    assert_eq!(encoded[class_len + 33], 2, "project binding is hashed");
    let round_trip = CommitMarker::decode(&project, &encoded).unwrap();
    assert_eq!(round_trip.encode(), encoded);
}

#[test]
fn every_admitted_body_round_trips() {
    let bodies = [
        active_body(),
        pending(None, None),
        pending(Some(1), Some([0x22; 32])),
        MarkerBody::RecoveryRequired {
            reason_code: 0,
            prior: Some(operation(0)),
        },
    ];
    for body in bodies {
        let original = marker(7, body);
        let decoded = CommitMarker::decode(&settings(), &original.encode()).unwrap();
        assert_eq!(decoded, original);
    }
}

#[test]
fn decoding_rejects_every_truncation_and_trailing_bytes() {
    let bytes = pending_vector(Some(1), Some([0x11; 32]));
    for len in 0..bytes.len() {
        assert!(
            CommitMarker::decode(&settings(), &bytes[..len]).is_err(),
            "prefix of {len} bytes"
        );
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert_eq!(
        CommitMarker::decode(&settings(), &trailing),
        Err(MarkerError::Corrupt("trailing bytes after marker body"))
    );
}

#[test]
fn decoding_rejects_non_canonical_flags_chunking_and_digestless_active() {
    let mut flag = active_vector();
    let digest_flag = flag.len() - 34;
    flag[digest_flag] = 2;
    assert_eq!(
        CommitMarker::decode(&settings(), &flag),
        Err(MarkerError::Corrupt("flag byte is neither 0 nor 1"))
    );

    let mut chunked = active_vector();
    *chunked.last_mut().unwrap() = 1;
    assert_eq!(
        CommitMarker::decode(&settings(), &chunked),
        Err(MarkerError::UnsupportedChunked)
    );

    let mut digestless = settings_header(2, ACTIVE);
    digestless.extend_from_slice(&u64be(1));
    digestless.extend_from_slice(&u64be(1));
    digestless.push(0);
    digestless.push(0);
    assert_eq!(
        CommitMarker::decode(&settings(), &digestless),
        Err(MarkerError::Corrupt("ACTIVE marker without content_digest"))
    );
}

#[test]
fn reserved_and_unknown_states_are_refused() {
    for code in [DELETE_PENDING, TOMBSTONED, READ_AUTHORITY_PENDING, 0, 7] {
        let bytes = settings_header(2, code);
        assert_eq!(
            CommitMarker::decode(&settings(), &bytes),
            Err(MarkerError::UnsupportedState(code))
        );
    }
}

#[test]
fn a_marker_of_another_record_is_an_identity_mismatch() {
    let codex = RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap();
    let foreign = CommitMarker::new(&codex, 2, active_body())
        .unwrap()
        .encode();
    assert_eq!(
        CommitMarker::decode(&settings(), &foreign),
        Err(MarkerError::IdentityMismatch)
    );
    assert_eq!(
        CommitMarker::decode(&settings(), b"not a marker"),
        Err(MarkerError::Corrupt("not a record-commit marker body"))
    );
}

#[test]
fn counters_follow_the_lifecycle_rule() {
    for bad in [0, u64::MAX] {
        assert_eq!(
            CommitMarker::new(&settings(), bad, active_body()),
            Err(MarkerError::InvalidCounter)
        );
        let active = MarkerBody::Active {
            committed_generation: bad,
            committed_epoch: 1,
            content_digest: [0; 32],
        };
        assert_eq!(
            CommitMarker::new(&settings(), 1, active),
            Err(MarkerError::InvalidCounter)
        );
        let mut body = PendingBody {
            operation: operation(0),
            old_generation: None,
            target_generation: 1,
            target_epoch: bad,
            content_digest: None,
            record_schema: 1,
        };
        assert_eq!(
            CommitMarker::new(&settings(), 1, MarkerBody::Pending(body.clone())),
            Err(MarkerError::InvalidCounter)
        );
        body.target_epoch = 1;
        body.old_generation = Some(bad);
        body.target_generation = bad.wrapping_add(1);
        assert_eq!(
            CommitMarker::new(&settings(), 1, MarkerBody::Pending(body)),
            Err(MarkerError::InvalidCounter)
        );
    }
}

#[test]
fn a_pending_target_is_exactly_the_next_generation() {
    // (old, target) pairs the contract cannot produce: a skipped first generation, a skipped or
    // repeated later one, and a backwards step.
    for (old, target) in [
        (None, 2),
        (None, 3),
        (Some(1), 3),
        (Some(2), 2),
        (Some(3), 2),
    ] {
        let body = MarkerBody::Pending(PendingBody {
            operation: operation(0),
            old_generation: old,
            target_generation: target,
            target_epoch: 1,
            content_digest: None,
            record_schema: 1,
        });
        assert_eq!(
            CommitMarker::new(&settings(), 1, body),
            Err(MarkerError::TargetNotNextGeneration),
            "{old:?} -> {target}"
        );
    }
    // Decoding refuses the same shape: PENDING(none -> 2) assembled by hand.
    let mut skipped = settings_header(3, PENDING);
    push_operation(&mut skipped, 0);
    skipped.push(0);
    skipped.extend_from_slice(&u64be(2));
    skipped.extend_from_slice(&u64be(1));
    skipped.push(0);
    skipped.extend_from_slice(&u32be(1));
    skipped.push(0);
    assert_eq!(
        CommitMarker::decode(&settings(), &skipped),
        Err(MarkerError::TargetNotNextGeneration)
    );
}

#[test]
fn operation_ids_are_bounded_and_schemas_admitted() {
    let with_id = |len: usize| MarkerBody::RecoveryRequired {
        reason_code: 0,
        prior: Some(MarkerOperation {
            operation_id: "a".repeat(len),
            fencing_generation: 0,
        }),
    };
    assert!(CommitMarker::new(&settings(), 1, with_id(MAX_OPERATION_ID_LEN)).is_ok());
    for len in [0, MAX_OPERATION_ID_LEN + 1] {
        assert_eq!(
            CommitMarker::new(&settings(), 1, with_id(len)),
            Err(MarkerError::InvalidOperationId)
        );
    }
    let MarkerBody::Pending(mut body) = pending(None, None) else {
        unreachable!()
    };
    body.record_schema = 2;
    assert_eq!(
        CommitMarker::new(&settings(), 1, MarkerBody::Pending(body)),
        Err(MarkerError::UnsupportedSchema)
    );
}

#[test]
fn records_without_an_ordinary_marker_are_refused() {
    let asset = RecordIdentity::new(RecordClass::Asset, &["p1", "a1"]).unwrap();
    assert_eq!(
        CommitMarker::new(&asset, 1, active_body()),
        Err(MarkerError::NoOrdinaryMarker)
    );
}

#[test]
fn content_digest_is_the_domain_separated_envelope_hash() {
    let envelope = b"WSR1 envelope bytes";
    let expected: [u8; 32] = Sha256::new()
        .chain_update(b"worldscript-r15/content/v1")
        .chain_update(envelope)
        .finalize()
        .into();
    assert_eq!(content_digest(envelope), expected);
    // Pinned independently (Python hashlib), so a shared typo in the domain cannot pass.
    assert_eq!(
        hex(&content_digest(envelope)),
        "0196e46d0ae351c775a39ac09e119fe0c91ab7dc36167d0c5f77f75f71ac5d31"
    );
}

#[test]
fn a_sealed_marker_opens_only_as_its_own_record_and_generation() {
    let active = marker(2, active_body());
    let sealed = active.seal(&key(), 1).unwrap();
    assert_eq!(
        CommitMarker::open(&key(), &settings(), &sealed).unwrap(),
        active
    );

    let codex = RecordIdentity::new(RecordClass::Codex, &["p1"]).unwrap();
    assert_eq!(
        CommitMarker::open(&key(), &codex, &sealed),
        Err(MarkerError::Open(OpenError::Tampered))
    );

    // The same body sealed under another generation's name is a replay, not a marker.
    let marker_identity = RecordIdentity::commit_marker(&settings()).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 3,
        record_schema: 1,
    };
    let replayed = seal_record(&key(), &marker_identity, meta, &active.encode()).unwrap();
    assert_eq!(
        CommitMarker::open(&key(), &settings(), &replayed),
        Err(MarkerError::GenerationMismatch)
    );
}

#[test]
fn debug_output_never_shows_the_operation_id() {
    let shown = format!("{:?}", marker(3, pending(None, None)));
    assert!(!shown.contains(OPERATION));
    assert!(shown.contains("operation_id_len"));
}
