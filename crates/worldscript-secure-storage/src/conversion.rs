//! Gate 4D slice C2a: the entry gate of the exclusive conversion driver (§10.3 `ADMIT`, `CONVERT`).
//!
//! Conversion rewrites every record of the final inventory, so it must run with no ordinary operation
//! in flight. [`begin_conversion`] makes that structural: it takes the installation's
//! [`ExclusiveAdmissionGuard`] by mutable borrow, derives the root layout from the scope that guard
//! was acquired for (the root cannot differ from the one admitted), pins the journal directory below
//! the admitted installation, and returns a [`ConversionSession`] that keeps the borrow, so one
//! admission carries one session and the admission outlives it. A shared guard cannot be passed:
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
//! fenced journal-owner operations, one step at a time ([`ConversionSession::renew_lease`] is the
//! first). A step checks the admission and the journal directory, builds the successor from the
//! session's own snapshot, takes the root event through the held admission (so the identity check and
//! the root lock are coupled), commits with the key route and active epoch the committed root itself
//! names, reads the committed journal back under that same root event and checks the admission again.
//!
//! What a step leaves behind. All file operations of a session go through the canonical paths of the
//! root, the installation and the journal directory that were validated and pinned at begin, never
//! through the caller's spelling (a symlink retargeted later cannot redirect them). Before the commit
//! the tree and the snapshot are unchanged, and a retry rebuilds the same successor, which the journal
//! adopts if it is identical to a candidate already written; a differing candidate of a crashed attempt
//! is moved aside with its bytes preserved, so it never blocks the next step. Whatever the commit
//! reports, the journal is then read back under the same root event and the root settles the outcome:
//! it names the successor (committed, even if the commit reported an error), or it does not (not
//! committed, snapshot kept). If the read-back fails, or names a journal that is neither of the two
//! where the commit reported success, the session is spent: every later step is refused and the caller
//! begins again to learn the state. A lost admission is reported even when it was lost after the
//! commit; the snapshot then is the committed journal.

use std::fs::File;
use std::path::{Path, PathBuf};

use crate::admission::{AdmissionError, AdmissionScope, ExclusiveAdmissionGuard};
use crate::authority::{
    commit_lease_renewal_held, read_committed_journal, AuthorityError, CommittedJournal,
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
use crate::root_lock::sys;
use crate::root_store::{RootCommitted, RootLayout};

/// What the gate needs from its caller: the scope the admission was acquired for, where the journal
/// lives (below the installation directory of that scope), and the identity the committed lease must
/// carry.
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
    /// The guard does not hold the scope, or the journal directory is no longer the one pinned:
    /// other directories, or directories replaced since acquisition.
    NotAdmitted,
    /// The admission could not take the root event, or could not pin a directory.
    Admission(AdmissionError),
    /// Another root commit holds the root lock; nothing was written, try again.
    RootBusy,
    /// The journal directory is not below the admitted installation directory, or lies within the
    /// authority root (a journal generation could then collide with a root slot).
    JournalMisplaced,
    /// Reading the committed journal, or committing a step, failed (no bound migration, key route,
    /// authentication, I/O, a stale token).
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
    /// The step committed, but the journal read back is not the one it committed: the session is
    /// spent, begin again.
    Superseded,
    /// The step committed, but the committed journal could not be read back: the session is spent,
    /// begin again.
    Unreadable(AuthorityError),
    /// The commit reported this error, yet the root names the successor: the step is committed (an
    /// ambiguous durability outcome of the anchor, say) and the session follows the root.
    Committed(AuthorityError),
    /// The commit reported this error and the root could not be read back to settle whether it
    /// committed: the session is spent, begin again.
    Unsettled(AuthorityError),
    /// An earlier step spent this session; begin again.
    Spent,
}

impl From<AuthorityError> for ConversionError {
    fn from(error: AuthorityError) -> Self {
        Self::Authority(error)
    }
}

fn io_error(error: std::io::Error) -> ConversionError {
    ConversionError::Admission(AdmissionError::from(error))
}

/// A directory held open, so that a later look can tell whether its path still names it.
#[derive(Debug)]
struct PinnedDirectory {
    pin: File,
    canonical: PathBuf,
}

impl PinnedDirectory {
    /// Pins `dir` (before canonicalising it, as the admission does) and requires it to lie strictly
    /// below the canonical installation directory and outside the canonical authority root.
    fn placed(installation: &Path, root: &Path, dir: &Path) -> Result<Self, ConversionError> {
        let pin = sys::open_directory(dir).map_err(io_error)?;
        let canonical = std::fs::canonicalize(dir).map_err(io_error)?;
        let below = canonical != installation && canonical.starts_with(installation);
        if !below || canonical.starts_with(root) {
            return Err(ConversionError::JournalMisplaced);
        }
        let pinned = Self { pin, canonical };
        if pinned.is_current() {
            Ok(pinned)
        } else {
            Err(ConversionError::NotAdmitted)
        }
    }

    fn is_current(&self) -> bool {
        sys::still_named(&self.pin, &self.canonical).unwrap_or(false)
    }
}

/// The exclusive conversion entry: the committed journal state, read under an admission that no
/// ordinary operation can share.
#[derive(Debug)]
pub struct ConversionSession<'a> {
    held: &'a mut ExclusiveAdmissionGuard,
    /// The canonical installation and root directories the admission was checked against; every file
    /// operation of the session goes through these, not through the caller's spelling.
    installation: PathBuf,
    root: PathBuf,
    journal_pin: PinnedDirectory,
    journal: CommittedJournal,
    spent: bool,
}

/// Opens the conversion gate over the committed journal; see the module documentation.
pub fn begin_conversion<'a, F: DurableFs, P: KeyProvider>(
    held: &'a mut ExclusiveAdmissionGuard,
    fs: &mut F,
    provider: &P,
    begin: ConversionBegin<'_>,
) -> Result<ConversionSession<'a>, ConversionError> {
    let installation = std::fs::canonicalize(begin.scope.installation_dir).map_err(io_error)?;
    let root = std::fs::canonicalize(begin.scope.root_dir).map_err(io_error)?;
    ensure_admitted(held, canonical(&installation, &root))?;
    let journal_pin = PinnedDirectory::placed(&installation, &root, begin.journal.dir)?;
    let layout = RootLayout { root_dir: &root };
    let source = JournalSource {
        dir: &journal_pin.canonical,
        operation: begin.journal.operation,
    };
    let journal = read_committed_journal(fs, provider, layout, source)?;
    // The directories must still be the ones admitted after the reads, not only before them.
    ensure_admitted(held, canonical(&installation, &root))?;
    if !journal_pin.is_current() {
        return Err(ConversionError::NotAdmitted);
    }
    check_convertible(&journal.manifest, begin.owner_id)?;
    Ok(ConversionSession {
        held,
        installation,
        root,
        journal_pin,
        journal,
        spent: false,
    })
}

fn canonical<'p>(installation: &'p Path, root: &'p Path) -> AdmissionScope<'p> {
    AdmissionScope {
        installation_dir: installation,
        root_dir: root,
    }
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
    /// The manifest the committed root names, as of the last step this session could read back.
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

    /// Whether the admission still holds the scope the session began under and the journal directory
    /// is still the one pinned.
    pub fn is_admitted(&self) -> bool {
        self.check_admitted().is_ok()
    }

    /// Renews the owner's lease to `expires_unix_ms`, a time the caller chose (Core reads no clock),
    /// and returns the root commit, whose `directories` says whether the directory entries are
    /// confirmed durable.
    ///
    /// The expiry must move strictly forward (`Migration(InvalidLeaseRenewal)`); a lease long past its
    /// expiry is still renewed while nobody has taken over, because a takeover advances the fence and
    /// the committed manifest then names another owner. The renewal is committed by
    /// [`commit_lease_renewal_held`] under the root event the admission hands out, so a snapshot that
    /// went stale is refused before any write. See the module documentation for what a failed step
    /// leaves behind.
    pub fn renew_lease<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        expires_unix_ms: u64,
    ) -> Result<RootCommitted, ConversionError> {
        if self.spent {
            return Err(ConversionError::Spent);
        }
        self.check_admitted()?;
        let renewed = renewed_lease(&self.journal.manifest, &self.fence(), expires_unix_ms)
            .map_err(ConversionError::Migration)?;
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let layout = RootLayout {
            root_dir: &self.root,
        };
        let journal = JournalSource {
            dir: &self.journal_pin.canonical,
            operation: &operation,
        };
        let fence = MigrationFence::from_manifest(&renewed);
        let step = JournalCheckpoint {
            manifest: &renewed,
            fence: &fence,
            journal,
            root_key_ref: &self.journal.root_key_ref,
            active_key_epoch: self.journal.active_key_epoch,
            conflict: CandidateConflict::Quarantine,
        };
        let (committed, read_back) = {
            let event = self
                .held
                .try_root_commit()
                .map_err(ConversionError::Admission)?
                .ok_or(ConversionError::RootBusy)?;
            let root = event.root_guard().map_err(ConversionError::Admission)?;
            let committed = commit_lease_renewal_held(fs, provider, layout, step, root);
            // Whatever the commit reported, read the root back while the event is still held: no other
            // root commit comes between, and the root says whether the step committed.
            (
                committed,
                read_committed_journal(fs, &*provider, layout, journal),
            )
        };
        let committed = self.settle(&renewed, committed, read_back)?;
        self.check_admitted()?;
        Ok(committed)
    }

    /// Settles what a step did from what the commit reported and what the root names afterwards.
    fn settle(
        &mut self,
        step: &JournalManifest,
        committed: Result<RootCommitted, AuthorityError>,
        read_back: Result<CommittedJournal, AuthorityError>,
    ) -> Result<RootCommitted, ConversionError> {
        match (committed, read_back) {
            (Ok(commit), Ok(journal)) if journal.manifest == *step => {
                self.journal = journal;
                Ok(commit)
            }
            (Ok(_), Ok(_)) => self.spend(ConversionError::Superseded),
            (Ok(_), Err(error)) => self.spend(ConversionError::Unreadable(error)),
            (Err(error), Ok(journal)) if journal.manifest == *step => {
                self.journal = journal;
                Err(ConversionError::Committed(error))
            }
            (Err(error), Ok(_)) => Err(ConversionError::Authority(error)),
            (Err(error), Err(_)) => self.spend(ConversionError::Unsettled(error)),
        }
    }

    fn spend(&mut self, error: ConversionError) -> Result<RootCommitted, ConversionError> {
        self.spent = true;
        Err(error)
    }

    fn check_admitted(&self) -> Result<(), ConversionError> {
        ensure_admitted(self.held, canonical(&self.installation, &self.root))?;
        if self.journal_pin.is_current() {
            Ok(())
        } else {
            Err(ConversionError::NotAdmitted)
        }
    }
}
