//! `worldscript-project` — renderer-neutral project schema, validation, migration, and I/O.
//!
//! First Wave 2 slice ("Rust Core extraction and headless harness",
//! `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` §15). Proves the pattern with the highest-priority
//! capability from `docs/native/CORE-MIGRATION-LEDGER.md`: the canonical project schema plus
//! enough validation/migration/I/O to round-trip a representative project lifecycle without any
//! GUI runtime. Deliberately does not include encryption, task orchestration, or AI request
//! logic — see the ledger for what's deferred and why.

pub mod envelope;
pub mod io;
pub mod migrate;
pub mod schema;
pub mod validate;

pub use envelope::{parse_envelope, ParseError, ProjectEnvelope, CURRENT_SCHEMA_VERSION};
pub use migrate::migrate_to_latest;
pub use schema::{Character, StoryProject, StorySection, World};
pub use validate::{validate, ValidationError};
