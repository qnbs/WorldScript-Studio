//! Gate 3 slice 3C part 3b: the two-phase authority-root commit, its crash recovery and the trusted
//! cold start (§5.3, §5.3.1), against the fault-injecting in-memory key provider.
//!
//! Each §5.3.1 crash window is produced by an injected anchor or filesystem failure, then resolved
//! by `recover_root`. An injected error is not a power loss (Gate 6).

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use worldscript_secure_storage::memory_provider::{AnchorOp, Fault, MemoryKeyProvider};
use worldscript_secure_storage::{
    commit_root, load_committed_root, recover_root, DirectoryDurability, DurableFs,
    InstallationScopeId, KeyProvider, KeyProviderError, RootBody, RootCommitEvidence,
    RootCommitRequest, RootCommitState, RootKeyRefV1, RootLayout, RootPointer, RootRecovery,
    RootRecoveryReason, RootSlot, RootStoreError, StdFs,
};

/// The real filesystem with one injected failure: creating any file directly inside a directory,
/// or the atomic pointer rename.
enum RootFault {
    CreateIn(PathBuf),
    Rename,
}

impl DurableFs for RootFault {
    type File = fs::File;

    fn create_new(&mut self, path: &Path) -> io::Result<fs::File> {
        if let RootFault::CreateIn(dir) = self {
            if path.parent() == Some(dir.as_path()) {
                return Err(io::Error::other("injected create fault"));
            }
        }
        StdFs.create_new(path)
    }

    fn sync_file(&mut self, file: &mut fs::File) -> io::Result<()> {
        StdFs.sync_file(file)
    }

    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        StdFs.read(path)
    }

    fn link_no_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        StdFs.link_no_replace(from, to)
    }

    fn remove_file(&mut self, path: &Path) -> io::Result<()> {
        StdFs.remove_file(path)
    }

    fn sync_dir(&mut self, dir: &Path) -> io::Result<DirectoryDurability> {
        StdFs.sync_dir(dir)
    }

    fn list_dir(&mut self, dir: &Path) -> io::Result<Vec<OsString>> {
        StdFs.list_dir(dir)
    }

    fn rename_replace(&mut self, from: &Path, to: &Path) -> io::Result<()> {
        if let RootFault::Rename = self {
            return Err(io::Error::other("injected rename fault"));
        }
        StdFs.rename_replace(from, to)
    }
}

/// A fresh temporary root directory, cleared first and removed by `Drop for Fixture`.
fn temp_root() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "wss-gate3c-root-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    root
}

/// A provisioned, unlocked provider with one epoch key and a root directory with both slots.
struct Fixture {
    root_dir: PathBuf,
    provider: MemoryKeyProvider,
    scope: InstallationScopeId,
    key_ref: RootKeyRefV1,
}

impl Fixture {
    fn new() -> Self {
        let root_dir = temp_root().join("authority");
        for slot in ["slot-a", "slot-b"] {
            fs::create_dir_all(root_dir.join(slot)).unwrap();
        }
        let mut provider = MemoryKeyProvider::new();
        let scope = provider.read_or_provision_installation_scope().unwrap();
        let key_ref = provider.provision_epoch_key(1).unwrap();
        provider.unlock().unwrap();
        Fixture {
            root_dir,
            provider,
            scope,
            key_ref,
        }
    }

    fn layout(&self) -> RootLayout<'_> {
        RootLayout {
            root_dir: &self.root_dir,
        }
    }

    /// A `COMMITTED` root of `generation` under this fixture's route.
    fn root(&self, generation: u64) -> RootBody {
        RootBody {
            root_generation: generation,
            active_key_epoch: 1,
            root_key_ref_digest: self.key_ref.digest(),
            marker_set_digest: [generation as u8; 32],
            catalog_set_digest: [0x11; 32],
            key_epoch_set_digest: [0x22; 32],
            commit_evidence: RootCommitEvidence {
                operation_id: format!("root-op-{generation}"),
                fencing_generation: 0,
                state: RootCommitState::Committed,
            },
            live_migration: None,
        }
    }

    fn commit(
        &mut self,
        fs: &mut impl worldscript_secure_storage::DurableFs,
        generation: u64,
    ) -> Result<(), RootStoreError> {
        let root = self.root(generation);
        let root_dir = self.root_dir.clone();
        let request = RootCommitRequest {
            scope: &self.scope,
            root: &root,
            root_key_ref: &self.key_ref,
        };
        commit_root(
            fs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            request,
        )
        .map(|_| ())
    }

    fn recover(&mut self) -> RootRecovery {
        let root_dir = self.root_dir.clone();
        recover_root(
            &mut StdFs,
            &mut self.provider,
            RootLayout {
                root_dir: &root_dir,
            },
        )
        .unwrap()
    }

    /// The committed root's generation as cold start authenticates it.
    fn loaded_generation(&self) -> Result<Option<u64>, RootStoreError> {
        load_committed_root(&mut StdFs, &self.provider, self.layout())
            .map(|view| view.map(|view| view.root.root_generation))
    }

    fn slot_file(&self, slot: &str, generation: u64) -> PathBuf {
        self.root_dir
            .join(slot)
            .join(format!("generation-{generation}.wsr1"))
    }

    fn pointer(&self) -> Option<RootPointer> {
        let bytes = fs::read(self.root_dir.join("pointer")).ok()?;
        RootPointer::decode(&bytes).ok()
    }

    fn rejected_in(&self, slot: &str) -> usize {
        names(&self.root_dir.join(slot))
            .iter()
            .filter(|name| name.contains(".rejected-"))
            .count()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(parent) = self.root_dir.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}

fn names(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect()
}

fn flip_last_byte(path: &Path) {
    let mut bytes = fs::read(path).unwrap();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    fs::write(path, bytes).unwrap();
}

#[test]
fn roots_commit_alternating_slots_and_cold_start_authenticates_the_newest() {
    let mut fixture = Fixture::new();
    assert_eq!(fixture.loaded_generation(), Ok(None));
    fixture.commit(&mut StdFs, 1).unwrap();
    fixture.commit(&mut StdFs, 2).unwrap();
    assert_eq!(fixture.loaded_generation(), Ok(Some(2)));
    let pointer = fixture.pointer().unwrap();
    let anchor = fixture.provider.read_root_anchor_state().unwrap();
    let committed = anchor.committed_root.unwrap();
    assert_eq!(
        (
            pointer.slot,
            pointer.root_generation,
            committed.root_slot,
            anchor.committed_floor
        ),
        (RootSlot::B, 2, RootSlot::B, 2)
    );
    assert!(fixture.slot_file("slot-a", 1).exists() && fixture.slot_file("slot-b", 2).exists());
}

#[test]
fn invalid_roots_are_refused_before_any_durable_write() {
    let mut fixture = Fixture::new();
    let not_next = fixture.commit(&mut StdFs, 2);
    let mut foreign_route = fixture.root(1);
    foreign_route.root_key_ref_digest = [0; 32];
    let mut not_committed = fixture.root(1);
    not_committed.commit_evidence.state = RootCommitState::NotCommitted;
    let root_dir = fixture.root_dir.clone();
    let mut attempt = |root: &RootBody| {
        let request = RootCommitRequest {
            scope: &fixture.scope,
            root,
            root_key_ref: &fixture.key_ref,
        };
        commit_root(
            &mut StdFs,
            &mut fixture.provider,
            RootLayout {
                root_dir: &root_dir,
            },
            request,
        )
        .map(|_| ())
    };
    let refusals = [not_next, attempt(&foreign_route), attempt(&not_committed)];
    assert_eq!(
        refusals,
        [
            Err(RootStoreError::GenerationNotNext),
            Err(RootStoreError::KeyRouteMismatch),
            Err(RootStoreError::EvidenceMismatch),
        ]
    );
    let anchor = fixture.provider.read_root_anchor_state().unwrap();
    assert!(anchor.prepared_root_commit.is_none() && anchor.committed_root.is_none());
    assert!(names(&fixture.root_dir.join("slot-a")).is_empty());
}

#[test]
fn a_preparation_without_a_target_slot_is_discarded() {
    let mut fixture = Fixture::new();
    // C lands, but the caller sees a failure: no slot was written.
    fixture
        .provider
        .inject(Fault::AfterPersist(AnchorOp::Prepare));
    assert!(matches!(
        fixture.commit(&mut StdFs, 1),
        Err(RootStoreError::Anchor(KeyProviderError::Unavailable))
    ));
    assert_eq!(
        fixture.loaded_generation(),
        Err(RootStoreError::PreparationPending)
    );
    assert_eq!(fixture.recover(), RootRecovery::Discarded);
    fixture.commit(&mut StdFs, 1).unwrap();
    assert_eq!(fixture.loaded_generation(), Ok(Some(1)));
}

#[test]
fn a_complete_slot_whose_pointer_never_moved_is_completed_forward() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    // E1 durable, E2 fails: the pointer temporary cannot be created in the root directory.
    let mut fault = RootFault::CreateIn(fixture.root_dir.clone());
    assert!(matches!(
        fixture.commit(&mut fault, 2),
        Err(RootStoreError::Io { .. })
    ));
    assert_eq!(fixture.pointer().unwrap().root_generation, 1);
    assert_eq!(
        fixture.recover(),
        RootRecovery::Completed { root_generation: 2 }
    );
    assert_eq!(fixture.loaded_generation(), Ok(Some(2)));
    assert_eq!(fixture.pointer().unwrap().root_generation, 2);
}

#[test]
fn a_moved_pointer_without_the_anchor_commit_is_completed_forward() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    // E2 durable, F rejected: readers still use generation 1 until recovery.
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Commit));
    assert!(fixture.commit(&mut StdFs, 2).is_err());
    assert_eq!(fixture.pointer().unwrap().root_generation, 2);
    let anchor = fixture.provider.read_root_anchor_state().unwrap();
    assert_eq!(anchor.committed_floor, 1);
    assert_eq!(
        fixture.recover(),
        RootRecovery::Completed { root_generation: 2 }
    );
    assert_eq!(fixture.loaded_generation(), Ok(Some(2)));
}

#[test]
fn an_ambiguous_anchor_commit_that_landed_needs_no_recovery() {
    let mut fixture = Fixture::new();
    fixture
        .provider
        .inject(Fault::AfterPersist(AnchorOp::Commit));
    assert!(fixture.commit(&mut StdFs, 1).is_err());
    assert_eq!(fixture.recover(), RootRecovery::NothingPending);
    assert_eq!(fixture.loaded_generation(), Ok(Some(1)));
}

#[test]
fn a_tampered_target_slot_is_relocated_and_the_preparation_discarded() {
    let mut fixture = Fixture::new();
    let mut fault = RootFault::CreateIn(fixture.root_dir.clone());
    assert!(fixture.commit(&mut fault, 1).is_err());
    flip_last_byte(&fixture.slot_file("slot-a", 1));
    assert_eq!(fixture.recover(), RootRecovery::Discarded);
    assert_eq!(fixture.rejected_in("slot-a"), 1, "the bytes are kept");
    assert_eq!(fixture.loaded_generation(), Ok(None));
    // The generation name is free again for the retry.
    fixture.commit(&mut StdFs, 1).unwrap();
    assert_eq!(fixture.loaded_generation(), Ok(Some(1)));
}

#[test]
fn cold_start_fails_closed_on_a_missing_or_tampered_committed_slot() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    let slot = fixture.slot_file("slot-a", 1);
    let original = fs::read(&slot).unwrap();
    flip_last_byte(&slot);
    let tampered = fixture.loaded_generation();
    fs::remove_file(&slot).unwrap();
    let missing = fixture.loaded_generation();
    assert_eq!(
        (tampered, missing),
        (
            Err(RootStoreError::RecoveryRequired(
                RootRecoveryReason::CommittedSlotMismatch
            )),
            Err(RootStoreError::RecoveryRequired(
                RootRecoveryReason::CommittedSlotMissing
            )),
        )
    );
    fs::write(&slot, original).unwrap();
    assert_eq!(fixture.loaded_generation(), Ok(Some(1)));
}

#[test]
fn cold_start_repairs_a_stale_or_missing_pointer_to_the_anchor_root() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    fixture.commit(&mut StdFs, 2).unwrap();
    let pointer_file = fixture.root_dir.join("pointer");
    // A pointer naming the older root is recoverable state: the anchor wins and it is repaired.
    let stale = RootPointer {
        slot: RootSlot::A,
        root_generation: 1,
        root_digest: [0; 32],
    };
    fs::write(&pointer_file, stale.encode().unwrap()).unwrap();
    let repaired = load_committed_root(&mut StdFs, &fixture.provider, fixture.layout()).unwrap();
    fs::remove_file(&pointer_file).unwrap();
    let recreated = load_committed_root(&mut StdFs, &fixture.provider, fixture.layout()).unwrap();
    let flags = (
        repaired.map(|view| view.pointer_repaired),
        recreated.map(|view| view.pointer_repaired),
        fixture.pointer().map(|pointer| pointer.root_generation),
    );
    assert_eq!(flags, (Some(true), Some(true), Some(2)));
}

#[test]
fn a_moved_pointer_to_an_unproven_target_fails_closed_and_touches_nothing() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    // E2 durable, F rejected; then the target slot is tampered with.
    fixture
        .provider
        .inject(Fault::BeforePersist(AnchorOp::Commit));
    assert!(fixture.commit(&mut StdFs, 2).is_err());
    let target = fixture.slot_file("slot-b", 2);
    flip_last_byte(&target);
    let root_dir = fixture.root_dir.clone();
    let result = recover_root(
        &mut StdFs,
        &mut fixture.provider,
        RootLayout {
            root_dir: &root_dir,
        },
    );
    assert_eq!(
        result,
        Err(RootStoreError::RecoveryRequired(
            RootRecoveryReason::PointerNamesUnprovenTarget
        ))
    );
    let anchor = fixture.provider.read_root_anchor_state().unwrap();
    let untouched = (
        target.exists(),
        fixture.rejected_in("slot-b"),
        anchor.committed_floor,
    );
    assert_eq!(untouched, (true, 0, 1), "preserved, nothing decided");
}

#[test]
fn a_root_for_another_installation_scope_is_refused() {
    let mut fixture = Fixture::new();
    let other = InstallationScopeId::from_random_bits([3u8; 16]);
    let root = fixture.root(1);
    let root_dir = fixture.root_dir.clone();
    let request = RootCommitRequest {
        scope: &other,
        root: &root,
        root_key_ref: &fixture.key_ref,
    };
    let result = commit_root(
        &mut StdFs,
        &mut fixture.provider,
        RootLayout {
            root_dir: &root_dir,
        },
        request,
    );
    assert_eq!(result.map(|_| ()), Err(RootStoreError::ScopeMismatch));
}

#[test]
fn a_failed_atomic_pointer_rename_is_completed_forward() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    assert!(matches!(
        fixture.commit(&mut RootFault::Rename, 2),
        Err(RootStoreError::Io { .. })
    ));
    let leftovers = names(&fixture.root_dir)
        .into_iter()
        .filter(|name| name.starts_with("pointer.tmp-"))
        .count();
    assert_eq!(leftovers, 0, "the pointer temporary is dropped");
    assert_eq!(
        fixture.recover(),
        RootRecovery::Completed { root_generation: 2 }
    );
    assert_eq!(fixture.loaded_generation(), Ok(Some(2)));
}

#[test]
fn a_discarded_preparation_repairs_the_pointer_to_the_committed_root() {
    let mut fixture = Fixture::new();
    fixture.commit(&mut StdFs, 1).unwrap();
    // C lands for generation 2, then the pointer is lost before recovery.
    fixture
        .provider
        .inject(Fault::AfterPersist(AnchorOp::Prepare));
    assert!(fixture.commit(&mut StdFs, 2).is_err());
    fs::remove_file(fixture.root_dir.join("pointer")).unwrap();
    assert_eq!(fixture.recover(), RootRecovery::Discarded);
    assert_eq!(
        fixture.pointer().map(|pointer| pointer.root_generation),
        Some(1)
    );
}
