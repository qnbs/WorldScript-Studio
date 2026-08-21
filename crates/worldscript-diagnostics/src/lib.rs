//! Renderer-neutral structured logging primitives for the Rust Core.
//!
//! This crate deliberately stops at the portable contract: a typed log entry and the
//! GDPR-sensitive context redaction chokepoint. IndexedDB, Tauri JSONL, and development
//! console sinks remain renderer-specific adapters in `services/logger.ts` until a later
//! authority-switch slice proves their equivalence.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const REDACTED: &str = "[REDACTED]";

/// Structured log levels shared by renderer-neutral consumers.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// Renderer-neutral log record. Sink routing and persistence are intentionally absent.
#[derive(Debug, Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts: u64,
    pub level: LogLevel,
    pub module: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Map<String, Value>>,
}

/// Redact sensitive keys recursively in JSON objects and arrays.
///
/// This mirrors the TypeScript diagnostics boundary so sensitive values cannot bypass redaction
/// by being placed below an otherwise-safe object key.
pub fn sanitize_context(context: &Map<String, Value>) -> Map<String, Value> {
    context
        .iter()
        .map(|(key, value)| {
            let sanitized = if is_sensitive_key(key) {
                Value::String(REDACTED.to_string())
            } else {
                sanitize_value(value)
            };
            (key.clone(), sanitized)
        })
        .collect()
}

fn sanitize_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(sanitize_context(object)),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_value).collect()),
        _ => value.clone(),
    }
}

/// Return a sanitized copy of a structured log entry without mutating its input.
pub fn sanitize_entry(entry: &LogEntry) -> LogEntry {
    LogEntry {
        context: entry.context.as_ref().map(sanitize_context),
        ..entry.clone()
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let lowercase = key.to_ascii_lowercase();
    lowercase.contains("key")
        || lowercase.contains("token")
        || lowercase.contains("password")
        || lowercase.contains("passphrase")
        || is_iv_key(key)
        || lowercase.contains("initializationvector")
        || lowercase.contains("initialvector")
}

fn is_iv_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    let is_iv = |index: usize| {
        bytes.get(index).is_some_and(|b| *b == b'i' || *b == b'I')
            && bytes
                .get(index + 1)
                .is_some_and(|b| *b == b'v' || *b == b'V')
    };
    for index in 0..bytes.len().saturating_sub(1) {
        if !is_iv(index) {
            continue;
        }
        let before_ok = index == 0
            || bytes[index - 1] == b'_'
            || bytes[index - 1] == b'-'
            || bytes[index - 1].is_ascii_lowercase();
        let after = bytes.get(index + 2).copied();
        let after_ok = after.is_none()
            || after == Some(b'_')
            || after == Some(b'-')
            || after.is_some_and(|b| b.is_ascii_uppercase());
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_sensitive_keys_without_changing_safe_values() {
        let context = serde_json::from_value(json!({
            "apiKey": "secret",
            "userToken": "token",
            "myPassword": "password",
            "recoveryPassphrase": "phrase",
            "userId": 42,
            "nested": { "token": "still-owned-by-the-nested-value" }
        }))
        .expect("fixture context is an object");

        let sanitized = sanitize_context(&context);

        assert_eq!(sanitized["apiKey"], json!(REDACTED));
        assert_eq!(sanitized["userToken"], json!(REDACTED));
        assert_eq!(sanitized["myPassword"], json!(REDACTED));
        assert_eq!(sanitized["recoveryPassphrase"], json!(REDACTED));
        assert_eq!(sanitized["userId"], json!(42));
        assert_eq!(sanitized["nested"], json!({ "token": REDACTED }));
        assert_eq!(context["apiKey"], json!("secret"));
    }

    #[test]
    fn sensitive_key_matching_is_case_insensitive_and_substring_based() {
        let context = serde_json::from_value(json!({
            "APIKEY": "one",
            "accessTOKENValue": "two",
            "PASSWORD_HINT": "three",
            "PASSphraseBackup": "four",
            "keyboardLayout": "safe"
        }))
        .expect("fixture context is an object");

        let sanitized = sanitize_context(&context);

        assert_eq!(sanitized["APIKEY"], json!(REDACTED));
        assert_eq!(sanitized["accessTOKENValue"], json!(REDACTED));
        assert_eq!(sanitized["PASSWORD_HINT"], json!(REDACTED));
        assert_eq!(sanitized["PASSphraseBackup"], json!(REDACTED));
        assert_eq!(sanitized["keyboardLayout"], json!(REDACTED));
    }

    #[test]
    fn entry_serializes_with_wire_compatible_field_names() {
        let entry = LogEntry {
            ts: 1_700_000_000_000,
            level: LogLevel::Warn,
            module: "test".to_string(),
            message: "warning".to_string(),
            context: Some(serde_json::from_value(json!({ "apiKey": "secret" })).unwrap()),
        };
        let sanitized = sanitize_entry(&entry);

        assert_eq!(
            serde_json::to_value(sanitized).unwrap(),
            json!({
                "ts": 1_700_000_000_000u64,
                "level": "warn",
                "module": "test",
                "message": "warning",
                "context": { "apiKey": REDACTED }
            })
        );
        assert_eq!(entry.context.as_ref().unwrap()["apiKey"], json!("secret"));
    }

    #[test]
    fn redacts_iv_variants_without_redacting_ordinary_words() {
        let context = serde_json::from_value(json!({
            "iv": "one",
            "ivHex": "two",
            "encryptionIv": "three",
            "initializationVector": "four",
            "ivory": "safe",
            "privilege": "safe"
        }))
        .expect("fixture context is an object");

        let sanitized = sanitize_context(&context);

        assert_eq!(sanitized["iv"], json!(REDACTED));
        assert_eq!(sanitized["ivHex"], json!(REDACTED));
        assert_eq!(sanitized["encryptionIv"], json!(REDACTED));
        assert_eq!(sanitized["initializationVector"], json!(REDACTED));
        assert_eq!(sanitized["ivory"], json!("safe"));
        assert_eq!(sanitized["privilege"], json!("safe"));
    }
}
