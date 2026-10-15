//! Removal on every platform: only the authenticated object goes, and a refusal changes nothing.

use std::fs;

use super::{link_to_dir, Scratch};
use crate::durable::DirectoryDurability;
use crate::pinned::{PinnedDir, PinnedError, PinnedFile, RemovalOutcome, RemovalStage};

/// Accepts a file whose whole content is `expected`.
pub(super) fn holds(
    expected: &'static [u8],
) -> impl FnOnce(&mut PinnedFile) -> Result<bool, PinnedError> {
    move |file| Ok(file.read_at_most(64)? == expected)
}

/// What a completed removal reports on this platform.
pub(super) fn removed() -> Result<RemovalOutcome, PinnedError> {
    let durability = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    Ok(RemovalOutcome::Removed(durability))
}

pub(super) fn names(pinned: &PinnedDir) -> Vec<String> {
    let mut listed: Vec<String> = pinned
        .entries(32)
        .unwrap()
        .into_iter()
        .map(|name| name.to_string_lossy().into_owned())
        .collect();
    listed.sort();
    listed
}

#[test]
fn an_authenticated_file_is_removed_and_nothing_else_is() {
    let scratch = Scratch::new("remove");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::write(root.join("b"), b"beta").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let outcome = pinned.remove_authenticated_file("a", holds(b"alpha"));
    assert_eq!(
        (outcome, names(&pinned), fs::read(root.join("b")).unwrap()),
        (removed(), vec!["b".to_string()], b"beta".to_vec())
    );
}

#[test]
fn a_refused_authentication_a_failing_one_and_a_wrong_identity_remove_nothing() {
    let scratch = Scratch::new("refuse");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::write(root.join("other"), b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let expected = pinned.open_file("other").unwrap().identity();
    let refused = pinned.remove_authenticated_file("a", holds(b"something else"));
    let failed = pinned.remove_authenticated_file("a", |_| Err(PinnedError::Busy));
    // The bytes match, but this is not the object the caller meant.
    let wrong = pinned.remove_authenticated_file("a", move |file| Ok(file.identity() == expected));
    assert_eq!(
        (
            refused,
            failed,
            wrong,
            fs::read(root.join("a")).unwrap(),
            names(&pinned)
        ),
        (
            Ok(RemovalOutcome::Refused),
            Err(PinnedError::Busy),
            Ok(RemovalOutcome::Refused),
            b"alpha".to_vec(),
            vec!["a".to_string(), "other".to_string()]
        )
    );
}

#[test]
fn a_link_a_directory_and_a_missing_name_are_not_removed_as_files() {
    let scratch = Scratch::new("not-files");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::create_dir(aside.join("target")).unwrap();
    fs::write(aside.join("target").join("kept"), b"kept").unwrap();
    link_to_dir(&aside.join("target"), &root.join("link"));
    fs::create_dir(root.join("dir")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let remove = |name: &str| pinned.remove_authenticated_file(name, |_| Ok(true));
    assert_eq!(
        (
            remove("link"),
            remove("dir"),
            remove("missing"),
            fs::read(aside.join("target").join("kept")).unwrap(),
            names(&pinned)
        ),
        (
            Err(PinnedError::Redirected),
            Err(PinnedError::NotRegularFile),
            Err(PinnedError::NotFound),
            b"kept".to_vec(),
            vec!["dir".to_string(), "link".to_string()]
        )
    );
}

#[test]
fn an_empty_directory_is_removed_and_a_filled_one_or_a_link_is_not() {
    let scratch = Scratch::new("dirs");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::create_dir(root.join("empty")).unwrap();
    fs::create_dir(root.join("filled")).unwrap();
    fs::write(root.join("filled").join("inside"), b"inside").unwrap();
    fs::create_dir(aside.join("target")).unwrap();
    link_to_dir(&aside.join("target"), &root.join("link"));
    let pinned = PinnedDir::open_root(&root).unwrap();
    assert_eq!(
        (
            pinned.remove_empty_dir("empty"),
            pinned.remove_empty_dir("filled"),
            pinned.remove_empty_dir("link"),
            pinned.remove_empty_dir("missing"),
            fs::read(root.join("filled").join("inside")).unwrap(),
            aside.join("target").is_dir(),
            names(&pinned)
        ),
        (
            removed(),
            Ok(RemovalOutcome::NotEmpty),
            Err(PinnedError::Redirected),
            Err(PinnedError::NotFound),
            b"inside".to_vec(),
            true,
            vec!["filled".to_string(), "link".to_string()]
        )
    );
}

#[test]
fn removing_a_hard_linked_name_leaves_the_other_names() {
    let scratch = Scratch::new("hard-link");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::hard_link(root.join("a"), root.join("a-too")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let links = pinned.open_file("a").unwrap().link_count();
    let outcome = pinned.remove_authenticated_file("a", holds(b"alpha"));
    assert_eq!(
        (
            links,
            outcome,
            names(&pinned),
            fs::read(root.join("a-too")).unwrap(),
            pinned.open_file("a-too").unwrap().link_count()
        ),
        (
            Ok(2),
            removed(),
            vec!["a-too".to_string()],
            b"alpha".to_vec(),
            Ok(1)
        )
    );
}

#[test]
fn a_failure_injected_before_anything_changed_changes_nothing() {
    let scratch = Scratch::new("inject-checked");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::create_dir(root.join("d")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let denied = || Err(PinnedError::Io(std::io::ErrorKind::PermissionDenied));
    let file = pinned.remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
        if stage == RemovalStage::Checked {
            return denied();
        }
        Ok(())
    });
    let dir = pinned.remove_empty_dir_observed("d", &mut |stage| {
        if stage == RemovalStage::Checked {
            return denied();
        }
        Ok(())
    });
    let expected = Err(PinnedError::Io(std::io::ErrorKind::PermissionDenied));
    assert_eq!(
        (file, dir, names(&pinned), fs::read(root.join("a")).unwrap()),
        (
            expected,
            expected,
            vec!["a".to_string(), "d".to_string()],
            b"alpha".to_vec()
        )
    );
}
