//! Gate 3 slice 3C part 3c-2b: the protected write and read paths through the authority root
//! (§5.4, §5.5, §9).
//!
//! The current marker of a record is exactly the one the committed root's `marker_set_digest`
//! names, through the record's catalog descriptor (§5.4); a marker on disk newer than that is a
//! pending transition, never a readable generation. [`protected_write`] follows §9: it verifies the
//! root-named marker, reconciles the record (§9 step 11) and brings the catalog to the reconciled
//! chain, records `PENDING(old -> new)` and commits it through the root (§9 step 2, the
//! ordinary-write coherence rule of §5.5), stages and promotes the candidate and records
//! `ACTIVE(new)` (§9 steps 3–8), then commits that through the root (§9 step 9). Only the second root
//! commit transfers authority, and only then — with every directory sync confirmed — is the result
//! `DURABLE_COMMIT_SUCCESS` (§9 step 10, §9.1).
//!
//! A crash between a marker and the root that names it leaves the chain ahead of the root.
//! [`reconcile_protected`] resolves it at startup from authenticated evidence only: the root-named
//! marker must still be in the chain with its exact entry digest, the record's own reconciliation
//! completes or rolls back a pending write, and the catalog is then committed to the chain's
//! result — or, for a rolled-back first write (no `ABSENT` marker body exists in version 1), the
//! record is dropped from its shard. [`read_protected`] serves only the generation the root-named
//! descriptor makes readable.
//!
//! Retention (§5.5): nothing here deletes a marker, catalog page, root slot or record generation;
//! garbage collection needs reader pins (§5.3.3) and exclusive admission, which are Gate 4. This
//! module assumes one writer.

use crate::authority::{
    commit_catalog_change, load_catalog, AuthorityError, CatalogChange, CatalogCommit,
    CatalogRecoveryReason, LoadedCatalog,
};
use crate::catalog::CatalogDescriptor;
use crate::commit::{
    begin_write, chain_entry_digest, describe_record, finish_write, reconcile, verify_committed,
    CommitError, RecordStore, Resolution, WriteRequest,
};
use crate::durable::{DirectoryDurability, DurableFs, WriteOperationId};
use crate::provider::{KeyProvider, RootKeyRefV1};
use crate::record::OpenedRecord;
use crate::root_store::{RootCommitted, RootLayout};

/// One protected record under the authority root: where the root lives, the record, and the key
/// route and active epoch every root commit of this write is sealed under.
#[derive(Clone, Copy)]
pub struct ProtectedTarget<'a> {
    pub layout: RootLayout<'a>,
    pub store: RecordStore<'a>,
    pub root_key_ref: &'a RootKeyRefV1,
    /// The active key epoch: the record generation and every root commit use it.
    pub key_epoch: u64,
}

/// The payload of one protected write and the schema it is sealed with.
#[derive(Debug, Clone, Copy)]
pub struct ProtectedWrite<'a> {
    pub record_schema: u32,
    pub plaintext: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtectedError {
    /// The record's marker chain or committed generation (slice 3B).
    Commit(CommitError),
    /// The catalog or root commit (slice 3C).
    Authority(AuthorityError),
    /// The `ACTIVE` marker was recorded but the catalog already stated it, so no root carried the
    /// transition; nothing can be reported as committed.
    RootNotAdvanced,
    /// `RECOVERY_REQUIRED`: the record is not catalogued, yet its marker chain resolves to an
    /// authority. In the protected path an uncatalogued record's chain can only be a rolled-back
    /// first write, so a chain no committed root ever named is never published.
    UnrootedChain,
}

impl From<CommitError> for ProtectedError {
    fn from(error: CommitError) -> Self {
        ProtectedError::Commit(error)
    }
}

impl From<AuthorityError> for ProtectedError {
    fn from(error: AuthorityError) -> Self {
        ProtectedError::Authority(error)
    }
}

/// §9.1's success results.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDurability {
    /// Every marker, page, root and directory sync of the write was confirmed.
    DurableCommitSuccess,
    /// The root committed, but the platform could not confirm every directory sync.
    CommittedNotConfirmedDurable,
}

/// A protected write whose `ACTIVE` root committed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedCommitted {
    pub generation: u64,
    pub marker_generation: u64,
    pub root_generation: u64,
    pub durability: WriteDurability,
}

/// What a protected read found (§5.5's enumerable-versus-readable distinction).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtectedRead {
    /// The committed catalog does not hold the record.
    NotCatalogued,
    /// The record is catalogued but has no committed generation yet (a first write is pending).
    NotYetReadable,
    Record(OpenedRecord),
}

/// Writes `write.plaintext` as the next generation of the record, committing the `PENDING` and the
/// `ACTIVE` marker each through the authority root (§9 steps 2 and 9).
pub fn protected_write<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    target: ProtectedTarget<'_>,
    write: ProtectedWrite<'_>,
) -> Result<ProtectedCommitted, ProtectedError> {
    let mut durability = reconcile_protected(fs, provider, target)?.durability;
    let request = WriteRequest {
        key_epoch: target.key_epoch,
        record_schema: write.record_schema,
    };
    let begun = begin_write(fs, target.store, request)?;
    let pending_root = commit_chain_state(fs, provider, target, false)?;
    durability = both(durability, pending_root.map(|root| root.directories));
    let marker = finish_write(fs, target.store, begun, write.plaintext)?;
    durability = both(durability, Some(marker.directories));
    let active_root =
        commit_chain_state(fs, provider, target, false)?.ok_or(ProtectedError::RootNotAdvanced)?;
    durability = both(durability, Some(active_root.directories));
    Ok(ProtectedCommitted {
        generation: marker.generation,
        marker_generation: marker.marker_generation,
        root_generation: active_root.root_generation,
        durability: match durability {
            DirectoryDurability::Confirmed => WriteDurability::DurableCommitSuccess,
            DirectoryDurability::NotConfirmed => WriteDurability::CommittedNotConfirmedDurable,
        },
    })
}

/// How [`reconcile_protected`] left the record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtectedReconciled {
    /// The record's committed descriptor afterwards; `None` if it is not catalogued.
    pub descriptor: Option<CatalogDescriptor>,
    pub resolution: Resolution,
    /// The root generation committed to bring the catalog to the chain, if one was needed.
    pub root_generation: Option<u64>,
    pub durability: DirectoryDurability,
}

/// Startup resolution of one record (§9 step 11): the root-named marker must still be in the
/// chain, the record's pending write is completed or rolled back from authenticated evidence, and
/// the catalog is committed to the result — a rolled-back first write is dropped from its shard.
pub fn reconcile_protected<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    target: ProtectedTarget<'_>,
) -> Result<ProtectedReconciled, ProtectedError> {
    let catalog = load_catalog(fs, provider, target.layout)?;
    let named = named_descriptor(catalog.as_ref(), target.store);
    if let Some(named) = named {
        verify_named_marker(fs, target.store, named)?;
    }
    let catalogued = named.is_some();
    let reconciled = reconcile(fs, target.store, target.key_epoch)?;
    let rolled_back_first = reconciled.resolution == Resolution::RolledBack { restored: None };
    if !(catalogued || rolled_back_first) {
        refuse_unrooted_chain(fs, target.store)?;
    }
    let root = commit_chain_state(fs, provider, target, rolled_back_first)?;
    let catalog = load_catalog(fs, provider, target.layout)?;
    let durability = both(
        reconciled
            .marker_durability
            .unwrap_or(DirectoryDurability::Confirmed),
        root.map(|root| root.directories),
    );
    Ok(ProtectedReconciled {
        descriptor: named_descriptor(catalog.as_ref(), target.store).cloned(),
        resolution: reconciled.resolution,
        root_generation: root.map(|root| root.root_generation),
        durability,
    })
}

/// Reads the generation the root-named descriptor makes readable: its marker must be in the chain
/// with the exact entry digest, and the file must be exactly the envelope that marker committed.
pub fn read_protected<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    layout: RootLayout<'_>,
    store: RecordStore<'_>,
) -> Result<ProtectedRead, ProtectedError> {
    let catalog = load_catalog(fs, provider, layout)?;
    let Some(named) = named_descriptor(catalog.as_ref(), store) else {
        return Ok(ProtectedRead::NotCatalogued);
    };
    verify_named_marker(fs, store, named)?;
    match named.readable() {
        None => Ok(ProtectedRead::NotYetReadable),
        Some(committed) => Ok(ProtectedRead::Record(verify_committed(
            fs, store, committed,
        )?)),
    }
}

/// Commits the catalog to the record's current chain: its descriptor (from the verified chain
/// only), or no descriptor when `drop_record` (a rolled-back first write). `None` when the catalog
/// already states exactly that.
fn commit_chain_state<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &mut P,
    target: ProtectedTarget<'_>,
    drop_record: bool,
) -> Result<Option<RootCommitted>, ProtectedError> {
    let catalog = load_catalog(fs, provider, target.layout)?;
    let named = named_descriptor(catalog.as_ref(), target.store);
    let desired = if drop_record {
        None
    } else {
        describe_record(fs, target.store)?
    };
    if named == desired.as_ref() {
        return Ok(None);
    }
    // A generation is made readable only once its file is proven to be the committed envelope.
    if let Some(readable) = desired.as_ref().and_then(CatalogDescriptor::readable) {
        verify_committed(fs, target.store, readable)?;
    }
    let remove = [target.store.record.clone()];
    let upsert: Vec<CatalogDescriptor> = desired.into_iter().collect();
    let change = match (upsert.is_empty(), named.is_some()) {
        (false, _) => CatalogChange {
            upsert: &upsert,
            remove: &[],
        },
        (true, true) => CatalogChange {
            upsert: &[],
            remove: &remove,
        },
        (true, false) => return Ok(None),
    };
    let operation = WriteOperationId::generate()
        .map_err(|error| ProtectedError::Authority(AuthorityError::OperationId(error)))?;
    let commit = CatalogCommit {
        change,
        root_key_ref: target.root_key_ref,
        active_key_epoch: target.key_epoch,
        operation_id: operation.as_str(),
    };
    Ok(Some(commit_catalog_change(
        fs,
        provider,
        target.layout,
        commit,
    )?))
}

/// An uncatalogued record that is not a rolled-back first write must have no authority at all: a
/// chain no committed root ever named is never published.
fn refuse_unrooted_chain<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
) -> Result<(), ProtectedError> {
    match describe_record(fs, store)? {
        None => Ok(()),
        Some(_) => Err(ProtectedError::UnrootedChain),
    }
}

/// The committed descriptor of `store`'s record, if catalogued.
fn named_descriptor<'c>(
    catalog: Option<&'c LoadedCatalog>,
    store: RecordStore<'_>,
) -> Option<&'c CatalogDescriptor> {
    catalog?
        .descriptors()
        .find(|descriptor| descriptor.record() == store.record)
}

/// The marker generation the root names must be in the record's complete, verified chain
/// (gap-free from generation 1, every transition legal) with exactly its entry digest; a missing,
/// replaced or unverifiable marker is `RECOVERY_REQUIRED` — never an older or newer marker instead.
fn verify_named_marker<F: DurableFs>(
    fs: &mut F,
    store: RecordStore<'_>,
    named: &CatalogDescriptor,
) -> Result<(), ProtectedError> {
    let digest = match chain_entry_digest(fs, store, named.marker_generation()) {
        Ok(digest) => digest,
        Err(CommitError::RecoveryRequired(_)) => None,
        Err(error) => return Err(error.into()),
    };
    if digest == Some(named.marker_entry_digest()) {
        Ok(())
    } else {
        Err(ProtectedError::Authority(AuthorityError::RecoveryRequired(
            CatalogRecoveryReason::MarkerSetMismatch,
        )))
    }
}

/// `Confirmed` only if `first` and `second` (when present) both are.
fn both(first: DirectoryDurability, second: Option<DirectoryDurability>) -> DirectoryDurability {
    match (first, second) {
        (DirectoryDurability::Confirmed, None | Some(DirectoryDurability::Confirmed)) => {
            DirectoryDurability::Confirmed
        }
        _ => DirectoryDurability::NotConfirmed,
    }
}
