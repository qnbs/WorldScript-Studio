//! Gate 1b-core: the §5.3.1 two-phase secure-anchor state machine — transitions, replay evidence,
//! slot alternation, anchor validation, and injected persistence faults.

use worldscript_secure_storage::anchor;
use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    AnchorState, KeyProvider, KeyProviderError, PrepareRootAnchor, RootKeyRefV1, RootSlot,
};

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

// ---- Two-phase anchor commit ---------------------------------------------------------------

#[test]
fn prepare_records_intent_without_raising_the_floor() {
    let (mut provider, route) = provisioned();
    provider
        .prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &route))
        .unwrap();
    let state = provider.read_root_anchor_state().unwrap();
    assert_eq!(state.committed_floor, 0);
    assert!(state.committed_root.is_none());
    assert_eq!(state.prepared_root_commit.unwrap().preparation_revision, 1);
}

#[test]
fn re_preparing_the_same_operation_bumps_the_revision() {
    let (mut provider, route) = provisioned();
    let req = request(&provider, "op-1", RootSlot::A, &route);
    provider.prepare_root_anchor(&req).unwrap();
    provider.prepare_root_anchor(&req).unwrap();
    let revision = provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .unwrap()
        .preparation_revision;
    assert_eq!(revision, 2);
}

#[test]
fn commit_publishes_exactly_the_prepared_root() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    let state = provider.read_root_anchor_state().unwrap();
    assert_eq!(state.committed_floor, 1);
    assert_eq!(state.last_committed_operation_id.as_deref(), Some("op-1"));
    let root = state.committed_root.unwrap();
    assert_eq!(
        (root.root_generation, root.root_digest, root.root_slot),
        (1, [9; 32], RootSlot::A)
    );
    assert_eq!(root.root_key_ref, route);
    assert!(state.prepared_root_commit.is_none());
}

#[test]
fn replaying_the_exact_committed_operation_is_idempotent() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    let before = provider.read_root_anchor_state().unwrap();
    provider.commit_root_anchor("op-1", 1).unwrap();
    assert_eq!(provider.read_root_anchor_state().unwrap(), before);
}

#[test]
fn another_operation_naming_the_current_generation_is_refused() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    assert!(is_conflict(provider.commit_root_anchor("op-2", 1)));
    assert!(is_conflict(provider.commit_root_anchor("op-1", 2)));
    assert!(is_conflict(provider.commit_root_anchor("op-1", 0)));
}

#[test]
fn a_later_commit_replaces_the_replay_evidence() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    commit_root(&mut provider, "op-2", RootSlot::B, &route);
    assert!(
        is_conflict(provider.commit_root_anchor("op-1", 1)),
        "stale replay"
    );
    provider.commit_root_anchor("op-2", 2).unwrap();
}

#[test]
fn new_roots_must_target_the_other_slot() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    assert!(is_conflict(provider.prepare_root_anchor(&request(
        &provider,
        "op-2",
        RootSlot::A,
        &route
    ))));
    commit_root(&mut provider, "op-2", RootSlot::B, &route);
    assert!(is_conflict(provider.prepare_root_anchor(&request(
        &provider,
        "op-3",
        RootSlot::B,
        &route
    ))));
    commit_root(&mut provider, "op-3", RootSlot::A, &route);
    assert_eq!(
        provider.read_root_anchor_state().unwrap().committed_floor,
        3
    );
}

#[test]
fn the_bootstrap_root_may_use_either_slot() {
    for slot in [RootSlot::A, RootSlot::B] {
        let (mut provider, route) = provisioned();
        commit_root(&mut provider, "boot", slot, &route);
        assert_eq!(
            provider
                .read_root_anchor_state()
                .unwrap()
                .committed_root
                .unwrap()
                .root_slot,
            slot
        );
    }
}

#[test]
fn preparations_must_name_an_issued_resolvable_route() {
    let (mut provider, _) = provisioned();
    let fabricated = RootKeyRefV1::new(b"route-001".to_vec()).unwrap();
    assert_eq!(
        provider.prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &fabricated)),
        Err(KeyProviderError::UnknownKeyRef)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_none());
}

#[test]
fn a_stale_floor_or_skipped_generation_is_refused() {
    let (mut provider, route) = provisioned();
    let mut stale = request(&provider, "op-1", RootSlot::A, &route);
    stale.expected_floor = 5;
    assert!(is_conflict(provider.prepare_root_anchor(&stale)));
    let mut skipping = request(&provider, "op-1", RootSlot::A, &route);
    skipping.target_root_generation = 3;
    assert!(is_conflict(provider.prepare_root_anchor(&skipping)));
}

#[test]
fn a_pending_preparation_excludes_other_operations() {
    let (mut provider, route) = provisioned();
    provider
        .prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &route))
        .unwrap();
    assert!(is_conflict(provider.prepare_root_anchor(&request(
        &provider,
        "op-2",
        RootSlot::A,
        &route
    ))));
    assert!(is_conflict(provider.commit_root_anchor("op-2", 1)));
    assert!(is_conflict(provider.abort_or_recover_root_anchor("op-2")));
}

#[test]
fn abort_clears_only_its_own_preparation_and_never_raises_the_floor() {
    let (mut provider, route) = provisioned();
    provider
        .prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &route))
        .unwrap();
    provider.abort_or_recover_root_anchor("op-1").unwrap();
    let state = provider.read_root_anchor_state().unwrap();
    assert!(state.prepared_root_commit.is_none());
    assert_eq!(state.committed_floor, 0);
    provider.abort_or_recover_root_anchor("op-1").unwrap();
}

#[test]
fn malformed_operation_ids_are_refused() {
    let (mut provider, _) = provisioned();
    for bad in [String::new(), "x".repeat(129)] {
        assert_eq!(
            provider.abort_or_recover_root_anchor(&bad),
            Err(KeyProviderError::MalformedOperationId)
        );
    }
}

// ---- Anchor validation ---------------------------------------------------------------------

fn committed_anchor() -> AnchorState {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    provider.read_root_anchor_state().unwrap()
}

#[test]
fn unsupported_anchor_formats_are_never_read_or_mutated() {
    let mut future = committed_anchor();
    future.anchor_format_version = 2;
    let mut scope_v2 = committed_anchor();
    scope_v2.scope_format_version = 2;
    for state in [future, scope_v2] {
        assert_eq!(
            anchor::validate(&state),
            Err(KeyProviderError::UnsupportedAnchorFormat)
        );
        assert_eq!(
            anchor::commit(&state, "op-1", 1).map(|_| ()),
            Err(KeyProviderError::UnsupportedAnchorFormat)
        );
        assert_eq!(
            anchor::provision_installation_scope(&state, [0; 16]).map(|_| ()),
            Err(KeyProviderError::UnsupportedAnchorFormat)
        );
    }
}

#[test]
fn inconsistent_committed_state_requires_recovery() {
    let valid = committed_anchor();
    let mut cases = Vec::new();
    let mut floor = valid.clone();
    floor.committed_floor = 4;
    cases.push(floor);
    let mut no_evidence = valid.clone();
    no_evidence.last_committed_operation_id = None;
    cases.push(no_evidence);
    let mut no_scope = valid.clone();
    no_scope.installation_scope_id = None;
    cases.push(no_scope);
    let mut terminal = valid.clone();
    terminal.committed_floor = u64::MAX;
    terminal.committed_root.as_mut().unwrap().root_generation = u64::MAX;
    cases.push(terminal);
    let mut orphan_evidence = AnchorState::empty();
    orphan_evidence.last_committed_operation_id = Some("op".into());
    cases.push(orphan_evidence);
    for state in cases {
        assert_eq!(
            anchor::validate(&state),
            Err(KeyProviderError::RecoveryRequired),
            "{state:?}"
        );
    }
}

#[test]
fn inconsistent_preparations_require_recovery() {
    let (mut provider, route) = provisioned();
    commit_root(&mut provider, "op-1", RootSlot::A, &route);
    provider
        .prepare_root_anchor(&request(&provider, "op-2", RootSlot::B, &route))
        .unwrap();
    let valid = provider.read_root_anchor_state().unwrap();
    let mutations: [fn(&mut AnchorState); 4] = [
        |s| {
            s.prepared_root_commit
                .as_mut()
                .unwrap()
                .preparation_revision = 0
        },
        |s| {
            s.prepared_root_commit
                .as_mut()
                .unwrap()
                .expected_prior_floor = 0
        },
        |s| {
            s.prepared_root_commit
                .as_mut()
                .unwrap()
                .target_root_generation = 5
        },
        |s| s.prepared_root_commit.as_mut().unwrap().target_slot = RootSlot::A,
    ];
    for mutate in mutations {
        let mut state = valid.clone();
        mutate(&mut state);
        assert_eq!(
            anchor::validate(&state),
            Err(KeyProviderError::RecoveryRequired)
        );
    }
}

#[test]
fn the_terminal_floor_can_never_be_advanced() {
    let mut at_limit = committed_anchor();
    at_limit.committed_floor = u64::MAX - 1;
    at_limit.committed_root.as_mut().unwrap().root_generation = u64::MAX - 1;
    let root = at_limit.committed_root.clone().unwrap();
    let next = PrepareRootAnchor {
        operation_id: "op-last".into(),
        expected_floor: u64::MAX - 1,
        target_root_generation: u64::MAX,
        target_final_root_digest: [0; 32],
        target_slot: root.root_slot.other(),
        target_root_key_ref: root.root_key_ref,
    };
    assert_eq!(
        anchor::prepare(&at_limit, &next),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn authority_without_a_scope_is_never_given_a_new_one() {
    let mut orphaned = committed_anchor();
    orphaned.installation_scope_id = None;
    assert_eq!(
        anchor::provision_installation_scope(&orphaned, [2; 16]).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

// ---- Fault injection -----------------------------------------------------------------------

#[test]
fn a_rejected_prepare_leaves_the_anchor_unchanged() {
    let (mut provider, route) = provisioned();
    provider.inject(Fault::BeforePersist(AnchorOp::Prepare));
    let req = request(&provider, "op-1", RootSlot::A, &route);
    assert_eq!(
        provider.prepare_root_anchor(&req),
        Err(KeyProviderError::Unavailable)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_none());
}

#[test]
fn an_ambiguous_commit_is_reconciled_by_re_reading_and_exact_replay() {
    let (mut provider, route) = provisioned();
    provider
        .prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &route))
        .unwrap();
    provider.inject(Fault::AfterPersist(AnchorOp::Commit));
    assert_eq!(
        provider.commit_root_anchor("op-1", 1),
        Err(KeyProviderError::Unavailable)
    );
    assert_eq!(
        provider.read_root_anchor_state().unwrap().committed_floor,
        1
    );
    provider.commit_root_anchor("op-1", 1).unwrap();
}

#[test]
fn a_rejected_abort_keeps_the_preparation_for_retry() {
    let (mut provider, route) = provisioned();
    provider
        .prepare_root_anchor(&request(&provider, "op-1", RootSlot::A, &route))
        .unwrap();
    provider.inject(Fault::BeforePersist(AnchorOp::Abort));
    assert_eq!(
        provider.abort_or_recover_root_anchor("op-1"),
        Err(KeyProviderError::Unavailable)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_some());
    provider.abort_or_recover_root_anchor("op-1").unwrap();
}
