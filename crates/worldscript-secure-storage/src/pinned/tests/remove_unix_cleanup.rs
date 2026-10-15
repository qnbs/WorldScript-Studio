//! The cleanup of a quarantine directory by its name removes the directory that was made, and only when
//! it is empty. A name that leads somewhere else by then (an actor renamed the directory away and put
//! one of its own at the name) is left alone, and so is everything when no identity was taken. The check
//! narrows the race and does not close it (`rmdir` takes a name); these cases pin what it does decide.

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use super::remove_unix::fixture;
use crate::pinned::unix::removal::remove_if_named;
use crate::pinned::ObjectIdentity;

fn identity(path: &Path) -> ObjectIdentity {
    let metadata = fs::symlink_metadata(path).unwrap();
    ObjectIdentity::new(metadata.dev(), u128::from(metadata.ino()))
}

/// What is left after `remove_if_named` was asked about the directory `q` of a fixture whose `setup`
/// ran: whether it reported a removal, whether the name still leads to a directory, and whether the
/// directory that was made is still there (renamed away).
fn cleanup(
    label: &str,
    setup: impl FnOnce(&Path, &Path),
    expected: impl FnOnce(&Path) -> Option<ObjectIdentity>,
) -> (bool, bool, bool) {
    let f = fixture(label);
    let q = f.root.join("q");
    fs::create_dir(&q).unwrap();
    let wanted = expected(&q);
    setup(&q, &f.aside);
    let removed = remove_if_named(&f.pinned.handle, "q".as_ref(), wanted);
    (removed, q.is_dir(), f.aside.join("made").is_dir())
}

#[test]
fn only_the_directory_that_was_made_is_removed_and_only_when_empty() {
    let same = cleanup("same", |_, _| {}, |q| Some(identity(q)));
    // The directory was renamed away and an empty one of the actor's took its name.
    let replaced = cleanup(
        "replaced",
        |q, aside| {
            fs::rename(q, aside.join("made")).unwrap();
            fs::create_dir(q).unwrap();
        },
        |q| Some(identity(q)),
    );
    // The directory is not empty: `rmdir` refuses, and nothing of it is touched.
    let occupied = cleanup(
        "occupied",
        |q, _| fs::write(q.join("entry"), b"x").unwrap(),
        |q| Some(identity(q)),
    );
    // No identity was taken: nothing is removed, however plausible the name looks.
    let unknown = cleanup("unknown", |_, _| {}, |_| None);
    assert_eq!(
        (same, replaced, occupied, unknown),
        (
            (true, false, false),
            (false, true, true),
            (false, true, false),
            (false, true, false)
        )
    );
}
