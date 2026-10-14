//! Gate 4 slice R1: the inventory sweep deletes by path, so it is part of no production build until
//! handle-relative I/O (H1) closes the check-then-use windows. These checks keep it behind the test-only
//! `test-support` feature: no manifest of the repository enables a test-only feature of this crate outside
//! `[dev-dependencies]`, `default` does not enable one, and every export or definition of the sweep carries
//! the feature gate. A production build that compiles without the feature cannot name the sweep at all.

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

/// Every `Cargo.toml` below `crates/` and `src-tauri/` of the repository (those directories are absent
/// when the crate is built outside the repository).
fn manifests_of_the_repository() -> Vec<PathBuf> {
    let root = crate_dir().join("../..");
    let mut found = Vec::new();
    for top in ["crates", "src-tauri"] {
        let mut stack = vec![root.join(top)];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if path.is_dir() {
                    if name != "target" && name != "node_modules" {
                        stack.push(path);
                    }
                } else if name == "Cargo.toml" {
                    found.push(path);
                }
            }
        }
    }
    found
}

/// The lines that name this crate together with a test-only feature outside a dev-dependency section.
fn test_features_outside_dev_dependencies(manifest: &str) -> Vec<String> {
    let mut section = String::new();
    let mut entry_open = false;
    let mut offenders = Vec::new();
    for line in manifest.lines().map(str::trim) {
        if line.starts_with('[') {
            section = line.to_owned();
            entry_open = false;
            continue;
        }
        if line.contains(CRATE) && line.contains('{') && !line.contains('}') {
            entry_open = true;
        }
        let names_crate = line.contains(CRATE) || entry_open || section.contains(CRATE);
        let enables = TEST_ONLY_FEATURES
            .iter()
            .any(|feature| line.contains(feature));
        if names_crate && enables && !section.contains("dev-dependencies") {
            offenders.push(line.to_owned());
        }
        if line.contains('}') {
            entry_open = false;
        }
    }
    offenders
}

#[test]
fn no_manifest_enables_a_test_only_feature_of_the_crate_for_a_production_build() {
    let own = crate_dir().join("Cargo.toml");
    let offenders: Vec<String> = manifests_of_the_repository()
        .into_iter()
        .filter(|path| path.canonicalize().unwrap() != own.canonicalize().unwrap())
        .flat_map(|path| {
            let text = fs::read_to_string(&path).unwrap();
            test_features_outside_dev_dependencies(&text)
                .into_iter()
                .map(move |line| format!("{}: {line}", path.display()))
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
    let enabling = defaults.iter().any(|line| {
        TEST_ONLY_FEATURES
            .iter()
            .any(|feature| line.contains(feature))
    });
    assert!(!enabling, "{defaults:?}");
}

#[test]
fn the_scan_tells_a_dev_dependency_from_a_production_one() {
    let dev = "[dev-dependencies]\nworldscript-secure-storage = { path = \"../x\", features = [\"test-support\"] }\n";
    let inline = "[dependencies]\nworldscript-secure-storage = { path = \"../x\", features = [\"test-support\"] }\n";
    let table = "[dependencies.worldscript-secure-storage]\npath = \"../x\"\nfeatures = [\"test-randomness\"]\n";
    let spread = "[dependencies]\nworldscript-secure-storage = {\n  path = \"../x\",\n  features = [\"test-support\"],\n}\n";
    let other =
        "[dependencies]\nserde = { features = [\"derive\"] }\n[features]\ntest-support = []\n";
    let counts = [dev, inline, table, spread, other]
        .map(|text| test_features_outside_dev_dependencies(text).len());
    assert_eq!(counts, [0, 1, 1, 1, 0]);
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

/// The statement that holds line `at`: the nearest line at or above it that starts a statement.
fn statement_head(lines: &[&str], at: usize) -> usize {
    (0..=at)
        .rev()
        .find(|&index| {
            let line = lines[index].trim_start();
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
        })
        .unwrap()
}

/// Every non-comment line of `text` that names the sweep, as (line, gated by the feature).
fn sweep_mentions(text: &str) -> Vec<(String, bool)> {
    let lines: Vec<&str> = text.lines().collect();
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("//"))
        .filter(|(_, line)| SWEEP_NAMES.iter().any(|name| line.contains(name)))
        .map(|(at, line)| {
            let head = statement_head(&lines, at);
            let gated = lines_above(&lines, head).iter().any(|above| above == GATE);
            (line.trim().to_owned(), gated)
        })
        .collect()
}

fn ungated_mentions(relative: &str) -> Vec<String> {
    sweep_mentions(&source(relative))
        .into_iter()
        .filter(|(_, gated)| !gated)
        .map(|(line, _)| format!("{relative}: {line}"))
        .collect()
}

#[test]
fn every_definition_and_export_of_the_sweep_carries_the_feature_gate() {
    let ungated: Vec<String> = ["src/lib.rs", "src/journal/mod.rs"]
        .iter()
        .flat_map(|relative| ungated_mentions(relative))
        .collect();
    assert!(ungated.is_empty(), "{ungated:?}");
    let authority = source("src/authority.rs");
    let lines: Vec<&str> = authority.lines().collect();
    let heads = [
        "pub fn reclaim_abandoned_inventory",
        "pub struct InventoryReclaim",
        "fn assert_held",
        "Reclaim(ReclaimError)",
    ];
    let missing: Vec<&str> = heads
        .into_iter()
        .filter(|head| {
            let at = lines
                .iter()
                .position(|line| line.trim_start().starts_with(head));
            at.map_or(true, |at| {
                !lines_above(&lines, at).iter().any(|above| above == GATE)
            })
        })
        .collect();
    assert!(missing.is_empty(), "{missing:?}");
    assert!(source("src/journal/mod.rs").contains(&format!("{GATE}\nmod reclaim;")));
}

#[test]
fn the_gate_scan_sees_an_ungated_export() {
    let gated =
        "#[cfg(feature = \"test-support\")]\npub use journal::{reclaim_with_binding, Reclaimed};\n";
    let ungated = "pub use journal::{\n    reclaim_with_binding, Reclaimed,\n};\n";
    let flags = [gated, ungated].map(|text| sweep_mentions(text).iter().all(|(_, gated)| *gated));
    assert_eq!(flags, [true, false]);
}
