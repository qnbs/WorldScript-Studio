//! Versioned wrapper around `StoryProject`.
//!
//! No `schemaVersion` concept exists anywhere in `types.ts` or `services/projectImportSchema.ts`
//! today — this is invented from scratch for Wave 2, not ported from an existing field.

use crate::schema::StoryProject;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Current schema version this crate writes. Bump when `StoryProject`'s shape changes in a way
/// that requires a `migrate::Migration` entry to upgrade older files. v2 added `revision_note`
/// (see `migrate::v1_to_v2`).
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// The on-disk/on-wire shape: a schema version alongside the project payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEnvelope {
    pub schema_version: u32,
    pub project: StoryProject,
}

impl ProjectEnvelope {
    /// Wraps a project at the current schema version.
    pub fn current(project: StoryProject) -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            project,
        }
    }
}

/// A structured, non-panicking parse failure — always names the offending field when `serde_json`
/// provides one, matching `services/projectImportSchema.ts#parseImportedProjectJson`'s
/// `Invalid project file: <path>: <message>` convention.
#[derive(Debug)]
pub struct ParseError(serde_json::Error);

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid project file: {}", self.0)
    }
}

impl std::error::Error for ParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

/// Parses raw JSON text into a `ProjectEnvelope`. Never panics on malformed/truncated input —
/// `serde_json`'s `Error` already carries a line/column and, for a missing-field failure, the
/// field name.
pub fn parse_envelope(text: &str) -> Result<ProjectEnvelope, ParseError> {
    serde_json::from_str(text).map_err(ParseError)
}
