//! Gate 1b-core: native recovery KDF (`WSS_ARGON2ID_V1`), passphrase encoding, the portable `WSRP`
//! recovery package, and the `RootKeyRefV1` / `InstallationScopeId` identities.
//!
//! The KDF output, recovery package and key-ref digest below were produced independently with
//! Node's `crypto.argon2Sync` / AES-256-GCM / SHA-256 from the contract text (Node's Argon2id was
//! itself checked against the RFC 9106 §5.3 vector). They are cross-implementation vectors.

use worldscript_secure_storage::kdf::{
    passphrase_bytes, MAX_PASSPHRASE_INPUT_LEN, MAX_PASSPHRASE_LEN,
};
use worldscript_secure_storage::kdf::{MAX_SALT_LEN, MIN_SALT_LEN, PROFILE_ENCODED_LEN};
use worldscript_secure_storage::recovery::wrap_recovery_with_random;
use worldscript_secure_storage::{
    derive_kek, unwrap_recovery, wrap_recovery, InstallationScopeId, KdfError, KdfProfile,
    KeyProviderError, RandomSource, RandomnessUnavailable, RecoveryError, RecoveryMaterial,
    RootKeyRefV1, RootSlot, WSS_ARGON2ID_V1,
};

const PASSPHRASE: &str = "correct horse battery staple";
/// NFC of "caf\u{e9} \u{c5}"; the test also feeds decomposed/compatibility spellings of it.
const NFC_KEK_HEX: &str = "7fd762905f4080eb29c4350298f069ae2fe1d2b862faee6963bf908d7f00ac3c";
const SALT_HEX: &str = "000102030405060708090a0b0c0d0e0f";
const KEK_HEX: &str = "0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e";
const PROFILE_HEX: &str = "000000010001000000000003000000010000002013";
const SCOPE: &str = "0123456789abcdef0123456789abcdef";
const PACKAGE_HEX: &str = "575352500000000100000001000100000000000300000001000000201310000102030405060708090a0b0c0d0e0f3031323334353637383961626364656630313233343536373839616263646566a0a1a2a3a4a5a6a7a8a9aaab000000309b67c9356c148b57699f758c52f3d5677771eb84db2c3900e2ed244d3fd2a65f7c76f1be80cf2ccce5fe18958a82fec4";
const KEY_REF_DIGEST_HEX: &str = "918033a2c7257e31c2c360ad6bdd548418f113b0e358ad7c6d10041e57f1857c";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// Emits the scripted salt then nonce, like the vector generator.
struct Scripted(Vec<u8>);
impl RandomSource for Scripted {
    fn fill(&mut self, buf: &mut [u8]) -> Result<(), RandomnessUnavailable> {
        let rest = self.0.split_off(buf.len());
        buf.copy_from_slice(&self.0);
        self.0 = rest;
        Ok(())
    }
}

fn vector_random() -> Scripted {
    Scripted(unhex(&format!("{SALT_HEX}a0a1a2a3a4a5a6a7a8a9aaab")))
}

fn material() -> RecoveryMaterial {
    RecoveryMaterial::from_bytes(&mut [0x11; 32])
}

fn scope() -> InstallationScopeId {
    InstallationScopeId::parse(SCOPE).unwrap()
}

// ---- KDF -----------------------------------------------------------------------------------

#[test]
fn wss_argon2id_v1_matches_the_independent_vector() {
    let kek = derive_kek(&WSS_ARGON2ID_V1, PASSPHRASE, &unhex(SALT_HEX)).unwrap();
    assert_eq!(hex(kek.as_ref()), KEK_HEX);
}

#[test]
fn argon2_dependency_reproduces_rfc_9106_argon2id_vector() {
    use argon2::{Algorithm, Argon2, AssociatedData, ParamsBuilder, Version};
    let params = ParamsBuilder::new()
        .m_cost(32)
        .t_cost(3)
        .p_cost(4)
        .output_len(32)
        .data(AssociatedData::new(&[4; 12]).unwrap())
        .build()
        .unwrap();
    let argon2 =
        Argon2::new_with_secret(&[3; 8], Algorithm::Argon2id, Version::V0x13, params).unwrap();
    let mut out = [0u8; 32];
    argon2
        .hash_password_into(&[1; 32], &[2; 16], &mut out)
        .unwrap();
    assert_eq!(
        hex(&out),
        "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659"
    );
}

#[test]
fn passphrases_are_nfc_normalized_utf8_before_derivation() {
    // "e" + combining acute and the ANGSTROM SIGN both normalize to the NFC form Node derived from.
    for spelling in [
        "cafe\u{301} \u{212b}",
        "caf\u{e9} \u{c5}",
        "cafe\u{301} A\u{30a}",
    ] {
        let kek = derive_kek(&WSS_ARGON2ID_V1, spelling, &unhex(SALT_HEX)).unwrap();
        assert_eq!(hex(kek.as_ref()), NFC_KEK_HEX, "{spelling:?}");
    }
}

#[test]
fn profile_encoding_is_exact_and_round_trips() {
    let encoded = WSS_ARGON2ID_V1.encode();
    assert_eq!(
        (hex(&encoded), encoded.len()),
        (PROFILE_HEX.to_owned(), PROFILE_ENCODED_LEN)
    );
    assert_eq!(KdfProfile::decode(&encoded), Ok(WSS_ARGON2ID_V1));
}

#[test]
fn any_changed_profile_parameter_is_refused() {
    // Weakening or changing any parameter under the same ID is a version mismatch, never accepted.
    for index in [3usize, 6, 11, 15, 19, 20] {
        let mut changed = WSS_ARGON2ID_V1.encode();
        changed[index] ^= 0x01;
        assert_eq!(
            KdfProfile::decode(&changed),
            Err(KdfError::UnsupportedProfile),
            "byte {index}"
        );
    }
    let weaker = KdfProfile {
        memory_kib: 19 * 1024,
        ..WSS_ARGON2ID_V1
    };
    let derived = derive_kek(&weaker, PASSPHRASE, &unhex(SALT_HEX)).map(|_| ());
    assert_eq!(derived, Err(KdfError::UnsupportedProfile));
}

#[test]
fn kdf_enforces_passphrase_and_salt_bounds() {
    let long_salt = [7u8; MAX_SALT_LEN + 1];
    let min_salt = &long_salt[..MIN_SALT_LEN];
    let cases: [(&str, &[u8], Result<(), KdfError>); 5] = [
        ("", min_salt, Err(KdfError::EmptyPassphrase)),
        (
            &"a".repeat(1025),
            min_salt,
            Err(KdfError::PassphraseTooLong),
        ),
        (&"a".repeat(1024), min_salt, Ok(())),
        (
            PASSPHRASE,
            &long_salt[..MIN_SALT_LEN - 1],
            Err(KdfError::InvalidSalt),
        ),
        (PASSPHRASE, &long_salt, Err(KdfError::InvalidSalt)),
    ];
    for (passphrase, salt, expected) in cases {
        let result = derive_kek(&WSS_ARGON2ID_V1, passphrase, salt).map(|_| ());
        assert_eq!(
            result,
            expected,
            "passphrase {} bytes, salt {} bytes",
            passphrase.len(),
            salt.len()
        );
    }
}

// ---- Recovery package ----------------------------------------------------------------------

#[test]
fn recovery_package_matches_the_independent_vector_and_round_trips() {
    let package =
        wrap_recovery_with_random(PASSPHRASE, &material(), &scope(), &mut vector_random()).unwrap();
    assert_eq!(hex(&package), PACKAGE_HEX);
    let unwrapped = unwrap_recovery(PASSPHRASE, &package).unwrap();
    assert_eq!(unwrapped.material.expose_secret(), &[0x11; 32]);
    assert_eq!(unwrapped.source_installation_scope_id, scope());
}

#[test]
fn wrong_passphrase_is_refused() {
    assert_eq!(
        unwrap_recovery("correct horse battery stapler", &unhex(PACKAGE_HEX)).map(|_| ()),
        Err(RecoveryError::WrongPassphraseOrTampered)
    );
}

/// An in-place change applied to the vector package before unwrapping.
type Mutation = fn(&mut Vec<u8>);

fn unwrap_after(mutate: impl FnOnce(&mut Vec<u8>)) -> Result<(), RecoveryError> {
    let mut package = unhex(PACKAGE_HEX);
    mutate(&mut package);
    unwrap_recovery(PASSPHRASE, &package).map(|_| ())
}

#[test]
fn unknown_magic_or_version_is_an_unsupported_format() {
    assert_eq!(
        unwrap_after(|p| p[0] ^= 1),
        Err(RecoveryError::UnsupportedFormat)
    );
    assert_eq!(
        unwrap_after(|p| p[7] ^= 1),
        Err(RecoveryError::UnsupportedFormat)
    );
    assert_eq!(
        unwrap_after(|p| p.truncate(6)),
        Err(RecoveryError::UnsupportedFormat)
    );
}

#[test]
fn an_unknown_kdf_profile_id_is_reported_as_unsupported() {
    assert_eq!(
        unwrap_after(|p| p[11] = 2),
        Err(RecoveryError::Kdf(KdfError::UnsupportedProfile))
    );
}

#[test]
fn every_modified_v1_field_is_indistinguishable_from_a_wrong_passphrase() {
    // Profile parameters, salt length, salt, source scope, nonce, length, ciphertext, and tag.
    for index in [12usize, 28, 29, 35, 50, 80, 93, 100, 141] {
        assert_eq!(
            unwrap_after(|p| p[index] ^= 1),
            Err(RecoveryError::WrongPassphraseOrTampered),
            "byte {index}"
        );
    }
}

#[test]
fn truncated_extended_and_malformed_v1_packages_are_tampered() {
    let mutations: [(&str, Mutation); 5] = [
        ("truncated tag", |p| {
            p.pop();
        }),
        ("trailing byte", |p| p.push(0)),
        ("truncated header", |p| p.truncate(40)),
        ("non-canonical source scope", |p| p[46] = b'G'),
        ("salt below 16 bytes", |p| p[29] = 15),
    ];
    for (name, mutate) in mutations {
        assert_eq!(
            unwrap_after(mutate),
            Err(RecoveryError::WrongPassphraseOrTampered),
            "{name}"
        );
    }
}

#[test]
fn each_wrap_uses_a_fresh_salt_and_nonce() {
    let a = wrap_recovery(PASSPHRASE, &material(), &scope()).unwrap();
    let b = wrap_recovery(PASSPHRASE, &material(), &scope()).unwrap();
    assert_ne!(a[30..46], b[30..46], "salt reused");
    assert_ne!(a[78..90], b[78..90], "nonce reused");
    for package in [&a, &b] {
        assert_eq!(
            unwrap_recovery(PASSPHRASE, package)
                .unwrap()
                .material
                .expose_secret(),
            &[0x11; 32]
        );
    }
}

#[test]
fn secrets_never_render_in_debug_and_sources_are_zeroized() {
    let mut source = [0x42; 32];
    let material = RecoveryMaterial::from_bytes(&mut source);
    assert_eq!(source, [0; 32]);
    assert_eq!(format!("{material:?}"), "RecoveryMaterial(<redacted>)");
}

// ---- Identities ----------------------------------------------------------------------------

#[test]
fn root_key_ref_length_is_bounded() {
    for (len, accepted) in [(0usize, false), (1, true), (256, true), (257, false)] {
        assert_eq!(
            RootKeyRefV1::new(vec![1; len]).is_ok(),
            accepted,
            "length {len}"
        );
    }
}

#[test]
fn root_key_ref_digest_matches_the_contract_vector() {
    let key_ref = RootKeyRefV1::new(b"route-001".to_vec()).unwrap();
    assert_eq!(hex(&key_ref.digest()), KEY_REF_DIGEST_HEX);
}

#[test]
fn installation_scope_accepts_only_the_canonical_form() {
    assert!(InstallationScopeId::parse(SCOPE).is_ok());
    for bad in [
        "0123456789ABCDEF0123456789abcdef",
        "0123456789abcdef0123456789abcde",
        "0123456789abcdef-123456789abcdef",
        "0123456789abcdef0123456789abcdefa",
        "",
    ] {
        assert_eq!(
            InstallationScopeId::parse(bad),
            Err(KeyProviderError::MalformedInstallationScope)
        );
    }
    let scope = InstallationScopeId::from_random_bits([0xab; 16]);
    assert_eq!(scope.as_str(), "abababababababababababababababab");
}

#[test]
fn passphrase_cap_applies_to_the_normalized_bytes() {
    assert_eq!(
        passphrase_bytes("").map(|_| ()),
        Err(KdfError::EmptyPassphrase)
    );
    assert_eq!(
        passphrase_bytes(&"a".repeat(MAX_PASSPHRASE_LEN))
            .unwrap()
            .len(),
        MAX_PASSPHRASE_LEN
    );
    assert_eq!(
        passphrase_bytes(&"a".repeat(MAX_PASSPHRASE_LEN + 1)).map(|_| ()),
        Err(KdfError::PassphraseTooLong)
    );
}

#[test]
fn passphrase_cap_counts_nfc_output_not_raw_input() {
    // 342 x "e" + U+0301 is 1,026 raw bytes but 684 bytes once composed to U+00E9: accepted.
    let decomposed = "e\u{301}".repeat(342);
    assert!(decomposed.len() > MAX_PASSPHRASE_LEN);
    assert_eq!(passphrase_bytes(&decomposed).unwrap().len(), 684);
    // 342 x U+2126 OHM SIGN (3 bytes) normalizes to U+03A9 (2 bytes): 1,026 -> 684 bytes.
    assert_eq!(
        passphrase_bytes(&"\u{2126}".repeat(342)).unwrap().as_str(),
        "\u{3a9}".repeat(342)
    );
    // 513 x U+00E9 is 1,026 bytes after NFC: refused at the cap.
    assert_eq!(
        passphrase_bytes(&"\u{e9}".repeat(513)).map(|_| ()),
        Err(KdfError::PassphraseTooLong)
    );
}

#[test]
fn raw_input_over_4096_bytes_is_refused_before_normalization() {
    assert!(
        passphrase_bytes(&"a".repeat(MAX_PASSPHRASE_INPUT_LEN)).is_err(),
        "4,096 x a is > 1,024 normalized"
    );
    // One starter followed by a long combining run: refused by the raw bound, never buffered by NFC.
    let combining_run = format!("a{}", "\u{301}".repeat(4000));
    assert_eq!(
        passphrase_bytes(&combining_run).map(|_| ()),
        Err(KdfError::PassphraseTooLong)
    );
}

#[test]
fn huge_passphrases_are_refused_with_a_bounded_buffer() {
    let huge = "a".repeat(16 * 1024 * 1024);
    assert_eq!(
        passphrase_bytes(&huge).map(|_| ()),
        Err(KdfError::PassphraseTooLong)
    );
    assert_eq!(
        derive_kek(&WSS_ARGON2ID_V1, &huge, &[0; 16]).map(|_| ()),
        Err(KdfError::PassphraseTooLong)
    );
}

#[test]
fn root_slots_admit_only_codes_zero_and_one() {
    let expectations = [
        (0u8, Ok(RootSlot::A)),
        (1, Ok(RootSlot::B)),
        (2, Err(KeyProviderError::MalformedRootSlot)),
        (255, Err(KeyProviderError::MalformedRootSlot)),
    ];
    for (code, expected) in expectations {
        assert_eq!(RootSlot::from_code(code), expected, "code {code}");
    }
}

#[test]
fn root_slots_encode_and_alternate() {
    assert_eq!((RootSlot::A.code(), RootSlot::B.code()), (0, 1));
    assert_eq!(
        (RootSlot::A.other(), RootSlot::B.other()),
        (RootSlot::B, RootSlot::A)
    );
}
