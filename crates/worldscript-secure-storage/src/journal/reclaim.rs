//! Gate 4 slice R1: reclaiming abandoned inventory staging (§10.1.1).
//!
//! A streaming capture stages its pages in a private pending directory before the page-set digest, which
//! names their final place, is known:
//!
//! ```text
//! <journal-dir>/inventory/pending-<revision>-<random>/page-<i>/generation-<g>.wsr1
//! ```
//!
//! A capture that was killed, or finished and dropped without `discard`, leaves its files there, and every
//! attempt leaves empty `page-<i>` directories. None of it is authority, a manifest never names it and
//! nothing reads it. [`reclaim_with_binding`] removes exactly what it can prove dead and preserves
//! everything else:
//!
//! * A pending directory of revision `rev <= R` (`R` the committed revision) is dead: a promotion needs
//!   `rev == R + 1`, and `R` only grows. Revision `R + 1` and above is never swept: a live attempt, a retry
//!   candidate or a prepared root may own it. The proof is the name and `R`, so the sweep needs no clock
//!   and a caller that is behind the journal sees a smaller `R` and removes less. Revision zero is never
//!   a capture and is not recognised.
//! * Every file in it must open under the journal key as this operation's page at its index, at the
//!   directory's revision, with the operation's journal envelope epoch (staging links
//!   `generation-<g>.wsr1.tmp-<op>-<g>` of the attempt included). A directory is validated completely
//!   before its first removal; one entry outside the grammar, one that does not authenticate or one that
//!   is not a plain directory or file keeps the whole directory. Removal then walks the directory again,
//!   re-authenticating each file just before it is unlinked, so memory stays bounded and a file that
//!   changed in between stops the sweep.
//! * Only plain entries are followed: `inventory/`, every directory below it and every page file must be
//!   what [`DurableFs::entry_kind`] says without following a link. A link, a junction or anything else
//!   keeps its directory, so a link planted under a pending directory's name can never make the sweep
//!   authenticate, and then unlink, the pages of another directory through it.
//! * Stored page sets (`inventory/<hex digest>`) are not touched. Proving a set abandoned from the
//!   generation of its pages is sound only while a set holds pages of exactly its own revision; once a
//!   later slice lets a set inherit unchanged pages of older generations, the revision that owns a set can
//!   no longer be read from its files, so reclaiming sets belongs to that slice.
//!
//! The sweep is the committed owner's: the journal mutex and the fence are taken, the root-named manifest
//! generation is read back and compared, and a journal in `RECOVERY_REQUIRED` is refused (destructive
//! cleanup is blocked until explicit recovery, §10.3). Callers outside the crate use
//! [`reclaim_abandoned_inventory`](crate::reclaim_abandoned_inventory), which reads the binding from the
//! committed root instead of taking it from the caller. Removal is never retried: a failure stops the
//! sweep, what was removed stays removed and a rerun continues; a rerun always syncs `inventory/` again.
//! The file system must state a directory removal and an entry kind; one that does not is refused before
//! anything is deleted.

use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::durable::{generation_path, DurableFs, EntryKind, WriteOperationId};
use crate::root::LiveMigration;

use super::durable::{
    acquire_journal_durable_guard, assert_root_named_manifest, migration_page_identity,
    JournalDurableContext, JournalDurableError,
};
use super::inventory_read::MAX_PAGE_ENVELOPE_BYTES;
use super::inventory_store::has_epoch;
use super::manifest::{journal_envelope_epoch, JournalManifest};
use super::page::JournalPage;
use super::phase_code;
use super::state::{assert_page_promote_authority, MigrationFence};

const INVENTORY_DIR: &str = "inventory";
const PENDING_PREFIX: &str = "pending-";
const PAGE_DIR_PREFIX: &str = "page-";
const GENERATION_PREFIX: &str = "generation-";
const ENVELOPE_SUFFIX: &str = ".wsr1";
const STAGING_INFIX: &str = ".tmp-";
/// A name below a path that cannot exist, used to ask a file system what it supports.
const PROBE: &str = "reclaim-probe";
/// The most entries the sweep reads from `inventory/` before it refuses the listing.
const MAX_INVENTORY_ENTRIES: usize = 65_536;
/// The most page directories one pending directory holds before the sweep keeps it: the format allows more
/// pages than any inventory is expected to need, and every name is held in memory during a pass.
const MAX_PAGE_DIRS: usize = 100_000;
/// The most files one page directory holds: the page itself and the staging links of earlier attempts.
const MAX_FILES_PER_PAGE_DIR: usize = 64;

/// What the committed owner asks the sweep to prove against.
#[derive(Clone, Copy)]
pub struct ReclaimRequest<'a> {
    /// The root-named manifest: the sweep reads the generation back and compares.
    pub committed_manifest: &'a JournalManifest,
    pub fence: &'a MigrationFence,
    /// The committed root binding that names `committed_manifest`.
    pub committed: &'a LiveMigration,
}

/// Why a sweep did not run or stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReclaimError {
    /// A stale fence, a caller that is not the committed owner, or a manifest that is not the root-named
    /// generation.
    Authority(JournalDurableError),
    /// The journal is in `RECOVERY_REQUIRED`: destructive cleanup waits for explicit recovery.
    RecoveryRequired,
    /// The file system states no directory removal or no entry kind; nothing was deleted.
    RemovalUnsupported,
    /// `inventory/` is a link or not a directory: nothing below it is looked at.
    UnsafeInventory,
    /// `inventory/` holds more entries than the sweep reads; nothing was deleted.
    TooManyEntries,
    /// An entry that passed validation no longer does: it changed while the sweep ran. The sweep stopped.
    Changed,
    /// Removing or syncing failed; what was removed before stays removed and a rerun continues.
    Io(ErrorKind),
}

/// Why an entry was kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KeepReason {
    /// The revision is above the committed one: a live attempt, a retry candidate or a prepared root
    /// may own it.
    LiveRevision,
    /// A stored page set, which a later slice reclaims (module docs).
    StoredSet,
    /// A name or an entry that is not of the inventory grammar.
    Unrecognised,
    /// A link, a junction or another entry that is not a plain directory or file.
    Linked,
    /// A file that does not open as this operation's page at the directory's revision.
    Unauthenticated,
    /// A listing that could not be read, or was larger than the sweep reads.
    Unreadable,
}

/// An entry that was left in place, by its name directly below `inventory/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preserved {
    pub name: String,
    pub reason: KeepReason,
}

/// What a sweep removed and what it kept.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Reclaimed {
    pub pending_removed: usize,
    pub files_removed: usize,
    pub preserved: Vec<Preserved>,
}

/// Removes the abandoned pending directories of the inventory of the journal in `ctx.dir` against the
/// binding in `request` (module docs). Reachable outside the crate only with the test-only `test-support`
/// feature, so that a production caller cannot supply the binding; the root-bound entry point is
/// [`reclaim_abandoned_inventory`](crate::reclaim_abandoned_inventory).
pub fn reclaim_with_binding<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    request: &ReclaimRequest<'_>,
) -> Result<Reclaimed, ReclaimError> {
    let manifest = request.committed_manifest;
    let _guard = acquire_journal_durable_guard(manifest, request.fence).map_err(authority)?;
    assert_page_promote_authority(manifest, Some(request.committed))
        .map_err(|error| authority(JournalDurableError::Authority(error)))?;
    assert_root_named_manifest(ctx, manifest, request.committed).map_err(authority)?;
    if manifest.phase == phase_code::RECOVERY_REQUIRED {
        return Err(ReclaimError::RecoveryRequired);
    }
    let epoch = journal_envelope_epoch(manifest)
        .map_err(|error| authority(JournalDurableError::Journal(error)))?;
    let inventory = ctx.dir.join(INVENTORY_DIR);
    probe_support(ctx, manifest.journal_revision)?;
    match ctx.fs.entry_kind(&inventory) {
        Ok(EntryKind::Directory) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Reclaimed::default()),
        _ => return Err(ReclaimError::UnsafeInventory),
    }
    let names = match ctx.fs.list_dir_at_most(&inventory, MAX_INVENTORY_ENTRIES) {
        Ok(Some(names)) => names,
        Ok(None) => return Err(ReclaimError::TooManyEntries),
        Err(error) => return Err(ReclaimError::Io(error.kind())),
    };
    let sweep = Sweep {
        inventory,
        manifest,
        epoch,
    };
    sweep.run(ctx, names)
}

fn authority(error: JournalDurableError) -> ReclaimError {
    ReclaimError::Authority(error)
}

/// Asks the file system for a directory removal and an entry kind under a path that cannot exist: the
/// root-named manifest generation is a file, so nothing below it is a directory to remove. A file system
/// that states neither answers `Unsupported`; any other answer means it does. Nothing is created or
/// deleted.
fn probe_support<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    revision: u64,
) -> Result<(), ReclaimError> {
    let missing = generation_path(ctx.dir, revision).join(PROBE);
    let removal = ctx.fs.remove_dir(&missing).err();
    let kind = ctx.fs.entry_kind(&missing).err();
    let unsupported = |error: Option<std::io::Error>| {
        error.is_some_and(|error| error.kind() == ErrorKind::Unsupported)
    };
    if unsupported(removal) || unsupported(kind) {
        Err(ReclaimError::RemovalUnsupported)
    } else {
        Ok(())
    }
}

struct Sweep<'a> {
    inventory: PathBuf,
    manifest: &'a JournalManifest,
    epoch: u64,
}

/// What a directory below `inventory/` is, by its name alone.
enum Named {
    Pending { revision: u64 },
    Set,
    Other,
}

/// One walk over a pending directory: first only checking, then removing.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Walk {
    Check,
    Remove,
}

/// One pass over a pending directory: the revision its files must carry and whether it checks or removes.
#[derive(Clone, Copy)]
struct Pass {
    revision: u64,
    walk: Walk,
}

/// Why a walk did not complete: the entry is kept, or the sweep stops.
enum Stop {
    Keep(KeepReason),
    Fatal(ReclaimError),
}

impl From<ReclaimError> for Stop {
    fn from(error: ReclaimError) -> Self {
        Stop::Fatal(error)
    }
}

impl Walk {
    /// What a refusal means: while checking the directory is kept, while removing it changed under us.
    fn refuse(self, reason: KeepReason) -> Stop {
        match self {
            Walk::Check => Stop::Keep(reason),
            Walk::Remove => Stop::Fatal(ReclaimError::Changed),
        }
    }
}

/// One page file of an attempt: where it is, which page of the operation it stands for and at which
/// generation.
struct PageFile<'a> {
    path: &'a Path,
    index: u32,
    generation: u64,
}

impl Sweep<'_> {
    fn run<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        mut names: Vec<OsString>,
    ) -> Result<Reclaimed, ReclaimError> {
        names.sort();
        let mut done = Reclaimed::default();
        for name in names {
            let Some(text) = name.to_str() else {
                done.keep(&name.to_string_lossy(), KeepReason::Unrecognised);
                continue;
            };
            let dir = self.inventory.join(text);
            match self.judge(ctx, text, &dir) {
                Ok(files) => {
                    done.files_removed += files;
                    done.pending_removed += 1;
                }
                Err(Stop::Keep(reason)) => done.keep(text, reason),
                Err(Stop::Fatal(error)) => return Err(error),
            }
        }
        // Always, so that a rerun after a failed sync establishes the durability the failed run did not.
        ctx.fs
            .sync_dir(&self.inventory)
            .map_err(|error| ReclaimError::Io(error.kind()))?;
        Ok(done)
    }

    /// Removes `dir` if it is a provably dead pending directory and returns the number of files removed,
    /// or says why it is kept.
    fn judge<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        name: &str,
        dir: &Path,
    ) -> Result<usize, Stop> {
        let committed = self.manifest.journal_revision;
        match parse_name(name) {
            Named::Other => Err(Stop::Keep(KeepReason::Unrecognised)),
            Named::Set => Err(Stop::Keep(KeepReason::StoredSet)),
            Named::Pending { .. } if !is_plain(ctx.fs, dir, EntryKind::Directory) => {
                Err(Stop::Keep(KeepReason::Linked))
            }
            Named::Pending { revision } if revision > committed => {
                Err(Stop::Keep(KeepReason::LiveRevision))
            }
            Named::Pending { revision } => {
                let check = Pass {
                    revision,
                    walk: Walk::Check,
                };
                self.walk(ctx, dir, check)?;
                let remove = Pass {
                    revision,
                    walk: Walk::Remove,
                };
                let files = self.walk(ctx, dir, remove)?;
                removed(ctx.fs.remove_dir(dir))?;
                Ok(files)
            }
        }
    }

    /// Visits every page directory and file below the pending directory `dir`, holding only the names of
    /// one directory at a time; while removing, a file is re-authenticated just before it is unlinked and
    /// a page directory is removed once it is empty.
    fn walk<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        dir: &Path,
        pass: Pass,
    ) -> Result<usize, Stop> {
        let walk = pass.walk;
        let pages = list(ctx.fs, dir, MAX_PAGE_DIRS).map_err(|reason| walk.refuse(reason))?;
        let mut files = 0;
        for name in pages {
            let index = name
                .to_str()
                .and_then(|text| text.strip_prefix(PAGE_DIR_PREFIX))
                .and_then(canonical_u64)
                .and_then(|index| u32::try_from(index).ok())
                .ok_or_else(|| walk.refuse(KeepReason::Unrecognised))?;
            let page_dir = dir.join(&name);
            if !is_plain(ctx.fs, &page_dir, EntryKind::Directory) {
                return Err(walk.refuse(KeepReason::Linked));
            }
            files += self.walk_page_dir(ctx, (&page_dir, index), pass)?;
            if walk == Walk::Remove {
                removed(ctx.fs.remove_dir(&page_dir))?;
            }
        }
        Ok(files)
    }

    fn walk_page_dir<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        (page_dir, index): (&Path, u32),
        pass: Pass,
    ) -> Result<usize, Stop> {
        let Pass { revision, walk } = pass;
        let names =
            list(ctx.fs, page_dir, MAX_FILES_PER_PAGE_DIR).map_err(|reason| walk.refuse(reason))?;
        let mut files = 0;
        for name in names {
            let generation = name
                .to_str()
                .and_then(parse_generation_file)
                .filter(|generation| *generation == revision)
                .ok_or_else(|| walk.refuse(KeepReason::Unrecognised))?;
            let path = page_dir.join(&name);
            if !is_plain(ctx.fs, &path, EntryKind::File) {
                return Err(walk.refuse(KeepReason::Linked));
            }
            let file = PageFile {
                path: &path,
                index,
                generation,
            };
            self.assert_ours(ctx, &file)
                .map_err(|reason| walk.refuse(reason))?;
            if walk == Walk::Remove && removed(ctx.fs.remove_file(&path))? {
                files += 1;
            }
        }
        Ok(files)
    }

    /// The file opens under the journal key as this operation's page `index` at `generation`, with the
    /// operation's journal envelope epoch; the epoch is compared before the key is used.
    fn assert_ours<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        file: &PageFile<'_>,
    ) -> Result<(), KeepReason> {
        let PageFile {
            path,
            index,
            generation,
        } = *file;
        let envelope = ctx
            .fs
            .read_at_most(path, MAX_PAGE_ENVELOPE_BYTES)
            .map_err(|_| KeepReason::Unreadable)?
            .ok_or(KeepReason::Unauthenticated)?;
        if !has_epoch(&envelope, self.epoch).map_err(|_| KeepReason::Unauthenticated)? {
            return Err(KeepReason::Unauthenticated);
        }
        let identity = migration_page_identity(&self.manifest.operation_id, index)
            .map_err(|_| KeepReason::Unauthenticated)?;
        let opened = JournalPage::open(ctx.key, &identity, generation, &envelope)
            .map_err(|_| KeepReason::Unauthenticated)?;
        if opened.page_index() == index && opened.page_generation() == generation {
            Ok(())
        } else {
            Err(KeepReason::Unauthenticated)
        }
    }
}

impl Reclaimed {
    fn keep(&mut self, name: &str, reason: KeepReason) {
        self.preserved.push(Preserved {
            name: name.to_owned(),
            reason,
        });
    }
}

/// A name that is already gone is a rerun of an earlier sweep, not a failure; any other error stops it.
fn removed(result: std::io::Result<()>) -> Result<bool, ReclaimError> {
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ReclaimError::Io(error.kind())),
    }
}

/// Whether `path` is itself of the `wanted` kind, not a link to one; a path that cannot be told apart is
/// not plain.
fn is_plain<F: DurableFs>(fs: &mut F, path: &Path, wanted: EntryKind) -> bool {
    fs.entry_kind(path).is_ok_and(|kind| kind == wanted)
}

fn list<F: DurableFs>(fs: &mut F, dir: &Path, limit: usize) -> Result<Vec<OsString>, KeepReason> {
    match fs.list_dir_at_most(dir, limit) {
        Ok(Some(names)) => Ok(names),
        _ => Err(KeepReason::Unreadable),
    }
}

fn parse_name(name: &str) -> Named {
    if let Some(rest) = name.strip_prefix(PENDING_PREFIX) {
        let parsed = rest.split_once('-').and_then(|(revision, tag)| {
            Some((canonical_u64(revision)?, WriteOperationId::parse(tag)?))
        });
        return match parsed {
            // A capture stages for the committed revision plus one, so revision zero is never a capture.
            Some((revision, _)) if revision >= 1 => Named::Pending { revision },
            _ => Named::Other,
        };
    }
    if is_lower_hex(name, 64) {
        Named::Set
    } else {
        Named::Other
    }
}

/// A decimal number without a sign, without leading zeros and within `u64`.
fn canonical_u64(text: &str) -> Option<u64> {
    let canonical = !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'));
    if canonical {
        text.parse().ok()
    } else {
        None
    }
}

/// Lowercase hexadecimal of exactly `length` characters.
fn is_lower_hex(text: &str, length: usize) -> bool {
    let all_hex = text
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    text.len() == length && all_hex
}

/// `generation-<g>.wsr1`, or the staging link `generation-<g>.wsr1.tmp-<operation>-<g>` of an attempt.
fn parse_generation_file(name: &str) -> Option<u64> {
    let rest = name.strip_prefix(GENERATION_PREFIX)?;
    let (generation, tail) = rest.split_once(ENVELOPE_SUFFIX)?;
    let generation = canonical_u64(generation)?;
    if tail.is_empty() {
        return Some(generation);
    }
    let (operation, again) = tail.strip_prefix(STAGING_INFIX)?.rsplit_once('-')?;
    (WriteOperationId::parse(operation).is_some() && canonical_u64(again) == Some(generation))
        .then_some(generation)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_grammar_exactly() {
        let tag = "0123456789abcdef0123456789abcdef";
        assert!(matches!(
            parse_name(&format!("pending-4-{tag}")),
            Named::Pending { revision: 4 }
        ));
        for odd in [
            "pending-0-0123456789abcdef0123456789abcdef",
            "pending-04-0123456789abcdef0123456789abcdef",
            "pending--0123456789abcdef0123456789abcdef",
            "pending-4-0123456789ABCDEF0123456789abcdef",
            "pending-4-short",
            "pending-18446744073709551616-0123456789abcdef0123456789abcdef",
            "inventory",
            "",
        ] {
            assert!(matches!(parse_name(odd), Named::Other), "{odd}");
        }
        assert!(matches!(parse_name(&"ab".repeat(32)), Named::Set));
        assert!(matches!(parse_name(&"AB".repeat(32)), Named::Other));
        assert!(matches!(parse_name(&"ab".repeat(31)), Named::Other));
    }

    #[test]
    fn generation_files_follow_the_grammar_exactly() {
        let tag = "0123456789abcdef0123456789abcdef";
        assert_eq!(parse_generation_file("generation-7.wsr1"), Some(7));
        assert_eq!(
            parse_generation_file(&format!("generation-7.wsr1.tmp-{tag}-7")),
            Some(7)
        );
        for odd in [
            "generation-07.wsr1",
            "generation-7.wsr",
            "generation-7.wsr1.bak",
            "generation-7.wsr1.rejected-x",
            &format!("generation-7.wsr1.tmp-{tag}-8"),
            "generation-7.wsr1.tmp-short-7",
            "other-7.wsr1",
        ] {
            assert_eq!(parse_generation_file(odd), None, "{odd}");
        }
    }
}
