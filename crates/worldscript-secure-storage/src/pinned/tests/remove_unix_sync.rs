//! The quarantine directory is synced whenever an entry moved through it, and a sync that fails is
//! reported where the outcome promises something and nowhere else. An `fsync` error on a directory
//! cannot be provoked portably, so the cases with a failing sync fail it through the seam of the removal
//! ([`sync_fault`]): that models the failure. The cases without a failure run the real sync, and the
//! seam counts how often it was asked for.

use std::cell::Cell;
use std::fs;
use std::io::ErrorKind;

use super::remove::holds;
use super::remove_unix::{
    at, denied, fixture, held_in_quarantine, quarantines, swap_in_a_live_file, At, Fixture,
};
use crate::durable::DirectoryDurability::{Confirmed, NotConfirmed};
use crate::pinned::unix::removal::sync_fault;
use crate::pinned::{PinnedError, RemovalOutcome, RemovalStage};

/// What the actor and the observer do during one removal of `a` ("alpha").
#[derive(Clone, Copy, Debug, PartialEq)]
enum Scene {
    /// Nothing: the file is authenticated and removed.
    Removal,
    /// A live file takes the name after the check: it is moved aside, found to be foreign and put back.
    PutBack,
    /// As `PutBack`, and the name is taken again while the live file is aside: it stays aside.
    KeptAside,
    /// As `KeptAside`, and the quarantine directory is renamed away: the entry is not where the outcome
    /// would say.
    Tampered,
    /// A directory (not the kind of entry that was authenticated) takes the name after the check and
    /// the name is taken again while it is aside, so it stays aside, untouched: the control for the next.
    ForeignKept,
    /// As `ForeignKept`, and an actor replaces the entry after it was inspected and before it is looked
    /// at again: the entry is not where the outcome would say.
    ForeignReplaced,
    /// The observer fails once the entry is identified: it is put back and the error returned.
    RolledBack,
    /// The observer fails while the entry is aside and the name is taken again: it cannot go back.
    Stranded,
    /// The name is gone after the check: nothing is moved.
    Vanished,
    /// An actor removes the entry once it is aside, before it is looked at.
    GoneBeforeInspection,
    /// An actor removes the entry once it is identified, before it is unlinked.
    GoneBeforeUnlink,
    /// The observer fails at the check, before anything is moved.
    FailedEarly,
}

fn sync_failure() -> PinnedError {
    PinnedError::Io(ErrorKind::Other)
}

/// The doing of `scene` at one stage of the removal.
fn act(
    scene: Scene,
    f: &Fixture,
    parent_synced: &Cell<bool>,
    stage: RemovalStage<'_>,
) -> Result<(), PinnedError> {
    let (now, inside) = at(stage);
    let name = f.root.join("a");
    match (scene, now) {
        (_, At::BeforeSync) => parent_synced.set(true),
        (Scene::PutBack | Scene::KeptAside | Scene::Tampered, At::Checked) => {
            swap_in_a_live_file(&f.root, &f.aside);
        }
        (Scene::Vanished, At::Checked) => fs::remove_file(name).unwrap(),
        (Scene::GoneBeforeInspection, At::MovedAside)
        | (Scene::GoneBeforeUnlink, At::Identified) => {
            fs::remove_file(inside.unwrap()).unwrap();
        }
        (Scene::FailedEarly, At::Checked) | (Scene::RolledBack, At::Identified) => {
            return Err(denied());
        }
        (Scene::ForeignKept | Scene::ForeignReplaced, At::Checked) => {
            fs::rename(&name, f.aside.join("original")).unwrap();
            fs::create_dir(&name).unwrap();
        }
        (Scene::ForeignKept, At::MovedAside) => fs::write(&name, b"retaken").unwrap(),
        (Scene::ForeignReplaced, At::MovedAside) => {
            fs::write(&name, b"retaken").unwrap();
            sync_fault::replace_at_next_sync(inside.unwrap().to_path_buf());
        }
        (Scene::KeptAside, At::MovedAside) => fs::write(name, b"retaken").unwrap(),
        (Scene::Tampered, At::MovedAside) => {
            fs::rename(inside.unwrap().parent().unwrap(), f.aside.join("held")).unwrap();
            fs::write(name, b"retaken").unwrap();
        }
        (Scene::Stranded, At::MovedAside) => {
            fs::write(name, b"taken").unwrap();
            return Err(denied());
        }
        _ => {}
    }
    Ok(())
}

/// What one removal did and left.
#[derive(Clone, Debug, PartialEq)]
struct Report {
    outcome: Result<RemovalOutcome, PinnedError>,
    /// How often the quarantine directory was synced.
    syncs: usize,
    /// Whether the removal got as far as syncing the parent.
    parent_synced: bool,
    /// What the name holds afterwards.
    name: Option<Vec<u8>>,
    /// The entry kept in the quarantine directory that is left, if there is one.
    kept: Option<Vec<u8>>,
    /// How many quarantine directories are left.
    left: usize,
}

fn run(scene: Scene, failure: Option<PinnedError>) -> Report {
    let f = fixture("sync");
    let parent_synced = Cell::new(false);
    let (outcome, syncs) = sync_fault::during(failure, || {
        f.pinned
            .remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
                act(scene, &f, &parent_synced, stage)
            })
    });
    Report {
        outcome,
        syncs,
        parent_synced: parent_synced.get(),
        name: fs::read(f.root.join("a")).ok(),
        kept: held_in_quarantine(&f.root),
        left: quarantines(&f.root).len(),
    }
}

type Expected = (Scene, Result<RemovalOutcome, PinnedError>, usize, bool);

#[test]
fn every_move_through_the_quarantine_directory_ends_with_one_sync_of_it() {
    // A removal, a put-back, a kept entry, a rollback, a stranded entry and an entry an actor removed
    // again each changed the quarantine directory, and the sync of the parent does not cover that.
    // Nothing moved, nothing to sync there.
    let expected: [Expected; 12] = [
        (
            Scene::Removal,
            Ok(RemovalOutcome::Removed(Confirmed)),
            1,
            true,
        ),
        (
            Scene::PutBack,
            Ok(RemovalOutcome::Swapped { restored: true }),
            1,
            true,
        ),
        (
            Scene::KeptAside,
            Ok(RemovalOutcome::Swapped { restored: false }),
            1,
            true,
        ),
        (Scene::Tampered, Ok(RemovalOutcome::Disturbed), 1, true),
        (
            Scene::ForeignKept,
            Ok(RemovalOutcome::Swapped { restored: false }),
            1,
            true,
        ),
        (
            Scene::ForeignReplaced,
            Ok(RemovalOutcome::Disturbed),
            1,
            true,
        ),
        (Scene::RolledBack, Err(denied()), 1, true),
        (
            Scene::Stranded,
            Ok(RemovalOutcome::Stranded { cause: denied() }),
            1,
            true,
        ),
        (Scene::Vanished, Ok(RemovalOutcome::Vanished), 0, true),
        // The entry was moved here, so this directory changed, although an actor removed the entry again.
        (
            Scene::GoneBeforeInspection,
            Ok(RemovalOutcome::Vanished),
            1,
            true,
        ),
        (
            Scene::GoneBeforeUnlink,
            Ok(RemovalOutcome::Vanished),
            1,
            true,
        ),
        (Scene::FailedEarly, Err(denied()), 0, false),
    ];
    let actual = expected.map(|(scene, ..)| {
        let report = run(scene, None);
        (scene, report.outcome, report.syncs, report.parent_synced)
    });
    assert_eq!(actual, expected);
}

#[test]
fn a_failed_sync_of_the_quarantine_directory_is_an_error_after_a_put_back_a_kept_entry_and_a_vanished_one(
) {
    // The rename decided where the entry is, whatever the sync did: it is back, aside or gone, and the
    // parent was synced. Only the result differs, and it is the sync error, not `Disturbed` or `Stranded`.
    for scene in [
        Scene::PutBack,
        Scene::KeptAside,
        Scene::GoneBeforeInspection,
        Scene::GoneBeforeUnlink,
    ] {
        let clean = run(scene, None);
        let failed = run(scene, Some(sync_failure()));
        let (name, kept, left) = match scene {
            Scene::PutBack => (Some(b"live".to_vec()), None, 0),
            Scene::KeptAside => (Some(b"retaken".to_vec()), Some(b"live".to_vec()), 1),
            _ => (None, None, 0),
        };
        assert_eq!(
            (failed.name.clone(), failed.kept.clone(), failed.left),
            (name, kept, left),
            "{scene:?}"
        );
        assert_eq!(
            failed,
            Report {
                outcome: Err(sync_failure()),
                ..clean
            },
            "{scene:?}"
        );
    }
}

#[test]
fn a_failed_sync_changes_no_outcome_that_reports_a_failure_or_tampering() {
    // `RolledBack` and `Stranded` report a failure by its cause (the sync is best effort and does not
    // replace it); `Disturbed` is tampering and wins; and where nothing moved there is nothing to sync.
    for scene in [
        Scene::RolledBack,
        Scene::Stranded,
        Scene::Tampered,
        Scene::ForeignReplaced,
        Scene::Vanished,
        Scene::FailedEarly,
    ] {
        assert_eq!(
            run(scene, Some(sync_failure())),
            run(scene, None),
            "{scene:?}"
        );
    }
}

#[test]
fn a_removal_whose_quarantine_directory_could_not_be_synced_is_not_confirmed() {
    let failed = run(Scene::Removal, Some(sync_failure()));
    assert_eq!(
        (failed.outcome, failed.syncs, failed.name, failed.left),
        (Ok(RemovalOutcome::Removed(NotConfirmed)), 1, None, 0)
    );
}
