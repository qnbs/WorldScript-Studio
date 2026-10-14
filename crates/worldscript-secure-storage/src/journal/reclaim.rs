//! Gate 4 slice R1: reclaiming abandoned inventory staging (§10.1.1).
//!
//! Three things under `<journal-dir>/inventory/` outlive the attempt that made them and are never
//! authority, never named by a manifest that is read and never read themselves:
//!
//! ```text
//! pending-<revision>-<random>/page-<i>/generation-<g>.wsr1   a streaming capture that was killed or dropped
//! <hex(page-set digest)>/page-<i>/generation-<g>.wsr1        a stored page set no manifest adopted
//! page-<i>/ (empty), generation-<g>.wsr1.tmp-<op>-<g>        what either attempt left around its pages
//! ```
//!
//! [`reclaim_abandoned_inventory`] removes exactly what it can prove dead, and preserves everything
//! else:
//!
//! * A pending directory of revision `rev <= R` (`R` the committed revision) is dead: a promotion needs
//!   `rev == R + 1`, and `R` only grows. Revision `R + 1` is never swept: a live attempt, a retry candidate
//!   or a prepared root may own it.
//! * A page-set directory is removed only when every page file in it carries one generation `g <= R`
//!   and the authenticated manifest generation `g`, read by its exact path, names *another* page-set
//!   digest: the set of a discarded attempt at a revision that was committed with a different set. The
//!   committed set, a set that its own revision's manifest names, a set whose manifest cannot be read
//!   and a set at `R + 1` or above are kept. A set is not removed for being older: a later slice may
//!   let a newer set inherit pages of an older one.
//! * Every file must open under the journal key as this operation's page at its index and generation,
//!   with the operation's journal envelope epoch. A set is validated completely before its first removal;
//!   one entry that is not of the grammar, or does not authenticate, keeps the whole directory.
//!
//! The caller is the committed owner under the fence and the journal mutex, and the committed manifest
//! is read back from the root-named generation. Removal is never retried: a failure stops the sweep, what
//! was removed stays removed, and a rerun continues. The file system must state a directory removal
//! ([`DurableFs::remove_dir`]); one that does not is refused before anything is deleted.

use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::durable::{DurableFs, WriteOperationId};
use crate::root::LiveMigration;

use super::durable::{
    acquire_journal_durable_guard, assert_root_named_manifest, load_manifest_generation,
    migration_page_identity, JournalDurableContext, JournalDurableError,
};
use super::inventory_read::MAX_PAGE_ENVELOPE_BYTES;
use super::inventory_store::has_epoch;
use super::manifest::{journal_envelope_epoch, JournalManifest};
use super::page::JournalPage;
use super::state::{assert_page_promote_authority, MigrationFence};
use super::MAX_JOURNAL_INVENTORY_ENTRIES;

const INVENTORY_DIR: &str = "inventory";
const PENDING_PREFIX: &str = "pending-";
const PAGE_DIR_PREFIX: &str = "page-";
const GENERATION_PREFIX: &str = "generation-";
const ENVELOPE_SUFFIX: &str = ".wsr1";
const STAGING_INFIX: &str = ".tmp-";
/// A name that matches no directory of the inventory grammar: the probe of the removal support.
const PROBE: &str = "reclaim-probe";
/// The most entries the sweep reads from `inventory/` before it refuses the listing.
const MAX_INVENTORY_ENTRIES: usize = 65_536;
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
    /// The file system states no directory removal; nothing was deleted.
    RemovalUnsupported,
    /// `inventory/` holds more entries than the sweep reads; nothing was deleted.
    TooManyEntries,
    /// Removing or syncing failed; what was removed before stays removed and a rerun continues.
    Io(ErrorKind),
}

/// Why an entry was kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KeepReason {
    /// The revision is above the committed one: a live attempt, a retry candidate or a prepared root
    /// may own it.
    LiveRevision,
    /// The page set the committed manifest names.
    Committed,
    /// A page set that the manifest of its own revision names.
    NamedByManifest,
    /// The manifest generation of the set's revision is absent or does not authenticate, so nothing
    /// proves the set was abandoned.
    ManifestUnproven,
    /// A set with no page file at all, or whose page files carry different generations.
    Unproven,
    /// A name or an entry that is not of the inventory grammar.
    Unrecognised,
    /// A file that does not open as this operation's page.
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
    pub sets_removed: usize,
    pub files_removed: usize,
    pub preserved: Vec<Preserved>,
}

/// Removes the abandoned staging of the inventory of the journal in `ctx.dir` (module docs).
pub fn reclaim_abandoned_inventory<F: DurableFs>(
    ctx: &mut JournalDurableContext<'_, F>,
    request: &ReclaimRequest<'_>,
) -> Result<Reclaimed, ReclaimError> {
    let manifest = request.committed_manifest;
    let _guard = acquire_journal_durable_guard(manifest, request.fence).map_err(authority)?;
    assert_page_promote_authority(manifest, Some(request.committed))
        .map_err(|error| authority(JournalDurableError::Authority(error)))?;
    assert_root_named_manifest(ctx, manifest, request.committed).map_err(authority)?;
    let epoch = journal_envelope_epoch(manifest)
        .map_err(|error| authority(JournalDurableError::Journal(error)))?;
    let inventory = ctx.dir.join(INVENTORY_DIR);
    probe_removal(ctx.fs, &inventory)?;
    let names = match ctx.fs.list_dir_at_most(&inventory, MAX_INVENTORY_ENTRIES) {
        Ok(Some(names)) => names,
        Ok(None) => return Err(ReclaimError::TooManyEntries),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Reclaimed::default()),
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

/// A directory removal on a name that does not exist: a file system without removal answers
/// `Unsupported`, one with it `NotFound`. Nothing is created or deleted.
fn probe_removal<F: DurableFs>(fs: &mut F, inventory: &Path) -> Result<(), ReclaimError> {
    match fs.remove_dir(&inventory.join(PROBE)) {
        Err(error) if error.kind() == ErrorKind::Unsupported => {
            Err(ReclaimError::RemovalUnsupported)
        }
        _ => Ok(()),
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
    Set { digest: [u8; 32] },
    Other,
}

/// A directory that passed the whole validation and may be removed.
struct Verified {
    generation: Option<u64>,
    files: Vec<PathBuf>,
    page_dirs: Vec<PathBuf>,
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
                Err(reason) => done.keep(text, reason),
                Ok((verified, pending)) => {
                    done.files_removed += remove_all(ctx.fs, &dir, &verified)?;
                    if pending {
                        done.pending_removed += 1;
                    } else {
                        done.sets_removed += 1;
                    }
                }
            }
        }
        if done.pending_removed + done.sets_removed > 0 {
            ctx.fs
                .sync_dir(&self.inventory)
                .map_err(|error| ReclaimError::Io(error.kind()))?;
        }
        Ok(done)
    }

    /// Whether `dir` is provably abandoned: the validated plan and whether it is a pending directory, or
    /// the reason to keep it.
    fn judge<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        name: &str,
        dir: &Path,
    ) -> Result<(Verified, bool), KeepReason> {
        let committed = self.manifest.journal_revision;
        match parse_name(name) {
            Named::Other => Err(KeepReason::Unrecognised),
            Named::Pending { revision } if revision > committed => Err(KeepReason::LiveRevision),
            Named::Pending { revision } => {
                let verified = self.verify(ctx, dir)?;
                match verified.generation {
                    Some(found) if found != revision => Err(KeepReason::Unproven),
                    _ => Ok((verified, true)),
                }
            }
            Named::Set { digest } if digest == self.manifest.journal_page_set_digest => {
                Err(KeepReason::Committed)
            }
            Named::Set { digest } => {
                let verified = self.verify(ctx, dir)?;
                let generation = verified.generation.ok_or(KeepReason::Unproven)?;
                if generation > committed {
                    return Err(KeepReason::LiveRevision);
                }
                self.assert_other_digest(ctx, generation, &digest)?;
                Ok((verified, false))
            }
        }
    }

    /// The authenticated manifest of `generation` must exist and name a page set other than `digest`.
    fn assert_other_digest<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        generation: u64,
        digest: &[u8; 32],
    ) -> Result<(), KeepReason> {
        let named =
            load_manifest_generation(ctx, &self.manifest.operation_id, generation, self.epoch)
                .map_err(|_| KeepReason::ManifestUnproven)?;
        if named.journal_page_set_digest == *digest {
            Err(KeepReason::NamedByManifest)
        } else {
            Ok(())
        }
    }

    /// Lists and authenticates everything below `dir`; refuses on the first entry that is not ours.
    fn verify<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        dir: &Path,
    ) -> Result<Verified, KeepReason> {
        let max_pages = MAX_JOURNAL_INVENTORY_ENTRIES as usize;
        let pages = list(ctx.fs, dir, max_pages)?;
        let mut verified = Verified {
            generation: None,
            files: Vec::new(),
            page_dirs: Vec::new(),
        };
        for name in pages {
            let index = name
                .to_str()
                .and_then(|text| text.strip_prefix(PAGE_DIR_PREFIX))
                .and_then(canonical_u64)
                .and_then(|index| u32::try_from(index).ok())
                .ok_or(KeepReason::Unrecognised)?;
            let page_dir = dir.join(&name);
            self.verify_page_dir(ctx, &page_dir, index, &mut verified)?;
            verified.page_dirs.push(page_dir);
        }
        Ok(verified)
    }

    fn verify_page_dir<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        page_dir: &Path,
        index: u32,
        verified: &mut Verified,
    ) -> Result<(), KeepReason> {
        for name in list(ctx.fs, page_dir, MAX_FILES_PER_PAGE_DIR)? {
            let generation = name
                .to_str()
                .and_then(parse_generation_file)
                .ok_or(KeepReason::Unrecognised)?;
            if verified.generation.is_some_and(|seen| seen != generation) {
                return Err(KeepReason::Unproven);
            }
            let path = page_dir.join(&name);
            self.assert_ours(ctx, &path, index, generation)?;
            verified.generation = Some(generation);
            verified.files.push(path);
        }
        Ok(())
    }

    /// The file opens under the journal key as this operation's page `index` at `generation`, with the
    /// operation's journal envelope epoch; the epoch is compared before the key is used.
    fn assert_ours<F: DurableFs>(
        &self,
        ctx: &mut JournalDurableContext<'_, F>,
        path: &Path,
        index: u32,
        generation: u64,
    ) -> Result<(), KeepReason> {
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

/// Files first, then the page directories, then the set directory itself. A name that is already gone
/// is a rerun of an earlier sweep, not a failure; any other error stops the sweep.
fn remove_all<F: DurableFs>(
    fs: &mut F,
    dir: &Path,
    verified: &Verified,
) -> Result<usize, ReclaimError> {
    let mut files = 0;
    for file in &verified.files {
        if removed(fs.remove_file(file))? {
            files += 1;
        }
    }
    for page_dir in &verified.page_dirs {
        removed(fs.remove_dir(page_dir))?;
    }
    removed(fs.remove_dir(dir))?;
    Ok(files)
}

fn removed(result: std::io::Result<()>) -> Result<bool, ReclaimError> {
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ReclaimError::Io(error.kind())),
    }
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
            Some((revision, _)) => Named::Pending { revision },
            None => Named::Other,
        };
    }
    match parse_digest(name) {
        Some(digest) => Named::Set { digest },
        None => Named::Other,
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

fn parse_digest(name: &str) -> Option<[u8; 32]> {
    if name.len() != 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    let mut digest = [0u8; 32];
    for (slot, pair) in digest.iter_mut().zip(name.as_bytes().chunks(2)) {
        *slot = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }
    Some(digest)
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
        assert!(matches!(
            parse_name(&"ab".repeat(32)),
            Named::Set { digest } if digest == [0xab; 32]
        ));
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
