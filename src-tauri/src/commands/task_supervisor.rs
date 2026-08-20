//! WorkerBus v2 — Rust TaskSupervisor (Phase 3).
//!
//! QNBS-v3: Native compute backend for the hybrid router. The TS side
//! (`services/tauriTaskBridge.ts` + `services/hybridRouter.ts`) already routes to
//! `worldscript_task_supervisor_submit` / `worldscript_task_supervisor_ping` when
//! `enableRustCompute` is on and a Tauri runtime is detected. This module supplies
//! the missing native half: a deterministic, dependency-light task dispatcher plus
//! two bounded CPU-bound tasks (`text.analyze` and `text.diff`) that are genuinely
//! worth offloading the main thread for large manuscripts and revision comparisons.
//!
//! Contract (mirrors `@domain/worker-bus` `types.ts:213-238`, serde camelCase):
//!   RustTaskRequest { taskId, taskType, payload, priority, target, timeoutMs, retryPolicy? }
//!     -> RustTaskResultEvent { taskId, success, payload, error?, latencyMs }
//!
//! Unknown task types resolve with `success: false` (never a hard `Err`) so the
//! router's caller sees a structured failure it can fall back from, matching the
//! TS `RustTaskResultEvent` honest-failure convention.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;

/// Bumped when the wire contract or task registry changes; surfaced via `ping`.
const SUPERVISOR_VERSION: &str = "1.0.0";
const MAX_TEXT_INPUT_CHARS: usize = 200_000;
const MAX_DIFF_DP_CELLS: usize = 80_000;
const MAX_DIFF_INPUT_CHARS: usize = MAX_TEXT_INPUT_CHARS;

/// Incoming task request from the TS hybrid router (camelCase on the wire).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
// QNBS-v3: priority/target/timeoutMs/retryPolicy are part of the worker-bus wire contract
//          and accepted from the TS router, but the current dispatcher only reads
//          task_id/task_type/payload — allow(dead_code) until the retry/timeout path lands.
#[allow(dead_code)]
pub struct RustTaskRequest {
    pub task_id: String,
    pub task_type: String,
    pub payload: Value,
    pub priority: String,
    pub target: String,
    pub timeout_ms: u64,
    #[serde(default)]
    pub retry_policy: Option<Value>,
}

/// Result envelope returned to the TS bridge (camelCase on the wire).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustTaskResultEvent {
    pub task_id: String,
    pub success: bool,
    pub payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub latency_ms: u64,
}

/// Readability/length statistics for a manuscript or scene.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextAnalysis {
    pub word_count: usize,
    pub char_count: usize,
    pub char_count_no_spaces: usize,
    pub sentence_count: usize,
    pub syllable_count: usize,
    /// Flesch Reading Ease (0–100+; higher = easier). 0 for empty input.
    pub flesch_reading_ease: f64,
    /// Estimated minutes to read at 200 wpm.
    pub reading_time_minutes: f64,
}

/// Renderer-neutral word/whitespace diff operation.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextDiffOp {
    #[serde(rename = "type")]
    pub op_type: String,
    pub token: String,
}

/// Health-check command. Any non-error response signals the supervisor is reachable;
/// the TS bridge treats a successful resolve as "Rust compute available".
#[tauri::command]
pub fn worldscript_task_supervisor_ping() -> Result<String, String> {
    Ok(SUPERVISOR_VERSION.to_string())
}

/// Dispatch a single task to its native handler.
///
/// Returns `Ok(RustTaskResultEvent)` for both success and recognised-but-failed
/// tasks; reserves `Err` for transport-level problems (none currently). This keeps
/// the router's fallback logic driven by `result.success`, not by a thrown error.
#[tauri::command]
pub fn worldscript_task_supervisor_submit(
    request: RustTaskRequest,
) -> Result<RustTaskResultEvent, String> {
    let started = Instant::now();
    let task_id = request.task_id.clone();

    let outcome: Result<Value, String> = match request.task_type.as_str() {
        "text.analyze" => run_text_analyze(&request.payload),
        "text.diff" => run_text_diff(&request.payload),
        other => Err(format!("Unknown task type: {other}")),
    };

    let latency_ms = started.elapsed().as_millis() as u64;

    Ok(match outcome {
        Ok(payload) => RustTaskResultEvent {
            task_id,
            success: true,
            payload,
            error: None,
            latency_ms,
        },
        Err(err) => RustTaskResultEvent {
            task_id,
            success: false,
            payload: Value::Null,
            error: Some(err),
            latency_ms,
        },
    })
}

/// `text.analyze` handler: expects `{ "text": String }`.
fn run_text_analyze(payload: &Value) -> Result<Value, String> {
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "text.analyze requires payload.text to be a string".to_string())?;
    if text.chars().count() > MAX_TEXT_INPUT_CHARS {
        return Err(format!(
            "text.analyze input must be at most {MAX_TEXT_INPUT_CHARS} characters"
        ));
    }

    let analysis = analyze_text(text);
    serde_json::to_value(&analysis).map_err(|e| e.to_string())
}

/// `text.diff` handler: expects `{ "oldText": String, "newText": String }`.
fn run_text_diff(payload: &Value) -> Result<Value, String> {
    let old_text = payload
        .get("oldText")
        .and_then(Value::as_str)
        .ok_or_else(|| "text.diff requires payload.oldText to be a string".to_string())?;
    let new_text = payload
        .get("newText")
        .and_then(Value::as_str)
        .ok_or_else(|| "text.diff requires payload.newText to be a string".to_string())?;

    serde_json::to_value(diff_text(old_text, new_text)?).map_err(|e| e.to_string())
}

/// Pure word/whitespace diff matching `services/wordDiff.ts`'s deterministic LCS contract.
/// The explicit input and DP budgets keep untrusted revision payloads bounded on low-end hosts.
pub fn diff_text(old_text: &str, new_text: &str) -> Result<Vec<TextDiffOp>, String> {
    if old_text.chars().count() > MAX_DIFF_INPUT_CHARS
        || new_text.chars().count() > MAX_DIFF_INPUT_CHARS
    {
        return Err(format!(
            "text.diff inputs must be at most {MAX_DIFF_INPUT_CHARS} characters each"
        ));
    }

    let old_tokens = tokenize_words_and_spaces(old_text);
    let new_tokens = tokenize_words_and_spaces(new_text);
    let old_len = old_tokens.len();
    let new_len = new_tokens.len();

    if old_len == 0 && new_len == 0 {
        return Ok(Vec::new());
    }

    let exceeds_dp_budget = old_len
        .checked_mul(new_len)
        .map_or(true, |cells| cells > MAX_DIFF_DP_CELLS);
    if exceeds_dp_budget {
        let mut ops = Vec::with_capacity(2);
        if old_len > 0 {
            ops.push(TextDiffOp {
                op_type: "delete".to_string(),
                token: old_tokens.concat(),
            });
        }
        if new_len > 0 {
            ops.push(TextDiffOp {
                op_type: "insert".to_string(),
                token: new_tokens.concat(),
            });
        }
        return Ok(ops);
    }

    let mut dp = vec![vec![0usize; new_len + 1]; old_len + 1];
    for (old_index, old_token) in old_tokens.iter().enumerate() {
        for (new_index, new_token) in new_tokens.iter().enumerate() {
            let row = old_index + 1;
            let column = new_index + 1;
            dp[row][column] = if old_token == new_token {
                dp[row - 1][column - 1] + 1
            } else {
                dp[row - 1][column].max(dp[row][column - 1])
            };
        }
    }

    let mut reversed = Vec::new();
    let mut old_index = old_len;
    let mut new_index = new_len;
    while old_index > 0 || new_index > 0 {
        let old_token = old_index.checked_sub(1).map(|index| &old_tokens[index]);
        let new_token = new_index.checked_sub(1).map(|index| &new_tokens[index]);
        if let (Some(old_token), Some(new_token)) = (old_token, new_token) {
            if old_token == new_token {
                reversed.push(TextDiffOp {
                    op_type: "equal".to_string(),
                    token: old_token.clone(),
                });
                old_index -= 1;
                new_index -= 1;
                continue;
            }
        }
        if new_index > 0
            && (old_index == 0 || dp[old_index][new_index - 1] >= dp[old_index - 1][new_index])
        {
            reversed.push(TextDiffOp {
                op_type: "insert".to_string(),
                token: new_tokens[new_index - 1].clone(),
            });
            new_index -= 1;
        } else if old_index > 0 {
            reversed.push(TextDiffOp {
                op_type: "delete".to_string(),
                token: old_tokens[old_index - 1].clone(),
            });
            old_index -= 1;
        }
    }

    reversed.reverse();
    Ok(reversed)
}

fn tokenize_words_and_spaces(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut current_is_whitespace: Option<bool> = None;

    for character in text.chars() {
        // QNBS-v3: Match JavaScript whitespace semantics so Rust and TS tokens stay equivalent.
        let is_whitespace =
            (character.is_whitespace() && character != '\u{0085}') || character == '\u{FEFF}';
        if current_is_whitespace.is_some_and(|previous| previous != is_whitespace) {
            tokens.push(std::mem::take(&mut current));
        }
        current.push(character);
        current_is_whitespace = Some(is_whitespace);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// Pure, deterministic text statistics — no allocation beyond the word iterator.
/// Extracted so it can be unit-tested without a Tauri runtime.
pub fn analyze_text(text: &str) -> TextAnalysis {
    let char_count = text.chars().count();
    let char_count_no_spaces = text.chars().filter(|c| !c.is_whitespace()).count();

    let words: Vec<&str> = text.split_whitespace().filter(|w| !w.is_empty()).collect();
    let word_count = words.len();

    let sentence_count = count_sentences(text);
    let syllable_count: usize = words.iter().map(|w| count_syllables(w)).sum();

    let flesch_reading_ease = if word_count == 0 || sentence_count == 0 {
        0.0
    } else {
        let words_f = word_count as f64;
        let sentences_f = sentence_count as f64;
        let syllables_f = syllable_count as f64;
        206.835 - 1.015 * (words_f / sentences_f) - 84.6 * (syllables_f / words_f)
    };

    let reading_time_minutes = word_count as f64 / 200.0;

    TextAnalysis {
        word_count,
        char_count,
        char_count_no_spaces,
        sentence_count,
        syllable_count,
        flesch_reading_ease,
        reading_time_minutes,
    }
}

/// Count sentences by collapsing runs of terminal punctuation (`.`, `!`, `?`).
/// Text with content but no terminator counts as one sentence.
fn count_sentences(text: &str) -> usize {
    let mut count = 0usize;
    let mut in_terminator = false;
    for c in text.chars() {
        if matches!(c, '.' | '!' | '?') {
            if !in_terminator {
                count += 1;
                in_terminator = true;
            }
        } else {
            in_terminator = false;
        }
    }
    if count == 0 && text.split_whitespace().next().is_some() {
        1
    } else {
        count
    }
}

/// Heuristic syllable count for a single word: count vowel groups, drop a single
/// trailing silent `e`, floor at 1 for any word with letters.
fn count_syllables(word: &str) -> usize {
    let lower: String = word
        .chars()
        .filter(|c| c.is_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if lower.is_empty() {
        return 0;
    }

    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
    let mut count = 0usize;
    let mut prev_vowel = false;
    for c in lower.chars() {
        let vowel = is_vowel(c);
        if vowel && !prev_vowel {
            count += 1;
        }
        prev_vowel = vowel;
    }

    // Silent trailing 'e' (but never below 1).
    if lower.ends_with('e') && count > 1 {
        count -= 1;
    }

    count.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_text_is_all_zero() {
        let a = analyze_text("");
        assert_eq!(a.word_count, 0);
        assert_eq!(a.char_count, 0);
        assert_eq!(a.sentence_count, 0);
        assert_eq!(a.syllable_count, 0);
        assert_eq!(a.flesch_reading_ease, 0.0);
    }

    #[test]
    fn counts_words_chars_and_spaces() {
        let a = analyze_text("The cat sat.");
        assert_eq!(a.word_count, 3);
        assert_eq!(a.char_count, 12);
        assert_eq!(a.char_count_no_spaces, 10);
    }

    #[test]
    fn collapses_repeated_terminators_into_one_sentence() {
        assert_eq!(count_sentences("Wait... really?! Yes."), 3);
        assert_eq!(count_sentences("No terminator here"), 1);
        assert_eq!(count_sentences(""), 0);
    }

    #[test]
    fn syllable_heuristic_handles_silent_e_and_floor() {
        assert_eq!(count_syllables("cat"), 1);
        assert_eq!(count_syllables("make"), 1); // silent trailing e
        assert_eq!(count_syllables("reading"), 2);
        assert_eq!(count_syllables("the"), 1); // floor, never 0
        assert_eq!(count_syllables("!!!"), 0); // no letters
    }

    #[test]
    fn flesch_score_is_finite_for_real_prose() {
        let a = analyze_text("The quick brown fox jumps over the lazy dog. It was fast.");
        assert!(a.word_count > 0);
        assert!(a.sentence_count >= 2);
        assert!(a.flesch_reading_ease.is_finite());
    }

    #[test]
    fn submit_unknown_task_resolves_as_honest_failure() {
        let req = RustTaskRequest {
            task_id: "t1".into(),
            task_type: "does.not.exist".into(),
            payload: Value::Null,
            priority: "normal".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(!res.success);
        assert!(res.error.is_some());
        assert_eq!(res.payload, Value::Null);
    }

    #[test]
    fn submit_text_analyze_returns_stats_payload() {
        let req = RustTaskRequest {
            task_id: "t2".into(),
            task_type: "text.analyze".into(),
            payload: json!({ "text": "Hello world. This is fine." }),
            priority: "normal".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(res.success);
        assert!(res.error.is_none());
        assert_eq!(res.payload["wordCount"], json!(5));
        assert_eq!(res.payload["sentenceCount"], json!(2));
    }

    #[test]
    fn submit_text_analyze_rejects_missing_text() {
        let req = RustTaskRequest {
            task_id: "t3".into(),
            task_type: "text.analyze".into(),
            payload: json!({ "notText": 1 }),
            priority: "normal".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(!res.success);
        assert!(res.error.unwrap().contains("payload.text"));
    }

    #[test]
    fn submit_text_analyze_rejects_oversized_input() {
        let req = RustTaskRequest {
            task_id: "t-analyze-large".into(),
            task_type: "text.analyze".into(),
            payload: json!({ "text": "x".repeat(MAX_TEXT_INPUT_CHARS + 1) }),
            priority: "normal".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(!res.success);
        assert!(res.error.unwrap().contains("at most 200000 characters"));
    }

    #[test]
    fn submit_text_diff_returns_renderer_neutral_operations() {
        let req = RustTaskRequest {
            task_id: "t4".into(),
            task_type: "text.diff".into(),
            payload: json!({ "oldText": "the cat", "newText": "the dog" }),
            priority: "low".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(res.success);
        assert_eq!(res.payload[0]["type"], json!("equal"));
        assert_eq!(res.payload[0]["token"], json!("the"));
        assert_eq!(res.payload[2]["type"], json!("delete"));
        assert_eq!(res.payload[3]["type"], json!("insert"));
    }

    #[test]
    fn submit_text_diff_rejects_missing_text_pair() {
        let req = RustTaskRequest {
            task_id: "t5".into(),
            task_type: "text.diff".into(),
            payload: json!({ "oldText": "only one side" }),
            priority: "low".into(),
            target: "rust".into(),
            timeout_ms: 1000,
            retry_policy: None,
        };
        let res = worldscript_task_supervisor_submit(req).unwrap();
        assert!(!res.success);
        assert!(res.error.unwrap().contains("payload.newText"));
    }

    #[test]
    fn text_diff_uses_bounded_replacement_for_large_token_sets() {
        let old_text = (0..300)
            .map(|index| format!("old{index} "))
            .collect::<String>();
        let new_text = (0..300)
            .map(|index| format!("new{index} "))
            .collect::<String>();
        let ops = diff_text(&old_text, &new_text).unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op_type, "delete");
        assert_eq!(ops[1].op_type, "insert");
    }

    #[test]
    fn text_diff_rejects_oversized_input_before_tokenization() {
        let oversized = "x".repeat(MAX_DIFF_INPUT_CHARS + 1);
        let error = diff_text(&oversized, "").unwrap_err();
        assert!(error.contains("at most 200000 characters"));
    }

    #[test]
    fn text_diff_treats_byte_order_mark_as_whitespace() {
        let ops = diff_text("a\u{FEFF}b", "a\u{FEFF}c").unwrap();
        assert_eq!(ops[0].op_type, "equal");
        assert_eq!(ops[0].token, "a");
        assert_eq!(ops[1].op_type, "equal");
        assert_eq!(ops[1].token, "\u{FEFF}");
        assert_eq!(ops[2].op_type, "delete");
        assert_eq!(ops[2].token, "b");
        assert_eq!(ops[3].op_type, "insert");
        assert_eq!(ops[3].token, "c");
    }

    #[test]
    fn text_diff_matches_javascript_for_next_line_character() {
        let ops = diff_text("a\u{0085}b", "a\u{0085}c").unwrap();
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].op_type, "delete");
        assert_eq!(ops[0].token, "a\u{0085}b");
        assert_eq!(ops[1].op_type, "insert");
        assert_eq!(ops[1].token, "a\u{0085}c");
    }
}
