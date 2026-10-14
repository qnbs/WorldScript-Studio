//! Gate 4E W1: the journal owner's progress checkpoints hold no admission, so they can land at any
//! point of an ordinary operation in the window. Two deterministic races put one between two exact
//! reads; a sampled sweep puts one at many points of a write. The binding is never lost and never
//! written over. These tests need a file system that acts from inside a read, which only Unix tests do.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use worldscript_secure_storage::{
    OperationError, ProtectedCommitted, ProtectedError, RootStoreError,
};

use super::faulty_fs::FaultyFs;
use super::window::{bound_at, settled, Shared, Windowed};
use super::*;

/// The journal owner: it moves the journal one revision on and the root with it, and holds no admission.
#[derive(Clone)]
struct Owner {
    provider: Shared,
    root_dir: PathBuf,
    journal_dir: PathBuf,
    key_ref: RootKeyRefV1,
}

impl Owner {
    fn of(windowed: &Windowed) -> Self {
        Owner {
            provider: windowed.provider.clone(),
            root_dir: windowed.installation.root_dir.clone(),
            journal_dir: windowed.installation.journal_dir.clone(),
            key_ref: windowed.key_ref.clone(),
        }
    }

    /// The progress checkpoint of `next`: the next revision, the same phase.
    fn progress(&self, next: &JournalManifest) {
        let mut provider = self.provider.clone();
        let fence = MigrationFence::from_manifest(next);
        let operation = WriteOperationId::generate().unwrap();
        let journal = JournalSource {
            dir: &self.journal_dir,
            operation: &operation,
        };
        let checkpoint = checkpoint_of(journal, &self.key_ref, next, &fence);
        let layout = RootLayout {
            root_dir: &self.root_dir,
        };
        commit_journal_checkpoint(&mut StdFs, &mut provider, layout, checkpoint).unwrap();
    }
}

/// An action for `FaultyFs` that runs the owner's checkpoint on another thread and waits for it, so the
/// checkpoint lands exactly between two reads. The flag says whether it finished in time, which it
/// cannot while the operation itself holds the root event.
fn owner_progresses(windowed: &Windowed) -> (impl FnMut() + 'static, Arc<AtomicBool>) {
    let finished = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&finished);
    let owner = Owner::of(windowed);
    let next = progressing(&windowed.committed());
    let action = move || {
        let (sender, receiver) = mpsc::channel();
        let (owner, next) = (owner.clone(), next.clone());
        thread::spawn(move || {
            owner.progress(&next);
            let _ = sender.send(());
        });
        if receiver.recv_timeout(Duration::from_secs(30)).is_ok() {
            flag.store(true, Ordering::SeqCst);
        }
    };
    (action, finished)
}

type Spawned = Arc<Mutex<Vec<thread::JoinHandle<()>>>>;

/// As [`owner_progresses`], without waiting: the checkpoint overtakes the operation wherever the root
/// lock lets it.
fn owner_progresses_in_background(
    windowed: &Windowed,
    spawned: &Spawned,
) -> impl FnMut() + 'static {
    let spawned = Arc::clone(spawned);
    let owner = Owner::of(windowed);
    let next = progressing(&windowed.committed());
    move || {
        let (owner, next) = (owner.clone(), next.clone());
        let handle = thread::spawn(move || owner.progress(&next));
        spawned.lock().unwrap().push(handle);
    }
}

/// The binding the root holds is the one of the owner's revision 1.
fn assert_owner_revision_bound(windowed: &Windowed, context: &str) {
    let progressed = windowed.committed();
    assert_eq!(progressed.journal_revision, 1, "{context}");
    assert_eq!(
        windowed.root().live_migration,
        Some(binding_of(&progressed, &windowed.installation.journal_dir)),
        "{context}"
    );
}

/// A binding that moved after the snapshot was taken and before the journal was read is not the binding
/// the operation holds: the window is not opened for that operation, and the next one is admitted.
#[test]
fn a_binding_that_moved_before_the_journal_was_read_keeps_the_barrier_for_that_operation() {
    // The reads of a capture up to the point where the journal would be read are those of a storage
    // that has no locator.
    let plain = Windowed::new(bound_at(phase_code::PREPARE), None);
    let mut observing = FaultyFs::observing();
    drop(settled(|| plain.storage.try_authority_snapshot(&mut observing)).unwrap());
    let before_the_journal = observing.served();
    assert!(before_the_journal > 0);

    let windowed = Windowed::at(phase_code::PREPARE);
    let (action, finished) = owner_progresses(&windowed);
    let mut fs = FaultyFs::acting_after_served_reads(before_the_journal, action);
    let mut guard = settled(|| windowed.storage.try_authority_snapshot(&mut fs)).unwrap();
    assert!(
        finished.load(Ordering::SeqCst),
        "the checkpoint landed between two reads"
    );
    assert_eq!(
        guard.list_records(&mut StdFs).map(|_| ()),
        Err(OperationError::MigrationRequired)
    );
    drop(guard);
    assert_owner_revision_bound(&windowed, "after the refused listing");
    assert_eq!(windowed.list(), Ok(0));
}

/// The write repeats the verdict right before its first root commit: a binding that moved in between
/// refuses it, and nothing of the record or its marker exists afterwards.
#[test]
fn a_write_whose_binding_moved_before_its_first_commit_is_refused_and_writes_nothing() {
    // A write reads what a snapshot and the listing of its catalog read before it revalidates.
    let calibration = Windowed::at(phase_code::PREPARE);
    let mut observing = FaultyFs::observing();
    let mut guard = settled(|| calibration.storage.try_authority_snapshot(&mut observing)).unwrap();
    guard.list_records(&mut observing).unwrap();
    drop(guard);
    let before_revalidation = observing.served();

    let windowed = Windowed::at(phase_code::PREPARE);
    let (action, finished) = owner_progresses(&windowed);
    let mut fs = FaultyFs::acting_after_served_reads(before_revalidation, action);
    let mutation = windowed.mutation(None, b"moved");
    let outcome = settled(|| windowed.storage.try_write_record(&mut fs, mutation));
    assert!(
        finished.load(Ordering::SeqCst),
        "the checkpoint landed between two reads"
    );
    assert_eq!(outcome.map(|_| ()), Err(OperationError::MigrationRequired));
    let data: Vec<_> = windowed
        .tree()
        .into_keys()
        .filter(|name| name.starts_with("records") || name.starts_with("markers"))
        .collect();
    assert!(data.is_empty(), "{data:?}");
    assert_owner_revision_bound(&windowed, "after the refused write");
    assert_eq!(windowed.list(), Ok(0));
}

/// How many reads of any kind an undisturbed write serves.
fn reads_of_a_write() -> usize {
    let undisturbed = Windowed::at(phase_code::PREPARE);
    let mut observing = FaultyFs::observing();
    let mutation = undisturbed.mutation(None, b"calibration");
    settled(|| {
        undisturbed
            .storage
            .try_write_record(&mut observing, mutation)
    })
    .unwrap();
    observing.served()
}

/// A write that the owner's checkpoint overtakes, from another thread, after its `position`-th read.
fn raced_write(position: usize) -> (Windowed, Result<ProtectedCommitted, OperationError>) {
    let windowed = Windowed::at(phase_code::PREPARE);
    let spawned: Spawned = Arc::default();
    let action = owner_progresses_in_background(&windowed, &spawned);
    let mut fs = FaultyFs::acting_after_served_reads(position, action);
    let mutation = windowed.mutation(None, b"raced");
    let outcome = settled(|| windowed.storage.try_write_record(&mut fs, mutation));
    let handles: Vec<_> = spawned.lock().unwrap().drain(..).collect();
    assert_eq!(handles.len(), 1, "the checkpoint ran at read {position}");
    for handle in handles {
        handle.join().unwrap();
    }
    (windowed, outcome)
}

/// A write that the owner's checkpoint stopped midway is recoverable and the record converges.
fn recover_and_converge(windowed: &Windowed, position: usize) {
    windowed.reconcile().unwrap();
    let expected = (windowed.list().unwrap() == 1).then_some(1);
    windowed.write(expected, b"final").unwrap();
    assert_eq!(windowed.read().unwrap(), b"final", "read {position}");
}

/// A progress checkpoint that lands at many points of a write is never lost and never written over: the
/// write either commits on top of it, is refused before its first root commit, or stops transiently
/// and is recoverable, and the root ends up binding the owner's revision.
#[test]
fn a_progress_checkpoint_during_a_write_is_neither_lost_nor_written_over() {
    let reads = reads_of_a_write();
    assert!(
        reads > 20,
        "a write reads the root, the journal and the catalog: {reads}"
    );
    // Every sixth read, and the last one: each position builds a fresh bound installation.
    for position in (1..=reads).step_by(6).chain([reads]) {
        let (windowed, outcome) = raced_write(position);
        let context = format!("a write at read {position}");
        assert_owner_revision_bound(&windowed, &context);
        match outcome {
            Ok(committed) => {
                assert_eq!(committed.generation, 1, "{context}");
                assert_eq!(windowed.read().unwrap(), b"raced");
            }
            // Refused before the first root commit.
            Err(OperationError::MigrationRequired) => {
                assert_eq!(windowed.list().unwrap(), 0, "{context}");
            }
            // The owner's checkpoint held the root: the write stops where it is.
            Err(OperationError::Protected(ProtectedError::RootBusy))
            | Err(OperationError::Protected(ProtectedError::Authority(AuthorityError::Root(
                RootStoreError::PreparationPending,
            )))) => recover_and_converge(&windowed, position),
            Err(other) => panic!("{context}: unexpected refusal {other:?}"),
        }
        assert_owner_revision_bound(&windowed, &context);
    }
}
