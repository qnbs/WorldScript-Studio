//! Integration tests for schema-version classification (issue #553), mirroring
//! `features/project/projectSchemaVersion.test.ts` on the TypeScript side. Lives as a separate
//! integration test file, not an inline `#[cfg(test)]` module, matching this crate's existing
//! convention (`fixtures_test.rs`, `lifecycle_test.rs`) and keeping `src/version.rs` under the
//! project's 700-line file-size guideline.

use worldscript_project::{
    classify_raw_project_version, ProjectVersionClassification, CURRENT_PROJECT_SCHEMA_VERSION,
};

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
fn form_feed_between_tokens_is_malformed_not_whitespace() {
    // QNBS-v3: JSON permits only space/tab/LF/CR as insignificant whitespace; Rust's is_ascii_whitespace() also accepts form feed, which JSON.parse rejects - would have been a parity break.
    let raw = format!("{{\"schemaVersion\"\u{0C}: {CURRENT_PROJECT_SCHEMA_VERSION}}}");
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn unrelated_key_with_a_lone_surrogate_escape_does_not_fail_the_whole_document() {
    // QNBS-v3: \uD800 is a lone UTF-16 surrogate - valid per JS's JSON.parse, but has no UTF-8 form, so decoding it must not abort classification of an otherwise-valid document.
    let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "\uD800": 0}}"#);
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Current
    );
}

#[test]
fn missing_comma_between_fields_is_malformed() {
    // QNBS-v3: balanced braces alone are not sufficient JSON syntax - a missing comma must reject, not silently accept the well-formed schemaVersion before it.
    let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION} "x": 3}}"#);
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn invalid_escape_in_an_unrelated_field_is_malformed() {
    // QNBS-v3: JS's JSON.parse rejects this whole document; an unrelated field's invalid escape must not be silently skipped just because it isn't schemaVersion.
    let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "x": "\q"}}"#);
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn trailing_comma_before_closing_brace_is_malformed() {
    let raw = format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION},}}"#);
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn malformed_nested_value_in_an_unrelated_field_is_malformed() {
    let raw =
        format!(r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "nested": {{"a": 1,}}}}"#);
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn deeply_nested_but_syntactically_invalid_payload_is_malformed() {
    // QNBS-v3: proves the non-recursive scanner still validates full JSON grammar at depth, not merely brace balance - an invalid number inside deep nesting must still classify MALFORMED.
    let depth = 256;
    let nested_open = "[".repeat(depth);
    let nested_close = "]".repeat(depth);
    let raw = format!(
        r#"{{"schemaVersion": {}, "unrelated": {nested_open}01{nested_close}}}"#,
        CURRENT_PROJECT_SCHEMA_VERSION + 1
    );
    // QNBS-v3: "01" is not a valid JSON number (leading zero followed by another digit).
    assert_eq!(
        classify_raw_project_version(&raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn schema_version_at_the_js_safe_integer_boundary_is_accepted() {
    // 2^53 - 1, the largest integer both f64/JS Number and this domain can represent exactly.
    let raw = r#"{"schemaVersion": 9007199254740991}"#;
    assert_eq!(
        classify_raw_project_version(raw),
        ProjectVersionClassification::Future
    );
}

#[test]
fn fractional_literal_rounding_near_the_boundary_matches_v8_not_serde_json_value() {
    // QNBS-v3: serde_json::Value::as_f64() rounds "9007199254740991.4" to 9007199254740992 (rejected), while V8's Number() and Rust's std str::parse::<f64> both round it to 9007199254740991 (accepted) - the fix parses the raw token directly to avoid this specific serde_json rounding divergence.
    let raw = r#"{"schemaVersion": 9007199254740991.4}"#;
    assert_eq!(
        classify_raw_project_version(raw),
        ProjectVersionClassification::Future
    );
}

#[test]
fn schema_version_one_past_the_js_safe_integer_boundary_is_malformed() {
    let raw = r#"{"schemaVersion": 9007199254740992}"#;
    assert_eq!(
        classify_raw_project_version(raw),
        ProjectVersionClassification::Malformed
    );
}

#[test]
fn schema_version_far_beyond_the_js_safe_integer_boundary_is_malformed() {
    let raw = r#"{"schemaVersion": 18446744073709551615}"#;
    assert_eq!(
        classify_raw_project_version(raw),
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
