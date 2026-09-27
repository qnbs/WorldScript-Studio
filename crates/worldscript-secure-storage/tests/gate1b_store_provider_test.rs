//! Gate 1b-platform (headless): the secure-store–backed `KeyProvider` over an in-memory
//! `SecretStore` — persistence across restarts, the strict `WSA1` anchor encoding, and fail-closed
//! behavior for corruption, key loss and an unavailable store.

use worldscript_secure_storage::anchor_codec;
use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_provider::{
    SecureStoreKeyProvider, ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT, MAX_INDEXED_EPOCHS,
};
use worldscript_secure_storage::{
    open, parse_envelope, seal, KeyProvider, KeyProviderError, KeyState, PrepareRootAnchor,
    RecordClass, RecordContext, RecordMeta, RootKeyRefV1, RootSlot, SealTarget,
};

type Provider = SecureStoreKeyProvider<MemorySecretStore>;

fn request(
    provider: &Provider,
    operation_id: &str,
    slot: RootSlot,
    route: &RootKeyRefV1,
) -> PrepareRootAnchor {
    let floor = provider.read_root_anchor_state().unwrap().committed_floor;
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: floor,
        target_root_generation: floor + 1,
        target_final_root_digest: [7; 32],
        target_slot: slot,
        target_root_key_ref: route.clone(),
    }
}

/// A store holding a scope, one epoch key and a committed root, plus that key's route.
fn configured() -> (MemorySecretStore, RootKeyRefV1) {
    let store = MemorySecretStore::new();
    let mut provider = Provider::new(store.clone());
    provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    provider
        .prepare_root_anchor(&request(&provider, "boot", RootSlot::A, &route))
        .unwrap();
    provider.commit_root_anchor("boot", 1).unwrap();
    (store, route)
}

fn target() -> SealTarget<'static> {
    SealTarget {
        context: RecordContext {
            record_class: RecordClass::Settings,
            logical_record_id: "settings:global",
            project_id: None,
        },
        meta: RecordMeta {
            key_epoch: 1,
            record_generation: 1,
            record_schema: 1,
        },
    }
}

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
fn a_key_resolved_after_restart_opens_what_was_sealed_before() {
    let (store, route) = configured();
    let mut before = Provider::new(store.clone());
    before.unlock().unwrap();
    let envelope = seal(&before.resolve_ref(&route).unwrap(), &target(), b"secret").unwrap();
    let mut after = Provider::new(store);
    after.unlock().unwrap();
    let parsed = parse_envelope(&envelope).unwrap();
    assert_eq!(
        open(&after.resolve(1).unwrap(), &target().context, &parsed).unwrap(),
        b"secret"
    );
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

/// A provider on a fresh store with its installation scope provisioned (bootstrap order).
fn scoped(store: &MemorySecretStore) -> Provider {
    let mut provider = Provider::new(store.clone());
    provider.read_or_provision_installation_scope().unwrap();
    provider
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
fn a_deleted_root_key_is_key_lost() {
    let (store, route) = configured();
    let account = format!(
        "r15-key-{}",
        route
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    store.delete(&account).unwrap();
    let mut provider = Provider::new(store);
    assert_eq!(provider.state(), Ok(KeyState::KeyLost));
    assert_eq!(provider.unlock(), Err(KeyProviderError::KeyLost));
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

fn request_unchecked(operation_id: &str, route: RootKeyRefV1) -> PrepareRootAnchor {
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: 1,
        target_root_generation: 2,
        target_final_root_digest: [0; 32],
        target_slot: RootSlot::B,
        target_root_key_ref: route,
    }
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

// ---- WSA1 anchor encoding ------------------------------------------------------------------

fn prepared_anchor_bytes() -> Vec<u8> {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider
        .prepare_root_anchor(&request(&provider, "op-2", RootSlot::B, &route))
        .unwrap();
    store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec()
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

fn with_byte(bytes: &[u8], index: usize, value: u8) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[index] = value;
    out
}

fn key_account(route: &RootKeyRefV1) -> String {
    let hex: String = route
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("r15-key-{hex}")
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
fn a_lost_non_root_key_is_key_lost_not_unknown() {
    let (store, _) = configured();
    let mut provider = Provider::new(store.clone());
    let second = provider.provision_epoch_key(2).unwrap();
    store.delete(&key_account(&second)).unwrap();
    let mut restarted = Provider::new(store);
    restarted.unlock().unwrap();
    assert_eq!(
        restarted.resolve(2).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(
        restarted.resolve_ref(&second).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    let listed = restarted.list_epochs().unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|e| (e.epoch, e.available))
            .collect::<Vec<_>>(),
        vec![(1, true), (2, false)]
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
fn a_failed_unlock_leaves_the_provider_unchanged() {
    let (store, _) = configured();
    store.put_raw(EPOCH_INDEX_ACCOUNT, b"XXXX\0\0\0\0");
    let mut provider = Provider::new(store);
    assert!(provider.unlock().is_err());
    assert_eq!(provider.runtime_key_count(), 0);
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
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
fn a_failed_re_unlock_drops_previously_cached_keys() {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider.unlock().unwrap();
    assert!(provider.resolve_ref(&route).is_ok());
    store.delete(&key_account(&route)).unwrap();
    assert_eq!(provider.unlock(), Err(KeyProviderError::KeyLost));
    assert_eq!(provider.runtime_key_count(), 0);
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::Locked)
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
fn a_commit_after_index_loss_is_refused_and_leaves_the_preparation() {
    let store = MemorySecretStore::new();
    let mut provider = scoped(&store);
    let route = provider.provision_epoch_key(1).unwrap();
    provider
        .prepare_root_anchor(&request(&provider, "boot", RootSlot::A, &route))
        .unwrap();
    store.delete(EPOCH_INDEX_ACCOUNT).unwrap();
    assert_eq!(
        provider.commit_root_anchor("boot", 1),
        Err(KeyProviderError::UnknownKeyRef)
    );
    let anchor = anchor_codec::decode(&store.get(ANCHOR_ACCOUNT).unwrap().unwrap()).unwrap();
    assert_eq!(anchor.committed_floor, 0, "the floor was not advanced");
    assert!(
        anchor.prepared_root_commit.is_some(),
        "the preparation is still recoverable"
    );
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
fn a_root_committed_elsewhere_reads_as_locked_until_re_unlock() {
    let (store, route) = configured();
    let mut stale = Provider::new(store.clone());
    stale.unlock().unwrap();
    let mut other = Provider::new(store.clone());
    let new_route = other.provision_epoch_key(2).unwrap();
    other
        .prepare_root_anchor(&request(&other, "rotate", RootSlot::B, &new_route))
        .unwrap();
    other.commit_root_anchor("rotate", 2).unwrap();
    assert_eq!(stale.state(), Ok(KeyState::Locked));
    assert_eq!(
        stale.resolve_ref(&new_route).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
    assert!(
        stale.resolve_ref(&route).is_ok(),
        "already cached keys stay usable"
    );
    assert_eq!(stale.unlock(), Ok(KeyState::Unlocked { epoch: 2 }));
}

#[test]
fn a_cached_key_stops_resolving_once_its_item_is_lost() {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider.unlock().unwrap();
    store.delete(&key_account(&route)).unwrap();
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
}

#[test]
fn a_cached_key_whose_item_was_replaced_requires_recovery() {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider.unlock().unwrap();
    store.put_raw(&key_account(&route), &[9; 32]);
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
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
fn cached_keys_stop_resolving_once_the_durable_authority_is_refused() {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider.unlock().unwrap();
    store.put_raw(EPOCH_INDEX_ACCOUNT, b"XXXX\0\0\0\0");
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
    store.delete(EPOCH_INDEX_ACCOUNT).unwrap();
    assert_eq!(
        provider.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}
