//! Unix recovery of what a crash or a refused put-back left in a quarantine directory, under the swaps
//! the design exists for: another actor replaces the entry inside the quarantine directory between the
//! steps of the removal. Each case forces the swap through the observer at a chosen stage and pins what
//! happens to every object. The removal of a directory is in `remove_linux_dir`; where it is not
//! available it answers `Unsupported`, which is pinned here.

use std::fs;
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::remove::{holds, names, removed};
use super::remove_unix::{
    at, denied, fixture, held_in_quarantine, on, quarantines, swap_in_a_live_file, At, Fixture,
};
use crate::durable::DirectoryDurability::NotConfirmed;
use crate::pinned::unix::removal::sync_fault;
use crate::pinned::{PinnedError, RemovalOutcome, QUARANTINE_PREFIX};

#[cfg(not(target_os = "linux"))]
#[test]
fn removing_a_directory_is_unsupported_where_the_system_cannot_tell_afterwards_and_moves_nothing() {
    // The checks that need no such signal still hold: a directory with entries is `NotEmpty`, a link is
    // refused, a missing name is not found; an empty directory is refused as unsupported before it is moved.
    let f = fixture("dir-unsupported");
    fs::create_dir(f.root.join("empty")).unwrap();
    fs::create_dir(f.root.join("filled")).unwrap();
    fs::write(f.root.join("filled").join("inside"), b"inside").unwrap();
    assert_eq!(
        (
            f.pinned.remove_empty_dir("empty"),
            f.pinned.remove_empty_dir("filled"),
            f.pinned.remove_empty_dir("missing"),
            names(&f.pinned),
            quarantines(&f.root).len()
        ),
        (
            Err(PinnedError::Unsupported),
            Ok(RemovalOutcome::NotEmpty),
            Err(PinnedError::NotFound),
            vec!["a".to_string(), "empty".to_string(), "filled".to_string()],
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
