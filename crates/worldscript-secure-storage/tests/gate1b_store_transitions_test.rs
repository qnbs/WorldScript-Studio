//! Gate 1b-platform Slice C2: durable §5.3.1 anchor transitions over the secure store, the full
//! `KeyProvider` over the store-backed runtime, and step-F rebinding of an unlocked session.

use worldscript_secure_storage::anchor_codec;
use worldscript_secure_storage::secure_store::{MemorySecretStore, SecretStore};
use worldscript_secure_storage::store_layout::{key_account, ANCHOR_ACCOUNT};
use worldscript_secure_storage::{
    AnchorState, KeyProvider, KeyProviderError, KeyState, PrepareRootAnchor, RandomSource,
    RootKeyRefV1, RootSlot, SecureStoreAuthority, SecureStoreRuntime,
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

type Provider = SecureStoreRuntime<MemorySecretStore, FixedRandom>;

fn provider(store: &MemorySecretStore) -> Provider {
    SecureStoreRuntime::new(SecureStoreAuthority::with_random(
        store.clone(),
        FixedRandom { next: 1 },
    ))
}

/// A store with a scope and the given epochs, provisioned through the trait.
fn provisioned(epochs: &[u64]) -> (MemorySecretStore, Vec<RootKeyRefV1>) {
    let store = MemorySecretStore::new();
    let mut seeded = provider(&store);
    seeded.read_or_provision_installation_scope().unwrap();
    let routes = epochs
        .iter()
        .map(|epoch| seeded.provision_epoch_key(*epoch).unwrap())
        .collect();
    (store, routes)
}

fn anchor_bytes(store: &MemorySecretStore) -> Vec<u8> {
    store.get(ANCHOR_ACCOUNT).unwrap().unwrap().to_vec()
}

fn durable_anchor(store: &MemorySecretStore) -> AnchorState {
    anchor_codec::decode(&anchor_bytes(store)).unwrap()
}

fn request(
    store: &MemorySecretStore,
    operation_id: &str,
    slot: RootSlot,
    route: &RootKeyRefV1,
) -> PrepareRootAnchor {
    let floor = durable_anchor(store).committed_floor;
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: floor,
        target_root_generation: floor + 1,
        target_final_root_digest: [floor as u8 + 1; 32],
        target_slot: slot,
        target_root_key_ref: route.clone(),
    }
}

/// Prepares and commits `prepared` as the next root through `provider`.
fn publish(provider: &mut Provider, prepared: &PrepareRootAnchor) {
    provider.prepare_root_anchor(prepared).unwrap();
    provider
        .commit_root_anchor(&prepared.operation_id, prepared.target_root_generation)
        .unwrap();
}

fn is_conflict(result: Result<(), KeyProviderError>) -> bool {
    matches!(result, Err(KeyProviderError::AnchorConflict(_)))
}

#[test]
fn prepare_records_durable_intent_without_raising_the_floor() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);

    provider
        .prepare_root_anchor(&request(&store, "boot", RootSlot::A, &routes[0]))
        .unwrap();
    let durable = durable_anchor(&store);
    assert_eq!(durable.committed_floor, 0);
    assert!(durable.committed_root.is_none());
    let prepared = durable.prepared_root_commit.unwrap();
    assert_eq!(prepared.operation_id, "boot");
    assert_eq!(prepared.target_root_key_ref, routes[0]);
    assert_eq!(prepared.preparation_revision, 1);
}

#[test]
fn prepare_requires_an_issued_and_resolvable_route() {
    let (store, routes) = provisioned(&[1]);
    let (_, foreign) = provisioned(&[1, 2]);
    let mut provider = provider(&store);
    let before = anchor_bytes(&store);

    assert_eq!(
        provider.prepare_root_anchor(&request(&store, "boot", RootSlot::A, &foreign[1])),
        Err(KeyProviderError::UnknownKeyRef)
    );
    store.delete(&key_account(&routes[0])).unwrap();
    assert_eq!(
        provider.prepare_root_anchor(&request(&store, "boot", RootSlot::A, &routes[0])),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(anchor_bytes(&store), before);
}

#[test]
fn commit_publishes_exactly_the_prepared_root_durably() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );

    let durable = durable_anchor(&store);
    assert_eq!(durable.committed_floor, 1);
    assert!(durable.prepared_root_commit.is_none());
    assert_eq!(durable.last_committed_operation_id.as_deref(), Some("boot"));
    let root = durable.committed_root.unwrap();
    assert_eq!(root.root_key_ref, routes[0]);
    assert_eq!(root.root_slot, RootSlot::A);
    assert_eq!(root.root_digest, [1; 32]);

    // A restarted provider reads the same committed authority.
    let restarted = provider_restarted(&store);
    assert_eq!(
        restarted.read_root_anchor_state().unwrap(),
        durable_anchor(&store)
    );
    assert_eq!(restarted.state(), Ok(KeyState::Locked));
}

fn provider_restarted(store: &MemorySecretStore) -> Provider {
    provider(store)
}

#[test]
fn an_exact_commit_replay_succeeds_without_writing() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    let before = anchor_bytes(&store);

    store.set_read_only(true);
    assert_eq!(provider.commit_root_anchor("boot", 1), Ok(()));
    assert_eq!(anchor_bytes(&store), before);
}

#[test]
fn conflicting_transitions_leave_the_durable_anchor_unchanged() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut provider = provider(&store);
    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    provider
        .prepare_root_anchor(&request(&store, "rotate", RootSlot::B, &routes[1]))
        .unwrap();
    let before = anchor_bytes(&store);

    let mut stale = request(&store, "other", RootSlot::B, &routes[1]);
    stale.expected_floor = 0;
    assert!(is_conflict(provider.prepare_root_anchor(&stale)));
    assert!(is_conflict(provider.prepare_root_anchor(&request(
        &store,
        "other",
        RootSlot::B,
        &routes[1]
    ))));
    assert!(is_conflict(provider.commit_root_anchor("other", 2)));
    assert!(is_conflict(provider.commit_root_anchor("rotate", 3)));
    assert!(is_conflict(provider.abort_or_recover_root_anchor("other")));
    assert!(is_conflict(provider.prepare_root_anchor(&request(
        &store,
        "slot",
        RootSlot::A,
        &routes[1]
    ))));
    assert_eq!(anchor_bytes(&store), before);
}

#[test]
fn abort_clears_only_its_own_preparation_and_never_moves_the_root() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut provider = provider(&store);
    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    let committed = durable_anchor(&store);
    provider
        .prepare_root_anchor(&request(&store, "rotate", RootSlot::B, &routes[1]))
        .unwrap();

    provider.abort_or_recover_root_anchor("rotate").unwrap();
    assert_eq!(durable_anchor(&store), committed);

    // With nothing prepared, abort is an idempotent success that writes nothing.
    store.set_read_only(true);
    assert_eq!(provider.abort_or_recover_root_anchor("rotate"), Ok(()));
    assert_eq!(durable_anchor(&store), committed);
}

#[test]
fn a_refused_write_keeps_the_prior_anchor_and_the_transition_can_be_retried() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    let prepared = request(&store, "boot", RootSlot::A, &routes[0]);
    provider.prepare_root_anchor(&prepared).unwrap();
    let before = anchor_bytes(&store);

    store.set_read_only(true);
    assert_eq!(
        provider.commit_root_anchor("boot", 1),
        Err(KeyProviderError::Unavailable)
    );
    assert_eq!(anchor_bytes(&store), before);

    store.set_read_only(false);
    assert_eq!(provider.commit_root_anchor("boot", 1), Ok(()));
    assert_eq!(durable_anchor(&store).committed_floor, 1);
}

#[test]
fn an_unreachable_store_fails_every_transition_as_unavailable_authority() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    let prepared = request(&store, "boot", RootSlot::A, &routes[0]);

    store.set_unavailable(true);
    let unavailable = Err(KeyProviderError::SecureAnchorUnavailable);
    assert_eq!(provider.prepare_root_anchor(&prepared), unavailable);
    assert_eq!(provider.commit_root_anchor("boot", 1), unavailable);
    assert_eq!(provider.abort_or_recover_root_anchor("boot"), unavailable);
}

#[test]
fn an_unsupported_anchor_is_never_mutated() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    let mut future = durable_anchor(&store);
    future.anchor_format_version = 2;
    let encoded = anchor_codec::encode(&durable_anchor(&store)).unwrap();
    let mut raw = encoded.clone();
    // Anchor format version is the u32 right after the 4-byte magic.
    raw[4..8].copy_from_slice(&future.anchor_format_version.to_be_bytes());
    store.put_raw(ANCHOR_ACCOUNT, &raw);

    assert_eq!(
        provider.prepare_root_anchor(&request_for_floor(0, "boot", &routes[0])),
        Err(KeyProviderError::UnsupportedAnchorFormat)
    );
    assert_eq!(anchor_bytes(&store), raw);
}

fn request_for_floor(floor: u64, operation_id: &str, route: &RootKeyRefV1) -> PrepareRootAnchor {
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: floor,
        target_root_generation: floor + 1,
        target_final_root_digest: [1; 32],
        target_slot: RootSlot::A,
        target_root_key_ref: route.clone(),
    }
}

#[test]
fn committing_a_root_whose_key_was_lost_after_prepare_is_refused() {
    let (store, routes) = provisioned(&[1]);
    let mut provider = provider(&store);
    provider
        .prepare_root_anchor(&request(&store, "boot", RootSlot::A, &routes[0]))
        .unwrap();
    let before = anchor_bytes(&store);

    store.delete(&key_account(&routes[0])).unwrap();
    assert_eq!(
        provider.commit_root_anchor("boot", 1),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(anchor_bytes(&store), before);
}

#[test]
fn an_unlocked_session_rebinds_to_the_root_it_commits_itself() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut provider = provider(&store);
    assert_eq!(provider.unlock(), Ok(KeyState::Unconfigured));

    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    assert_eq!(provider.state(), Ok(KeyState::Unlocked { epoch: 1 }));
    assert!(provider.resolve(1).is_ok());

    publish(
        &mut provider,
        &request(&store, "rotate", RootSlot::B, &routes[1]),
    );
    assert_eq!(provider.state(), Ok(KeyState::Unlocked { epoch: 2 }));
    assert!(provider.resolve(1).is_ok());
    assert!(provider.resolve_ref(&routes[1]).is_ok());
}

#[test]
fn a_root_committed_by_another_session_is_not_adopted_without_unlock() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut first = provider(&store);
    publish(
        &mut first,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    let mut session = provider(&store);
    assert_eq!(session.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));

    publish(
        &mut first,
        &request(&store, "rotate", RootSlot::B, &routes[1]),
    );
    assert_eq!(session.state(), Ok(KeyState::Locked));
    assert_eq!(session.resolve(1).err(), Some(KeyProviderError::Locked));
    assert_eq!(session.unlock(), Ok(KeyState::Unlocked { epoch: 2 }));
}

#[test]
fn a_key_provisioned_through_an_unlocked_provider_resolves_after_read_back() {
    let (store, _) = provisioned(&[1]);
    let mut provider = provider(&store);
    provider.unlock().unwrap();

    let route = provider.provision_epoch_key(2).unwrap();
    assert!(provider.resolve(2).is_ok());
    assert!(provider.resolve_ref(&route).is_ok());
}

#[test]
fn a_lost_prepared_key_does_not_block_reading_the_anchor() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut provider = provider(&store);
    publish(
        &mut provider,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    provider
        .prepare_root_anchor(&request(&store, "rotate", RootSlot::B, &routes[1]))
        .unwrap();
    store.delete(&key_account(&routes[1])).unwrap();

    let anchor_state = provider.read_root_anchor_state().unwrap();
    assert_eq!(anchor_state.committed_root.unwrap().root_key_ref, routes[0]);
    // The unfinishable preparation is recovered by abort, which never touches the committed root.
    provider.abort_or_recover_root_anchor("rotate").unwrap();
    assert!(durable_anchor(&store).prepared_root_commit.is_none());
}

#[test]
fn the_store_runtime_is_usable_as_a_key_provider_trait_object() {
    let (store, routes) = provisioned(&[1]);
    let mut concrete = provider(&store);
    let dynamic: &mut dyn KeyProvider = &mut concrete;

    dynamic
        .prepare_root_anchor(&request(&store, "boot", RootSlot::A, &routes[0]))
        .unwrap();
    dynamic.commit_root_anchor("boot", 1).unwrap();
    assert_eq!(dynamic.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    assert_eq!(dynamic.list_epochs().unwrap().len(), 1);
    dynamic.lock();
    assert_eq!(dynamic.state(), Ok(KeyState::Locked));
}

#[test]
fn another_writers_checkpoint_on_the_same_key_route_needs_a_new_unlock() {
    let (store, routes) = provisioned(&[1]);
    let mut writer = provider(&store);
    publish(
        &mut writer,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    let mut session = provider(&store);
    assert_eq!(session.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));

    // A new root generation in the other slot that keeps the active key route.
    publish(
        &mut writer,
        &request(&store, "checkpoint", RootSlot::B, &routes[0]),
    );
    assert_eq!(session.state(), Ok(KeyState::Locked));
    assert_eq!(session.resolve(1).err(), Some(KeyProviderError::Locked));
    assert_eq!(session.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    assert!(session.resolve(1).is_ok());
}

#[test]
fn an_epoch_key_another_writer_provisioned_is_not_adopted_without_unlock() {
    let (store, _) = provisioned(&[1]);
    let mut session = provider(&store);
    session.unlock().unwrap();
    let mut writer = provider(&store);
    let route = writer.provision_epoch_key(2).unwrap();

    assert_eq!(session.provision_epoch_key(2), Ok(route.clone()));
    assert_eq!(session.resolve(2).err(), Some(KeyProviderError::Locked));
    assert_eq!(
        session.resolve_ref(&route).err(),
        Some(KeyProviderError::Locked)
    );
    session.unlock().unwrap();
    assert!(session.resolve(2).is_ok());
}

#[test]
fn replaying_another_writers_commit_does_not_rebind_a_stale_session() {
    let (store, routes) = provisioned(&[1, 2]);
    let mut writer = provider(&store);
    publish(
        &mut writer,
        &request(&store, "boot", RootSlot::A, &routes[0]),
    );
    let mut session = provider(&store);
    assert_eq!(session.unlock(), Ok(KeyState::Unlocked { epoch: 1 }));
    publish(
        &mut writer,
        &request(&store, "rotate", RootSlot::B, &routes[1]),
    );

    // The exact replay succeeds durably, but the session never prepared "rotate".
    assert_eq!(session.commit_root_anchor("rotate", 2), Ok(()));
    assert_eq!(session.state(), Ok(KeyState::Locked));
    assert_eq!(session.resolve(1).err(), Some(KeyProviderError::Locked));
}

#[test]
fn retrying_the_sessions_own_ambiguous_commit_rebinds_it() {
    let (store, routes) = provisioned(&[1]);
    let mut session = provider(&store);
    session.unlock().unwrap();
    let prepared = request(&store, "boot", RootSlot::A, &routes[0]);
    session.prepare_root_anchor(&prepared).unwrap();

    // The commit landed through another handle before the session saw its outcome.
    let mut other = provider(&store);
    other.commit_root_anchor("boot", 1).unwrap();
    assert_eq!(session.commit_root_anchor("boot", 1), Ok(()));
    assert_eq!(session.state(), Ok(KeyState::Unlocked { epoch: 1 }));
}
