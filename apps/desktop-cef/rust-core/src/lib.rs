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

/// Deliberate, distinctively-named crash for the CI crash-symbolization proof
/// (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md Wave 2 exit criterion). Only ever called
/// behind the `--debug-crash-self` CLI flag (see apps/desktop-cef/src/main.cpp) — never
/// reachable in normal operation. `panic = "abort"` (this crate's release profile) turns
/// this into a real SIGABRT Crashpad can catch, not an unwind.
#[no_mangle]
pub extern "C" fn worldscript_rust_debug_crash_self_test() {
    panic!("worldscript_rust_debug_crash_self_test: deliberate self-test crash");
}
