//! Removal, in the slice that only brings the API and the isolation: every call refuses, so nothing is
//! removed and nothing claims a safety it does not have yet.

use std::fs;

use super::Scratch;
use crate::pinned::{PinnedDir, PinnedError, RemovalOutcome};

#[test]
fn every_removal_refuses_until_a_platform_implements_it_and_removes_nothing() {
    let scratch = Scratch::new("remove-stub");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::create_dir(root.join("d")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let refusals: [Result<RemovalOutcome, PinnedError>; 3] = [
        pinned.remove_authenticated_file("a", |_| Ok(true)),
        pinned.remove_empty_dir("d"),
        pinned.remove_leftover_file(".h1q-00000000000000000000000000000000", |_| Ok(true)),
    ];
    assert_eq!(
        (
            refusals,
            fs::read(root.join("a")).unwrap(),
            root.join("d").is_dir()
        ),
        ([Err(PinnedError::Unsupported); 3], b"alpha".to_vec(), true)
    );
}
