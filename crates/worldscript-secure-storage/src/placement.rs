//! A directory the admission confines: held open, strictly below the admitted installation and
//! outside the authority root.
//!
//! The exclusive conversion gate and the writer journal locator both place the journal directory
//! this way. The pin is taken before the path is canonicalised, as the admission does, so a path
//! that is swapped for another directory afterwards no longer names the pinned one and is seen by
//! [`PinnedDirectory::is_current`].

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use crate::root_lock::sys;

/// Why a directory could not be placed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlacementError {
    /// The directory could not be opened or resolved.
    Io(io::ErrorKind),
    /// It is not strictly below the installation, or it lies inside the authority root.
    Misplaced,
    /// Its path no longer names the directory that was opened.
    Changed,
}

/// A directory held open, so that a later look can tell whether its path still names it.
#[derive(Debug)]
pub(crate) struct PinnedDirectory {
    pin: File,
    pub(crate) canonical: PathBuf,
}

impl PinnedDirectory {
    /// Pins `dir` and requires it to lie strictly below the canonical installation directory and
    /// outside the canonical authority root.
    pub(crate) fn placed(
        installation: &Path,
        root: &Path,
        dir: &Path,
    ) -> Result<Self, PlacementError> {
        let pin = sys::open_directory(dir).map_err(|error| PlacementError::Io(error.kind()))?;
        let canonical =
            std::fs::canonicalize(dir).map_err(|error| PlacementError::Io(error.kind()))?;
        let below = canonical != installation && canonical.starts_with(installation);
        if !below || canonical.starts_with(root) {
            return Err(PlacementError::Misplaced);
        }
        let pinned = Self { pin, canonical };
        if pinned.is_current() {
            Ok(pinned)
        } else {
            Err(PlacementError::Changed)
        }
    }

    /// Whether the path still names the directory that was pinned.
    pub(crate) fn is_current(&self) -> bool {
        sys::still_named(&self.pin, &self.canonical).unwrap_or(false)
    }
}
