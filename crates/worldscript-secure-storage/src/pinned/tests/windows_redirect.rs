//! Windows: the redirections that the sharing rule does not prevent, and names that a listing returns.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::os::windows::ffi::OsStringExt;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE,
};
use windows_sys::Win32::System::IO::DeviceIoControl;

use super::{link_to_dir, Scratch};
use crate::pinned::{PinnedDir, PinnedError};

const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;
const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;

/// The mount-point reparse data for a junction to `target`.
fn mount_point_data(target: &Path) -> Vec<u8> {
    let target = fs::canonicalize(target).unwrap();
    let text = target
        .to_str()
        .unwrap()
        .trim_start_matches(r"\\?\")
        .to_owned();
    let substitute: Vec<u16> = format!(r"\??\{text}").encode_utf16().collect();
    let substitute_bytes = u16::try_from(substitute.len() * 2).unwrap();
    // Four u16 fields, then the path buffer: the substitute name and an empty print name, each ended by
    // a NUL.
    let data_length = 8 + substitute_bytes + 2 + 2;
    let mut data = Vec::new();
    data.extend_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    for field in [data_length, 0, 0, substitute_bytes, substitute_bytes + 2, 0] {
        data.extend_from_slice(&field.to_le_bytes());
    }
    for unit in substitute {
        data.extend_from_slice(&unit.to_le_bytes());
    }
    data.extend_from_slice(&[0, 0, 0, 0]);
    data
}

/// Turns the empty directory `dir` into a junction to `target` in place: not renamed, not deleted, the
/// same object, which a handle that shares writes does not prevent.
#[allow(unsafe_code)]
fn convert_in_place(dir: &Path, target: &Path) {
    let data = mount_point_data(target);
    let writer = OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(dir)
        .unwrap();
    let mut returned = 0u32;
    // SAFETY: `writer` keeps the handle open for the call; `data` is a readable buffer of exactly the
    // length passed, and no output buffer or overlapped structure is used.
    let success = unsafe {
        DeviceIoControl(
            writer.as_raw_handle() as HANDLE,
            FSCTL_SET_REPARSE_POINT,
            data.as_ptr().cast(),
            u32::try_from(data.len()).unwrap(),
            std::ptr::null_mut(),
            0,
            &mut returned,
            std::ptr::null_mut(),
        )
    };
    assert_ne!(success, 0, "{}", std::io::Error::last_os_error());
}

#[test]
fn a_directory_turned_into_a_junction_in_place_reaches_nothing_through_it() {
    let scratch = Scratch::new("win-convert");
    let (root, aside) = (scratch.root(), scratch.aside());
    let target = aside.join("target");
    fs::create_dir_all(target.join("child")).unwrap();
    fs::write(target.join("inside"), b"foreign").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let before = pinned.entries(4);
    convert_in_place(&root, &target);
    assert_eq!(
        (
            before,
            pinned.entries(4),
            pinned.open_dir("child").map(|_| ()),
            pinned.open_file("inside").map(|_| ()),
            pinned.entry_kind("inside")
        ),
        (
            Ok(Vec::new()),
            Err(PinnedError::Redirected),
            Err(PinnedError::Redirected),
            Err(PinnedError::Redirected),
            Err(PinnedError::Redirected)
        )
    );
}

#[test]
fn a_child_that_a_redirect_leads_to_is_refused_by_its_real_path_alone() {
    let scratch = Scratch::new("win-real-path");
    let aside = scratch.aside();
    let real = aside.join("real");
    fs::create_dir_all(real.join("child")).unwrap();
    fs::write(real.join("inside"), b"inside").unwrap();
    let link = scratch.path().join("link");
    link_to_dir(&real, &link);
    // The directory is a plain one; only the path it is joined by now goes through a link, as it would
    // after an in-place conversion that was undone before the check of the directory itself.
    let mut pinned = PinnedDir::open_root(&real).unwrap();
    pinned.path = link;
    let refused = Err(PinnedError::Redirected);
    assert_eq!(
        (
            pinned.open_dir("child").map(|_| ()),
            pinned.open_file("inside").map(|_| ())
        ),
        (refused, refused)
    );
}

#[test]
fn a_name_with_an_unpaired_surrogate_that_a_listing_returns_can_be_opened() {
    let scratch = Scratch::new("win-surrogate");
    let root = scratch.root();
    let odd = OsString::from_wide(&[0x61, 0xD800, 0x62]);
    fs::write(root.join(&odd), b"odd").unwrap();
    let pinned = PinnedDir::open_root(&root).unwrap();
    let listed = pinned.entries(4).unwrap();
    let read = pinned
        .open_file(&listed[0])
        .and_then(|mut file| file.read_at_most(8));
    assert_eq!((listed, read), (vec![odd], Ok(b"odd".to_vec())));
}
