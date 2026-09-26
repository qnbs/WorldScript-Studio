use sha2::{Digest, Sha256};

use crate::envelope::HEADER_LEN;
use crate::error::AadError;
use crate::record_class::RecordClass;

pub const DOMAIN: &str = "worldscript-r15";
/// §6.1.2: canonical AAD maximum.
pub const MAX_AAD_LEN: usize = 32 * 1024;
/// §6.2 "tagged-binding reuse": version 1's entry-type-independent direct-form cap per identity field.
pub const MAX_DIRECT_IDENTITY_LEN: usize = 256;

const LOGICAL_ID_HASH_DOMAIN: &[u8] = b"worldscript-r15/logical-id/v1";
const PROJECT_ID_HASH_DOMAIN: &[u8] = b"worldscript-r15/project-id/v1";
const TAG_ABSENT: u8 = 0;
const TAG_DIRECT: u8 = 1;
const TAG_HASHED: u8 = 2;
const HASHED_BINDING_LEN: usize = 1 + 32;

/// The caller-supplied logical context authenticated as AAD (§6.1.1): never stored in the envelope,
/// so it must come from verified ownership records, not from the bytes being opened. `Debug` shows
/// only the class and identity lengths: logical and project IDs may be user-derived (§14).
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct RecordContext<'a> {
    pub record_class: RecordClass,
    pub logical_record_id: &'a str,
    pub project_id: Option<&'a str>,
}

impl std::fmt::Debug for RecordContext<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RecordContext")
            .field("record_class", &self.record_class)
            .field("logical_record_id_len", &self.logical_record_id.len())
            .field("project_id_len", &self.project_id.map(str::len))
            .finish()
    }
}

fn push_length_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

fn hashed_binding(domain: &[u8], identity: &str) -> [u8; HASHED_BINDING_LEN] {
    let bytes = identity.as_bytes();
    let digest = Sha256::new()
        .chain_update(domain)
        .chain_update((bytes.len() as u32).to_be_bytes())
        .chain_update(bytes)
        .finalize();
    let mut out = [0u8; HASHED_BINDING_LEN];
    out[0] = TAG_HASHED;
    out[1..].copy_from_slice(&digest);
    out
}

fn direct_binding_len(identity: &str) -> usize {
    1 + 4 + identity.len()
}

/// The one binding form shared by both identity fields (§6.2 rule D: never mixed).
#[derive(Clone, Copy)]
enum IdentityForm {
    Direct,
    Hashed,
}

impl IdentityForm {
    fn encoded_len(self, identity: &str) -> usize {
        match self {
            IdentityForm::Direct => direct_binding_len(identity),
            IdentityForm::Hashed => HASHED_BINDING_LEN,
        }
    }

    fn push(self, out: &mut Vec<u8>, hash_domain: &[u8], identity: &str) {
        match self {
            IdentityForm::Direct => {
                out.push(TAG_DIRECT);
                push_length_prefixed(out, identity.as_bytes());
            }
            IdentityForm::Hashed => out.extend_from_slice(&hashed_binding(hash_domain, identity)),
        }
    }
}

/// Every present identity field is direct only if each is within the 256-byte cap; otherwise both
/// present fields are hashed.
fn identity_form(context: &RecordContext<'_>) -> IdentityForm {
    let over_cap = |id: &str| id.len() > MAX_DIRECT_IDENTITY_LEN;
    if over_cap(context.logical_record_id) || context.project_id.is_some_and(over_cap) {
        IdentityForm::Hashed
    } else {
        IdentityForm::Direct
    }
}

/// §6.2: a present identity is never empty. An empty ID would authenticate a record bound to no
/// owner, and `Some("")` must never collapse into the absent (`None`, tag `0`) project binding.
fn reject_empty_identities(context: &RecordContext<'_>) -> Result<(), AadError> {
    if context.logical_record_id.is_empty() {
        return Err(AadError::EmptyLogicalRecordId);
    }
    if context.project_id == Some("") {
        return Err(AadError::EmptyProjectId);
    }
    Ok(())
}

/// Canonical AAD (§6.2) for `context` over the exact 52-byte routing header.
///
/// Direct-vs-hashed selection is the contract's single deterministic rule: every present identity
/// field uses its direct form only if each is within the 256-byte cap; if either exceeds it, BOTH
/// present fields use their tagged hashed forms (rule D). That cap subsumes rule A (a field over
/// 16,384 bytes is over 256 too) and makes rule B/C's 32 KiB test unreachable for direct forms,
/// but rule E's final bound is still enforced before the buffer is built.
pub fn canonical_aad(
    context: &RecordContext<'_>,
    header: &[u8; HEADER_LEN],
) -> Result<Vec<u8>, AadError> {
    reject_empty_identities(context)?;
    let class = context.record_class.token();
    let form = identity_form(context);
    let project_len = context.project_id.map_or(1, |id| form.encoded_len(id));
    let total = 4
        + DOMAIN.len()
        + 4
        + class.len()
        + form.encoded_len(context.logical_record_id)
        + project_len
        + HEADER_LEN;
    if total > MAX_AAD_LEN {
        return Err(AadError::ExceedsMaximum);
    }

    let mut out = Vec::with_capacity(total);
    push_length_prefixed(&mut out, DOMAIN.as_bytes());
    push_length_prefixed(&mut out, class.as_bytes());
    form.push(&mut out, LOGICAL_ID_HASH_DOMAIN, context.logical_record_id);
    match context.project_id {
        None => out.push(TAG_ABSENT),
        Some(id) => form.push(&mut out, PROJECT_ID_HASH_DOMAIN, id),
    }
    out.extend_from_slice(header);
    debug_assert_eq!(out.len(), total);
    Ok(out)
}
