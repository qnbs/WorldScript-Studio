//! Gate 3 slice 3C part 1: the authority-root digests (§5.4).
//!
//! Every digest vector is pinned from an independent implementation (Python `hashlib` over bytes
//! assembled from the contract's field list), so the code is checked against the specification.

use worldscript_secure_storage::{
    catalog_set_digest, key_epoch_set_digest, marker_set_digest, pointer_digest, root_digest,
    CatalogShard, CommitMarker, KeyEpochEntry, LiveMigration, MarkerBody, MarkerSetEntry,
    RecordClass, RecordIdentity, RootBody, RootCommitEvidence, RootCommitState, RootError,
    RootSlot,
};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn active(record: &RecordIdentity, marker_generation: u64) -> MarkerSetEntry {
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    };
    let marker = CommitMarker::new(record, marker_generation, body).unwrap();
    MarkerSetEntry::from_marker(&marker).unwrap()
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

fn codex(project: &str) -> RecordIdentity {
    RecordIdentity::new(RecordClass::Codex, &[project]).unwrap()
}

fn shard(shard_id: u32, catalog_generation: u64, fill: u8) -> CatalogShard {
    CatalogShard {
        shard_id,
        catalog_generation,
        content_digest: [fill; 32],
    }
}

fn epoch(epoch: u64, registry_generation: u64, fill: u8) -> KeyEpochEntry {
    KeyEpochEntry {
        epoch,
        registry_generation,
        content_digest: [fill; 32],
    }
}

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

#[test]
fn marker_set_digest_matches_the_contract_vector() {
    // The settings marker of the 3B1 vector (marker generation 2, ACTIVE(1)).
    let digest = marker_set_digest(&[active(&settings(), 2)]).unwrap();
    assert_eq!(
        hex(&digest),
        "88bd41b5b64f9a6677dd796f72d9739a4795cc1543d5642e9570478da7e41be5"
    );
}

#[test]
fn set_digests_are_independent_of_input_order() {
    let markers = [
        active(&settings(), 2),
        active(&codex("p1"), 4),
        active(&codex("p0"), 3),
    ];
    let mut reversed = markers.clone();
    reversed.reverse();
    let digests = (
        marker_set_digest(&markers).unwrap(),
        marker_set_digest(&reversed).unwrap(),
    );
    assert_eq!(digests.0, digests.1);

    let shards = [shard(7, 1, 0x22), shard(0, 3, 0x11)];
    assert_eq!(
        hex(&catalog_set_digest(&shards).unwrap()),
        "f817b608339a943f290d8412f5ec8b320f9e6c45a635c58ec0f7d992ea5e0a13"
    );
    let epochs = [epoch(2, 4, 0x44), epoch(1, 1, 0x33)];
    assert_eq!(
        hex(&key_epoch_set_digest(&epochs).unwrap()),
        "493945cf0c52b6525728fae1fd2a339d90ac64f0a382989d198daeed79ded416"
    );
}

#[test]
fn every_set_refuses_a_duplicate_key() {
    let duplicate = Err(RootError::DuplicateEntry);
    // The same record at two marker generations is a replay, not two entries.
    let markers = [active(&settings(), 2), active(&settings(), 4)];
    assert_eq!(marker_set_digest(&markers), duplicate);
    let shards = [shard(3, 1, 0x11), shard(3, 2, 0x22)];
    assert_eq!(catalog_set_digest(&shards), duplicate);
    let epochs = [epoch(1, 1, 0x33), epoch(1, 2, 0x44)];
    assert_eq!(key_epoch_set_digest(&epochs), duplicate);
}

#[test]
fn set_entries_follow_the_counter_lifecycle() {
    let invalid = Err(RootError::InvalidCounter);
    for bad in [0, u64::MAX] {
        assert_eq!(catalog_set_digest(&[shard(0, bad, 0x11)]), invalid);
        assert_eq!(key_epoch_set_digest(&[epoch(bad, 1, 0x33)]), invalid);
        assert_eq!(key_epoch_set_digest(&[epoch(1, bad, 0x33)]), invalid);
    }
}

#[test]
fn empty_sets_are_canonical() {
    // An installation with no ordinary records yet still binds an explicit, empty set.
    let empty = (
        marker_set_digest(&[]).unwrap(),
        catalog_set_digest(&[]).unwrap(),
        key_epoch_set_digest(&[]).unwrap(),
    );
    assert!(
        empty.0 != empty.1 && empty.1 != empty.2,
        "domains separate empty sets"
    );
}

#[test]
fn root_digest_matches_the_contract_vectors() {
    assert_eq!(
        hex(&root_digest(&root()).unwrap()),
        "199c2a845547d946e9d769f6aea9cc724c12c1aa3a7a7cbd5d7d5958e07aefc1"
    );
    let mut live = root();
    live.live_migration = Some(LiveMigration {
        operation_id: "migration-op-1".to_owned(),
        fencing_generation: 3,
        journal_revision: 9,
        manifest_digest: [0xa5; 32],
    });
    assert_eq!(
        hex(&root_digest(&live).unwrap()),
        "7811f8bd281b1b0ca2a488259782d16fcc6792f1d157c9087dcff89b3772d483"
    );
}

#[test]
fn every_root_field_changes_the_digest() {
    let base = root_digest(&root()).unwrap();
    let variants: [fn(&mut RootBody); 10] = [
        |r| r.root_generation = 6,
        |r| r.active_key_epoch = 3,
        |r| r.root_key_ref_digest[0] ^= 1,
        |r| r.marker_set_digest[0] ^= 1,
        |r| r.catalog_set_digest[0] ^= 1,
        |r| r.key_epoch_set_digest[0] ^= 1,
        |r| r.commit_evidence.fencing_generation = 1,
        |r| r.commit_evidence.state = RootCommitState::NotCommitted,
        |r| r.commit_evidence.operation_id.push('0'),
        |r| {
            r.live_migration = Some(LiveMigration {
                operation_id: "other".to_owned(),
                fencing_generation: 1,
                journal_revision: 1,
                manifest_digest: [0; 32],
            })
        },
    ];
    for (index, change) in variants.iter().enumerate() {
        let mut changed = root();
        change(&mut changed);
        assert_ne!(root_digest(&changed).unwrap(), base, "field {index}");
    }
}

#[test]
fn root_fields_are_validated_before_hashing() {
    let refused = |change: fn(&mut RootBody), error| {
        let mut body = root();
        change(&mut body);
        assert_eq!(root_digest(&body), Err(error));
    };
    refused(|r| r.root_generation = 0, RootError::InvalidCounter);
    refused(|r| r.active_key_epoch = u64::MAX, RootError::InvalidCounter);
    refused(
        |r| r.commit_evidence.operation_id.clear(),
        RootError::InvalidOperationId,
    );
    refused(
        |r| r.commit_evidence.operation_id = "a".repeat(129),
        RootError::InvalidOperationId,
    );
    // A live migration always owns a positive fence; its journal revision is never terminal.
    let live = |fencing_generation, journal_revision| LiveMigration {
        operation_id: "migration-op-1".to_owned(),
        fencing_generation,
        journal_revision,
        manifest_digest: [0xa5; 32],
    };
    for (fence, revision) in [(0, 9), (3, u64::MAX)] {
        let mut body = root();
        body.live_migration = Some(live(fence, revision));
        assert_eq!(root_digest(&body), Err(RootError::InvalidCounter));
    }
    // §10.2: the bootstrap binding uses the initial-revision sentinel 0.
    let mut bootstrap = root();
    bootstrap.live_migration = Some(live(1, 0));
    assert!(root_digest(&bootstrap).is_ok());
}

#[test]
fn pointer_digest_matches_the_contract_vector_and_binds_the_slot() {
    let digest = pointer_digest(RootSlot::B, 5, &[0xa6; 32]).unwrap();
    assert_eq!(
        hex(&digest),
        "58196ba16c117c0f4d4178c183b33135c65aaad3d36cbc661aab93532e40fe7c"
    );
    assert_ne!(pointer_digest(RootSlot::A, 5, &[0xa6; 32]).unwrap(), digest);
    assert_eq!(
        pointer_digest(RootSlot::B, 0, &[0xa6; 32]),
        Err(RootError::InvalidCounter)
    );
}

#[test]
fn no_marker_set_entry_exists_for_an_asset_pair_until_its_marker_body_does() {
    // §8.4.1's asset-pair body is not implemented, so no asset-pair marker can be built or
    // committed — and therefore none can be missing from a marker set.
    let pair = RecordIdentity::new(RecordClass::AssetPair, &["p1", "a1"]).unwrap();
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0; 32],
    };
    assert!(CommitMarker::new(&pair, 1, body).is_err());
}
