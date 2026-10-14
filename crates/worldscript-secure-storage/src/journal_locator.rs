//! Gate 4E slice L1: the writer journal locator (§10.3, owner-approved E2 direction).
//!
//! The content of the journal is authenticated against the committed root
//! ([`read_committed_journal`](crate::authority)): the root-named generation, its digest, the binding's
//! operation and fence, and the key route through the registry. Where the journal lives was a per-call
//! input. A [`JournalLocator`] makes the place explicit, immutable and scope-bound, so an ordinary
//! operation can ask where the journal is without trusting its caller.
//!
//! A locator is configuration, not a record: the installation scope it was made for and one directory
//! name of a fixed grammar. It carries no path and no search order. [`authenticate_journal`] resolves it
//! under a root event of either admission mode:
//!
//! 1. the event's admission still guards the installation and the root;
//! 2. the scope of the locator is the scope of the anchor, before any journal byte is read;
//! 3. the location is `<installation>/<name>`: a real directory (not a symlink), strictly below the
//!    admitted installation and outside the authority root, pinned and still the same directory after
//!    the reads;
//! 4. the committed root, its binding, the root-named manifest and the journal key route are
//!    authenticated through the existing keyless read.
//!
//! A missing, misplaced, replaced or contradicting location is a typed refusal that writes nothing and
//! reads no other directory: the journal is never searched for. The result is an [`AuthenticatedJournal`]
//! that borrows the root event, so it cannot outlive the admission: it is a snapshot for one operation,
//! never a cache, and later writes repeat their own authority checks.
//!
//! ```compile_fail
//! use worldscript_secure_storage::{
//!     authenticate_journal, JournalLocator, JournalLookup, KeyProvider, SharedAdmissionGuard,
//!     StdFs, WriteOperationId,
//! };
//!
//! fn proof_outlives_the_event<P: KeyProvider>(
//!     admission: &mut SharedAdmissionGuard,
//!     provider: &P,
//!     locator: &JournalLocator,
//!     operation: &WriteOperationId,
//! ) {
//!     let event = admission.try_root_commit().unwrap().unwrap();
//!     let lookup = JournalLookup { locator, operation };
//!     let proof = authenticate_journal(&mut StdFs, provider, &event, lookup).unwrap();
//!     drop(event);
//!     let _ = proof.manifest();
//! }
//! ```

use std::io;
use std::marker::PhantomData;
use std::path::Path;

use crate::admission::{AdmissionError, AdmittedRootCommitGuard};
use crate::authority::{read_committed_journal, AuthorityError, CommittedJournal, JournalSource};
use crate::durable::{DurableFs, WriteOperationId};
use crate::journal::JournalManifest;
use crate::placement::{PinnedDirectory, PlacementError};
use crate::provider::{InstallationScopeId, KeyProvider, RootKeyRefV1};
use crate::root::LiveMigration;
use crate::root_store::{anchored_installation_scope, RootLayout, RootStoreError};

/// The longest directory name a locator accepts.
const MAX_NAME_LEN: usize = 64;

/// Where an installation's writer journal lives: explicit, immutable and bound to one installation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JournalLocator {
    scope: InstallationScopeId,
    name: String,
}

impl JournalLocator {
    /// A locator for the journal directory `name` directly below the installation of `scope`.
    ///
    /// `name` is one path component of lowercase ASCII letters, digits and `-`, starting with a
    /// letter or digit and at most 64 bytes long. Anything else is refused: a locator never holds a
    /// separator, a dot segment or an absolute path.
    pub fn new(scope: InstallationScopeId, name: &str) -> Result<Self, LocatorError> {
        if !is_valid_name(name) {
            return Err(LocatorError::InvalidName);
        }
        Ok(Self {
            scope,
            name: name.to_owned(),
        })
    }

    /// The installation this locator was made for.
    pub fn scope(&self) -> &InstallationScopeId {
        &self.scope
    }

    /// The journal directory name below the installation.
    pub fn name(&self) -> &str {
        &self.name
    }
}

fn is_label_char(byte: u8) -> bool {
    matches!(byte, b'a'..=b'z' | b'0'..=b'9')
}

fn is_valid_name(name: &str) -> bool {
    if name.len() > MAX_NAME_LEN {
        return false;
    }
    let mut bytes = name.bytes();
    match bytes.next() {
        Some(first) if is_label_char(first) => bytes.all(|b| is_label_char(b) || b == b'-'),
        _ => false,
    }
}

/// Why the location of the journal is unusable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocationFault {
    /// Nothing exists at the located name.
    Missing,
    /// The located name is not a directory.
    NotADirectory,
    /// The located name is a symlink; a locator names a real directory.
    Symlink,
    /// The directory is not strictly below the installation, or lies inside the authority root.
    Misplaced,
    /// The directory could not be inspected.
    Io(io::ErrorKind),
}

/// Why a locator did not authenticate a journal. Every variant refuses before any mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocatorError {
    /// The name is not a single path component of the accepted grammar.
    InvalidName,
    /// The event's admission no longer guards the installation and the root.
    Admission(AdmissionError),
    /// The anchor could not be read (a locked provider, a pending preparation, a damaged anchor).
    Root(RootStoreError),
    /// No root has been committed yet, so nothing can be bound.
    NoCommittedRoot,
    /// The locator was made for another installation than the one the anchor names.
    ScopeMismatch,
    /// The located directory is unusable; no other directory is read instead.
    Location(LocationFault),
    /// The committed root, its binding or the journal it names did not authenticate.
    Authority(AuthorityError),
    /// The located directory is no longer the one that was pinned.
    Changed,
}

/// The journal the committed root vouches for, found through a [`JournalLocator`].
///
/// It borrows the root event it was authenticated under and is not `Clone`, so it ends with the
/// admission. It authenticates the state at the moment of the read; it is no lease on it.
#[derive(Debug)]
pub struct AuthenticatedJournal<'e> {
    journal: CommittedJournal,
    pin: PinnedDirectory,
    event: PhantomData<&'e ()>,
}

impl AuthenticatedJournal<'_> {
    /// The live-migration binding of the committed root.
    pub fn binding(&self) -> &LiveMigration {
        &self.journal.live
    }

    /// The manifest the binding names, authenticated against the binding's digest.
    pub fn manifest(&self) -> &JournalManifest {
        &self.journal.manifest
    }

    /// The key route the committed root itself carries.
    pub fn root_key_ref(&self) -> &RootKeyRefV1 {
        &self.journal.root_key_ref
    }

    /// The active key epoch the committed root itself carries.
    pub fn active_key_epoch(&self) -> u64 {
        self.journal.active_key_epoch
    }

    /// The canonical journal directory that was authenticated.
    pub fn directory(&self) -> &Path {
        &self.pin.canonical
    }

    /// Whether the journal directory is still the one that was authenticated.
    pub fn is_current(&self) -> bool {
        self.pin.is_current()
    }
}

/// What an ordinary operation asks for: the journal of its installation, found through `locator`, read
/// on behalf of the write operation `operation`.
#[derive(Debug, Clone, Copy)]
pub struct JournalLookup<'a> {
    pub locator: &'a JournalLocator,
    pub operation: &'a WriteOperationId,
}

/// Authenticates the journal the committed root binds, found through `lookup.locator`, under a root
/// event of either admission mode (module docs). Reads only; nothing is written and no other directory
/// is read.
pub fn authenticate_journal<'e, F: DurableFs, P: KeyProvider, Mode>(
    fs: &mut F,
    provider: &P,
    event: &'e AdmittedRootCommitGuard<'_, Mode>,
    lookup: JournalLookup<'_>,
) -> Result<AuthenticatedJournal<'e>, LocatorError> {
    let JournalLookup { locator, operation } = lookup;
    event.root_guard().map_err(LocatorError::Admission)?;
    let (installation, root) = event.admitted_dirs().map_err(LocatorError::Admission)?;
    let scope = anchored_installation_scope(provider)
        .map_err(LocatorError::Root)?
        .ok_or(LocatorError::NoCommittedRoot)?;
    if scope != locator.scope {
        return Err(LocatorError::ScopeMismatch);
    }
    let located = installation.join(&locator.name);
    check_real_directory(&located)?;
    let pin = PinnedDirectory::placed_exact(installation, root, locator.name())
        .map_err(location_fault)?;
    let layout = RootLayout { root_dir: root };
    let source = JournalSource {
        dir: &pin.canonical,
        operation,
    };
    let journal =
        read_committed_journal(fs, provider, layout, source).map_err(LocatorError::Authority)?;
    // The admission and the directory must still be the ones admitted after the reads.
    event.admitted_dirs().map_err(LocatorError::Admission)?;
    if !pin.is_current() {
        return Err(LocatorError::Changed);
    }
    Ok(AuthenticatedJournal {
        journal,
        pin,
        event: PhantomData,
    })
}

/// The located name must exist and be a directory itself, not a link to one.
fn check_real_directory(located: &Path) -> Result<(), LocatorError> {
    match std::fs::symlink_metadata(located) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(LocatorError::Location(LocationFault::Symlink))
        }
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(LocatorError::Location(LocationFault::NotADirectory)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err(LocatorError::Location(LocationFault::Missing))
        }
        Err(error) => Err(LocatorError::Location(LocationFault::Io(error.kind()))),
    }
}

fn location_fault(error: PlacementError) -> LocatorError {
    match error {
        PlacementError::Io(kind) => LocatorError::Location(LocationFault::Io(kind)),
        PlacementError::Misplaced => LocatorError::Location(LocationFault::Misplaced),
        PlacementError::Changed => LocatorError::Changed,
    }
}
