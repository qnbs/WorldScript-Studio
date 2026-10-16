//! TEMPORARY probe, removed again in the next commit: what does macOS report for an open directory that was
//! removed, compared with one that was only moved and one that is untouched? The test always panics so that
//! the answer is printed in the hosted log.

use std::fs::{self, File};

use rustix::fs::{fstat, getpath, openat, statat, AtFlags, Mode, OFlags};

use super::Scratch;

fn describe(label: &str, dir: &File) -> String {
    let nlink = fstat(dir).map(|stat| stat.st_nlink as u64);
    let path = getpath(dir);
    let dotdot = openat(dir, "..", OFlags::RDONLY | OFlags::DIRECTORY, Mode::empty()).map(|_| ());
    let dot = statat(dir, ".", AtFlags::empty()).map(|stat| stat.st_nlink as u64);
    let create = openat(
        dir,
        "probe-file",
        OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL,
        Mode::RUSR | Mode::WUSR,
    )
    .map(|_| ());
    format!(
        "{label}: fstat_nlink={nlink:?} getpath={path:?} openat_dotdot={dotdot:?} statat_dot_nlink={dot:?} create_in_dir={create:?}"
    )
}

#[test]
fn probe() {
    let scratch = Scratch::new("probe");
    let root = scratch.root();
    let live = root.join("live");
    let moved = root.join("moved-from");
    let removed = root.join("removed");
    for dir in [&live, &moved, &removed] {
        fs::create_dir(dir).unwrap();
    }
    let live_fd = File::open(&live).unwrap();
    let moved_fd = File::open(&moved).unwrap();
    let removed_fd = File::open(&removed).unwrap();
    let before = describe("before-removal", &removed_fd);
    fs::rename(&moved, root.join("moved-to")).unwrap();
    fs::remove_dir(&removed).unwrap();
    let lines = [
        before,
        describe("live", &live_fd),
        describe("moved", &moved_fd),
        describe("removed", &removed_fd),
    ];
    panic!("PROBE\n{}", lines.join("\n"));
}
