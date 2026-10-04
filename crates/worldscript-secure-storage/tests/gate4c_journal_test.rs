use worldscript_secure_storage::{
    empty_inventory_digest, empty_journal_page_set_digest, inventory_digest,
    journal_page_set_digest, operation_type, phase_code, source_authority_kind,
    source_physical_authority_kind, JournalError, JournalInventoryEntry, JournalManifest,
    JournalPage, JournalPageRef, RecordClass, RecordIdentity,
};

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
    let manifest = JournalManifest {
        operation_id: "bootstrap-op".into(),
        journal_revision: 0,
        operation_type: operation_type::ENABLE,
        phase: phase_code::BOOTSTRAP_TARGET,
        source_epoch: 0,
        target_epoch: 1,
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
    };
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
        source_authority_kind::LEGACY_PLAINTEXT,
        source_physical_authority_kind::TAURI_FILESYSTEM,
        None,
        Some([0x33; 32]),
        None,
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
        source_authority_kind::LEGACY_PLAINTEXT,
        source_physical_authority_kind::TAURI_FILESYSTEM,
        None,
        Some([0x55; 32]),
        None,
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
