//! Gate 1b-platform (headless): the secure-store–backed `KeyProvider` over an in-memory
//! `SecretStore` — lifecycle and persistence, the strict `WSA1`/`WSE1` encodings, bootstrap order,
//! and fail-closed handling of corruption, loss and an unavailable store.
#![allow(unused_imports)]

use worldscript_secure_storage::anchor_codec;
use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_provider::{
    ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT, MAX_INDEXED_EPOCHS,
};
use worldscript_secure_storage::{
    open, parse_envelope, seal, KeyProvider, KeyProviderError, KeyState, RootKeyRefV1, RootSlot,
};

mod common;
use common::*;

#[test]
fn authority_survives_a_restart_and_starts_locked() {
    let (store, route) = configured();
    let mut restarted = Provider::new(store);
    assert_eq!(restarted.state(), Ok(KeyState::Locked));
    let anchor = restarted.read_root_anchor_state().unwrap();
    assert_eq!(anchor.committed_root.unwrap().root_key_ref, route);
    assert_eq!(restarted.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
}

#[test]
fn only_the_anchor_index_and_issued_key_items_are_written() {
    let (store, route) = configured();
    let key_account = format!(
        "r15-key-{}",
        route
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let mut expected = vec![
        ANCHOR_ACCOUNT.to_owned(),
        EPOCH_INDEX_ACCOUNT.to_owned(),
        key_account,
    ];
    expected.sort();
    assert_eq!(store.accounts(), expected);
    assert!(route.as_bytes().starts_with(b"wss-kr1-") && route.as_bytes().len() == 40);
}

#[test]
fn routes_are_random_per_key() {
    let store = MemorySecretStore::new();
    let mut provider = scoped(&store);
    let first = provider.provision_epoch_key(1).unwrap();
    let second = provider.provision_epoch_key(2).unwrap();
    assert_ne!(first, second);
}

#[test]
fn prepare_refuses_routes_the_store_never_issued() {
    let store = MemorySecretStore::new();
    let mut provider = Provider::new(store);
    provider.read_or_provision_installation_scope().unwrap();
    let fabricated =
        RootKeyRefV1::new(b"wss-kr1-00000000000000000000000000000000".to_vec()).unwrap();
    let result = provider.prepare_root_anchor(&request(&provider, "op", RootSlot::A, &fabricated));
    assert_eq!(result, Err(KeyProviderError::UnknownKeyRef));
}

#[test]
fn a_corrupted_anchor_requires_recovery_and_blocks_transitions() {
    let (store, route) = configured();
    let mut bytes = store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec();
    bytes.push(0);
    store.put_raw(ANCHOR_ACCOUNT, &bytes);
    let mut provider = Provider::new(store);
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
    let result = provider.prepare_root_anchor(&request_unchecked("op", route));
    assert_eq!(result, Err(KeyProviderError::RecoveryRequired));
}

#[test]
fn a_future_anchor_format_is_reported_not_rewritten() {
    let (store, route) = configured();
    let mut bytes = store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec();
    bytes[7] = 2;
    store.put_raw(ANCHOR_ACCOUNT, &bytes);
    let mut provider = Provider::new(store.clone());
    assert_eq!(
        provider.state(),
        Err(KeyProviderError::UnsupportedAnchorFormat)
    );
    let result = provider.prepare_root_anchor(&request_unchecked("op", route));
    assert_eq!(result, Err(KeyProviderError::UnsupportedAnchorFormat));
    assert_eq!(
        store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec(),
        bytes,
        "never rewritten"
    );
}

#[test]
fn an_unavailable_store_fails_closed() {
    let (store, _) = configured();
    store.set_unavailable(true);
    let mut provider = Provider::new(store);
    assert_eq!(
        provider.state(),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    assert_eq!(
        provider.unlock(),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    let scope = provider.read_or_provision_installation_scope().map(|_| ());
    assert_eq!(scope, Err(KeyProviderError::SecureAnchorUnavailable));
}

#[test]
fn lock_clears_runtime_keys() {
    let (store, route) = configured();
    let mut provider = Provider::new(store);
    provider.unlock().unwrap();
    assert_eq!(provider.runtime_key_count(), 1);
    provider.lock();
    assert_eq!(provider.runtime_key_count(), 0);
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
}

#[test]
fn the_anchor_encoding_round_trips_exactly() {
    let bytes = prepared_anchor_bytes();
    let decoded = anchor_codec::decode(&bytes).unwrap();
    assert!(decoded.committed_root.is_some() && decoded.prepared_root_commit.is_some());
    assert_eq!(anchor_codec::encode(&decoded).unwrap(), bytes);
}

#[test]
fn malformed_anchor_bytes_are_refused() {
    let bytes = prepared_anchor_bytes();
    let cases: [(&str, Vec<u8>, KeyProviderError); 5] = [
        (
            "wrong magic",
            [b"WSA2", &bytes[4..]].concat(),
            KeyProviderError::UnsupportedAnchorFormat,
        ),
        (
            "truncated",
            bytes[..bytes.len() - 1].to_vec(),
            KeyProviderError::RecoveryRequired,
        ),
        (
            "trailing byte",
            [&bytes[..], &[0]].concat(),
            KeyProviderError::RecoveryRequired,
        ),
        (
            "scope flag 2",
            with_byte(&bytes, 12, 2),
            KeyProviderError::RecoveryRequired,
        ),
        (
            "empty",
            Vec::new(),
            KeyProviderError::UnsupportedAnchorFormat,
        ),
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
fn a_full_epoch_index_is_refused_before_anything_is_written() {
    let store = MemorySecretStore::new();
    let mut provider = scoped(&store);
    for epoch in 1..=MAX_INDEXED_EPOCHS as u64 {
        provider.provision_epoch_key(epoch).unwrap();
    }
    let before = store.accounts();
    let next = provider
        .provision_epoch_key(MAX_INDEXED_EPOCHS as u64 + 1)
        .map(|_| ());
    assert!(matches!(next, Err(KeyProviderError::AnchorConflict(_))));
    assert_eq!(store.accounts(), before, "no orphaned key item");
    let index = store.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap();
    assert!(
        index.len() <= 2560,
        "index {} bytes exceeds the Windows blob bound",
        index.len()
    );
}

#[test]
fn a_malformed_key_item_requires_recovery_when_listed() {
    let (store, route) = configured();
    store.put_raw(&key_account(&route), &[0; 31]);
    let provider = Provider::new(store);
    assert_eq!(
        provider.list_epochs().map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn a_corrupted_epoch_index_requires_recovery() {
    let (store, _) = configured();
    store.put_raw(EPOCH_INDEX_ACCOUNT, b"XXXX\0\0\0\0");
    let mut provider = Provider::new(store);
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
    assert_eq!(provider.unlock(), Err(KeyProviderError::RecoveryRequired));
}

#[test]
fn an_exact_replay_needs_no_write() {
    let (store, _) = configured();
    store.set_read_only(true);
    let mut provider = Provider::new(store);
    assert_eq!(provider.commit_root_anchor("boot", 1), Ok(()));
    assert_eq!(provider.abort_or_recover_root_anchor("boot"), Ok(()));
}

#[test]
fn a_missing_anchor_next_to_an_epoch_index_is_never_a_fresh_install() {
    let (store, _) = configured();
    store.delete(ANCHOR_ACCOUNT).unwrap();
    let mut provider = Provider::new(store.clone());
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
    let scope = provider.read_or_provision_installation_scope().map(|_| ());
    assert_eq!(scope, Err(KeyProviderError::RecoveryRequired));
    assert!(
        store.get(ANCHOR_ACCOUNT).unwrap().is_none(),
        "no new scope was provisioned"
    );
}

#[test]
fn a_corrupted_index_is_reported_during_bootstrap() {
    let store = MemorySecretStore::new();
    let mut provider = Provider::new(store.clone());
    provider.read_or_provision_installation_scope().unwrap();
    provider.provision_epoch_key(1).unwrap();
    store.put_raw(EPOCH_INDEX_ACCOUNT, b"XXXX\0\0\0\0");
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn a_non_canonical_indexed_route_requires_recovery() {
    let (store, route) = configured();
    let mut index = store.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap().to_vec();
    let position = index
        .windows(route.as_bytes().len())
        .position(|w| w == route.as_bytes())
        .unwrap();
    index[position + 8] = b'G';
    store.put_raw(EPOCH_INDEX_ACCOUNT, &index);
    let provider = Provider::new(store);
    assert_eq!(
        provider.list_epochs().map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn keys_cannot_be_provisioned_before_the_installation_scope() {
    let store = MemorySecretStore::new();
    let mut provider = Provider::new(store.clone());
    let result = provider.provision_epoch_key(1).map(|_| ());
    assert!(matches!(result, Err(KeyProviderError::AnchorConflict(_))));
    assert!(store.accounts().is_empty(), "nothing was written");
}

#[test]
fn cold_start_refuses_a_root_whose_route_is_not_indexed() {
    let (store, _) = configured();
    // Replace the index with one from another installation: well-formed, but without this root.
    let foreign = MemorySecretStore::new();
    let mut foreign_provider = scoped(&foreign);
    foreign_provider.provision_epoch_key(1).unwrap();
    store.put_raw(
        EPOCH_INDEX_ACCOUNT,
        &foreign.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap(),
    );
    let provider = Provider::new(store);
    assert_eq!(
        provider.read_root_anchor_state().map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn provisioning_refuses_an_installation_whose_root_is_unindexed() {
    let (store, _) = configured();
    store.delete(EPOCH_INDEX_ACCOUNT).unwrap();
    let before = store.accounts();
    let mut provider = Provider::new(store.clone());
    let result = provider.provision_epoch_key(2).map(|_| ());
    assert_eq!(result, Err(KeyProviderError::RecoveryRequired));
    assert_eq!(store.accounts(), before, "nothing was written");
}

#[test]
fn re_provisioning_an_indexed_epoch_resumes_with_its_existing_route() {
    let store = MemorySecretStore::new();
    let first = scoped(&store).provision_epoch_key(1).unwrap();
    let accounts = store.accounts();
    // A restarted bootstrap asks for the same epoch again: the durable route comes back unchanged.
    let mut restarted = Provider::new(store.clone());
    assert_eq!(restarted.provision_epoch_key(1), Ok(first.clone()));
    assert_eq!(store.accounts(), accounts, "nothing was rewritten");
    store.delete(&key_account(&first)).unwrap();
    assert_eq!(
        restarted.provision_epoch_key(1),
        Err(KeyProviderError::KeyLost)
    );
}

#[test]
fn a_scope_less_anchor_next_to_an_epoch_index_is_never_fresh() {
    let (store, _) = configured();
    store.put_raw(
        ANCHOR_ACCOUNT,
        &anchor_codec::encode(&worldscript_secure_storage::AnchorState::empty()).unwrap(),
    );
    let mut provider = Provider::new(store.clone());
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
    let scope = provider.read_or_provision_installation_scope().map(|_| ());
    assert_eq!(scope, Err(KeyProviderError::RecoveryRequired));
}

#[test]
fn a_future_anchor_version_is_refused_before_reading_v1_fields() {
    // "WSA1", anchor_format_version 2, then a truncated/changed future layout.
    let future = [b"WSA1".as_slice(), &2u32.to_be_bytes(), &[0x01]].concat();
    assert_eq!(
        anchor_codec::decode(&future).map(|_| ()),
        Err(KeyProviderError::UnsupportedAnchorFormat)
    );
}
