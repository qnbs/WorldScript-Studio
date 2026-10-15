//! The non-destructive primitives: opening, listing, reading and refusing links.

use std::fs;

use super::{link_to_dir, remove_dir_link, Scratch};
use crate::durable::EntryKind;
use crate::pinned::{PinnedDir, PinnedError};

#[test]
fn a_directory_opens_names_itself_and_lists_its_entries() {
    let scratch = Scratch::new("open");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    assert_eq!(
        (
            pinned.is_still_named(),
            pinned.entries(4),
            pinned.path() == fs::canonicalize(&root).unwrap()
        ),
        (Ok(true), Ok(vec!["a".into()]), true)
    );
}

#[test]
fn a_name_that_is_not_one_plain_component_is_refused_by_every_operation() {
    let scratch = Scratch::new("names");
    let pinned = PinnedDir::open_root(&scratch.root()).unwrap();
    let outcomes: Vec<[Result<(), PinnedError>; 3]> =
        ["", ".", "..", "a/b", "a/", "/a", "./a", "a\0b"]
            .into_iter()
            .map(|name| {
                [
                    pinned.open_dir(name).map(|_| ()),
                    pinned.entry_kind(name).map(|_| ()),
                    pinned.open_file(name).map(|_| ()),
                ]
            })
            .collect();
    assert!(
        outcomes
            .iter()
            .all(|refused| refused == &[Err(PinnedError::InvalidName); 3]),
        "{outcomes:?}"
    );
}

#[cfg(windows)]
#[test]
fn a_windows_name_that_the_system_would_reinterpret_is_refused() {
    let scratch = Scratch::new("reserved");
    let pinned = PinnedDir::open_root(&scratch.root()).unwrap();
    // A data stream, a device name, a name Win32 normalises, and a name of wildcard characters.
    let refused: Vec<Result<(), PinnedError>> = [
        "a:stream",
        "con",
        "NUL.txt",
        "Com1",
        "lpt9",
        "COM\u{b9}",
        "lpt\u{b2}.txt",
        "a.",
        "a ",
        "a*",
        "a?",
        "a<b",
        "a|b",
        "a\"b",
    ]
    .into_iter()
    .map(|name| pinned.open_file(name).map(|_| ()))
    .collect();
    assert!(
        refused.iter().all(|r| r == &Err(PinnedError::InvalidName)),
        "{refused:?}"
    );
}

/// What each primitive says about one entry.
#[derive(Debug, PartialEq)]
struct Verdicts {
    dir: Result<(), PinnedError>,
    file: Result<(), PinnedError>,
    kind: Result<Option<EntryKind>, PinnedError>,
}

fn verdicts(pinned: &PinnedDir, name: &str) -> Verdicts {
    Verdicts {
        dir: pinned.open_dir(name).map(|_| ()),
        file: pinned.open_file(name).map(|_| ()),
        kind: pinned.entry_kind(name),
    }
}

#[test]
fn a_link_or_an_entry_of_another_kind_is_refused_and_never_followed() {
    let scratch = Scratch::new("kinds");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::write(root.join("file"), b"alpha").unwrap();
    fs::create_dir(root.join("dir")).unwrap();
    fs::write(aside.join("outside"), b"outside").unwrap();
    fs::create_dir(aside.join("outside-dir")).unwrap();
    link_to_dir(&aside.join("outside-dir"), &root.join("link-to-dir"));
    let pinned = PinnedDir::open_root(&root).unwrap();
    let observed = [
        ("file", verdicts(&pinned, "file")),
        ("dir", verdicts(&pinned, "dir")),
        ("link-to-dir", verdicts(&pinned, "link-to-dir")),
        ("missing", verdicts(&pinned, "missing")),
    ];
    assert_eq!(
        observed,
        [
            (
                "file",
                Verdicts {
                    dir: Err(PinnedError::NotDirectory),
                    file: Ok(()),
                    kind: Ok(Some(EntryKind::File)),
                }
            ),
            (
                "dir",
                Verdicts {
                    dir: Ok(()),
                    file: Err(PinnedError::NotRegularFile),
                    kind: Ok(Some(EntryKind::Directory)),
                }
            ),
            (
                "link-to-dir",
                Verdicts {
                    dir: Err(PinnedError::Redirected),
                    file: Err(PinnedError::Redirected),
                    kind: Ok(Some(EntryKind::Link)),
                }
            ),
            (
                "missing",
                Verdicts {
                    dir: Err(PinnedError::NotFound),
                    file: Err(PinnedError::NotFound),
                    kind: Ok(None),
                }
            ),
        ]
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_to_a_file_and_a_fifo_are_refused() {
    let scratch = Scratch::new("special");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::write(aside.join("outside"), b"outside").unwrap();
    std::os::unix::fs::symlink(aside.join("outside"), root.join("link-to-file")).unwrap();
    let made = std::process::Command::new("mkfifo")
        .arg(root.join("fifo"))
        .status()
        .unwrap();
    assert!(made.success());
    let pinned = PinnedDir::open_root(&root).unwrap();
    assert_eq!(
        (
            verdicts(&pinned, "link-to-file"),
            verdicts(&pinned, "fifo").file,
            verdicts(&pinned, "fifo").kind
        ),
        (
            Verdicts {
                dir: Err(PinnedError::Redirected),
                file: Err(PinnedError::Redirected),
                kind: Ok(Some(EntryKind::Link)),
            },
            Err(PinnedError::NotRegularFile),
            Ok(Some(EntryKind::Other))
        )
    );
}

#[test]
fn the_root_itself_is_not_followed_if_it_is_a_link() {
    let scratch = Scratch::new("root-link");
    let aside = scratch.aside();
    let real = aside.join("real");
    fs::create_dir(&real).unwrap();
    let linked = scratch.path().join("linked");
    link_to_dir(&real, &linked);
    fs::write(scratch.path().join("plain"), b"x").unwrap();
    let opened = |path: &std::path::Path| PinnedDir::open_root(path).map(|_| ());
    assert_eq!(
        (
            opened(&linked),
            opened(&scratch.path().join("plain")),
            opened(&scratch.path().join("absent"))
        ),
        (
            Err(PinnedError::Redirected),
            Err(PinnedError::NotDirectory),
            Err(PinnedError::NotFound)
        )
    );
}

#[test]
fn a_listing_is_bounded_by_the_limit_the_caller_gives() {
    let scratch = Scratch::new("limit");
    let root = scratch.root();
    for name in ["a", "b", "c"] {
        fs::write(root.join(name), b"").unwrap();
    }
    let pinned = PinnedDir::open_root(&root).unwrap();
    let empty = PinnedDir::open_root(&scratch.aside()).unwrap();
    let mut listed = pinned.entries(3).unwrap();
    listed.sort();
    assert_eq!(
        (
            listed,
            pinned.entries(2),
            empty.entries(0),
            pinned.entries(0)
        ),
        (
            vec!["a".into(), "b".into(), "c".into()],
            Err(PinnedError::TooManyEntries),
            Ok(Vec::new()),
            Err(PinnedError::TooManyEntries)
        )
    );
}

#[test]
fn a_file_is_read_only_up_to_the_bound_and_counts_its_hard_links() {
    let scratch = Scratch::new("read");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let mut file = pinned.open_file("a").unwrap();
    let before = file.link_count();
    fs::hard_link(root.join("a"), root.join("a-too")).unwrap();
    let after = file.link_count();
    let exact = pinned.open_file("a").unwrap().read_at_most(5);
    let short = pinned.open_file("a").unwrap().read_at_most(4);
    let same_object = pinned.open_file("a-too").unwrap().identity() == file.identity();
    assert_eq!(
        (
            before,
            after,
            exact,
            short,
            file.read_at_most(usize::MAX),
            same_object
        ),
        (
            Ok(1),
            Ok(2),
            Ok(b"alpha".to_vec()),
            Err(PinnedError::TooLarge),
            Ok(b"alpha".to_vec()),
            true
        )
    );
}

#[cfg(unix)]
#[test]
fn a_held_directory_keeps_its_object_when_its_path_is_renamed_and_refilled() {
    let scratch = Scratch::new("renamed");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::write(root.join("a"), b"original").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    fs::rename(&root, aside.join("moved")).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("a"), b"decoy").unwrap();
    let read = pinned.open_file("a").unwrap().read_at_most(16);
    assert_eq!(
        (pinned.is_still_named(), read, pinned.entries(4)),
        (Ok(false), Ok(b"original".to_vec()), Ok(vec!["a".into()]))
    );
}

#[cfg(windows)]
#[test]
fn a_pinned_directory_and_its_ancestors_cannot_be_renamed_or_removed_while_held() {
    let scratch = Scratch::new("win-pinned");
    let root = scratch.root();
    let aside = scratch.aside();
    fs::create_dir(root.join("child")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let child = pinned.open_dir("child").unwrap();
    let attempts = (
        fs::rename(&root, aside.join("moved-root")).is_err(),
        fs::rename(scratch.path(), scratch.path().with_extension("moved")).is_err(),
        fs::rename(root.join("child"), aside.join("moved-child")).is_err(),
        fs::remove_dir(root.join("child")).is_err(),
    );
    assert_eq!(
        (attempts, pinned.is_still_named(), child.is_still_named()),
        ((true, true, true, true), Ok(true), Ok(true))
    );
}

#[test]
fn every_read_starts_at_the_beginning_of_the_file() {
    let scratch = Scratch::new("rewind");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    let mut file = PinnedDir::open_root(&root).unwrap().open_file("a").unwrap();
    let too_small = file.read_at_most(4);
    let retried = file.read_at_most(5);
    let again = file.read_at_most(5);
    assert_eq!(
        (too_small, retried, again),
        (
            Err(PinnedError::TooLarge),
            Ok(b"alpha".to_vec()),
            Ok(b"alpha".to_vec())
        )
    );
}

#[test]
fn a_root_given_through_a_link_is_resolved_once_and_a_retargeted_link_changes_nothing() {
    let scratch = Scratch::new("ancestor-link");
    let aside = scratch.aside();
    for (side, content) in [("real", &b"original"[..]), ("decoy", &b"decoy"[..])] {
        fs::create_dir_all(aside.join(side).join("root")).unwrap();
        fs::write(aside.join(side).join("root").join("a"), content).unwrap();
    }
    let link = scratch.path().join("link");
    link_to_dir(&aside.join("real"), &link);
    let pinned = PinnedDir::open_root(&link.join("root")).unwrap();
    let resolved_to_the_object =
        pinned.path() == fs::canonicalize(aside.join("real").join("root")).unwrap();
    remove_dir_link(&link);
    link_to_dir(&aside.join("decoy"), &link);
    let read = pinned.open_file("a").unwrap().read_at_most(16);
    assert_eq!(
        (resolved_to_the_object, read, pinned.is_still_named()),
        (true, Ok(b"original".to_vec()), Ok(true))
    );
}

#[cfg(unix)]
#[test]
fn an_ancestor_turned_into_a_link_to_the_renamed_tree_is_no_longer_the_name() {
    let scratch = Scratch::new("ancestor-swap");
    let parent = scratch.path().join("parent");
    fs::create_dir_all(parent.join("root")).unwrap();
    let pinned = PinnedDir::open_root(&parent.join("root")).unwrap();
    let before = pinned.is_still_named();
    let moved = scratch.path().join("parent-moved");
    fs::rename(&parent, &moved).unwrap();
    std::os::unix::fs::symlink(&moved, &parent).unwrap();
    // A path-based check follows the new link and finds the same directory again; the walk does not.
    let followed_by_path = fs::metadata(pinned.path()).is_ok();
    assert_eq!(
        (before, followed_by_path, pinned.is_still_named()),
        (Ok(true), true, Ok(false))
    );
}

#[test]
fn a_root_path_that_does_not_end_in_a_name_is_refused_so_a_link_is_never_followed() {
    let scratch = Scratch::new("trailing");
    let aside = scratch.aside();
    let real = aside.join("real");
    fs::create_dir(&real).unwrap();
    let link = scratch.path().join("link");
    link_to_dir(&real, &link);
    let separator = std::path::MAIN_SEPARATOR;
    let with_separator = std::path::PathBuf::from(format!("{}{separator}", link.display()));
    let forms = [
        with_separator.clone(),
        link.join("."),
        link.join(".."),
        std::path::PathBuf::from("."),
        std::path::PathBuf::from(".."),
        std::path::PathBuf::new(),
    ];
    let refused: Vec<_> = forms
        .iter()
        .map(|path| PinnedDir::open_root(path).map(|_| ()))
        .collect();
    assert_eq!(
        (
            refused,
            PinnedDir::open_root(&link).map(|_| ()),
            PinnedDir::open_root(&real).map(|_| ())
        ),
        (
            vec![Err(PinnedError::InvalidName); 6],
            Err(PinnedError::Redirected),
            Ok(())
        )
    );
}

/// The premise of the test above: with a trailing separator the system follows the link even though the
/// open asks not to.
#[cfg(unix)]
#[test]
fn a_trailing_separator_makes_the_system_follow_a_link_despite_no_follow() {
    use rustix::fs::{open, Mode, OFlags};

    let scratch = Scratch::new("trailing-premise");
    let real = scratch.aside().join("real");
    fs::create_dir(&real).unwrap();
    let link = scratch.path().join("link");
    link_to_dir(&real, &link);
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let plain = open(&link, flags, Mode::empty());
    let with_separator = open(format!("{}/", link.display()), flags, Mode::empty());
    assert_eq!((plain.is_err(), with_separator.is_ok()), (true, true));
}

#[test]
fn the_rules_for_the_end_of_a_root_path_follow_the_platform() {
    use std::path::Path;

    use crate::pinned::ends_in_a_name;

    let cases: [(&str, bool, bool); 9] = [
        ("/a/link", false, true),
        ("/a/link/", false, false),
        ("/a/link/.", false, false),
        ("/a/link.", false, true),
        ("/a/link ", false, true),
        ("C:\\a\\link\\. ", true, false),
        ("C:\\a\\link\\.. ", true, false),
        ("C:\\a\\link.", true, false),
        ("C:\\a\\link", true, true),
    ];
    let verdicts: Vec<(&str, bool)> = cases
        .iter()
        .map(|(path, windows, _)| (*path, ends_in_a_name(Path::new(path), *windows)))
        .collect();
    let expected: Vec<(&str, bool)> = cases.iter().map(|(path, _, ok)| (*path, *ok)).collect();
    assert_eq!(verdicts, expected);
}

#[cfg(windows)]
#[test]
fn a_child_keeps_the_ancestors_pinned_after_its_parent_is_dropped() {
    let scratch = Scratch::new("win-orphan");
    let root = scratch.root();
    fs::create_dir(root.join("child")).unwrap();
    let child = PinnedDir::open_root(&root)
        .unwrap()
        .open_dir("child")
        .unwrap();
    // The parent handle is gone; the child's own handle is all that is left.
    let attempts = (
        fs::rename(&root, scratch.aside().join("moved-root")).is_err(),
        fs::rename(scratch.path(), scratch.path().with_extension("moved")).is_err(),
    );
    assert_eq!((attempts, child.is_still_named()), ((true, true), Ok(true)));
}

#[test]
fn every_operation_follows_the_held_directory_not_the_path_it_was_stored_with() {
    let scratch = Scratch::new("held-not-path");
    let aside = scratch.aside();
    let (held, decoy) = (aside.join("held"), aside.join("decoy"));
    for (dir, content) in [(&held, &b"held"[..]), (&decoy, &b"decoy"[..])] {
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a"), content).unwrap();
    }
    fs::create_dir(decoy.join("only-in-decoy")).unwrap();
    let mut pinned = PinnedDir::open_root(&held).unwrap();
    // The stored path now leads to another tree, as a redirected path would.
    pinned.path = decoy.clone();
    let naive = fs::read(pinned.path().join("a")).unwrap();
    let mut listed = pinned.entries(8).unwrap();
    listed.sort();
    assert_eq!(
        (
            naive,
            pinned.open_file("a").unwrap().read_at_most(8),
            listed,
            pinned.entry_kind("sub"),
            pinned.entry_kind("only-in-decoy"),
            pinned.open_dir("sub").map(|_| ()),
            pinned.open_dir("only-in-decoy").map(|_| ())
        ),
        (
            b"decoy".to_vec(),
            Ok(b"held".to_vec()),
            vec!["a".into(), "sub".into()],
            Ok(Some(EntryKind::Directory)),
            Ok(None),
            Ok(()),
            Err(PinnedError::NotFound)
        )
    );
}

#[test]
fn a_directory_can_be_synced_where_the_platform_confirms_it() {
    use crate::durable::DirectoryDurability;

    let scratch = Scratch::new("sync");
    let pinned = PinnedDir::open_root(&scratch.root()).unwrap();
    let expected = if cfg!(unix) {
        DirectoryDurability::Confirmed
    } else {
        DirectoryDurability::NotConfirmed
    };
    assert_eq!(pinned.sync(), Ok(expected));
}
