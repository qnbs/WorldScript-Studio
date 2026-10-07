//! Gate 4D Slice C1b-2: reading back a stored inventory page set (§10.1.1).

#[path = "support/inventory.rs"]
mod support;

use std::path::PathBuf;

use support::*;
use worldscript_secure_storage::*;

/// A journal in which a first capture was stored and the root advanced to the manifest naming it.
fn stored(count: u32, per_page: usize) -> (Journal, Captured) {
    let captured = Captured::new(count, per_page);
    let mut journal = journal_of(&captured);
    store(&mut StdFs, &journal, &captured).unwrap();
    journal.live = commit_into(journal.path(), &captured.successor);
    (journal, captured)
}

fn verify<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
) -> Result<VerifiedInventory, JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, journal.path(), &op);
    verify_stored_inventory(&mut ctx, &journal.live)
}

fn load<F: DurableFs>(
    fs: &mut F,
    journal: &Journal,
    verified: &VerifiedInventory,
    index: u32,
) -> Result<JournalPage, JournalDurableError> {
    let op = WriteOperationId::generate().unwrap();
    let key = key();
    let mut ctx = JournalDurableContext::new(fs, &key, journal.path(), &op);
    load_inventory_page(&mut ctx, verified, index)
}

fn file_of(journal: &Journal, captured: &Captured, index: u32) -> PathBuf {
    page_file(journal.path(), &captured.digest(), index)
}

#[test]
fn a_stored_set_verifies_and_every_page_loads_back_equal() {
    let (journal, captured) = stored(5, 2);
    let mut fs = ObservedFs::new();
    let verified = verify(&mut fs, &journal).unwrap();
    assert_eq!(verified.manifest(), &captured.successor);
    assert_eq!(verified.page_refs().len(), captured.pages.len());
    for (index, page) in captured.pages.iter().enumerate() {
        let loaded = load(&mut fs, &journal, &verified, index as u32).unwrap();
        assert!(loaded == *page);
        let expected = page_ref_for(page, &captured.envelopes[index]).unwrap();
        assert_eq!(verified.page_refs()[index], expected);
    }
    // Reading never creates a file or a directory.
    assert!(fs.created_nothing());
}

#[test]
fn an_empty_inventory_verifies_without_any_page() {
    let captured = Captured::on_pages(manifest_at(COMMITTED_REVISION), Vec::new());
    let mut journal = journal_of(&captured);
    journal.live = commit_into(journal.path(), &captured.successor);
    let verified = verify(&mut StdFs, &journal).unwrap();
    assert!(verified.page_refs().is_empty());
    let refused = load(&mut StdFs, &journal, &verified, 0);
    assert_eq!(
        refused.err().unwrap(),
        JournalDurableError::Journal(JournalError::InvalidPageIndex)
    );
}

#[test]
fn a_page_index_outside_the_verified_set_is_refused() {
    let (journal, captured) = stored(4, 2);
    let verified = verify(&mut StdFs, &journal).unwrap();
    let outside = captured.pages.len() as u32;
    assert_eq!(
        load(&mut StdFs, &journal, &verified, outside)
            .err()
            .unwrap(),
        JournalDurableError::Journal(JournalError::InvalidPageIndex)
    );
}

struct Damage {
    name: &'static str,
    apply: fn(&Journal, &Captured),
    error: JournalDurableError,
}

fn recovery() -> JournalDurableError {
    JournalDurableError::Authority(MigrationExecutionError::RecoveryRequired)
}

fn damages() -> Vec<Damage> {
    vec![
        Damage {
            name: "a page file is missing",
            apply: |j, c| std::fs::remove_file(file_of(j, c, 1)).unwrap(),
            error: recovery(),
        },
        Damage {
            name: "a page directory is missing",
            apply: |j, c| {
                let dir = file_of(j, c, 0).parent().unwrap().to_path_buf();
                std::fs::remove_dir_all(dir).unwrap();
            },
            error: recovery(),
        },
        Damage {
            name: "a page directory holds only a staging leftover",
            apply: |j, c| {
                let file = file_of(j, c, 0);
                std::fs::rename(&file, file.with_extension("wsr1.tmp-x-4")).unwrap();
            },
            error: recovery(),
        },
        Damage {
            name: "a page directory holds a second canonical generation",
            apply: |j, c| {
                let file = file_of(j, c, 0);
                std::fs::copy(&file, file.with_file_name("generation-9.wsr1")).unwrap();
            },
            error: recovery(),
        },
        Damage {
            name: "a page directory holds more entries than any page has",
            apply: |j, c| {
                let dir = file_of(j, c, 0).parent().unwrap().to_path_buf();
                for n in 0..70 {
                    std::fs::write(dir.join(format!("junk-{n}")), b"x").unwrap();
                }
            },
            error: recovery(),
        },
    ]
}

/// A fresh stored journal, `damage` applied to it, and the refusal the reader gives.
fn refusal_after(apply: fn(&Journal, &Captured)) -> JournalDurableError {
    let (journal, captured) = stored(5, 2);
    apply(&journal, &captured);
    verify(&mut StdFs, &journal).unwrap_err()
}

#[test]
fn damaged_page_storage_is_refused_with_the_recovery_state() {
    for damage in damages() {
        assert_eq!(refusal_after(damage.apply), damage.error, "{}", damage.name);
    }
}

#[test]
fn a_staging_leftover_beside_the_generation_is_ignored() {
    let (journal, captured) = stored(5, 2);
    let file = file_of(&journal, &captured, 0);
    let operation = WriteOperationId::generate().unwrap();
    let debris = format!("generation-4.wsr1.tmp-{}-4", operation.as_str());
    std::fs::write(file.with_file_name(debris), b"leftover").unwrap();
    assert!(verify(&mut StdFs, &journal).is_ok());
}

#[test]
fn a_page_that_does_not_authenticate_is_refused() {
    let tampered = refusal_after(|j, c| {
        let file = file_of(j, c, 1);
        let mut bytes = std::fs::read(&file).unwrap();
        *bytes.last_mut().unwrap() ^= 0x01;
        std::fs::write(file, bytes).unwrap();
    });
    assert!(matches!(
        tampered,
        JournalDurableError::Journal(JournalError::Open(_))
    ));
    // Page 0's authentic bytes under page 1's identity do not open as page 1.
    let swapped = refusal_after(|j, c| {
        std::fs::copy(file_of(j, c, 0), file_of(j, c, 1)).unwrap();
    });
    assert!(matches!(
        swapped,
        JournalDurableError::Journal(JournalError::Open(_))
    ));
}

#[test]
fn an_authentic_page_the_manifest_does_not_name_is_refused() {
    // The same page sealed again is authentic but is not the envelope the page set binds.
    let resealed = refusal_after(|j, c| {
        let fresh = seal_inventory_pages(&key(), OPERATION, &c.pages[1..2]).unwrap();
        std::fs::write(file_of(j, c, 1), &fresh[0]).unwrap();
    });
    assert_eq!(
        resealed,
        JournalDurableError::Journal(JournalError::PageSetMismatch)
    );
}

#[test]
fn a_page_sealed_for_another_key_epoch_is_refused() {
    let foreign = refusal_after(|j, c| {
        std::fs::write(file_of(j, c, 0), sealed_at_epoch(c, 2)).unwrap();
    });
    assert!(matches!(
        foreign,
        JournalDurableError::Journal(JournalError::Corrupt(_))
    ));
}

#[test]
fn an_oversized_page_file_is_refused_before_it_is_parsed() {
    let oversized = refusal_after(|j, c| {
        let file = std::fs::File::create(file_of(j, c, 0)).unwrap();
        file.set_len(MAX_JOURNAL_PAGE_BYTES as u64 + 1024).unwrap();
    });
    assert_eq!(
        oversized,
        JournalDurableError::Journal(JournalError::Corrupt(
            "page generation exceeds the envelope bound"
        ))
    );
}

#[test]
fn another_digests_directory_is_never_read() {
    let first = Captured::new(4, 2);
    let mut journal = journal_of(&first);
    store(&mut StdFs, &journal, &first).unwrap();
    // A discarded attempt at the same inventory leaves a complete set under another digest, and
    // garbage under a third.
    let attempt = Captured::new(4, 2);
    store(&mut StdFs, &journal, &attempt).unwrap();
    let junk = inventory_page_dir(journal.path(), &[0xEE; 32], 0);
    std::fs::create_dir_all(&junk).unwrap();
    std::fs::write(junk.join("generation-4.wsr1"), b"junk").unwrap();
    journal.live = commit_into(journal.path(), &first.successor);
    let verified = verify(&mut StdFs, &journal).unwrap();
    assert_eq!(verified.manifest(), &first.successor);
    assert_ne!(first.digest(), attempt.digest());
}

#[test]
fn a_page_that_changed_after_verification_is_refused_on_load() {
    let (journal, captured) = stored(5, 2);
    let verified = verify(&mut StdFs, &journal).unwrap();
    let file = file_of(&journal, &captured, 1);
    let mut bytes = std::fs::read(&file).unwrap();
    bytes[0] ^= 0x01;
    std::fs::write(file, bytes).unwrap();
    assert_eq!(
        load(&mut StdFs, &journal, &verified, 1).err().unwrap(),
        JournalDurableError::Journal(JournalError::PageSetMismatch)
    );
    assert!(load(&mut StdFs, &journal, &verified, 0).is_ok());
}

#[test]
fn a_binding_that_does_not_name_the_stored_manifest_is_refused() {
    let (mut journal, _) = stored(5, 2);
    journal.live.manifest_digest = [0x99; 32];
    assert_eq!(
        verify(&mut StdFs, &journal).unwrap_err(),
        JournalDurableError::Authority(MigrationExecutionError::LiveBindingMismatch)
    );
}
