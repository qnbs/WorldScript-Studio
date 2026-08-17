# CEF/Rust Competency Matrix

**Companion to:** [`ROADMAP-CEF-DESKTOP-MIGRATION.md`](ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11, §61.1, Appendix A.1 · [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md)
**Established:** Wave 0, 2026-08-18. **Baseline: nothing below is done yet.** No CEF code, dependency, or integration exists in this repository as of this commit — every item is honestly `false`/not-started. This file exists so future waves have a live, gradeable target instead of re-deriving the checklist from the roadmap prose each time.

This is an engineering gate (roadmap §4.11.6), not a training checklist. `WS-CEF-IPC` (Wave 4) and any production storage capability exposing privileged native operations may not proceed until the relevant items below are `true` with linked evidence.

## Machine-readable manifest (roadmap §61.1.3 shape)

```yaml
cef_competency:
  binding_model_documented: false
  lifetime_model_reviewed: false
  repeated_shutdown_ci: false
  renderer_crash_ci: false
  sandbox_smoke: false
  accessibility_smoke: false
  crash_symbolization_smoke: false
```

## Required competency domains (roadmap §4.11.1)

| Domain | Status | Evidence |
|---|---|---|
| CEF architecture (process model, browser/frame/client ownership, message loop, shutdown ordering, subprocess packaging, sandbox expectations) | Not started | — |
| CEF threading & lifetime rules (UI-thread callbacks, IO thread, ref-counted objects, callback lifetime, async cancellation, shutdown races) | Not started | — |
| Rust binding layer (crate/version, unsafe/FFI boundary, wrapper ownership, API coverage gaps, upgrade procedure) | Not started | — |
| Cross-platform native host (Linux loader/resource layout, Windows process/installer/sandbox, macOS bundle/signing, window lifecycle, high-DPI, IME/a11y) | Not started | — |
| Operational CEF (crash reporting, symbol handling, version-update automation, sandbox verification, packaging deps, runtime diagnostics) | Not started | — |

## Appendix A.1 checklist (live)

```text
[ ] Process architecture understood/documented
[ ] Message loop decision documented
[ ] Thread affinity documented
[ ] CEF reference-count/lifetime rules documented
[ ] Rust binding unsafe surface reviewed
[ ] Binding API gaps catalogued
[ ] Subprocess packaging proven
[ ] Repeated startup/shutdown harness green
[ ] Renderer crash observation green
[ ] Accessibility smoke green
[ ] Crash-reporting/symbolization smoke green
[ ] Linux dependency inventory complete
[ ] X11/Wayland initial smoke complete
[ ] Upgrade playbook written
[ ] External-expertise escalation path documented
```

## CEF competency gate (roadmap §4.11.6, blocks `WS-CEF-IPC`)

```text
[ ] CEF process architecture documented
[ ] chosen Rust/C++ integration model documented
[ ] binding version pinned
[ ] unsafe/FFI boundary identified
[ ] threading/lifetime map reviewed
[ ] clean repeated startup/shutdown proven
[ ] renderer termination observed and handled
[ ] sandbox development plan validated
[ ] Linux runtime dependencies inventoried
[ ] at least one accessibility smoke test performed
[ ] at least one crash-reporting/symbolization path proven
[ ] upgrade playbook exists
```

## What Wave 0 does NOT claim

- No CEF integration approach has been selected (roadmap §10, Appendix H scorecard — Wave 2).
- No learning harness exists yet (roadmap §4.11.3, §61.1 — Wave 2).
- No external-expertise engagement has been triggered — none of the escalation criteria (roadmap §4.11.5) have occurred, since no CEF work has started.
- This matrix will be updated in place as each item is genuinely satisfied, with a link to the proving test/CI job/doc (roadmap §61.1.4 evidence-link pattern) — not marked done on intention alone.

## Update discipline

When an item flips to `true`/checked, add the evidence link in the same commit (test path, CI job name, or doc section). An unchecked-to-checked change without linked evidence should be rejected in review — this matrix exists specifically to prevent false "done" claims (roadmap §4.11.6).
