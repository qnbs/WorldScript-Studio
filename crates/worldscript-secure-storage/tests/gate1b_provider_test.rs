//! Gate 1b-core: the `KeyProvider` contract — authority state, key provisioning and routing,
//! lock/loss/availability, and installation-scope provisioning — through the in-memory provider.

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    seal_with_random, InstallationScopeId, KeyProvider, KeyProviderError, KeyState,
    PrepareRootAnchor, RandomSource, RandomnessUnavailable, RecordClass, RecordContext, RecordMeta,
    RootKeyRefV1, RootSlot, SealTarget,
};

struct Zeros;
impl RandomSource for Zeros {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        buf.fill(0);
        Ok(())
    }
}

fn is_conflict<T: std::fmt::Debug>(result: Result<T, KeyProviderError>) -> bool {
    matches!(result, Err(KeyProviderError::AnchorConflict(_)))
}

/// A provider with a scope and one provisioned epoch-1 key route.
fn provisioned() -> (MemoryKeyProvider, RootKeyRefV1) {
    let mut provider = MemoryKeyProvider::new();
    provider.read_or_provision_installation_scope().unwrap();
    let route = provider.provision_epoch_key(1).unwrap();
    (provider, route)
}

fn request(
    provider: &MemoryKeyProvider,
    operation_id: &str,
    slot: RootSlot,
    route: &RootKeyRefV1,
) -> PrepareRootAnchor {
    let floor = provider.read_root_anchor_state().unwrap().committed_floor;
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: floor,
        target_root_generation: floor + 1,
        target_final_root_digest: [9; 32],
        target_slot: slot,
        target_root_key_ref: route.clone(),
    }
}

fn commit_root(
    provider: &mut MemoryKeyProvider,
    operation_id: &str,
    slot: RootSlot,
    route: &RootKeyRefV1,
) {
    let req = request(provider, operation_id, slot, route);
    provider.prepare_root_anchor(&req).unwrap();
    provider
        .commit_root_anchor(operation_id, req.target_root_generation)
        .unwrap();
}

// ---- Key state and routing -----------------------------------------------------------------

#[test]
fn authority_stays_unconfigured_until_the_first_root_commits() {
    let mut provider = MemoryKeyProvider::new();
    assert_eq!(provider.state().unwrap(), KeyState::Unconfigured);
    provider.read_or_provision_installation_scope().unwrap();
    assert_eq!(
        provider.state().unwrap(),
        KeyState::Unconfigured,
        "scope only"
    );
    let route = provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    assert_eq!(
        provider.state().unwrap(),
        KeyState::Unconfigured,
        "bootstrap key only"
    );
    provider
        .prepare_root_anchor(&request(&provider, "boot", RootSlot::A, &route))
        .unwrap();
    assert_eq!(
        provider.state().unwrap(),
        KeyState::Unconfigured,
        "prepared, not committed"
    );
    // The bootstrap key is still usable to build the candidate root before F.
    assert!(provider.resolve_ref(&route).is_ok());

    provider.commit_root_anchor("boot", 1).unwrap();
    assert_eq!(provider.state().unwrap(), KeyState::Unlocked { epoch: 1 });
    provider.lock();
    assert_eq!(provider.state().unwrap(), KeyState::Locked);
}

#[test]
fn provisioned_keys_are_random_and_lock_clears_runtime_handles() {
    let (mut provider, first) = provisioned();
    let second = provider.provision_epoch_key(2).unwrap();
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
    provider.unlock().unwrap();
    assert_eq!(provider.runtime_key_count(), 2);

    let target = SealTarget {
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
    };
    let a = seal_with_random(
        &provider.resolve_ref(&first).unwrap(),
        &mut Zeros,
        &target,
        b"x",
    )
    .unwrap();
    let b = seal_with_random(&provider.resolve(2).unwrap(), &mut Zeros, &target, b"x").unwrap();
    assert_ne!(a, b, "same nonce and input under two keys must differ");

    provider.lock();
    assert_eq!(provider.runtime_key_count(), 0);
    assert_eq!(
        provider.resolve_ref(&second).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
}

#[test]
fn routing_resolves_exact_issued_references_only() {
    let (mut provider, _) = provisioned();
    provider.unlock().unwrap();
    let fabricated = RootKeyRefV1::new(b"route-001".to_vec()).unwrap();
    assert_eq!(
        provider.resolve_ref(&fabricated).map(|_| ()),
        Err(KeyProviderError::UnknownKeyRef)
    );
    assert_eq!(
        provider.resolve(9).map(|_| ()),
        Err(KeyProviderError::UnknownEpoch)
    );
    assert_eq!(provider.list_epochs().unwrap().len(), 1);
}

#[test]
fn epochs_are_provisioned_once_and_never_as_sentinels() {
    let (mut provider, route) = provisioned();
    for epoch in [0, u64::MAX] {
        assert!(
            is_conflict(provider.provision_epoch_key(epoch)),
            "epoch {epoch}"
        );
    }
    // Resumable: provisioning epoch 1 again returns its existing route.
    assert_eq!(provider.provision_epoch_key(1), Ok(route));
}

#[test]
fn lost_keys_fail_closed() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "boot", RootSlot::A, &route);
    provider.unlock().unwrap();
    provider.lose_keys();
    assert_eq!(provider.state().unwrap(), KeyState::KeyLost);
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(provider.unlock(), Err(KeyProviderError::KeyLost));
}

#[test]
fn state_reports_store_and_format_failures_as_errors_not_key_states() {
    let mut provider = MemoryKeyProvider::new();
    provider.set_available(false);
    assert_eq!(
        provider.state(),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
}

#[test]
fn a_missing_secure_store_fails_closed_everywhere() {
    let mut provider = MemoryKeyProvider::new();
    provider.set_available(false);
    let unavailable = Err(KeyProviderError::SecureAnchorUnavailable);
    assert_eq!(
        provider.read_or_provision_installation_scope().map(|_| ()),
        unavailable
    );
    assert_eq!(provider.read_root_anchor_state().map(|_| ()), unavailable);
    assert_eq!(provider.provision_epoch_key(1).map(|_| ()), unavailable);
}

// ---- Installation scope --------------------------------------------------------------------

#[test]
fn scope_provisioning_is_idempotent_and_canonical() {
    let mut provider = MemoryKeyProvider::new();
    let first = provider.read_or_provision_installation_scope().unwrap();
    assert_eq!(
        provider.read_or_provision_installation_scope().unwrap(),
        first
    );
    assert!(InstallationScopeId::parse(first.as_str()).is_ok());
}

#[test]
fn reading_an_existing_scope_needs_no_randomness() {
    let mut provider = MemoryKeyProvider::new();
    let scope = provider.read_or_provision_installation_scope().unwrap();
    provider.set_randomness_available(false);
    assert_eq!(provider.read_or_provision_installation_scope(), Ok(scope));
}

#[test]
fn a_new_scope_requires_a_working_csprng() {
    let mut provider = MemoryKeyProvider::new();
    provider.set_randomness_available(false);
    assert_eq!(
        provider.read_or_provision_installation_scope().map(|_| ()),
        Err(KeyProviderError::RandomnessUnavailable)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .installation_scope_id
        .is_none());
}

#[test]
fn a_scope_persisted_before_a_reported_failure_is_reused() {
    let mut provider = MemoryKeyProvider::new();
    provider.inject(Fault::AfterPersist(AnchorOp::Provision));
    assert_eq!(
        provider.read_or_provision_installation_scope().map(|_| ()),
        Err(KeyProviderError::Unavailable)
    );
    let persisted = provider
        .read_root_anchor_state()
        .unwrap()
        .installation_scope_id
        .unwrap();
    assert_eq!(
        provider.read_or_provision_installation_scope().unwrap(),
        persisted
    );
}

#[test]
fn a_store_that_lost_its_keys_is_never_re_provisioned() {
    let (mut provider, _) = provisioned();
    provider.lose_keys();
    assert_eq!(
        provider.provision_epoch_key(1).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(
        provider.provision_epoch_key(2).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
}
