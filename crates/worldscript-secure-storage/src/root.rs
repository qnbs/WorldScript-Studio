//! Gate 3 slice 3C part 1: the authority-root digests (§5.4, §5.3, §5.5).
//!
//! The authority root binds the complete current authority in one digest: the active key epoch
//! and its key route, the marker set (one immutable marker generation per ordinary record), the
//! catalog shard set, the key-epoch set, who committed this root generation, and any live
//! migration. This module defines those canonical digests exactly as §5.4 specifies — every set is
//! sorted by its explicit key, and a duplicate key is refused before hashing rather than
//! deduplicated (authority-set uniqueness) — and the `pointer_digest` binding a root slot to one
//! committed root. It performs no I/O; persisting roots and catalog pages and committing them
//! through the secure anchor are the later 3C parts.

use sha2::{Digest, Sha256};

use crate::aad::tagged_identity_binding_parts;
use crate::anchor::MAX_OPERATION_ID_LEN;
use crate::error::AadError;
use crate::marker::CommitMarker;
use crate::provider::RootSlot;

const MARKER_SET_DOMAIN: &[u8] = b"worldscript-r15/marker-set/v1";
const CATALOG_SET_DOMAIN: &[u8] = b"worldscript-r15/catalog-set/v1";
const KEY_EPOCH_SET_DOMAIN: &[u8] = b"worldscript-r15/key-epoch-set/v1";
const ROOT_DOMAIN: &[u8] = b"worldscript-r15/root/v1";
const POINTER_DOMAIN: &[u8] = b"worldscript-r15/pointer/v1";

/// Why a digest input was refused. A refused input never yields a digest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootError {
    /// Two entries share a sort key (§5.4 authority-set uniqueness): the replay/substitution case.
    DuplicateEntry,
    /// More entries than `u32be(entry_count)` can state.
    TooManyEntries,
    /// A generation, epoch or revision that is unassigned (`0`) or terminal (`u64::MAX`).
    InvalidCounter,
    /// An empty or over-long (over 128 bytes) `operation_id`.
    InvalidOperationId,
    InvalidIdentity(AadError),
}

/// One `marker_set_digest` entry: the current marker generation of one ordinary record, built only
/// from an authenticated [`CommitMarker`] so its identity bindings and digest are canonical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkerSetEntry {
    class: &'static str,
    logical: Vec<u8>,
    project: Vec<u8>,
    marker_generation: u64,
    marker_entry_digest: [u8; 32],
}

impl MarkerSetEntry {
    pub fn from_marker(marker: &CommitMarker) -> Result<Self, RootError> {
        let identity = marker.identity();
        let (logical, project) = tagged_identity_binding_parts(&identity.context())
            .map_err(RootError::InvalidIdentity)?;
        Ok(MarkerSetEntry {
            class: identity.class().token(),
            logical,
            project,
            marker_generation: marker.marker_generation(),
            marker_entry_digest: marker.entry_digest(),
        })
    }

    fn sort_key(&self) -> (&[u8], &[u8], &[u8]) {
        (self.class.as_bytes(), &self.logical, &self.project)
    }
}

/// One `catalog_set_digest` shard: its id, current catalog generation and page `content_digest`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogShard {
    pub shard_id: u32,
    pub catalog_generation: u64,
    pub content_digest: [u8; 32],
}

/// One `key_epoch_set_digest` entry: an epoch, its registry generation and record `content_digest`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyEpochEntry {
    pub epoch: u64,
    pub registry_generation: u64,
    pub content_digest: [u8; 32],
}

/// Who committed a root generation (`root_commit_evidence`, §5.4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootCommitEvidence {
    pub operation_id: String,
    /// `0` for an ordinary write (§9 step 2); a migration-driven commit uses its positive fence.
    pub fencing_generation: u64,
    pub state: RootCommitState,
}

/// `root_commit_state_code` (§5.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootCommitState {
    /// Authenticated but only prepared or pending (§5.3).
    NotCommitted,
    /// The durable committed state required before a slot is authority.
    Committed,
}

impl RootCommitState {
    fn code(self) -> u32 {
        match self {
            RootCommitState::NotCommitted => 0,
            RootCommitState::Committed => 1,
        }
    }
}

/// The optional live-migration binding (§5.4), independent of who committed the root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveMigration {
    pub operation_id: String,
    pub fencing_generation: u64,
    pub journal_revision: u64,
    /// The manifest envelope's own `content_digest` (§10.1.1).
    pub manifest_digest: [u8; 32],
}

/// The authenticated root body that `root_digest` covers (the digest itself excluded).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootBody {
    /// Also `root_checkpoint_revision` (version 1 keeps no second counter).
    pub root_generation: u64,
    pub active_key_epoch: u64,
    /// `RootKeyRefV1::digest()` of the key route the root resolves through (§8.2).
    pub root_key_ref_digest: [u8; 32],
    pub marker_set_digest: [u8; 32],
    pub catalog_set_digest: [u8; 32],
    pub key_epoch_set_digest: [u8; 32],
    pub commit_evidence: RootCommitEvidence,
    pub live_migration: Option<LiveMigration>,
}

/// `marker_set_digest` (§5.4) over the current marker of every ordinary record.
pub fn marker_set_digest(entries: &[MarkerSetEntry]) -> Result<[u8; 32], RootError> {
    let mut sorted: Vec<&MarkerSetEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.sort_key().cmp(&b.sort_key()));
    refuse_duplicates(&sorted, |entry| entry.sort_key())?;
    let mut hasher = Sha256::new().chain_update(MARKER_SET_DOMAIN);
    hasher.update(entry_count(sorted.len())?);
    for entry in sorted {
        check_counter(entry.marker_generation)?;
        hasher.update((entry.class.len() as u32).to_be_bytes());
        hasher.update(entry.class.as_bytes());
        hasher.update(&entry.logical);
        hasher.update(&entry.project);
        hasher.update(entry.marker_generation.to_be_bytes());
        hasher.update(entry.marker_entry_digest);
    }
    Ok(hasher.finalize().into())
}

/// `catalog_set_digest` (§5.4) over every catalog shard, sorted by `shard_id`.
pub fn catalog_set_digest(shards: &[CatalogShard]) -> Result<[u8; 32], RootError> {
    keyed_set_digest(CATALOG_SET_DOMAIN, shards, |shard| {
        check_counter(shard.catalog_generation)?;
        Ok(SetRow {
            key: u64::from(shard.shard_id),
            key_bytes: shard.shard_id.to_be_bytes().to_vec(),
            generation: shard.catalog_generation,
            content_digest: shard.content_digest,
        })
    })
}

/// `key_epoch_set_digest` (§5.4) over every key-epoch control record, sorted by `epoch`.
pub fn key_epoch_set_digest(entries: &[KeyEpochEntry]) -> Result<[u8; 32], RootError> {
    keyed_set_digest(KEY_EPOCH_SET_DOMAIN, entries, |entry| {
        check_counter(entry.epoch)?;
        check_counter(entry.registry_generation)?;
        Ok(SetRow {
            key: entry.epoch,
            key_bytes: entry.epoch.to_be_bytes().to_vec(),
            generation: entry.registry_generation,
            content_digest: entry.content_digest,
        })
    })
}

/// One row of a numerically keyed set: its sort key, the key's encoded bytes, a generation and a
/// content digest — the shape `catalog_set_digest` and `key_epoch_set_digest` share.
struct SetRow {
    key: u64,
    key_bytes: Vec<u8>,
    generation: u64,
    content_digest: [u8; 32],
}

fn keyed_set_digest<T>(
    domain: &[u8],
    items: &[T],
    row: impl Fn(&T) -> Result<SetRow, RootError>,
) -> Result<[u8; 32], RootError> {
    let mut rows = items.iter().map(row).collect::<Result<Vec<_>, _>>()?;
    rows.sort_by_key(|row| row.key);
    refuse_duplicates(&rows, |row| row.key)?;
    let mut hasher = Sha256::new().chain_update(domain);
    hasher.update(entry_count(rows.len())?);
    for row in rows {
        hasher.update(&row.key_bytes);
        hasher.update(row.generation.to_be_bytes());
        hasher.update(row.content_digest);
    }
    Ok(hasher.finalize().into())
}

/// `root_digest` (§5.4): the domain, then every root body field in the specified order.
pub fn root_digest(root: &RootBody) -> Result<[u8; 32], RootError> {
    check_counter(root.root_generation)?;
    check_counter(root.active_key_epoch)?;
    let mut out = Vec::with_capacity(512);
    out.extend_from_slice(ROOT_DOMAIN);
    out.extend_from_slice(&root.root_generation.to_be_bytes());
    out.extend_from_slice(&root.active_key_epoch.to_be_bytes());
    out.extend_from_slice(&root.root_key_ref_digest);
    out.extend_from_slice(&root.marker_set_digest);
    out.extend_from_slice(&root.catalog_set_digest);
    out.extend_from_slice(&root.key_epoch_set_digest);
    let evidence = &root.commit_evidence;
    push_operation_id(&mut out, &evidence.operation_id)?;
    out.extend_from_slice(&evidence.fencing_generation.to_be_bytes());
    out.extend_from_slice(&evidence.state.code().to_be_bytes());
    push_live_migration(&mut out, root.live_migration.as_ref())?;
    Ok(Sha256::digest(&out).into())
}

/// `pointer_digest` (§5.4): binds an active-slot pointer to one committed root slot.
pub fn pointer_digest(
    slot: RootSlot,
    root_generation: u64,
    root_digest: &[u8; 32],
) -> Result<[u8; 32], RootError> {
    check_counter(root_generation)?;
    Ok(Sha256::new()
        .chain_update(POINTER_DOMAIN)
        .chain_update([slot.code()])
        .chain_update(root_generation.to_be_bytes())
        .chain_update(root_digest)
        .finalize()
        .into())
}

fn push_live_migration(out: &mut Vec<u8>, live: Option<&LiveMigration>) -> Result<(), RootError> {
    let Some(live) = live else {
        out.push(0);
        return Ok(());
    };
    // §10.2: the bootstrap binding's `journal_revision = 0` is the deterministic initial-revision
    // sentinel, so only the terminal value is refused here.
    if live.journal_revision == u64::MAX {
        return Err(RootError::InvalidCounter);
    }
    if live.fencing_generation == 0 {
        // A live migration always owns a positive fence (§9 step 2, §10.1).
        return Err(RootError::InvalidCounter);
    }
    out.push(1);
    push_operation_id(out, &live.operation_id)?;
    out.extend_from_slice(&live.fencing_generation.to_be_bytes());
    out.extend_from_slice(&live.journal_revision.to_be_bytes());
    out.extend_from_slice(&live.manifest_digest);
    Ok(())
}

fn push_operation_id(out: &mut Vec<u8>, operation_id: &str) -> Result<(), RootError> {
    let len = operation_id.len();
    if len == 0 || len > MAX_OPERATION_ID_LEN {
        return Err(RootError::InvalidOperationId);
    }
    out.extend_from_slice(&(len as u32).to_be_bytes());
    out.extend_from_slice(operation_id.as_bytes());
    Ok(())
}

fn refuse_duplicates<T, K: PartialEq>(
    sorted: &[T],
    key: impl Fn(&T) -> K,
) -> Result<(), RootError> {
    if sorted.windows(2).any(|pair| key(&pair[0]) == key(&pair[1])) {
        Err(RootError::DuplicateEntry)
    } else {
        Ok(())
    }
}

fn entry_count(len: usize) -> Result<[u8; 4], RootError> {
    u32::try_from(len)
        .map(u32::to_be_bytes)
        .map_err(|_| RootError::TooManyEntries)
}

fn check_counter(value: u64) -> Result<(), RootError> {
    if value == 0 || value == u64::MAX {
        Err(RootError::InvalidCounter)
    } else {
        Ok(())
    }
}
