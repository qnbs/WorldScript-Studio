//! Headless CLI proving the Wave 2 lifecycle scenario runs with no GUI/Tauri runtime present.
//! `cargo run --bin wsproj -- demo-lifecycle`

use std::collections::hash_map::RandomState;
use std::env;
use std::fs::OpenOptions;
use std::hash::{BuildHasher, Hasher};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use worldscript_project::schema::{Character, StorySection};
use worldscript_project::{
    io, migrate_to_latest, parse_envelope, validate, ProjectEnvelope, StoryProject,
};

/// A scratch-file path under the OS temp dir with an unpredictable suffix, so a symlink
/// pre-planted at a guessable pid-only location can't be targeted ahead of time.
fn scratch_path(label: &str) -> PathBuf {
    let random = RandomState::new().build_hasher().finish();
    let mut path = env::temp_dir();
    path.push(format!(
        "wsproj-demo-{label}-{}-{random:016x}.json",
        std::process::id()
    ));
    path
}

/// Writes `contents` to a brand-new file at `path`, refusing to follow an existing symlink or
/// overwrite an existing file (`O_EXCL` semantics via `create_new`) — unlike `fs::write`, which
/// would silently follow a pre-existing symlink and truncate whatever it points to.
fn write_new_file(path: &Path, contents: &str) -> std::io::Result<()> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?
        .write_all(contents.as_bytes())
}

fn demo_lifecycle() -> Result<(), Box<dyn std::error::Error>> {
    let mut project = StoryProject::new("Demo Project", "A logline for the demo.");
    project.characters.push(Character {
        id: "char-1".to_string(),
        name: "Ada".to_string(),
        backstory: String::new(),
        motivation: String::new(),
        appearance: String::new(),
        personality_traits: String::new(),
        flaws: String::new(),
        notes: String::new(),
        has_avatar: None,
        character_arc: String::new(),
        relationships: String::new(),
    });
    project.manuscript.push(StorySection {
        id: "sec-1".to_string(),
        title: "Chapter One".to_string(),
        content: "It was a dark and stormy night.".to_string(),
        summary: None,
        notes: None,
        prompt: None,
        color: None,
        position: None,
        character_ids: None,
        world_ids: None,
        word_count: None,
        status: None,
        act: None,
        scene_start: None,
        scene_duration: None,
        scene_location_id: None,
        pov_character_id: None,
    });

    validate(&project)?;
    println!(
        "validated: {} character(s), {} section(s)",
        project.characters.len(),
        project.manuscript.len()
    );

    // Save-then-reload proves byte-for-byte round-trip fidelity of a current-schema project.
    let envelope = ProjectEnvelope::current(project);
    let path = scratch_path("lifecycle");
    write_new_file(&path, &serde_json::to_string_pretty(&envelope)?)?;
    println!("saved to {}", path.display());
    let reloaded = io::load_project(&path)?;
    assert_eq!(reloaded, envelope, "reload must round-trip exactly");
    std::fs::remove_file(&path)?;

    // Migration proof: hand-author a real v1 envelope (no `revisionNote` field), save it, reload
    // it from disk, then migrate — this exercises an actual v1 -> v2 step, not a same-version
    // no-op, and asserts the backfilled field survives re-validation.
    let v1_json = r#"{
        "schemaVersion": 1,
        "project": {
            "title": "Pre-Migration Demo Project",
            "logline": "Written before schema v2 existed.",
            "characters": [],
            "worlds": [],
            "manuscript": []
        }
    }"#;
    let v1_envelope = parse_envelope(v1_json)?;
    let migration_path = scratch_path("migration");
    write_new_file(
        &migration_path,
        &serde_json::to_string_pretty(&v1_envelope)?,
    )?;
    let reloaded_v1 = io::load_project(&migration_path)?;
    assert_eq!(
        reloaded_v1.schema_version, 1,
        "fixture must start at schema v1"
    );
    let migrated = migrate_to_latest(reloaded_v1)?;
    assert_eq!(migrated.schema_version, 2, "migration must reach schema v2");
    assert_eq!(
        migrated.project.revision_note.as_deref(),
        Some("migrated from schema v1"),
        "migration must backfill revision_note"
    );
    validate(&migrated.project)?;
    println!(
        "reloaded v1 project, migrated to schema v{}, revision_note={:?}, re-validated OK",
        migrated.schema_version, migrated.project.revision_note
    );
    std::fs::remove_file(&migration_path)?;

    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("demo-lifecycle") => match demo_lifecycle() {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("demo-lifecycle failed: {e}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: wsproj demo-lifecycle");
            ExitCode::FAILURE
        }
    }
}
