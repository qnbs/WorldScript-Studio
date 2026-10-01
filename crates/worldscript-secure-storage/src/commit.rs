//! Gate 3 slice 3B part 2: the commit write protocol and startup reconciliation for one record
//! (§8.4, §9 steps 2–8 and 11, §9.2).
//!
//! Every marker generation is a sealed `record-commit` record promoted into the record's marker
//! directory by slice 3A's [`stage_and_promote`], so markers are immutable and
//! generation-addressed (§5.4). The marker chain `1..=n` must be complete, every generation must
//! open as exactly the generation its file name says, and each one must be a legal transition from
//! the one before it; anything else fails closed as `RECOVERY_REQUIRED` instead of falling back to
//! an older marker. Before the chain is trusted, its directory is synced, so a marker left visible
//! by a failed directory sync is either made durable or not used at all.
//!
//! A write verifies the committed generation it replaces, records `PENDING(old -> new)`, stages and
//! promotes the new generation while keeping its staging name — the only name tied to the
//! operation (§9 step 3) — then records `ACTIVE(new)` bound to its `content_digest` and only then
//! drops the staging name. Startup resolves a `PENDING` marker only from that provenance: the
//! staging file under the marker's own operation suffix must authenticate as exactly the pending
//! target; it is then adopted (or promoted first), and any other bytes under the generation name
//! are relocated, never deleted. Without it, the write rolls back.
//!
//! Not yet a durable commit: without slice 3C's authority root, which checkpoints the marker set
//! and advances the rollback floor (§5.3.1, §9 steps 9–10), deleting the newest marker files is not
//! detectable, so no outcome here is `DURABLE_COMMIT_SUCCESS`. A rolled-back first write
//! (`PENDING(none -> 1)`) leaves its pending marker as the newest generation, because version 1 has
//! no marker body for `ABSENT`; it resolves to no authority, and the root restores `ABSENT` in 3C.
//! Exclusive write admission (one writer per record, Gate 4) is assumed, not enforced, here.

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::catalog::{CatalogDescriptor, CatalogError};
use crate::durable::{
    generation_path, stage_and_promote, staging_path, DirectoryDurability, DurableFs, StageFailure,
    StageRequest, WriteOperationId,
};
use crate::error::SealError;
use crate::identity::RecordIdentity;
use crate::marker::{
    content_digest, CommitMarker, MarkerBody, MarkerError, MarkerOperation, PendingBody,
    MARKER_RECORD_SCHEMA,
};
use crate::record::{open_record, OpenedRecord};
use crate::seal::{Key, RecordMeta};

/// Where one record's generations and its marker generations live: physical locators, never part
/// of any identity or AAD (§6.1.1).
#[derive(Debug, Clone, Copy)]
pub struct RecordLocation<'a> {
    pub record_dir: &'a Path,
    pub marker_dir: &'a Path,
}

/// One record under one key: the record identity, its locations and the key its envelopes and
/// markers are sealed with.
#[derive(Clone, Copy)]
pub struct RecordStore<'a> {
    pub key: &'a Key,
    pub record: &'a RecordIdentity,
    pub location: RecordLocation<'a>,
}

/// A committed generation as its marker states it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommittedGeneration {
    pub generation: u64,
    pub epoch: u64,
    pub content_digest: [u8; 32],
}

/// The record's authority as its marker chain states it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Authority {
    /// No generation has ever been committed.
    Absent,
    Active(CommittedGeneration),
    /// A write is in flight; `serving` (the old generation, if any) stays authoritative (§8.4).
    Pending {
        pending: PendingBody,
        serving: Option<CommittedGeneration>,
    },
}

/// Why the record needs recovery. Ordinary reads and writes stop; nothing is guessed (§7).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryReason {
    /// Marker generation `missing` is absent although a later one exists.
    MarkerChainGap { missing: u64 },
    /// A marker file does not open as this record's marker of the generation its name states.
    MarkerUnreadable {
        marker_generation: u64,
        error: MarkerError,
    },
    /// A marker generation is not a legal transition from the one before it.
    IllegalTransition { marker_generation: u64 },
    /// A `RECOVERY_REQUIRED` marker was recorded for this record.
    MarkerRecoveryRequired,
    /// The marker directory holds a `generation-…` name that is neither a canonical marker file,
    /// staging file nor rejected relocation (for example a renamed marker): never ignored, since
    /// ignoring it could make an older marker look newest.
    UnexpectedMarkerEntry,
    /// The committed generation's file is missing.
    CommittedGenerationMissing,
    /// The committed generation's file is not the envelope the marker committed.
    CommittedGenerationMismatch,
}

/// The durability step at which a commit stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitStep {
    SyncMarkers,
    ListMarkers,
    ListRecord,
    ReadMarker,
    ReadCandidate,
    PromoteCandidate,
    SyncRecord,
    RelocateRejected,
    ReadCommitted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitError {
    /// A read, sync or filesystem step failed for a reason other than absence. Nothing was
    /// decided, so a pending write is neither completed nor rolled back; retry later.
    Io {
        step: CommitStep,
        kind: io::ErrorKind,
    },
    RecoveryRequired(RecoveryReason),
    /// No fresh operation identity was available (§6.3: never a weaker source).
    OperationId(SealError),
    /// The next generation or marker generation would be `u64::MAX` (§5.4: never a wrap).
    GenerationExhausted,
    Marker(MarkerError),
    /// Writing a marker generation failed; see `failure.promoted` for whether it exists.
    MarkerWrite(StageFailure),
    /// Staging or promoting the new generation failed after `PENDING` was recorded. The old
    /// generation stays authoritative; startup reconciliation completes or rolls back the write.
    RecordWrite(StageFailure),
    /// The verified chain could not be described as a catalog descriptor (§5.5).
    Catalog(CatalogError),
}

/// The non-secret fields a write commits to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteRequest {
    pub key_epoch: u64,
    pub record_schema: u32,
}

/// A write whose `ACTIVE` marker is recorded. Not `DURABLE_COMMIT_SUCCESS`: that needs slice 3C's
/// authority-root checkpoint (§9 step 10). `directories` is `Confirmed` only if every directory
/// sync of this write (the record directory and both marker promotions) was confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MarkerCommitted {
    pub generation: u64,
    pub marker_generation: u64,
    pub directories: DirectoryDurability,
}

/// How startup resolved the newest marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    /// The newest marker was not `PENDING`; nothing to resolve.
    Unchanged,
    /// The pending candidate was authenticated and `ACTIVE(target)` recorded.
    Completed { generation: u64 },
    /// The pending candidate was missing or invalid; rejected bytes were relocated and, for a
    /// replacement, `ACTIVE(old)` re-recorded.
    RolledBack { restored: Option<u64> },
}

/// One leftover file found by reconciliation and what was done with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Debris {
    pub path: PathBuf,
    pub kind: DebrisKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DebrisKind {
    /// A staging file byte-identical to its promoted generation; removed, since the generation
    /// keeps every byte.
    RedundantStagingRemoved,
    /// A staging file that is not provably redundant; preserved for recovery (§9 step 11).
    OrphanStaging,
    /// Bytes a rollback relocated; preserved for recovery.
    Rejected,
    /// A name this protocol never writes; never touched.
    Unrecognized,
}

/// The result of startup reconciliation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reconciled {
    pub authority: Authority,
    pub resolution: Resolution,
    pub debris: Vec<Debris>,
    /// Durability of the marker this reconciliation wrote, if it wrote one (`NotConfirmed` where
    /// the platform cannot confirm a directory sync, so the caller can report
    /// `COMMITTED_NOT_CONFIRMED_DURABLE`).
    pub marker_durability: Option<DirectoryDurability>,
}

/// Reads and verifies the complete marker chain of the record.
pub fn load_authority<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
) -> Result<Authority, CommitError> {
    load_chain(fs, store).map(|chain| chain.authority)
}

/// Startup reconciliation (§9 step 11, §9.2): resolves a pending write from authenticated evidence
/// only, then classifies leftover files, removing only staging bytes that a generation provably
/// keeps. Markers written here are sealed under `key_epoch`.
pub fn reconcile<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
    key_epoch: u64,
) -> Result<Reconciled, CommitError> {
    let chain = load_chain(fs, store)?;
    let ctx = Context { store, key_epoch };
    let resolved = match chain.authority {
        Authority::Pending { pending, serving } => {
            let open = OpenWrite {
                next_marker: chain.next_marker,
                pending,
                serving,
            };
            resolve_pending(fs, &ctx, open)?
        }
        settled => Resolved {
            authority: settled,
            resolution: Resolution::Unchanged,
            marker_durability: None,
        },
    };
    let debris = classify_debris(fs, store.location, &resolved.authority)?;
    Ok(Reconciled {
        authority: resolved.authority,
        resolution: resolved.resolution,
        debris,
        marker_durability: resolved.marker_durability,
    })
}

/// Writes `plaintext` as the next generation of the record (§9 steps 2–8 plus the `ACTIVE`
/// marker). A pending write left by a crash is reconciled first, and the committed generation being
/// replaced must still be exactly what its marker committed, so a write never builds on an
/// authority a read would refuse.
pub fn commit_write<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
    request: WriteRequest,
    plaintext: &[u8],
) -> Result<MarkerCommitted, CommitError> {
    reconcile(fs, store, request.key_epoch)?;
    let chain = load_chain(fs, store)?;
    let old = serving(&chain.authority);
    if let Some(committed) = old {
        verify_committed(fs, store, committed)?;
    }
    let target = match old {
        None => 1,
        Some(committed) => next_counter(committed.generation)?,
    };
    // Every counter is allocated before anything is written.
    let pending_marker = chain.next_marker;
    let active_marker = next_counter(pending_marker)?;
    let operation = WriteOperationId::generate().map_err(CommitError::OperationId)?;
    let ctx = Context {
        store,
        key_epoch: request.key_epoch,
    };
    let pending = PendingBody {
        operation: MarkerOperation {
            operation_id: operation.as_str().to_owned(),
            fencing_generation: 0,
        },
        old_generation: old.map(|committed| committed.generation),
        target_generation: target,
        target_epoch: request.key_epoch,
        content_digest: None,
        record_schema: request.record_schema,
    };
    let first = write_marker(fs, &ctx, pending_marker, MarkerBody::Pending(pending))?;
    let stage = StageRequest {
        dir: store.location.record_dir,
        identity: store.record,
        meta: RecordMeta {
            key_epoch: request.key_epoch,
            record_generation: target,
            record_schema: request.record_schema,
        },
        operation: &operation,
        retain_staging: true,
    };
    let promoted =
        stage_and_promote(fs, store.key, &stage, plaintext).map_err(CommitError::RecordWrite)?;
    let committed = CommittedGeneration {
        generation: target,
        epoch: request.key_epoch,
        content_digest: promoted.content_digest,
    };
    let last = write_marker(fs, &ctx, active_marker, active_body(committed))?;
    // The candidate is committed; its staging name is now redundant (reconciliation removes it
    // if this fails).
    let _ = fs.remove_file(&staging_path(store.location.record_dir, target, &operation));
    Ok(MarkerCommitted {
        generation: target,
        marker_generation: active_marker,
        directories: combined([first, promoted.directory, last]),
    })
}

/// Reads the committed generation: the `ACTIVE` one, or the old one while a write is pending. The
/// file must be exactly the envelope the marker committed and must open under the record.
pub fn read_committed<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
) -> Result<Option<OpenedRecord>, CommitError> {
    match serving(&load_authority(fs, store)?) {
        None => Ok(None),
        Some(committed) => verify_committed(fs, store, committed).map(Some),
    }
}

/// The record's catalog descriptor (§5.5), derived only from its verified marker chain — the newest
/// marker and the generation a read serves — so a descriptor never states an authority the chain
/// does not. `None` when the record has no marker yet.
pub fn describe_record<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
) -> Result<Option<CatalogDescriptor>, CommitError> {
    let chain = load_chain(fs, store)?;
    let Some(latest) = chain.latest else {
        return Ok(None);
    };
    CatalogDescriptor::new(store.record, &latest, serving(&chain.authority))
        .map(Some)
        .map_err(CommitError::Catalog)
}

/// The generation the authority serves: the active one, or the old one while a write is pending.
fn serving(authority: &Authority) -> Option<CommittedGeneration> {
    match authority {
        Authority::Absent => None,
        Authority::Active(committed) => Some(*committed),
        Authority::Pending { serving, .. } => *serving,
    }
}

/// The committed generation's file, proven to be exactly the envelope its marker committed.
fn verify_committed<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
    committed: CommittedGeneration,
) -> Result<OpenedRecord, CommitError> {
    let path = generation_path(store.location.record_dir, committed.generation);
    let bytes = match fs.read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(recovery(RecoveryReason::CommittedGenerationMissing))
        }
        Err(error) => return Err(io_error(CommitStep::ReadCommitted, &error)),
    };
    let mismatch = || recovery(RecoveryReason::CommittedGenerationMismatch);
    if content_digest(&bytes) != committed.content_digest {
        return Err(mismatch());
    }
    let opened = open_record(store.key, store.record, &bytes).map_err(|_| mismatch())?;
    let header = opened.header;
    if header.record_generation == committed.generation && header.key_epoch == committed.epoch {
        Ok(opened)
    } else {
        Err(mismatch())
    }
}

/// The fields every marker write and candidate check needs.
struct Context<'a> {
    store: RecordStore<'a>,
    key_epoch: u64,
}

/// The verified marker chain: the authority it states, its newest marker and the next marker
/// generation.
struct Chain {
    authority: Authority,
    latest: Option<CommitMarker>,
    next_marker: u64,
}

/// What startup resolution decided and the durability of the marker it wrote, if any.
struct Resolved {
    authority: Authority,
    resolution: Resolution,
    marker_durability: Option<DirectoryDurability>,
}

/// A pending write to resolve and the marker generation its resolution would take.
struct OpenWrite {
    next_marker: u64,
    pending: PendingBody,
    serving: Option<CommittedGeneration>,
}

fn load_chain<F: DurableFs>(fs: &mut F, store: RecordStore<'_>) -> Result<Chain, CommitError> {
    let dir = store.location.marker_dir;
    // A marker promoted before a failed directory sync is visible but not yet durable: make it
    // durable now, or decide nothing.
    fs.sync_dir(dir)
        .map_err(|error| io_error(CommitStep::SyncMarkers, &error))?;
    let names = fs
        .list_dir(dir)
        .map_err(|error| io_error(CommitStep::ListMarkers, &error))?;
    if names.iter().any(is_unexpected_marker_entry) {
        return Err(recovery(RecoveryReason::UnexpectedMarkerEntry));
    }
    let mut generations: Vec<u64> = names.iter().filter_map(parse_generation_name).collect();
    generations.sort_unstable();
    if let Some(missing) = first_gap(&generations) {
        return Err(recovery(RecoveryReason::MarkerChainGap { missing }));
    }
    let mut authority = Authority::Absent;
    let mut latest = None;
    for &marker_generation in &generations {
        let marker = open_marker(fs, store, marker_generation)?;
        if matches!(marker.body(), MarkerBody::RecoveryRequired { .. }) {
            return Err(recovery(RecoveryReason::MarkerRecoveryRequired));
        }
        authority = transition(authority, marker.body().clone()).ok_or(recovery(
            RecoveryReason::IllegalTransition { marker_generation },
        ))?;
        latest = Some(marker);
    }
    let next_marker = match generations.last() {
        None => 1,
        Some(&last) => next_counter(last)?,
    };
    Ok(Chain {
        authority,
        latest,
        next_marker,
    })
}

/// The first generation missing from the sorted, distinct `generations`, which must be `1..=n`.
fn first_gap(generations: &[u64]) -> Option<u64> {
    generations
        .iter()
        .zip(1u64..)
        .find(|(&generation, expected)| generation != *expected)
        .map(|(_, expected)| expected)
}

/// Opens the marker file of `marker_generation`; its content must be that very generation, so a
/// valid marker copied into another chain slot is refused.
fn open_marker<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
    marker_generation: u64,
) -> Result<CommitMarker, CommitError> {
    let unreadable = |error| {
        recovery(RecoveryReason::MarkerUnreadable {
            marker_generation,
            error,
        })
    };
    let bytes = fs
        .read(&generation_path(
            store.location.marker_dir,
            marker_generation,
        ))
        .map_err(|error| io_error(CommitStep::ReadMarker, &error))?;
    let marker = CommitMarker::open(store.key, store.record, &bytes).map_err(unreadable)?;
    if marker.marker_generation() == marker_generation {
        Ok(marker)
    } else {
        Err(unreadable(MarkerError::GenerationMismatch))
    }
}

/// The authority after `body`, or `None` if `body` cannot follow `authority` (§8.4's machine:
/// `ABSENT -> PENDING(none -> 1) -> ACTIVE(1)`, `ACTIVE(old) -> PENDING(old -> new) -> ACTIVE(new)`,
/// a rollback re-recording `ACTIVE(old)`, and a new first-write attempt after a rolled-back one).
fn transition(authority: Authority, body: MarkerBody) -> Option<Authority> {
    match body {
        MarkerBody::Pending(pending) => after_pending(authority, pending),
        MarkerBody::Active {
            committed_generation,
            committed_epoch,
            content_digest,
        } => after_active(
            authority,
            CommittedGeneration {
                generation: committed_generation,
                epoch: committed_epoch,
                content_digest,
            },
        ),
        MarkerBody::RecoveryRequired { .. } => None,
    }
}

fn after_pending(authority: Authority, pending: PendingBody) -> Option<Authority> {
    let serving = match authority {
        Authority::Absent => None,
        Authority::Active(committed) => Some(committed),
        // A rolled-back first write stays the newest marker (no ABSENT body exists); a new
        // first-write attempt follows it.
        Authority::Pending { serving: None, .. } => None,
        Authority::Pending { .. } => return None,
    };
    let from_serving = pending.old_generation == serving.map(|committed| committed.generation);
    from_serving.then_some(Authority::Pending { pending, serving })
}

fn after_active(authority: Authority, committed: CommittedGeneration) -> Option<Authority> {
    let Authority::Pending { pending, serving } = authority else {
        return None;
    };
    let completes = committed.generation == pending.target_generation
        && committed.epoch == pending.target_epoch;
    let restores = serving == Some(committed);
    (completes || restores).then_some(Authority::Active(committed))
}

/// Resolves `PENDING(old -> target)` from authenticated evidence (§9.2's post-promotion rows).
fn resolve_pending<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    open: OpenWrite,
) -> Result<Resolved, CommitError> {
    let OpenWrite {
        next_marker,
        pending,
        serving,
    } = open;
    if let Some(content_digest) = adopt_candidate(fs, ctx, &pending)? {
        let committed = CommittedGeneration {
            generation: pending.target_generation,
            epoch: pending.target_epoch,
            content_digest,
        };
        let durability = write_marker(fs, ctx, next_marker, active_body(committed))?;
        drop_staging(fs, ctx, &pending);
        return Ok(Resolved {
            authority: Authority::Active(committed),
            resolution: Resolution::Completed {
                generation: committed.generation,
            },
            marker_durability: Some(durability),
        });
    }
    let Some(committed) = serving else {
        return Ok(Resolved {
            authority: Authority::Pending {
                pending,
                serving: None,
            },
            resolution: Resolution::RolledBack { restored: None },
            marker_durability: None,
        });
    };
    // Re-record ACTIVE(old) only if the old generation is still exactly what it committed.
    verify_committed(fs, ctx.store, committed)?;
    let durability = write_marker(fs, ctx, next_marker, active_body(committed))?;
    Ok(Resolved {
        authority: Authority::Active(committed),
        resolution: Resolution::RolledBack {
            restored: Some(committed.generation),
        },
        marker_durability: Some(durability),
    })
}

/// Drops a committed candidate's staging name; reconciliation removes it later if this fails.
fn drop_staging<F: DurableFs>(fs: &mut F, ctx: &Context<'_>, pending: &PendingBody) {
    if let Some(operation) = WriteOperationId::parse(&pending.operation.operation_id) {
        let dir = ctx.store.location.record_dir;
        let _ = fs.remove_file(&staging_path(dir, pending.target_generation, &operation));
    }
}

fn active_body(committed: CommittedGeneration) -> MarkerBody {
    MarkerBody::Active {
        committed_generation: committed.generation,
        committed_epoch: committed.epoch,
        content_digest: committed.content_digest,
    }
}

/// The pending write's candidate, if its provenance holds: the staging file under the marker's own
/// operation suffix (§9 step 3) must authenticate as exactly the pending target. The promoted
/// generation is adopted only if it holds those same bytes; other bytes under the generation name
/// are relocated and the staging file is promoted. Without a valid staging file nothing is adopted,
/// whatever the generation name holds. The record directory is synced before the candidate is
/// reported, so `ACTIVE` never precedes a durable generation entry. A read that fails for any
/// reason other than absence decides nothing.
fn adopt_candidate<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    pending: &PendingBody,
) -> Result<Option<[u8; 32]>, CommitError> {
    let dir = ctx.store.location.record_dir;
    let target = generation_path(dir, pending.target_generation);
    let suffix = &pending.operation.operation_id;
    let staged = read_staging(fs, dir, pending)?;
    let promoted = read_if_present(fs, &target)?;
    let Some((staging, bytes)) = staged.filter(|(_, bytes)| candidate_matches(ctx, pending, bytes))
    else {
        reject_unproven(fs, dir, pending, promoted.is_some())?;
        return Ok(None);
    };
    if promoted.as_deref() != Some(bytes.as_slice()) {
        if promoted.is_some() {
            relocate(fs, dir, &target, suffix)?;
        }
        promote_staged(fs, &staging, &target, &bytes)?;
    }
    fs.sync_dir(dir)
        .map_err(|error| io_error(CommitStep::SyncRecord, &error))?;
    Ok(Some(content_digest(&bytes)))
}

/// The staging file under the marker's own operation/target suffix, if any. A non-canonical
/// operation ID names no staging file this protocol could have written.
fn read_staging<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    pending: &PendingBody,
) -> Result<Option<(PathBuf, Vec<u8>)>, CommitError> {
    let Some(operation) = WriteOperationId::parse(&pending.operation.operation_id) else {
        return Ok(None);
    };
    let staging = staging_path(dir, pending.target_generation, &operation);
    Ok(read_if_present(fs, &staging)?.map(|bytes| (staging, bytes)))
}

/// Without a valid staging file nothing is adopted: an invalid staging file and whatever holds the
/// target generation's name are relocated, never deleted.
fn reject_unproven<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    pending: &PendingBody,
    target_present: bool,
) -> Result<(), CommitError> {
    let suffix = &pending.operation.operation_id;
    if let Some(operation) = WriteOperationId::parse(suffix) {
        let staging = staging_path(dir, pending.target_generation, &operation);
        if read_if_present(fs, &staging)?.is_some() {
            relocate(fs, dir, &staging, suffix)?;
        }
    }
    if target_present {
        relocate(
            fs,
            dir,
            &generation_path(dir, pending.target_generation),
            suffix,
        )?;
    }
    Ok(())
}

/// Whether `bytes` authenticate as exactly the pending target: this record, the target generation,
/// epoch and schema.
fn candidate_matches(ctx: &Context<'_>, pending: &PendingBody, bytes: &[u8]) -> bool {
    let Ok(opened) = open_record(ctx.store.key, ctx.store.record, bytes) else {
        return false;
    };
    let header = opened.header;
    header.record_generation == pending.target_generation
        && header.key_epoch == pending.target_epoch
        && header.record_schema == pending.record_schema
}

/// Promotes a validated staging file left by a crash (§9.2 "after file sync, before promotion")
/// and proves the generation holds exactly its bytes. The staging name stays until `ACTIVE` is
/// recorded.
fn promote_staged<F: DurableFs>(
    fs: &mut F,
    staging: &Path,
    target: &Path,
    bytes: &[u8],
) -> Result<(), CommitError> {
    let promote = |error: io::Error| io_error(CommitStep::PromoteCandidate, &error);
    fs.link_no_replace(staging, target).map_err(promote)?;
    if fs.read(target).map_err(promote)? == bytes {
        Ok(())
    } else {
        Err(recovery(RecoveryReason::CommittedGenerationMismatch))
    }
}

/// Moves rejected bytes to `<name>.rejected-<tag>` without ever losing them: the new name is linked
/// and made durable before the old one is removed. `tag` is a digest of the marker's operation ID,
/// so marker text never shapes a path.
fn relocate<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    path: &Path,
    operation: &str,
) -> Result<(), CommitError> {
    let fail = |error: io::Error| io_error(CommitStep::RelocateRejected, &error);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rejected = dir.join(format!(
        "{name}{REJECTED_INFIX}{}",
        relocation_tag(operation)
    ));
    match fs.link_no_replace(path, &rejected) {
        Ok(()) => {}
        // A previous run linked it but stopped before removing the original.
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            if fs.read(&rejected).map_err(fail)? != fs.read(path).map_err(fail)? {
                return Err(fail(error));
            }
        }
        Err(error) => return Err(fail(error)),
    }
    fs.sync_dir(dir).map_err(fail)?;
    fs.remove_file(path).map_err(fail)?;
    fs.sync_dir(dir).map_err(fail)?;
    Ok(())
}

const REJECTED_INFIX: &str = ".rejected-";

/// 32 lowercase hex characters of SHA-256 over the operation ID: filename-safe for any marker text.
fn relocation_tag(operation: &str) -> String {
    Sha256::digest(operation.as_bytes())[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Seals `body` as marker generation `marker_generation` and promotes it (slice 3A).
fn write_marker<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    marker_generation: u64,
    body: MarkerBody,
) -> Result<DirectoryDurability, CommitError> {
    let marker = CommitMarker::new(ctx.store.record, marker_generation, body)
        .map_err(CommitError::Marker)?;
    let operation = WriteOperationId::generate().map_err(CommitError::OperationId)?;
    let request = StageRequest {
        dir: ctx.store.location.marker_dir,
        identity: marker.identity(),
        meta: RecordMeta {
            key_epoch: ctx.key_epoch,
            record_generation: marker_generation,
            record_schema: MARKER_RECORD_SCHEMA,
        },
        operation: &operation,
        retain_staging: false,
    };
    stage_and_promote(fs, ctx.store.key, &request, &marker.encode())
        .map(|promoted| promoted.directory)
        .map_err(CommitError::MarkerWrite)
}

/// Classifies every file in both directories that is not a generation file. Only a staging file
/// byte-identical to its promoted generation is removed; the pending candidate is left alone.
fn classify_debris<F: DurableFs>(
    fs: &mut F,
    location: RecordLocation<'_>,
    authority: &Authority,
) -> Result<Vec<Debris>, CommitError> {
    let pending = match authority {
        Authority::Pending { pending, .. } => Some(pending),
        _ => None,
    };
    let mut debris = Vec::new();
    let dirs = [
        (location.record_dir, pending, CommitStep::ListRecord),
        (location.marker_dir, None, CommitStep::ListMarkers),
    ];
    for (dir, candidate, step) in dirs {
        let names = fs.list_dir(dir).map_err(|error| io_error(step, &error))?;
        for name in names {
            if let Some(entry) = classify_entry(fs, dir, &name, candidate) {
                debris.push(entry);
            }
        }
    }
    debris.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(debris)
}

fn classify_entry<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    name: &OsString,
    pending: Option<&PendingBody>,
) -> Option<Debris> {
    if parse_generation_name(name).is_some() {
        return None;
    }
    let path = dir.join(name);
    let kind = match name.to_str().map(parse_staging_name) {
        Some(Some((generation, operation))) => {
            let is_candidate = pending.is_some_and(|pending| {
                pending.target_generation == generation
                    && pending.operation.operation_id == operation.as_str()
            });
            if is_candidate {
                return None;
            }
            staging_disposition(fs, dir, &path, generation)
        }
        Some(None) if is_rejected_name(name) => DebrisKind::Rejected,
        _ => DebrisKind::Unrecognized,
    };
    Some(Debris { path, kind })
}

/// Removes a staging file only when its promoted generation holds exactly its bytes.
fn staging_disposition<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    staging: &Path,
    generation: u64,
) -> DebrisKind {
    let same = match (fs.read(staging), fs.read(&generation_path(dir, generation))) {
        (Ok(staged), Ok(promoted)) => staged == promoted,
        _ => false,
    };
    if same && fs.remove_file(staging).is_ok() {
        DebrisKind::RedundantStagingRemoved
    } else {
        DebrisKind::OrphanStaging
    }
}

/// A `generation-…` name that this protocol never writes into a marker directory.
fn is_unexpected_marker_entry(name: &OsString) -> bool {
    let Some(text) = name.to_str() else {
        return false;
    };
    text.starts_with("generation-")
        && parse_generation_name(name).is_none()
        && parse_staging_name(text).is_none()
        && !is_rejected_name(name)
}

fn is_rejected_name(name: &OsString) -> bool {
    name.to_str()
        .is_some_and(|name| name.starts_with("generation-") && name.contains(REJECTED_INFIX))
}

/// `generation-<n>.wsr1` with canonical decimal `n >= 1`.
fn parse_generation_name(name: &OsString) -> Option<u64> {
    let digits = name
        .to_str()?
        .strip_prefix("generation-")?
        .strip_suffix(".wsr1")?;
    parse_counter(digits)
}

/// `generation-<n>.wsr1.tmp-<operation>-<n>` with a canonical operation ID and matching `n`.
fn parse_staging_name(name: &str) -> Option<(u64, WriteOperationId)> {
    let rest = name.strip_prefix("generation-")?;
    let (digits, rest) = rest.split_once(".wsr1.tmp-")?;
    let generation = parse_counter(digits)?;
    let (operation, tail) = rest.split_once('-')?;
    let operation = WriteOperationId::parse(operation)?;
    (tail == digits).then_some((generation, operation))
}

fn parse_counter(digits: &str) -> Option<u64> {
    let canonical = !digits.is_empty()
        && digits.bytes().all(|b| b.is_ascii_digit())
        && !digits.starts_with('0');
    canonical.then(|| digits.parse().ok()).flatten()
}

/// `value + 1`, refusing `u64::MAX` (§5.4's lifecycle rule).
fn next_counter(value: u64) -> Result<u64, CommitError> {
    match value.checked_add(1) {
        Some(next) if next < u64::MAX => Ok(next),
        _ => Err(CommitError::GenerationExhausted),
    }
}

fn read_if_present<F: DurableFs>(fs: &mut F, path: &Path) -> Result<Option<Vec<u8>>, CommitError> {
    match fs.read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(CommitStep::ReadCandidate, &error)),
    }
}

/// Combined durability of several directory syncs: confirmed only if every one was.
fn combined(directories: [DirectoryDurability; 3]) -> DirectoryDurability {
    if directories.contains(&DirectoryDurability::NotConfirmed) {
        DirectoryDurability::NotConfirmed
    } else {
        DirectoryDurability::Confirmed
    }
}

fn recovery(reason: RecoveryReason) -> CommitError {
    CommitError::RecoveryRequired(reason)
}

fn io_error(step: CommitStep, error: &io::Error) -> CommitError {
    CommitError::Io {
        step,
        kind: error.kind(),
    }
}
