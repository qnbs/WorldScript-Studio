//! Gate 3 slice 3C part 2: record-catalog descriptors and pages (§5.5, §5.5.1).
//!
//! The shard vectors and the page body vector are computed independently (Python `hashlib` over
//! bytes assembled from the contract's field list).

use sha2::{Digest, Sha256};
use worldscript_secure_storage::{
    catalog_shard_of, CatalogDescriptor, CatalogError, CatalogPage, CommitMarker,
    CommittedGeneration, InstallationScopeId, Key, MarkerBody, MarkerOperation, OpenError,
    PendingBody, RecordClass, RecordIdentity, CATALOG_SHARD_COUNT,
};

fn key() -> Key {
    Key::from_bytes(&mut [3u8; 32])
}

fn scope() -> InstallationScopeId {
    InstallationScopeId::from_random_bits([7u8; 16])
}

fn settings() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Settings, &[]).unwrap()
}

fn codex(project: &str) -> RecordIdentity {
    RecordIdentity::new(RecordClass::Codex, &[project]).unwrap()
}

fn committed(generation: u64) -> CommittedGeneration {
    CommittedGeneration {
        generation,
        epoch: 1,
        content_digest: [0xab; 32],
    }
}

fn active_marker(record: &RecordIdentity, marker_generation: u64) -> CommitMarker {
    let body = MarkerBody::Active {
        committed_generation: 1,
        committed_epoch: 1,
        content_digest: [0xab; 32],
    };
    CommitMarker::new(record, marker_generation, body).unwrap()
}

fn pending_marker(record: &RecordIdentity, old: Option<u64>) -> CommitMarker {
    let body = MarkerBody::Pending(PendingBody {
        operation: MarkerOperation {
            operation_id: "0123456789abcdef0123456789abcdef".to_owned(),
            fencing_generation: 0,
        },
        old_generation: old,
        target_generation: old.map_or(1, |g| g + 1),
        target_epoch: 1,
        content_digest: None,
        record_schema: 1,
    });
    CommitMarker::new(record, 3, body).unwrap()
}

fn active(record: &RecordIdentity) -> CatalogDescriptor {
    CatalogDescriptor::new(record, &active_marker(record, 2), Some(committed(1))).unwrap()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn shards_follow_the_contract_function() {
    let shards = (
        catalog_shard_of(&settings()).unwrap(),
        catalog_shard_of(&codex("p1")).unwrap(),
        catalog_shard_of(&codex("p2")).unwrap(),
        catalog_shard_of(&codex("p18")).unwrap(),
    );
    assert_eq!(shards, (85, 228, 39, 228));
    assert!(shards.0 < CATALOG_SHARD_COUNT);
}

#[test]
fn a_page_body_matches_the_contract_vector_and_round_trips() {
    let page = CatalogPage::new(85, vec![active(&settings())]).unwrap();
    let bytes = page.encode();
    assert_eq!(bytes.len(), 140);
    assert_eq!(
        hex(&Sha256::digest(&bytes)),
        "7816709204846d1e44f38feee7cf9548b2a602579fc5d0ca0a257134ff238f41"
    );
    assert_eq!(CatalogPage::decode(&bytes).unwrap(), page);
}

#[test]
fn descriptors_must_agree_with_their_marker() {
    let inconsistent = Err(CatalogError::InconsistentDescriptor);
    let record = settings();
    // ACTIVE must name exactly its committed generation.
    let active = active_marker(&record, 2);
    assert_eq!(CatalogDescriptor::new(&record, &active, None), inconsistent);
    assert_eq!(
        CatalogDescriptor::new(&record, &active, Some(committed(2))),
        inconsistent
    );
    // A first write names nothing readable; a replacement names its old generation.
    let first = pending_marker(&record, None);
    assert!(CatalogDescriptor::new(&record, &first, None).is_ok());
    assert_eq!(
        CatalogDescriptor::new(&record, &first, Some(committed(1))),
        inconsistent
    );
    let replacement = pending_marker(&record, Some(1));
    assert!(CatalogDescriptor::new(&record, &replacement, Some(committed(1))).is_ok());
    assert_eq!(
        CatalogDescriptor::new(&record, &replacement, None),
        inconsistent
    );
    // A marker of another record never describes this one.
    assert_eq!(
        CatalogDescriptor::new(&codex("p1"), &active, Some(committed(1))),
        inconsistent
    );
}

#[test]
fn pages_are_sorted_bounded_and_single_shard() {
    // Projects p1 and p18 share shard 228; the page sorts them whatever the input order.
    let (p1, p18) = (active(&codex("p1")), active(&codex("p18")));
    let page = CatalogPage::new(228, vec![p18.clone(), p1.clone()]).unwrap();
    assert_eq!(page.descriptors(), [p1.clone(), p18]);
    let refused = |shard, descriptors| CatalogPage::new(shard, descriptors).unwrap_err();
    assert_eq!(
        refused(228, vec![p1.clone(), p1.clone()]),
        CatalogError::NotStrictlyAscending
    );
    assert_eq!(refused(39, vec![p1.clone()]), CatalogError::WrongShard);
    assert_eq!(refused(228, vec![]), CatalogError::InvalidDescriptorCount);
    assert_eq!(
        refused(CATALOG_SHARD_COUNT, vec![p1]),
        CatalogError::InvalidShard
    );
}

#[test]
fn decoding_rejects_every_truncation_trailing_byte_and_bad_format() {
    let bytes = CatalogPage::new(85, vec![active(&settings())])
        .unwrap()
        .encode();
    for len in 0..bytes.len() {
        assert!(CatalogPage::decode(&bytes[..len]).is_err(), "prefix {len}");
    }
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(CatalogPage::decode(&trailing).is_err());
    let mut future = bytes.clone();
    future[3] = 2;
    assert_eq!(
        CatalogPage::decode(&future),
        Err(CatalogError::UnsupportedFormat(2))
    );
}

#[test]
fn decoding_rejects_inconsistent_presence_and_unadmitted_states() {
    let bytes = CatalogPage::new(85, vec![active(&settings())])
        .unwrap()
        .encode();
    // The last 3×(1 + value) bytes are the presence-flagged fields: drop the content digest only.
    let mut partial = bytes[..bytes.len() - 33].to_vec();
    partial.push(0);
    assert_eq!(
        CatalogPage::decode(&partial),
        Err(CatalogError::InconsistentDescriptor)
    );
    // marker_state sits right before the presence flags.
    let state_at = bytes.len() - (9 + 9 + 33) - 4;
    for state in [3u32, 4, 5, 6, 7] {
        let mut other = bytes.clone();
        other[state_at..state_at + 4].copy_from_slice(&state.to_be_bytes());
        assert_eq!(
            CatalogPage::decode(&other),
            Err(CatalogError::UnsupportedState(state))
        );
    }
}

#[test]
fn a_sealed_page_opens_only_as_its_own_shard_and_generation() {
    let page = CatalogPage::new(85, vec![active(&settings())]).unwrap();
    let sealed = page.seal(&key(), &scope(), 1, 4).unwrap();
    assert_eq!(
        CatalogPage::open(&key(), &scope(), 85, 4, &sealed).unwrap(),
        page
    );
    assert_eq!(
        CatalogPage::open(&key(), &scope(), 85, 5, &sealed),
        Err(CatalogError::GenerationMismatch)
    );
    assert_eq!(
        CatalogPage::open(&key(), &scope(), 86, 4, &sealed),
        Err(CatalogError::Open(OpenError::Tampered))
    );
    let other_scope = InstallationScopeId::from_random_bits([8u8; 16]);
    assert_eq!(
        CatalogPage::open(&key(), &other_scope, 85, 4, &sealed),
        Err(CatalogError::Open(OpenError::Tampered))
    );
}

#[test]
fn a_descriptor_reports_which_record_it_describes() {
    let descriptor = active(&settings());
    let facts = (
        descriptor.describes(&settings()),
        descriptor.describes(&codex("p1")),
        descriptor.marker_generation(),
        descriptor.readable(),
    );
    assert_eq!(facts, (true, false, 2, Some(committed(1))));
}
