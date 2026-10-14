//! Gate 4E L1: the writer journal locator. A locator names the journal directory of one installation;
//! `authenticate_journal` resolves it under a root event of either admission mode and returns the
//! journal the committed root vouches for. Every refusal is typed, writes nothing and reads no other
//! directory.

use worldscript_secure_storage::admission::AdmittedRootCommitGuard;
use worldscript_secure_storage::{
    authenticate_journal, JournalLocator, JournalLookup, LocationFault, LocatorError,
};

#[cfg(unix)]
use super::faulty_fs::FaultyFs;
use super::*;

/// What a successful authentication reported, copied out of the proof, which cannot leave its event.
#[derive(Debug, Clone, PartialEq)]
struct Seen {
    binding: LiveMigration,
    manifest: JournalManifest,
    directory: PathBuf,
    current: bool,
}

fn locator_named(bound: &Bound, name: &str) -> Result<JournalLocator, LocatorError> {
    JournalLocator::new(bound.scope.clone(), name)
}

fn journal_locator(bound: &Bound) -> JournalLocator {
    locator_named(bound, "journal").unwrap()
}

fn seen_under<F: DurableFs, Mode>(
    bound: &Bound,
    fs: &mut F,
    event: &AdmittedRootCommitGuard<'_, Mode>,
    locator: &JournalLocator,
) -> Result<Seen, LocatorError> {
    let operation = WriteOperationId::generate().unwrap();
    let lookup = JournalLookup {
        locator,
        operation: &operation,
    };
    let proof = authenticate_journal(fs, &bound.provider, event, lookup)?;
    Ok(Seen {
        binding: proof.binding().clone(),
        manifest: proof.manifest().clone(),
        directory: proof.directory().to_path_buf(),
        current: proof.is_current(),
    })
}

/// The authentication of an ordinary operation, which holds the shared admission.
fn seen_shared<F: DurableFs>(
    bound: &Bound,
    fs: &mut F,
    locator: &JournalLocator,
) -> Result<Seen, LocatorError> {
    let mut admission = SharedAdmissionGuard::try_acquire(bound.installation.scope())
        .unwrap()
        .expect("no exclusive holder");
    let event = admission.try_root_commit().unwrap().expect("root idle");
    seen_under(bound, fs, &event, locator)
}

/// The authentication of the holder of the exclusive admission.
fn seen_exclusive(bound: &Bound, locator: &JournalLocator) -> Result<Seen, LocatorError> {
    let mut admission = bound.installation.exclusive();
    let event = admission.try_root_commit().unwrap().expect("root idle");
    seen_under(bound, &mut StdFs, &event, locator)
}

/// A refusal of the shared authentication that left every durable resource as it was.
fn refusal(bound: &Bound, locator: &JournalLocator) -> LocatorError {
    let before = snapshot(bound);
    let error = seen_shared(bound, &mut StdFs, locator).expect_err("the locator must be refused");
    assert_eq!(snapshot(bound), before);
    error
}

fn expected_seen(bound: &Bound) -> Seen {
    Seen {
        binding: bound.root().live_migration.unwrap(),
        manifest: bound.committed(),
        directory: fs::canonicalize(&bound.installation.journal_dir).unwrap(),
        current: true,
    }
}

#[test]
fn a_bound_journal_authenticates_under_a_shared_and_under_an_exclusive_event() {
    let bound = Bound::new();
    let locator = journal_locator(&bound);
    let expected = expected_seen(&bound);
    assert_eq!(
        seen_shared(&bound, &mut StdFs, &locator),
        Ok(expected.clone())
    );
    assert_eq!(seen_exclusive(&bound, &locator), Ok(expected));
}

#[test]
fn an_unbound_root_has_no_journal_to_authenticate() {
    let bound = Bound::unbound();
    assert_eq!(
        refusal(&bound, &journal_locator(&bound)),
        LocatorError::Authority(AuthorityError::NoLiveMigration)
    );
}

#[test]
fn no_committed_root_means_nothing_is_bound() {
    let installation = Installation::new();
    let mut provider = MemoryKeyProvider::new();
    let scope = provider.read_or_provision_installation_scope().unwrap();
    let key_ref = provider.import_epoch_key(1, [9u8; 32]).unwrap();
    provider.unlock().unwrap();
    let bound = Bound {
        installation,
        provider,
        scope,
        key_ref,
        zero: manifest_at(0, phase_code::BOOTSTRAP_TARGET),
    };
    assert_eq!(
        refusal(&bound, &journal_locator(&bound)),
        LocatorError::NoCommittedRoot
    );
}

#[test]
fn a_locator_of_another_installation_is_refused_before_any_directory_is_looked_at() {
    let bound = Bound::new();
    let foreign = MemoryKeyProvider::new()
        .read_or_provision_installation_scope()
        .unwrap();
    assert_ne!(foreign, bound.scope);
    // The located name does not even exist: the scope is judged first.
    let locator = JournalLocator::new(foreign, "no-such-journal").unwrap();
    assert_eq!(refusal(&bound, &locator), LocatorError::ScopeMismatch);
}

#[test]
fn a_name_must_be_one_component_of_the_fixed_grammar() {
    let bound = Bound::new();
    let too_long = "a".repeat(65);
    for refused in [
        "", "Journal", "a/b", "..", ".", "journal.", "-journal", "a b", "jörnal", "a\\b", &too_long,
    ] {
        assert_eq!(
            locator_named(&bound, refused),
            Err(LocatorError::InvalidName),
            "{refused:?}"
        );
    }
    for accepted in ["journal", "j-1", "0a", &"a".repeat(64)] {
        assert!(locator_named(&bound, accepted).is_ok(), "{accepted:?}");
    }
}

fn move_the_journal_away(bound: &Bound) {
    let away = bound.installation.base.join("moved-journal");
    fs::rename(&bound.installation.journal_dir, away).unwrap();
}

fn replace_the_journal_with_a_file(bound: &Bound) {
    fs::remove_dir_all(&bound.installation.journal_dir).unwrap();
    fs::write(&bound.installation.journal_dir, b"not a directory").unwrap();
}

/// A broken installation, the name the locator uses on it and the fault that must be reported.
struct BrokenLocation {
    break_it: fn(&Bound),
    name: &'static str,
    fault: LocationFault,
}

#[test]
fn a_location_that_is_absent_a_file_or_the_root_is_refused() {
    let cases = [
        BrokenLocation {
            break_it: move_the_journal_away,
            name: "journal",
            fault: LocationFault::Missing,
        },
        BrokenLocation {
            break_it: replace_the_journal_with_a_file,
            name: "journal",
            fault: LocationFault::NotADirectory,
        },
        // The authority root is a real directory below the installation, but it is the root.
        BrokenLocation {
            break_it: |_| {},
            name: "authority",
            fault: LocationFault::Misplaced,
        },
    ];
    for case in cases {
        let bound = Bound::new();
        (case.break_it)(&bound);
        let locator = locator_named(&bound, case.name).unwrap();
        assert_eq!(
            refusal(&bound, &locator),
            LocatorError::Location(case.fault)
        );
    }
}

#[cfg(unix)]
#[test]
fn a_symlink_is_not_a_location() {
    let bound = Bound::new();
    let real = bound.installation.base.join("real-journal");
    fs::rename(&bound.installation.journal_dir, &real).unwrap();
    std::os::unix::fs::symlink(&real, &bound.installation.journal_dir).unwrap();
    assert_eq!(
        refusal(&bound, &journal_locator(&bound)),
        LocatorError::Location(LocationFault::Symlink)
    );
}

#[test]
fn a_generation_that_is_not_the_bound_one_is_refused_and_no_sibling_is_read() {
    let bound = Bound::new();
    let bound_generation = generation_path(&bound.installation.journal_dir, 0);
    let mut bytes = fs::read(&bound_generation).unwrap();
    // A sibling that would pass for the bound journal if the directory were searched.
    fs::write(
        generation_path(&bound.installation.journal_dir, 1),
        fs::read(&bound_generation).unwrap(),
    )
    .unwrap();
    *bytes.last_mut().unwrap() ^= 0xff;
    fs::write(&bound_generation, &bytes).unwrap();
    assert!(matches!(
        refusal(&bound, &journal_locator(&bound)),
        LocatorError::Authority(_)
    ));
    assert_eq!(fs::read(&bound_generation).unwrap(), bytes);
}

#[test]
fn a_missing_root_named_generation_is_recovery_required_and_nothing_else_is_used() {
    let bound = Bound::new();
    let bound_generation = generation_path(&bound.installation.journal_dir, 0);
    fs::write(
        generation_path(&bound.installation.journal_dir, 1),
        fs::read(&bound_generation).unwrap(),
    )
    .unwrap();
    fs::remove_file(&bound_generation).unwrap();
    assert!(matches!(
        refusal(&bound, &journal_locator(&bound)),
        LocatorError::Authority(_)
    ));
}

/// How many bounded reads one authentication of a bound journal serves.
#[cfg(unix)]
fn reads_of_an_authentication() -> usize {
    let bound = Bound::new();
    let mut counting = FaultyFs::observing();
    seen_shared(&bound, &mut counting, &journal_locator(&bound)).unwrap();
    assert!(counting.reads() > 0);
    counting.reads()
}

/// The authentication of a fresh bound journal during which `disturb(journal, moved)` runs right after
/// its last read; `moved` is a free name next to the journal.
#[cfg(unix)]
fn disturbed_after_the_last_read(disturb: fn(&Path, &Path)) -> Result<Seen, LocatorError> {
    let reads = reads_of_an_authentication();
    let bound = Bound::new();
    let (journal, moved) = (
        bound.installation.journal_dir.clone(),
        bound.installation.base.join("moved-journal"),
    );
    let mut disturbing = FaultyFs::acting_after_reads(reads, move || disturb(&journal, &moved));
    seen_shared(&bound, &mut disturbing, &journal_locator(&bound))
}

#[cfg(unix)]
fn replace_with_an_empty_directory(journal: &Path, moved: &Path) {
    fs::rename(journal, moved).unwrap();
    fs::create_dir(journal).unwrap();
}

#[cfg(unix)]
fn replace_with_a_symlink_to_the_moved_directory(journal: &Path, moved: &Path) {
    fs::rename(journal, moved).unwrap();
    std::os::unix::fs::symlink(moved, journal).unwrap();
}

#[cfg(unix)]
#[test]
fn a_directory_replaced_after_the_reads_is_not_the_one_that_was_authenticated() {
    assert_eq!(
        disturbed_after_the_last_read(replace_with_an_empty_directory),
        Err(LocatorError::Changed)
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_put_in_place_of_the_moved_directory_is_not_the_one_that_was_authenticated() {
    // The symlink leads to the very directory that was pinned, so a check that follows it would
    // still call the pinned directory current.
    assert_eq!(
        disturbed_after_the_last_read(replace_with_a_symlink_to_the_moved_directory),
        Err(LocatorError::Changed)
    );
}

#[test]
fn the_refusal_snapshot_sees_an_empty_directory_and_a_changed_byte() {
    let bound = Bound::new();
    let before = snapshot(&bound);
    let empty = bound.installation.journal_dir.join("empty");
    fs::create_dir(&empty).unwrap();
    assert_ne!(snapshot(&bound), before);
    fs::remove_dir(&empty).unwrap();
    assert_eq!(snapshot(&bound), before);
    let generation = generation_path(&bound.installation.journal_dir, 0);
    let mut bytes = fs::read(&generation).unwrap();
    *bytes.last_mut().unwrap() ^= 0xff;
    fs::write(&generation, bytes).unwrap();
    assert_ne!(snapshot(&bound), before);
}
