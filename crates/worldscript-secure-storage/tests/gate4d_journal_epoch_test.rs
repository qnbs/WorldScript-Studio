//! Gate 4D Slice D2a: the key epoch that seals a migration journal is derived from the authenticated
//! manifest and stays stable for the whole operation (§10.1.1, maintainer decision B).

use worldscript_secure_storage::{
    empty_inventory_digest, empty_journal_page_set_digest, journal_envelope_epoch, operation_type,
    phase_code, seal_record, JournalError, JournalManifest, Key, ManifestRead, RecordClass,
    RecordIdentity, RecordMeta, JOURNAL_MANIFEST_RECORD_SCHEMA,
};

fn key() -> Key {
    Key::from_bytes(&mut [7u8; 32])
}

/// A manifest of an operation of `kind` from `source` to `target`, in `DISCOVER`.
fn operation(kind: u32, source: u64, target: u64) -> JournalManifest {
    JournalManifest {
        operation_id: "op-epoch".into(),
        journal_revision: 2,
        operation_type: kind,
        phase: phase_code::DISCOVER,
        source_epoch: source,
        target_epoch: target,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
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
fn the_journal_envelope_epoch_is_stable_for_the_whole_operation() {
    // ENABLE has no encrypted source: its journal is sealed under the first protected epoch, the
    // target. ROTATE and ENVELOPE_MIGRATION keep the journal under the SOURCE epoch throughout.
    let cases = [
        (operation_type::ENABLE, 0, 1, Ok(1)),
        (operation_type::ROTATE, 1, 2, Ok(1)),
        (operation_type::ROTATE, 2, 3, Ok(2)),
        (operation_type::ENVELOPE_MIGRATION, 2, 2, Ok(2)),
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
        assert_eq!(
            journal_envelope_epoch(&operation(kind, source, target)),
            expected,
            "{kind} {source}->{target}"
        );
    }
}

#[test]
fn the_phase_never_changes_the_journal_envelope_epoch() {
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
}

#[test]
fn a_first_time_enable_is_exactly_epoch_zero_to_one() {
    // §8.3 item 2: no implementation may choose a different initial epoch value.
    for (source, target) in [(0, 2), (0, 3), (1, 2), (0, 0)] {
        let manifest = operation(operation_type::ENABLE, source, target);
        assert_eq!(
            journal_envelope_epoch(&manifest),
            Err(JournalError::InvalidCounter),
            "ENABLE {source}->{target}"
        );
        assert!(manifest.encode().is_err(), "ENABLE {source}->{target}");
    }
}

#[test]
fn a_manifest_that_cannot_name_its_journal_epoch_is_not_encodable() {
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
    let read = |envelope| ManifestRead {
        record: &record,
        journal_revision: 2,
        key_epoch: 2,
        envelope,
    };
    assert_eq!(
        JournalManifest::open(&key(), &read(&sealed)),
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
        JournalManifest::open(&key(), &read(&misrouted)),
        Err(JournalError::KeyEpochMismatch)
    );
}

#[test]
fn the_target_epoch_relation_follows_the_operation() {
    // §8.3 item 2: a rotation creates a newer epoch. §10.4: an envelope or schema migration keeps the
    // key epoch; creating a newer one, with the durable target verifier that needs, is a rotation.
    let cases = [
        (operation_type::ROTATE, 2, 3, Ok(2)),
        (operation_type::ROTATE, 1, 9, Ok(1)),
        (
            operation_type::ROTATE,
            2,
            2,
            Err(JournalError::InvalidCounter),
        ),
        (
            operation_type::ROTATE,
            3,
            2,
            Err(JournalError::InvalidCounter),
        ),
        (
            operation_type::ROTATE,
            5,
            1,
            Err(JournalError::InvalidCounter),
        ),
        (operation_type::ENVELOPE_MIGRATION, 2, 2, Ok(2)),
        (
            operation_type::ENVELOPE_MIGRATION,
            2,
            3,
            Err(JournalError::InvalidCounter),
        ),
        (
            operation_type::ENVELOPE_MIGRATION,
            1,
            5,
            Err(JournalError::InvalidCounter),
        ),
        (
            operation_type::ENVELOPE_MIGRATION,
            3,
            2,
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
        // The same rule decides whether the manifest can be written at all.
        assert_eq!(
            manifest.encode().is_ok(),
            expected.is_ok(),
            "{kind} {source}->{target}"
        );
    }
}

#[test]
fn a_wire_body_that_breaks_the_relation_is_refused_on_decode() {
    // Encode two valid rotations that differ only in the target epoch to find where it is stored; the
    // offset depends only on the operation id, so it holds for every operation type. Then write a
    // target that breaks the relation into a valid body: the decoder refuses what the encoder cannot
    // produce, backwards for a rotation and any move at all for an envelope migration.
    let rotation = operation(operation_type::ROTATE, 2, 3).encode().unwrap();
    let other = operation(operation_type::ROTATE, 2, 4).encode().unwrap();
    let at = rotation
        .iter()
        .zip(&other)
        .position(|(a, b)| a != b)
        .expect("the target epoch is part of the body");
    // The target epoch is a big-endian u64 whose last byte is the one that differs.
    let start = at - 7;
    assert_eq!(&rotation[start..=at], &3u64.to_be_bytes());
    let migration = operation(operation_type::ENVELOPE_MIGRATION, 2, 2)
        .encode()
        .unwrap();
    for (valid, target) in [
        (&rotation, 1u64),
        (&rotation, 2),
        (&migration, 3),
        (&migration, 1),
    ] {
        let mut broken = valid.clone();
        broken[start..=at].copy_from_slice(&target.to_be_bytes());
        assert!(JournalManifest::decode(valid).is_ok());
        assert_eq!(
            JournalManifest::decode(&broken),
            Err(JournalError::InvalidCounter),
            "target {target}"
        );
    }
}
