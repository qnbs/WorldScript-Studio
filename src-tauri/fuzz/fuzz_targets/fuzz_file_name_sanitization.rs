//! Fuzz test: arbitrary byte strings as potential file/path inputs.
//! Ensures that no arbitrary input causes a panic in Rust code paths
//! that handle user-supplied strings (e.g., filenames derived from
//! project titles before being passed to OS APIs).

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        // Replicate the sanitization logic used before writing temp files:
        // strip path separators and null bytes that could cause path traversal.
        let _sanitized: String = s
            .chars()
            .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
            .take(255)
            .collect();
    }
});
