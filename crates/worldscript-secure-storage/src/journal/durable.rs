//! Gate 4D slice B: durable journal manifest/page promotion (§10.1.1) on top of Gate 3 §9 staging.
//!
//! Sealing semantics stay in [`JournalManifest::seal`] / [`JournalPage::seal`]; this module only
//! pairs them with [`crate::durable::stage_and_promote_envelope`] and an in-process fence boundary.

use std::io::ErrorKind;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::durable::{
    generation_path, stage_and_promote_envelope, DurableFs, PromotedGeneration, StageFailure,
    StageRequest, WriteOperationId,
};
use crate::identity::RecordIdentity;
use crate::marker::content_digest;
use crate::record_class::RecordClass;
use crate::root::LiveMigration;
use crate::seal::{Key, RecordMeta};

use super::manifest::JournalManifest;
use super::page::JournalPage;
use super::state::{
    assert_fence, assert_live_binding, assert_manifest_promote_authority,
    assert_page_promote_authority, ManifestEnvelopeDigest, MigrationExecutionError, MigrationFence,
};
use super::{JournalError, JOURNAL_MANIFEST_RECORD_SCHEMA, JOURNAL_PAGE_RECORD_SCHEMA};

static JOURNAL_DURABLE_MUTEX: Mutex<()> = Mutex::new(());

/// Why a fenced journal durability operation was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JournalDurableError {
    Journal(JournalError),
    Stage(StageFailure),
    Fence(MigrationExecutionError),
    /// Refusal against the committed root binding: root-bound resume of the generation it names,
    /// or a promote whose caller is not that binding's owner and revision. Not a fence check.
    Authority(MigrationExecutionError),
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

/// Shared durable I/O target for journal promotion and load helpers.
pub struct JournalDurableContext<'a, F: DurableFs> {
    pub fs: &'a mut F,
    pub key: &'a Key,
    pub dir: &'a Path,
    pub operation: &'a WriteOperationId,
}

impl<'a, F: DurableFs> JournalDurableContext<'a, F> {
    pub fn new(
        fs: &'a mut F,
        key: &'a Key,
        dir: &'a Path,
        operation: &'a WriteOperationId,
    ) -> Self {
        Self {
            fs,
            key,
            dir,
            operation,
        }
    }
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

fn migration_page_identity(
    operation_id: &str,
    page_index: u32,
) -> Result<RecordIdentity, JournalError> {
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

fn promote_sealed_envelope<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    identity: RecordIdentity,
    meta: RecordMeta,
    envelope: Vec<u8>,
    verify: impl FnOnce(&Key, &RecordIdentity, &[u8]) -> Result<(), JournalError>,
) -> Result<PromotedGeneration, JournalDurableError> {
    let promoted = stage_and_promote_envelope(
        ctx.fs,
        ctx.key,
        &stage_request(ctx.dir, &identity, meta, ctx.operation),
        envelope,
    )?;
    // Post-promotion read I/O: `StageFailure.promoted == true` and real `staging` from promotion.
    // Post-promotion semantic open/verify failures remain `JournalDurableError::Journal` (B2 recovery).
    let bytes = ctx.fs.read(&promoted.path).map_err(|error| {
        JournalDurableError::Stage(stage_io_after_promote(error, promoted.staging))
    })?;
    verify(ctx.key, &identity, &bytes)?;
    Ok(promoted)
}

/// Seals `manifest` through the journal codec, durably promotes generation `journal_revision`, and
/// readbacks through [`JournalManifest::open`].
pub(crate) fn promote_manifest<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
) -> Result<PromotedGeneration, JournalDurableError> {
    let identity = migration_identity(&manifest.operation_id)?;
    let meta = manifest_meta(manifest);
    let journal_revision = manifest.journal_revision;
    let envelope = manifest.seal(ctx.key, &identity, meta)?;
    promote_sealed_envelope(ctx, identity, meta, envelope, move |key, id, bytes| {
        JournalManifest::open(key, id, journal_revision, bytes).map(|_| ())
    })
}

/// Fenced [`promote_manifest`].
///
/// `committed` is the root's live-migration binding. Under the journal mutex and before any I/O,
/// `manifest` must be that binding's owner and its next revision
/// ([`assert_manifest_promote_authority`]); otherwise nothing is written. This does not read the
/// root, advance it, or adopt a newer durable generation.
pub fn promote_manifest_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    fence: &MigrationFence,
    committed: Option<&LiveMigration>,
) -> Result<PromotedGeneration, JournalDurableError> {
    with_fence(manifest, fence, || {
        // QNBS-v3: a stale owner's self-consistent manifest/fence pair is refused against the committed binding under the mutex, before any I/O, with no directory enumeration or sibling-generation read.
        assert_manifest_promote_authority(manifest, committed)
            .map_err(JournalDurableError::Authority)?;
        promote_manifest(ctx, manifest)
    })
}

/// A manifest generation the committed owner published, or found already published identically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishedManifest {
    /// `content_digest` (§5.4) of the generation's envelope bytes, which the root binding names.
    pub content_digest: [u8; 32],
    /// `true` when the generation already existed as an identical candidate and nothing was written.
    pub adopted: bool,
}

/// Fenced publication of the owner's next manifest revision that adopts an identical candidate.
///
/// Authority and fence are checked exactly as [`promote_manifest_fenced`] does. The exact path of
/// `generation-<journal_revision>` is then read, never the directory. Absent: the manifest is
/// promoted. Present: it is adopted only if it authenticates under the journal key and decodes to
/// exactly `manifest`, so a retry after a failed root commit resumes with the bytes the binding
/// will name and no journal write. Any other content is a different candidate and is refused with
/// the same `GenerationExists` failure a plain promotion reports, with nothing written or removed
/// (discarding it needs a relocation primitive that is not part of this slice).
pub fn publish_manifest_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    fence: &MigrationFence,
    committed: Option<&LiveMigration>,
) -> Result<PublishedManifest, JournalDurableError> {
    with_fence(manifest, fence, || {
        assert_manifest_promote_authority(manifest, committed)
            .map_err(JournalDurableError::Authority)?;
        let existing = existing_generation(ctx, manifest)?;
        match existing {
            // QNBS-v3: absence is read by exact path under the mutex; link_no_replace still refuses if a writer creates the name between this read and the promotion.
            None => promote_manifest(ctx, manifest).map(|promoted| PublishedManifest {
                content_digest: promoted.content_digest,
                adopted: false,
            }),
            Some(bytes) => adopt_identical_candidate(ctx, manifest, &bytes),
        }
    })
}

fn existing_generation<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
) -> Result<Option<Vec<u8>>, JournalDurableError> {
    match ctx
        .fs
        .read(&generation_path(ctx.dir, manifest.journal_revision))
    {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(JournalDurableError::Stage(stage_io(error))),
    }
}

fn adopt_identical_candidate<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    bytes: &[u8],
) -> Result<PublishedManifest, JournalDurableError> {
    let identity = migration_identity(&manifest.operation_id)?;
    let identical = JournalManifest::open(ctx.key, &identity, manifest.journal_revision, bytes)
        .is_ok_and(|opened| opened == *manifest);
    if identical {
        Ok(PublishedManifest {
            content_digest: content_digest(bytes),
            adopted: true,
        })
    } else {
        Err(JournalDurableError::Stage(generation_exists()))
    }
}

fn generation_exists() -> StageFailure {
    use crate::durable::{StageFailureKind, StageStep, StagingResidue};
    StageFailure {
        step: StageStep::Promote,
        kind: StageFailureKind::GenerationExists,
        promoted: false,
        staging: StagingResidue::None,
    }
}

/// Fenced [`promote_page`]: requires the same manifest authority and fence as manifest promotion.
///
/// A page is written under the manifest generation the committed root names
/// ([`assert_page_promote_authority`]); it is a candidate until the successor manifest names it.
pub fn promote_page_fenced<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    manifest: &JournalManifest,
    fence: &MigrationFence,
    committed: Option<&LiveMigration>,
    page: &JournalPage,
) -> Result<PromotedGeneration, JournalDurableError> {
    with_fence(manifest, fence, || {
        assert_page_promote_authority(manifest, committed)
            .map_err(JournalDurableError::Authority)?;
        promote_page(ctx, &manifest.operation_id, page)
    })
}

/// Seals and durably promotes one journal page generation.
pub(crate) fn promote_page<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    operation_id: &str,
    page: &JournalPage,
) -> Result<PromotedGeneration, JournalDurableError> {
    let identity = migration_page_identity(operation_id, page.page_index())?;
    let meta = page_meta(page);
    let page_generation = page.page_generation();
    let envelope = page.seal(ctx.key, &identity, meta)?;
    promote_sealed_envelope(ctx, identity, meta, envelope, move |key, id, bytes| {
        JournalPage::open(key, id, page_generation, bytes).map(|_| ())
    })
}

/// Loads the manifest generation named by the committed root live-migration binding.
///
/// Reads only `generation-<live.journal_revision>`. A newer file in the same directory is not
/// authority. The binding digest is the canonical content digest of those exact envelope bytes.
pub fn load_authoritative_manifest<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    live: &LiveMigration,
) -> Result<JournalManifest, JournalDurableError> {
    let identity = migration_identity(&live.operation_id)?;
    let path = generation_path(ctx.dir, live.journal_revision);
    let bytes = match ctx.fs.read(&path) {
        Ok(bytes) => bytes,
        // QNBS-v3: only NotFound for the root-named generation is RecoveryRequired; every other I/O and open failure keeps its own class, and no sibling generation is read.
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err(JournalDurableError::Authority(
                MigrationExecutionError::RecoveryRequired,
            ));
        }
        Err(error) => return Err(JournalDurableError::Stage(stage_io(error))),
    };
    let digest = ManifestEnvelopeDigest::from_bytes(content_digest(&bytes));
    let manifest = JournalManifest::open(ctx.key, &identity, live.journal_revision, &bytes)?;
    assert_live_binding(&manifest, live, digest).map_err(JournalDurableError::Authority)?;
    Ok(manifest)
}

/// Loads a durably stored manifest generation from `dir`.
pub fn load_manifest_generation<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    operation_id: &str,
    journal_revision: u64,
) -> Result<JournalManifest, JournalDurableError> {
    let identity = migration_identity(operation_id)?;
    let path = crate::durable::generation_path(ctx.dir, journal_revision);
    let bytes = ctx
        .fs
        .read(&path)
        .map_err(|error| JournalDurableError::Stage(stage_io(error)))?;
    Ok(JournalManifest::open(
        ctx.key,
        &identity,
        journal_revision,
        &bytes,
    )?)
}

fn stage_io(error: std::io::Error) -> StageFailure {
    use crate::durable::{StageFailureKind, StageStep, StagingResidue};
    StageFailure {
        step: StageStep::VerifyPromoted,
        kind: StageFailureKind::Io(error.kind()),
        promoted: false,
        staging: StagingResidue::None,
    }
}

fn stage_io_after_promote(
    error: std::io::Error,
    staging: crate::durable::StagingResidue,
) -> StageFailure {
    use crate::durable::{StageFailureKind, StageStep};
    StageFailure {
        step: StageStep::VerifyPromoted,
        kind: StageFailureKind::Io(error.kind()),
        promoted: true,
        staging,
    }
}

#[cfg(test)]
mod mutex_proof {
    use super::*;
    use std::sync::{Mutex, MutexGuard, TryLockError};

    use crate::journal::{
        empty_inventory_digest, empty_journal_page_set_digest, operation_type, phase_code,
    };

    /// Serializes mutex proof tests so post-release `try_lock()` checks are not perturbed by a
    /// parallel proof test holding `JOURNAL_DURABLE_MUTEX`. Test-only; production unchanged.
    static MUTEX_PROOF_TEST_SERIAL: Mutex<()> = Mutex::new(());

    fn proof_test_serial_guard() -> MutexGuard<'static, ()> {
        MUTEX_PROOF_TEST_SERIAL
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn sample_manifest() -> JournalManifest {
        JournalManifest {
            operation_id: "mutex-proof".into(),
            journal_revision: 0,
            operation_type: operation_type::ENABLE,
            phase: phase_code::BOOTSTRAP_TARGET,
            source_epoch: 0,
            target_epoch: 1,
            has_target_root_key_ref: true,
            target_root_key_ref_digest: Some([0x42; 32]),
            fencing_generation: 1,
            inventory_version: 1,
            inventory_digest: empty_inventory_digest(1),
            page_count: 0,
            entry_count: 0,
            journal_page_set_digest: empty_journal_page_set_digest(),
            cursor_page_index: 0,
            cursor_entry_index: 0,
            has_lease_owner: false,
            lease_owner_id: None,
            lease_expires_unix_ms: None,
            recovery_reason_code: 0,
        }
    }

    #[test]
    fn journal_durable_mutex_blocks_try_lock_while_guard_held() {
        let _serial = proof_test_serial_guard();
        let manifest = sample_manifest();
        let fence = MigrationFence::from_manifest(&manifest);
        let guard = acquire_journal_durable_guard(&manifest, &fence).unwrap();
        match JOURNAL_DURABLE_MUTEX.try_lock() {
            Err(TryLockError::WouldBlock) => {}
            other => panic!("expected WouldBlock while guard held, got {other:?}"),
        }
        drop(guard);
        assert!(
            JOURNAL_DURABLE_MUTEX.try_lock().is_ok(),
            "mutex must be acquirable after guard drop"
        );
    }

    #[test]
    fn with_fence_holds_mutex_during_closure() {
        let _serial = proof_test_serial_guard();
        let manifest = sample_manifest();
        let fence = MigrationFence::from_manifest(&manifest);

        with_fence(&manifest, &fence, || {
            match JOURNAL_DURABLE_MUTEX.try_lock() {
                Err(TryLockError::WouldBlock) => {}
                other => {
                    panic!("expected WouldBlock while with_fence closure active, got {other:?}")
                }
            }
            Ok(())
        })
        .unwrap();

        assert!(
            JOURNAL_DURABLE_MUTEX.try_lock().is_ok(),
            "mutex must be acquirable after with_fence returns"
        );
    }
}
