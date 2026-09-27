//! The secure-store item layout (§8.2.2): item names, the exact route grammar, the strict `WSE1`
//! epoch-index encoding, and the item-size bound. Pure and provider-independent: nothing here reads
//! or writes a store or decides authority.

use crate::error::KeyProviderError;
use crate::provider::RootKeyRefV1;

/// Store item holding the `WSA1`-encoded anchor (see [`crate::anchor_codec`]).
pub const ANCHOR_ACCOUNT: &str = "r15-anchor-v1";
/// Store item holding the `WSE1`-encoded epoch-to-route index.
pub const EPOCH_INDEX_ACCOUNT: &str = "r15-epochs-v1";
/// Version 1 indexes at most this many epochs, so the index item stays well inside the smallest
/// platform limit (a Windows generic credential blob is 2,560 bytes).
pub const MAX_INDEXED_EPOCHS: usize = 32;
/// No secure-store item may exceed this many bytes.
pub const MAX_ITEM_LEN: usize = 2560;
/// Every key item holds exactly this many random bytes.
pub const KEY_LEN: usize = 32;

const KEY_ACCOUNT_PREFIX: &str = "r15-key-";
const ROUTE_PREFIX: &str = "wss-kr1-";
const ROUTE_HEX_LEN: usize = 32;
const EPOCH_INDEX_MAGIC: [u8; 4] = *b"WSE1";

fn corrupt() -> KeyProviderError {
    KeyProviderError::RecoveryRequired
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The route for 16 random bytes: `wss-kr1-` plus 32 lowercase hexadecimal characters.
pub fn route_from_bits(bits: [u8; 16]) -> Result<RootKeyRefV1, KeyProviderError> {
    RootKeyRefV1::new(format!("{ROUTE_PREFIX}{}", hex(&bits)).into_bytes())
}

/// Whether `route` has the exact issued grammar (`wss-kr1-` + 32 lowercase hex, 40 bytes).
pub fn is_issued_route(route: &[u8]) -> bool {
    route.len() == ROUTE_PREFIX.len() + ROUTE_HEX_LEN
        && route.starts_with(ROUTE_PREFIX.as_bytes())
        && route[ROUTE_PREFIX.len()..]
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

/// The key item name for a route. Callers pass only routes read from a decoded index, so an item
/// name is never built from arbitrary caller input.
pub fn key_account(route: &RootKeyRefV1) -> String {
    format!("{KEY_ACCOUNT_PREFIX}{}", hex(route.as_bytes()))
}

/// Refuses an item larger than [`MAX_ITEM_LEN`].
pub fn check_item_len(item: Vec<u8>) -> Result<Vec<u8>, KeyProviderError> {
    if item.len() > MAX_ITEM_LEN {
        Err(KeyProviderError::AnchorConflict(
            "secure-store item exceeds the version-1 size bound",
        ))
    } else {
        Ok(item)
    }
}

/// One indexed epoch key: its epoch and its issued route.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    pub epoch: u64,
    pub key_ref: RootKeyRefV1,
}

/// Canonical `WSE1` encoding: `"WSE1"`, `u32be(count)`, then per entry `u64be(epoch)`,
/// `u16be(route_len)`, route. Refuses entries `decode_index` would refuse, or an oversized item.
pub fn encode_index(entries: &[IndexEntry]) -> Result<Vec<u8>, KeyProviderError> {
    if entries.len() > MAX_INDEXED_EPOCHS {
        return Err(KeyProviderError::AnchorConflict("the epoch index is full"));
    }
    let mut checked: Vec<IndexEntry> = Vec::with_capacity(entries.len());
    let mut out = Vec::with_capacity(8 + entries.len() * 50);
    out.extend_from_slice(&EPOCH_INDEX_MAGIC);
    out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
    for entry in entries {
        if !admissible(&checked, entry) {
            return Err(KeyProviderError::AnchorConflict(
                "index entries must be unique, assigned and issued",
            ));
        }
        out.extend_from_slice(&entry.epoch.to_be_bytes());
        out.extend_from_slice(&(entry.key_ref.as_bytes().len() as u16).to_be_bytes());
        out.extend_from_slice(entry.key_ref.as_bytes());
        checked.push(entry.clone());
    }
    check_item_len(out)
}

struct IndexReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> IndexReader<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], KeyProviderError> {
        let slice = self.slice(N)?;
        let mut out = [0u8; N];
        out.copy_from_slice(slice);
        Ok(out)
    }

    fn slice(&mut self, len: usize) -> Result<&'a [u8], KeyProviderError> {
        let end = self
            .at
            .checked_add(len)
            .filter(|e| *e <= self.bytes.len())
            .ok_or_else(corrupt)?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn entry(&mut self) -> Result<IndexEntry, KeyProviderError> {
        let epoch = u64::from_be_bytes(self.take()?);
        let len = usize::from(u16::from_be_bytes(self.take()?));
        let key_ref = RootKeyRefV1::new(self.slice(len)?.to_vec()).map_err(|_| corrupt())?;
        Ok(IndexEntry { epoch, key_ref })
    }
}

/// An entry is admissible after `entries` if its epoch is assigned (not 0 or `u64::MAX`), its
/// route has the issued grammar, and neither its epoch nor its route repeats.
fn admissible(entries: &[IndexEntry], entry: &IndexEntry) -> bool {
    let assigned =
        entry.epoch != 0 && entry.epoch != u64::MAX && is_issued_route(entry.key_ref.as_bytes());
    let unique = entries
        .iter()
        .all(|e| e.epoch != entry.epoch && e.key_ref != entry.key_ref);
    assigned && unique
}

/// Strict `WSE1` decode. Any malformation — including a wrong magic, a count above the bound, a
/// non-canonical route, a repeated epoch or route, truncation, or trailing bytes — is
/// `RecoveryRequired`: the index is a control item, not a format a newer Core could have written.
pub fn decode_index(bytes: &[u8]) -> Result<Vec<IndexEntry>, KeyProviderError> {
    let mut reader = IndexReader { bytes, at: 0 };
    if reader.take::<4>()? != EPOCH_INDEX_MAGIC {
        return Err(corrupt());
    }
    let count = u32::from_be_bytes(reader.take()?) as usize;
    if count > MAX_INDEXED_EPOCHS {
        return Err(corrupt());
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let entry = reader.entry()?;
        if !admissible(&entries, &entry) {
            return Err(corrupt());
        }
        entries.push(entry);
    }
    if reader.at != bytes.len() {
        return Err(corrupt());
    }
    Ok(entries)
}
