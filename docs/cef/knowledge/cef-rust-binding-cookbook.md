# CEF Rust Binding Cookbook

**Status:** Real evidence from `apps/desktop-cef/rust-core/` (PR #388) — but the FFI surface it documents is currently one trivial function, not representative of real API coverage. Treat this as "the pattern is proven," not "the binding is complete."
**Scope:** Practical recipes for the exact Rust↔CEF integration WorldScript adopted (Wave 2 decision, ADR-0020, Appendix H) — unsafe/FFI boundary patterns, wrapper ownership idioms, API coverage gaps we've hit, and workarounds, written against our real usage.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("Rust binding layer" domain), §10 (integration choice), Appendix H (decision scorecard).

## There is no "CEF binding crate" — that's the point of Option B

ADR-0020 chose Option B (thin C++ host + Rust core) specifically *because* it means Rust never touches CEF's C++ API at all — no `cef`-style Rust crate wrapping `CefRefPtr<T>`/CEF interfaces exists or is needed. The "binding" here is a plain C FFI boundary between the C++ host and a Rust `staticlib`, nothing CEF-specific on the Rust side. If a future wave changes this decision (Option A), this doc's premise would need a full rewrite, not an update.

## What's actually built (PR #388)

- **Crate**: `apps/desktop-cef/rust-core/` (`worldscript_rust_core`), `crate-type = ["staticlib"]`, `panic = "abort"` in the release profile (matches the C++ host's own lack of a Rust-panic-to-C++-exception bridge — a Rust panic across this boundary today is unrecoverable-by-design, not caught and translated).
- **The entire FFI surface right now**: one function.
  ```rust
  #[no_mangle]
  pub extern "C" fn worldscript_rust_ping() -> i32 { 424242 }
  ```
  Declared on the C++ side as a bare forward declaration (`extern "C" int worldscript_rust_ping();` in `worldscript_handler.cpp`) — **no shared/generated header exists between the two languages yet**. This is a real, acknowledged gap: today's single trivial function is hand-matched by inspection: a real API surface (multiple functions, structs crossing the boundary) would need a proper shared header or a tool like `cbindgen` to avoid silent ABI drift between the Rust and C++ sides.
- **Build integration**: [Corrosion](https://github.com/corrosion-rs/corrosion) (`corrosion_import_crate(MANIFEST_PATH ...)` in `apps/desktop-cef/CMakeLists.txt`), fetched via CMake `FetchContent` (a small MIT-licensed CMake module, not a vendored binary). Corrosion creates a CMake target named after the crate (`worldscript_rust_core`), linked via a plain `target_link_libraries(worldscript_host ... worldscript_rust_core ...)` — no manual `.a` path (the ADR-0020 spike's own documented workaround, now replaced by real integration).
- **Proven inside the real host, not just isolated**: `worldscript_rust_ping()` is called from `WorldScriptHandler::OnAfterCreated` on every launch cycle, and its exact sentinel return value is observed in CI output (`scripts/cef/run-launch-cycle-proof.mjs`) — stronger evidence than the ADR-0020 spike's decoupled standalone-binary test.

## Unsafe/FFI boundary map

The *entire* unsafe surface today is the `extern "C"` function signature itself — no raw pointers, no shared mutable state, no lifetime crossing the boundary (the function takes no arguments and returns a plain `i32`). This is deliberately the simplest possible boundary, proving the *mechanism* works before any real data crosses it. **Do not extrapolate this simplicity to "the FFI boundary is safe/solved"** — passing strings, structs, or any pointer-based data across this boundary is materially riskier and entirely unproven so far.

## Wrapper ownership model

Not applicable yet — no CEF object (or any pointer-owning type) crosses into Rust. The moment a real API needs to pass e.g. a string or buffer across this boundary, this section needs real content: who allocates, who frees, and on which side.

## Known API coverage gaps

None cataloged — there is no real API surface yet to have gaps in. The competency matrix (`docs/cef/CEF-RUST-COMPETENCY-MATRIX.md`) already flags this explicitly: `binding_model_documented: true` refers to the *integration model* (ADR-0020's Option B choice), not a claim that the FFI surface itself is complete or battle-tested.

## Binding upgrade procedure

Not written yet — see [`binding-upgrade-playbook.md`](binding-upgrade-playbook.md), still a skeleton. With only one trivial function crossing the boundary, there is nothing yet to have an upgrade procedure *for* beyond bumping the Corrosion `GIT_TAG` pin in `CMakeLists.txt`, which has not been exercised even once.
