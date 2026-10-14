//! Gate 4 slice R1: the inventory sweep deletes by path, so it is part of no production build until
//! handle-relative I/O (H1) closes the check-then-use windows. These checks keep it behind the test-only
//! `test-support` feature: no manifest of the repository enables a test-only feature of this crate outside
//! `[dev-dependencies]`, `default` does not enable one, and every export or definition of the sweep carries
//! the feature gate. A production build that compiles without the feature cannot name the sweep at all.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

const CRATE: &str = "worldscript-secure-storage";
const TEST_ONLY_FEATURES: [&str; 2] = ["test-support", "test-randomness"];
const GATE: &str = "#[cfg(feature = \"test-support\")]";
const SWEEP_NAMES: [&str; 8] = [
    "reclaim_abandoned_inventory",
    "InventoryReclaim",
    "reclaim_with_binding",
    "ReclaimRequest",
    "ReclaimError",
    "Reclaimed",
    "KeepReason",
    "Preserved",
];

fn crate_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn source(relative: &str) -> String {
    fs::read_to_string(crate_dir().join(relative)).unwrap()
}

/// The paths directly inside `dir`; none when it cannot be read (the repository directories are absent
/// when the crate is built outside the repository).
fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| entries.map(|entry| entry.unwrap().path()).collect())
        .unwrap_or_default()
}

fn is_build_output(dir: &Path) -> bool {
    dir.file_name()
        .is_some_and(|name| name == "target" || name == "node_modules")
}

/// Every `Cargo.toml` at or below `dir`, build output excluded.
fn manifests_below(dir: &Path) -> Vec<PathBuf> {
    let (dirs, files): (Vec<_>, Vec<_>) = children(dir).into_iter().partition(|path| path.is_dir());
    let here = files
        .into_iter()
        .filter(|path| path.file_name() == Some(OsStr::new("Cargo.toml")));
    let below = dirs
        .iter()
        .filter(|path| !is_build_output(path))
        .flat_map(|path| manifests_below(path));
    here.chain(below).collect()
}

fn manifests_of_the_repository() -> Vec<PathBuf> {
    let root = crate_dir().join("../..");
    ["crates", "src-tauri"]
        .iter()
        .flat_map(|top| manifests_below(&root.join(top)))
        .collect()
}

/// The sections of a manifest as (header, body); the first one is the preamble.
fn sections(manifest: &str) -> Vec<(&str, &str)> {
    manifest
        .split("\n[")
        .map(|chunk| chunk.split_once('\n').unwrap_or((chunk, "")))
        .collect()
}

fn names_a_test_feature(text: &str) -> bool {
    TEST_ONLY_FEATURES
        .iter()
        .any(|feature| text.contains(feature))
}

/// The change of the bracket depth that `line` makes: an inline table or array that is spread over several
/// lines stays one entry.
fn depth_change(line: &str) -> i32 {
    let opened = line.matches(['{', '[']).count();
    let closed = line.matches(['}', ']']).count();
    opened as i32 - closed as i32
}

/// The entries of a section body: a line at bracket depth zero starts one.
fn entries(body: &str) -> Vec<String> {
    let mut entries: Vec<String> = Vec::new();
    let mut depth = 0;
    for line in body.lines() {
        match entries.last_mut() {
            Some(entry) if depth > 0 => entry.push_str(line),
            _ => entries.push(line.to_owned()),
        }
        depth += depth_change(line);
    }
    entries
}

/// Whether the section `header` is a table of one dependency (`[dependencies.name]`), which spreads that
/// dependency's keys over its body.
fn is_dependency_table(header: &str) -> bool {
    header.contains("dependencies.")
}

/// The texts of a section that can enable a test-only feature of this crate: the whole body of a
/// dependency table that names the crate (by its table name, `package` or `path`), else each entry that
/// names it.
fn texts_naming_the_crate(header: &str, body: &str) -> Vec<String> {
    if is_dependency_table(header) {
        let names_it = header.contains(CRATE) || body.contains(CRATE);
        return if names_it {
            vec![body.to_owned()]
        } else {
            Vec::new()
        };
    }
    entries(body)
        .into_iter()
        .filter(|entry| entry.contains(CRATE))
        .collect()
}

/// The dependency entries that name this crate together with a test-only feature outside a
/// dev-dependency section.
fn test_features_outside_dev_dependencies(manifest: &str) -> Vec<String> {
    sections(manifest)
        .into_iter()
        .filter(|(header, _)| !header.contains("dev-dependencies"))
        .flat_map(|(header, body)| texts_naming_the_crate(header, body))
        .filter(|text| names_a_test_feature(text))
        .map(|text| text.trim().to_owned())
        .collect()
}

fn is_own_manifest(path: &Path) -> bool {
    path.canonicalize().unwrap() == crate_dir().join("Cargo.toml").canonicalize().unwrap()
}

#[test]
fn no_manifest_enables_a_test_only_feature_of_the_crate_for_a_production_build() {
    let offenders: Vec<String> = manifests_of_the_repository()
        .into_iter()
        .filter(|path| !is_own_manifest(path))
        .flat_map(|path| {
            test_features_outside_dev_dependencies(&fs::read_to_string(&path).unwrap())
                .into_iter()
                .map(move |entry| format!("{}: {entry}", path.display()))
        })
        .collect();
    assert!(offenders.is_empty(), "{offenders:?}");
}

#[test]
fn the_default_features_enable_no_test_only_feature() {
    let manifest = source("Cargo.toml");
    let defaults: Vec<&str> = manifest
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("default"))
        .collect();
    assert!(
        !defaults.iter().any(|line| names_a_test_feature(line)),
        "{defaults:?}"
    );
}

#[test]
fn the_scan_tells_a_dev_dependency_from_a_production_one() {
    let cases = [
        // A dev-dependency may enable it.
        "[dev-dependencies]\nworldscript-secure-storage = { path = \"../x\", features = [\"test-support\"] }\n",
        // Production: inline, as a table, spread over lines, an alias, and the feature before the package.
        "[dependencies]\nworldscript-secure-storage = { path = \"../x\", features = [\"test-support\"] }\n",
        "[dependencies.worldscript-secure-storage]\npath = \"../x\"\nfeatures = [\"test-randomness\"]\n",
        "[dependencies]\nworldscript-secure-storage = {\n  path = \"../x\",\n  features = [\"test-support\"],\n}\n",
        "[dependencies.secure]\npackage = \"worldscript-secure-storage\"\nfeatures = [\"test-support\"]\n",
        "[dependencies]\nsecure = {\n  features = [\"test-support\"],\n  package = \"worldscript-secure-storage\",\n}\n",
        "[target.'cfg(unix)'.dependencies]\nworldscript-secure-storage = { path = \"../x\", features = [\"test-support\"] }\n",
        // Not this crate, or this crate without a test-only feature.
        "[dependencies]\nserde = { features = [\"derive\", \"test-support\"] }\nworldscript-secure-storage = { path = \"../x\" }\n",
        "[dependencies.other]\nfeatures = [\"test-support\"]\n[features]\ntest-support = []\n",
    ];
    let counts = cases.map(|text| test_features_outside_dev_dependencies(text).len());
    assert_eq!(counts, [0, 1, 1, 1, 1, 1, 1, 0, 0]);
}

/// The attribute, doc and comment lines directly above line `head`.
fn lines_above(lines: &[&str], head: usize) -> Vec<String> {
    lines[..head]
        .iter()
        .rev()
        .map(|line| line.trim())
        .take_while(|line| line.starts_with("#[") || line.starts_with("//"))
        .map(str::to_owned)
        .collect()
}

fn starts_a_statement(line: &str) -> bool {
    let line = line.trim_start();
    [
        "pub use ",
        "use ",
        "mod ",
        "pub fn ",
        "pub struct ",
        "fn ",
        "Reclaim(",
    ]
    .iter()
    .any(|start| line.starts_with(start))
}

/// The statement that holds line `at`: the nearest line at or above it that starts a statement.
fn statement_head(lines: &[&str], at: usize) -> usize {
    (0..=at)
        .rev()
        .find(|&index| starts_a_statement(lines[index]))
        .unwrap()
}

fn names_the_sweep(line: &str) -> bool {
    !line.trim_start().starts_with("//") && SWEEP_NAMES.iter().any(|name| line.contains(name))
}

fn is_gated(lines: &[&str], head: usize) -> bool {
    lines_above(lines, head).iter().any(|above| above == GATE)
}

/// Every non-comment line of `text` that names the sweep and whose statement is not gated.
fn ungated_mentions(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    (0..lines.len())
        .filter(|&at| names_the_sweep(lines[at]))
        .filter(|&at| !is_gated(&lines, statement_head(&lines, at)))
        .map(|at| lines[at].trim().to_owned())
        .collect()
}

/// Whether the line that starts with `head` is gated.
fn gated_definition(text: &str, head: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    lines
        .iter()
        .position(|line| line.trim_start().starts_with(head))
        .is_some_and(|at| is_gated(&lines, at))
}

#[test]
fn every_export_of_the_sweep_carries_the_feature_gate() {
    let ungated: Vec<String> = ["src/lib.rs", "src/journal/mod.rs"]
        .iter()
        .flat_map(|relative| ungated_mentions(&source(relative)))
        .collect();
    assert!(ungated.is_empty(), "{ungated:?}");
    assert!(source("src/journal/mod.rs").contains(&format!("{GATE}\nmod reclaim;")));
}

#[test]
fn every_definition_of_the_sweep_carries_the_feature_gate() {
    let authority = source("src/authority.rs");
    let heads = [
        "pub fn reclaim_abandoned_inventory",
        "pub struct InventoryReclaim",
        "fn assert_held",
        "Reclaim(ReclaimError)",
    ];
    let missing: Vec<&str> = heads
        .into_iter()
        .filter(|head| !gated_definition(&authority, head))
        .collect();
    assert!(missing.is_empty(), "{missing:?}");
}

#[test]
fn the_gate_scan_sees_an_ungated_export() {
    let gated =
        "#[cfg(feature = \"test-support\")]\npub use journal::{reclaim_with_binding, Reclaimed};\n";
    let ungated = "pub use journal::{\n    reclaim_with_binding, Reclaimed,\n};\n";
    let counts = [gated, ungated].map(|text| ungated_mentions(text).len());
    assert_eq!(counts, [0, 1]);
}
