//! Gate 4D Slice D2b-3a: the key route of a bound migration journal (§6, §8.3, §10.1.1).
//!
//! A bound journal is sealed under its operation's journal envelope epoch (the source epoch of a
//! rotation, the target epoch of an enable), which is not the root's `active_key_epoch`: that value
//! moves at cutover while the journal is still bound. So the journal's key is resolved through
//! authority: not through the root's active epoch, not from a caller-supplied key, and not from a
//! caller-supplied binding. Everything is read from the committed root inside the call:
//!
//! 1. the committed root and the key-epoch registry it commits to are authenticated in one read; the
//!    registry must hash to the root's `key_epoch_set_digest`, so a generation that was removed (which
//!    would expose an older, usable record) or promoted without its root commit is refused;
//! 2. the root's own live-migration binding names the journal; the root-named manifest generation is
//!    judged against its digest, which vouches for the header epoch it carries;
//! 3. that epoch is looked up in the registry: `Prepared`, `Active` and `RetiredRecoveryOnly` are
//!    usable (an `ENABLE` journal is sealed under its still-`Prepared` target), `Revoked` and absent
//!    epochs fail closed;
//! 4. the record's opaque route resolves to the key.
//!
//! Everything here is read-only and refuses before any mutation. Callers that need the answer to hold
//! across a later write hold the `root_commit_mutex`, as the composed journal operations do.

use std::path::Path;

use crate::durable::DurableFs;
use crate::error::KeyProviderError;
use crate::journal::{root_named_journal_epoch, JournalDurableError};
use crate::provider::KeyProvider;
use crate::root_record::{KeyEpochRecord, KeyEpochStatus};
use crate::root_store::{load_committed_registry, RootLayout, RootStoreError};
use crate::seal::Key;

/// Where the root and the bound journal live.
#[derive(Debug, Clone, Copy)]
pub struct JournalRoute<'a> {
    pub layout: RootLayout<'a>,
    pub journal_dir: &'a Path,
}

/// Why a journal key could not be routed. Every variant refuses before any mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalRouteError {
    /// No root has been committed yet, so nothing can be bound.
    NoCommittedRoot,
    /// The committed root binds no live migration.
    NoLiveMigration,
    /// The committed root or its key-epoch registry could not be read or authenticated, or the
    /// registry is not the one the root commits to.
    Registry(RootStoreError),
    /// The root-named generation is missing, oversized, or not the bytes the binding names.
    Journal(JournalDurableError),
    /// The journal's epoch has no record in the registry.
    EpochNotRegistered(u64),
    /// The journal's epoch is `Revoked`: it must stay at least `RetiredRecoveryOnly` while bound.
    EpochRevoked(u64),
    /// The record's key route does not resolve.
    Provider(KeyProviderError),
}

/// Resolves the key of the journal the committed root binds, through authority (module docs).
pub fn resolve_journal_key<F: DurableFs, P: KeyProvider>(
    fs: &mut F,
    provider: &P,
    route: JournalRoute<'_>,
) -> Result<Key, JournalRouteError> {
    let committed = load_committed_registry(fs, provider, route.layout)
        .map_err(JournalRouteError::Registry)?
        .ok_or(JournalRouteError::NoCommittedRoot)?;
    let live = committed
        .root
        .live_migration
        .as_ref()
        .ok_or(JournalRouteError::NoLiveMigration)?;
    let epoch = root_named_journal_epoch(fs, route.journal_dir, live)
        .map_err(JournalRouteError::Journal)?;
    let record = committed
        .records
        .iter()
        .find(|record| record.epoch == epoch)
        .ok_or(JournalRouteError::EpochNotRegistered(epoch))?;
    key_of(provider, record)
}

fn key_of<P: KeyProvider>(provider: &P, record: &KeyEpochRecord) -> Result<Key, JournalRouteError> {
    match record.status {
        KeyEpochStatus::Prepared | KeyEpochStatus::Active | KeyEpochStatus::RetiredRecoveryOnly => {
            provider
                .resolve_ref(&record.root_key_ref)
                .map_err(JournalRouteError::Provider)
        }
        KeyEpochStatus::Revoked => Err(JournalRouteError::EpochRevoked(record.epoch)),
    }
}
