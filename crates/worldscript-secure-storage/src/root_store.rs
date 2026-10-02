//! Gate 3 slice 3C part 3b: the two-phase authority-root commit, its crash recovery and the
//! trusted cold start (§5.3, §5.3.1).
//!
//! The authority root lives in two places that cannot be written atomically together: the secure
//! anchor held by the [`KeyProvider`] (the rollback floor and `committed_root`, the sole publication
//! authority) and the filesystem (two generation-addressed root slots and a recoverable active-slot
//! pointer). [`commit_root`] runs §5.3.1's A–G sequence — prepare the anchor (C), write the target
//! slot directly in its `COMMITTED` form (D collapsed into E1, which §5.3.1 admits because the final
//! evidence is known in advance), move the pointer (E2), then commit the anchor (F) — and verifies
//! every durable step before the next. [`recover_root`] resolves an interrupted commit from the
//! crash table: it completes forward only when the target slot authenticates to exactly the
//! prepared `target_final_root_digest`, and otherwise discards the preparation, relocating (never
//! deleting) a non-matching target slot. [`load_committed_root`] is the trusted cold start: the
//! scope and key route come only from the secure anchor, never from the root's own header.
//!
//! Physical layout (a locator, never identity or AAD): `<root_dir>/slot-a/generation-<n>.wsr1`,
//! `<root_dir>/slot-b/generation-<n>.wsr1`, and `<root_dir>/pointer`; the platform adapter creates
//! the directories. Exclusive write admission and
//! `root_commit_mutex` (§11.1) are Gate 4; this module assumes one writer. Verifying the root's
//! key-epoch set (cold-start step 5) needs persisted key-epoch records and is slice 3C part 3c.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::commit::{relocate, CommitError};
use crate::durable::{
    generation_path, stage_and_promote, DirectoryDurability, DurableFs, StageFailure, StageRequest,
    WriteOperationId,
};
use crate::error::{KeyProviderError, SealError};
use crate::provider::{
    AnchorState, InstallationScopeId, KeyProvider, PrepareRootAnchor, PreparedRootCommit,
    RootKeyRefV1, RootSlot,
};
use crate::root::{root_digest, RootBody, RootCommitState, RootError};
use crate::root_record::{
    open_root_slot, root_identity, root_slot_plaintext, RootPointer, RootRecordError, RootSlotRead,
};

/// Where the root slots and the pointer live.
#[derive(Debug, Clone, Copy)]
pub struct RootLayout<'a> {
    pub root_dir: &'a Path,
}

impl RootLayout<'_> {
    fn slot_dir(&self, slot: RootSlot) -> PathBuf {
        self.root_dir.join(match slot {
            RootSlot::A => "slot-a",
            RootSlot::B => "slot-b",
        })
    }

    fn slot_file(&self, slot: RootSlot, root_generation: u64) -> PathBuf {
        generation_path(&self.slot_dir(slot), root_generation)
    }

    fn pointer_file(&self) -> PathBuf {
        self.root_dir.join("pointer")
    }
}

/// The durability step at which a root operation stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootStep {
    ReadSlot,
    SyncSlot,
    WritePointer,
    ReadPointer,
    RelocateSlot,
}

/// Why the committed root cannot be trusted. Ordinary reads and writes stop (§7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootRecoveryReason {
    /// The anchor's committed root names a slot file that does not exist.
    CommittedSlotMissing,
    /// The committed slot does not authenticate to exactly the anchor's committed root.
    CommittedSlotMismatch,
    /// The committed root's own key-route digest is not the anchor's route (§5.3.1 step 4).
    KeyRouteMismatch,
    /// The pointer already names a prepared target that does not authenticate: the filesystem
    /// moved to a root the secure anchor cannot prove it authorized (§5.3.1, after E2 before F).
    PointerNamesUnprovenTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RootStoreError {
    /// A read, write or sync failed for a reason other than absence; nothing was decided.
    Io {
        step: RootStep,
        kind: io::ErrorKind,
    },
    Anchor(KeyProviderError),
    Record(RootRecordError),
    Root(RootError),
    /// Writing the target slot failed (slice 3A's staging and promotion).
    SlotWrite(StageFailure),
    RecoveryRequired(RootRecoveryReason),
    /// A preparation is pending; [`recover_root`] must resolve it first.
    PreparationPending,
    /// The root's generation is not exactly the committed floor plus one.
    GenerationNotNext,
    /// The root's `root_key_ref_digest` is not the digest of the route it is committed under.
    KeyRouteMismatch,
    /// The root's evidence is not `COMMITTED` for this exact operation.
    EvidenceMismatch,
    /// The request's installation scope is not the secure anchor's (§5.3.2): a slot sealed under it
    /// could never be opened by cold start.
    ScopeMismatch,
    OperationId(SealError),
}

/// A root to commit: its body (evidence `COMMITTED`, naming this commit's operation) and the key
/// route the root is sealed and resolved under.
#[derive(Debug, Clone, Copy)]
pub struct RootCommitRequest<'a> {
    pub scope: &'a InstallationScopeId,
    pub root: &'a RootBody,
    pub root_key_ref: &'a RootKeyRefV1,
}

/// A root that completed step F: published as `committed_root`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootCommitted {
    pub root_generation: u64,
    pub root_slot: RootSlot,
    pub root_digest: [u8; 32],
    /// `Confirmed` only if both the slot and the pointer directory syncs were confirmed.
    pub directories: DirectoryDurability,
}

/// How [`recover_root`] resolved the anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootRecovery {
    /// No preparation was pending.
    NothingPending,
    /// The prepared root authenticated exactly; the pointer and anchor were completed forward.
    Completed { root_generation: u64 },
    /// The prepared root never became a complete candidate; the preparation was discarded and the
    /// prior committed root remains authority.
    Discarded,
}

/// The authenticated committed root (§5.3.1 cold-start steps 0–4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedRootView {
    pub root: RootBody,
    pub root_digest: [u8; 32],
    pub root_slot: RootSlot,
    /// Whether the pointer had to be repaired to name the committed root.
    pub pointer_repaired: bool,
}

/// Commits `request.root` as the next authority root (§5.3.1 A–G). Step F is the only
/// publication point; until it succeeds the prior committed root stays authority, and an
/// interrupted commit is resolved by [`recover_root`].
pub fn commit_root<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
    request: RootCommitRequest<'_>,
) -> Result<RootCommitted, RootStoreError> {
    let anchor = read_anchor(provider)?;
    if anchor.prepared_root_commit.is_some() {
        return Err(RootStoreError::PreparationPending);
    }
    if anchor.installation_scope_id.as_ref() != Some(request.scope) {
        return Err(RootStoreError::ScopeMismatch);
    }
    let prepare = preparation(&anchor, request)?;
    let operation = WriteOperationId::generate().map_err(RootStoreError::OperationId)?;
    provider
        .prepare_root_anchor(&prepare)
        .map_err(RootStoreError::Anchor)?;
    let commit = read_anchor(provider)?
        .prepared_root_commit
        .ok_or(RootStoreError::Anchor(KeyProviderError::RecoveryRequired))?;
    let target = Target {
        layout,
        scope: request.scope,
        commit: &commit,
    };
    let slot = write_slot(fs, provider, &target, request.root)?;
    let pointer_sync = write_pointer(fs, layout, &target.pointer(), &operation)?;
    provider
        .commit_root_anchor(&commit.operation_id, commit.target_root_generation)
        .map_err(RootStoreError::Anchor)?;
    Ok(RootCommitted {
        root_generation: commit.target_root_generation,
        root_slot: commit.target_slot,
        root_digest: commit.target_final_root_digest,
        directories: both(slot, pointer_sync),
    })
}

/// Startup resolution of an interrupted root commit (§5.3.1 crash table). It completes forward
/// only when the target slot authenticates to exactly the prepared final digest (re-syncing its
/// directory first). Otherwise, if the pointer already names the target, the filesystem moved to a
/// root the anchor cannot prove it authorized: `RECOVERY_REQUIRED`, nothing touched. Only when the
/// pointer still names the prior root is the preparation discarded, a non-matching target slot
/// relocated (never deleted) and the pointer repaired to the committed root. A read or sync failure
/// decides nothing.
pub fn recover_root<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    layout: RootLayout<'_>,
) -> Result<RootRecovery, RootStoreError> {
    let anchor = read_anchor(provider)?;
    let Some(commit) = anchor.prepared_root_commit.clone() else {
        return Ok(RootRecovery::NothingPending);
    };
    let scope = anchor
        .installation_scope_id
        .clone()
        .ok_or(RootStoreError::Anchor(KeyProviderError::RecoveryRequired))?;
    let target = Target {
        layout,
        scope: &scope,
        commit: &commit,
    };
    let state = target_state(fs, provider, &target)?;
    if state == TargetState::Matches {
        fs.sync_dir(&target.slot_dir())
            .map_err(|error| io_error(RootStep::SyncSlot, &error))?;
        ensure_pointer(fs, layout, &target.pointer())?;
        provider
            .commit_root_anchor(&commit.operation_id, commit.target_root_generation)
            .map_err(RootStoreError::Anchor)?;
        return Ok(RootRecovery::Completed {
            root_generation: commit.target_root_generation,
        });
    }
    if read_pointer(fs, layout)? == Some(target.pointer()) {
        return Err(recovery(RootRecoveryReason::PointerNamesUnprovenTarget));
    }
    if state == TargetState::Mismatch {
        relocate(
            fs,
            &target.slot_dir(),
            &target.slot_file(),
            &commit.operation_id,
        )
        .map_err(|error| RootStoreError::Io {
            step: RootStep::RelocateSlot,
            kind: commit_io_kind(&error),
        })?;
    }
    provider
        .abort_or_recover_root_anchor(&commit.operation_id)
        .map_err(RootStoreError::Anchor)?;
    if let Some(committed) = anchor.committed_root {
        let prior = RootPointer {
            slot: committed.root_slot,
            root_generation: committed.root_generation,
            root_digest: committed.root_digest,
        };
        ensure_pointer(fs, layout, &prior)?;
    }
    Ok(RootRecovery::Discarded)
}

/// The trusted cold start (§5.3.1 steps 0–4): the scope, slot, generation, digest and key route
/// come only from the secure anchor; the slot must authenticate to exactly the committed digest,
/// carry `COMMITTED` evidence and bind the committed route. A pointer that does not name the
/// committed root is repaired to it — it is recoverable state, never authority. `None` before the
/// first root commit.
pub fn load_committed_root<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    layout: RootLayout<'_>,
) -> Result<Option<CommittedRootView>, RootStoreError> {
    let anchor = read_anchor(provider)?;
    if anchor.prepared_root_commit.is_some() {
        return Err(RootStoreError::PreparationPending);
    }
    let (Some(committed), Some(scope)) = (anchor.committed_root, anchor.installation_scope_id)
    else {
        return Ok(None);
    };
    let path = layout.slot_file(committed.root_slot, committed.root_generation);
    let envelope = match fs.read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(recovery(RootRecoveryReason::CommittedSlotMissing))
        }
        Err(error) => return Err(io_error(RootStep::ReadSlot, &error)),
    };
    let key = provider
        .resolve_ref(&committed.root_key_ref)
        .map_err(RootStoreError::Anchor)?;
    let read = RootSlotRead {
        scope: &scope,
        root_generation: committed.root_generation,
        envelope: &envelope,
    };
    let (root, digest) = open_root_slot(&key, &read)
        .map_err(|_| recovery(RootRecoveryReason::CommittedSlotMismatch))?;
    let committed_evidence = root.commit_evidence.state == RootCommitState::Committed;
    if digest != committed.root_digest || !committed_evidence {
        return Err(recovery(RootRecoveryReason::CommittedSlotMismatch));
    }
    if root.root_key_ref_digest != committed.root_key_ref.digest() {
        return Err(recovery(RootRecoveryReason::KeyRouteMismatch));
    }
    let pointer = RootPointer {
        slot: committed.root_slot,
        root_generation: committed.root_generation,
        root_digest: digest,
    };
    let pointer_repaired = ensure_pointer(fs, layout, &pointer)?;
    Ok(Some(CommittedRootView {
        root,
        root_digest: digest,
        root_slot: committed.root_slot,
        pointer_repaired,
    }))
}

fn read_anchor<P: KeyProvider>(provider: &P) -> Result<AnchorState, RootStoreError> {
    provider
        .read_root_anchor_state()
        .map_err(RootStoreError::Anchor)
}

/// Step B: the prepared target for `request`, after every check that can be made before any
/// durable write.
fn preparation(
    anchor: &AnchorState,
    request: RootCommitRequest<'_>,
) -> Result<PrepareRootAnchor, RootStoreError> {
    let root = request.root;
    if Some(root.root_generation) != anchor.committed_floor.checked_add(1) {
        return Err(RootStoreError::GenerationNotNext);
    }
    if root.root_key_ref_digest != request.root_key_ref.digest() {
        return Err(RootStoreError::KeyRouteMismatch);
    }
    if root.commit_evidence.state != RootCommitState::Committed {
        return Err(RootStoreError::EvidenceMismatch);
    }
    let target_slot = anchor
        .committed_root
        .as_ref()
        .map_or(RootSlot::A, |committed| committed.root_slot.other());
    Ok(PrepareRootAnchor {
        operation_id: root.commit_evidence.operation_id.clone(),
        expected_floor: anchor.committed_floor,
        target_root_generation: root.root_generation,
        target_final_root_digest: root_digest(root).map_err(RootStoreError::Root)?,
        target_slot,
        target_root_key_ref: request.root_key_ref.clone(),
    })
}

/// A prepared root commit's filesystem target: where its slot lives and which scope it is sealed in.
struct Target<'a> {
    layout: RootLayout<'a>,
    scope: &'a InstallationScopeId,
    commit: &'a PreparedRootCommit,
}

impl Target<'_> {
    fn slot_dir(&self) -> PathBuf {
        self.layout.slot_dir(self.commit.target_slot)
    }

    fn slot_file(&self) -> PathBuf {
        self.layout
            .slot_file(self.commit.target_slot, self.commit.target_root_generation)
    }

    fn pointer(&self) -> RootPointer {
        RootPointer {
            slot: self.commit.target_slot,
            root_generation: self.commit.target_root_generation,
            root_digest: self.commit.target_final_root_digest,
        }
    }
}

/// What the filesystem holds at a prepared target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetState {
    Absent,
    /// Authenticates to exactly the prepared final digest with `COMMITTED` evidence.
    Matches,
    /// Present but not that root.
    Mismatch,
}

/// Steps D+E1: seals and promotes the target slot in its `COMMITTED` form, then re-authenticates
/// it to exactly the prepared final digest before the pointer may move. A mismatch is left in
/// place for [`recover_root`] to decide.
fn write_slot<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    target: &Target<'_>,
    root: &RootBody,
) -> Result<DirectoryDurability, RootStoreError> {
    let operation = WriteOperationId::generate().map_err(RootStoreError::OperationId)?;
    let key = provider
        .resolve_ref(&target.commit.target_root_key_ref)
        .map_err(RootStoreError::Anchor)?;
    let (meta, payload) = root_slot_plaintext(root).map_err(RootStoreError::Record)?;
    let identity = root_identity(target.scope).map_err(RootStoreError::Record)?;
    let stage = StageRequest {
        dir: &target.slot_dir(),
        identity: &identity,
        meta,
        operation: &operation,
        retain_staging: false,
    };
    let promoted =
        stage_and_promote(fs, &key, &stage, &payload).map_err(RootStoreError::SlotWrite)?;
    if target_state(fs, provider, target)? == TargetState::Matches {
        Ok(promoted.directory)
    } else {
        Err(RootStoreError::Record(RootRecordError::Corrupt(
            "the written root slot does not authenticate to the prepared digest",
        )))
    }
}

/// Reads the prepared target slot and classifies it; a read failure other than absence decides
/// nothing.
fn target_state<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    target: &Target<'_>,
) -> Result<TargetState, RootStoreError> {
    let envelope = match fs.read(&target.slot_file()) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(TargetState::Absent),
        Err(error) => return Err(io_error(RootStep::ReadSlot, &error)),
    };
    let key = provider
        .resolve_ref(&target.commit.target_root_key_ref)
        .map_err(RootStoreError::Anchor)?;
    let read = RootSlotRead {
        scope: target.scope,
        root_generation: target.commit.target_root_generation,
        envelope: &envelope,
    };
    let matches = open_root_slot(&key, &read).is_ok_and(|(root, digest)| {
        digest == target.commit.target_final_root_digest
            && root.commit_evidence.state == RootCommitState::Committed
    });
    Ok(if matches {
        TargetState::Matches
    } else {
        TargetState::Mismatch
    })
}

/// The pointer as the filesystem holds it; a malformed pointer is `None` (recoverable state).
fn read_pointer<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
) -> Result<Option<RootPointer>, RootStoreError> {
    match fs.read(&layout.pointer_file()) {
        Ok(bytes) => Ok(RootPointer::decode(&bytes).ok()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(RootStep::ReadPointer, &error)),
    }
}

fn commit_io_kind(error: &CommitError) -> io::ErrorKind {
    match error {
        CommitError::Io { kind, .. } => *kind,
        _ => io::ErrorKind::Other,
    }
}

/// Makes the pointer name `pointer`, writing it only if it does not already; returns whether it
/// had to be written.
fn ensure_pointer<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
    pointer: &RootPointer,
) -> Result<bool, RootStoreError> {
    if read_pointer(fs, layout)?.as_ref() == Some(pointer) {
        return Ok(false);
    }
    let operation = WriteOperationId::generate().map_err(RootStoreError::OperationId)?;
    write_pointer(fs, layout, pointer, &operation)?;
    Ok(true)
}

/// Step E2: writes the pointer to a sibling temporary, syncs it, atomically renames it over the
/// pointer and syncs the directory, then reads it back.
fn write_pointer<F: DurableFs>(
    fs: &mut F,
    layout: RootLayout<'_>,
    pointer: &RootPointer,
    operation: &WriteOperationId,
) -> Result<DirectoryDurability, RootStoreError> {
    let bytes = pointer.encode().map_err(RootStoreError::Record)?;
    let target = layout.pointer_file();
    let staging = layout
        .root_dir
        .join(format!("pointer.tmp-{}", operation.as_str()));
    let fail = |error: io::Error| io_error(RootStep::WritePointer, &error);
    let written = {
        let mut file = fs.create_new(&staging).map_err(fail)?;
        file.write_all(&bytes)
            .and_then(|()| fs.sync_file(&mut file))
            .map_err(fail)
    };
    // The temporary holds only the pointer; drop it if it never replaced the pointer.
    if let Err(error) = written.and_then(|()| fs.rename_replace(&staging, &target).map_err(fail)) {
        let _ = fs.remove_file(&staging);
        return Err(error);
    }
    let durability = fs.sync_dir(layout.root_dir).map_err(fail)?;
    let read_back = fs
        .read(&target)
        .map_err(|error| io_error(RootStep::ReadPointer, &error))?;
    if read_back == bytes {
        Ok(durability)
    } else {
        Err(RootStoreError::Record(RootRecordError::Corrupt(
            "the written pointer does not read back",
        )))
    }
}

fn both(first: DirectoryDurability, second: DirectoryDurability) -> DirectoryDurability {
    if first == DirectoryDurability::Confirmed && second == DirectoryDurability::Confirmed {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    }
}

fn recovery(reason: RootRecoveryReason) -> RootStoreError {
    RootStoreError::RecoveryRequired(reason)
}

fn io_error(step: RootStep, error: &io::Error) -> RootStoreError {
    RootStoreError::Io {
        step,
        kind: error.kind(),
    }
}
