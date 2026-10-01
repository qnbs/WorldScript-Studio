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
const RECOVERY_ID: &str = "00112233445566778899aabbccddeeff";

const META: RecordMeta = RecordMeta {
    key_epoch: 1,
    record_generation: 1,
    record_schema: 1,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

/// `$S` in a row stands for [`SCOPE`], `$R` for [`RECOVERY_ID`].
type Row = (
    RecordClass,
    &'static [&'static str],
    &'static str,
    Option<&'static str>,
);

/// Valid components, the expected canonical `logical_record_id`, and the expected AAD project scope
/// for every version-1 class except `record-commit`, which is built from another identity.
#[rustfmt::skip]
const REGISTRY: &[Row] = &[
    (RecordClass::Project, &["p1"], "project:p1", Some("p1")),
    (RecordClass::ProjectMetadata, &["p1"], "project:p1:metadata", Some("p1")),
    (RecordClass::Snapshot, &["1727704800000"], "snapshot:1727704800000", None),
    (RecordClass::Backup, &["b1"], "backup:b1", None),
    (RecordClass::Recovery, &["p1", "$R"], "recovery:p1:$R", Some("p1")),
    (RecordClass::Settings, &[], "settings:global", None),
    (RecordClass::Credential, &["openai"], "credential:openai", None),
    (RecordClass::Image, &["i1"], "image:i1", None),
    (RecordClass::Asset, &["p1", "a1"], "asset:p1:a1", Some("p1")),
    (RecordClass::AssetMetadata, &["p1", "a1"], "asset-metadata:p1:a1", Some("p1")),
    (RecordClass::AssetPair, &["p1", "a1"], "asset-pair:p1:a1", Some("p1")),
    (RecordClass::Codex, &["p1"], "codex:p1", Some("p1")),
    (RecordClass::RagIndex, &["p1", "1"], "rag-index:p1:1", Some("p1")),
    (RecordClass::ActiveProject, &["$S"], "active-project:$S", None),
    (RecordClass::AuthorityRoot, &["$S"], "authority-root:$S", None),
    (RecordClass::KeyEpoch, &["$S", "3"], "key-epoch:$S:3", None),
    (RecordClass::Migration, &["op1"], "migration:op1", None),
    (RecordClass::MigrationPage, &["op1", "0"], "migration-page:op1:0", None),
    (RecordClass::Diagnostic, &["$S", "2026-09-30", "c1"], "diagnostic:$S:2026-09-30:c1", None),
    (RecordClass::RecordCatalog, &["$S", "4294967295"], "record-catalog:$S:4294967295", None),
    (RecordClass::LocalFirstDoc, &["p1"], "local-first-doc:p1", Some("p1")),
    (RecordClass::AnalyticsDb, &["$S"], "analytics-db:$S", None),
    (RecordClass::CrossProjectIndex, &["p1"], "cross-project-index:p1", Some("p1")),
    (RecordClass::SceneComments, &["$S"], "scene-comments:$S", None),
    (RecordClass::SceneRevision, &["rev1"], "scene-revision:rev1", None),
    (RecordClass::PlotUi, &["$S"], "plot-ui:$S", None),
    (RecordClass::MindMapUi, &["$S"], "mind-map-ui:$S", None),
    (RecordClass::Progress, &["$S"], "progress:$S", None),
    (RecordClass::ProforgeMemory, &["p1", "e1"], "proforge-memory:p1:e1", Some("p1")),
    (RecordClass::ProforgeHistory, &["p1"], "proforge-history:p1", Some("p1")),
    (RecordClass::InferenceCache, &["$S", "k1"], "inference-cache:$S:k1", None),
    (RecordClass::Lora, &["ad1"], "lora:ad1", None),
    (RecordClass::LoraDataset, &["p1", "d1"], "lora-dataset:p1:d1", Some("p1")),
    (RecordClass::LoraRun, &["p1", "run1"], "lora-run:p1:run1", Some("p1")),
    (RecordClass::LoraMirror, &["$S"], "lora-mirror:$S", None),
    (RecordClass::Telemetry, &["$S", "c1"], "telemetry:$S:c1", None),
    (RecordClass::AiBenchmark, &["$S"], "ai-benchmark:$S", None),
    (RecordClass::WorkerDlq, &["$S", "t1"], "worker-dlq:$S:t1", None),
    (RecordClass::IdbKdfSalt, &["$S"], "idb-kdf-salt:$S", None),
    (RecordClass::IdbPassphraseSentinel, &["$S"], "idb-passphrase-sentinel:$S", None),
];

/// [`REGISTRY`] with `$S` and `$R` resolved.
fn registry() -> Vec<(RecordClass, Vec<&'static str>, String, Option<&'static str>)> {
    let resolve = |part: &'static str| match part {
        "$S" => SCOPE,
        "$R" => RECOVERY_ID,
        _ => part,
    };
    REGISTRY
        .iter()
        .map(|(class, parts, id, project)| {
            let parts = parts.iter().copied().map(resolve).collect();
            let id = id.replace("$S", SCOPE).replace("$R", RECOVERY_ID);
            (*class, parts, id, *project)
        })
        .collect()
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
        if !components.is_empty() {
            let mut short = components.clone();
            short.pop();
            assert_eq!(
                RecordIdentity::new(class, &short),
                Err(IdentityError::WrongArity),
                "{class:?}"
            );
        }
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
fn every_component_refuses_empty_and_control_characters() {
    for (class, components, _, _) in registry() {
        for index in 0..components.len() {
            for (bad, error) in [
                ("", IdentityError::EmptyComponent),
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
fn a_delimiter_is_kept_exactly_or_refused_never_normalized() {
    for (class, components, logical_record_id, project_id) in registry() {
        for index in 0..components.len() {
            let mut mutated = components.clone();
            mutated[index] = "a:b";
            let Ok(built) = RecordIdentity::new(class, &mutated) else {
                continue;
            };
            // Accepted only verbatim: the joined ID is the template with that one component replaced.
            let expected = logical_record_id.replacen(components[index], "a:b", 1);
            assert_eq!(
                built.logical_record_id(),
                expected,
                "{class:?} component {index}"
            );
            let expected_project =
                project_id.map(|p| if p == components[index] { "a:b" } else { p });
            assert_eq!(
                built.project_id(),
                expected_project,
                "{class:?} component {index}"
            );
        }
    }
}

#[test]
fn existing_ids_with_the_join_delimiter_stay_protectable_and_exact() {
    // Imported project and record IDs are unrestricted strings (§15.1).
    let project = identity(RecordClass::Project, &["tenant:book"]);
    assert_eq!(project.logical_record_id(), "project:tenant:book");
    assert_eq!(project.project_id(), Some("tenant:book"));
    for (class, components, logical_record_id, project_id) in [
        (
            RecordClass::ProjectMetadata,
            vec!["tenant:book"],
            "project:tenant:book:metadata",
            Some("tenant:book"),
        ),
        (
            RecordClass::Codex,
            vec!["tenant:book"],
            "codex:tenant:book",
            Some("tenant:book"),
        ),
        (
            RecordClass::Recovery,
            vec!["tenant:book", RECOVERY_ID],
            "recovery:tenant:book:00112233445566778899aabbccddeeff",
            Some("tenant:book"),
        ),
        (
            RecordClass::Asset,
            vec!["tenant:book", "img:1"],
            "asset:tenant:book:img:1",
            Some("tenant:book"),
        ),
        (
            RecordClass::RagIndex,
            vec!["tenant:book", "1"],
            "rag-index:tenant:book:1",
            Some("tenant:book"),
        ),
        (
            RecordClass::Image,
            vec!["legacy:image"],
            "image:legacy:image",
            None,
        ),
        (RecordClass::Migration, vec!["op:1"], "migration:op:1", None),
        (
            RecordClass::MigrationPage,
            vec!["op:1", "7"],
            "migration-page:op:1:7",
            None,
        ),
        (
            RecordClass::WorkerDlq,
            vec![SCOPE, "task:9"],
            "worker-dlq:0123456789abcdef0123456789abcdef:task:9",
            None,
        ),
    ] {
        let built = identity(class, &components);
        assert_eq!(built.logical_record_id(), logical_record_id, "{class:?}");
        assert_eq!(built.project_id(), project_id, "{class:?}");
        let envelope = seal_under(&built);
        assert_eq!(
            open_under(&built, &envelope).unwrap(),
            b"payload",
            "{class:?}"
        );
    }
    let codex = identity(RecordClass::Codex, &["tenant:book"]);
    let marker = RecordIdentity::commit_marker(&codex).unwrap();
    assert_eq!(
        marker.logical_record_id(),
        "record-commit:codex:codex:tenant:book"
    );
    assert_eq!(marker.project_id(), Some("tenant:book"));
}

#[test]
fn equal_joined_strings_in_different_projects_are_distinct_identities() {
    // `asset:tenant:book:x` names two different records; the separately bound project_id keeps them
    // apart, so neither's ciphertext opens under the other (§6.2, §15.1).
    let pairs = [
        (
            identity(RecordClass::Asset, &["tenant", "book:x"]),
            identity(RecordClass::Asset, &["tenant:book", "x"]),
        ),
        (
            identity(RecordClass::ProforgeMemory, &["a", "b:c"]),
            identity(RecordClass::ProforgeMemory, &["a:b", "c"]),
        ),
        (
            RecordIdentity::commit_marker(&identity(RecordClass::LoraRun, &["a", "b:c"])).unwrap(),
            RecordIdentity::commit_marker(&identity(RecordClass::LoraRun, &["a:b", "c"])).unwrap(),
        ),
    ];
    for (left, right) in &pairs {
        assert_eq!(left.logical_record_id(), right.logical_record_id());
        assert_ne!(left, right);
        for (sealed_under, opened_under) in [(left, right), (right, left)] {
            let envelope = seal_under(sealed_under);
            assert_eq!(
                open_under(opened_under, &envelope),
                Err(OpenError::Tampered)
            );
        }
    }
}

#[test]
fn diagnostic_tokens_refuse_the_delimiter_because_two_would_be_ambiguous() {
    for components in [[SCOPE, "2026-09-30:c", "1"], [SCOPE, "2026-09-30", "c:1"]] {
        assert_eq!(
            RecordIdentity::new(RecordClass::Diagnostic, &components),
            Err(IdentityError::SeparatorInComponent)
        );
    }
}

#[test]
fn rag_index_identities_admit_only_the_current_index_version() {
    assert_eq!(
        identity(RecordClass::RagIndex, &["p1", "1"]).logical_record_id(),
        "rag-index:p1:1"
    );
    for version in ["v2", "2", "0", "01", "1.0", " 1", "v1"] {
        assert_eq!(
            RecordIdentity::new(RecordClass::RagIndex, &["p1", version]),
            Err(IdentityError::UnsupportedIndexVersion),
            "{version:?}"
        );
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
}

#[test]
fn settings_have_exactly_the_version_one_global_profile_scope() {
    // settings:<scope> is a profile scope, not an InstallationScopeId (§5.2.2 exclusion), and
    // version 1 has exactly one: a second settings authority is never addressable.
    let settings = identity(RecordClass::Settings, &[]);
    assert_eq!(settings.logical_record_id(), "settings:global");
    for other in ["global", "other", SCOPE] {
        assert_eq!(
            RecordIdentity::new(RecordClass::Settings, &[other]),
            Err(IdentityError::WrongArity)
        );
    }
}

#[test]
fn recovery_ids_must_be_core_assigned_not_path_derived() {
    let upper = RECOVERY_ID.to_uppercase();
    for bad in [
        "r1",
        "My Project-corrupt-1727704800000",
        upper.as_str(),
        &RECOVERY_ID[..31],
    ] {
        assert_eq!(
            RecordIdentity::new(RecordClass::Recovery, &["p1", bad]),
            Err(IdentityError::MalformedRecoveryId),
            "{bad:?}"
        );
    }
}

#[test]
fn migration_operation_ids_follow_the_journal_bound() {
    let max = "o".repeat(128);
    let over = "o".repeat(129);
    assert!(RecordIdentity::new(RecordClass::Migration, &[&max]).is_ok());
    assert!(RecordIdentity::new(RecordClass::MigrationPage, &[&max, "0"]).is_ok());
    assert_eq!(
        RecordIdentity::new(RecordClass::Migration, &[&over]),
        Err(IdentityError::OperationIdTooLong)
    );
    assert_eq!(
        RecordIdentity::new(RecordClass::MigrationPage, &[&over, "0"]),
        Err(IdentityError::OperationIdTooLong)
    );
}

#[test]
fn snapshot_ids_preserve_the_timestamp_sized_u64_namespace() {
    // Current desktop snapshot IDs are `Date.now()`-sized millisecond timestamps (§5.4).
    for good in [
        "0",
        "1",
        "4294967296",
        "1727704800000",
        "18446744073709551615",
    ] {
        assert!(
            RecordIdentity::new(RecordClass::Snapshot, &[good]).is_ok(),
            "{good}"
        );
    }
    for bad in [
        "00",
        "01727704800000",
        "+1",
        " 1",
        "18446744073709551616",
        "1.7e12",
    ] {
        assert_eq!(
            RecordIdentity::new(RecordClass::Snapshot, &[bad]),
            Err(IdentityError::NonCanonicalDecimal),
            "{bad:?}"
        );
    }
}

#[test]
fn decimal_components_accept_only_the_canonical_uint32_spelling() {
    for good in ["0", "1", "42", "4294967295"] {
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
    let project = identity(RecordClass::ProforgeMemory, &["p1", "e1"]);
    let marker = RecordIdentity::commit_marker(&project).unwrap();
    assert_eq!(marker.class(), RecordClass::RecordCommit);
    assert_eq!(
        marker.logical_record_id(),
        "record-commit:proforge-memory:proforge-memory:p1:e1"
    );
    assert_eq!(marker.project_id(), Some("p1"));

    let installation = identity(RecordClass::Progress, &[SCOPE]);
    let marker = RecordIdentity::commit_marker(&installation).unwrap();
    assert_eq!(
        marker.logical_record_id(),
        format!("record-commit:progress:progress:{SCOPE}")
    );
    assert_eq!(marker.project_id(), None);

    assert_eq!(
        RecordIdentity::new(RecordClass::RecordCommit, &["progress", "progress"]),
        Err(IdentityError::NotBuildableDirectly)
    );
}

#[test]
fn markers_asset_pair_members_and_control_records_have_no_ordinary_marker() {
    let refused = [
        RecordIdentity::commit_marker(&identity(RecordClass::Codex, &["p1"])).unwrap(),
        identity(RecordClass::AssetPair, &["p1", "a1"]),
        identity(RecordClass::Asset, &["p1", "a1"]),
        identity(RecordClass::AssetMetadata, &["p1", "a1"]),
        identity(RecordClass::AuthorityRoot, &[SCOPE]),
        identity(RecordClass::KeyEpoch, &[SCOPE, "2"]),
        identity(RecordClass::RecordCatalog, &[SCOPE, "0"]),
        identity(RecordClass::Migration, &["op1"]),
        identity(RecordClass::MigrationPage, &["op1", "0"]),
    ];
    for record in &refused {
        assert_eq!(
            RecordIdentity::commit_marker(record),
            Err(IdentityError::NoOrdinaryMarker),
            "{record:?}"
        );
    }
    // Every other registered class has exactly one marker.
    let ordinary = registry()
        .into_iter()
        .map(|(class, components, _, _)| identity(class, &components))
        .filter(|record| RecordIdentity::commit_marker(record).is_ok())
        .count();
    assert_eq!(ordinary, 40 - 8);
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
        .filter_map(|record| RecordIdentity::commit_marker(record).ok())
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
