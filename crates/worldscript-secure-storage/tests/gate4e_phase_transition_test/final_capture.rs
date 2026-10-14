//! Gate 4E E3a: the final inventory, the capture that runs in `ADMIT` and sets
//! `final_inventory_captured`, is published only by the exclusively admitted final-capture commit. The
//! ordinary capture commits publish the preliminary inventory and refuse the final one, the final
//! commits refuse the preliminary one, and each refusal is decided before the file system is touched.

use worldscript_secure_storage::{
    begin_streamed_capture, capture_inventory, commit_final_inventory_capture,
    commit_final_streamed_inventory_capture, commit_inventory_capture,
    commit_streamed_inventory_capture, InventoryCapture, SessionBegin, StagedCapture,
    StreamedInventoryCapture,
};

use super::faulty_fs::FaultyFs;
use super::*;

const FINAL_REFUSED: AuthorityError = AuthorityError::Journal(JournalDurableError::Authority(
    MigrationExecutionError::FinalCaptureNotExclusive,
));
const PRELIMINARY_REFUSED: AuthorityError = AuthorityError::Journal(
    JournalDurableError::Authority(MigrationExecutionError::NotAFinalCapture),
);

/// Which commit publishes a capture.
#[derive(Clone, Copy)]
enum Commit {
    Ordinary,
    Final,
}

/// The empty inventory as a capture of `committed`: its successor and the token that publishes it.
fn empty_capture_of(committed: &JournalManifest) -> (JournalManifest, MigrationFence) {
    let fence = MigrationFence::from_manifest(committed);
    let successor = capture_inventory(committed, &fence, &[]).unwrap();
    let token = MigrationFence::from_manifest(&successor);
    (successor, token)
}

/// Moves the bound journal through `phases`, each by an exclusive phase transition.
fn enter_phases(bound: &mut Bound, from: &JournalManifest, phases: &[u32]) -> JournalManifest {
    let mut current = from.clone();
    for phase in phases {
        let next = entering(&current, *phase);
        let mut admission = bound.installation.exclusive();
        bound.transition(&mut admission, &next).unwrap();
        current = next;
    }
    current
}

/// The in-memory capture of the empty inventory of `committed`, published by `commit`.
fn capture_empty(
    bound: &mut Bound,
    committed: &JournalManifest,
    commit: Commit,
    fs: &mut FaultyFs,
) -> Result<RootCommitted, AuthorityError> {
    let (successor, token) = empty_capture_of(committed);
    let operation = WriteOperationId::generate().unwrap();
    let journal = JournalSource {
        dir: &bound.installation.journal_dir,
        operation: &operation,
    };
    let capture = InventoryCapture {
        checkpoint: checkpoint_of(journal, &bound.key_ref, &successor, &token),
        committed_manifest: committed,
        pages: &[],
    };
    let root_dir = bound.installation.root_dir.clone();
    match commit {
        Commit::Ordinary => commit_inventory_capture(
            fs,
            &mut bound.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            capture,
        ),
        Commit::Final => {
            let mut admission = bound.installation.exclusive();
            commit_final_inventory_capture(&mut admission, fs, &mut bound.provider, capture)
        }
    }
}

/// The streamed capture of the empty inventory of `committed`, published by `commit`.
fn capture_empty_streamed(
    bound: &mut Bound,
    committed: &JournalManifest,
    commit: Commit,
    fs: &mut FaultyFs,
) -> Result<RootCommitted, AuthorityError> {
    let operation = WriteOperationId::generate().unwrap();
    let root_dir = bound.installation.root_dir.clone();
    let fence = MigrationFence::from_manifest(committed);
    let session = begin_streamed_capture(
        &mut StdFs,
        &bound.provider,
        RootLayout {
            root_dir: &root_dir,
        },
        SessionBegin {
            journal: JournalSource {
                dir: &bound.installation.journal_dir,
                operation: &operation,
            },
            fence: &fence,
            entry_count: 0,
        },
    )
    .unwrap();
    let staged: StagedCapture = session.finish(&mut StdFs).unwrap();
    let token = MigrationFence::from_manifest(staged.successor());
    let capture = StreamedInventoryCapture {
        staged: &staged,
        fence: &token,
        operation: &operation,
        root_key_ref: &bound.key_ref,
        active_key_epoch: 1,
        conflict: CandidateConflict::Refuse,
    };
    match commit {
        Commit::Ordinary => commit_streamed_inventory_capture(
            fs,
            &mut bound.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            capture,
        ),
        Commit::Final => {
            let mut admission = bound.installation.exclusive();
            commit_final_streamed_inventory_capture(
                &mut admission,
                fs,
                &mut bound.provider,
                capture,
            )
        }
    }
}

/// A bound journal in `DISCOVER`, where the preliminary inventory is captured.
fn at_discover() -> (Bound, JournalManifest) {
    let mut bound = Bound::new();
    let zero = bound.zero.clone();
    let discover = enter_phases(&mut bound, &zero, &[phase_code::DISCOVER]);
    (bound, discover)
}

/// A bound journal in `ADMIT`, entered through a preliminary capture and `PREPARE`, where the final
/// inventory is captured.
fn at_admit(capture: Capturing) -> (Bound, JournalManifest) {
    let (mut bound, discover) = at_discover();
    let captured = commit_preliminary(capture, &mut bound, &discover);
    let admit = enter_phases(
        &mut bound,
        &captured,
        &[phase_code::PREPARE, phase_code::ADMIT],
    );
    (bound, admit)
}

/// Commits the preliminary inventory of the journal in `DISCOVER` the way `capture` does and returns
/// the committed manifest.
fn commit_preliminary(
    capture: Capturing,
    bound: &mut Bound,
    discover: &JournalManifest,
) -> JournalManifest {
    capture(
        bound,
        discover,
        Commit::Ordinary,
        &mut FaultyFs::observing(),
    )
    .unwrap();
    bound.committed()
}

type Capturing = fn(
    &mut Bound,
    &JournalManifest,
    Commit,
    &mut FaultyFs,
) -> Result<RootCommitted, AuthorityError>;

/// The two ways to capture: from pages in memory and from a staged one.
fn both_ways() -> [Capturing; 2] {
    [capture_empty, capture_empty_streamed]
}

#[test]
fn the_final_inventory_is_captured_only_under_the_exclusive_admission() {
    for capture in both_ways() {
        let (mut bound, admit) = at_admit(capture);
        let before = snapshot(&bound);
        let mut refused = FaultyFs::observing();
        assert_eq!(
            capture(&mut bound, &admit, Commit::Ordinary, &mut refused).unwrap_err(),
            FINAL_REFUSED
        );
        // The refusal touched neither the file system nor, by the snapshot, any durable resource.
        assert_eq!(refused.calls(), 0);
        assert_eq!(snapshot(&bound), before);
        let mut published = FaultyFs::observing();
        capture(&mut bound, &admit, Commit::Final, &mut published).unwrap();
        assert!(published.calls() > 0);
        let committed = bound.committed();
        assert!(committed.final_inventory_captured);
        assert_eq!(committed.phase, phase_code::ADMIT);
        assert_eq!(committed.journal_revision, admit.journal_revision + 1);
    }
}

#[test]
fn the_exclusive_final_capture_refuses_a_preliminary_inventory() {
    for capture in both_ways() {
        let (mut bound, discover) = at_discover();
        let before = snapshot(&bound);
        let mut refused = FaultyFs::observing();
        assert_eq!(
            capture(&mut bound, &discover, Commit::Final, &mut refused).unwrap_err(),
            PRELIMINARY_REFUSED
        );
        assert_eq!(refused.calls(), 0);
        assert_eq!(snapshot(&bound), before);
        // The ordinary capture still publishes it.
        capture(
            &mut bound,
            &discover,
            Commit::Ordinary,
            &mut FaultyFs::observing(),
        )
        .unwrap();
        assert!(!bound.committed().final_inventory_captured);
    }
}
