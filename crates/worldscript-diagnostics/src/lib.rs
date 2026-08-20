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

/// Redact sensitive top-level context keys using the existing TypeScript contract.
///
/// The current TS implementation intentionally redacts keys only, not values nested under
/// otherwise-safe keys. Keeping that scope exact avoids an unreviewed wire-contract change.
pub fn sanitize_context(context: &Map<String, Value>) -> Map<String, Value> {
    context
        .iter()
        .map(|(key, value)| {
            let sanitized = if is_sensitive_key(key) {
                Value::String(REDACTED.to_string())
            } else {
                value.clone()
            };
            (key.clone(), sanitized)
        })
        .collect()
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
        assert_eq!(
            sanitized["nested"],
            json!({ "token": "still-owned-by-the-nested-value" })
        );
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
}
