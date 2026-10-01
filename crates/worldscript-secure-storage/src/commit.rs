//! Gate 3 slice 3B part 2: the commit write protocol and startup reconciliation for one record
//! (§8.4, §9 steps 2–8 and 11, §9.2).
//!
//! Every marker generation is a sealed `record-commit` record promoted into the record's marker
//! directory by slice 3A's [`stage_and_promote`], so markers are immutable and
//! generation-addressed (§5.4). The marker chain `1..=n` must be complete, every generation must
//! open, and each one must be a legal transition from the one before it; anything else fails closed
//! as `RECOVERY_REQUIRED` instead of falling back to an older marker. A write records
//! `PENDING(old -> new)`, stages and promotes the new generation, then records `ACTIVE(new)` bound
//! to its `content_digest`. Startup resolves a `PENDING` marker only from authenticated evidence:
//! the exact candidate it names is adopted, a validated staging file under the marker's own
//! operation suffix is promoted first, and anything else rolls the write back with the rejected
//! bytes relocated (never deleted) so the generation name is free for the retry.
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
    /// A marker generation exists but does not open as this record's marker.
    MarkerUnreadable {
        marker_generation: u64,
        error: MarkerError,
    },
    /// A marker generation is not a legal transition from the one before it.
    IllegalTransition { marker_generation: u64 },
    /// A `RECOVERY_REQUIRED` marker was recorded for this record.
    MarkerRecoveryRequired,
    /// The committed generation's file is missing.
    CommittedGenerationMissing,
    /// The committed generation's file is not the envelope the marker committed.
    CommittedGenerationMismatch,
}

/// The durability step at which a commit stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitStep {
    ListMarkers,
    ReadMarker,
    ReadCandidate,
    PromoteCandidate,
    RelocateRejected,
    ReadCommitted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommitError {
    /// A read or filesystem step failed for a reason other than absence. Nothing was decided, so
    /// a pending write is neither completed nor rolled back; retry later.
    Io {
        step: CommitStep,
        kind: io::ErrorKind,
    },
    RecoveryRequired(RecoveryReason),
    /// No fresh operation identity was available (§6.3: never a weaker source).
    OperationId(SealError),
    /// The next generation would be `u64::MAX` (§5.4: `RECOVERY_REQUIRED`, never a wrap).
    GenerationExhausted,
    Marker(MarkerError),
    /// Writing a marker generation failed; see `failure.promoted` for whether it exists.
    MarkerWrite(StageFailure),
    /// Staging or promoting the new generation failed after `PENDING` was recorded. The old
    /// generation stays authoritative; startup reconciliation completes or rolls back the write.
    RecordWrite(StageFailure),
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
}

/// Reads and verifies the complete marker chain of `record`.
pub fn load_authority<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
) -> Result<Authority, CommitError> {
    load_chain(fs, key, record, location).map(|chain| chain.authority)
}

/// Startup reconciliation (§9 step 11, §9.2): resolves a pending write from authenticated evidence
/// only, then classifies leftover files, removing only staging bytes that a generation provably
/// keeps.
pub fn reconcile<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
    key_epoch: u64,
) -> Result<Reconciled, CommitError> {
    let chain = load_chain(fs, key, record, location)?;
    let ctx = Context {
        key,
        record,
        location,
        key_epoch,
    };
    let (authority, resolution) = match chain.authority {
        Authority::Pending { pending, serving } => {
            resolve_pending(fs, &ctx, chain.next_marker, pending, serving)?
        }
        settled => (settled, Resolution::Unchanged),
    };
    let debris = classify_debris(fs, location, &authority)?;
    Ok(Reconciled {
        authority,
        resolution,
        debris,
    })
}

/// Writes `plaintext` as the next generation of `record` (§9 steps 2–8 plus the `ACTIVE` marker):
/// a pending write left by a crash is reconciled first, so a write always starts from a settled
/// authority.
pub fn commit_write<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
    request: WriteRequest,
    plaintext: &[u8],
) -> Result<MarkerCommitted, CommitError> {
    reconcile(fs, key, record, location, request.key_epoch)?;
    let chain = load_chain(fs, key, record, location)?;
    let old = match chain.authority {
        Authority::Absent => None,
        Authority::Active(committed) => Some(committed.generation),
        Authority::Pending { serving, .. } => serving.map(|committed| committed.generation),
    };
    let target = match old {
        None => 1,
        Some(generation) => next_counter(generation)?,
    };
    let operation = WriteOperationId::generate().map_err(CommitError::OperationId)?;
    let ctx = Context {
        key,
        record,
        location,
        key_epoch: request.key_epoch,
    };
    let pending = PendingBody {
        operation: MarkerOperation {
            operation_id: operation.as_str().to_owned(),
            fencing_generation: 0,
        },
        old_generation: old,
        target_generation: target,
        target_epoch: request.key_epoch,
        content_digest: None,
        record_schema: request.record_schema,
    };
    let pending_marker = chain.next_marker;
    let first = write_marker(fs, &ctx, pending_marker, MarkerBody::Pending(pending))?;
    let meta = RecordMeta {
        key_epoch: request.key_epoch,
        record_generation: target,
        record_schema: request.record_schema,
    };
    let stage = StageRequest {
        dir: location.record_dir,
        identity: record,
        meta,
        operation: &operation,
    };
    let promoted =
        stage_and_promote(fs, key, &stage, plaintext).map_err(CommitError::RecordWrite)?;
    let active_marker = next_counter(pending_marker)?;
    let active = MarkerBody::Active {
        committed_generation: target,
        committed_epoch: request.key_epoch,
        content_digest: promoted.content_digest,
    };
    let last = write_marker(fs, &ctx, active_marker, active)?;
    Ok(MarkerCommitted {
        generation: target,
        marker_generation: active_marker,
        directories: combined([first, promoted.directory, last]),
    })
}

/// Reads the committed generation: the `ACTIVE` one, or the old one while a write is pending. The
/// file must be exactly the envelope the marker committed and must open under `record`.
pub fn read_committed<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
) -> Result<Option<OpenedRecord>, CommitError> {
    let committed = match load_authority(fs, key, record, location)? {
        Authority::Absent => return Ok(None),
        Authority::Active(committed) => committed,
        Authority::Pending { serving: None, .. } => return Ok(None),
        Authority::Pending {
            serving: Some(committed),
            ..
        } => committed,
    };
    let path = generation_path(location.record_dir, committed.generation);
    let bytes = match fs.read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(recovery(RecoveryReason::CommittedGenerationMissing))
        }
        Err(error) => return Err(io_error(CommitStep::ReadCommitted, &error)),
    };
    if content_digest(&bytes) != committed.content_digest {
        return Err(recovery(RecoveryReason::CommittedGenerationMismatch));
    }
    let opened = open_record(key, record, &bytes)
        .map_err(|_| recovery(RecoveryReason::CommittedGenerationMismatch))?;
    let header = opened.header;
    if header.record_generation == committed.generation && header.key_epoch == committed.epoch {
        Ok(Some(opened))
    } else {
        Err(recovery(RecoveryReason::CommittedGenerationMismatch))
    }
}

/// The fields every marker write and candidate check needs.
struct Context<'a> {
    key: &'a Key,
    record: &'a RecordIdentity,
    location: RecordLocation<'a>,
    key_epoch: u64,
}

/// The verified marker chain: the authority it states and the next marker generation.
struct Chain {
    authority: Authority,
    next_marker: u64,
}

fn load_chain<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
) -> Result<Chain, CommitError> {
    let names = fs
        .list_dir(location.marker_dir)
        .map_err(|error| io_error(CommitStep::ListMarkers, &error))?;
    let mut generations: Vec<u64> = names.iter().filter_map(parse_generation_name).collect();
    generations.sort_unstable();
    if let Some(missing) = first_gap(&generations) {
        return Err(recovery(RecoveryReason::MarkerChainGap { missing }));
    }
    let mut authority = Authority::Absent;
    for &marker_generation in &generations {
        let marker = open_marker(fs, key, record, location, marker_generation)?;
        if let MarkerBody::RecoveryRequired { .. } = marker.body() {
            return Err(recovery(RecoveryReason::MarkerRecoveryRequired));
        }
        authority = transition(authority, marker.body().clone()).ok_or(recovery(
            RecoveryReason::IllegalTransition { marker_generation },
        ))?;
    }
    let next_marker = match generations.last() {
        None => 1,
        Some(&last) => next_counter(last)?,
    };
    Ok(Chain {
        authority,
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

fn open_marker<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    record: &RecordIdentity,
    location: RecordLocation<'_>,
    marker_generation: u64,
) -> Result<CommitMarker, CommitError> {
    let bytes = fs
        .read(&generation_path(location.marker_dir, marker_generation))
        .map_err(|error| io_error(CommitStep::ReadMarker, &error))?;
    CommitMarker::open(key, record, &bytes).map_err(|error| {
        recovery(RecoveryReason::MarkerUnreadable {
            marker_generation,
            error,
        })
    })
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
        && committed.epoch == pending.target_epoch
        && pending
            .content_digest
            .map_or(true, |digest| digest == committed.content_digest);
    let restores = serving == Some(committed);
    (completes || restores).then_some(Authority::Active(committed))
}

/// Resolves `PENDING(old -> target)` from authenticated evidence (§9.2's post-promotion rows).
fn resolve_pending<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    next_marker: u64,
    pending: PendingBody,
    serving: Option<CommittedGeneration>,
) -> Result<(Authority, Resolution), CommitError> {
    if let Some(content_digest) = adopt_candidate(fs, ctx, &pending)? {
        let committed = CommittedGeneration {
            generation: pending.target_generation,
            epoch: pending.target_epoch,
            content_digest,
        };
        write_marker(fs, ctx, next_marker, active_body(committed))?;
        let resolution = Resolution::Completed {
            generation: committed.generation,
        };
        return Ok((Authority::Active(committed), resolution));
    }
    match serving {
        Some(committed) => {
            write_marker(fs, ctx, next_marker, active_body(committed))?;
            let resolution = Resolution::RolledBack {
                restored: Some(committed.generation),
            };
            Ok((Authority::Active(committed), resolution))
        }
        None => Ok((
            Authority::Pending {
                pending,
                serving: None,
            },
            Resolution::RolledBack { restored: None },
        )),
    }
}

fn active_body(committed: CommittedGeneration) -> MarkerBody {
    MarkerBody::Active {
        committed_generation: committed.generation,
        committed_epoch: committed.epoch,
        content_digest: committed.content_digest,
    }
}

/// The pending write's candidate, if it authenticates: the promoted target generation, or else
/// the staging file under the marker's own operation suffix, which is then promoted (also after
/// non-matching bytes under the generation name were relocated). Rejected
/// bytes are relocated so the generation name is free for a retry; a read that fails for any
/// reason other than absence decides nothing.
fn adopt_candidate<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    pending: &PendingBody,
) -> Result<Option<[u8; 32]>, CommitError> {
    let dir = ctx.location.record_dir;
    let target = generation_path(dir, pending.target_generation);
    let suffix = &pending.operation.operation_id;
    if let Some(bytes) = read_if_present(fs, &target)? {
        if candidate_matches(ctx, pending, &bytes) {
            return Ok(Some(content_digest(&bytes)));
        }
        // Bytes under the generation name that are not this write's candidate (a collision or a
        // damaged copy) are relocated; the operation's own staging file may still be valid.
        relocate(fs, dir, &target, suffix)?;
    }
    // A non-canonical operation ID names no staging file this protocol could have written.
    let Some(operation) = WriteOperationId::parse(suffix) else {
        return Ok(None);
    };
    let staging = staging_path(dir, pending.target_generation, &operation);
    let Some(bytes) = read_if_present(fs, &staging)? else {
        return Ok(None);
    };
    if !candidate_matches(ctx, pending, &bytes) {
        relocate(fs, dir, &staging, suffix)?;
        return Ok(None);
    }
    promote_staged(fs, dir, &staging, &target, &bytes)?;
    Ok(Some(content_digest(&bytes)))
}

/// Whether `bytes` authenticate as exactly the pending target: this record, the target generation,
/// epoch and schema, and the pending `content_digest` when one was recorded.
fn candidate_matches(ctx: &Context<'_>, pending: &PendingBody, bytes: &[u8]) -> bool {
    let Ok(opened) = open_record(ctx.key, ctx.record, bytes) else {
        return false;
    };
    let header = opened.header;
    header.record_generation == pending.target_generation
        && header.key_epoch == pending.target_epoch
        && header.record_schema == pending.record_schema
        && pending
            .content_digest
            .map_or(true, |digest| digest == content_digest(bytes))
}

/// Promotes a validated staging file left by a crash (§9.2 "after file sync, before promotion"),
/// proves the generation holds exactly those bytes, then drops the staging name.
fn promote_staged<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    staging: &Path,
    target: &Path,
    bytes: &[u8],
) -> Result<(), CommitError> {
    let promote = |error: io::Error| io_error(CommitStep::PromoteCandidate, &error);
    fs.link_no_replace(staging, target).map_err(promote)?;
    if fs.read(target).map_err(promote)? != bytes {
        return Err(recovery(RecoveryReason::CommittedGenerationMismatch));
    }
    // The generation keeps every byte; a staging name that cannot be removed is reported later.
    let _ = fs.remove_file(staging);
    fs.sync_dir(dir).map_err(promote)?;
    Ok(())
}

/// Moves rejected bytes to `<name>.rejected-<operation>` without ever deleting them: the new name
/// is linked first, and the old one removed only once the copy is proven identical.
fn relocate<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    path: &Path,
    operation: &str,
) -> Result<(), CommitError> {
    let fail = |error: io::Error| io_error(CommitStep::RelocateRejected, &error);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    let rejected = dir.join(format!(
        "{}{REJECTED_INFIX}{operation}",
        name.unwrap_or_default()
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
    fs.remove_file(path).map_err(fail)?;
    fs.sync_dir(dir).map_err(fail)?;
    Ok(())
}

const REJECTED_INFIX: &str = ".rejected-";

/// Seals `body` as marker generation `marker_generation` and promotes it (slice 3A).
fn write_marker<F: DurableFs>(
    fs: &mut F,
    ctx: &Context<'_>,
    marker_generation: u64,
    body: MarkerBody,
) -> Result<DirectoryDurability, CommitError> {
    let marker =
        CommitMarker::new(ctx.record, marker_generation, body).map_err(CommitError::Marker)?;
    let operation = WriteOperationId::generate().map_err(CommitError::OperationId)?;
    let request = StageRequest {
        dir: ctx.location.marker_dir,
        identity: marker.identity(),
        meta: RecordMeta {
            key_epoch: ctx.key_epoch,
            record_generation: marker_generation,
            record_schema: MARKER_RECORD_SCHEMA,
        },
        operation: &operation,
    };
    stage_and_promote(fs, ctx.key, &request, &marker.encode())
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
    for (dir, candidate) in [(location.record_dir, pending), (location.marker_dir, None)] {
        let names = fs
            .list_dir(dir)
            .map_err(|error| io_error(CommitStep::ListMarkers, &error))?;
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
