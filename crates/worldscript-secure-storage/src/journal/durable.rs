//! Gate 4D slice B: durable journal manifest/page promotion (§10.1.1) on top of Gate 3 §9 staging.
//!
//! Sealing semantics stay in [`JournalManifest::seal`] / [`JournalPage::seal`]; this module only
//! pairs them with [`crate::durable::stage_and_promote_envelope`] and an in-process fence boundary.

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::durable::{
    stage_and_promote_envelope, PromotedGeneration, StageFailure, StageRequest, WriteOperationId,
    DurableFs,
};
use crate::identity::RecordIdentity;
use crate::record_class::RecordClass;
use crate::seal::{Key, RecordMeta};

use super::manifest::JournalManifest;
use super::page::JournalPage;
use super::state::{assert_fence, MigrationExecutionError, MigrationFence};
use super::{JournalError, JOURNAL_MANIFEST_RECORD_SCHEMA, JOURNAL_PAGE_RECORD_SCHEMA};

static JOURNAL_DURABLE_MUTEX: Mutex<()> = Mutex::new(());

/// Why a fenced journal durability operation was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalDurableError {
    Journal(JournalError),
    Stage(StageFailure),
    Fence(MigrationExecutionError),
    LockPoisoned,
}

impl From<JournalError> for JournalDurableError {
    fn from(value: JournalError) -> Self {
        JournalDurableError::Journal(value)
    }
}

impl From<StageFailure> for JournalDurableError {
    fn from(value: StageFailure) -> Self {
        JournalDurableError::Stage(value)
    }
}

/// Holds the in-process journal durability mutex and validates `fence` before any caller I/O.
pub struct JournalDurableGuard<'a> {
    _lock: MutexGuard<'a, ()>,
}

/// Acquires the single-process journal durability mutex and rejects a stale fence before I/O.
pub fn acquire_journal_durable_guard<'a>(
    manifest: &'a JournalManifest,
    fence: &'a MigrationFence,
) -> Result<JournalDurableGuard<'a>, JournalDurableError> {
    let lock = JOURNAL_DURABLE_MUTEX
        .lock()
        .map_err(|_| JournalDurableError::LockPoisoned)?;
    assert_fence(manifest, fence).map_err(JournalDurableError::Fence)?;
    Ok(JournalDurableGuard { _lock: lock })
}

/// Runs `f` under [`acquire_journal_durable_guard`].
pub fn with_fence<T>(
    manifest: &JournalManifest,
    fence: &MigrationFence,
    f: impl FnOnce() -> Result<T, JournalDurableError>,
) -> Result<T, JournalDurableError> {
    let _guard = acquire_journal_durable_guard(manifest, fence)?;
    f()
}

fn migration_identity(operation_id: &str) -> Result<RecordIdentity, JournalError> {
    RecordIdentity::new(RecordClass::Migration, &[operation_id])
        .map_err(|_| JournalError::InvalidOperationId)
}

fn migration_page_identity(operation_id: &str, page_index: u32) -> Result<RecordIdentity, JournalError> {
    RecordIdentity::new(
        RecordClass::MigrationPage,
        &[operation_id, &page_index.to_string()],
    )
    .map_err(|_| JournalError::InvalidOperationId)
}

fn manifest_meta(manifest: &JournalManifest) -> RecordMeta {
    RecordMeta {
        key_epoch: 1,
        record_generation: manifest.journal_revision,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    }
}

fn page_meta(page: &JournalPage) -> RecordMeta {
    RecordMeta {
        key_epoch: 1,
        record_generation: page.page_generation(),
        record_schema: JOURNAL_PAGE_RECORD_SCHEMA,
    }
}

fn stage_request<'a>(
    dir: &'a Path,
    identity: &'a RecordIdentity,
    meta: RecordMeta,
    operation: &'a WriteOperationId,
) -> StageRequest<'a> {
    StageRequest {
        dir,
        identity,
        meta,
        operation,
        retain_staging: false,
    }
}

/// Seals `manifest` through the journal codec, durably promotes generation `journal_revision`, and
/// readbacks through [`JournalManifest::open`].
pub fn promote_manifest<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    dir: &Path,
    manifest: &JournalManifest,
    operation: &WriteOperationId,
) -> Result<PromotedGeneration, JournalDurableError> {
    let identity = migration_identity(&manifest.operation_id)?;
    let meta = manifest_meta(manifest);
    let envelope = manifest.seal(key, &identity, meta)?;
    let promoted = stage_and_promote_envelope(
        fs,
        key,
        &stage_request(dir, &identity, meta, operation),
        envelope,
    )?;
    let bytes = fs
        .read(&promoted.path)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    JournalManifest::open(key, &identity, manifest.journal_revision, &bytes)?;
    Ok(promoted)
}

/// Fenced [`promote_manifest`].
pub fn promote_manifest_fenced<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    dir: &Path,
    manifest: &JournalManifest,
    fence: &MigrationFence,
    operation: &WriteOperationId,
) -> Result<PromotedGeneration, JournalDurableError> {
    with_fence(manifest, fence, || promote_manifest(fs, key, dir, manifest, operation))
}

/// Seals and durably promotes one journal page generation.
pub fn promote_page<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    dir: &Path,
    operation_id: &str,
    page: &JournalPage,
    operation: &WriteOperationId,
) -> Result<PromotedGeneration, JournalDurableError> {
    let identity = migration_page_identity(operation_id, page.page_index())?;
    let meta = page_meta(page);
    let envelope = page.seal(key, &identity, meta)?;
    let promoted = stage_and_promote_envelope(
        fs,
        key,
        &stage_request(dir, &identity, meta, operation),
        envelope,
    )?;
    let bytes = fs
        .read(&promoted.path)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    JournalPage::open(key, &identity, page.page_generation(), &bytes)?;
    Ok(promoted)
}

/// Loads a durably stored manifest generation from `dir`.
pub fn load_manifest_generation<F: DurableFs>(
    fs: &mut F,
    key: &Key,
    dir: &Path,
    operation_id: &str,
    journal_revision: u64,
) -> Result<JournalManifest, JournalDurableError> {
    let identity = migration_identity(operation_id)?;
    let path = crate::durable::generation_path(dir, journal_revision);
    let bytes = fs
        .read(&path)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    Ok(JournalManifest::open(key, &identity, journal_revision, &bytes)?)
}

fn stage_io(error: std::io::Error) -> StageFailure {
    use crate::durable::{StageFailureKind, StageStep, StagingResidue};
    StageFailure {
        step: StageStep::VerifyPromoted,
        kind: StageFailureKind::Io(error.kind()),
        promoted: true,
        staging: StagingResidue::None,
    }
}
