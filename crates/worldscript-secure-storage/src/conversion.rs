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
//! This slice writes nothing and holds no key; the steps that move the journal are the next slice.

use crate::admission::{AdmissionScope, ExclusiveAdmissionGuard};
use crate::authority::{read_committed_journal, AuthorityError, CommittedJournal, JournalSource};
use crate::durable::DurableFs;
use crate::journal::{phase_code, JournalManifest, MigrationFence};
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

/// Why the gate refused. Every refusal is returned before anything is written.
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

impl ConversionSession<'_> {
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
}
