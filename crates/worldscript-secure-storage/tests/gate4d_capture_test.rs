//! Gate 4D Slice C1a: capturing a paged inventory into the journal manifest (§10.1.1, §10.3).

use worldscript_secure_storage::{
    assert_manifest_successor, capture_inventory, empty_inventory_digest,
    empty_journal_page_set_digest, inventory_digest, journal_page_set_digest, operation_type,
    page_ref_for, phase_code, source_authority_kind, source_physical_authority_kind, JournalError,
    JournalInventoryEntry, JournalInventorySource, JournalManifest, JournalPage,
    MigrationExecutionError, MigrationFence, RecordClass, RecordIdentity, RecordMeta, SealedPage,
    JOURNAL_PAGE_RECORD_SCHEMA,
};

const OPERATION: &str = "capture-op";

fn key() -> worldscript_secure_storage::Key {
    worldscript_secure_storage::Key::from_bytes(&mut [9u8; 32])
}

fn manifest_at(phase: u32, revision: u64) -> JournalManifest {
    JournalManifest {
        operation_id: OPERATION.into(),
        journal_revision: revision,
        operation_type: operation_type::ROTATE,
        phase,
        source_epoch: 1,
        target_epoch: 2,
        has_target_root_key_ref: true,
        target_root_key_ref_digest: Some([0x42; 32]),
        fencing_generation: 7,
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

fn fence(manifest: &JournalManifest) -> MigrationFence {
    MigrationFence::from_manifest(manifest)
}

/// `(revision, phase, page_count, entry_count)`: the counters a capture sets or keeps.
fn shape(manifest: &JournalManifest) -> (u64, u32, u32, u32) {
    (
        manifest.journal_revision,
        manifest.phase,
        manifest.page_count,
        manifest.entry_count,
    )
}

/// `(inventory_digest, journal_page_set_digest)`.
fn digests(manifest: &JournalManifest) -> ([u8; 32], [u8; 32]) {
    (manifest.inventory_digest, manifest.journal_page_set_digest)
}

fn entry(n: u32) -> JournalInventoryEntry {
    let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:03}")]).unwrap();
    JournalInventoryEntry::new(
        record,
        JournalInventorySource {
            authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
            physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
            generation: None,
            evidence_digest: Some([n as u8; 32]),
            foreign: None,
        },
    )
    .unwrap()
}

/// `count` entries in the order the inventory sorts them, so they can be cut into ascending pages.
fn sorted_entries(count: u32) -> Vec<JournalInventoryEntry> {
    let all: Vec<JournalInventoryEntry> = (0..count).map(entry).collect();
    JournalPage::new(0, 1, all).unwrap().entries().to_vec()
}

/// Pages of at most `per_page` entries, indexed from 0, every page at `generation`.
fn pages_of(
    entries: &[JournalInventoryEntry],
    per_page: usize,
    generation: u64,
) -> Vec<JournalPage> {
    entries
        .chunks(per_page.max(1))
        .enumerate()
        .map(|(index, chunk)| JournalPage::new(index as u32, generation, chunk.to_vec()).unwrap())
        .collect()
}

fn envelope_of(page: &JournalPage) -> Vec<u8> {
    let identity = RecordIdentity::new(
        RecordClass::MigrationPage,
        &[OPERATION, &page.page_index().to_string()],
    )
    .unwrap();
    let meta = RecordMeta {
        key_epoch: 1,
        record_generation: page.page_generation(),
        record_schema: JOURNAL_PAGE_RECORD_SCHEMA,
    };
    page.seal(&key(), &identity, meta).unwrap()
}

fn capture(
    manifest: &JournalManifest,
    pages: &[JournalPage],
) -> Result<JournalManifest, MigrationExecutionError> {
    let envelopes: Vec<Vec<u8>> = pages.iter().map(envelope_of).collect();
    capture_sealed(manifest, pages, &envelopes)
}

/// A capture over envelopes sealed once by the caller (sealing uses a fresh nonce every time).
fn capture_sealed(
    manifest: &JournalManifest,
    pages: &[JournalPage],
    envelopes: &[Vec<u8>],
) -> Result<JournalManifest, MigrationExecutionError> {
    let sealed: Vec<SealedPage<'_>> = pages
        .iter()
        .zip(envelopes)
        .map(|(page, envelope)| SealedPage { page, envelope })
        .collect();
    capture_inventory(manifest, &fence(manifest), &sealed)
}

#[test]
fn an_empty_inventory_captures_the_canonical_empty_digests() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let next = capture(&prev, &[]).unwrap();
    assert_eq!(shape(&next), (4, phase_code::DISCOVER, 0, 0));
    assert_eq!(
        digests(&next),
        (empty_inventory_digest(1), empty_journal_page_set_digest())
    );
    assert_eq!(assert_manifest_successor(&prev, &next), Ok(()));
}

#[test]
fn captured_pages_carry_the_flat_digests() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let entries = sorted_entries(5);
    let pages = pages_of(&entries, 2, 4);
    let envelopes: Vec<Vec<u8>> = pages.iter().map(envelope_of).collect();
    let next = capture_sealed(&prev, &pages, &envelopes).unwrap();
    let refs: Vec<_> = pages
        .iter()
        .zip(&envelopes)
        .map(|(page, envelope)| page_ref_for(page, envelope).unwrap())
        .collect();
    assert_eq!(shape(&next), (4, phase_code::DISCOVER, 3, 5));
    assert_eq!(
        digests(&next),
        (
            inventory_digest(1, &entries).unwrap(),
            journal_page_set_digest(&refs).unwrap()
        )
    );
}

#[test]
fn a_captured_manifest_verifies_against_its_pages_and_is_a_valid_successor() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let pages = pages_of(&sorted_entries(5), 2, 4);
    let envelopes: Vec<Vec<u8>> = pages.iter().map(envelope_of).collect();
    let next = capture_sealed(&prev, &pages, &envelopes).unwrap();
    let refs: Vec<_> = pages
        .iter()
        .zip(&envelopes)
        .map(|(page, envelope)| page_ref_for(page, envelope).unwrap())
        .collect();
    next.verify_page_set(&refs).unwrap();
    next.verify_inventory_pages(&pages).unwrap();
    assert_eq!(assert_manifest_successor(&prev, &next), Ok(()));
}

#[test]
fn an_unchanged_page_keeps_the_older_generation_that_names_it() {
    let first = manifest_at(phase_code::DISCOVER, 1);
    let entries = sorted_entries(4);
    let early = pages_of(&entries, 2, 2);
    let discovered = capture(&first, &early).unwrap();
    // Admission recaptures: page 0 is unchanged (generation 2), page 1 is rewritten for revision 3.
    let admit = {
        let mut manifest = discovered.clone();
        manifest.phase = phase_code::ADMIT;
        manifest
    };
    let revision = admit.journal_revision + 1;
    let kept = early[0].clone();
    let rewritten = JournalPage::new(1, revision, early[1].entries().to_vec()).unwrap();
    let next = capture(&admit, &[kept, rewritten]).unwrap();
    assert_eq!(next.journal_revision, revision);
    assert_eq!(next.inventory_digest, discovered.inventory_digest);
    assert_ne!(
        next.journal_page_set_digest,
        discovered.journal_page_set_digest
    );
    assert_eq!(assert_manifest_successor(&admit, &next), Ok(()));
}

#[test]
fn a_captured_page_set_binds_the_envelope_bytes() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let entries = sorted_entries(3);
    let pages = pages_of(&entries, 3, 4);
    let genuine_envelope = envelope_of(&pages[0]);
    let genuine = capture_sealed(&prev, &pages, std::slice::from_ref(&genuine_envelope)).unwrap();
    let mut tampered = genuine_envelope.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    let sealed = [SealedPage {
        page: &pages[0],
        envelope: &tampered,
    }];
    let other = capture_inventory(&prev, &fence(&prev), &sealed).unwrap();
    assert_eq!(other.inventory_digest, genuine.inventory_digest);
    assert_ne!(
        other.journal_page_set_digest,
        genuine.journal_page_set_digest
    );
}

#[test]
fn a_journal_that_cannot_change_its_inventory_refuses_the_capture() {
    let entries = sorted_entries(2);
    let pages = pages_of(&entries, 2, 4);
    let cases = [
        (
            phase_code::BOOTSTRAP_TARGET,
            MigrationExecutionError::InvalidPhaseTransition,
        ),
        (
            phase_code::CONVERT,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (
            phase_code::VERIFY,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (
            phase_code::COMMIT,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (
            phase_code::FINALIZE,
            MigrationExecutionError::FrozenFieldChanged,
        ),
        (phase_code::DONE, MigrationExecutionError::TerminalPhase),
        (
            phase_code::RECOVERY_REQUIRED,
            MigrationExecutionError::TerminalPhase,
        ),
    ];
    for (phase, error) in cases {
        assert_eq!(
            capture(&manifest_at(phase, 3), &pages),
            Err(error),
            "phase {phase}"
        );
    }
    for open in [phase_code::DISCOVER, phase_code::PREPARE, phase_code::ADMIT] {
        assert!(
            capture(&manifest_at(open, 3), &pages).is_ok(),
            "phase {open}"
        );
    }
    // Conversion progress freezes the inventory even in an open phase.
    let mut progressed = manifest_at(phase_code::ADMIT, 3);
    progressed.page_count = 1;
    progressed.entry_count = 2;
    progressed.cursor_entry_index = 1;
    assert_eq!(
        capture(&progressed, &pages),
        Err(MigrationExecutionError::FrozenFieldChanged)
    );
}

#[test]
fn a_stale_fence_refuses_the_capture() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let stale = MigrationFence {
        fencing_generation: 6,
        journal_revision: 3,
    };
    let pages = pages_of(&sorted_entries(2), 2, 4);
    let envelope = envelope_of(&pages[0]);
    let sealed = [SealedPage {
        page: &pages[0],
        envelope: &envelope,
    }];
    assert_eq!(
        capture_inventory(&prev, &stale, &sealed),
        Err(MigrationExecutionError::StaleMigrationOwner)
    );
}

#[test]
fn the_page_set_must_be_exactly_indexed_zero_to_n_with_valid_generations() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let pages = pages_of(&sorted_entries(6), 2, 4);
    // A generation above the new revision names a page that does not exist yet.
    let future = JournalPage::new(0, 5, pages[0].entries().to_vec()).unwrap();
    let cases: [(&str, Vec<JournalPage>, JournalError); 4] = [
        (
            "a gap",
            vec![pages[0].clone(), pages[2].clone()],
            JournalError::PageSetMismatch,
        ),
        (
            "a duplicate index",
            vec![pages[0].clone(), pages[0].clone()],
            JournalError::PageSetMismatch,
        ),
        (
            "a set that does not start at page 0",
            vec![pages[1].clone()],
            JournalError::PageSetMismatch,
        ),
        (
            "a generation above the new revision",
            vec![future],
            JournalError::GenerationMismatch,
        ),
    ];
    for (name, set, error) in cases {
        assert_eq!(
            capture(&prev, &set),
            Err(MigrationExecutionError::Journal(error)),
            "{name}"
        );
    }
}

#[test]
fn the_pages_may_be_supplied_in_any_order() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let pages = pages_of(&sorted_entries(6), 2, 4);
    let shuffled = [pages[2].clone(), pages[0].clone(), pages[1].clone()];
    assert!(capture(&prev, &shuffled).is_ok());
    // Generation 0 is not a generation: a page cannot even be built with it.
    assert!(JournalPage::new(0, 0, pages[0].entries().to_vec()).is_err());
}

#[test]
fn an_empty_page_is_refused_because_an_empty_inventory_is_no_page_at_all() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let empty = JournalPage::new(0, 4, Vec::new()).unwrap();
    assert_eq!(
        capture(&prev, &[empty]),
        Err(MigrationExecutionError::Journal(
            JournalError::InvalidDescriptorCount
        ))
    );
}

#[test]
fn entries_must_ascend_across_pages() {
    let prev = manifest_at(phase_code::DISCOVER, 3);
    let entries = sorted_entries(4);
    // Page 0 holds the later entries and page 1 the earlier ones.
    let page0 = JournalPage::new(0, 4, entries[2..].to_vec()).unwrap();
    let page1 = JournalPage::new(1, 4, entries[..2].to_vec()).unwrap();
    assert_eq!(
        capture(&prev, &[page0, page1]),
        Err(MigrationExecutionError::Journal(
            JournalError::NotStrictlyAscending
        ))
    );
    // The same entry on two pages is not strictly ascending either.
    let a = JournalPage::new(0, 4, entries[..2].to_vec()).unwrap();
    let b = JournalPage::new(1, 4, entries[1..3].to_vec()).unwrap();
    assert_eq!(
        capture(&prev, &[a, b]),
        Err(MigrationExecutionError::Journal(
            JournalError::NotStrictlyAscending
        ))
    );
}

#[test]
fn a_recapture_replaces_the_inventory_while_no_conversion_has_run() {
    let discover = manifest_at(phase_code::DISCOVER, 1);
    let preliminary = capture(&discover, &pages_of(&sorted_entries(2), 2, 2)).unwrap();
    // Admission captures a larger final inventory over the preliminary one.
    let admit = {
        let mut manifest = preliminary.clone();
        manifest.phase = phase_code::ADMIT;
        manifest
    };
    let revision = admit.journal_revision + 1;
    let final_entries = sorted_entries(5);
    let final_pages = pages_of(&final_entries, 3, revision);
    let next = capture(&admit, &final_pages).unwrap();
    assert_eq!(shape(&next), (3, phase_code::ADMIT, 2, 5));
    assert_eq!(
        next.inventory_digest,
        inventory_digest(1, &final_entries).unwrap()
    );
    assert_eq!(assert_manifest_successor(&admit, &next), Ok(()));
}
