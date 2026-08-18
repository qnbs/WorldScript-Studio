//! Minimal FFI boundary proof for the Wave 2 CEF host (ADR-0020, Option B).
//!
//! Rule from the roadmap (§10): C++ owns CEF integration only; Rust owns WorldScript's
//! actual logic. This crate is not yet real business logic — it proves the boundary a
//! future migration will build on, called from a real CEF callback (see
//! `apps/desktop-cef/src/worldscript_handler.cpp`), not just a decoupled test binary.

#[no_mangle]
pub extern "C" fn worldscript_rust_ping() -> i32 {
    // QNBS-v3: non-trivial sentinel so a stub/miscompiled stand-in can't accidentally match by coincidence (e.g. a default-zeroed return reading as success).
    424242
}
