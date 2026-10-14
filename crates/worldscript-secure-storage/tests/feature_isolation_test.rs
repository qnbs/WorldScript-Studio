//! Gate 4 slice R1: the inventory sweep deletes by path, so it is part of no production build until
//! handle-relative I/O (H1) closes the check-then-use windows. These checks keep it behind the test-only
//! `test-support` feature, and they do it without trusting a hand-written reading of Cargo manifests:
//!
//! - No package in the resolved dependency graph of the repository (every `Cargo.lock`, which `--locked`
//!   keeps equal to what Cargo resolves from the manifests, so renames, aliases, optional and target
//!   dependencies are all covered) depends on this crate. Nothing can therefore request one of its
//!   features, directly or through an alias. A legitimate production dependency (Gate 5) must replace
//!   this rule with a feature-graph check against `cargo metadata`, not widen it silently.
//! - `default` enables no test-only feature, directly or through other features.
//! - Every export or definition of the sweep carries the feature gate, so a build without the feature
//!   cannot name the sweep at all.

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
/// What starts a statement or an item in the sources that are scanned.
const STATEMENT_STARTS: [&str; 7] = [
    "pub use ",
    "use ",
    "mod ",
    "pub fn ",
    "pub struct ",
    "fn ",
    "Reclaim(",
];
/// The definitions of the sweep outside its own module, as their lines start in `authority.rs`.
const SWEEP_DEFINITIONS: [&str; 4] = [
    "pub fn reclaim_abandoned_inventory",
    "pub struct InventoryReclaim",
    "fn assert_held",
    "Reclaim(ReclaimError)",
];

fn crate_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// The files of the crate that are read.
#[derive(Clone, Copy)]
enum File {
    CargoToml,
    Lib,
    JournalMod,
    Authority,
}

impl File {
    fn path(self) -> PathBuf {
        let relative = match self {
            File::CargoToml => "Cargo.toml",
            File::Lib => "src/lib.rs",
            File::JournalMod => "src/journal/mod.rs",
            File::Authority => "src/authority.rs",
        };
        crate_dir().join(relative)
    }
}

/// One package of a `Cargo.lock`: its name and the names of the packages it depends on.
struct Package {
    name: String,
    dependencies: Vec<String>,
}

impl Package {
    fn parse(chunk: &str) -> Self {
        let name = chunk
            .lines()
            .find_map(|line| line.strip_prefix("name = \"")?.strip_suffix('"'))
            .unwrap_or_else(|| panic!("a lockfile package without a name: {chunk:.80}"));
        let listed = chunk
            .split_once("dependencies = [")
            .map_or("", |(_, rest)| rest.split(']').next().unwrap_or(""));
        let dependencies = listed
            .split('"')
            .skip(1)
            .step_by(2)
            .filter_map(|entry| entry.split(' ').next())
            .map(str::to_owned)
            .collect();
        Package {
            name: name.to_owned(),
            dependencies,
        }
    }

    fn depends_on_the_crate(&self) -> bool {
        self.name != CRATE && self.dependencies.iter().any(|name| name == CRATE)
    }
}

/// A resolved dependency graph as Cargo records it.
struct Lockfile {
    packages: Vec<Package>,
}

impl Lockfile {
    /// An unreadable lockfile is a failure, never an empty graph.
    fn parse(text: &str) -> Self {
        let packages: Vec<Package> = text
            .split("\n[[package]]")
            .skip(1)
            .map(Package::parse)
            .collect();
        assert!(!packages.is_empty(), "a lockfile without packages");
        Lockfile { packages }
    }

    fn read(path: &Path) -> Self {
        Self::parse(&fs::read_to_string(path).unwrap())
    }

    fn dependents_of_the_crate(&self) -> Vec<&str> {
        self.packages
            .iter()
            .filter(|package| package.depends_on_the_crate())
            .map(|package| package.name.as_str())
            .collect()
    }

    fn lists_the_crate(&self) -> bool {
        self.packages.iter().any(|package| package.name == CRATE)
    }
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

/// Every `Cargo.lock` at or below `dir`, build output excluded.
fn lockfiles_below(dir: &Path) -> Vec<PathBuf> {
    let (dirs, files): (Vec<_>, Vec<_>) = children(dir).into_iter().partition(|path| path.is_dir());
    let here = files
        .into_iter()
        .filter(|path| path.file_name() == Some(OsStr::new("Cargo.lock")));
    let below = dirs
        .iter()
        .filter(|path| !is_build_output(path))
        .flat_map(|path| lockfiles_below(path));
    here.chain(below).collect()
}

fn lockfiles_of_the_repository() -> Vec<PathBuf> {
    let root = crate_dir().join("../..");
    ["crates", "src-tauri"]
        .iter()
        .flat_map(|top| lockfiles_below(&root.join(top)))
        .collect()
}

#[test]
fn no_package_of_the_repository_depends_on_the_crate() {
    if !crate_dir().join("../../src-tauri").exists() {
        return;
    }
    let lockfiles = lockfiles_of_the_repository();
    assert!(lockfiles.len() >= 2, "{lockfiles:?}");
    let offenders: Vec<String> = lockfiles
        .iter()
        .flat_map(|path| {
            Lockfile::read(path)
                .dependents_of_the_crate()
                .into_iter()
                .map(|name| format!("{}: {name}", path.display()))
                .collect::<Vec<_>>()
        })
        .collect();
    assert!(offenders.is_empty(), "{offenders:?}");
}

#[test]
fn the_lockfile_scan_sees_the_workspace_and_a_dependent() {
    let workspace = crate_dir().join("../Cargo.lock");
    if workspace.exists() {
        assert!(Lockfile::read(&workspace).lists_the_crate());
    }
    let dependent = "version = 4\n\n[[package]]\nname = \"app\"\nversion = \"1.0.0\"\ndependencies = [\n \"serde\",\n \"worldscript-secure-storage 0.1.0\",\n]\n\n[[package]]\nname = \"worldscript-secure-storage\"\nversion = \"0.1.0\"\ndependencies = [\n \"serde\",\n]\n";
    let lookalike = "[[package]]\nname = \"worldscript-secure-storage\"\ndependencies = [\n \"serde\",\n]\n\n[[package]]\nname = \"other\"\ndependencies = [\n \"worldscript-secure-storage-extra\",\n]\n";
    let found =
        [dependent, lookalike].map(|text| Lockfile::parse(text).dependents_of_the_crate().len());
    assert_eq!(found, [1, 0]);
}

#[test]
#[should_panic(expected = "without packages")]
fn an_unreadable_lockfile_is_a_failure_not_an_empty_graph() {
    Lockfile::parse("version = 4\n");
}

/// One `[section]` of a manifest.
struct Section {
    header: String,
    body: String,
}

impl Section {
    /// The entries of the body: a line at bracket depth zero starts one, and an inline table or array
    /// that is spread over several lines stays in it.
    fn entries(&self) -> Vec<String> {
        let mut entries: Vec<String> = Vec::new();
        let mut depth = 0;
        for line in self.body.lines() {
            match entries.last_mut() {
                Some(entry) if depth > 0 => entry.push_str(line),
                _ => entries.push(line.to_owned()),
            }
            depth += line.matches(['{', '[']).count() as i32;
            depth -= line.matches(['}', ']']).count() as i32;
        }
        entries
    }
}

/// A manifest split into its sections; the first one is the preamble.
struct Manifest {
    sections: Vec<Section>,
}

impl Manifest {
    fn parse(text: &str) -> Self {
        let sections = text
            .split("\n[")
            .map(|chunk| chunk.split_once('\n').unwrap_or((chunk, "")))
            .map(|(header, body)| Section {
                header: header.to_owned(),
                body: body.to_owned(),
            })
            .collect();
        Manifest { sections }
    }

    fn read(path: &Path) -> Self {
        Self::parse(&fs::read_to_string(path).unwrap())
    }

    /// The `[features]` table: each feature with the features it turns on.
    fn feature_table(&self) -> Vec<(String, Vec<String>)> {
        self.sections
            .iter()
            .filter(|section| {
                section
                    .header
                    .trim_start_matches('[')
                    .starts_with("features")
            })
            .flat_map(Section::entries)
            .filter_map(|entry| {
                let (name, list) = entry.split_once('=')?;
                let enabled = list.split('"').skip(1).step_by(2).map(str::to_owned);
                Some((name.trim().to_owned(), enabled.collect()))
            })
            .collect()
    }

    /// `default` and every feature it turns on, directly or through other features.
    fn default_closure(&self) -> Vec<String> {
        let table = self.feature_table();
        let mut closure = vec!["default".to_owned()];
        let mut next = 0;
        while let Some(current) = closure.get(next).cloned() {
            next += 1;
            let enabled = table
                .iter()
                .filter(|(name, _)| *name == current)
                .flat_map(|(_, enabled)| enabled.clone());
            let fresh: Vec<String> = enabled.filter(|name| !closure.contains(name)).collect();
            closure.extend(fresh);
        }
        closure
    }

    fn default_enables_a_test_feature(&self) -> bool {
        let closure = self.default_closure();
        TEST_ONLY_FEATURES
            .iter()
            .any(|feature| closure.iter().any(|name| name == feature))
    }
}

#[test]
fn the_default_features_enable_no_test_only_feature() {
    let manifest = Manifest::read(&File::CargoToml.path());
    assert!(
        !manifest.default_enables_a_test_feature(),
        "{:?}",
        manifest.default_closure()
    );
}

#[test]
fn the_default_closure_follows_aliases() {
    let cases = [
        "[features]\ndefault = [\"alias\"]\nalias = [\"test-support\"]\ntest-support = []\n",
        "[features]\ndefault = [\n  \"a\",\n]\na = [\n  \"b\",\n  \"test-randomness\",\n]\nb = []\n",
        "[features]\ndefault = [\"a\"]\na = [\"b\"]\nb = [\"a\"]\ntest-support = []\n",
        "[features]\ndefault = []\ntest-support = [\"test-randomness\"]\n",
        "[package]\nname = \"x\"\n",
    ];
    let enabled = cases.map(|text| Manifest::parse(text).default_enables_a_test_feature());
    assert_eq!(enabled, [true, true, false, false, false]);
}

/// The lines of a source file.
struct Source {
    lines: Vec<String>,
}

impl Source {
    fn of(text: &str) -> Self {
        Source {
            lines: text.lines().map(str::to_owned).collect(),
        }
    }

    fn read(file: File) -> Self {
        Self::of(&fs::read_to_string(file.path()).unwrap())
    }

    /// The attribute, doc and comment lines directly above line `head`.
    fn lines_above(&self, head: usize) -> Vec<&str> {
        self.lines[..head]
            .iter()
            .rev()
            .map(|line| line.trim())
            .take_while(|line| line.starts_with("#[") || line.starts_with("//"))
            .collect()
    }

    fn is_gated(&self, head: usize) -> bool {
        self.lines_above(head).contains(&GATE)
    }

    /// The statement that holds line `at`: the nearest line at or above it that starts a statement.
    fn statement_head(&self, at: usize) -> usize {
        (0..=at)
            .rev()
            .find(|&index| {
                let line = self.lines[index].trim_start();
                STATEMENT_STARTS.iter().any(|start| line.starts_with(start))
            })
            .unwrap()
    }

    fn names_the_sweep(&self, at: usize) -> bool {
        let line = &self.lines[at];
        !line.trim_start().starts_with("//") && SWEEP_NAMES.iter().any(|name| line.contains(name))
    }

    /// Every non-comment line that names the sweep and whose statement is not gated.
    fn ungated_mentions(&self) -> Vec<&str> {
        (0..self.lines.len())
            .filter(|&at| self.names_the_sweep(at))
            .filter(|&at| !self.is_gated(self.statement_head(at)))
            .map(|at| self.lines[at].trim())
            .collect()
    }

    /// The definitions of the sweep whose line is missing or not gated.
    fn ungated_definitions(&self) -> Vec<&'static str> {
        SWEEP_DEFINITIONS
            .into_iter()
            .filter(|definition| {
                let at = self
                    .lines
                    .iter()
                    .position(|line| line.trim_start().starts_with(definition));
                !at.is_some_and(|at| self.is_gated(at))
            })
            .collect()
    }

    /// Whether the module of the sweep is declared right under the gate.
    fn declares_the_gated_module(&self) -> bool {
        let at = self.lines.iter().position(|line| line == "mod reclaim;");
        at.is_some_and(|at| self.is_gated(at))
    }
}

#[test]
fn every_export_of_the_sweep_carries_the_feature_gate() {
    let lib = Source::read(File::Lib);
    let journal = Source::read(File::JournalMod);
    let mut ungated = lib.ungated_mentions();
    ungated.extend(journal.ungated_mentions());
    assert!(ungated.is_empty(), "{ungated:?}");
    assert!(journal.declares_the_gated_module());
}

#[test]
fn every_definition_of_the_sweep_carries_the_feature_gate() {
    let missing = Source::read(File::Authority).ungated_definitions();
    assert!(missing.is_empty(), "{missing:?}");
}

#[test]
fn the_gate_scan_sees_an_ungated_export() {
    let gated =
        "#[cfg(feature = \"test-support\")]\npub use journal::{reclaim_with_binding, Reclaimed};\n";
    let ungated = "pub use journal::{\n    reclaim_with_binding, Reclaimed,\n};\n";
    let counts = [gated, ungated].map(|text| Source::of(text).ungated_mentions().len());
    assert_eq!(counts, [0, 1]);
}
