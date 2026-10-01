//! Gate 3 slice 3C part 2: record-catalog descriptors and pages (§5.5, §5.5.1).
//!
//! The shard vectors and the page body vector are computed independently (Python `hashlib` over
//! bytes assembled from the contract's field list).

use sha2::{Digest, Sha256};
use worldscript_secure_storage::{
    catalog_shard_of, CatalogDescriptor, CatalogError, CatalogPage, CommitMarker,
    CommittedGeneration, InstallationScopeId, Key, MarkerBody, MarkerOperation, OpenError,
    PageAddress, PendingBody, RecordClass, RecordIdentity, CATALOG_SHARD_COUNT,
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
    CatalogDescriptor::new_unverified(record, &active_marker(record, 2), Some(committed(1)))
        .unwrap()
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
    // `settings:global` has no free template components, so the identity extension is u32(0).
    assert_eq!(bytes.len(), 144);
    assert_eq!(
        hex(&Sha256::digest(&bytes)),
        "f0c09824af618b2369c880e804301592c6b76555f945730659f0bc6b8b2ab4c2"
    );
    assert_eq!(CatalogPage::decode(&bytes).unwrap(), page);
}

#[test]
fn descriptors_must_agree_with_their_marker() {
    let inconsistent = Err(CatalogError::InconsistentDescriptor);
    let record = settings();
    // ACTIVE must name exactly its committed generation.
    let active = active_marker(&record, 2);
    assert_eq!(
        CatalogDescriptor::new_unverified(&record, &active, None),
        inconsistent
    );
    assert_eq!(
        CatalogDescriptor::new_unverified(&record, &active, Some(committed(2))),
        inconsistent
    );
    // A first write names nothing readable; a replacement names its old generation.
    let first = pending_marker(&record, None);
    assert!(CatalogDescriptor::new_unverified(&record, &first, None).is_ok());
    assert_eq!(
        CatalogDescriptor::new_unverified(&record, &first, Some(committed(1))),
        inconsistent
    );
    let replacement = pending_marker(&record, Some(1));
    assert!(CatalogDescriptor::new_unverified(&record, &replacement, Some(committed(1))).is_ok());
    assert_eq!(
        CatalogDescriptor::new_unverified(&record, &replacement, None),
        inconsistent
    );
    // A marker of another record never describes this one.
    assert_eq!(
        CatalogDescriptor::new_unverified(&codex("p1"), &active, Some(committed(1))),
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
    // Layout tail: … marker_state(4) | 3 presence-flagged fields (9 + 9 + 33) | u32 components.
    let suffix = bytes.len() - 4;
    // Drop only the content digest: its flag becomes 0 while the other two stay present.
    let mut partial = bytes[..suffix - 33].to_vec();
    partial.push(0);
    partial.extend_from_slice(&bytes[suffix..]);
    assert_eq!(
        CatalogPage::decode(&partial),
        Err(CatalogError::InconsistentDescriptor)
    );
    let state_at = suffix - (9 + 9 + 33) - 4;
    // READ_AUTHORITY_PENDING (6) is admitted by the format; the deletion and recovery states and
    // unknown codes are refused.
    assert!(CatalogPage::decode(&with_u32(&bytes, state_at, 6)).is_ok());
    for state in [3u32, 4, 5, 7] {
        assert_eq!(
            CatalogPage::decode(&with_u32(&bytes, state_at, state)),
            Err(CatalogError::UnsupportedState(state))
        );
    }
}

fn address(scope: &InstallationScopeId, shard_id: u32, catalog_generation: u64) -> PageAddress<'_> {
    PageAddress {
        scope,
        shard_id,
        catalog_generation,
    }
}

#[test]
fn a_sealed_page_opens_only_as_its_own_shard_and_generation() {
    let (scope, other_scope) = (scope(), InstallationScopeId::from_random_bits([8u8; 16]));
    let page = CatalogPage::new(85, vec![active(&settings())]).unwrap();
    let sealed = page.seal(&key(), &address(&scope, 85, 4), 1).unwrap();
    let open = |at: PageAddress<'_>| CatalogPage::open(&key(), &at, &sealed);
    assert_eq!(open(address(&scope, 85, 4)).unwrap(), page);
    let refusals = [
        open(address(&scope, 85, 5)),
        open(address(&scope, 86, 4)),
        open(address(&other_scope, 85, 4)),
        open(address(&scope, 300, 4)),
    ];
    let tampered = || Err(CatalogError::Open(OpenError::Tampered));
    let expected = [
        Err(CatalogError::GenerationMismatch),
        tampered(),
        tampered(),
        Err(CatalogError::InvalidShard),
    ];
    assert_eq!(refusals, expected);
    assert_eq!(
        page.seal(&key(), &address(&scope, 86, 4), 1),
        Err(CatalogError::WrongShard)
    );
}

/// Replaces the 4-byte big-endian value at `at` in a copy of `bytes`.
fn with_u32(bytes: &[u8], at: usize, value: u32) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[at..at + 4].copy_from_slice(&value.to_be_bytes());
    out
}

#[test]
fn decoding_refuses_non_ordinary_and_non_template_identities() {
    let bytes = CatalogPage::new(85, vec![active(&settings())])
        .unwrap()
        .encode();
    // Class token (u32 8 + "settings") follows the 12-byte page header.
    let mut control = bytes[..12].to_vec();
    control.extend_from_slice(&14u32.to_be_bytes());
    control.extend_from_slice(b"authority-root");
    control.extend_from_slice(&bytes[24..]);
    assert_eq!(
        CatalogPage::decode(&control),
        Err(CatalogError::NotAnOrdinaryRecord)
    );
    // A component count that the `settings` template does not have.
    let extra = with_u32(&bytes, bytes.len() - 4, 1);
    let mut extra = extra;
    extra.extend_from_slice(&1u32.to_be_bytes());
    extra.push(b'x');
    assert_eq!(
        CatalogPage::decode(&extra),
        Err(CatalogError::Corrupt(
            "descriptor identity violates its class template"
        ))
    );
}

#[test]
fn decoding_refuses_bad_flags_counters_and_counts() {
    let bytes = CatalogPage::new(85, vec![active(&settings())])
        .unwrap()
        .encode();
    let flags_at = bytes.len() - 4 - (9 + 9 + 33);
    let mut bad_flag = bytes.clone();
    bad_flag[flags_at] = 2;
    assert_eq!(
        CatalogPage::decode(&bad_flag),
        Err(CatalogError::Corrupt("flag byte is neither 0 nor 1"))
    );
    // The readable generation (right after the first flag) and the marker generation.
    let mut zero_generation = bytes.clone();
    zero_generation[flags_at + 1..flags_at + 9].copy_from_slice(&0u64.to_be_bytes());
    assert_eq!(
        CatalogPage::decode(&zero_generation),
        Err(CatalogError::InvalidCounter)
    );
    let marker_generation_at = flags_at - 4 - 32 - 8;
    let mut max_marker = bytes.clone();
    max_marker[marker_generation_at..marker_generation_at + 8]
        .copy_from_slice(&u64::MAX.to_be_bytes());
    assert_eq!(
        CatalogPage::decode(&max_marker),
        Err(CatalogError::InvalidCounter)
    );
    assert_eq!(
        CatalogPage::decode(&with_u32(&bytes, 8, 4097)),
        Err(CatalogError::InvalidDescriptorCount)
    );
}

#[test]
fn debug_output_never_shows_an_identity() {
    let record = codex("secret-project");
    let shard = catalog_shard_of(&record).unwrap();
    let page = CatalogPage::new(shard, vec![active(&record)]).unwrap();
    let shown = format!("{page:?} {:?}", active(&record));
    assert!(!shown.contains("secret-project"), "{shown}");
}

#[test]
fn a_decoded_descriptor_reproduces_its_exact_identity() {
    // A project ID over 256 bytes makes both bindings hashed; the identity still round-trips.
    let long = "p".repeat(300);
    let record = codex(&long);
    let shard = catalog_shard_of(&record).unwrap();
    let page = CatalogPage::new(shard, vec![active(&record)]).unwrap();
    let decoded = CatalogPage::decode(&page.encode()).unwrap();
    let descriptor = &decoded.descriptors()[0];
    let facts = (
        descriptor.record() == &record,
        descriptor.marker_generation(),
        descriptor.readable(),
    );
    assert_eq!(facts, (true, 2, Some(committed(1))));
}

#[test]
fn identities_and_pages_are_size_bounded() {
    // An identity whose components exceed the 16,384-byte extension bound is never catalogued.
    let huge = codex(&"p".repeat(16_385));
    let marker = active_marker(&huge, 2);
    assert_eq!(
        CatalogDescriptor::new_unverified(&huge, &marker, Some(committed(1))),
        Err(CatalogError::TooLarge)
    );
    let largest = codex(&"p".repeat(16_384));
    let fits = CatalogDescriptor::new_unverified(
        &largest,
        &active_marker(&largest, 2),
        Some(committed(1)),
    );
    assert!(fits.is_ok());
}
