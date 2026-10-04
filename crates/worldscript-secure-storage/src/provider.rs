//! Renderer-neutral key-provider contract (§8.1, §8.2) and the secure-anchor state it guards
//! (§5.3.1). Platform secure-store adapters implement [`KeyProvider`]; renderers never see raw keys.

use std::fmt;

use sha2::{Digest, Sha256};

use crate::error::KeyProviderError;
use crate::seal::Key;

/// §5.2.2: exactly 32 lowercase hexadecimal ASCII characters encoding 128 random bits.
pub const INSTALLATION_SCOPE_ID_LEN: usize = 32;
/// §6.1.2: bound for a non-secret key/epoch reference.
pub const MAX_ROOT_KEY_REF_LEN: usize = 256;
/// Secure-anchor and installation-scope format versions this crate reads and writes.
pub const ANCHOR_FORMAT_VERSION: u32 = 1;
pub const SCOPE_FORMAT_VERSION: u32 = 1;

const ROOT_KEY_REF_DIGEST_DOMAIN: &[u8] = b"worldscript-r15/root-key-ref/v1";

/// The immutable installation identity (§5.2.2). Only the canonical representation is accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallationScopeId(String);

impl InstallationScopeId {
    pub fn parse(value: &str) -> Result<Self, KeyProviderError> {
        let canonical = value.len() == INSTALLATION_SCOPE_ID_LEN
            && value
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
        if canonical {
            Ok(InstallationScopeId(value.to_owned()))
        } else {
            Err(KeyProviderError::MalformedInstallationScope)
        }
    }

    /// Encodes 128 random bits canonically (§5.3.2 first-time provisioning).
    pub fn from_random_bits(bits: [u8; 16]) -> Self {
        let mut out = String::with_capacity(INSTALLATION_SCOPE_ID_LEN);
        for byte in bits {
            out.push_str(&format!("{byte:02x}"));
        }
        InstallationScopeId(out)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// §8.2 `RootKeyRefV1`: a bounded, exact, opaque, non-secret, adapter-issued route to a key. Never
/// inferred from a path or key name and never text-normalized.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RootKeyRefV1(Vec<u8>);

impl RootKeyRefV1 {
    pub fn new(bytes: Vec<u8>) -> Result<Self, KeyProviderError> {
        if bytes.is_empty() || bytes.len() > MAX_ROOT_KEY_REF_LEN {
            return Err(KeyProviderError::MalformedKeyRef);
        }
        Ok(RootKeyRefV1(bytes))
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// `SHA-256("worldscript-r15/root-key-ref/v1" || u32be(len) || exact bytes)` (§8.2).
    pub fn digest(&self) -> [u8; 32] {
        Sha256::new()
            .chain_update(ROOT_KEY_REF_DIGEST_DOMAIN)
            .chain_update((self.0.len() as u32).to_be_bytes())
            .chain_update(&self.0)
            .finalize()
            .into()
    }
}

/// §5.4 root-slot codes: version 1 admits exactly `ROOT_SLOT_A = 0` and `ROOT_SLOT_B = 1`, so no
/// other value is representable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootSlot {
    A,
    B,
}

impl RootSlot {
    pub fn code(self) -> u8 {
        match self {
            RootSlot::A => 0,
            RootSlot::B => 1,
        }
    }

    pub fn from_code(code: u8) -> Result<Self, KeyProviderError> {
        match code {
            0 => Ok(RootSlot::A),
            1 => Ok(RootSlot::B),
            _ => Err(KeyProviderError::MalformedRootSlot),
        }
    }

    /// The slot a new root must target while this slot holds the committed root.
    pub fn other(self) -> Self {
        match self {
            RootSlot::A => RootSlot::B,
            RootSlot::B => RootSlot::A,
        }
    }
}

/// §8.1 key state machine as observed by Core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyState {
    Unconfigured,
    Locked,
    Unlocked { epoch: u64 },
    Migrating { source: u64, target: u64 },
    RecoveryRequired,
    KeyLost,
    ResetRequired,
}

/// Non-secret identity and availability of one epoch key, for enumeration/diagnostics only: never a
/// trust-routing mechanism for the root (§5.3.1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpochInfo {
    pub epoch: u64,
    pub key_ref: RootKeyRefV1,
    pub available: bool,
}

/// `committed_root` (§5.3.1): the trusted cold-start root binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedRoot {
    pub root_generation: u64,
    pub root_digest: [u8; 32],
    pub root_slot: RootSlot,
    pub root_key_ref: RootKeyRefV1,
}

/// Non-secret witness of a live, validated unlock session, not read authorization. External
/// commits may stale this binding; explicit lock and failed unlock must clear it with the keys.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionBinding {
    pub scope: InstallationScopeId,
    pub root: CommittedRoot,
}

/// `prepared_root_commit` (§5.3.1): recovery authorization only, never read authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedRootCommit {
    pub operation_id: String,
    pub expected_prior_floor: u64,
    pub target_root_generation: u64,
    pub target_final_root_digest: [u8; 32],
    pub target_slot: RootSlot,
    pub target_root_key_ref: RootKeyRefV1,
    pub preparation_revision: u64,
}

/// The rollback-resistant secure-anchor state (§5.3.1 `read_root_anchor_state`).
#[derive(Clone, PartialEq, Eq)]
pub struct AnchorState {
    pub anchor_format_version: u32,
    pub scope_format_version: u32,
    pub installation_scope_id: Option<InstallationScopeId>,
    pub committed_floor: u64,
    pub committed_root: Option<CommittedRoot>,
    /// The `operation_id` whose step F produced `committed_root`: the exact evidence that makes a
    /// replayed F an idempotent success (§5.3.1). Present exactly when `committed_root` is.
    pub last_committed_operation_id: Option<String>,
    pub prepared_root_commit: Option<PreparedRootCommit>,
}

impl fmt::Debug for AnchorState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AnchorState")
            .field("anchor_format_version", &self.anchor_format_version)
            .field("committed_floor", &self.committed_floor)
            .field("has_committed_root", &self.committed_root.is_some())
            .field(
                "has_prepared_root_commit",
                &self.prepared_root_commit.is_some(),
            )
            .finish_non_exhaustive()
    }
}

impl AnchorState {
    /// A fresh anchor: no scope, floor 0, no root, nothing prepared.
    pub fn empty() -> Self {
        AnchorState {
            anchor_format_version: ANCHOR_FORMAT_VERSION,
            scope_format_version: SCOPE_FORMAT_VERSION,
            installation_scope_id: None,
            committed_floor: 0,
            committed_root: None,
            last_committed_operation_id: None,
            prepared_root_commit: None,
        }
    }
}

/// Step-C arguments of the two-phase anchor commit (§5.3.1 `prepare_root_anchor`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrepareRootAnchor {
    pub operation_id: String,
    pub expected_floor: u64,
    pub target_root_generation: u64,
    pub target_final_root_digest: [u8; 32],
    pub target_slot: RootSlot,
    pub target_root_key_ref: RootKeyRefV1,
}

/// The Core-facing provider boundary (§8.2, §5.3.1). A platform adapter persists [`AnchorState`] in
/// its secure store (never the WorldScript filesystem), applies the [`crate::anchor`] transitions,
/// and must fail closed with [`KeyProviderError::SecureAnchorUnavailable`] when it cannot provide
/// the required semantics. Under the Option C decision the normal runtime unlock reads the secure
/// store and takes no passphrase; the recovery passphrase belongs only to [`crate::recovery`].
pub trait KeyProvider {
    /// Current authority state (§8.1): `Unconfigured` until the first root commits (step F),
    /// whatever scope or bootstrap keys already exist; `RecoveryRequired` for an inconsistent
    /// anchor. An unavailable secure store or unsupported anchor format is returned as its own
    /// error, never disguised as a key state.
    fn state(&self) -> Result<KeyState, KeyProviderError>;
    /// Local session evidence only: never infer this from the current durable anchor or callers.
    /// Return None without a live unlocked session bound to a committed root, including after lock.
    fn session_binding(&self) -> Option<SessionBinding>;
    /// Opaque key for a data epoch, or a typed unavailable result.
    fn resolve(&self, epoch: u64) -> Result<Key, KeyProviderError>;
    /// The trusted cold-start route: resolves exactly this reference, never searches (§5.3.1).
    fn resolve_ref(&self, key_ref: &RootKeyRefV1) -> Result<Key, KeyProviderError>;
    /// Clears runtime key handles/material; afterwards every resolve is `Locked`.
    fn lock(&mut self);
    /// Loads the secure store's key handles for runtime use (no passphrase, §8.2).
    fn unlock(&mut self) -> Result<KeyState, KeyProviderError>;
    /// Enumeration/diagnostics only (§8.2).
    fn list_epochs(&self) -> Result<Vec<EpochInfo>, KeyProviderError>;
    /// Provisions a fresh random 256-bit key for `epoch` and returns its opaque route.
    fn provision_epoch_key(&mut self, epoch: u64) -> Result<RootKeyRefV1, KeyProviderError>;
    fn read_root_anchor_state(&self) -> Result<AnchorState, KeyProviderError>;
    fn read_or_provision_installation_scope(
        &mut self,
    ) -> Result<InstallationScopeId, KeyProviderError>;
    /// Step C. The adapter first proves `target_root_key_ref` is a route it issued and can resolve.
    fn prepare_root_anchor(&mut self, request: &PrepareRootAnchor) -> Result<(), KeyProviderError>;
    fn commit_root_anchor(
        &mut self,
        operation_id: &str,
        target_root_generation: u64,
    ) -> Result<(), KeyProviderError>;
    fn abort_or_recover_root_anchor(&mut self, operation_id: &str) -> Result<(), KeyProviderError>;
}
