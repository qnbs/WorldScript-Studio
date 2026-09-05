//! Production persisted-project schema-version classification (issue #553,
//! `docs/native/PROJECT-CORE-COMPATIBILITY-CONTRACT.md` section 2 — admitted, `ADMITTED = YES`).
//!
//! Distinct from [`crate::envelope::CURRENT_SCHEMA_VERSION`], which versions the synthetic Wave 2
//! harness proof (`ProjectEnvelope`/`V1ToV2`), not the real persisted project document. This
//! module implements the raw/header classification only (contract section 2.4), mirroring
//! `features/project/projectSchemaVersion.ts` on the TypeScript side for permanent cross-renderer
//! parity — it does not implement the typed `ProjectData` graduated validation or wire into any
//! ingress path.

use serde_json::Value;
use std::collections::HashSet;

/// First production version. Fresh; not derived from the Rust harness's synthetic v1/v2 proof.
pub const PROJECT_SCHEMA_V1: u64 = 1;

/// The version this build currently writes and treats as non-legacy, up to date.
pub const CURRENT_PROJECT_SCHEMA_VERSION: u64 = PROJECT_SCHEMA_V1;

/// Versions with a registered migration step into the next version, keyed by source version.
/// Empty today: `PROJECT_SCHEMA_V1` is the only defined version. Add a source-version entry the
/// day a second real schema version is defined and its migration is registered.
fn supported_older_source_versions() -> HashSet<u64> {
    HashSet::new()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectVersionClassification {
    LegacyUnversioned,
    SupportedOlder,
    UnsupportedOlder,
    Current,
    Future,
    Malformed,
}

/// Scans raw JSON text for more than one occurrence of `key` as a property name at the outermost
/// object level. `serde_json::Value`'s default map (like JS's `JSON.parse`) silently keeps only
/// the last occurrence of a duplicate key, so detecting a duplicate must run on the raw text.
///
/// Assumes `raw_text` already parsed successfully as a JSON object (caller's responsibility);
/// this is a key-occurrence count over already-known-valid JSON syntax, not a general validator.
fn has_duplicate_top_level_key(raw_text: &str, key: &str) -> bool {
    let quoted = format!("\"{key}\"");
    let bytes = raw_text.as_bytes();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut occurrences = 0u32;
    let mut i = 0usize;

    while i < bytes.len() {
        let ch = bytes[i] as char;
        if in_string {
            if escape_next {
                escape_next = false;
            } else if ch == '\\' {
                escape_next = true;
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if ch == '"' {
            in_string = true;
            if depth == 1 && raw_text[i..].starts_with(&quoted) {
                let mut j = i + quoted.len();
                while j < raw_text.len() && raw_text.as_bytes()[j].is_ascii_whitespace() {
                    j += 1;
                }
                if raw_text.as_bytes().get(j) == Some(&b':') {
                    occurrences += 1;
                    if occurrences > 1 {
                        return true;
                    }
                }
            }
            i += 1;
            continue;
        }
        match ch {
            '{' | '[' => depth += 1,
            '}' | ']' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    false
}

/// Classifies raw persisted-project JSON text by its `schemaVersion`, per contract section 2.4:
/// a minimal raw/header parse extracting only `schemaVersion`, performed *before* any full typed
/// parse — so a `FUTURE` document with a breaking shape change still classifies `FUTURE`, never
/// `Malformed`. Field absence, present-invalid values, and duplicate keys are handled per the
/// contract's accepted value grammar.
pub fn classify_raw_project_version(raw_text: &str) -> ProjectVersionClassification {
    let parsed: Value = match serde_json::from_str(raw_text) {
        Ok(value) => value,
        Err(_) => return ProjectVersionClassification::Malformed,
    };

    let object = match parsed.as_object() {
        Some(object) => object,
        None => return ProjectVersionClassification::Malformed,
    };

    if has_duplicate_top_level_key(raw_text, "schemaVersion") {
        return ProjectVersionClassification::Malformed;
    }

    let Some(value) = object.get("schemaVersion") else {
        return ProjectVersionClassification::LegacyUnversioned;
    };

    // Parity note: JS's `JSON.parse` collapses `1` and `1.0` into the same number, so
    // `Number.isInteger(1.0)` is `true` on the TS side — this must classify `1.0` as valid too,
    // not reject it merely because `serde_json` parses a decimal-point literal as its `Float`
    // variant. Compare by numeric value, never by which serde_json variant parsed it as.
    let Some(numeric) = value.as_f64() else {
        return ProjectVersionClassification::Malformed;
    };
    if !numeric.is_finite() || numeric.fract() != 0.0 || numeric < 0.0 {
        return ProjectVersionClassification::Malformed;
    }
    let version = numeric as u64;

    if version < CURRENT_PROJECT_SCHEMA_VERSION {
        return if supported_older_source_versions().contains(&version) {
            ProjectVersionClassification::SupportedOlder
        } else {
            ProjectVersionClassification::UnsupportedOlder
        };
    }
    if version == CURRENT_PROJECT_SCHEMA_VERSION {
        return ProjectVersionClassification::Current;
    }
    ProjectVersionClassification::Future
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_schema_version_is_legacy_unversioned() {
        assert_eq!(
            classify_raw_project_version(r#"{"title": "Old Project"}"#),
            ProjectVersionClassification::LegacyUnversioned
        );
    }

    #[test]
    fn current_version_is_current() {
        let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}}}"#);
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Current
        );
    }

    #[test]
    fn higher_version_is_future() {
        let raw = format!(
            r#"{{"schemaVersion": {}}}"#,
            CURRENT_PROJECT_SCHEMA_VERSION + 1
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Future
        );
    }

    #[test]
    fn future_document_classifies_future_even_with_breaking_shape() {
        let raw = format!(
            r#"{{"schemaVersion": {}, "title": 12345, "brandNewRequiredField": "unknown"}}"#,
            CURRENT_PROJECT_SCHEMA_VERSION + 1
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Future
        );
    }

    #[test]
    fn unregistered_lower_version_is_unsupported_older() {
        assert_eq!(
            classify_raw_project_version(r#"{"schemaVersion": 0}"#),
            ProjectVersionClassification::UnsupportedOlder
        );
    }

    #[test]
    fn integer_valued_float_literal_matches_ts_json_parse_semantics() {
        // QNBS-v3: JS's JSON.parse collapses 1 and 1.0 into the same number; serde_json parses "1.0" as its Float variant, so this must compare by value, not representation, for TS/Rust parity.
        let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}.0}}"#);
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Current
        );
    }

    #[test]
    fn present_invalid_values_are_malformed() {
        for raw in [
            r#"{"schemaVersion": "1"}"#,
            r#"{"schemaVersion": null}"#,
            r#"{"schemaVersion": 1.5}"#,
            r#"{"schemaVersion": -1}"#,
            r#"{"schemaVersion": true}"#,
        ] {
            assert_eq!(
                classify_raw_project_version(raw),
                ProjectVersionClassification::Malformed,
                "expected MALFORMED for {raw}"
            );
        }
    }

    #[test]
    fn duplicate_top_level_keys_are_malformed_regardless_of_last_key_wins() {
        let raw = format!(
            r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "title": "x", "schemaVersion": {}}}"#,
            CURRENT_PROJECT_SCHEMA_VERSION + 5
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Malformed
        );
    }

    #[test]
    fn nested_field_of_same_name_is_not_a_duplicate() {
        let raw = format!(
            r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "nested": {{"schemaVersion": 999}}}}"#
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Current
        );
    }

    #[test]
    fn string_value_containing_key_text_is_not_a_duplicate() {
        let raw = format!(
            r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "note": "the field is called \"schemaVersion\" here"}}"#
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Current
        );
    }

    #[test]
    fn unparseable_json_is_malformed() {
        assert_eq!(
            classify_raw_project_version("{not valid json"),
            ProjectVersionClassification::Malformed
        );
    }

    #[test]
    fn top_level_array_is_malformed() {
        assert_eq!(
            classify_raw_project_version("[1,2,3]"),
            ProjectVersionClassification::Malformed
        );
    }

    #[test]
    fn top_level_primitive_is_malformed() {
        assert_eq!(
            classify_raw_project_version("\"just a string\""),
            ProjectVersionClassification::Malformed
        );
        assert_eq!(
            classify_raw_project_version("42"),
            ProjectVersionClassification::Malformed
        );
        assert_eq!(
            classify_raw_project_version("null"),
            ProjectVersionClassification::Malformed
        );
    }
}
