//! Gate 4D slice C2a: the entry gate of the exclusive conversion driver (§10.3 `ADMIT`, `CONVERT`).
//!
//! Conversion rewrites every record of the final inventory, so it must run with no ordinary operation
//! in flight. [`begin_conversion`] makes that structural: it takes the installation's
//! [`ExclusiveAdmissionGuard`] by mutable borrow, derives the root layout from the scope that guard
//! was acquired for (the root cannot differ from the one admitted), and returns a
//! [`ConversionSession`] that keeps the borrow, so one admission carries one session and the
//! admission outlives it. A shared guard cannot be passed:
//!
//! ```compile_fail
//! use worldscript_secure_storage::{
//!     begin_conversion, ConversionBegin, KeyProvider, SharedAdmissionGuard, StdFs,
//! };
//!
//! fn shared_cannot_convert<P: KeyProvider>(
//!     admission: &mut SharedAdmissionGuard,
//!     provider: &P,
//!     begin: ConversionBegin<'_>,
//! ) {
//!     let _ = begin_conversion(admission, &mut StdFs, provider, begin);
//! }
//! ```
//!
//! The gate re-reads what the committed root vouches for instead of trusting a caller's copy: the
//! binding comes from the root, the journal key is resolved through the key-epoch registry, and the
//! manifest is loaded by the exact root-named path, so the binding's digest authenticates its bytes
//! ([`read_committed_journal`]). It then refuses unless the operation is in `ADMIT` (conversion can be
//! entered) or `CONVERT` (a resumed conversion), the final inventory was captured, and the committed
//! lease belongs to the caller. A lease owned by another owner is not taken over here: a restart is
//! the existing takeover followed by a fresh begin. No clock is read, so a lease past its expiry is
//! still the caller's while nobody has taken over (the fence arbitrates).
//!
//! Beginning writes nothing and holds no key. The session then moves the journal only through the
//! fenced journal-owner operations, one step at a time ([`ConversionSession::renew_lease`] is the first):
//! each step checks the admission, builds the successor from the session's own snapshot, commits it
//! with the key route and active epoch the committed root itself names, re-reads the committed journal
//! and checks the admission again. A step that fails leaves the snapshot as it was; a retry rebuilds
//! the identical successor, which the journal adopts if the first attempt had already written it.

use crate::admission::{AdmissionScope, ExclusiveAdmissionGuard};
use std::path::Path;

use crate::authority::{
    commit_lease_renewal, read_committed_journal, AuthorityError, CommittedJournal,
    JournalCheckpoint, JournalSource,
};
use crate::durable::{DurableFs, WriteOperationId};
use crate::error::SealError;
use crate::journal::{
    phase_code, renewed_lease, CandidateConflict, JournalManifest, MigrationExecutionError,
    MigrationFence,
};
use crate::provider::KeyProvider;
use crate::root::LiveMigration;
use crate::root_store::RootLayout;

/// What the gate needs from its caller: the scope the admission was acquired for, where the journal
/// lives, and the identity the committed lease must carry.
#[derive(Clone, Copy)]
pub struct ConversionBegin<'a> {
    pub scope: AdmissionScope<'a>,
    pub journal: JournalSource<'a>,
    pub owner_id: &'a str,
}

/// Why the gate or a step refused. A refusal by the gate, and by a step before its commit, leaves the
/// tree unchanged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversionError {
    /// The guard does not hold the scope: other directories, or directories replaced since acquisition.
    NotAdmitted,
    /// Reading the committed journal failed (no bound migration, key route, authentication, I/O).
    Authority(AuthorityError),
    /// The operation finished (`DONE`).
    TerminalPhase,
    /// The operation is in durable terminal refusal (`RECOVERY_REQUIRED`).
    RecoveryRequired,
    /// Conversion runs in `ADMIT` and `CONVERT` only.
    PhaseNotConvertible,
    /// The final inventory was not captured in `ADMIT` (§10.3).
    FinalInventoryNotCaptured,
    /// The committed lease is owned by another owner, or by none.
    ForeignLeaseOwner,
    /// A step's successor is not a valid one (a renewal with no lease to renew, or an expiry that does
    /// not move strictly forward).
    Migration(MigrationExecutionError),
    /// No write-operation identifier could be drawn from the operating system.
    OperationId(SealError),
}

impl From<AuthorityError> for ConversionError {
    fn from(error: AuthorityError) -> Self {
        Self::Authority(error)
    }
}

/// The exclusive conversion entry: the committed journal state, read under an admission that no
/// ordinary operation can share.
#[derive(Debug)]
pub struct ConversionSession<'a> {
    held: &'a mut ExclusiveAdmissionGuard,
    scope: AdmissionScope<'a>,
    journal_dir: &'a Path,
    journal: CommittedJournal,
}

/// Opens the conversion gate over the committed journal; see the module documentation.
pub fn begin_conversion<'a, F: DurableFs, P: KeyProvider>(
    held: &'a mut ExclusiveAdmissionGuard,
    fs: &mut F,
    provider: &P,
    begin: ConversionBegin<'a>,
) -> Result<ConversionSession<'a>, ConversionError> {
    ensure_admitted(held, begin.scope)?;
    let layout = RootLayout {
        root_dir: begin.scope.root_dir,
    };
    let journal = read_committed_journal(fs, provider, layout, begin.journal)?;
    // The directories must still be the ones admitted after the reads, not only before them.
    ensure_admitted(held, begin.scope)?;
    check_convertible(&journal.manifest, begin.owner_id)?;
    Ok(ConversionSession {
        held,
        scope: begin.scope,
        journal_dir: begin.journal.dir,
        journal,
    })
}

fn ensure_admitted(
    held: &ExclusiveAdmissionGuard,
    scope: AdmissionScope<'_>,
) -> Result<(), ConversionError> {
    if held.guards(scope) {
        Ok(())
    } else {
        Err(ConversionError::NotAdmitted)
    }
}

fn check_convertible(manifest: &JournalManifest, owner_id: &str) -> Result<(), ConversionError> {
    match manifest.phase {
        phase_code::DONE => return Err(ConversionError::TerminalPhase),
        phase_code::RECOVERY_REQUIRED => return Err(ConversionError::RecoveryRequired),
        phase_code::ADMIT | phase_code::CONVERT => {}
        _ => return Err(ConversionError::PhaseNotConvertible),
    }
    if !manifest.final_inventory_captured {
        return Err(ConversionError::FinalInventoryNotCaptured);
    }
    if manifest.lease_owner_id.as_deref() != Some(owner_id) {
        return Err(ConversionError::ForeignLeaseOwner);
    }
    Ok(())
}

impl<'a> ConversionSession<'a> {
    /// The manifest the committed root names.
    pub fn manifest(&self) -> &JournalManifest {
        &self.journal.manifest
    }

    /// The binding the committed root holds for it.
    pub fn live(&self) -> &LiveMigration {
        &self.journal.live
    }

    /// The owner's token at the committed revision.
    pub fn fence(&self) -> MigrationFence {
        MigrationFence::from_manifest(&self.journal.manifest)
    }

    /// Whether the admission still holds the scope the session began under.
    pub fn is_admitted(&self) -> bool {
        self.held.guards(self.scope)
    }

    /// Renews the owner's lease to `expires_unix_ms`, a time the caller chose (Core reads no clock).
    ///
    /// The expiry must move strictly forward (`Migration(InvalidLeaseRenewal)`); a lease long past its
    /// expiry is still renewed while nobody has taken over, because a takeover advances the fence and
    /// the committed manifest then names another owner. The renewal is committed by
    /// [`commit_lease_renewal`] under the root lock, so a snapshot that went stale is refused before any
    /// write. On success the session holds the committed journal as the root now names it. On failure it
    /// holds the snapshot it had, and a retry adopts a renewal the journal already wrote. A lost
    /// admission is reported as `NotAdmitted` even when it was lost after the commit: begin again to
    /// learn the state.
    pub fn renew_lease<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        expires_unix_ms: u64,
    ) -> Result<(), ConversionError> {
        self.check_admitted()?;
        let renewed = renewed_lease(&self.journal.manifest, &self.fence(), expires_unix_ms)
            .map_err(ConversionError::Migration)?;
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let journal = JournalSource {
            dir: self.journal_dir,
            operation: &operation,
        };
        let fence = MigrationFence::from_manifest(&renewed);
        let step = JournalCheckpoint {
            manifest: &renewed,
            fence: &fence,
            journal,
            root_key_ref: &self.journal.root_key_ref,
            active_key_epoch: self.journal.active_key_epoch,
            conflict: CandidateConflict::Refuse,
        };
        commit_lease_renewal(fs, provider, self.layout(), step)?;
        self.journal = read_committed_journal(fs, &*provider, self.layout(), journal)?;
        self.check_admitted()
    }

    fn layout(&self) -> RootLayout<'a> {
        RootLayout {
            root_dir: self.scope.root_dir,
        }
    }

    fn check_admitted(&self) -> Result<(), ConversionError> {
        ensure_admitted(self.held, self.scope)
    }
}
