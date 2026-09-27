//! Gate 1b-platform Slice B: durable scope/index/key relationships and bootstrap replay.

use worldscript_secure_storage::anchor_codec;
use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_layout::{key_account, ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT};
use worldscript_secure_storage::{
    AnchorState, KeyProviderError, RandomSource, SecureStoreAuthority,
};

#[derive(Clone)]
struct FixedRandom {
    next: u8,
}

impl RandomSource for FixedRandom {
    fn fill(
        &mut self,
        bytes: &mut [u8],
    ) -> Result<(), worldscript_secure_storage::RandomnessUnavailable> {
        bytes.fill(self.next);
        self.next = self.next.wrapping_add(1);
        Ok(())
    }
}

fn authority(store: MemorySecretStore) -> SecureStoreAuthority<MemorySecretStore, FixedRandom> {
    SecureStoreAuthority::with_random(store, FixedRandom { next: 1 })
}

#[test]
fn scope_provisioning_is_exactly_resumed_after_restart() {
    let store = MemorySecretStore::new();
    let mut first = authority(store.clone());
    let scope = first.read_or_provision_installation_scope().unwrap();
    let accounts = store.accounts();

    let mut restarted = authority(store.clone());
    assert_eq!(restarted.read_or_provision_installation_scope(), Ok(scope));
    assert_eq!(store.accounts(), accounts);
}

#[test]
fn epoch_provisioning_reuses_an_intact_route_without_rewriting() {
    let store = MemorySecretStore::new();
    let mut first = authority(store.clone());
    first.read_or_provision_installation_scope().unwrap();
    let route = first.provision_epoch_key(1).unwrap();
    let accounts = store.accounts();

    let mut restarted = authority(store.clone());
    assert_eq!(restarted.provision_epoch_key(1), Ok(route.clone()));
    assert_eq!(store.accounts(), accounts);
    assert_eq!(restarted.list_epochs().unwrap()[0].key_ref, route);
}

#[test]
fn missing_scope_next_to_an_index_is_recovery_not_fresh_installation() {
    let store = MemorySecretStore::new();
    let mut seeded = authority(store.clone());
    seeded.read_or_provision_installation_scope().unwrap();
    seeded.provision_epoch_key(1).unwrap();
    store.delete(ANCHOR_ACCOUNT).unwrap();

    let mut restarted = authority(store.clone());
    assert_eq!(
        restarted.read_or_provision_installation_scope(),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn missing_indexed_key_is_listed_as_key_loss_and_cannot_be_reprovisioned() {
    let store = MemorySecretStore::new();
    let mut seeded = authority(store.clone());
    seeded.read_or_provision_installation_scope().unwrap();
    let route = seeded.provision_epoch_key(1).unwrap();
    store.delete(&key_account(&route)).unwrap();

    let mut restarted = authority(store);
    let listed = restarted.list_epochs().unwrap();
    assert!(!listed[0].available);
    assert_eq!(
        restarted.provision_epoch_key(1),
        Err(KeyProviderError::KeyLost)
    );
}

#[test]
fn malformed_indexed_key_blocks_listing_and_new_provisioning() {
    let store = MemorySecretStore::new();
    let mut seeded = authority(store.clone());
    seeded.read_or_provision_installation_scope().unwrap();
    let route = seeded.provision_epoch_key(1).unwrap();
    store.put_raw(&key_account(&route), &[7; 31]);

    let mut restarted = authority(store);
    assert_eq!(
        restarted.list_epochs(),
        Err(KeyProviderError::RecoveryRequired)
    );
    assert_eq!(
        restarted.provision_epoch_key(2),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn malformed_anchor_is_preserved_and_blocks_bootstrap() {
    let store = MemorySecretStore::new();
    store.put_raw(ANCHOR_ACCOUNT, b"WSA1\0\0\0\x02");
    let before = store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec();
    let restarted = authority(store.clone());

    assert_eq!(
        restarted.read_root_anchor_state(),
        Err(KeyProviderError::UnsupportedAnchorFormat)
    );
    assert_eq!(store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec(), before);
}

#[test]
fn an_empty_anchor_round_trips_through_the_existing_codec() {
    let state = AnchorState::empty();
    let encoded = anchor_codec::encode(&state).unwrap();
    assert_eq!(anchor_codec::decode(&encoded).unwrap(), state);
    assert_eq!(EPOCH_INDEX_ACCOUNT, "r15-epochs-v1");
}
