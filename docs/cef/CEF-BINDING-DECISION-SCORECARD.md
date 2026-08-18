# CEF Integration Decision Scorecard

Fills in the empty template from `docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md` Appendix H, per ADR-0020. Scored **only** where the Wave 2 spike produced real evidence — a blank/"not tested" cell means exactly that, not an assumed pass.

**Decision: Option B (thin C++ CEF host + Rust core).** See `docs/adr/0020-cef-binding-choice-thin-cpp-host.md` for the full rationale and spike description.

| Criterion | Rust binding (A) | Thin C++ host (B) | C API (C) |
|---|---|---|---|
| Linux support | not spiked | **Partial** — built and ran on one Ubuntu 22.04/X11/Xvfb machine, CEF's own officially-tested target for this version; packaged/clean-machine runtime compatibility remains unproven (§44.3) | not spiked |
| Windows support | not spiked | not spiked (Linux-only spike) | not spiked |
| macOS support | not spiked | not spiked (Linux-only spike) | not spiked |
| Sandbox | not spiked | Not exercised — spike ran with `no_sandbox=true`; roadmap §12's real sandbox posture is separate, later scope | not spiked |
| Renderer callbacks | not spiked | Partial — browser-process handlers (`CefLifeSpanHandler`/`CefDisplayHandler`) fired correctly across 3 repeated create/close cycles; renderer-process-specific callbacks (`CefRenderProcessHandler`/`CefRenderHandler`) were not implemented or tested this spike | not spiked |
| GPU/crash callbacks | not spiked | Partial — observed real GPU-fallback warnings (Bay Trail Vulkan incomplete, VAAPI 1.14 < required 1.17) with a clean software-render fallback (SwiftShader), not a crash; no deliberate crash-callback test performed yet | not spiked |
| Packaging | not spiked | not spiked (this was a build+run spike, not a packaging spike) | not spiked |
| Upstream docs | not spiked | **Good** — CEF's own `cefsimple`-pattern conventions and shipped CMake macros were directly usable with only the expected per-target additions (`ADD_LOGICAL_TARGET`, `SET_CEF_TARGET_OUT_DIR` — not auto-invoked by the minimal distribution, but documented in the macro file itself) | not spiked |
| Memory/lifetime safety | not spiked | Noted, not yet stress-tested: CEF's own shutdown sequence takes a few real seconds after SIGTERM — confirmed clean (no permanent orphans) but not instantaneous; see `docs/cef/knowledge/subprocess-and-shutdown.md` | not spiked |
| FFI complexity | n/a (no C++/Rust FFI boundary in this option) | **Proven low** — a minimal `#[no_mangle] extern "C"` Rust `staticlib`, linked via a plain `.a` path, called correctly and returned the expected value; no binding-generation tooling needed for a function this simple | n/a for this spike's scope |
| Maintenance | not spiked | Reasonable expectation, not yet tested across a version bump — the spike used one pinned CEF version only | not spiked |
| CI complexity | not spiked | Not yet run in CI. Real, evidence-based local-dev finding: linking against `libcef.so`/`libcef_dll_wrapper.a` needed `ld.gold` + reduced optimization flags + full process detachment from this session's own tooling to complete reliably on constrained (~3.7GB RAM) hardware — a CI runner with more memory may not need any of this, but it should be verified, not assumed | not spiked |
| Rust-core fit | not spiked | **Proven** — the FFI boundary this option's whole premise depends on (C++ owns CEF only, Rust owns logic) works, verified in isolation from CEF's own process complexity | not spiked |

## What this scorecard does *not* claim

- Cross-platform parity (Windows/macOS) — zero evidence either way; this was a Linux-only spike matching the roadmap's own Wave 2 exit criterion ("renders reliably... on Linux development systems").
- Sandbox viability — deliberately disabled for this spike; a real security-model evaluation is separate, later scope (roadmap §12, Wave 3+).
- Production packaging, updater, or crash-reporting pipeline integration — none of these were exercised.
- A verdict on Options A or C's actual viability — they were not spiked in parallel; see ADR-0020's "why rejected" section for the reasoning behind not spiking them given B's clean result.

## Re-scoring triggers

Re-score this table (not just append to it) when: Windows/macOS support is spiked, sandbox mode is enabled and tested, a second CEF version is tried (to exercise "maintenance"), or this moves into real CI (to score "CI complexity" honestly instead of narratively).
