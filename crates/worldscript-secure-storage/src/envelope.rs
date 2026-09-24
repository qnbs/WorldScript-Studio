use crate::error::OpenError;

pub const MAGIC: [u8; 4] = *b"WSR1";
pub const ENVELOPE_VERSION: u32 = 1;
/// `1 = AES-256-GCM-1` (§6.1).
pub const SUITE_AES_256_GCM_1: u32 = 1;
pub const HEADER_LEN: usize = 52;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
/// §6.1.2: 64 MiB including the tag; larger records use the chunked envelope, never a bigger bound.
pub const MAX_CIPHERTEXT_LEN: u64 = 64 * 1024 * 1024;

/// The authenticated routing fields of a version-1 envelope (§6.1). Version and suite are fixed by
/// the type rather than stored, so a header built here can never claim an unadmitted suite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnvelopeHeader {
    pub key_epoch: u64,
    pub record_generation: u64,
    pub record_schema: u32,
    pub nonce: [u8; NONCE_LEN],
    pub ciphertext_len: u64,
}

impl EnvelopeHeader {
    /// The exact 52-byte big-endian routing header, in contract field order.
    pub fn encode(&self) -> [u8; HEADER_LEN] {
        let mut out = [0u8; HEADER_LEN];
        out[0..4].copy_from_slice(&MAGIC);
        out[4..8].copy_from_slice(&ENVELOPE_VERSION.to_be_bytes());
        out[8..12].copy_from_slice(&SUITE_AES_256_GCM_1.to_be_bytes());
        out[12..20].copy_from_slice(&self.key_epoch.to_be_bytes());
        out[20..28].copy_from_slice(&self.record_generation.to_be_bytes());
        out[28..32].copy_from_slice(&self.record_schema.to_be_bytes());
        out[32..44].copy_from_slice(&self.nonce);
        out[44..52].copy_from_slice(&self.ciphertext_len.to_be_bytes());
        out
    }
}

/// A parsed envelope borrowing its ciphertext — nothing is allocated from envelope-controlled lengths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParsedEnvelope<'a> {
    pub header: EnvelopeHeader,
    pub header_bytes: [u8; HEADER_LEN],
    pub ciphertext: &'a [u8],
}

fn be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn be_u64(bytes: &[u8]) -> u64 {
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[..8]);
    u64::from_be_bytes(buf)
}

/// Strict version-1 parse (§6.1, §6.1.2, §6.4). Unknown magic, version, or suite is
/// `UnsupportedVersion`; any length violation is `Corrupt`. Neither ever falls through to plaintext.
pub fn parse_envelope(bytes: &[u8]) -> Result<ParsedEnvelope<'_>, OpenError> {
    if bytes.len() < HEADER_LEN {
        return Err(OpenError::Corrupt("truncated header"));
    }
    if bytes[0..4] != MAGIC {
        return Err(OpenError::UnsupportedVersion("unknown magic"));
    }
    if be_u32(&bytes[4..8]) != ENVELOPE_VERSION {
        return Err(OpenError::UnsupportedVersion(
            "unsupported envelope version",
        ));
    }
    if be_u32(&bytes[8..12]) != SUITE_AES_256_GCM_1 {
        return Err(OpenError::UnsupportedVersion("unsupported suite"));
    }
    let ciphertext_len = be_u64(&bytes[44..52]);
    if ciphertext_len < TAG_LEN as u64 {
        return Err(OpenError::Corrupt("ciphertext shorter than the tag"));
    }
    if ciphertext_len > MAX_CIPHERTEXT_LEN {
        return Err(OpenError::Corrupt(
            "ciphertext exceeds the version-1 maximum",
        ));
    }
    // QNBS-v3 (#445): checked arithmetic so an adversarial length can never wrap past the bound check (§6.1.2).
    let expected_total = (HEADER_LEN as u64)
        .checked_add(ciphertext_len)
        .ok_or(OpenError::Corrupt("length overflow"))?;
    if expected_total != bytes.len() as u64 {
        return Err(OpenError::Corrupt(
            "ciphertext length does not match remaining bytes",
        ));
    }
    let mut header_bytes = [0u8; HEADER_LEN];
    header_bytes.copy_from_slice(&bytes[..HEADER_LEN]);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&bytes[32..44]);
    Ok(ParsedEnvelope {
        header: EnvelopeHeader {
            key_epoch: be_u64(&bytes[12..20]),
            record_generation: be_u64(&bytes[20..28]),
            record_schema: be_u32(&bytes[28..32]),
            nonce,
            ciphertext_len,
        },
        header_bytes,
        ciphertext: &bytes[HEADER_LEN..],
    })
}
