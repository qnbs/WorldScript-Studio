//! Post-deserialization structural validation.
//!
//! `title`/`logline` presence-and-type checks are already enforced by `serde` at the JSON-parse
//! boundary (see `envelope::parse_envelope`) — that mirrors `services/projectImportSchema.ts`'s
//! `title: z.string()` / `logline: z.string()` exactly (Zod does not require non-empty strings
//! either, so this crate does not add that check, to keep golden-master parity honest). What's
//! left here is a genuinely new invariant Zod does not currently enforce at all: unique record
//! IDs. This is an intentional Rust-side tightening, not a ported rule — flagged explicitly so it
//! doesn't get mistaken for existing TS behavior.

use crate::schema::StoryProject;
use std::collections::HashSet;
use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub enum ValidationError {
    DuplicateCharacterId(String),
    DuplicateWorldId(String),
    DuplicateSectionId(String),
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ValidationError::DuplicateCharacterId(id) => {
                write!(f, "duplicate character id: {id}")
            }
            ValidationError::DuplicateWorldId(id) => write!(f, "duplicate world id: {id}"),
            ValidationError::DuplicateSectionId(id) => {
                write!(f, "duplicate manuscript section id: {id}")
            }
        }
    }
}

impl std::error::Error for ValidationError {}

/// Validates structural invariants on an already-deserialized project.
pub fn validate(project: &StoryProject) -> Result<(), ValidationError> {
    let mut seen = HashSet::new();
    for c in &project.characters {
        if !seen.insert(&c.id) {
            return Err(ValidationError::DuplicateCharacterId(c.id.clone()));
        }
    }

    let mut seen = HashSet::new();
    for w in &project.worlds {
        if !seen.insert(&w.id) {
            return Err(ValidationError::DuplicateWorldId(w.id.clone()));
        }
    }

    let mut seen = HashSet::new();
    for s in &project.manuscript {
        if !seen.insert(&s.id) {
            return Err(ValidationError::DuplicateSectionId(s.id.clone()));
        }
    }

    Ok(())
}
