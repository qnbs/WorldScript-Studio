//! Existing IDs keep their exact spelling, and the AAD-bound identity triple (§6.2, §15.1) stays
//! unambiguous: ciphertext sealed under one identity never opens under another.

use super::*;

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

/// Existing IDs that contain the join delimiter (§15.1), with the exact identity each must keep.
#[rustfmt::skip]
const DELIMITER_IDS: &[Row] = &[
    (RecordClass::Project, &["tenant:book"], "project:tenant:book", Some("tenant:book")),
    (RecordClass::ProjectMetadata, &["tenant:book"], "project:tenant:book:metadata", Some("tenant:book")),
    (RecordClass::Codex, &["tenant:book"], "codex:tenant:book", Some("tenant:book")),
    (RecordClass::Recovery, &["tenant:book", "$R"], "recovery:tenant:book:$R", Some("tenant:book")),
    (RecordClass::Asset, &["tenant:book", "img:1"], "asset:tenant:book:img:1", Some("tenant:book")),
    (RecordClass::RagIndex, &["tenant:book", "1"], "rag-index:tenant:book:1", Some("tenant:book")),
    (RecordClass::Image, &["legacy:image"], "image:legacy:image", None),
    (RecordClass::Migration, &["op:1"], "migration:op:1", None),
    (RecordClass::MigrationPage, &["op:1", "7"], "migration-page:op:1:7", None),
    (RecordClass::WorkerDlq, &["$S", "task:9"], "worker-dlq:$S:task:9", None),
];

#[test]
fn existing_ids_with_the_join_delimiter_stay_protectable_and_exact() {
    for (class, components, logical_record_id, project_id) in resolve_rows(DELIMITER_IDS) {
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
}

#[test]
fn a_delimiter_bearing_project_keeps_its_scope_in_commit_markers() {
    let marker =
        RecordIdentity::commit_marker(&identity(RecordClass::Codex, &["tenant:book"])).unwrap();
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
    // All registered R-15 identities, plus the commit marker of each, are pairwise distinct AAD
    // contexts. Retained-authority classes have no R-15 ciphertext at all (§10.4.1).
    let mut identities: Vec<RecordIdentity> = registry()
        .into_iter()
        .filter(|(class, _, _, _)| is_r15_record_class(*class))
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
