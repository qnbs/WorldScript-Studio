//! Linux removal of a directory under the swaps the design exists for: another actor replaces the
//! directory, or the entry inside the quarantine directory, between the steps of the removal. Each case
//! forces the swap through the observer at a chosen stage and pins what happens to every object. Other
//! Unix systems answer `Unsupported` (see `remove_unix_dir`), because they cannot tell afterwards, without
//! writing into the directory, that the open one is the directory that was removed.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::panic::{catch_unwind, AssertUnwindSafe};

use super::remove::{names, removed};
use super::remove_unix::{fixture, ino, on, quarantines, At};
use crate::pinned::unix::removal::INSIDE;
use crate::pinned::{RemovalOutcome, QUARANTINE_PREFIX};

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

#[test]
fn an_empty_directory_left_by_a_crashed_directory_removal_is_finished_by_the_leftover_recovery() {
    let f = fixture("crash-dir");
    fs::create_dir(f.root.join("d")).unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        let _ = f
            .pinned
            .remove_empty_dir_observed("d", &mut on(At::MovedAside, |_| panic!("simulated crash")));
    }));
    assert!(crashed.is_err());
    let left = quarantines(&f.root);
    let name = left[0].file_name().unwrap().to_owned();
    let before = (left[0].join(INSIDE).is_dir(), f.root.join("d").exists());
    // An empty directory holds nothing to authenticate: the callback is never asked.
    let finished = f.pinned.remove_leftover_file(&name, |_| panic!("asked"));
    assert_eq!(
        (
            before,
            finished,
            names(&f.pinned),
            quarantines(&f.root).len()
        ),
        ((true, false), removed(), vec!["a".to_string()], 0)
    );
}

#[test]
fn a_directory_with_entries_left_in_a_quarantine_directory_is_never_removed_by_the_recovery() {
    let f = fixture("leftover-filled-dir");
    let name = format!("{QUARANTINE_PREFIX}{}", "3".repeat(32));
    fs::create_dir(f.root.join(&name)).unwrap();
    fs::set_permissions(f.root.join(&name), fs::Permissions::from_mode(0o700)).unwrap();
    fs::create_dir(f.root.join(&name).join(INSIDE)).unwrap();
    fs::write(f.root.join(&name).join(INSIDE).join("inside"), b"inside").unwrap();
    let outcome = f.pinned.remove_leftover_file(&name, |_| Ok(true));
    assert_eq!(
        (
            outcome,
            fs::read(f.root.join(&name).join(INSIDE).join("inside")).unwrap()
        ),
        (Ok(RemovalOutcome::NotEmpty), b"inside".to_vec())
    );
}
