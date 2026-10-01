//! Every version-1 class has exactly its §5.2 template, arity and §5.2.1 project scope; commit
//! markers exist only for ordinary records; `Debug` never reveals identity values.

use super::*;

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
fn debug_output_never_contains_identity_values() {
    let secretish = identity(RecordClass::Credential, &["provider-name-xyz"]);
    let rendered = format!("{secretish:?}");
    assert!(!rendered.contains("provider-name-xyz"));
    let project = identity(RecordClass::Project, &["project-id-xyz"]);
    assert!(!format!("{project:?}").contains("project-id-xyz"));
}
