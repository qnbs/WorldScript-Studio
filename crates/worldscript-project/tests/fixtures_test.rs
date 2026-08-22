//! Golden-master fixture parity test. Same fixture files as
//! `tests/unit/projectGoldenMasters.test.ts` (repo root `tests/fixtures/project-golden-masters/`)
//! — this asserts the Rust side's accept/reject verdict on each fixture; the TS test asserts
//! `services/projectImportSchema.ts`'s current verdict independently. Neither side reads the
//! other's code; the shared byte-identical fixture is the oracle.
//!
//! Fixtures hold the raw project shape (title/logline/characters/worlds/manuscript), matching
//! `services/projectImportSchema.ts#importedProjectJsonSchema` — not the Rust-only
//! `ProjectEnvelope{schemaVersion,project}` wrapper, since Zod has no such wrapper.

use std::fs;
use std::path::PathBuf;
use worldscript_project::schema::{Coordinates, LocationType, StoryProject};
use worldscript_project::validate;

fn fixtures_dir() -> PathBuf {
    // crates/worldscript-project/tests/ -> crates/worldscript-project -> crates -> <repo root>
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/ parent")
        .parent()
        .expect("repo root")
        .join("tests/fixtures/project-golden-masters")
}

fn read_fixture(name: &str) -> String {
    let path = fixtures_dir().join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()))
}

#[test]
fn core_validation_envelope_is_accepted_after_migration() {
    let text = read_fixture("core-validation-envelope.json");
    let envelope = worldscript_project::parse_envelope(&text)
        .expect("the TypeScript Core envelope fixture should parse");
    let migrated = worldscript_project::migrate_to_latest(envelope)
        .expect("the Core envelope fixture should migrate");
    worldscript_project::validate(&migrated.project)
        .expect("the Core envelope fixture should validate");
}

#[test]
fn empty_project_is_accepted() {
    let text = read_fixture("empty-project.json");
    let project: StoryProject =
        serde_json::from_str(&text).expect("empty-project.json should be accepted");
    validate(&project).expect("empty-project.json must also pass structural validation");
}

#[test]
fn typical_project_is_accepted() {
    let text = read_fixture("typical-project.json");
    let project: StoryProject =
        serde_json::from_str(&text).expect("typical-project.json should be accepted");
    assert_eq!(project.characters.len(), 2);
    assert_eq!(project.manuscript.len(), 2);
    validate(&project).expect("typical-project.json must also pass structural validation");
}

#[test]
fn typical_project_round_trip_preserves_location_fields() {
    // A prior schema draft left `WorldLocation.type`/`coordinates`/`population` unmodeled, so serde
    // silently dropped them on save even though `services/projectImportSchema.ts` requires `type` —
    // this locks in that a save/reload round trip keeps them intact.
    let text = read_fixture("typical-project.json");
    let project: StoryProject =
        serde_json::from_str(&text).expect("typical-project.json should be accepted");
    let location = &project.worlds[0].locations[0];
    assert_eq!(location.location_type, LocationType::Other);
    assert_eq!(location.population, Some(1200));
    assert_eq!(
        location.coordinates,
        Some(Coordinates {
            lat: 12.5,
            lng: -3.25
        })
    );

    let serialized = serde_json::to_string(&project).expect("serialize round-trip");
    let reloaded: StoryProject = serde_json::from_str(&serialized).expect("reparse round-trip");
    assert_eq!(
        reloaded, project,
        "save/reload must not lose location fields"
    );
}

#[test]
fn large_project_is_accepted_and_preserves_counts() {
    let text = read_fixture("large-project.json");
    let project: StoryProject =
        serde_json::from_str(&text).expect("large-project.json should be accepted");
    assert_eq!(project.manuscript.len(), 250);
    assert_eq!(project.characters.len(), 30);
    validate(&project).expect("large-project.json must also pass structural validation");
}

#[test]
fn missing_title_is_rejected() {
    let text = read_fixture("missing-title.json");
    let project: Result<StoryProject, _> = serde_json::from_str(&text);
    assert!(
        project.is_err(),
        "missing-title.json should be rejected (title is required)"
    );
}

#[test]
fn truncated_json_is_rejected_without_panicking() {
    let text = read_fixture("truncated.json");
    let project: Result<StoryProject, _> = serde_json::from_str(&text);
    assert!(
        project.is_err(),
        "truncated.json should be rejected as invalid JSON"
    );
}
