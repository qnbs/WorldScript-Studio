use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process,
    sync::{LazyLock, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    REPLACEFILE_WRITE_THROUGH,
};

static NATIVE_TEMP_OPERATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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
            "{name}.native-tmp-{}-{epoch_nanos}-{sequence}",
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
fn preserve_destination_permissions(destination: &Path, temporary: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::metadata(destination) {
        fs::set_permissions(temporary, metadata.permissions()).map_err(|error| {
            format!("Could not preserve durable destination permissions: {error}")
        })?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn preserve_destination_permissions(_destination: &Path, _temporary: &Path) -> Result<(), String> {
    Ok(())
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
    if destination.exists() {
        // QNBS-v3: ReplaceFileW preserves the existing destination's security descriptor when replacing an existing file.
        let outcome = unsafe {
            ReplaceFileW(
                destination_wide.as_ptr(),
                temporary_wide.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if outcome != 0 {
            return Ok(());
        }
        return Err(format!(
            "Could not publish durable replacement: {}",
            std::io::Error::last_os_error()
        ));
    }
    // QNBS-v3: MoveFileExW publishes new destinations with write-through semantics; ReplaceFileW above handles existing destinations safely.
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

fn durable_write(app: AppHandle, path: String, data: Vec<u8>) -> Result<(), String> {
    let _operation_guard = NATIVE_TEMP_OPERATION_LOCK
        .lock()
        .map_err(|_| "Durable-write coordination lock is poisoned".to_owned())?;
    let (destination, parent) = validated_destination(&app, &path)?;
    let (temporary, mut file) = create_sibling_temp(&destination)?;
    let result = (|| -> Result<(), String> {
        preserve_destination_permissions(&destination, &temporary)?;
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

fn decode_percent_encoded_path(encoded: &str) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(encoded.len());
    let raw = encoded.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' {
            if index + 2 >= raw.len() {
                return Err("Durable write path contains an incomplete percent escape".to_owned());
            }
            let hex = std::str::from_utf8(&raw[index + 1..index + 3])
                .map_err(|_| "Durable write path contains invalid percent encoding".to_owned())?;
            let byte = u8::from_str_radix(hex, 16)
                .map_err(|_| "Durable write path contains invalid percent encoding".to_owned())?;
            bytes.push(byte);
            index += 3;
        } else {
            bytes.push(raw[index]);
            index += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| "Durable write path is not valid UTF-8".to_owned())
}

fn is_native_temp_file_name(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    let Some((_, suffix)) = name.rsplit_once(".native-tmp-") else {
        return false;
    };
    let mut segments = suffix.split('-');
    let (Some(process_id), Some(epoch_nanos), Some(sequence), None) = (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) else {
        return false;
    };
    !process_id.is_empty()
        && !epoch_nanos.is_empty()
        && !sequence.is_empty()
        && process_id.bytes().all(|byte| byte.is_ascii_digit())
        && epoch_nanos.bytes().all(|byte| byte.is_ascii_digit())
        && sequence.bytes().all(|byte| byte.is_ascii_digit())
}

#[tauri::command]
pub async fn worldscript_atomic_write(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let encoded_path = request
        .headers()
        .get("x-worldscript-path")
        .ok_or_else(|| "Durable write is missing its target path".to_owned())?
        .to_str()
        .map_err(|_| "Durable write target path header is invalid".to_owned())?;
    let path = decode_percent_encoded_path(encoded_path)?;
    let data = request.body().to_vec();
    tauri::async_runtime::spawn_blocking(move || durable_write(app, path, data))
        .await
        .map_err(|error| format!("Durable write task failed: {error}"))?
}

fn cleanup_native_temp_files(dir: &Path, depth: usize) -> Result<(), String> {
    if depth > 6 || !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)
        .map_err(|error| format!("Could not read durable temp directory: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect durable temp entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect durable temp type: {error}"))?;
        if file_type.is_dir() {
            cleanup_native_temp_files(&path, depth + 1)?;
        } else if file_type.is_file() && path.file_name().is_some_and(is_native_temp_file_name) {
            fs::remove_file(&path)
                .map_err(|error| format!("Could not remove native orphaned temp file: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn worldscript_cleanup_atomic_temps(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _operation_guard = NATIVE_TEMP_OPERATION_LOCK
            .lock()
            .map_err(|_| "Durable-write coordination lock is poisoned".to_owned())?;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve app-data directory: {error}"))?;
        cleanup_native_temp_files(&app_data, 0)
    })
    .await
    .map_err(|error| format!("Native temp cleanup task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        create_sibling_temp, is_native_temp_file_name, publish_replacement, sync_parent_directory,
    };
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

    #[test]
    fn native_temp_cleanup_matches_only_generated_name_shape() {
        assert!(is_native_temp_file_name(
            "project.json.native-tmp-42-1723560000000000000-0".as_ref()
        ));
        assert!(!is_native_temp_file_name(
            "notes.native-tmp-user-content.bin".as_ref()
        ));
        assert!(!is_native_temp_file_name(
            "project.json.native-tmp-42-100-0-copy".as_ref()
        ));
    }
}
