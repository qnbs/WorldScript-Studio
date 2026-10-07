use worldscript_secure_storage::{
    empty_inventory_digest, empty_journal_page_set_digest, inventory_digest,
    journal_envelope_epoch, journal_page_set_digest, operation_type, page_ref_for, phase_code,
    seal_record, source_authority_kind, source_physical_authority_kind, source_scheme_id,
    ForeignInventoryExtension, IdentityError, JournalError, JournalInventoryEntry,
    JournalInventorySource, JournalManifest, JournalPage, JournalPageRef, Key, RecordClass,
    RecordIdentity, RecordMeta, SealError, JOURNAL_MANIFEST_RECORD_SCHEMA,
    JOURNAL_PAGE_RECORD_SCHEMA,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

fn target_key_digest() -> [u8; 32] {
    [0x42; 32]
}

fn bootstrap_manifest(operation_id: &str) -> JournalManifest {
    JournalManifest {
        operation_id: operation_id.into(),
        journal_revision: 0,
        operation_type: operation_type::ENABLE,
        phase: phase_code::BOOTSTRAP_TARGET,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some(target_key_digest()),
        fencing_generation: 1,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 0,
        entry_count: 0,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    }
}

#[test]
fn empty_page_set_digest_matches_bootstrap_constant() {
    assert_eq!(
        journal_page_set_digest(&[]).unwrap(),
        empty_journal_page_set_digest()
    );
}

#[test]
fn journal_page_set_digest_sorts_and_refuses_duplicates() {
    let a = JournalPageRef {
        page_index: 1,
        page_generation: 2,
        page_entry_count: 0,
        page_content_digest: [0x11; 32],
    };
    let b = JournalPageRef {
        page_index: 0,
        page_generation: 3,
        page_entry_count: 1,
        page_content_digest: [0x22; 32],
    };
    let ordered = journal_page_set_digest(&[a, b]).unwrap();
    let reversed = journal_page_set_digest(&[b, a]).unwrap();
    assert_eq!(ordered, reversed);
    assert!(journal_page_set_digest(&[a, a]).is_err());
}

#[test]
fn bootstrap_manifest_roundtrip_and_page_set() {
    let manifest = bootstrap_manifest("bootstrap-op");
    manifest.verify_page_set(&[]).unwrap();
    let bytes = manifest.encode().unwrap();
    let decoded = JournalManifest::decode(&bytes).unwrap();
    assert_eq!(decoded, manifest);
}

#[test]
fn inventory_entry_and_page_roundtrip() {
    let record = RecordIdentity::new(RecordClass::Settings, &[]).unwrap();
    let entry = JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
            physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
            generation: None,
            evidence_digest: Some([0x33; 32]),
            foreign: None,
        },
    )
    .unwrap();
    let digest = inventory_digest(1, std::slice::from_ref(&entry)).unwrap();
    assert_ne!(digest, empty_inventory_digest(1));
    let page = JournalPage::new(0, 1, vec![entry]).unwrap();
    let body = page.encode().unwrap();
    let decoded = JournalPage::decode(&body).unwrap();
    assert_eq!(decoded.page_index(), 0);
    assert_eq!(decoded.entries().len(), 1);
}

#[test]
fn malformed_manifest_and_page_are_refused() {
    assert!(JournalManifest::decode(&[0, 1, 2]).is_err());
    assert!(JournalPage::decode(&[]).is_err());
    assert!(JournalManifest::decode(&[]).is_err());
}

#[test]
fn manifest_page_set_mismatch_is_refused() {
    let manifest = JournalManifest {
        operation_id: "op-page-set".into(),
        journal_revision: 1,
        operation_type: operation_type::ENABLE,
        phase: phase_code::DISCOVER,
        source_epoch: 0,
        target_epoch: 1,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some(target_key_digest()),
        fencing_generation: 1,
        inventory_version: 1,
        inventory_digest: empty_inventory_digest(1),
        page_count: 1,
        entry_count: 0,
        journal_page_set_digest: [0x44; 32],
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    };
    let page_ref = JournalPageRef {
        page_index: 0,
        page_generation: 1,
        page_entry_count: 0,
        page_content_digest: empty_journal_page_set_digest(),
    };
    let err = manifest.verify_page_set(&[page_ref]).unwrap_err();
    assert_eq!(err, JournalError::PageSetMismatch);
}

#[test]
fn manifest_inventory_digest_must_match_entries() {
    let record = RecordIdentity::new(RecordClass::Settings, &[]).unwrap();
    let entry = JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
            physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
            generation: None,
            evidence_digest: Some([0x55; 32]),
            foreign: None,
        },
    )
    .unwrap();
    let digest = inventory_digest(1, std::slice::from_ref(&entry)).unwrap();
    let manifest = JournalManifest {
        operation_id: "inv-digest".into(),
        journal_revision: 2,
        operation_type: operation_type::ROTATE,
        phase: phase_code::PREPARE,
        source_epoch: 1,
        target_epoch: 2,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some(target_key_digest()),
        fencing_generation: 2,
        inventory_version: 1,
        inventory_digest: digest,
        page_count: 0,
        entry_count: 1,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    };
    manifest
        .verify_inventory(std::slice::from_ref(&entry))
        .unwrap();
    let wrong = JournalManifest {
        inventory_digest: empty_inventory_digest(1),
        ..manifest
    };
    assert!(wrong
        .verify_inventory(std::slice::from_ref(&entry))
        .is_err());
}

#[test]
fn paged_inventory_verifier_matches_flat_digest() {
    let record = RecordIdentity::new(RecordClass::Settings, &[]).unwrap();
    let entry = JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::FOREIGN_PROTECTED,
            physical_authority_kind: source_physical_authority_kind::WEBVIEW_INDEXEDDB,
            generation: Some(1),
            evidence_digest: Some([0x66; 32]),
            foreign: Some(worldscript_secure_storage::ForeignInventoryExtension {
                source_scheme_id: source_scheme_id::WEBVIEW_IDB_AT_REST_V1,
                source_format_version: 1,
                source_identity_binding: vec![0],
                source_project_scope_binding: vec![0],
            }),
        },
    )
    .unwrap();
    let digest = inventory_digest(1, std::slice::from_ref(&entry)).unwrap();
    let page = JournalPage::new(0, 1, vec![entry]).unwrap();
    let manifest = JournalManifest {
        operation_id: "paged".into(),
        journal_revision: 3,
        operation_type: operation_type::ENVELOPE_MIGRATION,
        phase: phase_code::ADMIT,
        source_epoch: 1,
        target_epoch: 2,
        has_target_root_key_ref: false,
        target_root_key_ref_digest: None,
        fencing_generation: 3,
        inventory_version: 1,
        inventory_digest: digest,
        page_count: 1,
        entry_count: 1,
        journal_page_set_digest: empty_journal_page_set_digest(),
        final_inventory_captured: false,
        cursor_page_index: 0,
        cursor_entry_index: 0,
        has_lease_owner: false,
        lease_owner_id: None,
        lease_expires_unix_ms: None,
        recovery_reason_code: 0,
    };
    manifest
        .verify_inventory_pages(std::slice::from_ref(&page))
        .unwrap();
}

#[test]
fn manifest_and_page_seal_open_roundtrip() {
    let mut manifest = bootstrap_manifest("seal-op");
    manifest.journal_revision = 1;
    let migration = RecordIdentity::new(RecordClass::Migration, &["seal-op"]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 1,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let envelope = manifest.seal(&key(), &migration, meta).unwrap();
    let opened = JournalManifest::open(&key(), &migration, 1, &envelope).unwrap();
    assert_eq!(opened, manifest);

    let record = RecordIdentity::new(RecordClass::MigrationPage, &["seal-op", "0"]).unwrap();
    let page = JournalPage::new(0, 1, vec![]).unwrap();
    let page_meta = RecordMeta {
        key_epoch: 1,
        record_generation: 1,
        record_schema: JOURNAL_PAGE_RECORD_SCHEMA,
    };
    let page_envelope = page.seal(&key(), &record, page_meta).unwrap();
    let page_ref = page_ref_for(&page, &page_envelope).unwrap();
    assert_eq!(
        page_ref.page_content_digest,
        worldscript_secure_storage::content_digest(&page_envelope)
    );
    let opened_page = JournalPage::open(&key(), &record, 1, &page_envelope).unwrap();
    assert_eq!(opened_page.page_index(), 0);
}

#[test]
fn invalid_manifest_discriminants_and_lease_fields_are_refused() {
    let mut manifest = bootstrap_manifest("bad-op");
    manifest.operation_type = 99;
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::UnsupportedOperationType(99))
    ));
    manifest.operation_type = operation_type::ENABLE;
    manifest.phase = 99;
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::UnsupportedPhase(99))
    ));
    manifest.phase = phase_code::BOOTSTRAP_TARGET;
    manifest.has_lease_owner = false;
    manifest.lease_owner_id = Some("stale".into());
    assert!(manifest.encode().is_err());
}

#[test]
fn lease_owner_id_respects_operation_id_length_boundary() {
    let owner_at_limit = "x".repeat(128);
    let mut manifest = bootstrap_manifest("lease-op");
    manifest.has_lease_owner = true;
    manifest.lease_owner_id = Some(owner_at_limit.clone());
    manifest.lease_expires_unix_ms = Some(1);
    let bytes = manifest
        .encode()
        .expect("128-byte lease owner should encode");
    let decoded = JournalManifest::decode(&bytes).expect("128-byte lease owner should decode");
    assert_eq!(decoded, manifest);

    manifest.lease_owner_id = Some("x".repeat(129));
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::InvalidOperationId)
    ));
}

#[test]
fn foreign_inventory_rejects_none_scheme_and_bad_format_version() {
    let record = RecordIdentity::new(RecordClass::Settings, &[]).unwrap();
    let absent_binding = vec![0u8];
    assert!(JournalInventoryEntry::new(
        record.clone(),
        JournalInventorySource {
            authority_kind: source_authority_kind::FOREIGN_PROTECTED,
            physical_authority_kind: source_physical_authority_kind::WEBVIEW_INDEXEDDB,
            generation: None,
            evidence_digest: Some([0x33; 32]),
            foreign: Some(ForeignInventoryExtension {
                source_scheme_id: source_scheme_id::NONE_PLAINTEXT,
                source_format_version: 1,
                source_identity_binding: absent_binding.clone(),
                source_project_scope_binding: absent_binding.clone(),
            }),
        },
    )
    .is_err());

    assert!(JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::FOREIGN_PROTECTED,
            physical_authority_kind: source_physical_authority_kind::WEBVIEW_INDEXEDDB,
            generation: None,
            evidence_digest: Some([0x33; 32]),
            foreign: Some(ForeignInventoryExtension {
                source_scheme_id: source_scheme_id::WEBVIEW_IDB_AT_REST_V1,
                source_format_version: 0,
                source_identity_binding: absent_binding.clone(),
                source_project_scope_binding: absent_binding,
            }),
        },
    )
    .is_err());
}

#[test]
fn revision_zero_manifest_seal_open_roundtrip() {
    let manifest = bootstrap_manifest("rev0-op");
    let migration = RecordIdentity::new(RecordClass::Migration, &["rev0-op"]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 0,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let envelope = manifest.seal(&key(), &migration, meta).unwrap();
    let opened = JournalManifest::open(&key(), &migration, 0, &envelope).unwrap();
    assert_eq!(opened, manifest);
}

#[test]
fn generic_seal_record_still_refuses_generation_zero() {
    let record = RecordIdentity::new(RecordClass::Settings, &[]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 0,
        record_schema: 1,
    };
    assert_eq!(
        seal_record(&key(), &record, meta, b"payload"),
        Err(SealError::UnassignedCounter)
    );
}

#[test]
fn migration_page_seal_still_refuses_generation_zero() {
    let record = RecordIdentity::new(RecordClass::MigrationPage, &["page-op", "0"]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: 0,
        record_schema: JOURNAL_PAGE_RECORD_SCHEMA,
    };
    assert_eq!(
        seal_record(&key(), &record, meta, b"payload"),
        Err(SealError::UnassignedCounter)
    );
}

#[test]
fn journal_revision_max_is_refused() {
    let mut manifest = bootstrap_manifest("max-rev");
    manifest.journal_revision = u64::MAX;
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::InvalidCounter)
    ));
    let migration = RecordIdentity::new(RecordClass::Migration, &["max-rev"]).unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: u64::MAX,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    assert!(manifest.seal(&key(), &migration, meta).is_err());
}

#[test]
fn manifest_operation_id_rejects_control_characters_on_encode() {
    let mut manifest = bootstrap_manifest("valid-op");
    manifest.operation_id = "line\nbreak".into();
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::InvalidOperationId)
    ));
    manifest.operation_id = "nul\0byte".into();
    assert!(matches!(
        manifest.encode(),
        Err(JournalError::InvalidOperationId)
    ));
    assert!(matches!(
        RecordIdentity::new(RecordClass::Migration, &["bad\n"]),
        Err(IdentityError::ControlCharacter)
    ));
}

#[test]
fn manifest_decode_rejects_control_characters_in_operation_id() {
    let manifest = bootstrap_manifest("wire-op");
    let mut bytes = manifest.encode().unwrap();
    let op_body_offset = 4 + 4;
    bytes[op_body_offset] = b'\n';
    assert!(matches!(
        JournalManifest::decode(&bytes),
        Err(JournalError::InvalidOperationId)
    ));
    bytes[op_body_offset] = 0;
    assert!(matches!(
        JournalManifest::decode(&bytes),
        Err(JournalError::InvalidOperationId)
    ));
}

fn manifest_in(phase: u32, final_inventory_captured: bool) -> JournalManifest {
    let mut manifest = bootstrap_manifest("op-final");
    manifest.journal_revision = 2;
    manifest.phase = phase;
    manifest.final_inventory_captured = final_inventory_captured;
    manifest
}

/// The index of the one byte that carries the final-inventory flag.
fn flag_offset() -> usize {
    let off = manifest_in(phase_code::ADMIT, false).encode().unwrap();
    let on = manifest_in(phase_code::ADMIT, true).encode().unwrap();
    let diff: Vec<usize> = (0..off.len()).filter(|&i| off[i] != on[i]).collect();
    assert_eq!(diff.len(), 1, "the flag is exactly one byte");
    diff[0]
}

#[test]
fn the_final_inventory_flag_round_trips_and_is_one_strict_byte() {
    for (phase, flag) in [
        (phase_code::ADMIT, false),
        (phase_code::ADMIT, true),
        (phase_code::CONVERT, true),
        (phase_code::DONE, true),
        (phase_code::RECOVERY_REQUIRED, false),
        (phase_code::RECOVERY_REQUIRED, true),
    ] {
        let manifest = manifest_in(phase, flag);
        let bytes = manifest.encode().unwrap();
        assert_eq!(JournalManifest::decode(&bytes).unwrap(), manifest);
    }
    let mut bytes = manifest_in(phase_code::ADMIT, true).encode().unwrap();
    bytes[flag_offset()] = 2;
    assert_eq!(
        JournalManifest::decode(&bytes),
        Err(JournalError::Corrupt(
            "final inventory flag is neither 0 nor 1"
        ))
    );
    let good = manifest_in(phase_code::ADMIT, true).encode().unwrap();
    assert!(JournalManifest::decode(&good[..good.len() - 1]).is_err());
    let mut trailing = good;
    trailing.push(0);
    assert!(JournalManifest::decode(&trailing).is_err());
}

#[test]
fn the_final_inventory_flag_must_agree_with_the_phase() {
    let disagrees = Err(JournalError::Corrupt(
        "final inventory flag disagrees with the phase",
    ));
    // Before the write barrier only a preliminary inventory can exist.
    for phase in [
        phase_code::BOOTSTRAP_TARGET,
        phase_code::DISCOVER,
        phase_code::PREPARE,
    ] {
        assert_eq!(
            manifest_in(phase, true).encode(),
            disagrees,
            "phase {phase}"
        );
    }
    // From `CONVERT` on the work runs on the final inventory.
    for phase in [
        phase_code::CONVERT,
        phase_code::VERIFY,
        phase_code::COMMIT,
        phase_code::RETIRE_OLD_AUTHORITY,
        phase_code::FINALIZE,
        phase_code::DONE,
    ] {
        assert_eq!(
            manifest_in(phase, false).encode(),
            disagrees,
            "phase {phase}"
        );
    }
    // A manifest whose bytes already break the rule is refused on decode too.
    let mut bytes = manifest_in(phase_code::ADMIT, false).encode().unwrap();
    bytes[flag_offset()] = 1;
    let admitted = JournalManifest::decode(&bytes).unwrap();
    assert!(admitted.final_inventory_captured);
    let mut forged = manifest_in(phase_code::DISCOVER, false).encode().unwrap();
    forged[flag_offset()] = 1;
    assert_eq!(
        JournalManifest::decode(&forged),
        Err(JournalError::Corrupt(
            "final inventory flag disagrees with the phase"
        ))
    );
}

/// A manifest of an operation of `kind` from `source` to `target`, in any phase.
fn operation(kind: u32, source: u64, target: u64) -> JournalManifest {
    let mut manifest = bootstrap_manifest("op-epoch");
    manifest.journal_revision = 2;
    manifest.phase = phase_code::DISCOVER;
    manifest.operation_type = kind;
    manifest.source_epoch = source;
    manifest.target_epoch = target;
    manifest
}

#[test]
fn the_journal_envelope_epoch_is_stable_for_the_whole_operation() {
    // ENABLE has no encrypted source: its journal is sealed under the first protected epoch, the
    // target. ROTATE and ENVELOPE_MIGRATION keep the journal under the SOURCE epoch throughout.
    let cases = [
        (operation_type::ENABLE, 0, 1, Ok(1)),
        (operation_type::ENABLE, 0, 3, Ok(3)),
        (operation_type::ROTATE, 1, 2, Ok(1)),
        (operation_type::ROTATE, 2, 3, Ok(2)),
        (operation_type::ENVELOPE_MIGRATION, 2, 3, Ok(2)),
        (
            operation_type::ROTATE,
            0,
            2,
            Err(JournalError::InvalidCounter),
        ),
        (
            operation_type::ENVELOPE_MIGRATION,
            0,
            1,
            Err(JournalError::InvalidCounter),
        ),
    ];
    for (kind, source, target, expected) in cases {
        let manifest = operation(kind, source, target);
        assert_eq!(
            journal_envelope_epoch(&manifest),
            expected,
            "{kind} {source}->{target}"
        );
    }
    // The phase never changes it, including the recovery and terminal ones.
    for phase in [
        phase_code::BOOTSTRAP_TARGET,
        phase_code::DISCOVER,
        phase_code::PREPARE,
        phase_code::ADMIT,
        phase_code::CONVERT,
        phase_code::VERIFY,
        phase_code::COMMIT,
        phase_code::RETIRE_OLD_AUTHORITY,
        phase_code::FINALIZE,
        phase_code::DONE,
        phase_code::RECOVERY_REQUIRED,
    ] {
        let mut rotating = operation(operation_type::ROTATE, 2, 3);
        rotating.phase = phase;
        assert_eq!(journal_envelope_epoch(&rotating), Ok(2), "phase {phase}");
    }
    // A manifest that cannot name its journal epoch is not encodable.
    assert!(operation(operation_type::ROTATE, 0, 2).encode().is_err());
}

#[test]
fn a_manifest_is_sealed_and_opened_only_at_its_operations_journal_epoch() {
    let manifest = operation(operation_type::ROTATE, 2, 3);
    let record = RecordIdentity::new(RecordClass::Migration, &[&manifest.operation_id]).unwrap();
    let meta = |key_epoch| RecordMeta {
        key_epoch,
        record_generation: manifest.journal_revision,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    let sealed = manifest.seal(&key(), &record, meta(2)).unwrap();
    assert_eq!(
        JournalManifest::open(&key(), &record, 2, &sealed),
        Ok(manifest.clone())
    );
    assert_eq!(
        manifest.seal(&key(), &record, meta(1)),
        Err(JournalError::KeyEpochMismatch)
    );
    // An authentic envelope another writer sealed under the right key but the wrong epoch.
    let payload = manifest.encode().unwrap();
    let misrouted = seal_record(&key(), &record, meta(1), &payload).unwrap();
    assert_eq!(
        JournalManifest::open(&key(), &record, 2, &misrouted),
        Err(JournalError::KeyEpochMismatch)
    );
}
