//! Gate 1b-platform (headless): key resolution stays bound to the durable authority snapshotted at
//! unlock — cache/binding consistency, root-key loss or replacement, index loss, and roots committed
//! by another instance.
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
    // The authority advanced to a root this instance never cached: every resolution waits for a
    // re-unlock, including routes it had cached.
    assert_eq!(
        stale.resolve_ref(&route).map(|_| ()),
        Err(KeyProviderError::Locked)
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

#[test]
fn losing_the_root_key_blocks_every_epoch() {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider.provision_epoch_key(2).unwrap();
    provider.unlock().unwrap();
    assert!(provider.resolve(2).is_ok());
    store.delete(&key_account(&route)).unwrap();
    assert_eq!(provider.state(), Ok(KeyState::KeyLost));
    assert_eq!(
        provider.resolve(2).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
}

#[test]
fn a_replaced_root_key_blocks_other_epochs() {
    let (store, root, _, provider) = two_epochs_unlocked();
    store.put_raw(&key_account(&root), &[9; 32]);
    assert_eq!(
        provider.resolve(2).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn swapped_epoch_bindings_are_refused() {
    let (store, _, _, provider) = two_epochs_unlocked();
    let index = store.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap().to_vec();
    // Swap the two 40-byte routes in the well-formed index (header 8 bytes, entries of 8+2+40).
    let mut swapped = index.clone();
    let (a, b) = (8 + 10, 8 + 50 + 10);
    swapped[a..a + 40].copy_from_slice(&index[b..b + 40]);
    swapped[b..b + 40].copy_from_slice(&index[a..a + 40]);
    store.put_raw(EPOCH_INDEX_ACCOUNT, &swapped);
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn validation_precedes_an_unknown_epoch_answer() {
    let (store, _, _, provider) = two_epochs_unlocked();
    store.delete(EPOCH_INDEX_ACCOUNT).unwrap();
    assert_eq!(
        provider.resolve(9).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn provisioning_refuses_while_the_root_key_is_lost() {
    let (store, root) = configured();
    store.delete(&key_account(&root)).unwrap();
    let before = store.accounts();
    let mut provider = Provider::new(store.clone());
    assert_eq!(
        provider.provision_epoch_key(2).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(store.accounts(), before, "nothing was written");
}

#[test]
fn a_commit_refuses_a_target_key_replaced_since_unlock() {
    let (store, _, second, mut provider) = two_epochs_unlocked();
    provider
        .prepare_root_anchor(&request(&provider, "rotate", RootSlot::B, &second))
        .unwrap();
    store.put_raw(&key_account(&second), &[7; 32]);
    assert_eq!(
        provider.commit_root_anchor("rotate", 2),
        Err(KeyProviderError::RecoveryRequired)
    );
    let anchor = provider.read_root_anchor_state().unwrap();
    assert_eq!(
        anchor.committed_floor, 1,
        "the replaced key was not published"
    );
}

#[test]
fn state_agrees_with_resolution_about_a_replaced_root_key() {
    let (store, root, _, provider) = two_epochs_unlocked();
    store.put_raw(&key_account(&root), &[9; 32]);
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn state_agrees_with_resolution_about_swapped_bindings() {
    let (store, _, _, provider) = two_epochs_unlocked();
    let index = store.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap().to_vec();
    let mut swapped = index.clone();
    let (a, b) = (8 + 10, 8 + 50 + 10);
    swapped[a..a + 40].copy_from_slice(&index[b..b + 40]);
    swapped[b..b + 40].copy_from_slice(&index[a..a + 40]);
    store.put_raw(EPOCH_INDEX_ACCOUNT, &swapped);
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
}

fn swap_first_two_routes(store: &MemorySecretStore) {
    let index = store.get(EPOCH_INDEX_ACCOUNT).unwrap().unwrap().to_vec();
    let mut swapped = index.clone();
    let (a, b) = (8 + 10, 8 + 50 + 10);
    swapped[a..a + 40].copy_from_slice(&index[b..b + 40]);
    swapped[b..b + 40].copy_from_slice(&index[a..a + 40]);
    store.put_raw(EPOCH_INDEX_ACCOUNT, &swapped);
}

#[test]
fn a_commit_refuses_swapped_bindings() {
    let (store, _, second, mut provider) = two_epochs_unlocked();
    provider
        .prepare_root_anchor(&request(&provider, "rotate", RootSlot::B, &second))
        .unwrap();
    swap_first_two_routes(&store);
    assert_eq!(
        provider.commit_root_anchor("rotate", 2),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn provisioning_refuses_a_replaced_cached_root_key() {
    let (store, root, _, mut provider) = two_epochs_unlocked();
    store.put_raw(&key_account(&root), &[9; 32]);
    let before = store.accounts();
    let result = provider.provision_epoch_key(3).map(|_| ());
    assert_eq!(result, Err(KeyProviderError::RecoveryRequired));
    assert_eq!(store.accounts(), before, "nothing was written");
}

#[test]
fn a_malformed_root_key_is_the_recovery_state_not_an_error() {
    let (store, root) = configured();
    store.put_raw(&key_account(&root), &[1; 31]);
    let provider = Provider::new(store);
    assert_eq!(provider.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn resuming_a_cached_epoch_refuses_a_replaced_key_item() {
    let (store, _, second, mut provider) = two_epochs_unlocked();
    store.put_raw(&key_account(&second), &[4; 32]);
    assert_eq!(
        provider.provision_epoch_key(2),
        Err(KeyProviderError::RecoveryRequired)
    );
}
