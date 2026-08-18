# CEF Subprocess Launch and Shutdown

**Status:** Not started — no CEF integration exists yet in this repository.
**Scope:** Subprocess launch/packaging for our build, and the authoritative shutdown protocol (request quit → stop accepting unsafe new work → cancel/defer tasks → flush save coordinator → persist window/application state → stop renderer → stop CEF → stop core → exit) as actually implemented.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1, §38 (lifecycle semantics), §61.1.4 (worked example: "CEF cleanly restarts after shutdown → test → CI job → this doc").

## Outline (to be filled in during Wave 2)

- Subprocess packaging layout for Linux/Windows/macOS as shipped
- The implemented shutdown protocol, step by step, with the actual code paths
- Failure/timeout policy for each shutdown step
- Repeated launch/close cycle test evidence (learning harness)
- Known shutdown hangs encountered during development and their root causes

## Evidence-link discipline

Per roadmap §61.1.4, every invariant claimed here should link to: the test that proves it → the CI job that runs the test → this doc. Do not claim shutdown is "clean" without a linked, currently-passing test.
