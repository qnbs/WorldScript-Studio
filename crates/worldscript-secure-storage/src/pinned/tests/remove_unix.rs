//! Unix removal of a file, a directory and of a leftover quarantine directory under the swap the design exists for: another actor replaces the last
//! component of the name, or the entry inside the quarantine directory, between the steps of the
//! removal. Each case forces the swap through the observer at a chosen stage and pins what happens to
//! every object (by identity where the content could be mistaken). The counter-proofs show that the swap
//! really takes place: the baseline, and the asserted state of the displaced objects.

use std::fs;
use std::os::fd::AsFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

use rustix::fs::{unlinkat, AtFlags};

use super::remove::{holds, names, removed};
use super::Scratch;
use crate::durable::DirectoryDurability;
use crate::pinned::unix::removal::{make_usable, INSIDE};
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

/// The stage, and the path inside the quarantine directory once there is one.
fn at(stage: RemovalStage<'_>) -> (At, Option<&Path>) {
    match stage {
        RemovalStage::Checked => (At::Checked, None),
        RemovalStage::MovedAside { quarantined } => (At::MovedAside, Some(quarantined)),
        RemovalStage::Identified { quarantined } => (At::Identified, Some(quarantined)),
        RemovalStage::BeforeSync => (At::BeforeSync, None),
    }
}

/// An observer that runs `action` at the stage `here` and otherwise does nothing.
fn on(
    here: At,
    mut action: impl FnMut(Option<&Path>),
) -> impl FnMut(RemovalStage<'_>) -> Result<(), PinnedError> {
    move |stage| {
        let (now, path) = at(stage);
        if now == here {
            action(path);
        }
        Ok(())
    }
}

/// An observer that fails at the stage `here`.
fn failing_at(here: At) -> impl FnMut(RemovalStage<'_>) -> Result<(), PinnedError> {
    move |stage| {
        if at(stage).0 == here {
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

/// The inode of the object at `path` (not following a link): who is who, whatever the content says.
fn ino(path: &Path) -> u64 {
    fs::symlink_metadata(path).unwrap().ino()
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

/// The content of the entry left in the only quarantine directory of `root`.
fn held_in_quarantine(root: &Path) -> Option<Vec<u8>> {
    let all = quarantines(root);
    assert!(all.len() <= 1, "{all:?}");
    fs::read(all.first()?.join(INSIDE)).ok()
}

/// A name-based removal: identify the entry, let `swap` run, then unlink the name.
fn naive_removal(pinned: &PinnedDir, name: &str, swap: impl FnOnce()) -> rustix::io::Result<()> {
    let authenticated = pinned.open_file(name).unwrap();
    assert!(pinned.entry_kind(name).is_ok());
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
    let original = ino(&f.root.join("a"));
    let mut live = 0;
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Checked, |_| {
            swap_in_a_live_file(&f.root, &f.aside);
            live = ino(&f.root.join("a"));
        }),
    );
    assert_eq!(
        (
            outcome,
            ino(&f.root.join("a")) == live,
            ino(&f.aside.join("original")) == original,
            names(&f.pinned)
        ),
        (
            Ok(RemovalOutcome::Swapped { restored: true }),
            true,
            true,
            vec!["a".to_string()]
        )
    );
}

/// What a swap puts at the name, and whether it is still there afterwards.
type Swap = (&'static str, fn(&Path, &Path), fn(&Path, &Path) -> bool);

#[test]
fn whatever_is_swapped_in_is_put_back_untouched() {
    let swaps: [Swap; 4] = [
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
            |root, aside| fs::read_link(root.join("a")).ok() == Some(aside.join("target")),
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
        (
            // A file this process cannot open although it could open the authenticated one.
            "unopenable",
            |root, aside| {
                swap_in_a_live_file(root, aside);
                fs::set_permissions(root.join("a"), fs::Permissions::from_mode(0o000)).unwrap();
            },
            |root, _| fs::metadata(root.join("a")).unwrap().permissions().mode() & 0o777 == 0,
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
                quarantines(&f.root).len(),
            )
        })
        .collect();
    let put_back = |label| {
        let swapped = Ok(RemovalOutcome::Swapped { restored: true });
        (label, swapped, true, b"alpha".to_vec(), 0)
    };
    assert_eq!(
        outcomes,
        [
            put_back("directory"),
            put_back("symlink"),
            put_back("fifo"),
            put_back("unopenable")
        ]
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

/// What the actor does to the quarantine name in the last window, and what must hold afterwards.
type Window = (&'static str, fn(&Path, &Path), fn(&Fixture) -> bool);

#[test]
fn the_last_window_is_forced_and_what_it_does_is_pinned() {
    // No Unix primitive unlinks "this inode": after the last identification the unlink removes whatever
    // the name is bound to. A foreign file that wins the race is lost and reported as `Disturbed`; a
    // directory is never unlinked and goes back; a hard link made in the window leaves the object alive.
    let windows: [Window; 3] = [
        (
            "foreign-file",
            |quarantined, aside| {
                fs::rename(quarantined, aside.join("original")).unwrap();
                fs::write(quarantined, b"foreign").unwrap();
            },
            |f| !f.root.join("a").exists(),
        ),
        (
            "foreign-directory",
            |quarantined, aside| {
                fs::rename(quarantined, aside.join("original")).unwrap();
                fs::create_dir(quarantined).unwrap();
                fs::write(quarantined.join("inside"), b"inside").unwrap();
            },
            |f| fs::read(f.root.join("a").join("inside")).ok() == Some(b"inside".to_vec()),
        ),
        (
            "hard-link",
            |quarantined, aside| fs::hard_link(quarantined, aside.join("original")).unwrap(),
            |f| !f.root.join("a").exists(),
        ),
    ];
    let outcomes: Vec<_> = windows
        .into_iter()
        .map(|(label, action, expected)| {
            let f = fixture(label);
            let outcome = f.pinned.remove_authenticated_file_observed(
                "a",
                holds(b"alpha"),
                &mut on(At::Identified, |quarantined| {
                    action(quarantined.unwrap(), &f.aside)
                }),
            );
            (
                label,
                outcome.is_ok(),
                matches!(outcome, Ok(RemovalOutcome::Disturbed)),
                expected(&f),
                fs::read(f.aside.join("original")).unwrap(),
                quarantines(&f.root).len(),
            )
        })
        .collect();
    let alpha = || b"alpha".to_vec();
    assert_eq!(
        outcomes,
        [
            ("foreign-file", true, true, true, alpha(), 0),
            ("foreign-directory", false, false, true, alpha(), 0),
            ("hard-link", true, false, true, alpha(), 0)
        ]
    );
}

#[test]
fn a_name_taken_after_the_move_keeps_the_new_file_and_a_vanished_name_is_reported() {
    let taken = fixture("taken-after");
    let after = taken.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, |_| {
            fs::write(taken.root.join("a"), b"new").unwrap()
        }),
    );
    let gone = fixture("vanish");
    let vanished = gone.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::Checked, |_| {
            fs::remove_file(gone.root.join("a")).unwrap()
        }),
    );
    assert_eq!(
        (
            after,
            fs::read(taken.root.join("a")).unwrap(),
            vanished,
            names(&gone.pinned)
        ),
        (
            removed(),
            b"new".to_vec(),
            Ok(RemovalOutcome::Vanished),
            Vec::<String>::new()
        )
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
fn the_quarantine_directory_is_private_usable_under_any_umask_and_gone_afterwards() {
    let f = fixture("private");
    let mut seen = None;
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, |quarantined| {
            let directory = quarantined.unwrap().parent().unwrap();
            seen = Some(fs::metadata(directory).unwrap().permissions().mode() & 0o777);
        }),
    );
    // A restrictive umask leaves a directory that nothing can be moved into; it is made usable.
    let under_umask = format!("{QUARANTINE_PREFIX}{}", "a".repeat(32));
    fs::create_dir(f.root.join(&under_umask)).unwrap();
    fs::set_permissions(f.root.join(&under_umask), fs::Permissions::from_mode(0o500)).unwrap();
    let made = make_usable(&f.pinned.handle, under_umask.as_ref());
    let mode = fs::metadata(f.root.join(&under_umask))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(
        (
            outcome,
            seen,
            made,
            mode & 0o777,
            quarantines(&f.root).len()
        ),
        (removed(), Some(0o700), Ok(()), 0o700, 1)
    );
}

#[test]
fn a_failure_at_any_stage_leaves_the_directory_as_it_was_found() {
    let outcomes: Vec<_> = [At::Checked, At::MovedAside, At::Identified]
        .into_iter()
        .map(|here| {
            let f = fixture("rollback");
            let outcome = f.pinned.remove_authenticated_file_observed(
                "a",
                holds(b"alpha"),
                &mut failing_at(here),
            );
            (
                outcome,
                fs::read(f.root.join("a")).unwrap(),
                quarantines(&f.root).len(),
            )
        })
        .collect();
    assert_eq!(outcomes, vec![(Err(denied()), b"alpha".to_vec(), 0); 3]);
}

#[test]
fn a_failed_sync_is_reported_for_a_removal_and_for_a_put_back_and_is_repeated_by_itself() {
    let removal = fixture("sync-removal");
    let first = removal.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut failing_at(At::BeforeSync),
    );
    // A rerun finds nothing to do and does not sync again; the directory sync is repeated by itself.
    let rerun = removal
        .pinned
        .remove_authenticated_file("a", holds(b"alpha"));
    let put_back = fixture("sync-put-back");
    let mut at_checked = on(At::Checked, |_| {
        swap_in_a_live_file(&put_back.root, &put_back.aside)
    });
    let swapped =
        put_back
            .pinned
            .remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
                at_checked(stage)?;
                failing_at(At::BeforeSync)(stage)
            });
    assert_eq!(
        (
            first,
            rerun,
            removal.pinned.sync(),
            swapped,
            fs::read(put_back.root.join("a")).unwrap()
        ),
        (
            Err(denied()),
            Err(PinnedError::NotFound),
            Ok(DirectoryDurability::Confirmed),
            Err(denied()),
            b"live".to_vec()
        )
    );
}

/// The quarantine directory loses its search permission once the entry is inside: the inspection fails
/// and the entry cannot be put back either.
fn lock_the_quarantine(quarantined: Option<&Path>) {
    let directory = quarantined.unwrap().parent().unwrap();
    fs::set_permissions(directory, fs::Permissions::from_mode(0o000)).unwrap();
}

#[test]
fn an_error_after_the_move_that_cannot_be_rolled_back_is_reported_as_stranded() {
    assert!(
        !rustix::process::geteuid().is_root(),
        "the permission checks of this case do not apply to root; run the tests as a normal user"
    );
    let f = fixture("stranded");
    let original = ino(&f.root.join("a"));
    let outcome = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, lock_the_quarantine),
    );
    let left = quarantines(&f.root);
    // Opened up again, the entry is where the outcome said it is, and is the authenticated object.
    fs::set_permissions(&left[0], fs::Permissions::from_mode(0o700)).unwrap();
    let same_object = ino(&left[0].join(INSIDE)) == original;
    assert_eq!(
        (outcome, f.root.join("a").exists(), left.len(), same_object),
        (
            Ok(RemovalOutcome::Stranded { cause: denied() }),
            false,
            1,
            true
        )
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
fn an_empty_directory_swapped_in_the_last_window_is_reported_as_disturbed() {
    let f = fixture("window-empty-dir");
    fs::create_dir(f.root.join("d")).unwrap();
    let original = ino(&f.root.join("d"));
    let outcome = f.pinned.remove_empty_dir_observed(
        "d",
        &mut on(At::Identified, |quarantined| {
            let quarantined = quarantined.unwrap();
            fs::rename(quarantined, f.aside.join("original-d")).unwrap();
            fs::create_dir(quarantined).unwrap();
        }),
    );
    assert_eq!(
        (
            outcome,
            f.root.join("d").exists(),
            ino(&f.aside.join("original-d")) == original,
            quarantines(&f.root).len()
        ),
        (Ok(RemovalOutcome::Disturbed), false, true, 0)
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
fn a_leftover_is_taken_by_its_generated_name_only_and_an_empty_one_is_removed() {
    let f = fixture("leftover-names");
    let generated = format!("{QUARANTINE_PREFIX}{}", "0".repeat(32));
    for name in [generated.as_str(), ".h1q-empty", "not-a-quarantine"] {
        fs::create_dir(f.root.join(name)).unwrap();
        fs::set_permissions(f.root.join(name), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let taken = |name: &str| f.pinned.remove_leftover_file(name, |_| Ok(true));
    assert_eq!(
        (
            taken("a"),
            taken("not-a-quarantine"),
            taken(".h1q-empty"),
            taken(&format!("{QUARANTINE_PREFIX}{}", "G".repeat(32))),
            taken(&generated),
            names(&f.pinned)
        ),
        (
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            Ok(RemovalOutcome::Vanished),
            vec![
                ".h1q-empty".to_string(),
                "a".to_string(),
                "not-a-quarantine".to_string()
            ]
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

#[test]
fn a_stranded_entry_is_finished_by_the_leftover_removal_after_authenticating_it() {
    assert!(
        !rustix::process::geteuid().is_root(),
        "the permission checks of this case do not apply to root; run the tests as a normal user"
    );
    let f = fixture("stranded-recovery");
    let stranded = f.pinned.remove_authenticated_file_observed(
        "a",
        holds(b"alpha"),
        &mut on(At::MovedAside, lock_the_quarantine),
    );
    let left = quarantines(&f.root);
    fs::set_permissions(&left[0], fs::Permissions::from_mode(0o700)).unwrap();
    let name = left[0].file_name().unwrap().to_owned();
    let refused = f
        .pinned
        .remove_leftover_file(&name, holds(b"something else"));
    let finished = f.pinned.remove_leftover_file(&name, holds(b"alpha"));
    assert_eq!(
        (stranded.is_ok(), refused, finished, names(&f.pinned)),
        (
            true,
            Ok(RemovalOutcome::Refused),
            removed(),
            Vec::<String>::new()
        )
    );
}
