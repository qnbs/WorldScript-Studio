use worldscript_secure_storage::{
    empty_inventory_digest, empty_journal_page_set_digest, inventory_digest,
    journal_page_set_digest, operation_type, page_ref_for, phase_code, source_authority_kind,
    source_physical_authority_kind, source_scheme_id, JournalError, JournalInventoryEntry,
    JournalInventorySource, JournalManifest, JournalPage, JournalPageRef, Key, RecordClass,
    RecordIdentity, RecordMeta, JOURNAL_MANIFEST_RECORD_SCHEMA, JOURNAL_PAGE_RECORD_SCHEMA,
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
