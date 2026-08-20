//! Minimal versioned-migration mechanism.
//!
//! No unified "project schema version N -> N+1" migration framework exists on the TS side today —
//! `services/dbMigration.ts` (one-time IDB topology copy), `idbProjectStore.ts#validateAndFixState`
//! (hand-written field-level repair-on-load), and the encryption-state journal/checkpoint saga each
//! approximate a narrower piece of this. This module formalizes the general concept for the Rust
//! Core, starting with one synthetic migration proving the mechanism.

use crate::envelope::{ProjectEnvelope, CURRENT_SCHEMA_VERSION};
use std::fmt;

/// A migration step that upgrades an envelope from exactly `source_version` to
/// `source_version + 1`.
pub trait Migration {
    fn source_version(&self) -> u32;
    fn apply(&self, envelope: ProjectEnvelope) -> ProjectEnvelope;
}

/// v1 -> v2: backfill `revision_note` for files written before that field existed.
pub struct V1ToV2;

impl Migration for V1ToV2 {
    fn source_version(&self) -> u32 {
        1
    }

    fn apply(&self, mut envelope: ProjectEnvelope) -> ProjectEnvelope {
        if envelope.project.revision_note.is_none() {
            envelope.project.revision_note = Some("migrated from schema v1".to_string());
        }
        envelope.schema_version = 2;
        envelope
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum MigrationError {
    /// No migration is registered starting from this (older) version — a genuine gap in the
    /// registry.
    NoMigrationFrom { version: u32 },
    /// The envelope's `schema_version` is *newer* than [`CURRENT_SCHEMA_VERSION`] — this build
    /// doesn't understand it. Without this check the migration loop's `while version < CURRENT`
    /// condition is simply false for a future version, so it would silently return the envelope
    /// unchanged; if that envelope is later re-saved, any fields this crate doesn't know about
    /// are dropped (serde ignores unknown fields on deserialize). Reject instead of round-tripping
    /// destructively.
    FutureVersion { version: u32, current: u32 },
}

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MigrationError::NoMigrationFrom { version } => write!(
                f,
                "no migration registered starting from schema version {version}"
            ),
            MigrationError::FutureVersion { version, current } => write!(
                f,
                "schema version {version} is newer than this build understands (current: {current}); refusing to load to avoid silently discarding unknown fields on re-save"
            ),
        }
    }
}

impl std::error::Error for MigrationError {}

fn registry() -> Vec<Box<dyn Migration>> {
    vec![Box::new(V1ToV2)]
}

/// Applies registered migrations sequentially until `envelope.schema_version` reaches
/// [`CURRENT_SCHEMA_VERSION`]. A no-op if the envelope is already current. Rejects a
/// `schema_version` newer than [`CURRENT_SCHEMA_VERSION`] rather than passing it through
/// unchanged — see [`MigrationError::FutureVersion`].
pub fn migrate_to_latest(mut envelope: ProjectEnvelope) -> Result<ProjectEnvelope, MigrationError> {
    if envelope.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(MigrationError::FutureVersion {
            version: envelope.schema_version,
            current: CURRENT_SCHEMA_VERSION,
        });
    }
    let migrations = registry();
    while envelope.schema_version < CURRENT_SCHEMA_VERSION {
        let step = migrations
            .iter()
            .find(|m| m.source_version() == envelope.schema_version)
            .ok_or(MigrationError::NoMigrationFrom {
                version: envelope.schema_version,
            })?;
        envelope = step.apply(envelope);
    }
    Ok(envelope)
}
