# CEF Subprocess Launch and Shutdown

**Status:** Preliminary spike evidence only (2026-08-18, ADR-0020) — no CEF integration exists in this repository yet, and nothing below is backed by a repo-committed, CI-run test. Treat as a lead for Wave 2's real implementation, not a settled invariant.
**Scope:** Subprocess launch/packaging for our build, and the authoritative shutdown protocol (request quit → stop accepting unsafe new work → cancel/defer tasks → flush save coordinator → persist window/application state → stop renderer → stop CEF → stop core → exit) as actually implemented.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1, §38 (lifecycle semantics), §61.1.4 (worked example: "CEF cleanly restarts after shutdown → test → CI job → this doc").

## Spike finding (2026-08-18, not yet a linked test — see discipline note below)

A standalone `cefsimple`-pattern host (Views framework, no raw X11 window code), spiked outside this repo per ADR-0020, showed:

- **Shutdown after SIGTERM is not instantaneous.** An immediate post-signal `ps` check can still show the main process alive (observed CPU-active, not hung) for a few real seconds before it exits on its own. A naive "check right after sending the signal" test will produce a false "still running / possibly hung" reading. Re-check after a short grace period (a few seconds was sufficient in this spike) before concluding a shutdown hang.
- **3 repeated start → SIGTERM → close cycles all eventually left a fully clean process tree** (no orphaned renderer/GPU/zygote processes), once the grace period above was respected.
- `WorldScriptHandler::OnBeforeClose` calling `CefQuitMessageLoop()` only once the last tracked browser closes (the standard `cefsimple` pattern) is what makes `CefRunMessageLoop()` in `main()` return, which is the actual signal that the process is ready for `CefShutdown()` — this is the point in the protocol this spike actually exercised. Everything upstream of it in the full protocol this doc's scope describes (save coordinator flush, window/app state persistence) is Wave 5+ scope and was not part of this spike.

## Evidence-link discipline note

Per roadmap §61.1.4, this section is a placeholder for the *real* invariant, which must link to: the test that proves it → the CI job that runs it → this doc. The finding above has none of those yet — it comes from a manual, non-committed, non-CI spike. Do not upgrade the wording above to "clean" as a flat claim until a real test exists in this repo and a CI job runs it.

## Outline (to be filled in during Wave 2)

- Subprocess packaging layout for Linux/Windows/macOS as shipped
- The implemented shutdown protocol, step by step, with the actual code paths
- Failure/timeout policy for each shutdown step
- Repeated launch/close cycle test evidence (learning harness)
- Known shutdown hangs encountered during development and their root causes

## Evidence-link discipline

Per roadmap §61.1.4, every invariant claimed here should link to: the test that proves it → the CI job that runs the test → this doc. Do not claim shutdown is "clean" without a linked, currently-passing test.
