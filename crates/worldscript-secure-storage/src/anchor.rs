//! Pure §5.3.1 secure-anchor transitions. Every platform adapter applies these functions to the
//! state it holds in its secure store and persists the result as one replacement, so the two-phase
//! rules are defined once, headless, instead of being re-derived per platform.
//!
//! Every function first runs [`validate`]: an anchor that is not a well-formed version-1 state is
//! never read as authority or mutated.

use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, CommittedRoot, InstallationScopeId, PrepareRootAnchor, PreparedRootCommit,
    ANCHOR_FORMAT_VERSION, SCOPE_FORMAT_VERSION,
};

/// §6.1.2: `operation_id` is at most 128 UTF-8 bytes; it is also never empty.
pub const MAX_OPERATION_ID_LEN: usize = 128;

pub(crate) fn check_operation_id(operation_id: &str) -> Result<(), KeyProviderError> {
    if operation_id.is_empty() || operation_id.len() > MAX_OPERATION_ID_LEN {
        Err(KeyProviderError::MalformedOperationId)
    } else {
        Ok(())
    }
}

/// A committed generation is never the "unassigned" `0` or the terminal `u64::MAX` (§5.4).
fn is_assigned(generation: u64) -> bool {
    generation != 0 && generation != u64::MAX
}

fn require(condition: bool) -> Result<(), KeyProviderError> {
    if condition {
        Ok(())
    } else {
        Err(KeyProviderError::RecoveryRequired)
    }
}

fn validate_committed(state: &AnchorState) -> Result<(), KeyProviderError> {
    match (&state.committed_root, &state.last_committed_operation_id) {
        (None, None) => require(state.committed_floor == 0),
        (Some(root), Some(operation_id)) => {
            check_operation_id(operation_id).map_err(|_| KeyProviderError::RecoveryRequired)?;
            require(
                state.installation_scope_id.is_some()
                    && is_assigned(root.root_generation)
                    && root.root_generation == state.committed_floor,
            )
        }
        _ => Err(KeyProviderError::RecoveryRequired),
    }
}

fn validate_prepared(state: &AnchorState) -> Result<(), KeyProviderError> {
    let Some(prepared) = &state.prepared_root_commit else {
        return Ok(());
    };
    check_operation_id(&prepared.operation_id).map_err(|_| KeyProviderError::RecoveryRequired)?;
    let committed_slot = state.committed_root.as_ref().map(|root| root.root_slot);
    require(
        state.installation_scope_id.is_some()
            && prepared.preparation_revision != 0
            && prepared.expected_prior_floor == state.committed_floor
            && state.committed_floor.checked_add(1) == Some(prepared.target_root_generation)
            && is_assigned(prepared.target_root_generation)
            && committed_slot != Some(prepared.target_slot),
    )
}

/// Checks every version-1 invariant of §5.3.1/§5.3.2 in one place. A different anchor or scope
/// format is `UnsupportedAnchorFormat` (never mutated as if it were version 1); any other
/// inconsistency is `RecoveryRequired`.
pub fn validate(state: &AnchorState) -> Result<(), KeyProviderError> {
    if state.anchor_format_version != ANCHOR_FORMAT_VERSION
        || state.scope_format_version != SCOPE_FORMAT_VERSION
    {
        return Err(KeyProviderError::UnsupportedAnchorFormat);
    }
    validate_committed(state)?;
    validate_prepared(state)
}

/// Prepared intent is recovery authorization only. Validate both complete envelopes before
/// comparing the committed read-authority projection; malformed preparation is still refused.
pub(crate) fn same_read_authority(
    before: &AnchorState,
    after: &AnchorState,
) -> Result<bool, KeyProviderError> {
    validate(before)?;
    validate(after)?;
    Ok(before.installation_scope_id == after.installation_scope_id
        && before.committed_floor == after.committed_floor
        && before.committed_root == after.committed_root
        && before.last_committed_operation_id == after.last_committed_operation_id)
}

/// The existing scope of a valid anchor, without generating anything (§5.3.2 read path).
pub fn existing_installation_scope(
    state: &AnchorState,
) -> Result<Option<InstallationScopeId>, KeyProviderError> {
    validate(state)?;
    Ok(state.installation_scope_id.clone())
}

/// §5.3.2 first-time provisioning: only valid while the anchor has no scope and no root or prepared
/// authority. An existing scope is returned unchanged; a missing scope next to authority is
/// `RecoveryRequired` (caught by [`validate`]) and is never regenerated.
pub fn provision_installation_scope(
    state: &AnchorState,
    random_bits: [u8; 16],
) -> Result<(AnchorState, InstallationScopeId), KeyProviderError> {
    if let Some(scope) = existing_installation_scope(state)? {
        return Ok((state.clone(), scope));
    }
    let scope = InstallationScopeId::from_random_bits(random_bits);
    let mut next = state.clone();
    next.installation_scope_id = Some(scope.clone());
    Ok((next, scope))
}

fn conflict(reason: &'static str) -> KeyProviderError {
    KeyProviderError::AnchorConflict(reason)
}

/// Checks a new request against the committed state: exact floor, next generation, alternate slot.
fn check_request_target(
    state: &AnchorState,
    request: &PrepareRootAnchor,
) -> Result<(), KeyProviderError> {
    if request.expected_floor != state.committed_floor {
        return Err(conflict("expected floor is not the committed floor"));
    }
    let next = state
        .committed_floor
        .checked_add(1)
        .filter(|next| is_assigned(*next))
        .ok_or(KeyProviderError::RecoveryRequired)?;
    if request.target_root_generation != next {
        return Err(conflict("target generation is not floor + 1"));
    }
    let committed_slot = state.committed_root.as_ref().map(|root| root.root_slot);
    if committed_slot == Some(request.target_slot) {
        return Err(conflict("target slot is the committed root's slot"));
    }
    Ok(())
}

fn same_preparation(existing: &PreparedRootCommit, request: &PrepareRootAnchor) -> bool {
    existing.operation_id == request.operation_id
        && existing.target_root_generation == request.target_root_generation
        && existing.target_final_root_digest == request.target_final_root_digest
        && existing.target_slot == request.target_slot
        && existing.target_root_key_ref == request.target_root_key_ref
}

fn next_revision(
    state: &AnchorState,
    request: &PrepareRootAnchor,
) -> Result<u64, KeyProviderError> {
    match &state.prepared_root_commit {
        None => Ok(1),
        Some(existing) if same_preparation(existing, request) => existing
            .preparation_revision
            .checked_add(1)
            .ok_or(KeyProviderError::RecoveryRequired),
        Some(_) => Err(conflict("another preparation is pending")),
    }
}

/// Step C: records intent to advance to `committed_floor + 1` in the slot the committed root does
/// not occupy, without raising the floor or replacing the committed root. Re-preparing the same
/// operation with identical targets bumps `preparation_revision`; any other operation must first
/// be aborted or recovered.
pub fn prepare(
    state: &AnchorState,
    request: &PrepareRootAnchor,
) -> Result<AnchorState, KeyProviderError> {
    validate(state)?;
    check_operation_id(&request.operation_id)?;
    if state.installation_scope_id.is_none() {
        return Err(KeyProviderError::RecoveryRequired);
    }
    check_request_target(state, request)?;
    let revision = next_revision(state, request)?;
    let mut next = state.clone();
    next.prepared_root_commit = Some(PreparedRootCommit {
        operation_id: request.operation_id.clone(),
        expected_prior_floor: state.committed_floor,
        target_root_generation: request.target_root_generation,
        target_final_root_digest: request.target_final_root_digest,
        target_slot: request.target_slot,
        target_root_key_ref: request.target_root_key_ref.clone(),
        preparation_revision: revision,
    });
    Ok(next)
}

fn is_exact_replay(state: &AnchorState, operation_id: &str, target_root_generation: u64) -> bool {
    state.prepared_root_commit.is_none()
        && state.last_committed_operation_id.as_deref() == Some(operation_id)
        && state.committed_floor == target_root_generation
}

/// Step F: only the exactly matching preparation raises `committed_floor`, replaces
/// `committed_root`, and records its `operation_id` as `last_committed_operation_id`. Re-running F
/// for exactly that committed operation and generation is an idempotent success; any other
/// operation naming the current generation is refused.
pub fn commit(
    state: &AnchorState,
    operation_id: &str,
    target_root_generation: u64,
) -> Result<AnchorState, KeyProviderError> {
    validate(state)?;
    check_operation_id(operation_id)?;
    if is_exact_replay(state, operation_id, target_root_generation) {
        return Ok(state.clone());
    }
    let prepared = state
        .prepared_root_commit
        .as_ref()
        .filter(|p| p.operation_id == operation_id)
        .filter(|p| p.target_root_generation == target_root_generation)
        .ok_or(conflict("no matching preparation to commit"))?;
    let mut next = state.clone();
    next.committed_floor = prepared.target_root_generation;
    next.committed_root = Some(CommittedRoot {
        root_generation: prepared.target_root_generation,
        root_digest: prepared.target_final_root_digest,
        root_slot: prepared.target_slot,
        root_key_ref: prepared.target_root_key_ref.clone(),
    });
    next.last_committed_operation_id = Some(prepared.operation_id.clone());
    next.prepared_root_commit = None;
    Ok(next)
}

/// Clears a discardable preparation for `operation_id`. It never raises `committed_floor` or
/// changes `committed_root`; with nothing prepared it is an idempotent success.
pub fn abort_or_recover(
    state: &AnchorState,
    operation_id: &str,
) -> Result<AnchorState, KeyProviderError> {
    validate(state)?;
    check_operation_id(operation_id)?;
    match &state.prepared_root_commit {
        None => Ok(state.clone()),
        Some(prepared) if prepared.operation_id == operation_id => {
            let mut next = state.clone();
            next.prepared_root_commit = None;
            Ok(next)
        }
        Some(_) => Err(conflict(
            "the pending preparation belongs to another operation",
        )),
    }
}
