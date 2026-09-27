//! Gate 1b-platform, slice A: the secure-store item layout — the strict `WSA1` anchor and `WSE1`
//! epoch-index encodings, the issued route grammar, the item-size bound, and the `SecretStore`
//! boundary semantics. No provider lifecycle is exercised here.

use worldscript_secure_storage::anchor;
use worldscript_secure_storage::anchor_codec;
use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_layout::{
    check_item_len, decode_index, encode_index, is_issued_route, key_account, route_from_bits,
    IndexEntry, MAX_INDEXED_EPOCHS, MAX_ITEM_LEN,
};
use worldscript_secure_storage::{
    AnchorState, KeyProviderError, PrepareRootAnchor, RootKeyRefV1, RootSlot,
};

const RR: KeyProviderError = KeyProviderError::RecoveryRequired;

fn route(n: u8) -> RootKeyRefV1 {
    route_from_bits([n; 16]).unwrap()
}

fn prepare(expected_floor: u64, slot: RootSlot, key_ref: RootKeyRefV1) -> PrepareRootAnchor {
    PrepareRootAnchor {
        operation_id: format!("op-{}", expected_floor + 1),
        expected_floor,
        target_root_generation: expected_floor + 1,
        target_final_root_digest: [7; 32],
        target_slot: slot,
        target_root_key_ref: key_ref,
    }
}

/// A committed root at generation 1 plus a pending preparation for generation 2.
fn rich_anchor() -> AnchorState {
    let (scoped, _) = anchor::provision_installation_scope(&AnchorState::empty(), [3; 16]).unwrap();
    let prepared = anchor::prepare(&scoped, &prepare(0, RootSlot::A, route(1))).unwrap();
    let committed = anchor::commit(&prepared, "op-1", 1).unwrap();
    anchor::prepare(&committed, &prepare(1, RootSlot::B, route(2))).unwrap()
}

fn with_byte(bytes: &[u8], index: usize, value: u8) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[index] = value;
    out
}

// ---- WSA1 anchor ---------------------------------------------------------------------------

#[test]
fn anchors_round_trip_exactly() {
    let (scoped, _) = anchor::provision_installation_scope(&AnchorState::empty(), [1; 16]).unwrap();
    for state in [AnchorState::empty(), scoped, rich_anchor()] {
        let bytes = anchor_codec::encode(&state).unwrap();
        let decoded = anchor_codec::decode(&bytes).unwrap();
        assert_eq!(decoded, state);
        assert_eq!(anchor_codec::encode(&decoded).unwrap(), bytes, "canonical");
    }
}

#[test]
fn malformed_anchor_bytes_are_refused() {
    let bytes = anchor_codec::encode(&rich_anchor()).unwrap();
    let cases: [(&str, Vec<u8>, KeyProviderError); 5] = [
        (
            "wrong magic",
            [b"WSA2", &bytes[4..]].concat(),
            KeyProviderError::UnsupportedAnchorFormat,
        ),
        (
            "empty",
            Vec::new(),
            KeyProviderError::UnsupportedAnchorFormat,
        ),
        ("truncated", bytes[..bytes.len() - 1].to_vec(), RR),
        ("trailing byte", [&bytes[..], &[0]].concat(), RR),
        ("scope flag 2", with_byte(&bytes, 12, 2), RR),
    ];
    for (name, input, expected) in cases {
        assert_eq!(
            anchor_codec::decode(&input).map(|_| ()),
            Err(expected),
            "{name}"
        );
    }
}

#[test]
fn future_anchor_and_scope_versions_are_refused_before_v1_fields() {
    let future_anchor = [b"WSA1".as_slice(), &2u32.to_be_bytes(), &[0x01]].concat();
    let future_scope = [b"WSA1".as_slice(), &1u32.to_be_bytes(), &2u32.to_be_bytes()].concat();
    for input in [future_anchor, future_scope] {
        assert_eq!(
            anchor_codec::decode(&input).map(|_| ()),
            Err(KeyProviderError::UnsupportedAnchorFormat)
        );
    }
}

#[test]
fn decoded_anchors_must_satisfy_the_v1_invariants() {
    // Floor (bytes 45..53: after magic, versions, scope flag + 32-byte scope) no longer matches the root.
    let bytes = anchor_codec::encode(&rich_anchor()).unwrap();
    let mut inconsistent = bytes.clone();
    inconsistent[52] ^= 0x04;
    assert_eq!(anchor_codec::decode(&inconsistent).map(|_| ()), Err(RR));
}

#[test]
fn invalid_anchor_states_are_never_encoded() {
    let mut invalid = rich_anchor();
    invalid.committed_floor = 9;
    assert_eq!(anchor_codec::encode(&invalid).map(|_| ()), Err(RR));
}

// ---- WSE1 epoch index ----------------------------------------------------------------------

fn entry(epoch: u64, n: u8) -> IndexEntry {
    IndexEntry {
        epoch,
        key_ref: route(n),
    }
}

#[test]
fn indexes_round_trip_exactly_up_to_the_bound() {
    let full: Vec<IndexEntry> = (1..=MAX_INDEXED_EPOCHS as u64)
        .map(|e| entry(e, e as u8))
        .collect();
    for entries in [Vec::new(), vec![entry(1, 1)], full] {
        let bytes = encode_index(&entries).unwrap();
        assert!(bytes.len() <= MAX_ITEM_LEN, "{} bytes", bytes.len());
        assert_eq!(decode_index(&bytes).unwrap(), entries);
    }
}

#[test]
fn the_index_encoder_refuses_what_the_decoder_refuses() {
    let over: Vec<IndexEntry> = (1..=MAX_INDEXED_EPOCHS as u64 + 1)
        .map(|e| entry(e, e as u8))
        .collect();
    let foreign = RootKeyRefV1::new(b"not-a-route".to_vec()).unwrap();
    let cases = [
        vec![entry(1, 1), entry(1, 2)],
        vec![entry(1, 1), entry(2, 1)],
        vec![entry(0, 1)],
        vec![entry(u64::MAX, 1)],
        vec![IndexEntry {
            epoch: 1,
            key_ref: foreign,
        }],
        over,
    ];
    for entries in cases {
        assert!(matches!(
            encode_index(&entries),
            Err(KeyProviderError::AnchorConflict(_))
        ));
    }
}

#[test]
fn malformed_index_bytes_require_recovery() {
    let bytes = encode_index(&[entry(1, 1), entry(2, 2)]).unwrap();
    let count_33 = [b"WSE1".as_slice(), &33u32.to_be_bytes()].concat();
    let cases: [(&str, Vec<u8>); 7] = [
        ("wrong magic", [b"WSE2", &bytes[4..]].concat()),
        ("count above bound", count_33),
        ("truncated", bytes[..bytes.len() - 1].to_vec()),
        ("trailing byte", [&bytes[..], &[0]].concat()),
        ("uppercase route", with_byte(&bytes, 8 + 10 + 8, b'A')),
        ("wrong route prefix", with_byte(&bytes, 8 + 10, b'x')),
        ("duplicate epoch", with_byte(&bytes, 8 + 50 + 7, 1)),
    ];
    for (name, input) in cases {
        assert_eq!(decode_index(&input), Err(RR), "{name}");
    }
}

// ---- Routes and items ----------------------------------------------------------------------

#[test]
fn routes_have_the_exact_issued_grammar() {
    let r = route_from_bits([0xab; 16]).unwrap();
    assert_eq!(
        r.as_bytes(),
        format!("wss-kr1-{}", "ab".repeat(16)).as_bytes()
    );
    assert!(is_issued_route(r.as_bytes()));
    for bad in [
        &b"wss-kr1-"[..],
        &[b'x'; 40][..],
        format!("wss-kr1-{}", "AB".repeat(16)).as_bytes(),
    ] {
        assert!(!is_issued_route(bad));
    }
    // The item name is "r15-key-" + the lowercase hex of the exact route bytes.
    let route_text = format!("wss-kr1-{}", "01".repeat(16));
    let expected: String = route_text.bytes().map(|b| format!("{b:02x}")).collect();
    assert_eq!(key_account(&route(0x01)), format!("r15-key-{expected}"));
}

#[test]
fn oversized_items_are_refused() {
    assert!(check_item_len(vec![0; MAX_ITEM_LEN]).is_ok());
    assert!(matches!(
        check_item_len(vec![0; MAX_ITEM_LEN + 1]),
        Err(KeyProviderError::AnchorConflict(_))
    ));
}

// ---- SecretStore boundary ------------------------------------------------------------------

#[test]
fn the_store_boundary_reads_replaces_and_deletes_items() {
    let store = MemorySecretStore::new();
    assert_eq!(store.get("a").unwrap(), None);
    store.set("a", b"one").unwrap();
    store.set("a", b"two").unwrap();
    assert_eq!(store.get("a").unwrap().unwrap().as_slice(), b"two");
    store.delete("a").unwrap();
    store.delete("a").unwrap();
    assert_eq!(store.get("a").unwrap(), None);
}

#[test]
fn an_unavailable_store_fails_every_call_and_never_reads_as_missing() {
    let store = MemorySecretStore::new();
    store.set("a", b"x").unwrap();
    store.set_unavailable(true);
    let unavailable = Err(KeyProviderError::SecureAnchorUnavailable);
    assert_eq!(store.get("a").map(|_| ()), unavailable);
    assert_eq!(store.set("a", b"y"), unavailable);
    assert_eq!(store.delete("a"), unavailable);
}

#[test]
fn a_read_only_store_refuses_mutation_but_still_reads() {
    let store = MemorySecretStore::new();
    store.set("a", b"x").unwrap();
    store.set_read_only(true);
    assert_eq!(store.set("a", b"y"), Err(KeyProviderError::Unavailable));
    assert_eq!(store.delete("a"), Err(KeyProviderError::Unavailable));
    assert_eq!(store.get("a").unwrap().unwrap().as_slice(), b"x");
}

#[test]
fn the_store_boundary_enforces_the_item_bound_in_both_directions() {
    let store = MemorySecretStore::new();
    store.set("max", &vec![7; MAX_ITEM_LEN]).unwrap();
    assert_eq!(store.get("max").unwrap().unwrap().len(), MAX_ITEM_LEN);
    // A write of one byte more is refused before the store is touched.
    assert!(matches!(
        store.set("big", &vec![7; MAX_ITEM_LEN + 1]),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert_eq!(store.accounts(), vec!["max".to_owned()]);
    // A write of exactly one byte more is refused even over an existing item, which stays intact.
    assert!(store.set("max", &vec![8; MAX_ITEM_LEN + 1]).is_err());
    assert_eq!(
        store.get("max").unwrap().unwrap().as_slice(),
        &vec![7; MAX_ITEM_LEN][..]
    );
    // An oversized item written from outside the boundary is refused on read, not returned.
    store.put_raw("big", &vec![7; MAX_ITEM_LEN + 1]);
    assert_eq!(
        store.get("big").map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn every_store_is_reached_only_through_the_checked_boundary() {
    // Generic callers see only the sealed trait; the bound holds for any implementation. (That the
    // raw backend can be neither implemented nor called from outside is proven by the
    // compile_fail doctests on the `secure_store` module.)
    fn write<S: SecretStore>(store: &S, len: usize) -> Result<(), KeyProviderError> {
        store.set("item", &vec![1; len])
    }
    let store = MemorySecretStore::new();
    assert!(write(&store, MAX_ITEM_LEN).is_ok());
    assert!(write(&store, MAX_ITEM_LEN + 1).is_err());
}

#[test]
fn clones_share_one_installation() {
    let store = MemorySecretStore::new();
    store.clone().set("a", b"x").unwrap();
    assert_eq!(store.accounts(), vec!["a".to_owned()]);
}
