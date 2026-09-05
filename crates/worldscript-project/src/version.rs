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

/// Advances past a JSON string literal starting at `start` (byte index of the opening `"`).
/// Returns the byte index just past the matching closing `"`. Does not decode escapes — an
/// escaped character (including an escaped quote, `\"`) is always exactly 2 bytes starting with
/// `\`, so unconditionally skipping 2 bytes on any backslash can never mistake an escaped quote
/// for the literal's real terminator, regardless of which character is escaped.
fn skip_json_string_literal(bytes: &[u8], start: usize) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return i + 1,
            _ => i += 1,
        }
    }
    i
}

/// Decodes a JSON string literal's escape sequences by delegating to `serde_json`'s own string
/// grammar, rather than reimplementing Unicode escape decoding (including surrogate pairs) by
/// hand.
fn decode_json_string_literal(literal_with_quotes: &str) -> Option<String> {
    serde_json::from_str::<String>(literal_with_quotes).ok()
}

/// Collects the *decoded* name of every JSON object key at the outermost (depth-1) object level
/// of `raw_text`, in source order — decoded per JSON string-escape rules, not raw source
/// spelling, so an escaped key like `"schemaVersion"` is correctly recognized as
/// `schemaVersion` rather than silently missed by a literal-byte comparison. Assumes `raw_text`
/// already parsed successfully as a JSON object (caller's responsibility).
fn top_level_object_keys(raw_text: &str) -> Vec<String> {
    let bytes = raw_text.as_bytes();
    let mut depth: i32 = 0;
    let mut keys = Vec::new();
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'"' {
            let string_start = i;
            i = skip_json_string_literal(bytes, i);
            if depth == 1 {
                let mut j = i;
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if bytes.get(j) == Some(&b':') {
                    if let Some(decoded) = decode_json_string_literal(&raw_text[string_start..i]) {
                        keys.push(decoded);
                    }
                }
            }
            continue;
        }
        match bytes[i] {
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    keys
}

/// True when `key` appears more than once as a property name at the outermost object level of
/// `raw_text`. `serde_json::Value`'s default map (like JS's `JSON.parse`) silently keeps only the
/// last occurrence of a duplicate key, so detecting a duplicate must run on the raw text.
fn has_duplicate_top_level_key(raw_text: &str, key: &str) -> bool {
    top_level_object_keys(raw_text)
        .iter()
        .filter(|found| found.as_str() == key)
        .count()
        > 1
}

/// Skips exactly one JSON value starting at `start` (its first non-whitespace byte), returning
/// the index just past it. Nested objects/arrays are skipped by brace/bracket depth counting,
/// never by deserializing them — this is what lets [`scan_raw_header`] survive arbitrarily deep
/// nesting in a value that isn't `schemaVersion` without hitting `serde_json`'s recursion limit.
fn skip_json_value(bytes: &[u8], start: usize) -> usize {
    match bytes.get(start) {
        Some(b'"') => skip_json_string_literal(bytes, start),
        Some(b'{') | Some(b'[') => {
            let mut depth = 1i32;
            let mut i = start + 1;
            while i < bytes.len() && depth > 0 {
                if bytes[i] == b'"' {
                    i = skip_json_string_literal(bytes, i);
                    continue;
                }
                match bytes[i] {
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => depth -= 1,
                    _ => {}
                }
                i += 1;
            }
            i
        }
        _ => {
            let mut i = start;
            while i < bytes.len()
                && !matches!(bytes[i], b',' | b'}' | b']')
                && !bytes[i].is_ascii_whitespace()
            {
                i += 1;
            }
            i
        }
    }
}

/// Outcome of [`scan_raw_header`]: whether the input is even shaped like a top-level JSON
/// object, and if so, the raw text span of its `schemaVersion` value (the *last* occurrence if
/// duplicated — duplicate rejection is [`has_duplicate_top_level_key`]'s separate job).
enum RawHeaderScan {
    NotAnObject,
    Unbalanced,
    Object {
        schema_version_span: Option<(usize, usize)>,
    },
}

/// Non-recursive, header-only scan of the top-level object. Never deserializes nested
/// object/array values — brace/bracket depth is tracked with a flat byte loop, and each value is
/// skipped via [`skip_json_value`] rather than parsed — so this survives arbitrarily deep nesting
/// anywhere in the document without hitting `serde_json`'s default recursion limit. Contract
/// section 2.4 requires exactly this: raw/header classification *before* any full typed parse, so
/// a `FUTURE` document with a breaking (or absurdly deep) shape elsewhere still classifies
/// `FUTURE`, never `Malformed`. Matches `JSON.parse`'s strictness on the TS side by rejecting
/// trailing non-whitespace content after the top-level object closes.
fn scan_raw_header(raw_text: &str) -> RawHeaderScan {
    let bytes = raw_text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if bytes.get(i) != Some(&b'{') {
        return RawHeaderScan::NotAnObject;
    }

    let mut depth: i32 = 0;
    let mut schema_version_span = None;
    let mut closed_at = None;

    while i < bytes.len() {
        if bytes[i] == b'"' {
            let string_start = i;
            let string_end = skip_json_string_literal(bytes, i);
            if depth == 1 {
                let mut j = string_end;
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if bytes.get(j) == Some(&b':') {
                    let mut value_start = j + 1;
                    while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
                        value_start += 1;
                    }
                    let value_end = skip_json_value(bytes, value_start);
                    if decode_json_string_literal(&raw_text[string_start..string_end]).as_deref()
                        == Some("schemaVersion")
                    {
                        schema_version_span = Some((value_start, value_end));
                    }
                    i = value_end;
                    continue;
                }
            }
            i = string_end;
            continue;
        }
        match bytes[i] {
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth -= 1,
            _ => {}
        }
        i += 1;
        if depth == 0 {
            closed_at = Some(i);
            break;
        }
    }

    let Some(closed_at) = closed_at else {
        return RawHeaderScan::Unbalanced;
    };
    if raw_text[closed_at..]
        .bytes()
        .any(|b| !b.is_ascii_whitespace())
    {
        return RawHeaderScan::Unbalanced;
    }
    RawHeaderScan::Object {
        schema_version_span,
    }
}

/// The accepted `schemaVersion` value grammar: a non-negative integer JSON number. Compares by
/// numeric value, never by which `serde_json::Value` variant parsed it as — JS's `JSON.parse`
/// collapses `1` and `1.0` into the same number (`Number.isInteger(1.0)` is `true`), so an
/// integer-valued decimal literal like `1.0` must classify identically here, not be rejected
/// merely because `serde_json` parses a decimal-point literal as its `Float` variant.
fn validated_schema_version_number(value: &Value) -> Option<u64> {
    let numeric = value.as_f64()?;
    if !numeric.is_finite() || numeric.fract() != 0.0 || numeric < 0.0 {
        return None;
    }
    Some(numeric as u64)
}

/// Classifies an already-validated, present `schemaVersion` integer against the current build.
fn classify_version_number(version: u64) -> ProjectVersionClassification {
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

/// Classifies raw persisted-project JSON text by its `schemaVersion`, per contract section 2.4:
/// a minimal raw/header parse extracting only `schemaVersion`, performed *before* any full typed
/// parse — so a `FUTURE` document with a breaking shape change still classifies `FUTURE`, never
/// `Malformed`. Field absence, present-invalid values, and duplicate keys are handled per the
/// contract's accepted value grammar.
pub fn classify_raw_project_version(raw_text: &str) -> ProjectVersionClassification {
    let schema_version_span = match scan_raw_header(raw_text) {
        RawHeaderScan::NotAnObject | RawHeaderScan::Unbalanced => {
            return ProjectVersionClassification::Malformed;
        }
        RawHeaderScan::Object {
            schema_version_span,
        } => schema_version_span,
    };
    if has_duplicate_top_level_key(raw_text, "schemaVersion") {
        return ProjectVersionClassification::Malformed;
    }
    let Some((start, end)) = schema_version_span else {
        return ProjectVersionClassification::LegacyUnversioned;
    };
    // Only this small captured span (typically a short number literal) is ever deserialized —
    // never the whole document — so a pathologically deep value here can only make this specific
    // value invalid, not misclassify an unrelated part of the document.
    let value: Value = match serde_json::from_str(&raw_text[start..end]) {
        Ok(value) => value,
        Err(_) => return ProjectVersionClassification::Malformed,
    };
    match validated_schema_version_number(&value) {
        Some(version) => classify_version_number(version),
        None => ProjectVersionClassification::Malformed,
    }
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
    fn duplicate_detected_even_when_one_occurrence_uses_a_unicode_escape() {
        // QNBS-v3: serde_json decodes s to "s", so a byte-literal scanner would miss this duplicate; must compare decoded key names.
        let raw = format!(
            "{{\"\\u0073chemaVersion\": {CURRENT_PROJECT_SCHEMA_VERSION}, \"schemaVersion\": {}}}",
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
    fn future_document_survives_deeply_nested_unrelated_data_without_hitting_recursion_limit() {
        // QNBS-v3: a full serde_json::Value parse of the whole document hits its default recursion limit well under 256 levels, breaking parity with JS's JSON.parse which has no such limit at this depth.
        let depth = 256;
        let nested_open = "[".repeat(depth);
        let nested_close = "]".repeat(depth);
        let raw = format!(
            r#"{{"schemaVersion": {}, "unrelated": {nested_open}0{nested_close}}}"#,
            CURRENT_PROJECT_SCHEMA_VERSION + 1
        );
        assert_eq!(
            classify_raw_project_version(&raw),
            ProjectVersionClassification::Future
        );
    }

    #[test]
    fn trailing_garbage_after_the_object_is_malformed() {
        // QNBS-v3: matches JS's JSON.parse strictness, which also rejects trailing non-whitespace content.
        let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}}}garbage"#);
        assert_eq!(
            classify_raw_project_version(&raw),
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
