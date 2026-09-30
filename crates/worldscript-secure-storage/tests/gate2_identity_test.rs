//! Gate 2 slice 1: typed logical-record identities (`docs/native/R15-SECURE-STORAGE-CONTRACT.md`
//! §5.1, §5.2, §5.2.1, §5.2.2, §5.4). Every version-1 record class is addressable only through its
//! own §5.2 template, carries exactly its §5.2.1 AAD project scope, and ciphertext sealed under one
//! identity never opens under another.

use worldscript_secure_storage::{
    canonical_aad, open, parse_envelope, seal, EnvelopeHeader, IdentityError, Key, OpenError,
    RecordClass, RecordIdentity, RecordMeta, SealTarget,
};

const SCOPE: &str = "0123456789abcdef0123456789abcdef";
const OTHER_SCOPE: &str = "fedcba9876543210fedcba9876543210";

const META: RecordMeta = RecordMeta {
    key_epoch: 1,
    record_generation: 1,
    record_schema: 1,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

/// Valid components, the expected canonical `logical_record_id`, and the expected AAD project scope
/// for every version-1 class except `record-commit`, which is built from another identity.
fn registry() -> Vec<(RecordClass, Vec<&'static str>, String, Option<&'static str>)> {
    use RecordClass as C;
    let s = SCOPE;
    vec![
        (C::Project, vec!["p1"], "project:p1".into(), Some("p1")),
        (
            C::ProjectMetadata,
            vec!["p1"],
            "project:p1:metadata".into(),
            Some("p1"),
        ),
        (C::Snapshot, vec!["42"], "snapshot:42".into(), None),
        (C::Backup, vec!["b1"], "backup:b1".into(), None),
        (
            C::Recovery,
            vec!["p1", "r1"],
            "recovery:p1:r1".into(),
            Some("p1"),
        ),
        (C::Settings, vec!["global"], "settings:global".into(), None),
        (
            C::Credential,
            vec!["openai"],
            "credential:openai".into(),
            None,
        ),
        (C::Image, vec!["i1"], "image:i1".into(), None),
        (C::Asset, vec!["p1", "a1"], "asset:p1:a1".into(), Some("p1")),
        (
            C::AssetMetadata,
            vec!["p1", "a1"],
            "asset-metadata:p1:a1".into(),
            Some("p1"),
        ),
        (
            C::AssetPair,
            vec!["p1", "a1"],
            "asset-pair:p1:a1".into(),
            Some("p1"),
        ),
        (C::Codex, vec!["p1"], "codex:p1".into(), Some("p1")),
        (
            C::RagIndex,
            vec!["p1", "v2"],
            "rag-index:p1:v2".into(),
            Some("p1"),
        ),
        (
            C::ActiveProject,
            vec![s],
            format!("active-project:{s}"),
            None,
        ),
        (
            C::AuthorityRoot,
            vec![s],
            format!("authority-root:{s}"),
            None,
        ),
        (C::KeyEpoch, vec![s, "3"], format!("key-epoch:{s}:3"), None),
        (C::Migration, vec!["op1"], "migration:op1".into(), None),
        (
            C::MigrationPage,
            vec!["op1", "0"],
            "migration-page:op1:0".into(),
            None,
        ),
        (
            C::Diagnostic,
            vec![s, "2026-09-30", "c1"],
            format!("diagnostic:{s}:2026-09-30:c1"),
            None,
        ),
        (
            C::RecordCatalog,
            vec![s, "4294967295"],
            format!("record-catalog:{s}:4294967295"),
            None,
        ),
        (
            C::LocalFirstDoc,
            vec!["p1"],
            "local-first-doc:p1".into(),
            Some("p1"),
        ),
        (C::AnalyticsDb, vec![s], format!("analytics-db:{s}"), None),
        (
            C::CrossProjectIndex,
            vec!["p1"],
            "cross-project-index:p1".into(),
            Some("p1"),
        ),
        (
            C::SceneComments,
            vec![s],
            format!("scene-comments:{s}"),
            None,
        ),
        (
            C::SceneRevision,
            vec!["rev1"],
            "scene-revision:rev1".into(),
            None,
        ),
        (C::PlotUi, vec![s], format!("plot-ui:{s}"), None),
        (C::MindMapUi, vec![s], format!("mind-map-ui:{s}"), None),
        (C::Progress, vec![s], format!("progress:{s}"), None),
        (
            C::ProforgeMemory,
            vec!["p1", "e1"],
            "proforge-memory:p1:e1".into(),
            Some("p1"),
        ),
        (
            C::ProforgeHistory,
            vec!["p1"],
            "proforge-history:p1".into(),
            Some("p1"),
        ),
        (
            C::InferenceCache,
            vec![s, "k1"],
            format!("inference-cache:{s}:k1"),
            None,
        ),
        (C::Lora, vec!["ad1"], "lora:ad1".into(), None),
        (
            C::LoraDataset,
            vec!["p1", "d1"],
            "lora-dataset:p1:d1".into(),
            Some("p1"),
        ),
        (
            C::LoraRun,
            vec!["p1", "run1"],
            "lora-run:p1:run1".into(),
            Some("p1"),
        ),
        (C::LoraMirror, vec![s], format!("lora-mirror:{s}"), None),
        (
            C::Telemetry,
            vec![s, "c1"],
            format!("telemetry:{s}:c1"),
            None,
        ),
        (C::AiBenchmark, vec![s], format!("ai-benchmark:{s}"), None),
        (
            C::WorkerDlq,
            vec![s, "t1"],
            format!("worker-dlq:{s}:t1"),
            None,
        ),
        (C::IdbKdfSalt, vec![s], format!("idb-kdf-salt:{s}"), None),
        (
            C::IdbPassphraseSentinel,
            vec![s],
            format!("idb-passphrase-sentinel:{s}"),
            None,
        ),
    ]
}

fn identity(class: RecordClass, components: &[&str]) -> RecordIdentity {
    RecordIdentity::new(class, components).unwrap()
}

fn seal_under(identity: &RecordIdentity) -> Vec<u8> {
    let target = SealTarget {
        context: identity.context(),
        meta: META,
    };
    seal(&key(), &target, b"payload").unwrap()
}

fn open_under(identity: &RecordIdentity, envelope: &[u8]) -> Result<Vec<u8>, OpenError> {
    open(
        &key(),
        &identity.context(),
        &parse_envelope(envelope).unwrap(),
    )
}

#[test]
fn every_version_one_class_has_exactly_its_registered_template_and_scope() {
    let registry = registry();
    for (class, components, logical_record_id, project_id) in &registry {
        let built = identity(*class, components);
        assert_eq!(built.class(), *class);
        assert_eq!(built.logical_record_id(), logical_record_id, "{class:?}");
        assert_eq!(built.project_id(), *project_id, "{class:?}");
        let context = built.context();
        assert_eq!(context.record_class, *class);
        assert_eq!(context.logical_record_id, logical_record_id);
        assert_eq!(context.project_id, *project_id);
    }
    // The registry covers every class except record-commit, and nothing twice.
    let mut covered: Vec<RecordClass> = registry.iter().map(|row| row.0).collect();
    covered.push(RecordClass::RecordCommit);
    covered.sort_by_key(|class| class.token());
    covered.dedup();
    assert_eq!(covered.len(), RecordClass::ALL.len());
    assert_eq!(RecordClass::ALL.len(), 41);
}

#[test]
fn every_template_refuses_a_missing_or_extra_component() {
    for (class, components, _, _) in registry() {
        let mut short = components.clone();
        short.pop();
        assert_eq!(
            RecordIdentity::new(class, &short),
            Err(IdentityError::WrongArity),
            "{class:?}"
        );
        let mut long = components.clone();
        long.push("extra");
        assert_eq!(
            RecordIdentity::new(class, &long),
            Err(IdentityError::WrongArity),
            "{class:?}"
        );
    }
}

#[test]
fn every_component_refuses_empty_separator_and_control_characters() {
    for (class, components, _, _) in registry() {
        for index in 0..components.len() {
            for (bad, error) in [
                ("", IdentityError::EmptyComponent),
                ("a:b", IdentityError::SeparatorInComponent),
                ("a\nb", IdentityError::ControlCharacter),
                ("a\u{0}", IdentityError::ControlCharacter),
            ] {
                let mut mutated = components.clone();
                mutated[index] = bad;
                assert_eq!(
                    RecordIdentity::new(class, &mutated),
                    Err(error),
                    "{class:?} component {index} = {bad:?}"
                );
            }
        }
    }
}

#[test]
fn installation_scope_components_must_be_canonical_installation_scope_ids() {
    let upper = SCOPE.to_uppercase();
    let hyphenated = "01234567-89ab-cdef-0123-456789abcdef";
    for bad in [
        upper.as_str(),
        hyphenated,
        &SCOPE[..31],
        "global",
        "g123456789abcdef0123456789abcdef",
    ] {
        for class in [
            RecordClass::AuthorityRoot,
            RecordClass::ActiveProject,
            RecordClass::Progress,
            RecordClass::IdbKdfSalt,
        ] {
            assert_eq!(
                RecordIdentity::new(class, &[bad]),
                Err(IdentityError::MalformedInstallationScope),
                "{class:?} {bad:?}"
            );
        }
        assert_eq!(
            RecordIdentity::new(RecordClass::KeyEpoch, &[bad, "1"]),
            Err(IdentityError::MalformedInstallationScope)
        );
    }
    // settings:<scope> is a profile scope, not an InstallationScopeId (§5.2.2 exclusion).
    assert!(RecordIdentity::new(RecordClass::Settings, &["global"]).is_ok());
}

#[test]
fn decimal_components_accept_only_the_canonical_uint32_spelling() {
    for good in ["0", "1", "42", "4294967295"] {
        assert!(
            RecordIdentity::new(RecordClass::Snapshot, &[good]).is_ok(),
            "{good}"
        );
        assert!(RecordIdentity::new(RecordClass::MigrationPage, &["op", good]).is_ok());
        assert!(RecordIdentity::new(RecordClass::RecordCatalog, &[SCOPE, good]).is_ok());
    }
    for bad in [
        "00",
        "01",
        "+1",
        "-1",
        "0x01",
        " 1",
        "1 ",
        "4294967296",
        "１",
        "1.0",
    ] {
        assert_eq!(
            RecordIdentity::new(RecordClass::Snapshot, &[bad]),
            Err(IdentityError::NonCanonicalDecimal),
            "{bad:?}"
        );
        assert_eq!(
            RecordIdentity::new(RecordClass::MigrationPage, &["op", bad]),
            Err(IdentityError::NonCanonicalDecimal),
            "{bad:?}"
        );
        assert_eq!(
            RecordIdentity::new(RecordClass::RecordCatalog, &[SCOPE, bad]),
            Err(IdentityError::NonCanonicalDecimal),
            "{bad:?}"
        );
    }
}

#[test]
fn key_epoch_components_must_be_canonical_and_assigned() {
    assert!(RecordIdentity::new(RecordClass::KeyEpoch, &[SCOPE, "1"]).is_ok());
    let max_assigned = (u64::MAX - 1).to_string();
    assert!(RecordIdentity::new(RecordClass::KeyEpoch, &[SCOPE, &max_assigned]).is_ok());
    let terminal = u64::MAX.to_string();
    for bad in ["0", terminal.as_str()] {
        assert_eq!(
            RecordIdentity::new(RecordClass::KeyEpoch, &[SCOPE, bad]),
            Err(IdentityError::UnassignedEpoch),
            "{bad:?}"
        );
    }
    for bad in ["01", "+1", "18446744073709551616", "x"] {
        assert_eq!(
            RecordIdentity::new(RecordClass::KeyEpoch, &[SCOPE, bad]),
            Err(IdentityError::NonCanonicalDecimal),
            "{bad:?}"
        );
    }
}

#[test]
fn commit_markers_embed_the_class_qualified_identity_and_inherit_its_scope() {
    let project = identity(RecordClass::Asset, &["p1", "a1"]);
    let marker = RecordIdentity::commit_marker(&project).unwrap();
    assert_eq!(marker.class(), RecordClass::RecordCommit);
    assert_eq!(
        marker.logical_record_id(),
        "record-commit:asset:asset:p1:a1"
    );
    assert_eq!(marker.project_id(), Some("p1"));

    let control = identity(RecordClass::KeyEpoch, &[SCOPE, "2"]);
    let marker = RecordIdentity::commit_marker(&control).unwrap();
    assert_eq!(
        marker.logical_record_id(),
        format!("record-commit:key-epoch:key-epoch:{SCOPE}:2")
    );
    assert_eq!(marker.project_id(), None);

    assert_eq!(
        RecordIdentity::commit_marker(&marker),
        Err(IdentityError::NotBuildableDirectly)
    );
    assert_eq!(
        RecordIdentity::new(RecordClass::RecordCommit, &["asset", "asset:p1:a1"]),
        Err(IdentityError::NotBuildableDirectly)
    );
}

#[test]
fn identical_identities_produce_identical_aad() {
    let header = EnvelopeHeader {
        key_epoch: 1,
        record_generation: 1,
        record_schema: 1,
        nonce: [0; 12],
        ciphertext_len: 16,
    }
    .encode();
    for (class, components, _, _) in registry() {
        let a = canonical_aad(&identity(class, &components).context(), &header).unwrap();
        let b = canonical_aad(&identity(class, &components).context(), &header).unwrap();
        assert_eq!(a, b, "{class:?}");
    }
}

#[test]
fn ciphertext_sealed_under_one_identity_never_opens_under_another() {
    // All registered identities, plus the commit marker of each, are pairwise distinct AAD contexts.
    let mut identities: Vec<RecordIdentity> = registry()
        .into_iter()
        .map(|(class, components, _, _)| identity(class, &components))
        .collect();
    let markers: Vec<RecordIdentity> = identities
        .iter()
        .map(|record| RecordIdentity::commit_marker(record).unwrap())
        .collect();
    identities.extend(markers);
    for sealed_under in &identities {
        let envelope = seal_under(sealed_under);
        for opened_under in &identities {
            let result = open_under(opened_under, &envelope);
            if sealed_under == opened_under {
                assert_eq!(result.unwrap(), b"payload");
            } else {
                assert_eq!(
                    result,
                    Err(OpenError::Tampered),
                    "{sealed_under:?} vs {opened_under:?}"
                );
            }
        }
    }
}

#[test]
fn component_project_and_scope_substitution_is_detected() {
    let cases: [(RecordIdentity, RecordIdentity); 7] = [
        // Same class, different component.
        (
            identity(RecordClass::Asset, &["p1", "a1"]),
            identity(RecordClass::Asset, &["p1", "a2"]),
        ),
        // Same asset ID moved to another project.
        (
            identity(RecordClass::Asset, &["p1", "a1"]),
            identity(RecordClass::Asset, &["p2", "a1"]),
        ),
        // Asset bytes vs. its metadata member.
        (
            identity(RecordClass::Asset, &["p1", "a1"]),
            identity(RecordClass::AssetMetadata, &["p1", "a1"]),
        ),
        // Project vs. its metadata child.
        (
            identity(RecordClass::Project, &["p1"]),
            identity(RecordClass::ProjectMetadata, &["p1"]),
        ),
        // Same installation-scoped record under another installation.
        (
            identity(RecordClass::AuthorityRoot, &[SCOPE]),
            identity(RecordClass::AuthorityRoot, &[OTHER_SCOPE]),
        ),
        // Different key epoch.
        (
            identity(RecordClass::KeyEpoch, &[SCOPE, "1"]),
            identity(RecordClass::KeyEpoch, &[SCOPE, "2"]),
        ),
        // A record vs. its own commit marker.
        (
            identity(RecordClass::Codex, &["p1"]),
            RecordIdentity::commit_marker(&identity(RecordClass::Codex, &["p1"])).unwrap(),
        ),
    ];
    for (sealed_under, opened_under) in &cases {
        let envelope = seal_under(sealed_under);
        assert_eq!(open_under(sealed_under, &envelope).unwrap(), b"payload");
        assert_eq!(
            open_under(opened_under, &envelope),
            Err(OpenError::Tampered)
        );
    }
}

#[test]
fn debug_output_never_contains_identity_values() {
    let secretish = identity(RecordClass::Credential, &["provider-name-xyz"]);
    let rendered = format!("{secretish:?}");
    assert!(!rendered.contains("provider-name-xyz"));
    let project = identity(RecordClass::Project, &["project-id-xyz"]);
    assert!(!format!("{project:?}").contains("project-id-xyz"));
}
