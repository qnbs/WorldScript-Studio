//! Gate 4D Slice D2b-3a: the key route of a bound migration journal (§6, §8.3, §10.1.1).
//!
//! A bound journal is sealed under its operation's journal envelope epoch (the source epoch of a
//! rotation, the target epoch of an enable), which is not the root's `active_key_epoch`: that value
//! moves at cutover while the journal is still bound. So the journal's key is resolved through
//! authority, not through the root's active epoch and not from a caller-supplied key:
//!
//! 1. the root-named manifest generation is read and judged against the digest the committed binding
//!    names, so the header epoch it carries is vouched for by the root, not by the unauthenticated body;
//! 2. that epoch is looked up in the authenticated key-epoch registry, whose status must be `Prepared`,
//!    `Active` or `RetiredRecoveryOnly` (an `ENABLE` journal is sealed under its still-`Prepared`
//!    target); `Revoked` and absent epochs fail closed;
//! 3. the record's opaque route resolves to the key.
//!
//! Everything here is read-only and refuses before any mutation.

use std::path::Path;

use crate::durable::DurableFs;
use crate::error::KeyProviderError;
use crate::journal::{root_named_journal_epoch, JournalDurableError};
use crate::provider::{InstallationScopeId, KeyProvider, RootKeyRefV1};
use crate::root::LiveMigration;
use crate::root_record::{KeyEpochRecord, KeyEpochStatus};
use crate::root_store::{load_key_epoch_set, RootLayout, RootStoreError};
use crate::seal::Key;

/// Where the bound journal lives and what the committed root says about it.
#[derive(Debug, Clone, Copy)]
pub struct JournalRoute<'a> {
    pub layout: RootLayout<'a>,
    pub scope: &'a InstallationScopeId,
    /// The committed root's key route, under which the key-epoch registry is sealed.
    pub root_key_ref: &'a RootKeyRefV1,
    pub journal_dir: &'a Path,
    /// The committed root's live-migration binding.
    pub live: &'a LiveMigration,
}

/// Why a journal key could not be routed. Every variant refuses before any mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalRouteError {
    /// The root-named generation is missing, oversized, or not the bytes the root committed to.
    Journal(JournalDurableError),
    /// The key-epoch registry could not be read or authenticated.
    Registry(RootStoreError),
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
    let epoch = root_named_journal_epoch(fs, route.journal_dir, route.live)
        .map_err(JournalRouteError::Journal)?;
    let set = load_key_epoch_set(fs, provider, route.layout, route.scope, route.root_key_ref)
        .map_err(JournalRouteError::Registry)?;
    let record = set
        .iter()
        .map(|(record, _)| record)
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
