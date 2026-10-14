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
    /// Whether the final component is the entry itself (no symlink is followed), not what it leads to.
    exact: bool,
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
        Self {
            pin,
            canonical,
            exact: false,
        }
        .confined(installation, root)
    }

    /// Pins the directory `name` directly below the canonical installation, without following a
    /// symlink at that entry, and requires it to lie outside the canonical authority root. The entry
    /// is opened and judged as itself, so an entry that becomes a symlink is refused rather than
    /// followed, and a symlink put in its place never counts as the pinned directory.
    pub(crate) fn placed_exact(
        installation: &Path,
        root: &Path,
        name: &str,
    ) -> Result<Self, PlacementError> {
        let located = installation.join(name);
        let pin = sys::open_directory_exact(&located)
            .map_err(|error| PlacementError::Io(error.kind()))?;
        Self {
            pin,
            canonical: located,
            exact: true,
        }
        .confined(installation, root)
    }

    /// Requires the pinned directory to lie strictly below the installation and not to be the
    /// authority root. The root is excluded by the path and by identity: on a case-insensitive file
    /// system another spelling of the root's name opens the root itself.
    fn confined(self, installation: &Path, root: &Path) -> Result<Self, PlacementError> {
        let below = self.canonical != installation && self.canonical.starts_with(installation);
        if !below || self.canonical.starts_with(root) || self.is_the_root(root) {
            return Err(PlacementError::Misplaced);
        }
        if self.is_current() {
            Ok(self)
        } else {
            Err(PlacementError::Changed)
        }
    }

    /// Whether the pinned directory is the authority root. An identity that cannot be read counts as
    /// the root, so the placement fails closed.
    fn is_the_root(&self, root: &Path) -> bool {
        sys::still_named(&self.pin, root).unwrap_or(true)
    }

    /// Whether the path still names the directory that was pinned.
    pub(crate) fn is_current(&self) -> bool {
        let named = if self.exact {
            sys::still_named_exact(&self.pin, &self.canonical)
        } else {
            sys::still_named(&self.pin, &self.canonical)
        };
        named.unwrap_or(false)
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn an_exact_placement_refuses_a_symlink_entry_and_the_root() {
        let installation =
            std::env::temp_dir().join(format!("wss-placement-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&installation);
        let root = installation.join("authority");
        let real = installation.join("real");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, installation.join("link")).unwrap();
        let installation_dir = std::fs::canonicalize(&installation).unwrap();
        let root_dir = std::fs::canonicalize(&root).unwrap();

        let placed = PinnedDirectory::placed_exact(&installation_dir, &root_dir, "real").unwrap();
        assert!(placed.is_current());
        assert!(matches!(
            PinnedDirectory::placed_exact(&installation_dir, &root_dir, "link"),
            Err(PlacementError::Io(_))
        ));
        assert!(matches!(
            PinnedDirectory::placed_exact(&installation_dir, &root_dir, "authority"),
            Err(PlacementError::Misplaced)
        ));
        // A spelling the path check does not recognise (the case-insensitive alias of the root's name)
        // is still the root by identity.
        let alias_of_the_root = PinnedDirectory {
            pin: sys::open_directory_exact(&root_dir).unwrap(),
            canonical: installation_dir.join("Authority-alias"),
            exact: true,
        };
        assert!(matches!(
            alias_of_the_root.confined(&installation_dir, &root_dir),
            Err(PlacementError::Misplaced)
        ));
        // A followed placement accepts the link: the exact one is the stricter of the two.
        assert!(
            PinnedDirectory::placed(&installation_dir, &root_dir, &installation.join("link"))
                .is_ok()
        );
        std::fs::remove_dir_all(&installation).unwrap();
    }
}
