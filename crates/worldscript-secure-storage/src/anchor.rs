//! Pure §5.3.1 secure-anchor transitions. Every platform adapter applies these functions to the
//! state it holds in its secure store and persists the result as one replacement, so the two-phase
//! rules are defined once, headless, instead of being re-derived per platform.

use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, CommittedRoot, InstallationScopeId, PrepareRootAnchor, PreparedRootCommit,
};

/// §6.1.2: `operation_id` is at most 128 UTF-8 bytes; it is also never empty.
pub const MAX_OPERATION_ID_LEN: usize = 128;

fn check_operation_id(operation_id: &str) -> Result<(), KeyProviderError> {
    if operation_id.is_empty() || operation_id.len() > MAX_OPERATION_ID_LEN {
        Err(KeyProviderError::MalformedOperationId)
    } else {
        Ok(())
    }
}

/// §5.3.2 `read_or_provision_installation_scope`: an existing scope is returned unchanged; a new one
/// is created from `random_bits` only while no root authority exists; a missing scope next to
/// existing authority is `RecoveryRequired`, never regenerated.
pub fn provision_installation_scope(
    state: &AnchorState,
    random_bits: [u8; 16],
) -> Result<(AnchorState, InstallationScopeId), KeyProviderError> {
    if let Some(scope) = &state.installation_scope_id {
        return Ok((state.clone(), scope.clone()));
    }
    if state.committed_root.is_some() || state.prepared_root_commit.is_some() {
        return Err(KeyProviderError::RecoveryRequired);
    }
    let scope = InstallationScopeId::from_random_bits(random_bits);
    let mut next = state.clone();
    next.installation_scope_id = Some(scope.clone());
    Ok((next, scope))
}

/// The floor every consistent anchor reports: the committed root's generation, or `0` before the
/// first root exists. A disagreement is corruption of the anchor itself.
fn verified_floor(state: &AnchorState) -> Result<u64, KeyProviderError> {
    let root_generation = state
        .committed_root
        .as_ref()
        .map_or(0, |root| root.root_generation);
    if root_generation == state.committed_floor {
        Ok(state.committed_floor)
    } else {
        Err(KeyProviderError::RecoveryRequired)
    }
}

/// Step C: records intent to advance to `committed_floor + 1` without raising the floor or the
/// committed root. Re-preparing the same operation with identical targets bumps
/// `preparation_revision`; any other operation must first be aborted/recovered.
pub fn prepare(
    state: &AnchorState,
    request: &PrepareRootAnchor,
) -> Result<AnchorState, KeyProviderError> {
    check_operation_id(&request.operation_id)?;
    if state.installation_scope_id.is_none() {
        return Err(KeyProviderError::RecoveryRequired);
    }
    let floor = verified_floor(state)?;
    if request.expected_floor != floor {
        return Err(KeyProviderError::AnchorConflict(
            "expected floor is not the committed floor",
        ));
    }
    let target = floor
        .checked_add(1)
        .filter(|next| *next != u64::MAX)
        .ok_or(KeyProviderError::RecoveryRequired)?;
    if request.target_root_generation != target {
        return Err(KeyProviderError::AnchorConflict(
            "target generation is not floor + 1",
        ));
    }
    let revision = match &state.prepared_root_commit {
        None => 1,
        Some(existing) if same_preparation(existing, request) => existing
            .preparation_revision
            .checked_add(1)
            .ok_or(KeyProviderError::RecoveryRequired)?,
        Some(_) => {
            return Err(KeyProviderError::AnchorConflict(
                "another preparation is pending",
            ));
        }
    };
    let mut next = state.clone();
    next.prepared_root_commit = Some(PreparedRootCommit {
        operation_id: request.operation_id.clone(),
        expected_prior_floor: floor,
        target_root_generation: target,
        target_final_root_digest: request.target_final_root_digest,
        target_slot: request.target_slot,
        target_root_key_ref: request.target_root_key_ref.clone(),
        preparation_revision: revision,
    });
    Ok(next)
}

fn same_preparation(existing: &PreparedRootCommit, request: &PrepareRootAnchor) -> bool {
    existing.operation_id == request.operation_id
        && existing.target_root_generation == request.target_root_generation
        && existing.target_final_root_digest == request.target_final_root_digest
        && existing.target_slot == request.target_slot
        && existing.target_root_key_ref == request.target_root_key_ref
}

/// Step F: only an exactly matching preparation raises `committed_floor` and replaces
/// `committed_root`. Replaying F after it already took effect is an idempotent success.
pub fn commit(
    state: &AnchorState,
    operation_id: &str,
    target_root_generation: u64,
) -> Result<AnchorState, KeyProviderError> {
    check_operation_id(operation_id)?;
    let floor = verified_floor(state)?;
    match &state.prepared_root_commit {
        Some(prepared)
            if prepared.operation_id == operation_id
                && prepared.target_root_generation == target_root_generation
                && prepared.expected_prior_floor == floor =>
        {
            let mut next = state.clone();
            next.committed_floor = prepared.target_root_generation;
            next.committed_root = Some(CommittedRoot {
                root_generation: prepared.target_root_generation,
                root_digest: prepared.target_final_root_digest,
                root_slot: prepared.target_slot,
                root_key_ref: prepared.target_root_key_ref.clone(),
            });
            next.prepared_root_commit = None;
            Ok(next)
        }
        None if floor == target_root_generation && floor != 0 => Ok(state.clone()),
        _ => Err(KeyProviderError::AnchorConflict(
            "no matching preparation to commit",
        )),
    }
}

/// Clears a discardable preparation for `operation_id`. It never raises `committed_floor` or
/// changes `committed_root`; with nothing prepared it is an idempotent success.
pub fn abort_or_recover(
    state: &AnchorState,
    operation_id: &str,
) -> Result<AnchorState, KeyProviderError> {
    check_operation_id(operation_id)?;
    match &state.prepared_root_commit {
        None => Ok(state.clone()),
        Some(prepared) if prepared.operation_id == operation_id => {
            let mut next = state.clone();
            next.prepared_root_commit = None;
            Ok(next)
        }
        Some(_) => Err(KeyProviderError::AnchorConflict(
            "the pending preparation belongs to another operation",
        )),
    }
}
