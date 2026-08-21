//! Cross-language redaction fixture parity for the renderer-neutral diagnostics contract.

use serde::Deserialize;
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
use worldscript_diagnostics::sanitize_context;

#[derive(Debug, Deserialize)]
struct RedactionFixture {
    name: String,
    context: Map<String, Value>,
    sanitized: Map<String, Value>,
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/ parent")
        .parent()
        .expect("repo root")
        .join("tests/fixtures/diagnostics/redaction-cases.json")
}

#[test]
fn rust_redaction_matches_the_shared_typescript_fixture_contract() {
    let path = fixture_path();
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    let fixtures: Vec<RedactionFixture> =
        serde_json::from_str(&text).expect("redaction fixture must be valid JSON");

    for fixture in fixtures {
        assert_eq!(
            sanitize_context(&fixture.context),
            fixture.sanitized,
            "Rust redaction diverged for fixture {}",
            fixture.name
        );
    }
}
