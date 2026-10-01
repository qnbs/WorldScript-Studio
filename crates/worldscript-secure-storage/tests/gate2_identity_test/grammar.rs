//! Component grammar (§3, §5.2.2, §5.4, §6.1.2): malformed components are refused, never
//! normalized.

use super::*;

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
