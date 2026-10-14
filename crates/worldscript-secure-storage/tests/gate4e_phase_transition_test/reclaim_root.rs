//! Gate 4 slice R1 through the root: `reclaim_abandoned_inventory` reads the binding, the manifest and the
//! journal key from the committed root, so a caller supplies only the fence of the owner it claims to be.
//! A former owner, an owner whose own checkpoint moved the journal on and a journal in `RECOVERY_REQUIRED`
//! remove nothing.

use worldscript_secure_storage::{
    begin_streamed_capture, mark_recovery, reclaim_abandoned_inventory, source_authority_kind,
    source_physical_authority_kind, InventoryReclaim, JournalInventoryEntry,
    JournalInventorySource, KeepReason, ReclaimError, Reclaimed, RecordClass, RecordIdentity,
    RecoveryReasonCode, SessionBegin,
};

use super::*;

fn entries(count: u32) -> Vec<JournalInventoryEntry> {
    (0..count)
        .map(|n| {
            let record = RecordIdentity::new(RecordClass::Codex, &[&format!("p{n:06}")]).unwrap();
            let source = JournalInventorySource {
                authority_kind: source_authority_kind::LEGACY_PLAINTEXT,
                physical_authority_kind: source_physical_authority_kind::TAURI_FILESYSTEM,
                generation: None,
                evidence_digest: Some([n as u8; 32]),
                foreign: None,
            };
            JournalInventoryEntry::new(record, source).unwrap()
        })
        .collect()
}

/// A bound journal in `DISCOVER` (revision 1) with one finished capture staged for revision 2 and
/// abandoned: its pending directory is live until the journal commits revision 2.
fn with_an_abandoned_capture() -> (Bound, JournalManifest) {
    let mut bound = Bound::new();
    let discover = entering(&bound.zero, phase_code::DISCOVER);
    let mut admission = bound.installation.exclusive();
    bound.transition(&mut admission, &discover).unwrap();
    drop(admission);
    let operation = WriteOperationId::generate().unwrap();
    let fence = MigrationFence::from_manifest(&discover);
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    let session = begin_streamed_capture(
        &mut StdFs,
        &bound.provider,
        layout,
        SessionBegin {
            journal: JournalSource {
                dir: &bound.installation.journal_dir,
                operation: &operation,
            },
            fence: &fence,
            entry_count: 3,
        },
    )
    .unwrap();
    let session = session.push_page(&mut StdFs, entries(3)).unwrap();
    drop(session.finish(&mut StdFs).unwrap());
    (bound, discover)
}

fn sweep(bound: &Bound, fence: &MigrationFence) -> Result<Reclaimed, AuthorityError> {
    sweep_over(&mut StdFs, bound, fence)
}

fn sweep_over<F: DurableFs>(
    fs: &mut F,
    bound: &Bound,
    fence: &MigrationFence,
) -> Result<Reclaimed, AuthorityError> {
    let operation = WriteOperationId::generate().unwrap();
    let layout = RootLayout {
        root_dir: &bound.installation.root_dir,
    };
    let request = InventoryReclaim {
        journal: JournalSource {
            dir: &bound.installation.journal_dir,
            operation: &operation,
        },
        fence,
    };
    reclaim_abandoned_inventory(fs, &bound.provider, layout, request)
}

fn inventory_names(bound: &Bound) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(bound.installation.journal_dir.join("inventory"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn the_current_owner_reclaims_what_its_committed_revision_proves_dead() {
    let (mut bound, discover) = with_an_abandoned_capture();
    // Revision 2 is not committed yet: the staged capture could still be promoted.
    let live = sweep(&bound, &MigrationFence::from_manifest(&discover)).unwrap();
    assert_eq!(
        (
            live.pending_removed,
            live.preserved.len(),
            inventory_names(&bound).len()
        ),
        (0, 1, 1)
    );
    assert_eq!(live.preserved[0].reason, KeepReason::LiveRevision);
    // The owner's own checkpoint commits revision 2: the capture can no longer be promoted.
    let progressed = progressing(&discover);
    bound.checkpoint(&progressed).unwrap();
    let done = sweep(&bound, &MigrationFence::from_manifest(&progressed)).unwrap();
    assert_eq!(
        (
            done.pending_removed,
            done.files_removed,
            inventory_names(&bound).len()
        ),
        (1, 1, 0)
    );
}

#[test]
fn a_caller_that_is_not_the_owner_at_the_committed_revision_removes_nothing() {
    let (mut bound, discover) = with_an_abandoned_capture();
    bound.checkpoint(&progressing(&discover)).unwrap();
    let before = snapshot(&bound);
    // The fence of revision 1 is stale now that the journal committed revision 2; a former owner after a
    // takeover presents the same kind of stale pair.
    let stale = sweep(&bound, &MigrationFence::from_manifest(&discover));
    let mut other_owner = MigrationFence::from_manifest(&progressing(&discover));
    other_owner.fencing_generation += 1;
    let usurper = sweep(&bound, &other_owner);
    let refused = [stale, usurper].iter().all(|result| {
        matches!(
            result,
            Err(AuthorityError::Reclaim(ReclaimError::Authority(_)))
        )
    });
    assert_eq!((refused, snapshot(&bound)), (true, before));
}

#[test]
fn a_journal_in_recovery_required_is_not_swept() {
    let (mut bound, discover) = with_an_abandoned_capture();
    let progressed = progressing(&discover);
    bound.checkpoint(&progressed).unwrap();
    let fence = MigrationFence::from_manifest(&progressed);
    let recovery = mark_recovery(&progressed, &fence, RecoveryReasonCode::new(1)).unwrap();
    let mut admission = bound.installation.exclusive();
    bound.transition(&mut admission, &recovery).unwrap();
    drop(admission);
    let before = snapshot(&bound);
    let refused = sweep(&bound, &MigrationFence::from_manifest(&recovery));
    assert_eq!(
        (refused.map(|_| ()), snapshot(&bound)),
        (
            Err(AuthorityError::Reclaim(ReclaimError::RecoveryRequired)),
            before
        )
    );
}

/// From the read of the binding to the last removal the sweep holds the cross-process root event, so a
/// takeover or a transition to `RECOVERY_REQUIRED` by another process cannot interleave with it: a second
/// holder asks for the event in the middle of the sweep and is refused, and gets it once the sweep ends.
#[cfg(unix)]
#[test]
fn the_sweep_holds_the_root_event_from_the_read_of_the_binding_to_the_last_removal() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::faulty_fs::FaultyFs;

    let (mut bound, discover) = with_an_abandoned_capture();
    let progressed = progressing(&discover);
    bound.checkpoint(&progressed).unwrap();
    let busy = Arc::new(AtomicBool::new(false));
    let seen = Arc::clone(&busy);
    let root_dir = bound.installation.root_dir.clone();
    let probe = move || {
        let refused = RootCommitGuard::try_acquire(&root_dir).unwrap().is_none();
        seen.store(refused, Ordering::SeqCst);
    };
    // The third read is inside the sweep, after it read the binding and before the first removal.
    let mut fs = FaultyFs::acting_after_served_reads(3, probe);
    let done = sweep_over(&mut fs, &bound, &MigrationFence::from_manifest(&progressed)).unwrap();
    let free_again = RootCommitGuard::try_acquire(&bound.installation.root_dir)
        .unwrap()
        .is_some();
    assert_eq!(
        (
            busy.load(Ordering::SeqCst),
            done.pending_removed,
            free_again
        ),
        (true, 1, true)
    );
}
