//! Gate 4 slice R1: reclaiming abandoned inventory staging. A killed or dropped streaming capture leaves
//! a pending directory, and a stored page set no manifest adopted leaves a digest directory. The sweep
//! removes what it can prove dead (a pending directory of a revision that is committed, a page set that
//! the authenticated manifest of its own revision does not name) and keeps everything else: the next
//! revision, the committed set, any entry that is not of the grammar and any file that does not open as
//! this operation's page. Every test is a table of named cases with one assertion over all of them.

#[path = "support/inventory_fixture.rs"]
mod inventory_fixture;
#[path = "support/journal_fixture.rs"]
mod journal_fixture;

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use inventory_fixture::*;
use journal_fixture::*;
use worldscript_secure_storage::*;

fn set_name(digest: &[u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn fresh_tag() -> String {
    WriteOperationId::generate().unwrap().as_str().to_owned()
}

/// `(name, reason)` of everything the sweep kept.
fn kept(done: &Reclaimed) -> BTreeSet<(String, KeepReason)> {
    done.preserved
        .iter()
        .map(|entry| (entry.name.clone(), entry.reason))
        .collect()
}

fn name_of(dir: &Path) -> String {
    dir.file_name().unwrap().to_string_lossy().into_owned()
}

/// The staging link an earlier promotion of `pending`'s first page can leave beside it.
fn leave_staging_link(pending: &Path, generation: u64) {
    let page = pending.join("page-0");
    let from = page.join(format!("generation-{generation}.wsr1"));
    let to = page.join(format!(
        "generation-{generation}.wsr1.tmp-{}-{generation}",
        fresh_tag()
    ));
    std::fs::copy(from, to).unwrap();
}

/// A journal at revision 3 with two abandoned captures staged for revision 4, one with a staging
/// link beside its first page, and the journal moved on to revision 5.
fn with_two_dead_pending_dirs() -> Scenario {
    let mut scenario = Scenario::new();
    let first = scenario.stage(5);
    let second = scenario.stage(3);
    leave_staging_link(first.pending_dir(), 4);
    drop(second);
    scenario.advance(&manifest_at(4));
    scenario.advance(&manifest_at(5));
    scenario
}

#[test]
fn dead_pending_directories_are_removed_with_their_residue_and_the_parent_is_synced() {
    let scenario = with_two_dead_pending_dirs();
    assert_eq!(names_in(&scenario.inventory()).len(), 2);
    let mut fs = ObservedFs::new();
    let done = scenario.sweep(&mut fs).unwrap();
    // Three pages and a staging link of the first capture, two pages of the second.
    assert_eq!(
        (
            done.pending_removed,
            done.sets_removed,
            done.files_removed,
            done.preserved.is_empty()
        ),
        (2, 0, 6, true)
    );
    assert_eq!(names_in(&scenario.inventory()), BTreeSet::new());
    assert!(fs.synced.contains(&scenario.inventory()));
    let left = tree_under(scenario.path());
    let expected: BTreeSet<String> = [
        "generation-3.wsr1",
        "generation-4.wsr1",
        "generation-5.wsr1",
        "inventory/",
    ]
    .map(str::to_owned)
    .into();
    assert_eq!(left, expected);
}

#[test]
fn a_second_sweep_has_nothing_left_to_do() {
    let scenario = with_two_dead_pending_dirs();
    scenario.sweep(&mut StdFs).unwrap();
    let again = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(again, Reclaimed::default());
}

#[test]
fn a_journal_without_an_inventory_directory_has_nothing_to_sweep() {
    let scenario = Scenario::new();
    assert_eq!(scenario.sweep(&mut StdFs).unwrap(), Reclaimed::default());
}

#[test]
fn the_next_revision_and_above_are_never_swept() {
    let scenario = Scenario::new();
    let live = scenario.stage(5);
    let future = scenario
        .inventory()
        .join(format!("pending-9-{}", fresh_tag()));
    std::fs::create_dir_all(future.join("page-0")).unwrap();
    let before = tree_under(scenario.path());
    let done = scenario.sweep(&mut StdFs).unwrap();
    let expected: BTreeSet<_> = [
        (name_of(live.pending_dir()), KeepReason::LiveRevision),
        (name_of(&future), KeepReason::LiveRevision),
    ]
    .into();
    assert_eq!(
        (
            kept(&done),
            done.pending_removed,
            tree_under(scenario.path())
        ),
        (expected, 0, before)
    );
}

/// Two captures promoted at revision 4: the one `kept_digest` names and one that nothing names.
struct Promoted {
    committed: [u8; 32],
    orphan: [u8; 32],
}

fn promote_two_sets(scenario: &mut Scenario) -> Promoted {
    let committed = scenario.stage(5);
    let orphan = scenario.stage(5);
    scenario.promote(&committed);
    scenario.promote(&orphan);
    let digests = Promoted {
        committed: committed.successor().journal_page_set_digest,
        orphan: orphan.successor().journal_page_set_digest,
    };
    assert_ne!(digests.committed, digests.orphan);
    scenario.advance(&committed.successor().clone());
    digests
}

#[test]
fn a_set_is_removed_only_against_an_authenticated_manifest_that_names_another() {
    let mut scenario = Scenario::new();
    let digests = promote_two_sets(&mut scenario);
    let (committed, orphan) = (set_name(&digests.committed), set_name(&digests.orphan));
    let done = scenario.sweep(&mut StdFs).unwrap();
    let names = names_in(&scenario.inventory());
    assert_eq!(
        (
            done.sets_removed,
            names.contains(&committed),
            names.contains(&orphan),
            kept(&done).contains(&(committed.clone(), KeepReason::Committed))
        ),
        (1, true, false, true)
    );
    // The journal moves on: the committed set is now an older set that its own revision's manifest names.
    scenario.advance(&manifest_at(5));
    let later = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            later.sets_removed,
            kept(&later).contains(&(committed, KeepReason::NamedByManifest))
        ),
        (0, true)
    );
}

#[test]
fn a_set_of_the_next_revision_is_kept_until_the_journal_has_moved_past_it() {
    let scenario = Scenario::new();
    let staged = scenario.stage(5);
    scenario.promote(&staged);
    let name = set_name(&staged.successor().journal_page_set_digest);
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            done.sets_removed,
            kept(&done).contains(&(name, KeepReason::LiveRevision))
        ),
        (0, true)
    );
}

#[test]
fn a_set_whose_manifest_cannot_be_read_is_kept() {
    let mut scenario = Scenario::new();
    let staged = scenario.stage(5);
    scenario.promote(&staged);
    scenario.advance(&manifest_at(4));
    scenario.advance(&manifest_at(5));
    std::fs::remove_file(generation_path(scenario.path(), 4)).unwrap();
    let name = set_name(&staged.successor().journal_page_set_digest);
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            done.sets_removed,
            kept(&done).contains(&(name, KeepReason::ManifestUnproven))
        ),
        (0, true)
    );
}

/// The first page file of the pending directory of `staged`.
fn first_page_file(staged: &StagedCapture) -> PathBuf {
    generation_path(&staged.pending_dir().join("page-0"), 4)
}

#[test]
fn nothing_that_is_not_ours_is_removed() {
    let mut scenario = Scenario::new();
    let with_note = scenario.stage(3);
    let tampered = scenario.stage(3);
    let foreign_page = scenario.stage(3);
    std::fs::write(with_note.pending_dir().join("notes.txt"), b"mine").unwrap();
    let path = first_page_file(&tampered);
    let mut bytes = std::fs::read(&path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    std::fs::write(&path, bytes).unwrap();
    std::fs::create_dir(foreign_page.pending_dir().join("not-a-page")).unwrap();
    let odd = scenario.inventory().join("keep-me");
    std::fs::create_dir_all(&odd).unwrap();
    scenario.advance(&manifest_at(4));
    scenario.advance(&manifest_at(5));
    let before = tree_under(scenario.path());
    let done = scenario.sweep(&mut StdFs).unwrap();
    let expected: BTreeSet<_> = [
        (name_of(with_note.pending_dir()), KeepReason::Unrecognised),
        (name_of(tampered.pending_dir()), KeepReason::Unauthenticated),
        (
            name_of(foreign_page.pending_dir()),
            KeepReason::Unrecognised,
        ),
        ("keep-me".to_owned(), KeepReason::Unrecognised),
    ]
    .into();
    assert_eq!(
        (
            kept(&done),
            done.pending_removed,
            tree_under(scenario.path())
        ),
        (expected, 0, before)
    );
}

#[test]
fn a_page_moved_to_another_slot_is_not_ours() {
    let mut scenario = Scenario::new();
    let staged = scenario.stage(3);
    // Bytes that are a genuine page of this operation, sealed for page 0, put in the slot of page 1:
    // a page file moved between pages does not open as the page it now stands for.
    let page_one = staged.pending_dir().join("page-1");
    let moved = generation_path(&staged.pending_dir().join("page-0"), 4);
    std::fs::copy(&moved, generation_path(&page_one, 4)).unwrap();
    scenario.advance(&manifest_at(4));
    scenario.advance(&manifest_at(5));
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            done.pending_removed,
            kept(&done).contains(&(name_of(staged.pending_dir()), KeepReason::Unauthenticated))
        ),
        (0, true)
    );
}

#[test]
fn an_empty_set_directory_proves_nothing_and_is_kept() {
    let mut scenario = Scenario::new();
    let name = set_name(&[0x5a; 32]);
    std::fs::create_dir_all(scenario.inventory().join(&name).join("page-0")).unwrap();
    scenario.advance(&manifest_at(4));
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            done.sets_removed,
            kept(&done).contains(&(name, KeepReason::Unproven))
        ),
        (0, true)
    );
}

/// A file system that states no directory removal: everything else is the real one.
struct NoRemovalFs;

impl DurableFs for NoRemovalFs {
    type File = File;
    fn create_new(&mut self, path: &Path) -> io::Result<File> {
        StdFs.create_new(path)
    }
    fn sync_file(&mut self, file: &mut File) -> io::Result<()> {
        StdFs.sync_file(file)
    }
    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        StdFs.read(path)
    }
    fn read_at_most(&mut self, path: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
        StdFs.read_at_most(path, limit)
    }
    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.link_no_replace(from, to)
    }
    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }
    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        StdFs.sync_dir(dir)
    }
    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        StdFs.list_dir(dir)
    }
    fn list_dir_at_most(&mut self, dir: &Path, limit: usize) -> io::Result<Option<Vec<OsString>>> {
        StdFs.list_dir_at_most(dir, limit)
    }
    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.rename_replace(from, to)
    }
    fn create_dir_all(&mut self, dir: &Path) -> io::Result<()> {
        StdFs.create_dir_all(dir)
    }
}

#[test]
fn a_file_system_without_directory_removal_is_refused_before_anything_is_deleted() {
    let scenario = with_two_dead_pending_dirs();
    let before = tree_under(scenario.path());
    let refused = scenario.sweep(&mut NoRemovalFs);
    assert_eq!(
        (refused, tree_under(scenario.path())),
        (Err(ReclaimError::RemovalUnsupported), before)
    );
}

/// A caller whose fence, manifest or key is not the committed owner's: nothing is removed or created.
#[test]
fn only_the_committed_owner_under_the_fence_may_sweep() {
    let mut scenario = with_two_dead_pending_dirs();
    let before = tree_under(scenario.path());
    let mut stale = scenario.fence();
    stale.fencing_generation += 1;
    let mut observed = ObservedFs::new();
    let by_fence = scenario.sweep_as(&mut observed, &stale, &key());
    let by_key = scenario.sweep_as(&mut observed, &scenario.fence(), &other_key());
    let real = scenario.committed.clone();
    scenario.committed.has_lease_owner = true;
    scenario.committed.lease_owner_id = Some("someone".into());
    scenario.committed.lease_expires_unix_ms = Some(1);
    let by_manifest = scenario.sweep(&mut observed);
    scenario.committed = real;
    let all_authority = [by_fence, by_key, by_manifest]
        .iter()
        .all(|result| matches!(result, Err(ReclaimError::Authority(_))));
    assert_eq!(
        (
            all_authority,
            observed.created_nothing(),
            observed.removed_dirs.is_empty(),
            tree_under(scenario.path())
        ),
        (true, true, true, before)
    );
}

#[test]
fn a_failed_removal_stops_the_sweep_and_a_rerun_converges() {
    let scenario = with_two_dead_pending_dirs();
    let mut failing = ObservedFs::new();
    failing.fail_remove_dir = true;
    let stopped = scenario.sweep(&mut failing);
    assert!(matches!(stopped, Err(ReclaimError::Io(_))), "{stopped:?}");
    // The files that were removed stay removed; the directories are still there.
    let files = tree_under(&scenario.inventory())
        .into_iter()
        .filter(|name| !name.ends_with('/'))
        .count();
    assert!(files < 6, "{files} files left");
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(names_in(&scenario.inventory()), BTreeSet::new());
    assert_eq!((done.pending_removed, done.preserved.is_empty()), (2, true));
}

#[test]
fn a_failed_file_removal_stops_before_any_directory_is_removed() {
    let scenario = with_two_dead_pending_dirs();
    let mut failing = ObservedFs::new();
    failing.fail_remove = true;
    let stopped = scenario.sweep(&mut failing);
    assert!(matches!(stopped, Err(ReclaimError::Io(_))), "{stopped:?}");
    assert!(failing.removed_dirs.is_empty());
    assert_eq!(names_in(&scenario.inventory()).len(), 2);
}
