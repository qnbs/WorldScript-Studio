//! A link planted below `inventory/` must never make the sweep read through it and then unlink what it
//! reaches: the pages of the committed set, or of anything else outside the abandoned attempt. Only
//! Unix tests create links without a privilege.

use std::collections::BTreeMap;
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

/// Every file below `dir` with its bytes: what a link must never let the sweep touch.
fn fingerprint(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    tree_under(dir)
        .into_iter()
        .filter(|name| !name.ends_with('/'))
        .map(|name| {
            let bytes = std::fs::read(dir.join(&name)).unwrap();
            (name, bytes)
        })
        .collect()
}

/// Where a link is planted in a dead pending directory: it receives the directory and a directory
/// outside the journal that the link points into.
type Plant = fn(&Path, &Path);

fn plant_in_place_of_the_pending_directory(pending: &Path, outside: &Path) {
    replace_with_link(pending, &outside.join("moved"));
}

fn plant_in_place_of_a_page_directory(pending: &Path, outside: &Path) {
    replace_with_link(&pending.join("page-0"), &outside.join("page-moved"));
}

fn plant_in_place_of_a_page_file(pending: &Path, outside: &Path) {
    let page = generation_path(&pending.join("page-0"), 4);
    let target = outside.join("page-file");
    std::fs::copy(&page, &target).unwrap();
    std::fs::remove_file(&page).unwrap();
    symlink(&target, &page).unwrap();
}

#[test]
fn a_link_planted_in_a_dead_pending_directory_keeps_it_and_leaves_the_target_untouched() {
    let cases: [(&str, Plant); 3] = [
        (
            "in place of the pending directory",
            plant_in_place_of_the_pending_directory,
        ),
        (
            "in place of a page directory",
            plant_in_place_of_a_page_directory,
        ),
        ("in place of a page file", plant_in_place_of_a_page_file),
    ];
    let wrong: Vec<_> = cases
        .into_iter()
        .filter_map(|(name, plant)| {
            let scenario = with_two_dead_pending_dirs();
            let pending = first_pending(&scenario);
            let outside = TempDir::new();
            plant(&pending, &outside.0);
            let before = fingerprint(&outside.0);
            let done = scenario.sweep(&mut StdFs).unwrap();
            let linked = kept(&done).contains(&(name_of(&pending), KeepReason::Linked));
            (!(linked && fingerprint(&outside.0) == before)).then_some(name)
        })
        .collect();
    assert_eq!(wrong, Vec::<&str>::new());
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
