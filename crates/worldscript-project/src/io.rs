//! Plain JSON load/save.
//!
//! Deliberately no compression and no atomic-write guarantees — those are Wave 3 scope
//! (`docs/native/ROADMAP-QT-GPUI-DESKTOP.md` §15 Wave 3, "storage correctness and R-15 design"),
//! not this crate's job. This module proves the schema/validation/migration pattern round-trips
//! through real file I/O; it is not the eventual production storage path.

use crate::envelope::{parse_envelope, ParseError, ProjectEnvelope};
use std::fmt;
use std::fs;
use std::path::Path;

#[derive(Debug)]
pub enum IoError {
    Read(std::io::Error),
    Write(std::io::Error),
    Parse(ParseError),
    Serialize(serde_json::Error),
}

impl fmt::Display for IoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IoError::Read(e) => write!(f, "failed to read project file: {e}"),
            IoError::Write(e) => write!(f, "failed to write project file: {e}"),
            IoError::Parse(e) => write!(f, "{e}"),
            IoError::Serialize(e) => write!(f, "failed to serialize project: {e}"),
        }
    }
}

impl std::error::Error for IoError {}

/// Loads and parses a `ProjectEnvelope` from `path`. Does not migrate — callers that need the
/// latest shape should pass the result through `migrate::migrate_to_latest`.
pub fn load_project(path: impl AsRef<Path>) -> Result<ProjectEnvelope, IoError> {
    let text = fs::read_to_string(path).map_err(IoError::Read)?;
    parse_envelope(&text).map_err(IoError::Parse)
}

/// Serializes and writes a `ProjectEnvelope` to `path` as pretty-printed JSON.
pub fn save_project(path: impl AsRef<Path>, envelope: &ProjectEnvelope) -> Result<(), IoError> {
    let text = serde_json::to_string_pretty(envelope).map_err(IoError::Serialize)?;
    fs::write(path, text).map_err(IoError::Write)
}
