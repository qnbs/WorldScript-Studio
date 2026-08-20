//! Headless CLI proving the Wave 2 lifecycle scenario runs with no GUI/Tauri runtime present.
//! `cargo run --bin wsproj -- demo-lifecycle`

use std::env;
use std::process::ExitCode;
use worldscript_project::schema::{Character, StorySection};
use worldscript_project::{io, migrate_to_latest, validate, ProjectEnvelope, StoryProject};

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
        word_count: None,
        status: None,
    });

    validate(&project)?;
    println!(
        "validated: {} character(s), {} section(s)",
        project.characters.len(),
        project.manuscript.len()
    );

    let envelope = ProjectEnvelope::current(project);
    let mut path = env::temp_dir();
    path.push(format!("wsproj-demo-{}.json", std::process::id()));
    io::save_project(&path, &envelope)?;
    println!("saved to {}", path.display());

    let reloaded = io::load_project(&path)?;
    assert_eq!(reloaded, envelope, "reload must round-trip exactly");
    let migrated = migrate_to_latest(reloaded)?;
    validate(&migrated.project)?;
    println!(
        "reloaded, migrated to schema v{}, re-validated OK",
        migrated.schema_version
    );

    std::fs::remove_file(&path)?;
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
