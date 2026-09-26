//! Gate 1b-core: native recovery KDF (`WSS_ARGON2ID_V1`), passphrase encoding, the portable `WSRP`
//! recovery package, and the `RootKeyRefV1` / `InstallationScopeId` identities.
//!
//! The KDF output, recovery package and key-ref digest below were produced independently with
//! Node's `crypto.argon2Sync` / AES-256-GCM / SHA-256 from the contract text (Node's Argon2id was
//! itself checked against the RFC 9106 §5.3 vector). They are cross-implementation vectors.

use worldscript_secure_storage::kdf::{passphrase_bytes, MAX_PASSPHRASE_LEN};
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
fn profile_encoding_is_exact_and_only_the_admitted_profile_decodes() {
    let encoded = WSS_ARGON2ID_V1.encode();
    assert_eq!(hex(&encoded), PROFILE_HEX);
    assert_eq!(KdfProfile::decode(&encoded), Ok(WSS_ARGON2ID_V1));
    // Weakening or changing any parameter under the same ID is a version mismatch, never accepted.
    for index in [3usize, 6, 11, 15, 19, 20] {
        let mut changed = encoded;
        changed[index] ^= 0x01;
        assert_eq!(
            KdfProfile::decode(&changed),
            Err(KdfError::UnsupportedProfile)
        );
    }
    let weaker = KdfProfile {
        memory_kib: 19 * 1024,
        ..WSS_ARGON2ID_V1
    };
    assert_eq!(
        derive_kek(&weaker, PASSPHRASE, &unhex(SALT_HEX)).map(|_| ()),
        Err(KdfError::UnsupportedProfile)
    );
    assert_eq!(PROFILE_ENCODED_LEN, encoded.len());
}

#[test]
fn kdf_refuses_empty_passphrases_and_out_of_range_salts() {
    let salt = [7u8; MAX_SALT_LEN + 1];
    let derive = |pass: &str, salt: &[u8]| derive_kek(&WSS_ARGON2ID_V1, pass, salt).map(|_| ());
    assert_eq!(
        derive("", &salt[..MIN_SALT_LEN]),
        Err(KdfError::EmptyPassphrase)
    );
    assert_eq!(
        derive(&"a".repeat(1025), &salt[..MIN_SALT_LEN]),
        Err(KdfError::PassphraseTooLong)
    );
    assert!(derive(&"a".repeat(1024), &salt[..MIN_SALT_LEN]).is_ok());
    assert_eq!(
        derive(PASSPHRASE, &salt[..MIN_SALT_LEN - 1]),
        Err(KdfError::InvalidSalt)
    );
    assert_eq!(derive(PASSPHRASE, &salt), Err(KdfError::InvalidSalt));
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

#[test]
fn modifying_any_field_is_refused() {
    let package = unhex(PACKAGE_HEX);
    // magic, version, profile, salt length, salt, source scope, nonce, length, ciphertext, tag.
    let cases: [(usize, Result<(), RecoveryError>); 10] = [
        (0, Err(RecoveryError::UnsupportedFormat)),
        (7, Err(RecoveryError::UnsupportedFormat)),
        (12, Err(RecoveryError::Kdf(KdfError::UnsupportedProfile))),
        (
            29,
            Err(RecoveryError::Corrupt(
                "malformed source installation scope",
            )),
        ),
        (35, Err(RecoveryError::WrongPassphraseOrTampered)),
        (50, Err(RecoveryError::WrongPassphraseOrTampered)),
        (80, Err(RecoveryError::WrongPassphraseOrTampered)),
        (
            93,
            Err(RecoveryError::Corrupt("unexpected ciphertext length")),
        ),
        (100, Err(RecoveryError::WrongPassphraseOrTampered)),
        (
            package.len() - 1,
            Err(RecoveryError::WrongPassphraseOrTampered),
        ),
    ];
    for (index, expected) in cases {
        let mut changed = package.clone();
        changed[index] ^= 0x01;
        assert_eq!(
            unwrap_recovery(PASSPHRASE, &changed).map(|_| ()),
            expected,
            "byte {index}"
        );
    }
}

#[test]
fn truncated_extended_and_malformed_packages_are_corrupt() {
    let package = unhex(PACKAGE_HEX);
    assert_eq!(
        unwrap_recovery(PASSPHRASE, &package[..package.len() - 1]).map(|_| ()),
        Err(RecoveryError::Corrupt("truncated recovery package"))
    );
    let mut extended = package.clone();
    extended.push(0);
    assert_eq!(
        unwrap_recovery(PASSPHRASE, &extended).map(|_| ()),
        Err(RecoveryError::Corrupt(
            "trailing bytes after recovery package"
        ))
    );
    let mut bad_scope = package.clone();
    bad_scope[46] = b'G';
    assert_eq!(
        unwrap_recovery(PASSPHRASE, &bad_scope).map(|_| ()),
        Err(RecoveryError::Corrupt(
            "malformed source installation scope"
        ))
    );
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
fn root_key_ref_is_bounded_and_digests_per_contract() {
    assert_eq!(
        RootKeyRefV1::new(Vec::new()),
        Err(KeyProviderError::MalformedKeyRef)
    );
    assert_eq!(
        RootKeyRefV1::new(vec![1; 257]),
        Err(KeyProviderError::MalformedKeyRef)
    );
    assert!(RootKeyRefV1::new(vec![1; 256]).is_ok());
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
    assert_eq!(RootSlot::from_code(0), Ok(RootSlot::A));
    assert_eq!(RootSlot::from_code(1), Ok(RootSlot::B));
    for code in [2u8, 7, 255] {
        assert_eq!(
            RootSlot::from_code(code),
            Err(KeyProviderError::MalformedRootSlot)
        );
    }
    assert_eq!((RootSlot::A.code(), RootSlot::B.code()), (0, 1));
    assert_eq!(
        (RootSlot::A.other(), RootSlot::B.other()),
        (RootSlot::B, RootSlot::A)
    );
}
