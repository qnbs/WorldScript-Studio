//! Renderer-neutral R-15 protected-record primitives — Gate 1 of
//! `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §20.
//!
//! Headless only: the `WSR1` envelope header (§6.1), the record-class registry (§6.1.1), canonical
//! AAD (§6.2), and AES-256-GCM seal/open with an OS-backed nonce source (§6.3). It changes no
//! current TypeScript/Tauri storage authority and holds no key provider, journal, or durable I/O.

pub mod aad;
pub mod envelope;
pub mod error;
pub mod random;
pub mod record_class;
pub mod seal;

pub use aad::{canonical_aad, RecordContext};
pub use envelope::{parse_envelope, EnvelopeHeader, ParsedEnvelope};
pub use error::{AadError, OpenError, SealError};
pub use random::{OsRandom, RandomSource, RandomnessUnavailable};
pub use record_class::RecordClass;
pub use seal::{open, seal, Key, RecordMeta};
