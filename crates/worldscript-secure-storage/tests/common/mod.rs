//! Shared fixtures for the Gate 1b-platform secure-store provider suites.
#![allow(dead_code)]

use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_provider::{SecureStoreKeyProvider, ANCHOR_ACCOUNT};
use worldscript_secure_storage::{
    KeyProvider, PrepareRootAnchor, RecordClass, RecordContext, RecordMeta, RootKeyRefV1, RootSlot,
    SealTarget,
};

pub type Provider = SecureStoreKeyProvider<MemorySecretStore>;

pub fn request(
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
pub fn configured() -> (MemorySecretStore, RootKeyRefV1) {
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

pub fn target() -> SealTarget<'static> {
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

/// A provider on a fresh store with its installation scope provisioned (bootstrap order).
pub fn scoped(store: &MemorySecretStore) -> Provider {
    let mut provider = Provider::new(store.clone());
    provider.read_or_provision_installation_scope().unwrap();
    provider
}

pub fn request_unchecked(operation_id: &str, route: RootKeyRefV1) -> PrepareRootAnchor {
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: 1,
        target_root_generation: 2,
        target_final_root_digest: [0; 32],
        target_slot: RootSlot::B,
        target_root_key_ref: route,
    }
}

pub fn prepared_anchor_bytes() -> Vec<u8> {
    let (store, route) = configured();
    let mut provider = Provider::new(store.clone());
    provider
        .prepare_root_anchor(&request(&provider, "op-2", RootSlot::B, &route))
        .unwrap();
    store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec()
}

pub fn with_byte(bytes: &[u8], index: usize, value: u8) -> Vec<u8> {
    let mut out = bytes.to_vec();
    out[index] = value;
    out
}

pub fn key_account(route: &RootKeyRefV1) -> String {
    let hex: String = route
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("r15-key-{hex}")
}

/// A configured store plus a cached second epoch; returns (store, root route, second route).
pub fn two_epochs_unlocked() -> (MemorySecretStore, RootKeyRefV1, RootKeyRefV1, Provider) {
    let (store, root) = configured();
    let mut provider = Provider::new(store.clone());
    let second = provider.provision_epoch_key(2).unwrap();
    provider.unlock().unwrap();
    (store, root, second, provider)
}
