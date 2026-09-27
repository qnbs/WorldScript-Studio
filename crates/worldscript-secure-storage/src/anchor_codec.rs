//! `WSA1` — the exact byte encoding of [`AnchorState`] inside a platform secure store (§8.2.2).
//! Decoding is strict (flags, lengths, slot codes, exact end) and the result is always passed
//! through [`crate::anchor::validate`]; there is no lenient or partial read.

use crate::anchor;
use crate::error::KeyProviderError;
use crate::provider::{
    AnchorState, CommittedRoot, InstallationScopeId, PreparedRootCommit, RootKeyRefV1, RootSlot,
    ANCHOR_FORMAT_VERSION, INSTALLATION_SCOPE_ID_LEN, SCOPE_FORMAT_VERSION,
};

pub const ANCHOR_MAGIC: [u8; 4] = *b"WSA1";

struct Writer(Vec<u8>);

impl Writer {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_be_bytes());
    }
    fn bytes(&mut self, v: &[u8]) {
        self.0.extend_from_slice(v);
    }
    fn key_ref(&mut self, key_ref: &RootKeyRefV1) {
        self.u16(key_ref.as_bytes().len() as u16);
        self.bytes(key_ref.as_bytes());
    }
    fn operation_id(&mut self, operation_id: &str) {
        self.u8(operation_id.len() as u8);
        self.bytes(operation_id.as_bytes());
    }
}

/// Encodes a validated anchor. An invalid anchor is refused rather than persisted.
pub fn encode(state: &AnchorState) -> Result<Vec<u8>, KeyProviderError> {
    anchor::validate(state)?;
    let mut w = Writer(Vec::with_capacity(512));
    w.bytes(&ANCHOR_MAGIC);
    w.u32(state.anchor_format_version);
    w.u32(state.scope_format_version);
    match &state.installation_scope_id {
        None => w.u8(0),
        Some(scope) => {
            w.u8(1);
            w.bytes(scope.as_str().as_bytes());
        }
    }
    w.u64(state.committed_floor);
    match (&state.committed_root, &state.last_committed_operation_id) {
        (Some(root), Some(operation_id)) => {
            w.u8(1);
            w.u64(root.root_generation);
            w.bytes(&root.root_digest);
            w.u8(root.root_slot.code());
            w.key_ref(&root.root_key_ref);
            w.operation_id(operation_id);
        }
        _ => w.u8(0),
    }
    match &state.prepared_root_commit {
        None => w.u8(0),
        Some(p) => {
            w.u8(1);
            w.operation_id(&p.operation_id);
            w.u64(p.expected_prior_floor);
            w.u64(p.target_root_generation);
            w.bytes(&p.target_final_root_digest);
            w.u8(p.target_slot.code());
            w.key_ref(&p.target_root_key_ref);
            w.u64(p.preparation_revision);
        }
    }
    Ok(w.0)
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

fn corrupt() -> KeyProviderError {
    KeyProviderError::RecoveryRequired
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], KeyProviderError> {
        let end = self
            .at
            .checked_add(len)
            .filter(|e| *e <= self.bytes.len())
            .ok_or_else(corrupt)?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }
    fn array<const N: usize>(&mut self) -> Result<[u8; N], KeyProviderError> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.take(N)?);
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8, KeyProviderError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, KeyProviderError> {
        Ok(u16::from_be_bytes(self.array()?))
    }
    fn u32(&mut self) -> Result<u32, KeyProviderError> {
        Ok(u32::from_be_bytes(self.array()?))
    }
    fn u64(&mut self) -> Result<u64, KeyProviderError> {
        Ok(u64::from_be_bytes(self.array()?))
    }
    fn flag(&mut self) -> Result<bool, KeyProviderError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(corrupt()),
        }
    }
    fn slot(&mut self) -> Result<RootSlot, KeyProviderError> {
        RootSlot::from_code(self.u8()?).map_err(|_| corrupt())
    }
    fn key_ref(&mut self) -> Result<RootKeyRefV1, KeyProviderError> {
        let len = usize::from(self.u16()?);
        RootKeyRefV1::new(self.take(len)?.to_vec()).map_err(|_| corrupt())
    }
    fn text(&mut self, len: usize) -> Result<String, KeyProviderError> {
        std::str::from_utf8(self.take(len)?)
            .map(str::to_owned)
            .map_err(|_| corrupt())
    }
    fn operation_id(&mut self) -> Result<String, KeyProviderError> {
        let len = usize::from(self.u8()?);
        self.text(len)
    }
    fn scope(&mut self) -> Result<InstallationScopeId, KeyProviderError> {
        let text = self.text(INSTALLATION_SCOPE_ID_LEN)?;
        InstallationScopeId::parse(&text).map_err(|_| corrupt())
    }
    fn committed(&mut self) -> Result<(CommittedRoot, String), KeyProviderError> {
        let root = CommittedRoot {
            root_generation: self.u64()?,
            root_digest: self.array()?,
            root_slot: self.slot()?,
            root_key_ref: self.key_ref()?,
        };
        Ok((root, self.operation_id()?))
    }
    fn prepared(&mut self) -> Result<PreparedRootCommit, KeyProviderError> {
        Ok(PreparedRootCommit {
            operation_id: self.operation_id()?,
            expected_prior_floor: self.u64()?,
            target_root_generation: self.u64()?,
            target_final_root_digest: self.array()?,
            target_slot: self.slot()?,
            target_root_key_ref: self.key_ref()?,
            preparation_revision: self.u64()?,
        })
    }
}

/// Strictly decodes and validates a stored anchor. An unknown magic or format version is
/// `UnsupportedAnchorFormat`; any other malformation is `RecoveryRequired`.
pub fn decode(bytes: &[u8]) -> Result<AnchorState, KeyProviderError> {
    let mut r = Reader { bytes, at: 0 };
    if r.take(4).ok() != Some(&ANCHOR_MAGIC[..]) {
        return Err(KeyProviderError::UnsupportedAnchorFormat);
    }
    // A newer anchor format may lay out everything after its version differently, so it is refused
    // before any version-1 field (including the scope format version) is read.
    let anchor_format_version = r.u32()?;
    if anchor_format_version != ANCHOR_FORMAT_VERSION {
        return Err(KeyProviderError::UnsupportedAnchorFormat);
    }
    let scope_format_version = r.u32()?;
    if scope_format_version != SCOPE_FORMAT_VERSION {
        return Err(KeyProviderError::UnsupportedAnchorFormat);
    }
    let mut state = AnchorState::empty();
    state.installation_scope_id = if r.flag()? { Some(r.scope()?) } else { None };
    state.committed_floor = r.u64()?;
    if r.flag()? {
        let (root, operation_id) = r.committed()?;
        state.committed_root = Some(root);
        state.last_committed_operation_id = Some(operation_id);
    }
    if r.flag()? {
        state.prepared_root_commit = Some(r.prepared()?);
    }
    if r.at != bytes.len() {
        return Err(corrupt());
    }
    anchor::validate(&state)?;
    Ok(state)
}
