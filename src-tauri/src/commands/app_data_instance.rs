//! `worldscript_app_data_admission` (#831): joins the app-data writers once per process and, when no
//! other writer is alive, reclaims the project locks a crashed writer left (see `crate::instance_lock`).
//! The storage bootstrap calls it before it admits any writer. Later calls repeat the first outcome
//! and never reclaim again, because by then this process may hold project locks of its own.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

use crate::instance_lock::{self, Joined, WriterLock};

/// Wire contract version; equals `APP_DATA_ADMISSION_CONTRACT_VERSION` in `packages/desktop-contracts`.
pub const APP_DATA_ADMISSION_CONTRACT_VERSION: &str = "1.0.0";

/// What the storage bootstrap learns; serialized as `{ contractVersion, status, reclaimed, detail? }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataAdmission {
    pub contract_version: &'static str,
    /// `exclusive`: no other writer was alive, orphans were reclaimed; `shared`: another writer is alive,
    /// nothing was removed; both may write. `unavailable`: no writers lock held, so this process must not write.
    pub status: &'static str,
    /// Orphaned project locks the first call removed; 0 unless `exclusive`.
    pub reclaimed: usize,
    /// Why the lock or the reclaim failed, for logs only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppDataAdmission {
    fn new(status: &'static str, reclaimed: usize, detail: Option<String>) -> Self {
        Self {
            contract_version: APP_DATA_ADMISSION_CONTRACT_VERSION,
            status,
            reclaimed,
            detail,
        }
    }
}

struct Admitted {
    /// Held until the process ends; dropping it would let another process in.
    _lock: Option<WriterLock>,
    outcome: AppDataAdmission,
}

/// The process-wide admission, kept in Tauri state.
#[derive(Default)]
pub struct AppDataInstance(Mutex<Option<Admitted>>);

impl AppDataInstance {
    /// Decides the admission on the first call and repeats that outcome on every later call.
    pub fn admit_once(
        &self,
        app_data: impl FnOnce() -> Result<PathBuf, String>,
    ) -> AppDataAdmission {
        let mut admitted = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(done) = admitted.as_ref() {
            return done.outcome.clone();
        }
        let (lock, outcome) = admit(app_data());
        *admitted = Some(Admitted {
            _lock: lock,
            outcome: outcome.clone(),
        });
        outcome
    }
}

fn admit(app_data: Result<PathBuf, String>) -> (Option<WriterLock>, AppDataAdmission) {
    let dir = match app_data {
        Ok(dir) => dir,
        Err(detail) => return (None, AppDataAdmission::new("unavailable", 0, Some(detail))),
    };
    match instance_lock::join_writers(&dir) {
        Ok((lock, Joined::Alone(Ok(reclaimed)))) => (
            Some(lock),
            AppDataAdmission::new("exclusive", reclaimed, None),
        ),
        Ok((lock, Joined::Alone(Err(error)))) => (
            Some(lock),
            AppDataAdmission::new("exclusive", error.removed, Some(error.to_string())),
        ),
        Ok((lock, Joined::WithOthers)) => (Some(lock), AppDataAdmission::new("shared", 0, None)),
        Err(error) => (
            None,
            AppDataAdmission::new("unavailable", 0, Some(error.to_string())),
        ),
    }
}

#[tauri::command]
pub fn worldscript_app_data_admission(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppDataInstance>,
) -> AppDataAdmission {
    state.admit_once(|| app.path().app_data_dir().map_err(|error| error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance_lock::{join_writers, PROJECT_LOCKS_DIR};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_app_data(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after 1970")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "ws-admission-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(dir.join(PROJECT_LOCKS_DIR)).expect("temp app data");
        dir
    }

    #[test]
    fn the_first_call_reclaims_and_later_calls_repeat_it_without_reclaiming() {
        let dir = temp_app_data("once");
        let locks = dir.join(PROJECT_LOCKS_DIR);
        fs::write(locks.join("crashed.lock"), b"").unwrap();
        let instance = AppDataInstance::default();
        let first = instance.admit_once(|| Ok(dir.clone()));
        assert_eq!(first, AppDataAdmission::new("exclusive", 1, None));
        // A lock this process now holds: a later call must never remove it.
        fs::write(locks.join("live.lock"), b"").unwrap();
        assert_eq!(instance.admit_once(|| Ok(dir.clone())), first);
        assert!(locks.join("live.lock").exists());
        drop(instance);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn another_holder_makes_the_admission_shared_and_removes_nothing() {
        let dir = temp_app_data("shared");
        let locks = dir.join(PROJECT_LOCKS_DIR);
        fs::write(locks.join("live.lock"), b"").unwrap();
        let other_process = join_writers(&dir).unwrap();
        let outcome = AppDataInstance::default().admit_once(|| Ok(dir.clone()));
        assert_eq!(outcome, AppDataAdmission::new("shared", 0, None));
        assert!(locks.join("live.lock").exists());
        drop(other_process);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unknown_app_data_directory_is_unavailable() {
        let outcome = AppDataInstance::default().admit_once(|| Err("no app data dir".to_string()));
        assert_eq!(
            outcome,
            AppDataAdmission::new("unavailable", 0, Some("no app data dir".to_string()))
        );
    }

    #[test]
    fn the_admission_serializes_as_the_desktop_contract_expects() {
        let json = serde_json::to_value(AppDataAdmission::new("exclusive", 2, None)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "contractVersion": "1.0.0", "status": "exclusive", "reclaimed": 2 })
        );
    }
}
