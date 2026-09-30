//! Gate 1b-platform Slice C1: runtime key handles over the validated durable authority.

use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_layout::{
    encode_index, key_account, IndexEntry, ANCHOR_ACCOUNT, EPOCH_INDEX_ACCOUNT,
};
use worldscript_secure_storage::{anchor, anchor_codec};
use worldscript_secure_storage::{
    open, parse_envelope, seal, AnchorState, CommittedRoot, Key, KeyProviderError, KeyState,
    PrepareRootAnchor, RandomSource, RecordClass, RecordContext, RecordMeta, RootKeyRefV1,
    RootSlot, SealTarget, SecureStoreAuthority, SecureStoreRuntime,
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

type Runtime = SecureStoreRuntime<MemorySecretStore, FixedRandom>;

fn runtime(store: MemorySecretStore) -> Runtime {
    SecureStoreRuntime::new(SecureStoreAuthority::with_random(
        store,
        FixedRandom { next: 1 },
    ))
}

/// A scope plus the given epochs, provisioned through the durable authority.
fn provisioned(epochs: &[u64]) -> (MemorySecretStore, Vec<RootKeyRefV1>) {
    let store = MemorySecretStore::new();
    let mut seeded = runtime(store.clone());
    seeded
        .authority_mut()
        .read_or_provision_installation_scope()
        .unwrap();
    let routes = epochs
        .iter()
        .map(|epoch| seeded.authority_mut().provision_epoch_key(*epoch).unwrap())
        .collect();
    (store, routes)
}

fn read_anchor(store: &MemorySecretStore) -> AnchorState {
    anchor_codec::decode(&store.get(ANCHOR_ACCOUNT).unwrap().unwrap()).unwrap()
}

fn write_anchor(store: &MemorySecretStore, anchor_state: &AnchorState) {
    store
        .set(ANCHOR_ACCOUNT, &anchor_codec::encode(anchor_state).unwrap())
        .unwrap();
}

/// Publishes `route` as the committed root, as a completed step F would.
fn commit_root(store: &MemorySecretStore, route: &RootKeyRefV1) {
    let mut anchor_state = read_anchor(store);
    anchor_state.committed_floor = 1;
    anchor_state.committed_root = Some(CommittedRoot {
        root_generation: 1,
        root_digest: [0; 32],
        root_slot: RootSlot::A,
        root_key_ref: route.clone(),
    });
    anchor_state.last_committed_operation_id = Some("bootstrap".to_owned());
    write_anchor(store, &anchor_state);
}

/// A provisioned store and an unlocked runtime over it; `root` also commits epoch 1's key first.
fn unlocked(epochs: &[u64], root: bool) -> (MemorySecretStore, Vec<RootKeyRefV1>, Runtime) {
    let (store, routes) = provisioned(epochs);
    if root {
        commit_root(&store, &routes[0]);
    }
    let mut runtime = runtime(store.clone());
    runtime.unlock().unwrap();
    (store, routes, runtime)
}

/// Both resolution paths for one issued key give the same refusal.
fn assert_refused(runtime: &Runtime, epoch: u64, route: &RootKeyRefV1, error: KeyProviderError) {
    assert_eq!(runtime.resolve(epoch).err(), Some(error));
    assert_eq!(runtime.resolve_ref(route).err(), Some(error));
}

/// True when `resolved` is exactly the durable key of `route`: a record sealed with it opens with
/// a key built from the stored item.
fn is_durable_key(resolved: &Key, store: &MemorySecretStore, route: &RootKeyRefV1) -> bool {
    let mut bytes: [u8; 32] = store
        .get(&key_account(route))
        .unwrap()
        .unwrap()
        .as_slice()
        .try_into()
        .unwrap();
    let durable = Key::from_bytes(&mut bytes);
    let context = RecordContext {
        record_class: RecordClass::Project,
        logical_record_id: "c1",
        project_id: Some("project"),
    };
    let target = SealTarget {
        context,
        meta: RecordMeta {
            key_epoch: 1,
            record_generation: 1,
            record_schema: 1,
        },
    };
    let envelope = seal(resolved, &target, b"c1").unwrap();
    let parsed = parse_envelope(&envelope).unwrap();
    open(&durable, &context, &parsed).is_ok_and(|plain| plain == b"c1")
}

#[test]
fn a_locked_runtime_refuses_before_reading_the_store() {
    let (store, routes) = provisioned(&[1]);
    let locked = runtime(store.clone());
    store.set_unavailable(true);

    assert_refused(&locked, 1, &routes[0], KeyProviderError::Locked);
}

#[test]
fn bootstrap_keys_resolve_while_the_state_stays_unconfigured() {
    let (store, routes) = provisioned(&[1]);
    let mut runtime = runtime(store.clone());
    assert_eq!(runtime.state(), Ok(KeyState::Unconfigured));

    assert_eq!(runtime.unlock(), Ok(KeyState::Unconfigured));
    assert!(is_durable_key(
        &runtime.resolve(1).unwrap(),
        &store,
        &routes[0]
    ));
    assert!(is_durable_key(
        &runtime.resolve_ref(&routes[0]).unwrap(),
        &store,
        &routes[0]
    ));
    assert_eq!(
        runtime.resolve(2).err(),
        Some(KeyProviderError::UnknownEpoch)
    );
}

#[test]
fn a_committed_root_is_locked_until_unlock_and_locked_again_after_lock() {
    let (store, routes) = provisioned(&[1]);
    commit_root(&store, &routes[0]);
    let mut runtime = runtime(store.clone());
    assert_eq!(runtime.state(), Ok(KeyState::Locked));

    assert_eq!(runtime.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    runtime.lock();
    assert_eq!(runtime.state(), Ok(KeyState::Locked));
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
}

#[test]
fn an_unissued_route_is_never_resolved_by_search() {
    let (_, _, runtime) = unlocked(&[1], false);
    let (_, foreign) = provisioned(&[1, 2]);

    // `foreign[1]` is a well-formed route, but this store never issued it.
    assert_eq!(
        runtime.resolve_ref(&foreign[1]).err(),
        Some(KeyProviderError::UnknownKeyRef)
    );
}

#[test]
fn a_durable_key_that_changed_after_unlock_is_recovery_not_the_cached_key() {
    let (store, routes, runtime) = unlocked(&[1], true);

    store.put_raw(&key_account(&routes[0]), &[0xAB; 32]);
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::RecoveryRequired);
    assert_eq!(runtime.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn a_durable_key_deleted_after_unlock_is_key_lost() {
    let (store, routes, runtime) = unlocked(&[1, 2], true);

    store.delete(&key_account(&routes[1])).unwrap();
    assert_refused(&runtime, 2, &routes[1], KeyProviderError::KeyLost);
    assert!(is_durable_key(
        &runtime.resolve(1).unwrap(),
        &store,
        &routes[0]
    ));
}

#[test]
fn a_route_removed_from_the_index_after_unlock_is_not_resolved_from_the_cache() {
    let (store, routes, runtime) = unlocked(&[1, 2], false);

    let remaining = [IndexEntry {
        epoch: 1,
        key_ref: routes[0].clone(),
    }];
    store
        .set(EPOCH_INDEX_ACCOUNT, &encode_index(&remaining).unwrap())
        .unwrap();
    assert_eq!(
        runtime.resolve(2).err(),
        Some(KeyProviderError::UnknownEpoch)
    );
    assert_eq!(
        runtime.resolve_ref(&routes[1]).err(),
        Some(KeyProviderError::UnknownKeyRef)
    );
}

#[test]
fn a_key_provisioned_after_unlock_needs_a_new_unlock() {
    let (store, _, mut runtime) = unlocked(&[1], false);

    let later = runtime.authority_mut().provision_epoch_key(2).unwrap();
    assert_refused(&runtime, 2, &later, KeyProviderError::Locked);

    runtime.unlock().unwrap();
    assert!(is_durable_key(&runtime.resolve(2).unwrap(), &store, &later));
}

#[test]
fn an_unavailable_store_is_an_error_never_a_key_state() {
    let (store, routes, runtime) = unlocked(&[1], true);

    store.set_unavailable(true);
    assert_eq!(
        runtime.state(),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    assert_refused(
        &runtime,
        1,
        &routes[0],
        KeyProviderError::SecureAnchorUnavailable,
    );
}

#[test]
fn a_failed_unlock_grants_nothing() {
    let (store, routes) = provisioned(&[1]);
    commit_root(&store, &routes[0]);
    store.delete(&key_account(&routes[0])).unwrap();
    let mut runtime = runtime(store.clone());

    assert_eq!(runtime.unlock(), Err(KeyProviderError::KeyLost));
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);

    store.set_unavailable(true);
    assert_eq!(
        runtime.unlock(),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    store.set_unavailable(false);
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
}

#[test]
fn a_failed_unlock_also_drops_the_handles_of_an_earlier_unlock() {
    let (store, routes, mut runtime) = unlocked(&[1], false);

    store.put_raw(ANCHOR_ACCOUNT, b"not an anchor");
    assert!(runtime.unlock().is_err());
    store.delete(ANCHOR_ACCOUNT).unwrap();
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
}

#[test]
fn a_key_already_missing_at_unlock_is_key_lost_not_locked() {
    let (store, routes) = provisioned(&[1, 2]);
    store.delete(&key_account(&routes[1])).unwrap();
    let mut runtime = runtime(store.clone());

    assert_eq!(runtime.unlock(), Ok(KeyState::Unconfigured));
    assert_refused(&runtime, 2, &routes[1], KeyProviderError::KeyLost);
    assert!(is_durable_key(
        &runtime.resolve(1).unwrap(),
        &store,
        &routes[0]
    ));
}

#[test]
fn losing_the_committed_root_after_unlock_refuses_every_other_key() {
    let (store, routes, runtime) = unlocked(&[1, 2], true);

    store.delete(&key_account(&routes[0])).unwrap();
    assert_refused(&runtime, 2, &routes[1], KeyProviderError::KeyLost);
    assert_eq!(runtime.state(), Ok(KeyState::KeyLost));
}

#[test]
fn a_lost_prepared_target_key_is_not_loss_of_the_committed_root() {
    let (store, routes) = provisioned(&[1, 2]);
    commit_root(&store, &routes[0]);
    let prepared = anchor::prepare(
        &read_anchor(&store),
        &PrepareRootAnchor {
            operation_id: "rotate-2".to_owned(),
            expected_floor: 1,
            target_root_generation: 2,
            target_final_root_digest: [7; 32],
            target_slot: RootSlot::B,
            target_root_key_ref: routes[1].clone(),
        },
    )
    .unwrap();
    write_anchor(&store, &prepared);
    store.delete(&key_account(&routes[1])).unwrap();
    let mut runtime = runtime(store.clone());

    assert_eq!(runtime.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    assert_eq!(runtime.state(), Ok(KeyState::Unlocked { epoch: 1 }));
    assert!(is_durable_key(
        &runtime.resolve(1).unwrap(),
        &store,
        &routes[0]
    ));
    assert_eq!(runtime.resolve(2).err(), Some(KeyProviderError::KeyLost));
}

#[test]
fn an_anchor_that_loses_its_committed_root_after_unlock_is_recovery() {
    let (store, routes, runtime) = unlocked(&[1, 2], true);

    let mut rolled_back = read_anchor(&store);
    rolled_back.committed_floor = 0;
    rolled_back.committed_root = None;
    rolled_back.last_committed_operation_id = None;
    write_anchor(&store, &rolled_back);
    assert_refused(&runtime, 2, &routes[1], KeyProviderError::RecoveryRequired);
    assert_eq!(runtime.state(), Ok(KeyState::RecoveryRequired));
}

#[test]
fn a_committed_root_that_changes_after_unlock_needs_a_new_unlock() {
    let (store, routes, mut runtime) = unlocked(&[1, 2], true);

    // Epoch 2 is indexed, loaded and unchanged, but the unlock was bound to epoch 1's root.
    commit_root(&store, &routes[1]);
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
    assert_eq!(runtime.state(), Ok(KeyState::Locked));

    assert_eq!(runtime.unlock(), Ok(KeyState::Unlocked { epoch: 2 }));
    assert!(is_durable_key(
        &runtime.resolve(1).unwrap(),
        &store,
        &routes[0]
    ));
}

#[test]
fn a_first_commit_after_an_unconfigured_unlock_needs_a_new_unlock() {
    let (store, routes, mut runtime) = unlocked(&[1], false);

    commit_root(&store, &routes[0]);
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);

    assert_eq!(runtime.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
}

// #914 carry-over: the binding is compared before the new root's key material is read, so a
// stale session sees `Locked` (unlock again) rather than terminal key loss of a root it never had.
#[test]
fn a_changed_root_whose_key_is_missing_is_locked_for_a_stale_session() {
    let (store, routes, runtime) = unlocked(&[1, 2], true);

    commit_root(&store, &routes[1]);
    store.delete(&key_account(&routes[1])).unwrap();
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
    assert_eq!(runtime.state(), Ok(KeyState::Locked));
}

#[test]
fn a_first_root_whose_key_is_missing_is_locked_after_an_unconfigured_unlock() {
    let (store, routes, runtime) = unlocked(&[1, 2], false);

    commit_root(&store, &routes[1]);
    store.delete(&key_account(&routes[1])).unwrap();
    assert_refused(&runtime, 1, &routes[0], KeyProviderError::Locked);
    assert_eq!(runtime.state(), Ok(KeyState::Locked));
}
