//! Renderer-neutral project schema, mirroring the domain shapes in `types.ts`.
//!
//! `characters`/`worlds` are plain `Vec<T>` here, not the `Character[] | EntityState<Character,
//! string>` union `types.ts` uses today — that union exists only because the TS side normalizes
//! into Redux Toolkit's `EntityState` shape at the type level. This struct is the renderer-neutral
//! shape a future adapter converts to/from; it does not itself know about Redux.

use serde::{Deserialize, Serialize};

/// Mirrors `types.ts`'s `Character` interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub backstory: String,
    #[serde(default)]
    pub motivation: String,
    #[serde(default)]
    pub appearance: String,
    #[serde(default)]
    pub personality_traits: String,
    #[serde(default)]
    pub flaws: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_avatar: Option<bool>,
    #[serde(default)]
    pub character_arc: String,
    #[serde(default)]
    pub relationships: String,
}

/// Mirrors `types.ts`'s `WorldLocation` interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldLocation {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Coordinates>,
    /// `worldLocationSchema.type` is a required enum in `services/projectImportSchema.ts`, not an
    /// optional free-form string — mirrored precisely so an unmodeled value is rejected, not dropped.
    #[serde(rename = "type")]
    pub location_type: LocationType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub population: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub significance: Option<String>,
}

/// Mirrors `worldLocationSchema.coordinates` (`{ lat: number, lng: number }`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Coordinates {
    pub lat: f64,
    pub lng: f64,
}

/// Mirrors `worldLocationSchema.type`'s enum exactly — `city | village | forest | mountain |
/// castle | temple | other`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocationType {
    City,
    Village,
    Forest,
    Mountain,
    Castle,
    Temple,
    Other,
}

/// Mirrors `types.ts`'s `WorldTimelineEvent` interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldTimelineEvent {
    pub id: String,
    pub era: String,
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

/// Mirrors `types.ts`'s `World` interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub id: String,
    pub name: String,
    /// `services/projectImportSchema.ts`'s `worldSchema` has `description: z.string().optional()
    /// .default('')`, unlike `WorldLocation.description` (required there) — mirrored precisely.
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub geography: String,
    #[serde(default)]
    pub magic_system: String,
    #[serde(default)]
    pub culture: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub timeline: Vec<WorldTimelineEvent>,
    #[serde(default)]
    pub locations: Vec<WorldLocation>,
}

/// Mirrors `types.ts`'s `StorySection` interface (manuscript scene/chapter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorySection {
    pub id: String,
    pub title: String,
    /// `services/projectImportSchema.ts`'s `storySectionSchema` has `content: z.string().optional()
    /// .default('')` — mirrored here so a section JSON that omits `content` (valid to the TS
    /// importer) is accepted here too, not rejected as a missing required field.
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<SectionStatus>,
}

/// Mirrors `storySectionSchema.status`'s enum exactly — `draft | outline | first-draft | revised |
/// final`. Modeled as a closed enum (not `Option<String>`) so an unsupported value like
/// `"published"` is rejected at parse time instead of silently accepted, matching Zod's rejection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SectionStatus {
    Draft,
    Outline,
    FirstDraft,
    Revised,
    Final,
}

/// Mirrors `types.ts`'s `StoryProject` interface. Deliberately narrower than the full TS shape —
/// `outline`/`binderNodes`/`compileProfile`/`projectGoals`/`writingHistory` are out of scope for
/// this first slice (see `docs/native/CORE-MIGRATION-LEDGER.md`); only the fields exercised by the
/// Wave 2 headless lifecycle scenario are modeled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryProject {
    pub title: String,
    pub logline: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub characters: Vec<Character>,
    #[serde(default)]
    pub worlds: Vec<World>,
    #[serde(default)]
    pub manuscript: Vec<StorySection>,
    /// Added at schema v2. Absent in v1 files; `migrate::migrate_to_latest` backfills it. Exists
    /// purely to give the Wave 2 headless harness a real migration to prove, not a production field.
    #[serde(default)]
    pub revision_note: Option<String>,
}

impl StoryProject {
    /// A new, empty project at the current schema version — mirrors the "create new project"
    /// entry point on the TS side.
    pub fn new(title: impl Into<String>, logline: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            logline: logline.into(),
            author: None,
            characters: Vec::new(),
            worlds: Vec::new(),
            manuscript: Vec::new(),
            revision_note: None,
        }
    }
}
