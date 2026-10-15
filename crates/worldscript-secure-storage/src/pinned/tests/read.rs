//! The non-destructive primitives: opening, listing, reading and refusing links.

use std::fs;

use super::{link_to_dir, Scratch};
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
            pinned.path() == root.as_path()
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
        "a:stream", "con", "NUL.txt", "Com1", "lpt9", "a.", "a ", "a*", "a?", "a<b", "a|b", "a\"b",
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
    rustix::fs::mknodat(
        rustix::fs::CWD,
        root.join("fifo"),
        rustix::fs::FileType::Fifo,
        rustix::fs::Mode::RUSR | rustix::fs::Mode::WUSR,
        0,
    )
    .unwrap();
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
