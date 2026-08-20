# ADR 0020: CEF integration choice — thin C++ host + Rust core (Option B)

**Status:** Superseded by [ADR-0021](0021-qt-gpui-native-desktop-strategy.md), adopted 2026-08-20 — CEF is no longer WorldScript Studio's target desktop-runtime decision. This status change reflects the *decision*, not completed execution: ADR-0021's companion cleanup PR (Wave 0 PR B) removes the actual CEF source/CI separately. Preserved below as the historical record of a real, evidence-backed spike; do not treat it as current direction. See `docs/historical/cef/README.md` for what is being retired.

## Context

Roadmap §10 requires choosing between three CEF integration approaches before any real Wave 2 work begins:

- **Option A** — Rust CEF bindings (a `cef`-style Rust crate wrapping the C++ API directly).
- **Option B** — a thin C++ CEF host + Rust core, communicating over an FFI boundary. Rule if selected: *"C++ owns CEF integration only. It must not become the home of WorldScript business logic."*
- **Option C** — CEF's stable C API boundary directly.

The roadmap explicitly requires this be decided by "a constrained spike," not documentation review alone, and the decision must be recorded "including why rejected alternatives were rejected" (Appendix H).

## Decision

**Option B — thin C++ CEF host + Rust core**, on the strength of a real spike (details below), not a desk comparison.

### What was actually built and run (2026-08-18)

A standalone CMake/C++ project (`worldscript_host`) added as a target inside CEF's own **minimal** binary distribution (v151.3.18, Chromium 151.0.7922.138, linux64), following the standard `cefsimple`-with-Views-framework pattern (CEF's own cross-platform window toolkit, avoiding raw X11/GTK window code):

- `CefApp` + `CefBrowserProcessHandler` (`WorldScriptApp`) bootstrapping a single `CefWindow`/`CefBrowserView`.
- `CefClient` + `CefLifeSpanHandler` + `CefDisplayHandler` (`WorldScriptHandler`) tracking browser lifecycle and quitting the CEF message loop once the last browser closes.
- A minimal Rust `staticlib` crate (`worldscript_rust_core`, one `#[no_mangle] extern "C"` function) linked directly into the C++ executable, proving the Option B FFI boundary itself — not just "does CEF alone build."

**Verified, with evidence:**

1. **Builds cleanly** against the CMakeLists.txt/macros CEF's own binary distribution ships (`ADD_LOGICAL_TARGET`, `SET_CEF_TARGET_OUT_DIR`, `COPY_FILES`, `SET_EXECUTABLE_TARGET_PROPERTIES`) — no custom build-system invention needed, matching Option B's "closest to upstream CEF examples" advantage in practice, not just on paper.
2. **Launches and renders** under a Linux Xvfb virtual framebuffer (`about:blank`) with no fatal error. GPU-acceleration warnings were observed and are recorded honestly rather than glossed over: `MESA-INTEL: warning: Bay Trail Vulkan support is incomplete` and `Installed VAAPI version is too old (min 1.17, installed 1.14)` — Chromium fell back to software rendering (bundled SwiftShader) without crashing. This is a real Linux/GPU compatibility data point for the eventual compatibility matrix (roadmap §44), not yet a pass/fail verdict on any specific hardware tier.
3. **Repeated start/close cycles (3×) all completed with a clean process tree** — no orphaned renderer/GPU/zygote processes after each cycle, verified by checking for the specific PIDs after a delay (see the shutdown-timing finding below). This is the literal Wave 2 exit-criterion language ("clean repeated start/close cycles pass").
4. **Option B's actual FFI boundary works**, proven in isolation (a minimal C++ program linking only against the compiled Rust `staticlib` and calling into it, decoupled from CEF's own multi-process complexity) — the call returns the expected sentinel value from compiled Rust code, not a stub.

**A real operational finding, not speculative:** CEF/Chromium's shutdown after SIGTERM is not instantaneous — an immediate post-signal process check can show a still-running process for a few seconds before it exits on its own. Do not conclude "hung" from an immediate check; re-check after a short grace period. (Captured properly in `docs/cef/knowledge/subprocess-and-shutdown.md`.)

**A real dev-environment finding:** on this constrained (~3.7GB RAM) Linux dev machine, the CEF-linking step (against `libcef.so` + `libcef_dll_wrapper.a`) was unreliable when tracked as a foreground/background job by the local agent tooling used for this spike, but completed successfully once fully detached from that tooling's own process tracking (`setsid`/`nohup`/`disown`). Chromium's own default linker-optimization flags (`--gc-sections`, `-O1`) were also dropped in favor of `ld.gold` for this spike's build, trading link-time whole-program analysis for a lower memory/time footprint appropriate to constrained hardware; a CI/production build on adequately-resourced hardware should keep the stronger flags. This is a local-tooling/hardware note, not a CEF or Rust defect — recorded here so a future contributor on similar hardware doesn't waste time re-diagnosing it.

### Why Option A and Option C were not selected

Not run as parallel spikes — Option B's spike succeeded cleanly against its own stated risks (binding maturity/unsafe surface for A; verbosity for C are the roadmap's own framing) with no blocking issue encountered, and it most directly satisfies the roadmap's explicit rule that C++ must not become a home for business logic — a thin host that only talks to CEF, with all real logic in the already-proven Rust FFI boundary, is the most direct implementation of that rule. Per Appendix H's own instruction, this counts as "why rejected" for A and C: no spike evidence surfaced a reason to prefer either over B, and B's own risks (additional C++ toolchain, an FFI boundary) were the ones actually paid down by this spike, not merely assumed away.

This is not a closed door — if Wave 2's later, larger integration work surfaces a concrete blocker specific to Option B, revisit via a superseding ADR, not a silent pivot.

## Consequences

- `packages/desktop-contracts` and the Wave 1 `DesktopPlatform` abstraction are unaffected by this ADR — no CEF adapter exists yet (Wave 2+ per the original Wave 1 plan), and this ADR does not change that.
- The spike code itself (CMake target, C++ sources, Rust crate, and the ~1.5GB extracted CEF SDK) lives outside this repository (a local scratch directory) and is **not** committed — the CEF binary distribution is a large vendored third-party download that does not belong in git history, and the C++/Rust source is a throwaway proof, not yet production code. A future real Wave 2 PR ("bootstrap Chromium Embedded Framework host," per the roadmap's Appendix G PR sequencing) re-creates the equivalent host inside `src-tauri`'s eventual CEF-era replacement (or a sibling directory), fetched via a build script rather than committed binaries, with the real Cargo↔CMake integration (e.g. `corrosion`) replacing this spike's hardcoded `.a` path.
- `docs/cef/knowledge/subprocess-and-shutdown.md` and `docs/cef/knowledge/linux-runtime-notes.md` get their first real (non-speculative) content from this spike's findings, per their own "do not fill in speculatively" instruction.
- `docs/architecture/native-readiness.md` gets a Wave 2 snapshot noting this spike's evidence.
- Rust becomes the confirmed home for CEF-era business logic, consistent with ADR-0019 point 3 ("Rust becomes increasingly authoritative for critical desktop concerns").
- Still open, explicitly deferred, not assumed: sandbox posture (this spike ran with `no_sandbox = true`; roadmap §12's real security model is separate scope), the full Linux/GPU compatibility matrix across vendors/desktop environments, packaging, and the #332 PWA/Tauri/CEF performance comparison harness (roadmap Wave 3) — none of those are answered by this ADR.

**Rejected alternative:** deciding the binding approach from documentation alone. Rejected because the roadmap itself requires a hands-on spike, and this session's own experience confirms why — real build-system integration details (the `ADD_LOGICAL_TARGET`/`SET_CEF_TARGET_OUT_DIR` macros not being auto-invoked, the shutdown-timing false-positive, the local link-memory tooling quirk) were not visible from the CEF distribution's README alone.
