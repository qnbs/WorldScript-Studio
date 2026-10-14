//! A link planted below `inventory/` must never make the sweep read through it and then unlink what it
//! reaches: the pages of the committed set, or of anything else outside the abandoned attempt. Only
//! Unix tests create links without a privilege.

use std::os::unix::fs::symlink;

use super::*;

/// The first directory below `inventory/`, by name.
fn first_pending(scenario: &Scenario) -> PathBuf {
    let name = names_in(&scenario.inventory()).into_iter().next().unwrap();
    scenario.inventory().join(name)
}

/// Moves `real` to `elsewhere` and puts a link at its old place.
fn replace_with_link(real: &Path, elsewhere: &Path) {
    std::fs::rename(real, elsewhere).unwrap();
    symlink(elsewhere, real).unwrap();
}

/// What the sweep must leave alone, as it was.
fn untouched(done: &Reclaimed, name: &str, outside: &Path, before: &BTreeSet<String>) -> bool {
    kept(done).contains(&(name.to_owned(), KeepReason::Linked))
        && done.files_removed > 0
        && tree_under(outside) == *before
}

#[test]
fn a_link_named_like_a_dead_pending_directory_cannot_make_the_sweep_unlink_a_stored_set() {
    let mut scenario = Scenario::new();
    let digests = promote_two_sets(&mut scenario);
    let committed = scenario.inventory().join(set_name(&digests.committed));
    let planted = scenario
        .inventory()
        .join(format!("pending-3-{}", fresh_tag()));
    symlink(&committed, &planted).unwrap();
    let before = tree_under(&committed);
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            kept(&done).contains(&(name_of(&planted), KeepReason::Linked)),
            tree_under(&committed)
        ),
        (true, before)
    );
}

#[test]
fn a_link_in_place_of_a_dead_pending_directory_is_kept_and_its_target_untouched() {
    let scenario = with_two_dead_pending_dirs();
    let pending = first_pending(&scenario);
    let outside = TempDir::new();
    let target = outside.0.join("moved");
    replace_with_link(&pending, &target);
    let before = tree_under(&target);
    let done = scenario.sweep(&mut StdFs).unwrap();
    // The other, real pending directory is still removed.
    assert!(untouched(&done, &name_of(&pending), &target, &before));
}

#[test]
fn a_link_in_place_of_a_page_directory_keeps_the_whole_pending_directory() {
    let scenario = with_two_dead_pending_dirs();
    let pending = first_pending(&scenario);
    let outside = TempDir::new();
    let target = outside.0.join("page-moved");
    replace_with_link(&pending.join("page-0"), &target);
    let before = tree_under(&target);
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert!(untouched(&done, &name_of(&pending), &target, &before));
}

#[test]
fn a_link_in_place_of_a_page_file_keeps_the_whole_pending_directory() {
    let scenario = with_two_dead_pending_dirs();
    let pending = first_pending(&scenario);
    let outside = TempDir::new();
    let target = outside.0.join("page-file");
    let page = generation_path(&pending.join("page-0"), 4);
    std::fs::copy(&page, &target).unwrap();
    std::fs::remove_file(&page).unwrap();
    symlink(&target, &page).unwrap();
    let bytes = std::fs::read(&target).unwrap();
    let done = scenario.sweep(&mut StdFs).unwrap();
    assert_eq!(
        (
            kept(&done).contains(&(name_of(&pending), KeepReason::Linked)),
            std::fs::read(&target).unwrap()
        ),
        (true, bytes)
    );
}

#[test]
fn an_inventory_directory_that_is_a_link_is_not_looked_into() {
    let scenario = with_two_dead_pending_dirs();
    let outside = TempDir::new();
    let target = outside.0.join("inventory-moved");
    replace_with_link(&scenario.inventory(), &target);
    let before = tree_under(&target);
    let refused = scenario.sweep(&mut StdFs);
    assert_eq!(
        (refused, tree_under(&target)),
        (Err(ReclaimError::UnsafeInventory), before)
    );
}

#[test]
fn the_real_file_system_tells_a_link_from_what_it_points_at() {
    let dir = TempDir::new();
    let real = dir.0.join("real");
    std::fs::create_dir(&real).unwrap();
    let file = dir.0.join("file");
    std::fs::write(&file, b"x").unwrap();
    let (to_dir, to_file) = (dir.0.join("to-dir"), dir.0.join("to-file"));
    symlink(&real, &to_dir).unwrap();
    symlink(&file, &to_file).unwrap();
    let kinds: Vec<_> = [&real, &file, &to_dir, &to_file]
        .into_iter()
        .map(|path| StdFs.entry_kind(path).unwrap())
        .collect();
    let missing = StdFs.entry_kind(&dir.0.join("missing")).unwrap_err().kind();
    assert_eq!(
        (kinds, missing),
        (
            vec![
                EntryKind::Directory,
                EntryKind::File,
                EntryKind::Link,
                EntryKind::Link
            ],
            std::io::ErrorKind::NotFound
        )
    );
}
