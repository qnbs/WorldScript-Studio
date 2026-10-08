//! Gate 4D Slice D2b-2: manifest loaders compare the journal envelope epoch against trusted authority
//! before the journal key is used (§6 authority-first routing, §10.1.1). Every fixture seals under a
//! genuinely different key, so a comparison that ran after authentication would surface as an open
//! failure instead.

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::{
    content_digest, empty_inventory_digest, empty_journal_page_set_digest, generation_path,
    load_authoritative_manifest, load_manifest_generation, operation_type, phase_code, seal_record,
    JournalDurableContext, JournalDurableError, JournalError, JournalManifest, Key, LiveMigration,
    ManifestRead, MigrationExecutionError, OpenError, RecordClass, RecordIdentity, RecordMeta,
    StdFs, WriteOperationId, JOURNAL_MANIFEST_RECORD_SCHEMA,
};

const OPERATION: &str = "preflight-op";
const REVISION: u64 = 2;

fn journal_key() -> Key {
    Key::from_bytes(&mut [9u8; 32])
}

fn other_key() -> Key {
    Key::from_bytes(&mut [10u8; 32])
}

/// A rotation from epoch 2 to 3: its journal envelope epoch is 2.
fn rotation() -> JournalManifest {
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: REVISION,
        operation_type: operation_type::ROTATE,
        phase: phase_code::DISCOVER,
        source_epoch: 2,
        target_epoch: 3,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 4,
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

fn identity() -> RecordIdentity {
    RecordIdentity::new(RecordClass::Migration, &[OPERATION]).unwrap()
}

/// The rotation's body sealed under `key` with a header claiming `header_epoch`.
fn sealed(key: &Key, header_epoch: u64) -> Vec<u8> {
    let manifest = rotation();
    let meta = RecordMeta {
        key_epoch: header_epoch,
        record_generation: manifest.journal_revision,
        record_schema: JOURNAL_MANIFEST_RECORD_SCHEMA,
    };
    seal_record(key, &identity(), meta, &manifest.encode().unwrap()).unwrap()
}

fn open(key: &Key, expected_epoch: u64, envelope: &[u8]) -> Result<JournalManifest, JournalError> {
    let record = identity();
    JournalManifest::open(
        key,
        &ManifestRead {
            record: &record,
            journal_revision: REVISION,
            key_epoch: expected_epoch,
            envelope,
        },
    )
}

/// A directory this test created; removed when dropped. `create_dir` fails when the path exists,
/// so a leftover of an earlier process is skipped, never reused or removed.
struct Dir(PathBuf);

impl Dir {
    fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        loop {
            let path = std::env::temp_dir().join(format!(
                "wss-gate4d-preflight-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Dir(path),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
                Err(error) => panic!("cannot create {}: {error}", path.display()),
            }
        }
    }

    /// Stores `envelope` as the manifest generation `REVISION`.
    fn store(&self, envelope: &[u8]) {
        fs::write(generation_path(&self.0, REVISION), envelope).unwrap();
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn a_manifest_of_another_epoch_and_key_is_an_epoch_error_not_an_authentication_failure() {
    // Sealed under the key of epoch 1: the journal key could not authenticate it, so the epoch has
    // to be compared first.
    let foreign = sealed(&other_key(), 1);
    assert_eq!(
        open(&journal_key(), 2, &foreign),
        Err(JournalError::KeyEpochMismatch)
    );
    // The right epoch under a wrong key is the authentication failure it always was.
    let forged = sealed(&other_key(), 2);
    assert_eq!(
        open(&journal_key(), 2, &forged),
        Err(JournalError::Open(OpenError::Tampered))
    );
}

#[test]
fn a_matching_header_epoch_is_still_checked_against_the_body_after_authentication() {
    // Authentic under the journal key, header epoch 3 as the caller expects, but the body of a
    // rotation from epoch 2 derives epoch 2.
    let misrouted = sealed(&journal_key(), 3);
    assert_eq!(
        open(&journal_key(), 3, &misrouted),
        Err(JournalError::KeyEpochMismatch)
    );
    assert_eq!(
        open(&journal_key(), 2, &sealed(&journal_key(), 2)),
        Ok(rotation())
    );
}

#[test]
fn a_generation_is_loaded_only_at_the_epoch_the_caller_trusts() {
    let dir = Dir::new();
    dir.store(&sealed(&other_key(), 1));
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    assert_eq!(
        load_manifest_generation(&mut ctx, OPERATION, REVISION, 2),
        Err(JournalDurableError::Journal(JournalError::KeyEpochMismatch))
    );
}

fn binding(digest: [u8; 32]) -> LiveMigration {
    LiveMigration {
        operation_id: OPERATION.into(),
        fencing_generation: 4,
        journal_revision: REVISION,
        manifest_digest: digest,
    }
}

#[test]
fn a_root_named_file_is_judged_against_the_binding_before_the_key_is_used() {
    let dir = Dir::new();
    let foreign = sealed(&other_key(), 1);
    dir.store(&foreign);
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    // The bytes do not hash to what the root committed to: an authority mismatch, never an open
    // failure of bytes the root did not vouch for.
    assert_eq!(
        load_authoritative_manifest(&mut ctx, &binding([0x11; 32])),
        Err(JournalDurableError::Authority(
            MigrationExecutionError::LiveBindingMismatch
        ))
    );
    // Bytes the root does vouch for are opened, and the journal key still has to authenticate them.
    assert_eq!(
        load_authoritative_manifest(&mut ctx, &binding(content_digest(&foreign))),
        Err(JournalDurableError::Journal(JournalError::Open(
            OpenError::Tampered
        )))
    );
}

#[test]
fn a_root_named_file_that_the_root_vouches_for_loads() {
    let dir = Dir::new();
    let genuine = sealed(&journal_key(), 2);
    dir.store(&genuine);
    let op = WriteOperationId::generate().unwrap();
    let key = journal_key();
    let mut fs = StdFs;
    let mut ctx = JournalDurableContext::new(&mut fs, &key, &dir.0, &op);
    assert_eq!(
        load_authoritative_manifest(&mut ctx, &binding(content_digest(&genuine))),
        Ok(rotation())
    );
}
