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

/// Decodes a JSON string literal's escape sequences by delegating to `serde_json`'s own string
/// grammar, rather than reimplementing Unicode escape decoding (including surrogate pairs) by
/// hand. Only used once a literal has already been *validated* by [`validate_json_string`], so
/// this always succeeds on a well-formed slice.
fn decode_json_string_literal(literal_with_quotes: &str) -> Option<String> {
    serde_json::from_str::<String>(literal_with_quotes).ok()
}

/// Validates and skips exactly one JSON string literal starting at `start` (the opening `"`).
/// Returns the byte index just past the matching closing `"`, or `None` if the literal is not
/// valid JSON: an unterminated string, a raw (unescaped) control character, an escape character
/// outside JSON's fixed set (`" \ / b f n r t u`), or a `\u` escape without exactly 4 hex digits.
/// This is what lets the header scan reject `{"schemaVersion":2,"x":"\q"}` as `Malformed` rather
/// than silently accepting an invalid escape in a field the scanner never otherwise inspects.
fn validate_json_string(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    loop {
        match *bytes.get(i)? {
            b'"' => return Some(i + 1),
            b'\\' => match *bytes.get(i + 1)? {
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => i += 2,
                b'u' => {
                    for k in 0..4 {
                        if !bytes.get(i + 2 + k)?.is_ascii_hexdigit() {
                            return None;
                        }
                    }
                    i += 6;
                }
                _ => return None,
            },
            0x00..=0x1F => return None,
            _ => i += 1,
        }
    }
}

/// Validates and skips exactly one JSON number literal starting at `start`, per RFC 8259's
/// number grammar (`-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`). Returns the index just past
/// it, or `None` if `start` is not the beginning of a syntactically valid number.
fn validate_json_number(bytes: &[u8], start: usize) -> Option<usize> {
    let mut i = start;
    if bytes.get(i) == Some(&b'-') {
        i += 1;
    }
    match bytes.get(i)? {
        b'0' => i += 1,
        b'1'..=b'9' => {
            i += 1;
            while matches!(bytes.get(i), Some(b'0'..=b'9')) {
                i += 1;
            }
        }
        _ => return None,
    }
    if bytes.get(i) == Some(&b'.') {
        let digits_start = i + 1;
        let mut j = digits_start;
        while matches!(bytes.get(j), Some(b'0'..=b'9')) {
            j += 1;
        }
        if j == digits_start {
            return None;
        }
        i = j;
    }
    if matches!(bytes.get(i), Some(b'e') | Some(b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+') | Some(b'-')) {
            j += 1;
        }
        let digits_start = j;
        while matches!(bytes.get(j), Some(b'0'..=b'9')) {
            j += 1;
        }
        if j == digits_start {
            return None;
        }
        i = j;
    }
    Some(i)
}

/// Validates that `bytes` contains exactly `keyword` starting at `start` (used for JSON's three
/// fixed literals: `true`, `false`, `null`).
fn validate_json_keyword(bytes: &[u8], start: usize, keyword: &[u8]) -> Option<usize> {
    let end = start.checked_add(keyword.len())?;
    (bytes.get(start..end) == Some(keyword)).then_some(end)
}

/// A container frame on the explicit, heap-allocated parser stack — used instead of recursive
/// descent so that document nesting depth is bounded only by available memory, never by the
/// call stack, and cannot hit `serde_json`'s (or any recursive parser's) fixed recursion limit.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Frame {
    /// Expecting a key string, or `}` if `at_start` (an empty object, or nothing parsed yet).
    ObjectKey {
        at_start: bool,
    },
    ObjectColon,
    ObjectValue,
    ObjectCommaOrEnd,
    /// Expecting a value, or `]` if `at_start` (an empty array, or nothing parsed yet).
    ArrayValue {
        at_start: bool,
    },
    ArrayCommaOrEnd,
}

/// What was found for the top-level `schemaVersion` key, if present. A container value
/// (object/array) is recorded as `NonScalar` without capturing its span, since it is invalid for
/// `schemaVersion` regardless of its exact shape, so nothing downstream ever needs its precise
/// byte range.
enum SchemaVersionSighting {
    Scalar(usize, usize),
    NonScalar,
}

/// Outcome of [`scan_raw_header`].
enum RawHeaderScan {
    NotAnObject,
    /// Truncated, unbalanced, or contains a genuine JSON syntax error anywhere in the document
    /// (invalid escape, malformed number, bad keyword, missing comma/colon, trailing garbage).
    Invalid,
    Object {
        /// `None` if absent, `Some` for the *last* occurrence if the key is duplicated —
        /// duplicate rejection is tracked separately via `schema_version_key_count`.
        schema_version: Option<SchemaVersionSighting>,
        schema_version_key_count: u32,
    },
}

/// JSON (RFC 8259) permits exactly four whitespace code points between tokens: space, tab, LF,
/// CR. `u8::is_ascii_whitespace` is broader (it also accepts form feed and vertical tab), which
/// would let Rust accept a document `JSON.parse` rejects on the TS side — a real parity break,
/// not a hypothetical one.
fn is_json_whitespace(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while matches!(bytes.get(i), Some(&b) if is_json_whitespace(b)) {
        i += 1;
    }
    i
}

/// Non-recursive, full-syntax JSON validator that classifies the raw/header shape in one pass,
/// per contract section 2.4. Unlike a `serde_json::Value` deserialize, nesting depth is bounded
/// by the heap-allocated `stack`, not the call stack, so this survives arbitrarily deep nesting
/// anywhere in the document without hitting a recursion limit — while still rejecting *any*
/// genuine JSON syntax error anywhere in the document (not just around `schemaVersion`), matching
/// `JSON.parse`'s strictness on the TS side. A `FUTURE` document may have any unknown or breaking
/// *shape* elsewhere and must still classify `FUTURE` — but it must still be syntactically valid
/// JSON to do so; invalid syntax is `Malformed` regardless of how "far" it is from `schemaVersion`.
fn scan_raw_header(raw_text: &str) -> RawHeaderScan {
    let bytes = raw_text.as_bytes();
    let mut i = skip_ws(bytes, 0);
    if bytes.get(i) != Some(&b'{') {
        return RawHeaderScan::NotAnObject;
    }
    i += 1;

    let mut stack = vec![Frame::ObjectKey { at_start: true }];
    let mut schema_version: Option<SchemaVersionSighting> = None;
    let mut schema_version_key_count: u32 = 0;
    // Set right after reading a key at depth 1 (stack.len() == 1 at that moment), consumed the
    // moment that key's value is parsed.
    let mut pending_top_level_key: Option<String> = None;

    loop {
        i = skip_ws(bytes, i);
        let Some(frame) = stack.last().copied() else {
            return if raw_text[i..].bytes().all(is_json_whitespace) {
                RawHeaderScan::Object {
                    schema_version,
                    schema_version_key_count,
                }
            } else {
                RawHeaderScan::Invalid
            };
        };
        let Some(&b) = bytes.get(i) else {
            return RawHeaderScan::Invalid;
        };

        match frame {
            Frame::ObjectKey { at_start } => {
                if b == b'}' && at_start {
                    stack.pop();
                    i += 1;
                    finish_value(&mut stack);
                    continue;
                }
                if b != b'"' {
                    return RawHeaderScan::Invalid;
                }
                let Some(key_end) = validate_json_string(bytes, i) else {
                    return RawHeaderScan::Invalid;
                };
                if stack.len() == 1 {
                    // QNBS-v3: an unrelated key with a lone UTF-16 surrogate has no valid UTF-8 form and fails to decode, but that only proves it isn't "schemaVersion" - must not fail the whole scan.
                    let decoded = decode_json_string_literal(&raw_text[i..key_end]);
                    if decoded.as_deref() == Some("schemaVersion") {
                        schema_version_key_count += 1;
                        pending_top_level_key = decoded;
                    } else {
                        pending_top_level_key = None;
                    }
                }
                *stack.last_mut().unwrap() = Frame::ObjectColon;
                i = key_end;
            }
            Frame::ObjectColon => {
                if b != b':' {
                    return RawHeaderScan::Invalid;
                }
                *stack.last_mut().unwrap() = Frame::ObjectValue;
                i += 1;
            }
            Frame::ObjectValue => {
                let capturing = stack.len() == 1 && pending_top_level_key.is_some();
                *stack.last_mut().unwrap() = Frame::ObjectCommaOrEnd;
                let Some(next_i) =
                    parse_value(bytes, i, &mut stack, capturing, &mut schema_version)
                else {
                    return RawHeaderScan::Invalid;
                };
                i = next_i;
            }
            Frame::ObjectCommaOrEnd => match b {
                b'}' => {
                    stack.pop();
                    i += 1;
                    finish_value(&mut stack);
                }
                b',' => {
                    *stack.last_mut().unwrap() = Frame::ObjectKey { at_start: false };
                    i += 1;
                }
                _ => return RawHeaderScan::Invalid,
            },
            Frame::ArrayValue { at_start } => {
                if b == b']' && at_start {
                    stack.pop();
                    i += 1;
                    finish_value(&mut stack);
                    continue;
                }
                *stack.last_mut().unwrap() = Frame::ArrayCommaOrEnd;
                let Some(next_i) = parse_value(bytes, i, &mut stack, false, &mut schema_version)
                else {
                    return RawHeaderScan::Invalid;
                };
                i = next_i;
            }
            Frame::ArrayCommaOrEnd => match b {
                b']' => {
                    stack.pop();
                    i += 1;
                    finish_value(&mut stack);
                }
                b',' => {
                    *stack.last_mut().unwrap() = Frame::ArrayValue { at_start: false };
                    i += 1;
                }
                _ => return RawHeaderScan::Invalid,
            },
        }
    }
}

/// Parses exactly one JSON value at `start`: a string, number, `true`/`false`/`null`, or the
/// opening of a nested object/array (pushed onto `stack` for the main loop to continue into,
/// never recursed into here). When `capturing` is set (this is the top-level `schemaVersion`
/// key's value), records what was found into `schema_version` — the exact span for a scalar, or
/// just `NonScalar` for a container, since a container is invalid for `schemaVersion` regardless
/// of its contents and its precise span is never needed.
fn parse_value(
    bytes: &[u8],
    start: usize,
    stack: &mut Vec<Frame>,
    capturing: bool,
    schema_version: &mut Option<SchemaVersionSighting>,
) -> Option<usize> {
    match *bytes.get(start)? {
        b'"' => {
            let end = validate_json_string(bytes, start)?;
            if capturing {
                *schema_version = Some(SchemaVersionSighting::Scalar(start, end));
            }
            Some(end)
        }
        b'{' => {
            if capturing {
                *schema_version = Some(SchemaVersionSighting::NonScalar);
            }
            stack.push(Frame::ObjectKey { at_start: true });
            Some(start + 1)
        }
        b'[' => {
            if capturing {
                *schema_version = Some(SchemaVersionSighting::NonScalar);
            }
            stack.push(Frame::ArrayValue { at_start: true });
            Some(start + 1)
        }
        b't' => {
            let end = validate_json_keyword(bytes, start, b"true")?;
            if capturing {
                *schema_version = Some(SchemaVersionSighting::Scalar(start, end));
            }
            Some(end)
        }
        b'f' => {
            let end = validate_json_keyword(bytes, start, b"false")?;
            if capturing {
                *schema_version = Some(SchemaVersionSighting::Scalar(start, end));
            }
            Some(end)
        }
        b'n' => {
            let end = validate_json_keyword(bytes, start, b"null")?;
            if capturing {
                *schema_version = Some(SchemaVersionSighting::Scalar(start, end));
            }
            Some(end)
        }
        b'-' | b'0'..=b'9' => {
            let end = validate_json_number(bytes, start)?;
            if capturing {
                *schema_version = Some(SchemaVersionSighting::Scalar(start, end));
            }
            Some(end)
        }
        _ => None,
    }
}

/// After a container frame pops (a nested object/array just finished), the *parent* frame just
/// completed parsing "a value" from its own perspective — transition it from expecting a value to
/// expecting a comma or its own closing bracket. A no-op when the stack is now empty (the
/// top-level object itself just closed).
fn finish_value(stack: &mut [Frame]) {
    if let Some(top) = stack.last_mut() {
        *top = match *top {
            Frame::ObjectValue => Frame::ObjectCommaOrEnd,
            Frame::ArrayValue { .. } => Frame::ArrayCommaOrEnd,
            other => other,
        };
    }
}

/// The accepted `schemaVersion` value grammar: a non-negative integer JSON number within the
/// jointly-exact domain both TS (`Number`, exact only up to `2^53 - 1`) and Rust can represent
/// without rounding. Compares by numeric value, never by which `serde_json::Value` variant parsed
/// it as — JS's `JSON.parse` collapses `1` and `1.0` into the same number
/// (`Number.isInteger(1.0)` is `true`), so an integer-valued decimal literal like `1.0` must
/// classify identically here, not be rejected merely because `serde_json` parses a decimal-point
/// literal as its `Float` variant. A value outside `[0, 2^53 - 1]` is `Malformed`: beyond that
/// bound, `f64` (and therefore JS's `Number`) can no longer represent every integer exactly, so
/// TS and Rust could silently disagree on the value — this is a joint admission-domain limit for
/// the `schemaVersion` discriminant specifically, not a statement about opaque numeric fields
/// elsewhere in the document.
fn validated_schema_version_number(
    sighting: &SchemaVersionSighting,
    raw_text: &str,
) -> Option<u64> {
    let SchemaVersionSighting::Scalar(start, end) = sighting else {
        return None;
    };
    let value: Value = serde_json::from_str(&raw_text[*start..*end]).ok()?;
    let numeric = value.as_f64()?;
    const MAX_SAFE_INTEGER: f64 = 9007199254740991.0; // 2^53 - 1
    if !numeric.is_finite()
        || numeric.fract() != 0.0
        || !(0.0..=MAX_SAFE_INTEGER).contains(&numeric)
    {
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
/// a full-syntax, non-recursive raw/header parse, performed *before* any full typed parse — so a
/// `FUTURE` document with a breaking (or absurdly deep) shape elsewhere still classifies `FUTURE`,
/// never `Malformed`, while any genuine JSON syntax error anywhere in the document still does
/// classify `Malformed`, matching `JSON.parse`'s strictness. Field absence, present-invalid
/// values, and duplicate keys are handled per the contract's accepted value grammar.
pub fn classify_raw_project_version(raw_text: &str) -> ProjectVersionClassification {
    let (schema_version, key_count) = match scan_raw_header(raw_text) {
        RawHeaderScan::NotAnObject | RawHeaderScan::Invalid => {
            return ProjectVersionClassification::Malformed;
        }
        RawHeaderScan::Object {
            schema_version,
            schema_version_key_count,
        } => (schema_version, schema_version_key_count),
    };
    if key_count > 1 {
        return ProjectVersionClassification::Malformed;
    }
    let Some(sighting) = schema_version else {
        return ProjectVersionClassification::LegacyUnversioned;
    };
    match validated_schema_version_number(&sighting, raw_text) {
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
        let raw = format!(
            r#"{{"schemaVersion": {CURRENT_PROJECT_SCHEMA_VERSION}, "nested": {{"a": 1,}}}}"#
        );
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
}
