//! Representative project lifecycle, proven with no GUI/Tauri runtime present
//! (see `crates/worldscript-project/Cargo.toml` — zero dependencies beyond serde/serde_json).

use std::env;
use std::sync::atomic::{AtomicU32, Ordering};
use worldscript_project::envelope::parse_envelope;
use worldscript_project::migrate::migrate_to_latest;
use worldscript_project::schema::{Character, StorySection};
use worldscript_project::validate::{validate, ValidationError};
use worldscript_project::{io, ProjectEnvelope, StoryProject};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// A unique temp-file path, avoiding a `tempfile` dependency for this narrow slice.
fn temp_path(label: &str) -> std::path::PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut path = env::temp_dir();
    path.push(format!(
        "wsproj-test-{}-{}-{}.json",
        std::process::id(),
        label,
        n
    ));
    path
}

fn sample_character() -> Character {
    Character {
        id: "char-1".to_string(),
        name: "Ada Lovelace".to_string(),
        backstory: "Mathematician.".to_string(),
        motivation: String::new(),
        appearance: String::new(),
        personality_traits: String::new(),
        flaws: String::new(),
        notes: String::new(),
        has_avatar: None,
        character_arc: String::new(),
        relationships: String::new(),
    }
}

fn sample_section() -> StorySection {
    StorySection {
        id: "sec-1".to_string(),
        title: "Chapter One".to_string(),
        content: "It was a dark and stormy night.".to_string(),
        summary: None,
        notes: None,
        word_count: None,
        status: None,
    }
}

#[test]
fn full_lifecycle_round_trips_with_no_data_loss() {
    // 1. Create a new project wrapped at the current schema version.
    let mut project = StoryProject::new("Test Project", "A test logline.");

    // 2. Add a character, add a manuscript section.
    project.characters.push(sample_character());
    project.manuscript.push(sample_section());

    // 3. Validate — must pass.
    validate(&project).expect("freshly built project must validate");

    let envelope = ProjectEnvelope::current(project);
    let path = temp_path("lifecycle");

    // 4. Save -> reload -> assert structural equality.
    io::save_project(&path, &envelope).expect("save must succeed");
    let reloaded = io::load_project(&path).expect("reload must succeed");
    assert_eq!(
        reloaded, envelope,
        "reload must be byte-for-byte structurally identical"
    );

    // 5. Simulate a schema bump: hand-construct a v1 envelope (no `revisionNote` field) and
    //    migrate it.
    let v1_json = r#"{
        "schemaVersion": 1,
        "project": {
            "title": "V1 Project",
            "logline": "Written before schema v2 existed.",
            "characters": [],
            "worlds": [],
            "manuscript": []
        }
    }"#;
    let v1_envelope = parse_envelope(v1_json).expect("v1 envelope must parse");
    assert_eq!(v1_envelope.schema_version, 1);
    assert!(v1_envelope.project.revision_note.is_none());

    let migrated = migrate_to_latest(v1_envelope).expect("migration must succeed");
    assert_eq!(migrated.schema_version, 2);
    assert_eq!(
        migrated.project.revision_note.as_deref(),
        Some("migrated from schema v1")
    );

    // 6. Reload the migrated shape from a saved file, re-validate, assert zero data loss.
    let migrated_path = temp_path("migrated");
    io::save_project(&migrated_path, &migrated).expect("save migrated envelope must succeed");
    let reloaded_migrated = io::load_project(&migrated_path).expect("reload migrated must succeed");
    validate(&reloaded_migrated.project).expect("migrated project must validate");
    assert_eq!(reloaded_migrated.project.title, "V1 Project");
    assert_eq!(reloaded_migrated.project.characters.len(), 0);

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&migrated_path);
}

#[test]
fn corrupt_json_fails_without_panicking() {
    let result = parse_envelope("{ this is not valid json");
    assert!(
        result.is_err(),
        "truncated/corrupt JSON must be a structured error, not a panic"
    );
}

#[test]
fn missing_required_field_is_rejected_with_field_name() {
    // Missing `title`.
    let json = r#"{"schemaVersion": 2, "project": {"logline": "no title here"}}"#;
    let err = parse_envelope(json).expect_err("missing required field must be rejected");
    let message = err.to_string();
    assert!(
        message.contains("title"),
        "error message should identify the missing field, got: {message}"
    );
}

#[test]
fn duplicate_character_ids_are_rejected() {
    let mut project = StoryProject::new("Dup Test", "logline");
    project.characters.push(sample_character());
    project.characters.push(sample_character()); // same id, on purpose
    let err = validate(&project).expect_err("duplicate character ids must be rejected");
    assert_eq!(
        err,
        ValidationError::DuplicateCharacterId("char-1".to_string())
    );
}

#[test]
fn same_id_across_different_record_types_is_allowed() {
    // Documents the intentional design: uniqueness is checked within each record type
    // independently (characters/worlds/sections), not globally across the whole project.
    let mut project = StoryProject::new("Cross-Type Test", "logline");
    let mut character = sample_character();
    character.id = "shared-id".to_string();
    let mut section = sample_section();
    section.id = "shared-id".to_string();
    project.characters.push(character);
    project.manuscript.push(section);
    validate(&project).expect("a character and a section may share an id");
}
