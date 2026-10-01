//! Gate 3 slice 3C part 3a: the persisted authority-root records (§5.3, §5.3.4, §8.3).
//!
//! Byte layouts are assembled from the contract's field lists; the root and pointer digests are the
//! independently pinned 3C part 1 vectors.

use worldscript_secure_storage::{
    decode_root_body, encode_root_body, open_root_slot, seal_record, seal_root_slot,
    InstallationScopeId, Key, KeyEpochAddress, KeyEpochRecord, KeyEpochStatus, LiveMigration,
    OpenError, RecordClass, RecordIdentity, RecordMeta, RootBody, RootCommitEvidence,
    RootCommitState, RootError, RootKeyRefV1, RootPointer, RootRecordError, RootSlot,
};

fn key() -> Key {
    Key::from_bytes(&mut [4u8; 32])
}

fn scope() -> InstallationScopeId {
    InstallationScopeId::from_random_bits([9u8; 16])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The 3C part 1 vector root (its `root_digest` is pinned there).
fn root() -> RootBody {
    RootBody {
        root_generation: 5,
        active_key_epoch: 2,
        root_key_ref_digest: [0xa1; 32],
        marker_set_digest: [0xa2; 32],
        catalog_set_digest: [0xa3; 32],
        key_epoch_set_digest: [0xa4; 32],
        commit_evidence: RootCommitEvidence {
            operation_id: "0123456789abcdef0123456789abcdef".to_owned(),
            fencing_generation: 0,
            state: RootCommitState::Committed,
        },
        live_migration: None,
    }
}

const ROOT_DIGEST: &str = "199c2a845547d946e9d769f6aea9cc724c12c1aa3a7a7cbd5d7d5958e07aefc1";
const POINTER_DIGEST: &str = "58196ba16c117c0f4d4178c183b33135c65aaad3d36cbc661aab93532e40fe7c";

#[test]
fn a_root_slot_round_trips_and_yields_the_pinned_root_digest() {
    let sealed = seal_root_slot(&key(), &scope(), &root()).unwrap();
    let (opened, digest) = open_root_slot(&key(), &scope(), 5, &sealed).unwrap();
    assert_eq!((opened, hex(&digest)), (root(), ROOT_DIGEST.to_owned()));
}

#[test]
fn a_root_slot_opens_only_as_its_own_scope_and_generation() {
    let sealed = seal_root_slot(&key(), &scope(), &root()).unwrap();
    let other = InstallationScopeId::from_random_bits([1u8; 16]);
    let refusals = (
        open_root_slot(&key(), &scope(), 6, &sealed).unwrap_err(),
        open_root_slot(&key(), &other, 5, &sealed).unwrap_err(),
    );
    assert_eq!(
        refusals,
        (
            RootRecordError::GenerationMismatch,
            RootRecordError::Open(OpenError::Tampered)
        )
    );
}

#[test]
fn the_root_body_decoder_is_strict_and_canonical() {
    let mut live = root();
    live.live_migration = Some(LiveMigration {
        operation_id: "migration-op-1".to_owned(),
        fencing_generation: 3,
        journal_revision: 0,
        manifest_digest: [0xa5; 32],
    });
    for body in [root(), live] {
        let bytes = encode_root_body(&body).unwrap();
        assert_eq!(decode_root_body(&bytes).unwrap(), body);
        for len in 0..bytes.len() {
            assert!(decode_root_body(&bytes[..len]).is_err(), "prefix {len}");
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(decode_root_body(&trailing).is_err());
    }
}

#[test]
fn the_root_body_decoder_refuses_non_canonical_codes_and_counters() {
    let bytes = encode_root_body(&root()).unwrap();
    // Layout tail: … u32 root_commit_state_code | u8 has_live_migration.
    let state_at = bytes.len() - 1 - 4;
    let mut state = bytes.clone();
    state[state_at..state_at + 4].copy_from_slice(&2u32.to_be_bytes());
    let mut flag = bytes.clone();
    *flag.last_mut().unwrap() = 2;
    let mut generation = bytes.clone();
    generation[..8].copy_from_slice(&0u64.to_be_bytes());
    let refusals = [state, flag, generation].map(|b| decode_root_body(&b).unwrap_err());
    assert_eq!(
        refusals,
        [
            RootError::Corrupt("unknown root_commit_state_code"),
            RootError::Corrupt("has_live_migration is neither 0 nor 1"),
            RootError::InvalidCounter,
        ]
    );
}

fn pointer() -> RootPointer {
    RootPointer {
        slot: RootSlot::B,
        root_generation: 5,
        root_digest: [0xa6; 32],
    }
}

#[test]
fn the_pointer_matches_the_contract_layout_and_round_trips() {
    let mut expected = b"WSRP".to_vec();
    expected.extend_from_slice(&1u32.to_be_bytes());
    expected.push(1); // ROOT_SLOT_B
    expected.extend_from_slice(&5u64.to_be_bytes());
    expected.extend_from_slice(&[0xa6; 32]);
    expected.extend_from_slice(
        &(0..32)
            .map(|i| u8::from_str_radix(&POINTER_DIGEST[2 * i..2 * i + 2], 16).unwrap())
            .collect::<Vec<u8>>(),
    );
    let bytes = pointer().encode().unwrap();
    assert_eq!(bytes, expected);
    assert_eq!(RootPointer::decode(&bytes).unwrap(), pointer());
}

#[test]
fn the_pointer_decoder_refuses_every_malformed_or_unbound_pointer() {
    let bytes = pointer().encode().unwrap();
    let edited = |at: usize, value: u8| {
        let mut out = bytes.clone();
        out[at] = value;
        RootPointer::decode(&out).unwrap_err()
    };
    let mut short = bytes.clone();
    short.pop();
    let refusals = [
        RootPointer::decode(&short).unwrap_err(),
        edited(0, b'X'),
        edited(7, 2),
        edited(8, 2),
        edited(20, 0),
    ];
    assert_eq!(
        refusals,
        [
            RootRecordError::Corrupt("pointer has the wrong length"),
            RootRecordError::Corrupt("not a root pointer"),
            RootRecordError::UnsupportedFormat(2),
            RootRecordError::Corrupt("unknown root slot code"),
            RootRecordError::PointerDigestMismatch,
        ]
    );
}

fn route(bytes: &[u8]) -> RootKeyRefV1 {
    RootKeyRefV1::new(bytes.to_vec()).unwrap()
}

fn epoch_record() -> KeyEpochRecord {
    KeyEpochRecord {
        epoch: 1,
        status: KeyEpochStatus::Active,
        root_key_ref: route(b"route-1"),
    }
}

#[test]
fn a_key_epoch_record_matches_the_contract_layout_and_round_trips() {
    let mut expected = 1u32.to_be_bytes().to_vec();
    expected.extend_from_slice(&1u64.to_be_bytes());
    expected.extend_from_slice(&2u32.to_be_bytes()); // KEY_EPOCH_ACTIVE
    expected.extend_from_slice(&7u32.to_be_bytes());
    expected.extend_from_slice(b"route-1");
    let bytes = epoch_record().encode().unwrap();
    assert_eq!(bytes, expected);
    assert_eq!(KeyEpochRecord::decode(&bytes).unwrap(), epoch_record());
}

#[test]
fn a_key_epoch_record_refuses_unknown_statuses_and_bad_routes() {
    let bytes = epoch_record().encode().unwrap();
    let status = |code: u32| {
        let mut out = bytes.clone();
        out[12..16].copy_from_slice(&code.to_be_bytes());
        KeyEpochRecord::decode(&out).unwrap_err()
    };
    assert_eq!(
        [status(0), status(5)],
        [
            RootRecordError::UnknownKeyEpochStatus(0),
            RootRecordError::UnknownKeyEpochStatus(5)
        ]
    );
    let mut long = bytes[..16].to_vec();
    long.extend_from_slice(&257u32.to_be_bytes());
    long.extend_from_slice(&[0x61; 257]);
    assert_eq!(
        KeyEpochRecord::decode(&long).unwrap_err(),
        RootRecordError::Corrupt("key route length out of bounds")
    );
}

fn address(
    scope: &InstallationScopeId,
    epoch: u64,
    registry_generation: u64,
) -> KeyEpochAddress<'_> {
    KeyEpochAddress {
        scope,
        epoch,
        registry_generation,
    }
}

#[test]
fn a_sealed_key_epoch_record_yields_its_set_entry() {
    let scope = scope();
    let sealed = epoch_record()
        .seal(&key(), &address(&scope, 1, 3), 1)
        .unwrap();
    let (record, entry) = KeyEpochRecord::open(&key(), &address(&scope, 1, 3), &sealed).unwrap();
    let digest = worldscript_secure_storage::content_digest(&sealed);
    assert_eq!(
        (
            record,
            entry.epoch,
            entry.registry_generation,
            entry.content_digest
        ),
        (epoch_record(), 1, 3, digest)
    );
    // Another epoch's identity, another generation, or an unassigned generation never opens it.
    let refusals = [
        KeyEpochRecord::open(&key(), &address(&scope, 2, 3), &sealed).unwrap_err(),
        KeyEpochRecord::open(&key(), &address(&scope, 1, 4), &sealed).unwrap_err(),
        KeyEpochRecord::open(&key(), &address(&scope, 1, 0), &sealed).unwrap_err(),
    ];
    assert_eq!(
        refusals,
        [
            RootRecordError::Open(OpenError::Tampered),
            RootRecordError::GenerationMismatch,
            RootRecordError::Root(RootError::InvalidCounter),
        ]
    );
    for bad in [0, u64::MAX] {
        assert_eq!(
            epoch_record()
                .seal(&key(), &address(&scope, 1, bad), 1)
                .unwrap_err(),
            RootRecordError::Root(RootError::InvalidCounter)
        );
    }
    assert_eq!(
        epoch_record()
            .seal(&key(), &address(&scope, 2, 3), 1)
            .unwrap_err(),
        RootRecordError::Corrupt("key-epoch record names another epoch")
    );
}

#[test]
fn a_root_slot_sealed_under_another_epoch_than_its_body_is_refused() {
    // A valid body (active_key_epoch 2) sealed by hand under envelope epoch 7.
    let mut payload = 1u32.to_be_bytes().to_vec();
    payload.extend_from_slice(&encode_root_body(&root()).unwrap());
    let identity = RecordIdentity::new(RecordClass::AuthorityRoot, &[scope().as_str()]).unwrap();
    let meta = RecordMeta {
        key_epoch: 7,
        record_generation: 5,
        record_schema: 1,
    };
    let sealed = seal_record(&key(), &identity, meta, &payload).unwrap();
    assert_eq!(
        open_root_slot(&key(), &scope(), 5, &sealed).unwrap_err(),
        RootRecordError::Corrupt("root slot sealed under another epoch")
    );
}
