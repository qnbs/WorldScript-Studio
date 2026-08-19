# CEF/Rust Competency Matrix

**Companion to:** [`ROADMAP-CEF-DESKTOP-MIGRATION.md`](ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11, §61.1, Appendix A.1 · [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md)
**Established:** Wave 0, 2026-08-18. **Baseline was: nothing done yet.** Updated in place, 2026-08-18/19 (Wave 2, ADR-0020 spike + PR #386/#387/#388/#391/#392/#393), per this doc's own "Update discipline" below — items flip to `true` only with a linked evidence commit, in the same commit as the flip. This file exists so future waves have a live, gradeable target instead of re-deriving the checklist from the roadmap prose each time.

This is an engineering gate (roadmap §4.11.6), not a training checklist. `WS-CEF-IPC` (Wave 4) and any production storage capability exposing privileged native operations may not proceed until the relevant items below are `true` with linked evidence.

## Machine-readable manifest (roadmap §61.1.3 shape)

```yaml
cef_competency:
  binding_model_documented: true   # docs/adr/0020-cef-binding-choice-thin-cpp-host.md
  lifetime_model_reviewed: true    # docs/cef/knowledge/threading-and-lifetimes.md (PR #390) — UI-thread callbacks + ref-counting/callback-lifetime; IO thread and async cancellation still untouched
  repeated_shutdown_ci: true       # scripts/cef/run-launch-cycle-proof.mjs, cef-learning-harness CI job (PR #388)
  renderer_crash_ci: true          # chrome://crash + OnRenderProcessTerminated + browser-process survival, cef-learning-harness CI job (PR #392)
  sandbox_smoke: false
  accessibility_smoke: false
  crash_symbolization_smoke: false # crash REPORTING is proven (PR #392) — this field is specifically about decoding a dump (dump_syms/minidump_stackwalk), which needs a full Chromium source checkout and was not attempted
```

CI validation of this block ("fail CI when a required item for the active program phase is absent or false") is not yet implemented — this manifest is hand-maintained for now, matching every `driftCheckTool: "planned — not implemented"` entry in `OWNERSHIP.yaml`.

## Required competency domains (roadmap §4.11.1)

| Domain | Status | Evidence |
|---|---|---|
| CEF architecture (process model, browser/frame/client ownership, message loop, shutdown ordering, subprocess packaging, sandbox expectations) | Partial | Process model, message loop, and shutdown ordering all have real working code + CI proof (`apps/desktop-cef/`, PR #388), now written up in `docs/cef/knowledge/cef-architecture-primer.md` (PR #390, no longer a skeleton). Subprocess *resource layout* (unpackaged CEF build output — `COPY_FILES`) is confirmed, but real shipped/installer packaging is separate, unproven, later scope. Sandbox expectations still have zero evidence. |
| CEF threading & lifetime rules (UI-thread callbacks, IO thread, ref-counted objects, callback lifetime, async cancellation, shutdown races) | Partial | `CEF_REQUIRE_UI_THREAD()` used throughout; `IMPLEMENT_REFCOUNTING`/`CefRefPtr` applied correctly; a real callback-lifetime lesson learned and fixed (`base::Unretained` vs. a plain `CefTask` — see `apps/desktop-cef/src/worldscript_handler.cpp`), now written up in `docs/cef/knowledge/threading-and-lifetimes.md` (PR #390, no longer a skeleton). IO thread, render-process-side code, and async-cancellation patterns remain untouched. |
| Rust binding layer (crate/version, unsafe/FFI boundary, wrapper ownership, API coverage gaps, upgrade procedure) | Partial | `apps/desktop-cef/rust-core/` (`worldscript_rust_core`, Corrosion-linked) — FFI boundary proven inside the real CEF host in CI (PR #388), not just an isolated test. No upgrade procedure written yet (`docs/cef/knowledge/binding-upgrade-playbook.md` still skeleton); API coverage is currently one trivial function, not representative of real surface area. |
| Cross-platform native host (Linux loader/resource layout, Windows process/installer/sandbox, macOS bundle/signing, window lifecycle, high-DPI, IME/a11y) | Partial (Linux only) | Linux loader/resource layout confirmed via a real filesystem listing in CI (`docs/cef/knowledge/linux-runtime-notes.md`); a real cwd-relative-path startup bug found and fixed. Zero Windows/macOS evidence. Window lifecycle proven for open/close only — high-DPI and IME/a11y untouched. |
| Operational CEF (crash reporting, symbol handling, version-update automation, sandbox verification, packaging deps, runtime diagnostics) | Partial | Packaging deps: `scripts/cef/check-linux-runtime-deps.mjs` (dpkg package presence) + `scripts/cef/check-linux-runtime-linkage.mjs` (PR #395 — real `ldd` against the shipped `worldscript_host`/`libcef.so`, both fully resolved on the CI runner), both CI-run. Runtime diagnostics: `scripts/cef/print-cef-version-diagnostics.mjs` + verbose CEF logging (`--enable-logging=stderr --v=1`) added mid-debugging this wave. Crash reporting: proven in CI (PR #392) — `crash_reporter.cfg` + `CefCrashReportingEnabled()` + a deliberately induced renderer crash (`chrome://crash`) produced a real Crashpad `.dmp` file (the harness's actual assertion) under an overridden `BREAKPAD_DUMP_LOCATION`, alongside Crashpad's own `.meta`/`settings.dat` housekeeping files (observed, not independently asserted); the browser process survived. Symbol handling (decoding a dump into a stack trace) needs `dump_syms`/`minidump_stackwalk` built from a full Chromium source checkout — out of reach of this project's minimal-CEF-SDK CI setup, not attempted. Version-update automation and sandbox verification remain not started. |

## Appendix A.1 checklist (live)

```text
[x] Process architecture understood/documented   — PR #390, docs/cef/knowledge/cef-architecture-primer.md's "Process model" section (real, CI-proven, PR #388 evidence)
[x] Message loop decision documented              — PR #390, cef-architecture-primer.md's "Message-loop choice and why" section
[x] Thread affinity documented                    — PR #390, docs/cef/knowledge/threading-and-lifetimes.md's "Thread map" section (UI-thread callbacks only; IO thread and render-process-side code remain untouched)
[x] CEF reference-count/lifetime rules documented — PR #390, threading-and-lifetimes.md (IMPLEMENT_REFCOUNTING/CefRefPtr usage + a real callback-lifetime bug found and fixed)
[ ] Rust binding unsafe surface reviewed          (trivial surface so far, not representative)
[ ] Binding API gaps catalogued
[x] Unpackaged CEF resource layout proven          — PR #388, real filesystem listing in CI (real shipped/installer packaging remains separate, unproven, later scope)
[x] Repeated startup/shutdown harness green        — PR #388, 3/3 cycles, cef-learning-harness CI job
[x] Renderer crash observation green               — PR #392, chrome://crash + OnRenderProcessTerminated (TS_PROCESS_CRASHED), browser process survived, cef-learning-harness CI job
[ ] Accessibility smoke green                      (attempted, real blocker — see cef-architecture-primer.md's "Accessibility API" section)
[ ] Crash-reporting/symbolization smoke green       (crash-reporting half proven — PR #392, real Crashpad dump produced in CI; symbolization/decoding the dump not attempted, needs a full Chromium source checkout — see cef-architecture-primer.md)
[ ] Linux dependency inventory complete            (inventoried + ldd-verified for the real shipped .so files, PR #395 — still one distro/runner image, no packaged-installer declaration; see native-readiness.md)
[x] X11/Wayland initial smoke complete             — PR #393: X11 proven since PR #388 (Xvfb); Wayland now also proven (headless Weston compositor, --ozone-platform=wayland, same FFI+title checks, cef-learning-harness CI job). Real-hardware/compositor matrix (roadmap §44.2/§44.5 — NVIDIA/AMD/Intel × KDE/GNOME, real graphics hardware) remains unproven; this is one virtual-CI runner only.
[ ] Upgrade playbook written
[ ] External-expertise escalation path documented
```

## CEF competency gate (roadmap §4.11.6, blocks `WS-CEF-IPC`)

```text
[x] CEF process architecture documented            — PR #390, docs/cef/knowledge/cef-architecture-primer.md (sandbox expectations still unproven — see domains table)
[x] chosen Rust/C++ integration model documented   — docs/adr/0020-cef-binding-choice-thin-cpp-host.md
[x] binding version pinned                         — scripts/cef/cef-version.json
[x] unsafe/FFI boundary identified                 — apps/desktop-cef/rust-core/, proven in CI (PR #388)
[x] threading/lifetime map reviewed                 — PR #390, docs/cef/knowledge/threading-and-lifetimes.md (IO thread/async-cancellation still untouched — see domains table)
[x] clean repeated startup/shutdown proven          — PR #388, 3/3 cycles, cef-learning-harness CI job
[x] renderer termination observed and handled       — PR #392, chrome://crash deliberately crashes the renderer, OnRenderProcessTerminated fires, browser process/message loop survive, cef-learning-harness CI job
[ ] sandbox development plan validated
[ ] Linux runtime dependencies inventoried           (inventoried + ldd-verified for the real shipped .so files, PR #395 — still one distro/runner image, no packaged-installer declaration; see native-readiness.md)
[ ] at least one accessibility smoke test performed        (attempted, real blocker — see cef-architecture-primer.md's "Accessibility API" section)
[x] at least one crash-reporting/symbolization path proven  — PR #392: crash-reporting path proven end-to-end (real Crashpad dump produced in CI); full symbolization (decoding the dump) is a separate, unattempted step needing a full Chromium source checkout
[ ] upgrade playbook exists
```

This gate is **not** satisfied yet — 8 of 12 items checked, several with explicit caveats above. `WS-CEF-IPC` (Wave 4) remains blocked.

## What this snapshot (Wave 2, 2026-08-18/19) does NOT claim

Superseding the original "Wave 0 does not claim" list, now that some of those items are no longer true:

- The CEF integration approach **has** been selected (Option B, ADR-0020) — this is no longer an open item.
- A learning harness **does** exist and runs in CI (`cef-learning-harness`, PR #388) — this is no longer an open item.
- Still true: no external-expertise engagement has been triggered — none of the escalation criteria (roadmap §4.11.5) have occurred.
- Still true, and still the most important caveat: this is Linux-only (X11 proven since PR #388, Wayland smoke also proven PR #393 — but one virtual CI runner, no real GPU/hardware matrix), `no_sandbox=true` throughout, no dump symbolization (crash *reporting* is proven), no working accessibility mechanism (a real CEF-151 API blocker was found and documented, not silently skipped), and no upgrade-playbook prose exists yet (`docs/cef/knowledge/binding-upgrade-playbook.md` remains a skeleton — architecture, threading, and binding-cookbook docs are no longer skeletons, PR #390). The competency gate above is explicitly **not** satisfied.
- This matrix will continue to be updated in place as each item is genuinely satisfied, with a link to the proving test/CI job/doc (roadmap §61.1.4 evidence-link pattern) — not marked done on intention alone.

## Update discipline

When an item flips to `true`/checked, add the evidence link in the same commit (test path, CI job name, or doc section). An unchecked-to-checked change without linked evidence should be rejected in review — this matrix exists specifically to prevent false "done" claims (roadmap §4.11.6).
