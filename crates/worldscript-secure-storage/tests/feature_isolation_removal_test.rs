//! Gate 4 slice H1a-2: the primitives that remove an object through a pinned directory exist only with the
//! test-only `test-support` feature, and nothing in the crate calls them. A build without the feature
//! cannot name them at all: the module that holds them is declared under the gate on every platform, and
//! no other source file mentions them. (The no-dependent and default-feature checks of
//! `feature_isolation_test` cover who can request the feature.)

use std::fs;
use std::path::{Path, PathBuf};

const GATE: &str = "#[cfg(feature = \"test-support\")]";
/// What names a removal primitive, its result or its module.
const REMOVAL_NAMES: [&str; 9] = [
    "RemovalOutcome",
    "RemovalStage",
    "QUARANTINE_PREFIX",
    "remove_authenticated_file",
    "remove_empty_dir",
    "remove_leftover_file",
    "Observer",
    "removal::",
    "mod removal",
];
/// What starts a statement or an item in the sources that are scanned.
const STATEMENT_STARTS: [&str; 9] = [
    "pub use ",
    "use ",
    "mod ",
    "pub mod ",
    "pub(super) mod ",
    "pub fn ",
    "fn ",
    "impl ",
    "pub enum ",
];
/// The modules that hold the primitives, each declared by the file that is its parent.
const GATED_MODULES: [(&str, &str); 3] = [
    ("src/pinned/removal.rs", "src/pinned/mod.rs"),
    ("src/pinned/unix/removal.rs", "src/pinned/unix.rs"),
    ("src/pinned/windows/removal.rs", "src/pinned/windows.rs"),
];

fn crate_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

/// Every `.rs` file below `dir`, as paths relative to the crate.
fn sources_below(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(sources_below(&path));
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            found.push(path);
        }
    }
    found
}

fn relative(path: &Path) -> String {
    path.strip_prefix(crate_dir())
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/")
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

    fn read(relative_path: &str) -> Self {
        Self::of(&fs::read_to_string(crate_dir().join(relative_path)).unwrap())
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
            .unwrap_or(at)
    }

    fn names_a_removal(&self, at: usize) -> bool {
        let line = &self.lines[at];
        !line.trim_start().starts_with("//") && REMOVAL_NAMES.iter().any(|name| line.contains(name))
    }

    /// Every non-comment line that names a removal and whose statement is not gated.
    fn ungated_mentions(&self) -> Vec<&str> {
        (0..self.lines.len())
            .filter(|&at| self.names_a_removal(at))
            .filter(|&at| !self.is_gated(self.statement_head(at)))
            .map(|at| self.lines[at].trim())
            .collect()
    }

    /// Whether the module `removal` is declared right under the gate.
    fn declares_the_gated_module(&self) -> bool {
        self.lines
            .iter()
            .position(|line| line.trim_start().ends_with("mod removal;"))
            .is_some_and(|at| self.is_gated(at))
    }
}

fn is_a_gated_module_file(path: &str) -> bool {
    GATED_MODULES.iter().any(|(module, _)| *module == path) || path.starts_with("src/pinned/tests/")
}

#[test]
fn no_source_outside_the_gated_modules_names_a_removal_without_the_gate() {
    let mut ungated = Vec::new();
    for path in sources_below(&crate_dir().join("src")) {
        let path = relative(&path);
        if is_a_gated_module_file(&path) {
            continue;
        }
        for line in Source::read(&path).ungated_mentions() {
            ungated.push(format!("{path}: {line}"));
        }
    }
    assert!(ungated.is_empty(), "{ungated:?}");
}

#[test]
fn every_module_that_holds_a_removal_is_declared_under_the_gate() {
    let undeclared: Vec<&str> = GATED_MODULES
        .iter()
        .filter(|(module, parent)| {
            !crate_dir().join(module).is_file() || !Source::read(parent).declares_the_gated_module()
        })
        .map(|(module, _)| *module)
        .collect();
    assert!(undeclared.is_empty(), "{undeclared:?}");
}

#[test]
fn no_other_module_named_removal_exists() {
    let mut found: Vec<String> = sources_below(&crate_dir().join("src"))
        .iter()
        .map(|path| relative(path))
        .filter(|path| path.ends_with("/removal.rs"))
        .collect();
    found.sort();
    let mut expected: Vec<String> = GATED_MODULES
        .iter()
        .map(|(module, _)| (*module).to_owned())
        .collect();
    expected.sort();
    assert_eq!(found, expected);
}

#[test]
fn the_gate_scan_sees_an_ungated_export_and_an_ungated_declaration() {
    let gated =
        "#[cfg(feature = \"test-support\")]\npub use removal::{RemovalOutcome, RemovalStage};\n";
    let ungated = "pub use removal::{\n    RemovalOutcome, RemovalStage,\n};\n";
    let declared = |text: &str| Source::of(text).declares_the_gated_module();
    assert_eq!(
        (
            Source::of(gated).ungated_mentions().len(),
            Source::of(ungated).ungated_mentions().len(),
            declared("#[cfg(feature = \"test-support\")]\nmod removal;\n"),
            declared("pub(super) mod removal;\n"),
            declared("#[cfg(feature = \"test-support\")]\npub(super) mod removal;\n"),
        ),
        (0, 2, true, false, true)
    );
}
