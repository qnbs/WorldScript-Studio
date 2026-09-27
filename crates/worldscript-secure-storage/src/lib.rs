//! Renderer-neutral R-15 protected-record primitives — Gate 1 of
//! `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §20.
//!
//! Headless only: the `WSR1` envelope header (§6.1), the record-class registry (§6.1.1), canonical
//! AAD (§6.2), and AES-256-GCM seal/open with an OS-backed nonce source (§6.3). It changes no
//! current TypeScript/Tauri storage authority and holds no key provider, journal, or durable I/O.

pub mod aad;
pub mod anchor;
pub mod anchor_codec;
pub mod envelope;
pub mod error;
pub mod kdf;
#[cfg(feature = "test-support")]
pub mod memory_provider;
pub mod provider;
pub mod random;
pub mod record_class;
pub mod recovery;
pub mod seal;
pub mod secure_store;
pub mod store_provider;

pub use aad::{canonical_aad, RecordContext};
pub use envelope::{parse_envelope, EnvelopeHeader, ParsedEnvelope};
pub use error::{AadError, KdfError, KeyProviderError, OpenError, RecoveryError, SealError};
pub use kdf::{derive_kek, KdfProfile, WSS_ARGON2ID_V1};
pub use provider::{
    AnchorState, CommittedRoot, EpochInfo, InstallationScopeId, KeyProvider, KeyState,
    PrepareRootAnchor, PreparedRootCommit, RootKeyRefV1, RootSlot,
};
pub use random::{OsRandom, RandomSource, RandomnessUnavailable};
pub use record_class::RecordClass;
pub use recovery::{unwrap_recovery, wrap_recovery, RecoveryMaterial, UnwrappedRecovery};
#[cfg(feature = "test-randomness")]
pub use seal::seal_with_random;
pub use seal::{open, seal, Key, RecordMeta, SealTarget};
