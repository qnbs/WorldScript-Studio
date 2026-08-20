//! Wave 2 PR B — strangler proof point: wires one real Tauri command to the renderer-neutral
//! `worldscript-project` Rust Core crate (`docs/native/CORE-MIGRATION-LEDGER.md`).
//!
//! Backend-only. No frontend call site exists yet — `services/desktopPlatform.ts` and
//! `services/fs/projectFsStore.ts`/`services/storageService.ts`'s dispatch are untouched by this
//! PR. The point of this command is proving the Tauri <-> Rust Core boundary compiles, links, and
//! runs correctly before any UI wiring is attempted.

use serde::Serialize;
use worldscript_project::{migrate_to_latest, parse_envelope, validate};

/// Structured verdict for a project envelope JSON string, mirroring the pipeline a future
/// desktop load path would run: parse -> migrate to current schema -> validate.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectValidationResult {
    pub valid: bool,
    /// The schema version after migration, when parsing succeeded. Absent on parse failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parses, migrates, and validates a `ProjectEnvelope` JSON string via the `worldscript-project`
/// crate. Never returns `Err` — parse/migrate/validate failures are reported as a structured
/// `ProjectValidationResult { valid: false, error: Some(..) }`, matching the honest-failure
/// convention `commands::task_supervisor` already established for this codebase.
#[tauri::command]
pub fn worldscript_project_validate(project_json: String) -> ProjectValidationResult {
    let envelope = match parse_envelope(&project_json) {
        Ok(envelope) => envelope,
        Err(e) => {
            return ProjectValidationResult {
                valid: false,
                schema_version: None,
                error: Some(e.to_string()),
            }
        }
    };

    let migrated = match migrate_to_latest(envelope) {
        Ok(migrated) => migrated,
        Err(e) => {
            return ProjectValidationResult {
                valid: false,
                schema_version: None,
                error: Some(e.to_string()),
            }
        }
    };

    match validate(&migrated.project) {
        Ok(()) => ProjectValidationResult {
            valid: true,
            schema_version: Some(migrated.schema_version),
            error: None,
        },
        Err(e) => ProjectValidationResult {
            valid: false,
            schema_version: Some(migrated.schema_version),
            error: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_current_schema_project_passes() {
        let json = r#"{
            "schemaVersion": 2,
            "project": {
                "title": "T", "logline": "L",
                "characters": [], "worlds": [], "manuscript": []
            }
        }"#;
        let result = worldscript_project_validate(json.to_string());
        assert_eq!(
            result,
            ProjectValidationResult {
                valid: true,
                schema_version: Some(2),
                error: None,
            }
        );
    }

    #[test]
    fn v1_project_is_migrated_before_validation() {
        let json = r#"{
            "schemaVersion": 1,
            "project": {
                "title": "Old", "logline": "L",
                "characters": [], "worlds": [], "manuscript": []
            }
        }"#;
        let result = worldscript_project_validate(json.to_string());
        assert!(result.valid);
        assert_eq!(result.schema_version, Some(2));
    }

    #[test]
    fn corrupt_json_reports_structured_failure_not_a_panic() {
        let result = worldscript_project_validate("{ not json".to_string());
        assert!(!result.valid);
        assert_eq!(result.schema_version, None);
        assert!(result.error.is_some());
    }

    #[test]
    fn duplicate_character_ids_fail_validation_with_schema_version_present() {
        let json = r#"{
            "schemaVersion": 2,
            "project": {
                "title": "T", "logline": "L",
                "characters": [
                    {"id": "c1", "name": "A"},
                    {"id": "c1", "name": "B"}
                ],
                "worlds": [], "manuscript": []
            }
        }"#;
        let result = worldscript_project_validate(json.to_string());
        assert!(!result.valid);
        assert_eq!(result.schema_version, Some(2));
        assert!(result.error.unwrap().contains("c1"));
    }
}
