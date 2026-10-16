//! Unix removal of a directory, and of what a crash or a refused put-back left in a quarantine
//! directory, under the swaps the design exists for: another actor replaces the directory, or the entry
//! inside the quarantine directory, between the steps of the removal. Each case forces the swap through
//! the observer at a chosen stage and pins what happens to every object.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::remove::{holds, names, removed};
use super::remove_unix::{
    at, denied, fixture, held_in_quarantine, ino, on, quarantines, swap_in_a_live_file, At, Fixture,
};
use crate::durable::DirectoryDurability::NotConfirmed;
use crate::pinned::unix::removal::sync_fault;
use crate::pinned::{PinnedError, RemovalOutcome, QUARANTINE_PREFIX};

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

#[test]
fn a_non_empty_directory_swapped_in_the_last_window_is_not_reported_as_not_empty() {
    // The refusal to remove a directory with entries is about the directory an actor put there, not about
    // the authenticated one, which the actor moved away. What is there goes back under the name, and
    // the outcome is tampering, not `NotEmpty`.
    let f = fixture("window-filled-dir");
    fs::create_dir(f.root.join("d")).unwrap();
    let original = ino(&f.root.join("d"));
    let outcome = f.pinned.remove_empty_dir_observed(
        "d",
        &mut on(At::Identified, |quarantined| {
            let quarantined = quarantined.unwrap();
            fs::rename(quarantined, f.aside.join("original-d")).unwrap();
            fs::create_dir(quarantined).unwrap();
            fs::write(quarantined.join("late"), b"late").unwrap();
        }),
    );
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join("d").join("late")).ok(),
            ino(&f.aside.join("original-d")) == original,
            quarantines(&f.root).len()
        ),
        (
            Ok(RemovalOutcome::Disturbed),
            Some(b"late".to_vec()),
            true,
            0
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
fn a_leftover_whose_quarantine_directory_could_not_be_synced_is_not_confirmed() {
    // The leftover removal changes the quarantine directory it unlinks in, like any removal, and says
    // `NotConfirmed` if that directory could not be synced (modelled through the seam of the removal).
    let f = fixture("leftover-sync");
    crash_after_the_move(&f);
    let name = quarantines(&f.root)[0].file_name().unwrap().to_owned();
    let (outcome, syncs) =
        sync_fault::during(Some(PinnedError::Io(std::io::ErrorKind::Other)), || {
            f.pinned.remove_leftover_file(&name, holds(b"alpha"))
        });
    assert_eq!(
        (outcome, syncs, names(&f.pinned), quarantines(&f.root).len()),
        (
            Ok(RemovalOutcome::Removed(NotConfirmed)),
            1,
            Vec::<String>::new(),
            0
        )
    );
}

#[test]
fn a_leftover_is_taken_by_its_generated_name_only_and_an_empty_one_is_removed() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("leftover-names");
    let generated = format!("{QUARANTINE_PREFIX}{}", "0".repeat(32));
    for name in [generated.as_str(), ".h1q-empty", "not-a-quarantine"] {
        fs::create_dir(f.root.join(name)).unwrap();
        fs::set_permissions(f.root.join(name), fs::Permissions::from_mode(0o700)).unwrap();
    }
    let taken = |name: &str| f.pinned.remove_leftover_file(name, |_| Ok(true));
    // Right prefix, wrong digits: too short, too long, upper case, not hexadecimal. Refused by the name
    // alone, before anything is opened.
    let wrong_digits = [
        "0".repeat(31),
        "0".repeat(33),
        "A".repeat(32),
        "G".repeat(32),
    ]
    .map(|digits| taken(&format!("{QUARANTINE_PREFIX}{digits}")));
    assert_eq!(
        (
            taken("a"),
            taken("not-a-quarantine"),
            taken(".h1q-empty"),
            wrong_digits,
            taken(&generated),
            names(&f.pinned)
        ),
        (
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            Err(PinnedError::InvalidName),
            [Err(PinnedError::InvalidName); 4],
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
    // The put-back is blocked (the name is taken again) and the observer fails: the entry is proved to
    // be in the quarantine directory, which is what `Stranded` says, and runs the same for root.
    let f = fixture("stranded-recovery");
    let stranded =
        f.pinned
            .remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
                if at(stage).0 == At::MovedAside {
                    fs::write(f.root.join("a"), b"taken").unwrap();
                    return Err(denied());
                }
                Ok(())
            });
    let name = quarantines(&f.root)[0].file_name().unwrap().to_owned();
    let refused = f
        .pinned
        .remove_leftover_file(&name, holds(b"something else"));
    let finished = f.pinned.remove_leftover_file(&name, holds(b"alpha"));
    assert_eq!(
        (stranded, refused, finished, names(&f.pinned)),
        (
            Ok(RemovalOutcome::Stranded { cause: denied() }),
            Ok(RemovalOutcome::Refused),
            removed(),
            vec!["a".to_string()]
        )
    );
}

#[test]
fn a_link_left_in_a_quarantine_directory_is_refused_and_not_followed() {
    use std::os::unix::fs::PermissionsExt;
    let f = fixture("leftover-link");
    let name = format!("{QUARANTINE_PREFIX}{}", "1".repeat(32));
    fs::create_dir(f.root.join(&name)).unwrap();
    fs::set_permissions(f.root.join(&name), fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(f.aside.join("target"), b"target").unwrap();
    std::os::unix::fs::symlink(f.aside.join("target"), f.root.join(&name).join("x")).unwrap();
    // Whatever the authentication would say, an entry that is not a regular file is never handed to it.
    let outcome = f.pinned.remove_leftover_file(&name, |_| Ok(true));
    assert_eq!(
        (
            outcome,
            fs::read_link(f.root.join(&name).join("x")).ok(),
            fs::read(f.aside.join("target")).unwrap()
        ),
        (
            Ok(RemovalOutcome::Refused),
            Some(f.aside.join("target")),
            b"target".to_vec()
        )
    );
}
