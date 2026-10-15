//! Gate 4 slice H1a-2: the removal primitives are not part of a build without the test-only
//! `test-support` feature. The proof is by compilation: the crate is built twice (the way a dependent
//! gets it, with default features, and with the feature) and a small crate that names the primitives is
//! compiled against each build. Without the feature it must fail with the error for a name that does not
//! exist; with the feature it must compile; and a control that names only what every build has must
//! compile against both, so a failure cannot come from the harness. (The scan in
//! `feature_isolation_removal_test` shows the same from the sources; this shows it from the compiler.)
//!
//! The nested builds use a target directory of their own, so they never wait for the lock of the build
//! that runs this test, and they respect `Cargo.lock` (`--locked`).

#![cfg(unix)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const CRATE: &str = "worldscript_secure_storage";

/// Names only what every build has.
const CONTROL: &str = "\
use worldscript_secure_storage::pinned::PinnedDir;
pub fn open(path: &std::path::Path) {
    let _ = PinnedDir::open_root(path);
}
";

/// Calls a removal primitive.
const NAMES_A_METHOD: &str = "\
use worldscript_secure_storage::pinned::PinnedDir;
pub fn remove(dir: &PinnedDir) {
    let _ = dir.remove_authenticated_file(\"a\", |_| Ok(true));
}
";

/// Imports the result type of a removal.
const NAMES_A_TYPE: &str = "\
use worldscript_secure_storage::pinned::RemovalOutcome;
pub fn outcome(outcome: RemovalOutcome) -> RemovalOutcome {
    outcome
}
";

/// A build of the crate: its library and the directory of its dependencies.
struct Build {
    rlib: PathBuf,
    deps: PathBuf,
}

fn crate_manifest() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")
}

/// The hashed library of this crate in the `deps` directory, found through its metadata file in the
/// `filenames` of the artifact in cargo's JSON output. (The plain `lib<name>.rlib` next to `deps` is a
/// link that the next build with other features overwrites; the hashed file is one per feature set.)
fn rlib_of(json_lines: &str) -> Option<PathBuf> {
    let line = json_lines.lines().find(|line| {
        line.contains("\"reason\":\"compiler-artifact\"")
            && line.contains(&format!("\"name\":\"{CRATE}\""))
            && line.contains("\"kind\":[\"lib\"]")
    })?;
    let names = line.split("\"filenames\":[").nth(1)?.split(']').next()?;
    names
        .split('"')
        .find(|piece| piece.contains("/deps/") && piece.ends_with(".rmeta"))
        .map(|metadata| PathBuf::from(metadata.replace(".rmeta", ".rlib")))
}

fn build(target_dir: &Path, features: &[&str]) -> Build {
    let mut command = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".into()));
    command
        .args(["build", "--locked", "--lib", "--message-format=json"])
        .arg("--manifest-path")
        .arg(crate_manifest())
        .arg("--target-dir")
        .arg(target_dir);
    if !features.is_empty() {
        command.arg("--features").arg(features.join(","));
    }
    // Nothing of the outer build may change how the inner one compiles.
    for inherited in ["CARGO_ENCODED_RUSTFLAGS", "RUSTFLAGS", "CARGO_TARGET_DIR"] {
        command.env_remove(inherited);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let rlib = rlib_of(&String::from_utf8_lossy(&output.stdout)).expect("the library artifact");
    let deps = rlib.parent().unwrap().to_path_buf();
    Build { rlib, deps }
}

/// Compiles `source` as a library against `build`; the error text if it does not compile.
fn compile(build: &Build, work: &Path, label: &str, source: &str) -> Result<(), String> {
    let file = work.join(format!("{label}.rs"));
    fs::write(&file, source).unwrap();
    let output = Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .args([
            "--edition",
            "2021",
            "--crate-type",
            "lib",
            "--emit",
            "metadata",
        ])
        .arg("--out-dir")
        .arg(work)
        .arg("--crate-name")
        .arg(label)
        .arg("--extern")
        .arg(format!("{CRATE}={}", build.rlib.display()))
        .arg("-L")
        .arg(format!("dependency={}", build.deps.display()))
        .arg(&file)
        .output()
        .unwrap();
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// A scratch directory below the temp dir, removed when dropped.
struct Work(PathBuf);

impl Work {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("wss-h1a2-compile-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Work(path)
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

type Verdict = Result<(), String>;

/// Which of the sources compile against a build: the control, the method and the type.
fn verdicts(build: &Build, work: &Path) -> [Verdict; 3] {
    [
        compile(build, work, "control", CONTROL),
        compile(build, work, "method", NAMES_A_METHOD),
        compile(build, work, "outcome", NAMES_A_TYPE),
    ]
}

#[test]
fn the_removal_primitives_exist_only_in_a_build_with_the_test_support_feature() {
    let work = Work::new();
    let target = work.0.join("target");
    let without = build(&target, &[]);
    let with = build(&target, &["test-support"]);
    let [control, method, outcome] = verdicts(&without, &work.0);
    let without_the_feature = (
        control,
        method.as_ref().err().map(|error| error.contains("E0599")),
        outcome.as_ref().err().map(|error| error.contains("E0432")),
    );
    let with_the_feature = verdicts(&with, &work.0);
    assert_eq!(
        (without_the_feature, with_the_feature),
        ((Ok(()), Some(true), Some(true)), [Ok(()), Ok(()), Ok(())]),
        "method: {method:?}\noutcome: {outcome:?}"
    );
}
