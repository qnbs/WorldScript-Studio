use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

fn validated_destination(app: &AppHandle, requested: &str) -> Result<(PathBuf, PathBuf), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app-data directory: {error}"))?
        .canonicalize()
        .map_err(|error| format!("Could not canonicalize app-data directory: {error}"))?;
    let destination = PathBuf::from(requested);
    let parent = destination
        .parent()
        .ok_or_else(|| "Durable write target has no parent directory".to_owned())?
        .canonicalize()
        .map_err(|error| format!("Could not canonicalize durable write parent: {error}"))?;
    if !parent.starts_with(&app_data) {
        return Err("Durable writes are restricted to the application data directory".to_owned());
    }
    let file_name = destination
        .file_name()
        .ok_or_else(|| "Durable write target has no file name".to_owned())?;
    Ok((parent.join(file_name), parent))
}

fn create_sibling_temp(destination: &Path) -> Result<(PathBuf, File), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Durable write target has no parent directory".to_owned())?;
    let name = destination
        .file_name()
        .ok_or_else(|| "Durable write target has no file name".to_owned())?
        .to_string_lossy();
    let epoch_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock is before the Unix epoch: {error}"))?
        .as_nanos();
    for sequence in 0..32_u8 {
        let candidate = parent.join(format!(
            "{name}.tmp-{}-{epoch_nanos}-{sequence}",
            process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create durable temporary file: {error}")),
        }
    }
    Err("Could not allocate a unique durable temporary file".to_owned())
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> Result<(), String> {
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not synchronize durable write directory: {error}"))
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn publish_replacement(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("Could not publish durable replacement: {error}"))
}

#[cfg(windows)]
fn publish_replacement(temporary: &Path, destination: &Path) -> Result<(), String> {
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // QNBS-v3: Windows needs MoveFileExW because std::fs::rename does not guarantee replacement of an existing destination there.
    let outcome = unsafe {
        MoveFileExW(
            temporary_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if outcome == 0 {
        return Err(format!(
            "Could not publish durable replacement: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn worldscript_atomic_write(app: AppHandle, path: String, data: Vec<u8>) -> Result<(), String> {
    let (destination, parent) = validated_destination(&app, &path)?;
    let (temporary, mut file) = create_sibling_temp(&destination)?;
    let result = (|| -> Result<(), String> {
        file.write_all(&data)
            .map_err(|error| format!("Could not write durable temporary file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not synchronize durable temporary file: {error}"))?;
        drop(file);
        publish_replacement(&temporary, &destination)?;
        sync_parent_directory(&parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{create_sibling_temp, publish_replacement, sync_parent_directory};
    use std::{
        fs,
        io::Write,
        path::PathBuf,
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temporary_directory() -> PathBuf {
        let epoch_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "worldscript-durable-fs-{}-{epoch_nanos}",
            process::id()
        ))
    }

    #[test]
    fn replacement_preserves_only_the_complete_new_content() {
        let parent = temporary_directory();
        fs::create_dir_all(&parent).expect("test directory should be created");
        let destination = parent.join("project.json");
        fs::write(&destination, b"old content").expect("old file should be written");

        let (temporary, mut file) =
            create_sibling_temp(&destination).expect("temp file should open");
        file.write_all(b"new content")
            .expect("new content should be written");
        file.sync_all().expect("temp file should synchronize");
        drop(file);

        // QNBS-v3: exercises replacement of an existing destination, the platform-sensitive part of the durability contract.
        publish_replacement(&temporary, &destination).expect("replacement should publish");
        sync_parent_directory(&parent).expect("parent directory should synchronize when supported");

        assert_eq!(
            fs::read(&destination).expect("published file should read"),
            b"new content"
        );
        assert!(!temporary.exists());
        fs::remove_dir_all(parent).expect("test directory should be removed");
    }
}
