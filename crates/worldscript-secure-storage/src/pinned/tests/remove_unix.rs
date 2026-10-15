//! Unix removal under the swap the design exists for: another actor replaces the last component of the
//! name, or the object inside the quarantine directory, between the steps of the removal. Each case
//! forces the swap through the observer at a chosen stage and pins what happens to every object. The
//! counter-proofs show that the swap really takes place (the baseline, and the asserted state of the
//! displaced objects).

use std::fs;
use std::os::fd::AsFd;
use std::os::unix::fs::PermissionsExt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use rustix::fs::{unlinkat, AtFlags};

use super::remove::{holds, names, removed};
use super::Scratch;
use crate::pinned::{PinnedDir, PinnedError, RemovalOutcome, RemovalStage, QUARANTINE_PREFIX};

/// A pinned directory holding `a` = "alpha", with the paths a swap needs.
struct Fixture {
    /// Keeps the directories until the test ends.
    _scratch: Scratch,
    root: PathBuf,
    aside: PathBuf,
    pinned: PinnedDir,
}

fn fixture(label: &str) -> Fixture {
    let scratch = Scratch::new(label);
    let root = scratch.root();
    let aside = scratch.aside();
    fs::write(root.join("a"), b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    Fixture {
        _scratch: scratch,
        root,
        aside,
        pinned,
    }
}

/// The stages of a removal, without their payload.
#[derive(Clone, Copy, PartialEq)]
enum At {
    Checked,
    MovedAside,
    Identified,
    BeforeSync,
}

/// An observer that runs `action` (with the path inside the quarantine directory, once there is one) at
/// the stage `at` and otherwise does nothing.
fn on(
    at: At,
    mut action: impl FnMut(Option<&Path>),
) -> impl FnMut(RemovalStage<'_>) -> Result<(), PinnedError> {
    move |stage| {
        let (here, path) = match stage {
            RemovalStage::Checked => (At::Checked, None),
            RemovalStage::MovedAside { quarantined } => (At::MovedAside, Some(quarantined)),
            RemovalStage::Identified { quarantined } => (At::Identified, Some(quarantined)),
            RemovalStage::BeforeSync => (At::BeforeSync, None),
        };
        if here == at {
            action(path);
        }
        Ok(())
    }
}

/// An observer that fails at the stage `at`.
fn failing_at(at: At) -> impl FnMut(RemovalStage<'_>) -> Result<(), PinnedError> {
    move |stage| {
        let here = match stage {
            RemovalStage::Checked => At::Checked,
            RemovalStage::MovedAside { .. } => At::MovedAside,
            RemovalStage::Identified { .. } => At::Identified,
            RemovalStage::BeforeSync => At::BeforeSync,
        };
        if here == at {
            return Err(denied());
        }
        Ok(())
    }
}

fn denied() -> PinnedError {
    PinnedError::Io(std::io::ErrorKind::PermissionDenied)
}

/// The last-component swap: the original is renamed out of the way and a live file takes its name.
fn swap_in_a_live_file(root: &Path, aside: &Path) {
    fs::rename(root.join("a"), aside.join("original")).unwrap();
    fs::write(root.join("a"), b"live").unwrap();
}

/// The quarantine directories a removal left in `root`.
fn quarantines(root: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(QUARANTINE_PREFIX)
        })
        .collect();
    found.sort();
    found
}

/// The content of the object left in the only quarantine directory of `root`.
fn held_in_quarantine(root: &Path) -> Option<Vec<u8>> {
    let all = quarantines(root);
    assert!(all.len() <= 1, "{all:?}");
    fs::read(all.first()?.join(super::super::unix::removal::INSIDE)).ok()
}

/// A name-based removal: identify the entry, let `swap` run, then unlink the name.
fn naive_removal(
    pinned: &PinnedDir,
    name: &str,
    swap: impl FnOnce(),
) -> Result<(), rustix::io::Errno> {
    let authenticated = pinned.open_file(name).unwrap();
    assert_eq!(
        pinned.entry_kind(name),
        Ok(Some(crate::durable::EntryKind::File))
    );
    swap();
    drop(authenticated);
    unlinkat(pinned.handle.as_fd(), name, AtFlags::empty())
}

#[test]
fn the_swap_destroys_the_live_file_of_a_name_based_removal_so_the_hook_forces_the_race() {
    let f = fixture("baseline");
    let result = naive_removal(&f.pinned, "a", || swap_in_a_live_file(&f.root, &f.aside));
    assert_eq!(
        (
            result,
            f.root.join("a").exists(),
            fs::read(f.aside.join("original")).unwrap()
        ),
        (Ok(()), false, b"alpha".to_vec())
    );
}

#[test]
fn a_swap_of_the_last_name_after_the_check_destroys_nothing() {
    let f = fixture("swap");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Checked, |_| swap_in_a_live_file(&f.root, &f.aside)),
    );
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join("a")).unwrap(),
            fs::read(f.aside.join("original")).unwrap(),
            names(&f.pinned)
        ),
        (
            Ok(RemovalOutcome::Swapped { restored: true }),
            b"live".to_vec(),
            b"alpha".to_vec(),
            vec!["a".to_string()]
        )
    );
}

/// A swap, and whether what it put at the name is still there afterwards.
type Swap = (&'static str, fn(&Path, &Path), fn(&Path, &Path) -> bool);

#[test]
fn a_directory_a_link_or_a_fifo_swapped_in_is_put_back_untouched() {
    use std::os::unix::fs::FileTypeExt;

    let swaps: [Swap; 3] = [
        (
            "directory",
            |root, aside| {
                fs::rename(root.join("a"), aside.join("original")).unwrap();
                fs::create_dir(root.join("a")).unwrap();
                fs::write(root.join("a").join("inside"), b"inside").unwrap();
            },
            |root, _| fs::read(root.join("a").join("inside")).ok() == Some(b"inside".to_vec()),
        ),
        (
            "symlink",
            |root, aside| {
                fs::rename(root.join("a"), aside.join("original")).unwrap();
                fs::write(aside.join("target"), b"target").unwrap();
                std::os::unix::fs::symlink(aside.join("target"), root.join("a")).unwrap();
            },
            |root, aside| {
                fs::read_link(root.join("a")).ok() == Some(aside.join("target"))
                    && fs::read(aside.join("target")).ok() == Some(b"target".to_vec())
            },
        ),
        (
            "fifo",
            |root, aside| {
                fs::rename(root.join("a"), aside.join("original")).unwrap();
                let made = std::process::Command::new("mkfifo")
                    .arg(root.join("a"))
                    .status()
                    .unwrap();
                assert!(made.success());
            },
            |root, _| fs::symlink_metadata(root.join("a")).is_ok_and(|m| m.file_type().is_fifo()),
        ),
    ];
    let outcomes: Vec<_> = swaps
        .into_iter()
        .map(|(label, swap, intact)| {
            let f = fixture(label);
            let outcome = f.pinned.remove_authenticated_file_observed(
                "a",
                holds(b"alpha"),
                &mut on(At::Checked, |_| swap(&f.root, &f.aside)),
            );
            (
                label,
                outcome,
                intact(&f.root, &f.aside),
                fs::read(f.aside.join("original")).unwrap(),
            )
        })
        .collect();
    let put_back = |label| {
        (
            label,
            Ok(RemovalOutcome::Swapped { restored: true }),
            true,
            b"alpha".to_vec(),
        )
    };
    assert_eq!(
        outcomes,
        [put_back("directory"), put_back("symlink"), put_back("fifo")]
    );
}

#[test]
fn a_name_taken_again_while_the_swapped_file_is_aside_leaves_every_object_intact() {
    let f = fixture("retaken");
    let mut at_checked = on(At::Checked, |_| swap_in_a_live_file(&f.root, &f.aside));
    let mut at_moved = on(At::MovedAside, |_| {
        fs::write(f.root.join("a"), b"retaken").unwrap()
    });
    let outcome = f
        .pinned
        .remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
            at_checked(stage)?;
            at_moved(stage)
        });
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join("a")).unwrap(),
            fs::read(f.aside.join("original")).unwrap(),
            held_in_quarantine(&f.root)
        ),
        (
            Ok(RemovalOutcome::Swapped { restored: false }),
            b"retaken".to_vec(),
            b"alpha".to_vec(),
            Some(b"live".to_vec())
        )
    );
}

#[test]
fn a_swap_inside_the_quarantine_directory_before_the_identification_is_never_unlinked() {
    let f = fixture("inside");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, |quarantined| {
            let quarantined = quarantined.unwrap();
            fs::rename(quarantined, f.aside.join("moved-original")).unwrap();
            fs::write(quarantined, b"foreign").unwrap();
        }),
    );
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join("a")).unwrap(),
            fs::read(f.aside.join("moved-original")).unwrap(),
            names(&f.pinned)
        ),
        (
            Ok(RemovalOutcome::Swapped { restored: true }),
            b"foreign".to_vec(),
            b"alpha".to_vec(),
            vec!["a".to_string()]
        )
    );
}

#[test]
fn the_last_window_is_forced_and_a_foreign_file_unlinked_in_it_is_reported() {
    // No Unix primitive unlinks "this inode": after the last identification the unlink removes whatever
    // the name is bound to. A writer of the quarantine directory that wins this one race loses nothing
    // it could not destroy itself, and the removal says so instead of reporting success.
    let f = fixture("window");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Identified, |quarantined| {
            let quarantined = quarantined.unwrap();
            fs::rename(quarantined, f.aside.join("original")).unwrap();
            fs::write(quarantined, b"foreign").unwrap();
        }),
    );
    assert_eq!(
        (
            outcome,
            f.root.join("a").exists(),
            fs::read(f.aside.join("original")).unwrap(),
            quarantines(&f.root).len()
        ),
        (Ok(RemovalOutcome::Disturbed), false, b"alpha".to_vec(), 0)
    );
}

#[test]
fn a_directory_in_the_last_window_is_never_unlinked_and_goes_back() {
    let f = fixture("window-dir");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Identified, |quarantined| {
            let quarantined = quarantined.unwrap();
            fs::rename(quarantined, f.aside.join("original")).unwrap();
            fs::create_dir(quarantined).unwrap();
            fs::write(quarantined.join("inside"), b"inside").unwrap();
        }),
    );
    assert_eq!(
        (
            outcome.is_err(),
            fs::read(f.root.join("a").join("inside")).unwrap(),
            fs::read(f.aside.join("original")).unwrap(),
            quarantines(&f.root).len()
        ),
        (true, b"inside".to_vec(), b"alpha".to_vec(), 0)
    );
}

#[test]
fn a_hard_link_made_in_the_last_window_leaves_the_object_alive_under_that_name() {
    let f = fixture("window-link");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Identified, |quarantined| {
            fs::hard_link(quarantined.unwrap(), f.aside.join("extra")).unwrap();
        }),
    );
    assert_eq!(
        (
            outcome,
            names(&f.pinned),
            fs::read(f.aside.join("extra")).unwrap()
        ),
        (removed(), Vec::<String>::new(), b"alpha".to_vec())
    );
}

#[test]
fn a_name_taken_after_the_authenticated_file_moved_aside_keeps_the_new_file() {
    let f = fixture("taken-after");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, |_| {
            fs::write(f.root.join("a"), b"new").unwrap()
        }),
    );
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join("a")).unwrap(),
            names(&f.pinned)
        ),
        (removed(), b"new".to_vec(), vec!["a".to_string()])
    );
}

#[test]
fn a_name_that_vanishes_after_the_check_is_reported_and_leaves_nothing_behind() {
    let f = fixture("vanish");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Checked, |_| fs::remove_file(f.root.join("a")).unwrap()),
    );
    assert_eq!(
        (outcome, names(&f.pinned)),
        (Ok(RemovalOutcome::Vanished), Vec::<String>::new())
    );
}

#[test]
fn renaming_the_root_during_the_removal_does_not_redirect_it() {
    let f = fixture("root-renamed");
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Checked, |_| {
            fs::rename(&f.root, f.aside.join("moved-root")).unwrap();
            fs::create_dir(&f.root).unwrap();
            fs::write(f.root.join("a"), b"decoy").unwrap();
        }),
    );
    let moved = fs::read_dir(f.aside.join("moved-root")).unwrap().count();
    assert_eq!(
        (outcome, fs::read(f.root.join("a")).unwrap(), moved),
        (removed(), b"decoy".to_vec(), 0)
    );
}

#[test]
fn a_directory_swapped_or_filled_after_the_check_is_put_back_and_not_removed() {
    let f = fixture("dir-swap");
    fs::create_dir(f.root.join("d")).unwrap();
    fs::create_dir(f.root.join("e")).unwrap();
    let swapped = f.pinned.remove_empty_dir_observed(
        "d",
        &mut on(At::Checked, |_| {
            fs::rename(f.root.join("d"), f.aside.join("original-d")).unwrap();
            fs::create_dir(f.root.join("d")).unwrap();
            fs::write(f.root.join("d").join("live"), b"live").unwrap();
        }),
    );
    let filled = f.pinned.remove_empty_dir_observed(
        "e",
        &mut on(At::Checked, |_| {
            fs::write(f.root.join("e").join("late"), b"late").unwrap()
        }),
    );
    assert_eq!(
        (
            swapped,
            fs::read(f.root.join("d").join("live")).unwrap(),
            f.aside.join("original-d").is_dir(),
            filled,
            fs::read(f.root.join("e").join("late")).unwrap(),
            names(&f.pinned)
        ),
        (
            Ok(RemovalOutcome::Swapped { restored: true }),
            b"live".to_vec(),
            true,
            Ok(RemovalOutcome::NotEmpty),
            b"late".to_vec(),
            vec!["a".to_string(), "d".to_string(), "e".to_string()]
        )
    );
}

#[test]
fn the_quarantine_directory_is_closed_to_other_users_and_gone_afterwards() {
    let f = fixture("private");
    let mut seen = None;
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, |quarantined| {
            let directory = quarantined.unwrap().parent().unwrap();
            seen = Some((
                directory
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(QUARANTINE_PREFIX),
                fs::metadata(directory).unwrap().permissions().mode() & 0o777,
            ));
        }),
    );
    assert_eq!(
        (outcome, seen, quarantines(&f.root).len()),
        (removed(), Some((true, 0o700)), 0)
    );
}

#[test]
fn a_failure_after_the_move_puts_the_object_back_and_leaves_no_quarantine_directory() {
    let outcomes: Vec<_> = [At::MovedAside, At::Identified]
        .into_iter()
        .map(|at| {
            let f = fixture("rollback");
            let outcome = f.pinned.remove_authenticated_file_observed(
                "a",
                holds(b"alpha"),
                &mut failing_at(at),
            );
            (
                outcome,
                fs::read(f.root.join("a")).unwrap(),
                quarantines(&f.root).len(),
            )
        })
        .collect();
    assert_eq!(outcomes, vec![(Err(denied()), b"alpha".to_vec(), 0); 2]);
}

#[test]
fn a_failed_sync_is_reported_although_the_object_is_gone_and_a_rerun_converges() {
    let f = fixture("sync");
    let first = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut failing_at(At::BeforeSync),
    );
    let rerun = f.pinned.remove_authenticated_file("a", holds(b"alpha"));
    assert_eq!(
        (first, rerun, names(&f.pinned)),
        (
            Err(denied()),
            Err(PinnedError::NotFound),
            Vec::<String>::new()
        )
    );
}

/// A removal that "crashes" (the observer panics) once the object is in the quarantine directory.
fn crash_after_the_move(f: &Fixture) {
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        let _ = f.pinned.remove_authenticated_file_observed(
            "a",
            holds(b"alpha"),
            &mut on(At::MovedAside, |_| panic!("simulated crash")),
        );
    }));
    assert!(crashed.is_err());
}

#[test]
fn a_crash_leaves_the_object_in_quarantine_and_a_leftover_removal_finishes_it_after_authenticating()
{
    let f = fixture("crash");
    crash_after_the_move(&f);
    let left = quarantines(&f.root);
    let name = left[0].file_name().unwrap().to_owned();
    let before = (names(&f.pinned).len(), held_in_quarantine(&f.root));
    let refused = f
        .pinned
        .remove_leftover_file(&name, holds(b"something else"));
    let finished = f.pinned.remove_leftover_file(&name, holds(b"alpha"));
    assert_eq!(
        (before, refused, finished, names(&f.pinned)),
        (
            (1, Some(b"alpha".to_vec())),
            Ok(RemovalOutcome::Refused),
            removed(),
            Vec::<String>::new()
        )
    );
}

#[test]
fn a_leftover_is_taken_by_its_name_only_and_an_empty_one_is_removed() {
    let f = fixture("leftover-names");
    fs::create_dir(f.root.join(".h1q-empty")).unwrap();
    fs::set_permissions(f.root.join(".h1q-empty"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::create_dir(f.root.join("not-a-quarantine")).unwrap();
    let taken = |name: &str| f.pinned.remove_leftover_file(name, |_| Ok(true));
    assert_eq!(
        (
            taken("a"),
            taken("not-a-quarantine"),
            taken(".h1q-empty"),
            names(&f.pinned)
        ),
        (
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            Ok(RemovalOutcome::Vanished),
            vec!["a".to_string(), "not-a-quarantine".to_string()]
        )
    );
}

#[test]
fn a_foreign_object_left_in_quarantine_is_never_removed_by_a_leftover_removal() {
    let f = fixture("leftover-foreign");
    let mut at_checked = on(At::Checked, |_| swap_in_a_live_file(&f.root, &f.aside));
    let mut at_moved = on(At::MovedAside, |_| {
        fs::write(f.root.join("a"), b"retaken").unwrap()
    });
    let first = f
        .pinned
        .remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
            at_checked(stage)?;
            at_moved(stage)
        });
    let name = quarantines(&f.root)[0].file_name().unwrap().to_owned();
    // The object in the quarantine directory is the live file, not an object of the sweep.
    let refused = f.pinned.remove_leftover_file(&name, holds(b"alpha"));
    assert_eq!(
        (first, refused, held_in_quarantine(&f.root)),
        (
            Ok(RemovalOutcome::Swapped { restored: false }),
            Ok(RemovalOutcome::Refused),
            Some(b"live".to_vec())
        )
    );
}
