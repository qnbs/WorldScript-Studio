//! Gate 2 slice A: the identity-bound record codec (`docs/native/R15-SECURE-STORAGE-CONTRACT.md`
//! §6.2, §7, §8.4, §20). A record sealed under one identity opens only under exactly that identity:
//! relocation to another record, project, installation or class, and any change to the
//! authenticated bytes, fail closed while the valid record and its exact IDs stay intact.

use worldscript_secure_storage::{
    disposition, is_r15_record_class, open, open_record, parse_envelope, seal, seal_record,
    Disposition, IdentityError, Key, OpenError, RecordClass, RecordIdentity, RecordMeta, SealError,
    SealTarget, ADMITTED_RECORD_SCHEMAS,
};

/// Header length, and the offset of the ciphertext that follows it (§6.1).
const HEADER_LEN: usize = 52;
/// AES-GCM tag length at the end of the ciphertext.
const TAG_LEN: usize = 16;

const SCOPE: &str = "0123456789abcdef0123456789abcdef";
const OTHER_SCOPE: &str = "fedcba9876543210fedcba9876543210";

const META: RecordMeta = RecordMeta {
    key_epoch: 3,
    record_generation: 7,
    record_schema: 1,
};

fn key() -> Key {
    Key::from_bytes(&mut [9u8; 32])
}

fn identity(class: RecordClass, components: &[&str]) -> RecordIdentity {
    RecordIdentity::new(class, components).unwrap()
}

fn sealed(identity: &RecordIdentity) -> Vec<u8> {
    seal_record(&key(), identity, META, b"chapter one").unwrap()
}

#[test]
fn a_record_opens_under_its_own_identity_with_its_sealed_header() {
    let record = identity(RecordClass::Asset, &["tenant:book", "img:1"]);
    let opened = open_record(&key(), &record, &sealed(&record)).unwrap();
    assert_eq!(opened.payload, b"chapter one");
    assert_eq!(opened.header.key_epoch, META.key_epoch);
    assert_eq!(opened.header.record_generation, META.record_generation);
    assert_eq!(opened.header.record_schema, META.record_schema);
}

#[test]
fn relocated_envelopes_fail_closed() {
    // Each pair: sealed under the first identity, presented as the second.
    let relocations = [
        // Another record of the same class and project.
        (
            identity(RecordClass::Asset, &["p1", "a1"]),
            identity(RecordClass::Asset, &["p1", "a2"]),
        ),
        // The same record ID under another project.
        (
            identity(RecordClass::Codex, &["p1"]),
            identity(RecordClass::Codex, &["p2"]),
        ),
        // A global record presented as an installation-scoped one.
        (
            identity(RecordClass::Settings, &[]),
            identity(RecordClass::ActiveProject, &[SCOPE]),
        ),
        // The same installation-scoped record under another installation.
        (
            identity(RecordClass::AuthorityRoot, &[SCOPE]),
            identity(RecordClass::AuthorityRoot, &[OTHER_SCOPE]),
        ),
        // The same components under another class.
        (
            identity(RecordClass::Snapshot, &["1727704800000"]),
            identity(RecordClass::Backup, &["1727704800000"]),
        ),
        // Equal joined strings in different projects (§15.1).
        (
            identity(RecordClass::Asset, &["tenant", "book:x"]),
            identity(RecordClass::Asset, &["tenant:book", "x"]),
        ),
        // A record and its own commit marker.
        (
            identity(RecordClass::Codex, &["p1"]),
            RecordIdentity::commit_marker(&identity(RecordClass::Codex, &["p1"])).unwrap(),
        ),
    ];
    for (sealed_under, presented_as) in &relocations {
        let envelope = sealed(sealed_under);
        assert!(open_record(&key(), sealed_under, &envelope).is_ok());
        assert_eq!(
            open_record(&key(), presented_as, &envelope),
            Err(OpenError::Tampered),
            "{sealed_under:?} presented as {presented_as:?}"
        );
    }
}

#[test]
fn any_changed_authenticated_byte_fails_closed() {
    let record = identity(RecordClass::Project, &["p1"]);
    let envelope = sealed(&record);
    let ciphertext_byte = HEADER_LEN + (envelope.len() - HEADER_LEN - TAG_LEN) / 2;
    // Authenticated header fields (key epoch, generation, nonce), a ciphertext byte and the tag.
    for index in [12, 20, 40, ciphertext_byte, envelope.len() - 1] {
        let mut changed = envelope.clone();
        changed[index] ^= 0x01;
        assert_eq!(
            open_record(&key(), &record, &changed),
            Err(OpenError::Tampered),
            "byte {index}"
        );
    }
    // The record schema (offset 28) is checked against the compatibility registry before
    // authentication, so changing it is refused as unsupported, never released (§7).
    let mut changed = envelope.clone();
    changed[28] ^= 0x01;
    assert_eq!(
        open_record(&key(), &record, &changed),
        Err(OpenError::UnsupportedVersion("record schema"))
    );
}

#[test]
fn malformed_bytes_are_refused_before_authentication() {
    let record = identity(RecordClass::Project, &["p1"]);
    let envelope = sealed(&record);
    assert!(matches!(
        open_record(&key(), &record, &envelope[..20]),
        Err(OpenError::Corrupt(_))
    ));
    let mut future = envelope.clone();
    future[..4].copy_from_slice(b"WSR9");
    assert!(matches!(
        open_record(&key(), &record, &future),
        Err(OpenError::UnsupportedVersion(_))
    ));
    assert!(matches!(
        open_record(&key(), &record, b"{\"legacy\":\"plaintext\"}"),
        Err(OpenError::Corrupt(_) | OpenError::UnsupportedVersion(_))
    ));
}

#[test]
fn record_schemas_outside_the_compatibility_registry_are_refused() {
    assert_eq!(ADMITTED_RECORD_SCHEMAS, &[1]);
    let record = identity(RecordClass::Project, &["p1"]);
    let future = RecordMeta {
        record_schema: 2,
        ..META
    };
    assert_eq!(
        seal_record(&key(), &record, future, b"x"),
        Err(SealError::UnsupportedSchema)
    );
    // An authentic envelope with a future schema is refused before its payload is released (§7).
    let target = SealTarget {
        context: record.context(),
        meta: future,
    };
    let envelope = seal(&key(), &target, b"x").unwrap();
    assert_eq!(
        open_record(&key(), &record, &envelope),
        Err(OpenError::UnsupportedVersion("record schema"))
    );
}

#[test]
fn a_wrong_key_never_opens_the_record() {
    let record = identity(RecordClass::Image, &["i1"]);
    let other_key = Key::from_bytes(&mut [8u8; 32]);
    assert_eq!(
        open_record(&other_key, &record, &sealed(&record)),
        Err(OpenError::Tampered)
    );
}

#[test]
fn asset_pair_members_are_derived_structurally_with_exact_ids() {
    let marker = identity(RecordClass::AssetPair, &["tenant:book", "scan:7"]);
    let (bytes, metadata) = marker.asset_pair_members().unwrap();
    assert_eq!(
        bytes,
        identity(RecordClass::Asset, &["tenant:book", "scan:7"])
    );
    assert_eq!(
        metadata,
        identity(RecordClass::AssetMetadata, &["tenant:book", "scan:7"])
    );
    assert_eq!(bytes.project_id(), Some("tenant:book"));
    assert_eq!(bytes.asset_pair_marker().as_ref(), Some(&marker));
    assert_eq!(metadata.asset_pair_marker().as_ref(), Some(&marker));
    // Members of one pair never open as each other or as the marker (§8.4).
    let envelope = sealed(&bytes);
    for other in [&metadata, &marker] {
        assert_eq!(
            open_record(&key(), other, &envelope),
            Err(OpenError::Tampered)
        );
    }
}

#[test]
fn only_asset_pairs_and_their_members_have_pair_relations() {
    let project = identity(RecordClass::Project, &["p1"]);
    assert!(project.asset_pair_members().is_none());
    assert!(project.asset_pair_marker().is_none());
    let marker = identity(RecordClass::AssetPair, &["p1", "a1"]);
    assert!(marker.asset_pair_marker().is_none());
    let member = identity(RecordClass::Asset, &["p1", "a1"]);
    assert!(member.asset_pair_members().is_none());
    let commit = RecordIdentity::commit_marker(&project).unwrap();
    assert!(commit.asset_pair_members().is_none());
    assert!(commit.asset_pair_marker().is_none());
}

#[test]
fn opened_record_debug_never_contains_the_payload() {
    let record = identity(RecordClass::Settings, &[]);
    let opened = open_record(&key(), &record, &sealed(&record)).unwrap();
    assert!(!format!("{opened:?}").contains("chapter"));
}

#[test]
fn separately_protected_classes_never_become_r15_envelopes() {
    // §10.4.1: credentials and the B-1 IDB salt/sentinel keep their own approved authority, so no
    // R-15 ciphertext is ever created for them, and nothing presented as one is parsed or decrypted.
    let retained = [
        identity(RecordClass::Credential, &["openai"]),
        identity(RecordClass::IdbKdfSalt, &[SCOPE]),
        identity(RecordClass::IdbPassphraseSentinel, &[SCOPE]),
    ];
    let forged = sealed(&identity(RecordClass::Settings, &[]));
    for record in &retained {
        assert_eq!(
            disposition(record.class()),
            Some(Disposition::RetainSeparateAuthority)
        );
        assert_eq!(
            seal_record(&key(), record, META, b"secret"),
            Err(SealError::NotAnR15RecordClass),
            "{record:?}"
        );
        // Refused before parsing: truncated bytes give the class refusal, not `Corrupt`.
        for bytes in [&forged[..], &forged[..20]] {
            assert_eq!(
                open_record(&key(), record, bytes),
                Err(OpenError::NotAnR15RecordClass),
                "{record:?}"
            );
        }
        // The raw primitives enforce the same rule, so no entry point bypasses it.
        let target = SealTarget {
            context: record.context(),
            meta: META,
        };
        assert_eq!(
            seal(&key(), &target, b"secret"),
            Err(SealError::NotAnR15RecordClass)
        );
        assert_eq!(
            open(&key(), &record.context(), &parse_envelope(&forged).unwrap()),
            Err(OpenError::NotAnR15RecordClass)
        );
        // No R-15 record exists to commit, so no ordinary marker is derived either.
        assert_eq!(
            RecordIdentity::commit_marker(record),
            Err(IdentityError::NoOrdinaryMarker)
        );
    }
}

#[test]
fn every_other_class_is_an_r15_record_class() {
    let retained = [
        RecordClass::Credential,
        RecordClass::IdbKdfSalt,
        RecordClass::IdbPassphraseSentinel,
    ];
    for class in RecordClass::ALL {
        assert_eq!(
            is_r15_record_class(*class),
            !retained.contains(class),
            "{class:?}"
        );
    }
    // Native control-plane records are R-15 envelopes too (§5.3, §5.4).
    let codex = identity(RecordClass::Codex, &["p1"]);
    for record in [
        identity(RecordClass::AuthorityRoot, &[SCOPE]),
        identity(RecordClass::AssetPair, &["p1", "a1"]),
        RecordIdentity::commit_marker(&codex).unwrap(),
    ] {
        assert_eq!(
            disposition(record.class()),
            Some(Disposition::NativeControlPlane)
        );
        assert!(open_record(&key(), &record, &sealed(&record)).is_ok());
    }
}
