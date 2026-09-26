//! Gate 1 vectors and adversarial tests for `docs/native/R15-SECURE-STORAGE-CONTRACT.md` §6.
//!
//! Expected AAD and ciphertext bytes were produced by an independent, non-Rust implementation written
//! from the contract text (Node `crypto`, AES-256-GCM), so these tests check cross-implementation
//! agreement, not just self-consistency. Key, nonce, and plaintext are test-only values.

use sha2::{Digest, Sha256};
use worldscript_secure_storage::envelope::{HEADER_LEN, MAX_CIPHERTEXT_LEN};
use worldscript_secure_storage::{
    canonical_aad, open, parse_envelope, seal, seal_with_random, AadError, EnvelopeHeader, Key,
    OpenError, RandomSource, RandomnessUnavailable, RecordClass, RecordContext, RecordMeta,
    SealError, SealTarget,
};

/// §6.1 normative header fixture: epoch 7, generation 3, schema 1, nonce 00..0b, ciphertext_len 19.
const CONTRACT_HEADER_HEX: &str = "5753523100000001000000010000000000000007000000000000000300000001000102030405060708090a0b0000000000000013";
const AAD_ABSENT_HEX: &str = "0000000f776f726c647363726970742d72313500000008736e617073686f740100000006736e61702d31005753523100000001000000010000000000000007000000000000000300000001000102030405060708090a0b0000000000000013";
const CT_ABSENT_HEX: &str = "2660b559d2a693a4d38a770c2b42d812666038";
const AAD_PRESENT_HEX: &str = "0000000f776f726c647363726970742d72313500000008736e617073686f740100000006736e61702d31010000000670726f6a2d315753523100000001000000010000000000000007000000000000000300000001000102030405060708090a0b0000000000000013";
const CT_PRESENT_HEX: &str = "2660b558fb56a06408c4720d01e21c6d188462";
const BOUNDARY_AAD_LEN: usize = 148;
const BOUNDARY_AAD_SHA256: &str =
    "b5a1d727b91f4670d5cce6d6d1cd6a9c73e15822fc86d92cdc57ad9cde601180";

const META: RecordMeta = RecordMeta {
    key_epoch: 7,
    record_generation: 3,
    record_schema: 1,
};

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn test_key() -> Key {
    let mut bytes = [0u8; 32];
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = i as u8;
    }
    Key::from_bytes(&mut bytes)
}

struct FixedNonce;
impl RandomSource for FixedNonce {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        for (i, b) in buf.iter_mut().enumerate() {
            *b = i as u8;
        }
        Ok(())
    }
}

struct NoRandomness;
impl RandomSource for NoRandomness {
    fn fill(&mut self, _buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        Err(RandomnessUnavailable)
    }
}

fn snapshot(project_id: Option<&'static str>) -> RecordContext<'static> {
    RecordContext {
        record_class: RecordClass::Snapshot,
        logical_record_id: "snap-1",
        project_id,
    }
}

fn contract_header() -> [u8; HEADER_LEN] {
    unhex(CONTRACT_HEADER_HEX).try_into().unwrap()
}

#[test]
fn header_encoding_matches_the_contract_fixture() {
    let header = EnvelopeHeader {
        key_epoch: 7,
        record_generation: 3,
        record_schema: 1,
        nonce: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        ciphertext_len: 19,
    };
    assert_eq!(hex(&header.encode()), CONTRACT_HEADER_HEX);
}

#[test]
fn canonical_aad_matches_independent_vectors_for_absent_and_present_project() {
    let header = contract_header();
    assert_eq!(
        hex(&canonical_aad(&snapshot(None), &header).unwrap()),
        AAD_ABSENT_HEX
    );
    assert_eq!(
        hex(&canonical_aad(&snapshot(Some("proj-1")), &header).unwrap()),
        AAD_PRESENT_HEX
    );
}

#[test]
fn seal_produces_the_independent_vector_envelopes() {
    for (project, ct) in [(None, CT_ABSENT_HEX), (Some("proj-1"), CT_PRESENT_HEX)] {
        let envelope = seal_with_random(
            &test_key(),
            &mut FixedNonce,
            &SealTarget {
                context: snapshot(project),
                meta: META,
            },
            b"abc",
        )
        .unwrap();
        assert_eq!(hex(&envelope[..HEADER_LEN]), CONTRACT_HEADER_HEX);
        assert_eq!(hex(&envelope[HEADER_LEN..]), ct);
    }
}

#[test]
fn open_round_trips_the_vectors() {
    for (project, ct) in [(None, CT_ABSENT_HEX), (Some("proj-1"), CT_PRESENT_HEX)] {
        let bytes = [unhex(CONTRACT_HEADER_HEX), unhex(ct)].concat();
        let parsed = parse_envelope(&bytes).unwrap();
        assert_eq!(parsed.header().key_epoch, 7);
        assert_eq!(parsed.header().record_generation, 3);
        assert_eq!(
            open(&test_key(), &snapshot(project), &parsed).unwrap(),
            b"abc"
        );
    }
}

#[test]
fn boundary_fixture_takes_rule_d_for_both_fields() {
    // Each ID within the 16,384-byte direct bound, combined direct AAD over 32 KiB: rule D, not A.
    let logical = "a".repeat(16_000);
    let project = "b".repeat(16_384);
    let context = RecordContext {
        record_class: RecordClass::Project,
        logical_record_id: &logical,
        project_id: Some(&project),
    };
    let aad = canonical_aad(&context, &contract_header()).unwrap();
    assert_eq!(aad.len(), BOUNDARY_AAD_LEN);
    assert_eq!(hex(&Sha256::digest(&aad)), BOUNDARY_AAD_SHA256);
    let bindings = 4 + 15 + 4 + "project".len();
    assert_eq!(aad[bindings], 2, "logical id uses the hashed form");
    assert_eq!(aad[bindings + 33], 2, "project id uses the hashed form");
}

#[test]
fn direct_cap_is_exactly_256_bytes_and_hashes_both_fields_above_it() {
    let header = contract_header();
    let at_cap = "x".repeat(256);
    let over_cap = "x".repeat(257);
    let direct = canonical_aad(
        &RecordContext {
            record_class: RecordClass::Project,
            logical_record_id: &at_cap,
            project_id: Some("p"),
        },
        &header,
    )
    .unwrap();
    assert_eq!(direct[4 + 15 + 4 + 7], 1, "256 bytes stays direct");
    let hashed = canonical_aad(
        &RecordContext {
            record_class: RecordClass::Project,
            logical_record_id: "short",
            project_id: Some(&over_cap),
        },
        &header,
    )
    .unwrap();
    let start = 4 + 15 + 4 + 7;
    assert_eq!(
        hashed[start], 2,
        "a short logical id is hashed too once the project id exceeds the cap"
    );
    assert_eq!(hashed[start + 33], 2);
}

#[test]
fn any_context_substitution_is_tampered() {
    let envelope = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(Some("proj-1")),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    let parsed = parse_envelope(&envelope).unwrap();
    let substitutions = [
        RecordContext {
            project_id: Some("proj-2"),
            ..snapshot(Some("proj-1"))
        },
        RecordContext {
            project_id: None,
            ..snapshot(Some("proj-1"))
        },
        RecordContext {
            logical_record_id: "snap-2",
            ..snapshot(Some("proj-1"))
        },
        RecordContext {
            record_class: RecordClass::Image,
            ..snapshot(Some("proj-1"))
        },
    ];
    for context in substitutions {
        assert_eq!(
            open(&test_key(), &context, &parsed),
            Err(OpenError::Tampered)
        );
    }
    let wrong_key = Key::from_bytes(&mut [0xAA; 32]);
    assert_eq!(
        open(&wrong_key, &snapshot(Some("proj-1")), &parsed),
        Err(OpenError::Tampered)
    );
}

#[test]
fn modifying_any_header_or_ciphertext_byte_is_tampered_or_rejected() {
    let envelope = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    // Header routing fields that parse successfully must still be authenticated via AAD.
    for index in (12..44).chain(HEADER_LEN..envelope.len()) {
        let mut modified = envelope.clone();
        modified[index] ^= 0x01;
        let parsed = parse_envelope(&modified).unwrap();
        assert_eq!(
            open(&test_key(), &snapshot(None), &parsed),
            Err(OpenError::Tampered),
            "byte {index}"
        );
    }
}

#[test]
fn parser_rejects_malformed_and_unsupported_envelopes_without_plaintext_fallback() {
    let good = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    let with = |offset: usize, bytes: &[u8]| {
        let mut out = good.clone();
        out[offset..offset + bytes.len()].copy_from_slice(bytes);
        out
    };
    let cases: Vec<(Vec<u8>, OpenError)> = vec![
        (good[..51].to_vec(), OpenError::Corrupt("truncated header")),
        (
            b"{\"projects\":[]}".to_vec(),
            OpenError::Corrupt("truncated header"),
        ),
        (
            with(0, b"WSR2"),
            OpenError::UnsupportedVersion("unknown magic"),
        ),
        (
            with(4, &2u32.to_be_bytes()),
            OpenError::UnsupportedVersion("unsupported envelope version"),
        ),
        (
            with(8, &2u32.to_be_bytes()),
            OpenError::UnsupportedVersion("unsupported suite"),
        ),
        (
            with(44, &15u64.to_be_bytes()),
            OpenError::Corrupt("ciphertext shorter than the tag"),
        ),
        (
            with(44, &(MAX_CIPHERTEXT_LEN + 1).to_be_bytes()),
            OpenError::Corrupt("ciphertext exceeds the version-1 maximum"),
        ),
        (
            with(44, &u64::MAX.to_be_bytes()),
            OpenError::Corrupt("ciphertext exceeds the version-1 maximum"),
        ),
        (
            with(44, &20u64.to_be_bytes()),
            OpenError::Corrupt("ciphertext length does not match remaining bytes"),
        ),
        (
            [good.clone(), vec![0]].concat(),
            OpenError::Corrupt("ciphertext length does not match remaining bytes"),
        ),
    ];
    for (bytes, expected) in cases {
        assert_eq!(parse_envelope(&bytes).map(|_| ()), Err(expected));
    }
}

#[test]
fn sealing_fails_closed_without_secure_randomness() {
    assert_eq!(
        seal_with_random(
            &test_key(),
            &mut NoRandomness,
            &SealTarget {
                context: snapshot(None),
                meta: META
            },
            b"abc",
        ),
        Err(SealError::RandomnessUnavailable)
    );
}

#[test]
fn os_randomness_produces_distinct_nonces() {
    let a = seal(
        &test_key(),
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    let b = seal(
        &test_key(),
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    assert_ne!(a[32..44], b[32..44], "each encryption gets a fresh nonce");
    assert_eq!(
        open(&test_key(), &snapshot(None), &parse_envelope(&a).unwrap()).unwrap(),
        b"abc"
    );
}

#[test]
fn empty_identities_are_rejected_not_bound() {
    let header = contract_header();
    let empty_id = RecordContext {
        logical_record_id: "",
        ..snapshot(None)
    };
    let empty_project = snapshot(Some(""));
    assert_eq!(
        canonical_aad(&empty_id, &header),
        Err(AadError::EmptyLogicalRecordId)
    );
    assert_eq!(
        canonical_aad(&empty_project, &header),
        Err(AadError::EmptyProjectId)
    );
    assert_eq!(
        seal_with_random(
            &test_key(),
            &mut FixedNonce,
            &SealTarget {
                context: empty_id,
                meta: META
            },
            b"abc",
        ),
        Err(SealError::InvalidContext(AadError::EmptyLogicalRecordId))
    );
}

#[test]
fn record_class_registry_round_trips_and_refuses_unknown_tokens() {
    assert_eq!(RecordClass::ALL.len(), 41);
    for class in RecordClass::ALL {
        assert_eq!(RecordClass::from_token(class.token()), Some(*class));
    }
    for unknown in ["staging", "migration-stage", "Project", "project ", ""] {
        assert_eq!(RecordClass::from_token(unknown), None, "{unknown:?}");
    }
}

#[test]
fn seal_builds_the_envelope_in_one_exactly_sized_buffer() {
    let plaintext = vec![0x5A; 4096];
    let envelope = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(Some("proj-1")),
            meta: META,
        },
        &plaintext,
    )
    .unwrap();
    // The in-place path allocates header + plaintext + tag once and never grows or copies the buffer.
    assert_eq!(envelope.len(), HEADER_LEN + plaintext.len() + 16);
    assert_eq!(envelope.capacity(), envelope.len());
    let parsed = parse_envelope(&envelope).unwrap();
    assert_eq!(
        parsed.header().ciphertext_len,
        (plaintext.len() + 16) as u64
    );
    assert_eq!(
        open(&test_key(), &snapshot(Some("proj-1")), &parsed).unwrap(),
        plaintext
    );
}

#[test]
fn seal_refuses_one_byte_past_the_64_mib_ciphertext_bound() {
    // Plaintext + 16-byte tag may be exactly MAX_CIPHERTEXT_LEN; one more byte is refused before any
    // nonce is drawn or encryption starts (the accepting side is covered by the parser bound tests).
    let over = vec![0u8; (MAX_CIPHERTEXT_LEN - 16) as usize + 1];
    assert_eq!(
        seal_with_random(
            &test_key(),
            &mut NoRandomness,
            &SealTarget {
                context: snapshot(None),
                meta: META
            },
            &over,
        ),
        Err(SealError::TooLarge)
    );
}

#[test]
fn key_construction_zeroizes_the_source_buffer() {
    let mut source = [0x42u8; 32];
    let _key = Key::from_bytes(&mut source);
    assert_eq!(source, [0u8; 32]);
}

#[test]
fn debug_output_never_contains_the_nonce() {
    let envelope = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    let parsed = parse_envelope(&envelope).unwrap();
    let nonce_bytes = format!("{:?}", parsed.header().nonce);
    for rendered in [format!("{:?}", parsed), format!("{:?}", parsed.header())] {
        assert!(rendered.contains("<redacted>"), "{rendered}");
        assert!(!rendered.contains(&nonce_bytes), "{rendered}");
        assert!(!rendered.contains("000102030405060708090a0b"), "{rendered}");
    }
}

#[test]
fn parsed_header_is_always_decoded_from_the_authenticated_bytes() {
    let envelope = seal_with_random(
        &test_key(),
        &mut FixedNonce,
        &SealTarget {
            context: snapshot(None),
            meta: META,
        },
        b"abc",
    )
    .unwrap();
    let parsed = parse_envelope(&envelope).unwrap();
    assert_eq!(parsed.header().encode(), *parsed.header_bytes());
    assert_eq!(&envelope[..HEADER_LEN], parsed.header_bytes());
    assert_eq!(&envelope[HEADER_LEN..], parsed.ciphertext());
}

#[test]
fn unassigned_or_terminal_counters_are_refused_before_sealing() {
    for (key_epoch, record_generation) in [(0, 3), (7, 0), (u64::MAX, 3), (7, u64::MAX)] {
        let meta = RecordMeta {
            key_epoch,
            record_generation,
            record_schema: 1,
        };
        assert_eq!(
            seal_with_random(
                &test_key(),
                &mut NoRandomness,
                &SealTarget {
                    context: snapshot(None),
                    meta
                },
                b"abc",
            ),
            Err(SealError::UnassignedCounter)
        );
    }
}

#[test]
fn record_context_debug_redacts_identities() {
    let context = snapshot(Some("proj-1"));
    let rendered = format!(
        "{:?}",
        SealTarget {
            context,
            meta: META
        }
    );
    assert!(!rendered.contains("snap-1"), "{rendered}");
    assert!(!rendered.contains("proj-1"), "{rendered}");
    assert!(rendered.contains("logical_record_id_len: 6"), "{rendered}");
}
