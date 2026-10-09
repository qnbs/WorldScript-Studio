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
//! fenced journal-owner operations, one step at a time ([`ConversionSession::renew_lease`],
//! [`ConversionSession::enter_convert`] and the cursor checkpoint of the iteration, which share one
//! private step). A step checks the admission and the journal directory, builds the successor from the
//! session's own snapshot, takes the root event through the held admission (so the identity check and
//! the root lock are coupled), commits with the key route and active epoch the committed root itself
//! names, reads the committed journal back under that same root event and checks the admission again.
//!
//! The pages the conversion walks are read through the session too, keylessly: [`ConversionSession::verify_inventory`]
//! authenticates the whole page set once against the committed root, and [`ConversionSession::page`] reads
//! one authenticated page. The checkpoint cursor is page-local: `cursor_entry_index` is the index, from
//! zero, within page `cursor_page_index` of the next entry to process, so a checkpoint needs the verified
//! set and refuses an index outside the selected page. Only the iteration moves the cursor: production
//! code has no way to write a cursor the session did not itself reach by converting, which keeps a
//! persisted cursor what the next session takes it for, the record of the entries a session converted.
//!
//! The conversion itself is a loop the caller drives, one bounded unit at a time:
//! [`ConversionSession::convert_next`] converts up to a batch of entries of the page the cursor points
//! into through a caller-supplied, idempotent [`EntryStep`], records the new cursor and says whether more
//! remain; between calls the caller renews the lease with its own clock (Core reads none):
//!
//! ```text
//! session.verify_inventory(..)?; session.enter_convert(..)?;
//! while session.convert_next(.., batch)? == Progress::More {
//!     if lease_is_short(now()) { session.renew_lease(.., now() + EXTENSION)?; }
//! }
//! session.finish_convert(..)?; // CONVERT -> VERIFY
//! ```
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
//! begins again to learn the state. After the commit call every outcome is followed by the admission
//! check, and a lost admission is reported first: the step may have committed or left a candidate, and
//! the caller begins again to learn the state.

use std::fs::File;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};

use crate::admission::{AdmissionError, AdmissionScope, ExclusiveAdmissionGuard};
use crate::authority::{
    commit_journal_checkpoint_held, commit_lease_renewal_held, load_committed_page,
    read_committed_journal, verify_committed_inventory, AuthorityError, CommittedJournal,
    JournalCheckpoint, JournalSource,
};
use crate::durable::{DurableFs, WriteOperationId};
use crate::error::SealError;
use crate::journal::{
    checkpoint_progress, phase_code, renewed_lease, transition_phase, CandidateConflict,
    JournalCheckpointCursor, JournalError, JournalInventoryEntry, JournalManifest, JournalPage,
    MigrationExecutionError, MigrationFence, MigrationPhase, VerifiedInventory,
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
    /// A step's successor is not a valid one (a renewal with no lease to renew, an expiry that does not
    /// move strictly forward, a cursor that regresses or lies outside the inventory).
    Migration(MigrationExecutionError),
    /// The step belongs to another phase: the cursor moves in `CONVERT` only.
    WrongPhase,
    /// The inventory pages were not authenticated yet: [`ConversionSession::verify_inventory`] first.
    InventoryNotVerified,
    /// The cursor was moved by hand (`advance_cursor`, with the test-only feature), so this session no longer
    /// proves that it walked the inventory from its start: begin again.
    CursorMoved,
    /// This session has not seen the end of the last page: [`ConversionSession::convert_next`] has not
    /// returned [`Progress::Done`], so leaving `CONVERT` could skip entries.
    NotConverted,
    /// No write-operation identifier could be drawn from the operating system.
    OperationId(SealError),
    /// The committed journal is not the one this session holds (a step's read-back named another
    /// journal, or another owner advanced it since): the session is spent, begin again.
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

/// The conversion of one inventory entry, supplied by the caller (real record conversion is Gate 5).
///
/// It must be idempotent: after a crash, a failed checkpoint or a step failure the same entry can be
/// handed to it again, so it may never rely on running exactly once.
///
/// `fence` is the owner's token at the revision the session holds. A step that mutates anything must
/// carry it into the mutation (the adapter's fenced operation compares it under the cross-process lock
/// and refuses a stale owner, §10.1): the session confirms its snapshot against the committed root just
/// before it hands out a batch, which narrows the window in which an owner that was taken over could
/// still be called, but only the fenced mutation closes it.
pub trait EntryStep {
    /// What a failed conversion reports.
    type Error;

    /// Converts `entry`.
    fn convert(
        &mut self,
        entry: &JournalInventoryEntry,
        fence: &MigrationFence,
    ) -> Result<(), Self::Error>;
}

/// What one [`ConversionSession::convert_next`] call converts and with which step.
pub struct ConvertBatch<'a, S: EntryStep> {
    pub step: &'a mut S,
    /// The most entries to convert before the cursor is recorded: `1` checkpoints after every entry.
    pub entries: NonZeroU32,
}

/// Whether [`ConversionSession::convert_next`] left entries to convert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Progress {
    More,
    /// The end of the last page was reached; [`ConversionSession::finish_convert`] may follow.
    Done,
}

/// Why a [`ConversionSession::convert_next`] call stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConvertError<E> {
    /// The session refused or failed to record the cursor.
    Session(ConversionError),
    /// The step failed; nothing was written for this batch.
    Step(E),
}

impl<E> From<ConversionError> for ConvertError<E> {
    fn from(error: ConversionError) -> Self {
        Self::Session(error)
    }
}

/// Which journal-owner operation commits a step's successor: the lease renewal and the ordinary
/// checkpoint are different operations over the same root event.
#[derive(Debug, Clone, Copy)]
enum StepKind {
    Renewal,
    Checkpoint,
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
    /// The page set authenticated by [`ConversionSession::verify_inventory`]; it is immutable once
    /// captured, so it stays valid for the snapshot it was verified against.
    inventory: Option<VerifiedInventory>,
    /// Whether [`ConversionSession::convert_next`] returned [`Progress::Done`] in this session.
    converted_all: bool,
    /// Whether the cursor was moved by hand (`advance_cursor`, test-only) rather than by the
    /// iteration: the session then no longer proves that it walked the inventory from its start.
    cursor_moved: bool,
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
        inventory: None,
        converted_all: false,
        cursor_moved: false,
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

/// Whether two manifests name the same captured inventory.
fn same_inventory(left: &JournalManifest, right: &JournalManifest) -> bool {
    left.inventory_version == right.inventory_version
        && left.page_count == right.page_count
        && left.entry_count == right.entry_count
        && left.inventory_digest == right.inventory_digest
        && left.journal_page_set_digest == right.journal_page_set_digest
}

/// The cursor after converting entries up to `end` of page `page` (which has `len` entries) and whether
/// that was the end of the last page: `(page, end)` inside a page, `(page + 1, 0)` at a page end, and the
/// last entry itself at the end of the last page.
fn cursor_after(page: u32, end: usize, len: usize, page_count: u32) -> ((u32, u32), bool) {
    if end < len {
        return ((page, end as u32), false);
    }
    if page + 1 < page_count {
        return ((page + 1, 0), false);
    }
    ((page, (len - 1) as u32), true)
}

fn page_refusal(error: JournalError) -> ConversionError {
    ConversionError::Migration(MigrationExecutionError::Journal(error))
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
    /// the committed manifest then names another owner. See the module documentation for what a step
    /// leaves behind.
    pub fn renew_lease<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        expires_unix_ms: u64,
    ) -> Result<RootCommitted, ConversionError> {
        self.step(fs, provider, StepKind::Renewal, |manifest, fence| {
            renewed_lease(manifest, fence, expires_unix_ms).map_err(ConversionError::Migration)
        })
    }

    /// Enters `CONVERT` from `ADMIT`, at cursor `(0, 0)` (§10.3), and returns the root commit. A
    /// session that already is in `CONVERT` (a resumed conversion) has nothing to do: nothing is
    /// written and `None` is returned.
    pub fn enter_convert<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
    ) -> Result<Option<RootCommitted>, ConversionError> {
        self.ready()?;
        if self.journal.manifest.phase == phase_code::CONVERT {
            // Nothing to write, but the answer must not rest on a snapshot another owner has overtaken.
            self.confirm_snapshot(fs, provider)?;
            return Ok(None);
        }
        let convert = MigrationPhase::from_wire(phase_code::CONVERT);
        self.step(fs, provider, StepKind::Checkpoint, |manifest, fence| {
            transition_phase(manifest, fence, convert).map_err(ConversionError::Migration)
        })
        .map(Some)
    }

    /// Authenticates the whole page set the committed root names and keeps its references, which the
    /// cursor and the page reads are checked against. The pages are read once, one at a time (only the
    /// references are kept), and the set must be the inventory the session's snapshot names; otherwise
    /// the session is spent (`Superseded`). A read failure writes nothing and does not spend the
    /// session: the call may be repeated.
    pub fn verify_inventory<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &P,
    ) -> Result<(), ConversionError> {
        self.ready()?;
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let layout = RootLayout {
            root_dir: &self.root,
        };
        let journal = JournalSource {
            dir: &self.journal_pin.canonical,
            operation: &operation,
        };
        let read = verify_committed_inventory(fs, provider, layout, journal);
        // A lost admission is reported first, whether or not the read succeeded.
        self.check_admitted()?;
        let verified = read?;
        if !same_inventory(verified.manifest(), &self.journal.manifest) {
            self.spent = true;
            return Err(ConversionError::Superseded);
        }
        self.inventory = Some(verified);
        Ok(())
    }

    /// The page set [`ConversionSession::verify_inventory`] authenticated: the manifest it was verified
    /// against and the authenticated reference of every page, if it was verified.
    pub fn inventory(&self) -> Option<&VerifiedInventory> {
        self.inventory.as_ref()
    }

    /// Reads page `page_index` of the verified inventory by the exact path of its authenticated
    /// reference; the envelope must hash to the reference before it is opened. Needs
    /// [`ConversionSession::verify_inventory`] first (`InventoryNotVerified`); nothing is written.
    pub fn page<F: DurableFs, P: KeyProvider>(
        &self,
        fs: &mut F,
        provider: &P,
        page_index: u32,
    ) -> Result<JournalPage, ConversionError> {
        self.ready()?;
        let verified = self
            .inventory
            .as_ref()
            .ok_or(ConversionError::InventoryNotVerified)?;
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let layout = RootLayout {
            root_dir: &self.root,
        };
        let journal = JournalSource {
            dir: &self.journal_pin.canonical,
            operation: &operation,
        };
        let read = load_committed_page(fs, provider, layout, journal, verified, page_index);
        // A lost admission is reported first, whether or not the read succeeded.
        self.check_admitted()?;
        Ok(read?)
    }

    /// Test support (the `test-support` feature, which production never enables): records durable
    /// progress in `CONVERT` by moving the checkpoint cursor to `cursor`, wherever the caller says, and
    /// returns the root commit. Production code cannot do this, because a cursor written by hand would
    /// be taken for converted entries by every later session; it moves the cursor only through the
    /// iteration.
    ///
    /// The cursor The cursor is page-local: `cursor.entry_index` is the index, from zero, within page
    /// `cursor.page_index` of the next entry to process. It never moves backwards and stays inside the
    /// manifest's extent and inside the selected page, whose entry count is the authenticated
    /// reference's (`Migration(RegressiveCheckpoint)` and the extent refusals, before any write); an
    /// equal cursor is accepted and records a revision with the same cursor. The end of the last page
    /// has no cursor value: completion is the transition to `VERIFY`. In any other phase the step is
    /// `WrongPhase`, and without [`ConversionSession::verify_inventory`] it is `InventoryNotVerified`.
    /// Moving the cursor by hand forfeits the exit in this session (`convert_next` is then `CursorMoved`
    /// and `finish_convert` `NotConverted`).
    #[cfg(feature = "test-support")]
    pub fn advance_cursor<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        cursor: JournalCheckpointCursor,
    ) -> Result<RootCommitted, ConversionError> {
        let result = self.checkpoint_cursor(fs, provider, cursor);
        // A cursor moved by hand, whatever came of it unless it was refused before any write, takes
        // away the proof that this session walked the inventory from its start.
        let reached_a_write = matches!(
            result,
            Ok(_)
                | Err(ConversionError::Committed(_)
                    | ConversionError::Unreadable(_)
                    | ConversionError::Superseded
                    | ConversionError::Unsettled(_)
                    | ConversionError::Authority(_))
        );
        if reached_a_write {
            self.cursor_moved = true;
            self.converted_all = false;
        }
        result
    }

    /// The cursor step of the iteration (and of the test-only `advance_cursor`).
    fn checkpoint_cursor<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        cursor: JournalCheckpointCursor,
    ) -> Result<RootCommitted, ConversionError> {
        self.ready()?;
        if self.journal.manifest.phase != phase_code::CONVERT {
            return Err(ConversionError::WrongPhase);
        }
        let verified = self
            .inventory
            .as_ref()
            .ok_or(ConversionError::InventoryNotVerified)?;
        let in_page = usize::try_from(cursor.page_index)
            .ok()
            .and_then(|index| verified.page_refs().get(index))
            .map(|reference| reference.page_entry_count);
        self.step(fs, provider, StepKind::Checkpoint, |manifest, fence| {
            let next =
                checkpoint_progress(manifest, fence, cursor).map_err(ConversionError::Migration)?;
            match in_page {
                Some(entries) if cursor.entry_index < entries => Ok(next),
                Some(_) => Err(page_refusal(JournalError::EntryCountMismatch)),
                None => Err(page_refusal(JournalError::InvalidPageIndex)),
            }
        })
    }

    /// Converts up to `batch.entries` entries of the page the cursor points into with `batch.step`,
    /// records the new cursor and says whether entries remain. A batch never crosses a page boundary.
    ///
    /// The cursor after a batch is the next entry to process: `(page, next)`, or `(page + 1, 0)` at a
    /// page end, or, at the end of the last page, that last entry itself (the cursor cannot point past
    /// the end), which is then converted again if the session is lost before [`ConversionSession::finish_convert`].
    /// A step failure writes nothing and the batch is converted again from the same cursor; a failed
    /// checkpoint after the steps leaves the batch to be converted again on retry or resume, which is
    /// why the step must be idempotent. Needs `CONVERT` (`WrongPhase`) and the verified inventory
    /// (`InventoryNotVerified`); an empty inventory, and a session that has seen the end, are `Done`.
    pub fn convert_next<F, P, S>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        batch: ConvertBatch<'_, S>,
    ) -> Result<Progress, ConvertError<S::Error>>
    where
        F: DurableFs,
        P: KeyProvider,
        S: EntryStep,
    {
        self.ready()?;
        if self.journal.manifest.phase != phase_code::CONVERT {
            return Err(ConversionError::WrongPhase.into());
        }
        let page_count = self
            .inventory
            .as_ref()
            .ok_or(ConversionError::InventoryNotVerified)?
            .manifest()
            .page_count;
        if self.cursor_moved {
            return Err(ConversionError::CursorMoved.into());
        }
        if self.converted_all || page_count == 0 {
            self.converted_all = true;
            return Ok(Progress::Done);
        }
        let at = (
            self.journal.manifest.cursor_page_index,
            self.journal.manifest.cursor_entry_index,
        );
        let page = self.page(fs, &*provider, at.0)?;
        let entries = page.entries();
        let start = at.1 as usize;
        // A persisted cursor that passed the manifest-wide check can still lie outside its page: refuse
        // the state instead of slicing past the page.
        if start >= entries.len() {
            return Err(page_refusal(JournalError::EntryCountMismatch).into());
        }
        let end = entries
            .len()
            .min(start.saturating_add(batch.entries.get() as usize));
        // No entry is handed out for a snapshot that another owner has overtaken.
        self.confirm_snapshot(fs, &*provider)?;
        let fence = self.fence();
        for entry in &entries[start..end] {
            batch
                .step
                .convert(entry, &fence)
                .map_err(ConvertError::Step)?;
        }
        let (next, done) = cursor_after(at.0, end, entries.len(), page_count);
        if next != at {
            let cursor = JournalCheckpointCursor::new(next.0, next.1);
            self.checkpoint_cursor(fs, provider, cursor)?;
        }
        self.converted_all = done;
        Ok(if done { Progress::Done } else { Progress::More })
    }

    /// Leaves `CONVERT` for `VERIFY` (the cursor goes back to `(0, 0)`) and returns the root commit. The
    /// session must have seen the end of the last page (`NotConverted` otherwise), so that no entry can be
    /// skipped; in any other phase the step is `WrongPhase`.
    pub fn finish_convert<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
    ) -> Result<RootCommitted, ConversionError> {
        self.ready()?;
        if self.journal.manifest.phase != phase_code::CONVERT {
            return Err(ConversionError::WrongPhase);
        }
        if !self.converted_all {
            return Err(ConversionError::NotConverted);
        }
        let verify = MigrationPhase::from_wire(phase_code::VERIFY);
        self.step(fs, provider, StepKind::Checkpoint, |manifest, fence| {
            transition_phase(manifest, fence, verify).map_err(ConversionError::Migration)
        })
    }

    /// Requires the committed journal to be the one the session holds. If it is not (another owner
    /// advanced it), the session is spent; if it cannot be read, nothing was written and the step may
    /// be tried again.
    fn confirm_snapshot<F: DurableFs, P: KeyProvider>(
        &mut self,
        fs: &mut F,
        provider: &P,
    ) -> Result<(), ConversionError> {
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let layout = RootLayout {
            root_dir: &self.root,
        };
        let journal = JournalSource {
            dir: &self.journal_pin.canonical,
            operation: &operation,
        };
        match read_committed_journal(fs, provider, layout, journal) {
            Ok(current) if current.manifest == self.journal.manifest => self.check_admitted(),
            Ok(_) => {
                self.spent = true;
                Err(ConversionError::Superseded)
            }
            Err(error) => Err(ConversionError::Authority(error)),
        }
    }

    /// Whether the session may take a step: not spent, and the admission and the pinned journal
    /// directory still hold.
    fn ready(&self) -> Result<(), ConversionError> {
        if self.spent {
            return Err(ConversionError::Spent);
        }
        self.check_admitted()
    }

    /// The step shared by the public methods: `build` makes the successor from the session's snapshot
    /// and `kind` says which journal-owner operation commits it. See the module documentation.
    fn step<F, P, B>(
        &mut self,
        fs: &mut F,
        provider: &mut P,
        kind: StepKind,
        build: B,
    ) -> Result<RootCommitted, ConversionError>
    where
        F: DurableFs,
        P: KeyProvider,
        B: FnOnce(&JournalManifest, &MigrationFence) -> Result<JournalManifest, ConversionError>,
    {
        self.ready()?;
        let successor = build(&self.journal.manifest, &self.fence())?;
        let operation = WriteOperationId::generate().map_err(ConversionError::OperationId)?;
        let layout = RootLayout {
            root_dir: &self.root,
        };
        let journal = JournalSource {
            dir: &self.journal_pin.canonical,
            operation: &operation,
        };
        let fence = MigrationFence::from_manifest(&successor);
        let step = JournalCheckpoint {
            manifest: &successor,
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
            let committed = match kind {
                StepKind::Renewal => commit_lease_renewal_held(fs, provider, layout, step, root),
                StepKind::Checkpoint => {
                    commit_journal_checkpoint_held(fs, provider, layout, step, root)
                }
            };
            // Whatever the commit reported, read the root back while the event is still held: no other
            // root commit comes between, and the root says whether the step committed.
            (
                committed,
                read_committed_journal(fs, &*provider, layout, journal),
            )
        };
        let settled = self.settle(&successor, committed, read_back);
        // Every outcome of the commit call is followed by the admission check, and a lost admission is
        // reported first: the step may have committed or left a candidate, whatever it reported.
        self.check_admitted()?;
        settled
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
