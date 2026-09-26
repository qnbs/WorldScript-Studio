//! Gate 1b: native recovery KDF (`WSS_ARGON2ID_V1`), portable recovery package, `RootKeyRefV1`,
//! installation scope, and the §5.3.1 secure-anchor transitions through the headless provider.
//!
//! The KDF output, recovery package and key-ref digest below were produced independently with
//! Node's `crypto.argon2Sync` / AES-256-GCM / SHA-256 from the contract text (Node's Argon2id was
//! itself checked against the RFC 9106 §5.3 vector). They are cross-implementation vectors.

use worldscript_secure_storage::anchor;
use worldscript_secure_storage::kdf::{MAX_SALT_LEN, MIN_SALT_LEN, PROFILE_ENCODED_LEN};
use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::recovery::wrap_recovery_with_random;
use worldscript_secure_storage::{
    derive_kek, seal_with_random, unwrap_recovery, wrap_recovery, AnchorState, InstallationScopeId,
    KdfError, KdfProfile, KeyProvider, KeyProviderError, KeyState, PrepareRootAnchor, RandomSource,
    RandomnessUnavailable, RecordClass, RecordContext, RecordMeta, RecoveryError, RecoveryMaterial,
    RootKeyRefV1, SealTarget, WSS_ARGON2ID_V1,
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

// ---- Provider and secure anchor ------------------------------------------------------------

fn prepare_request(provider: &MemoryKeyProvider, operation_id: &str) -> PrepareRootAnchor {
    let floor = provider.read_root_anchor_state().unwrap().committed_floor;
    PrepareRootAnchor {
        operation_id: operation_id.to_owned(),
        expected_floor: floor,
        target_root_generation: floor + 1,
        target_final_root_digest: [9; 32],
        target_slot: 1,
        target_root_key_ref: RootKeyRefV1::new(b"route-001".to_vec()).unwrap(),
    }
}

fn configured() -> MemoryKeyProvider {
    let mut provider = MemoryKeyProvider::new();
    provider.read_or_provision_installation_scope().unwrap();
    provider
}

#[test]
fn provider_starts_unconfigured_and_scope_provisioning_is_idempotent() {
    let mut provider = MemoryKeyProvider::new();
    assert_eq!(provider.state(), KeyState::Unconfigured);
    let first = provider.read_or_provision_installation_scope().unwrap();
    let again = provider.read_or_provision_installation_scope().unwrap();
    assert_eq!(first, again);
    assert!(InstallationScopeId::parse(first.as_str()).is_ok());
}

#[test]
fn provisioned_keys_are_random_resolvable_and_cleared_by_lock() {
    let mut provider = configured();
    let ref1 = provider.provision_epoch_key(1).unwrap();
    let ref2 = provider.provision_epoch_key(2).unwrap();
    assert_eq!(provider.state(), KeyState::Locked);
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
    assert_eq!(provider.unlock(), Ok(KeyState::Unlocked { epoch: 2 }));
    assert_eq!(provider.runtime_key_count(), 2);

    // Same plaintext, context and nonce under both keys: different random keys give different bytes.
    let target = SealTarget {
        context: RecordContext {
            record_class: RecordClass::Settings,
            logical_record_id: "settings:global",
            project_id: None,
        },
        meta: RecordMeta {
            key_epoch: 1,
            record_generation: 1,
            record_schema: 1,
        },
    };
    let mut nonce = Scripted(vec![0; 24]);
    let a = seal_with_random(
        &provider.resolve_ref(&ref1).unwrap(),
        &mut nonce,
        &target,
        b"x",
    )
    .unwrap();
    let b = seal_with_random(&provider.resolve(2).unwrap(), &mut nonce, &target, b"x").unwrap();
    assert_ne!(a, b);

    provider.lock();
    assert_eq!(provider.runtime_key_count(), 0);
    assert_eq!(
        provider.resolve_ref(&ref2).map(|_| ()),
        Err(KeyProviderError::Locked)
    );
    assert_eq!(provider.state(), KeyState::Locked);
}

#[test]
fn routing_resolves_exact_references_only() {
    let mut provider = configured();
    provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    let unknown = RootKeyRefV1::new(b"not-a-route".to_vec()).unwrap();
    assert_eq!(
        provider.resolve_ref(&unknown).map(|_| ()),
        Err(KeyProviderError::UnknownKeyRef)
    );
    assert_eq!(
        provider.resolve(9).map(|_| ()),
        Err(KeyProviderError::UnknownEpoch)
    );
    assert!(matches!(
        provider.provision_epoch_key(1),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert!(matches!(
        provider.provision_epoch_key(0),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert_eq!(provider.list_epochs().unwrap().len(), 1);
}

#[test]
fn lost_keys_and_missing_secure_store_fail_closed() {
    let mut provider = configured();
    provider.provision_epoch_key(1).unwrap();
    provider.unlock().unwrap();
    provider.lose_keys();
    assert_eq!(provider.state(), KeyState::KeyLost);
    assert_eq!(
        provider.resolve(1).map(|_| ()),
        Err(KeyProviderError::KeyLost)
    );
    assert_eq!(provider.unlock(), Err(KeyProviderError::KeyLost));

    let mut unavailable = MemoryKeyProvider::new();
    unavailable.set_available(false);
    assert_eq!(
        unavailable
            .read_or_provision_installation_scope()
            .map(|_| ()),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    assert_eq!(
        unavailable.read_root_anchor_state().map(|_| ()),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
    assert_eq!(
        unavailable.provision_epoch_key(1).map(|_| ()),
        Err(KeyProviderError::SecureAnchorUnavailable)
    );
}

#[test]
fn two_phase_anchor_commit_advances_the_floor_once() {
    let mut provider = configured();
    let request = prepare_request(&provider, "op-1");
    provider.prepare_root_anchor(&request).unwrap();
    let prepared = provider.read_root_anchor_state().unwrap();
    assert_eq!(
        prepared.committed_floor, 0,
        "prepare must not raise the floor"
    );
    assert!(prepared.committed_root.is_none());
    assert_eq!(
        prepared
            .prepared_root_commit
            .as_ref()
            .unwrap()
            .preparation_revision,
        1
    );

    provider.prepare_root_anchor(&request).unwrap();
    let revision = provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .unwrap()
        .preparation_revision;
    assert_eq!(
        revision, 2,
        "re-preparing the same operation bumps the revision"
    );

    provider.commit_root_anchor("op-1", 1).unwrap();
    let committed = provider.read_root_anchor_state().unwrap();
    assert_eq!(committed.committed_floor, 1);
    let root = committed.committed_root.unwrap();
    assert_eq!(
        (root.root_generation, root.root_digest, root.root_slot),
        (1, [9; 32], 1)
    );
    assert_eq!(root.root_key_ref, request.target_root_key_ref);
    assert!(committed.prepared_root_commit.is_none());

    // Replaying step F is idempotent; committing again without a preparation is not.
    provider.commit_root_anchor("op-1", 1).unwrap();
    assert!(matches!(
        provider.commit_root_anchor("op-1", 2),
        Err(KeyProviderError::AnchorConflict(_))
    ));
}

#[test]
fn anchor_rejects_mismatched_or_competing_requests() {
    let mut provider = configured();
    let mut stale = prepare_request(&provider, "op-1");
    stale.expected_floor = 5;
    assert!(matches!(
        provider.prepare_root_anchor(&stale),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    let mut skipping = prepare_request(&provider, "op-1");
    skipping.target_root_generation = 3;
    assert!(matches!(
        provider.prepare_root_anchor(&skipping),
        Err(KeyProviderError::AnchorConflict(_))
    ));

    provider
        .prepare_root_anchor(&prepare_request(&provider, "op-1"))
        .unwrap();
    assert!(matches!(
        provider.prepare_root_anchor(&prepare_request(&provider, "op-2")),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert!(matches!(
        provider.commit_root_anchor("op-2", 1),
        Err(KeyProviderError::AnchorConflict(_))
    ));
    assert!(matches!(
        provider.abort_or_recover_root_anchor("op-2"),
        Err(KeyProviderError::AnchorConflict(_))
    ));

    provider.abort_or_recover_root_anchor("op-1").unwrap();
    let state = provider.read_root_anchor_state().unwrap();
    assert!(state.prepared_root_commit.is_none());
    assert_eq!(state.committed_floor, 0, "abort never raises the floor");
    provider.abort_or_recover_root_anchor("op-1").unwrap();

    for bad in ["", &"x".repeat(129)] {
        assert_eq!(
            provider.abort_or_recover_root_anchor(bad),
            Err(KeyProviderError::MalformedOperationId)
        );
    }
}

#[test]
fn anchor_inconsistency_and_terminal_counters_require_recovery() {
    let request = PrepareRootAnchor {
        operation_id: "op".into(),
        expected_floor: 0,
        target_root_generation: 1,
        target_final_root_digest: [0; 32],
        target_slot: 0,
        target_root_key_ref: RootKeyRefV1::new(b"r".to_vec()).unwrap(),
    };
    // No installation scope yet: nothing may be prepared.
    assert_eq!(
        anchor::prepare(&AnchorState::empty(), &request),
        Err(KeyProviderError::RecoveryRequired)
    );

    let (scoped, _) = anchor::provision_installation_scope(&AnchorState::empty(), [1; 16]).unwrap();
    let mut inconsistent = scoped.clone();
    inconsistent.committed_floor = 4;
    assert_eq!(
        anchor::prepare(&inconsistent, &request),
        Err(KeyProviderError::RecoveryRequired)
    );

    let mut at_limit =
        anchor::commit(&anchor::prepare(&scoped, &request).unwrap(), "op", 1).unwrap();
    at_limit.committed_floor = u64::MAX - 1;
    at_limit.committed_root.as_mut().unwrap().root_generation = u64::MAX - 1;
    let next = PrepareRootAnchor {
        expected_floor: u64::MAX - 1,
        target_root_generation: u64::MAX,
        ..request.clone()
    };
    assert_eq!(
        anchor::prepare(&at_limit, &next),
        Err(KeyProviderError::RecoveryRequired)
    );

    // Authority without a scope is never "fixed" by generating a new scope.
    let mut orphaned = at_limit.clone();
    orphaned.installation_scope_id = None;
    assert_eq!(
        anchor::provision_installation_scope(&orphaned, [2; 16]).map(|_| ()),
        Err(KeyProviderError::RecoveryRequired)
    );
}

#[test]
fn injected_faults_leave_a_reconcilable_anchor() {
    let mut provider = configured();
    let request = prepare_request(&provider, "op-1");

    provider.inject(Fault::BeforePersist(AnchorOp::Prepare));
    assert_eq!(
        provider.prepare_root_anchor(&request),
        Err(KeyProviderError::Unavailable)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_none());

    provider.prepare_root_anchor(&request).unwrap();
    provider.inject(Fault::AfterPersist(AnchorOp::Commit));
    assert_eq!(
        provider.commit_root_anchor("op-1", 1),
        Err(KeyProviderError::Unavailable)
    );
    // The ambiguous outcome is resolved by re-reading: the commit landed, and replay is safe.
    assert_eq!(
        provider.read_root_anchor_state().unwrap().committed_floor,
        1
    );
    provider.commit_root_anchor("op-1", 1).unwrap();

    provider
        .prepare_root_anchor(&prepare_request(&provider, "op-2"))
        .unwrap();
    provider.inject(Fault::BeforePersist(AnchorOp::Abort));
    assert_eq!(
        provider.abort_or_recover_root_anchor("op-2"),
        Err(KeyProviderError::Unavailable)
    );
    assert!(provider
        .read_root_anchor_state()
        .unwrap()
        .prepared_root_commit
        .is_some());
    provider.abort_or_recover_root_anchor("op-2").unwrap();
    assert_eq!(
        provider.read_root_anchor_state().unwrap().committed_floor,
        1
    );
}
