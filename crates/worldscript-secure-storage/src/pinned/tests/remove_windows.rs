//! Windows removal: while the authenticated handle is held the name cannot be rebound and the bytes
//! cannot be written, a competing handle makes the removal fail closed, and the delete is a disposition
//! of the authenticated handle. The counter-proof shows what a share mode that allowed writing would
//! have let through.

use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::mem::{align_of, size_of};

use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_DIR_NOT_EMPTY, ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER,
    ERROR_NOT_SUPPORTED, ERROR_SHARING_VIOLATION,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_DISPOSITION_INFO_EX, FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

use super::remove::{holds, names, removed};
use super::Scratch;
use crate::pinned::windows::{nt, removal::known_refusal};
use crate::pinned::{PinnedDir, PinnedError, RemovalOutcome, RemovalStage};

/// Whether opening `path` for writing is refused because another handle holds the file.
fn writer_is_refused(path: &std::path::Path) -> bool {
    OpenOptions::new()
        .write(true)
        .open(path)
        .is_err_and(|error| error.raw_os_error() == Some(ERROR_SHARING_VIOLATION as i32))
}

#[test]
fn while_the_authenticated_handle_is_held_the_name_cannot_be_rebound() {
    let scratch = Scratch::new("win-rebind");
    let (root, aside) = (scratch.root(), scratch.aside());
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::write(aside.join("other"), b"other").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let mut attempts = None;
    let outcome = pinned.remove_authenticated_file_observed("a", holds(b"alpha"), &mut |stage| {
        if stage == RemovalStage::Checked {
            attempts = Some((
                fs::rename(root.join("a"), aside.join("original")).is_err(),
                fs::remove_file(root.join("a")).is_err(),
                fs::rename(aside.join("other"), root.join("a")).is_err(),
            ));
        }
        Ok(())
    });
    assert_eq!(
        (
            outcome,
            attempts,
            root.join("a").exists(),
            fs::read(aside.join("other")).unwrap()
        ),
        (
            removed(),
            Some((true, true, true)),
            false,
            b"other".to_vec()
        )
    );
}

#[test]
fn nobody_can_write_to_the_file_between_the_authentication_and_the_delete() {
    let scratch = Scratch::new("win-no-writer");
    let root = scratch.root();
    let path = root.join("a");
    fs::write(&path, b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let (mut during_authentication, mut at_the_check) = (None, None);
    let outcome = pinned.remove_authenticated_file_observed(
        "a",
        |file| {
            during_authentication = Some(writer_is_refused(&path));
            Ok(file.read_at_most(8)? == b"alpha")
        },
        &mut |stage| {
            if stage == RemovalStage::Checked {
                at_the_check = Some(writer_is_refused(&path));
            }
            Ok(())
        },
    );
    assert_eq!(
        (outcome, during_authentication, at_the_check, path.exists()),
        (removed(), Some(true), Some(true), false)
    );
}

#[test]
fn counter_proof_a_handle_that_shared_write_would_let_a_writer_change_the_bytes() {
    let scratch = Scratch::new("win-shared-write");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let mut held = nt::open_relative(
        &pinned.handle,
        OsStr::new("a"),
        FILE_GENERIC_READ | DELETE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
    )
    .unwrap();
    // The write succeeds although the delete handle is held: with this share mode the bytes that were
    // authenticated could be replaced before the disposition.
    fs::write(root.join("a"), b"changed").unwrap();
    let mut seen = Vec::new();
    held.read_to_end(&mut seen).unwrap();
    assert_eq!(seen, b"changed".to_vec());
}

#[test]
fn a_writer_that_already_has_the_file_open_makes_the_removal_busy_and_changes_nothing() {
    let scratch = Scratch::new("win-busy");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    // std shares read, write and delete; what matters is that this handle can write.
    let writer = OpenOptions::new().write(true).open(root.join("a")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let outcome = pinned.remove_authenticated_file("a", |_| Ok(true));
    drop(writer);
    assert_eq!(
        (outcome, fs::read(root.join("a")).unwrap()),
        (Err(PinnedError::Busy), b"alpha".to_vec())
    );
}

#[test]
fn a_reader_that_shares_delete_does_not_stop_the_removal_and_the_name_is_free_at_once() {
    let scratch = Scratch::new("win-share-delete");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    let reader = File::open(root.join("a")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let outcome = pinned.remove_authenticated_file("a", holds(b"alpha"));
    let name_free = File::create_new(root.join("a")).is_ok();
    drop(reader);
    assert_eq!((outcome, name_free), (removed(), true));
}

#[test]
fn a_directory_is_removed_only_while_empty_and_its_name_cannot_be_rebound_meanwhile() {
    let scratch = Scratch::new("win-dir");
    let (root, aside) = (scratch.root(), scratch.aside());
    fs::create_dir(root.join("d")).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let mut rebound = None;
    let outcome = pinned.remove_empty_dir_observed("d", &mut |stage| {
        if stage == RemovalStage::Checked {
            rebound = Some(fs::rename(root.join("d"), aside.join("moved")).is_err());
        }
        Ok(())
    });
    assert_eq!(
        (outcome, rebound, root.join("d").exists()),
        (removed(), Some(true), false)
    );
}

#[test]
fn a_read_only_file_is_not_deleted_and_the_refusal_is_reported() {
    let scratch = Scratch::new("win-readonly");
    let root = scratch.root();
    let path = root.join("a");
    fs::write(&path, b"alpha").unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions.clone()).unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let outcome = pinned.remove_authenticated_file("a", holds(b"alpha"));
    // The attribute is cleared with the permissions of a file that is not read-only.
    fs::set_permissions(&path, fs::metadata(&root).unwrap().permissions()).unwrap();
    assert_eq!(
        (outcome.is_err(), fs::read(&path).unwrap()),
        (true, b"alpha".to_vec())
    );
}

#[test]
fn a_leftover_removal_is_unsupported_because_windows_creates_no_quarantine() {
    let scratch = Scratch::new("win-leftover");
    let pinned = PinnedDir::open_root(&scratch.root()).unwrap();
    assert_eq!(
        pinned.remove_leftover_file(".h1q-0", |_| Ok(true)),
        Err(PinnedError::Unsupported)
    );
}

#[test]
fn the_disposition_structure_has_the_layout_the_system_reads() {
    assert_eq!(
        (
            size_of::<FILE_DISPOSITION_INFO_EX>(),
            align_of::<FILE_DISPOSITION_INFO_EX>()
        ),
        (4, 4)
    );
}

#[test]
fn a_name_is_listed_only_if_nothing_else_was_changed() {
    let scratch = Scratch::new("win-names");
    let root = scratch.root();
    fs::write(root.join("a"), b"alpha").unwrap();
    fs::write(root.join("b"), b"beta").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let outcome: Result<RemovalOutcome, PinnedError> =
        pinned.remove_authenticated_file("a", holds(b"alpha"));
    assert_eq!(
        (outcome, names(&pinned)),
        (removed(), vec!["b".to_string()])
    );
}

#[test]
fn every_code_that_means_no_posix_delete_is_unsupported_and_other_codes_stay_errors() {
    // `ERROR_INVALID_FUNCTION` is what an older Windows or a driver answers when it does not implement
    // the information class at all; the disposition was refused and nothing was deleted, like the other two.
    let unsupported = Some(Err(PinnedError::Unsupported));
    assert_eq!(
        [
            known_refusal(Some(ERROR_DIR_NOT_EMPTY)),
            known_refusal(Some(ERROR_INVALID_PARAMETER)),
            known_refusal(Some(ERROR_NOT_SUPPORTED)),
            known_refusal(Some(ERROR_INVALID_FUNCTION)),
            known_refusal(Some(ERROR_ACCESS_DENIED)),
            known_refusal(None),
        ],
        [
            Some(Ok(RemovalOutcome::NotEmpty)),
            unsupported,
            unsupported,
            unsupported,
            None,
            None,
        ]
    );
}
