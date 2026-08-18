# CEF Debugging and Crash Playbook

**Status:** Not started — no CEF integration exists yet in this repository.
**Scope:** How to diagnose CEF-specific failures in WorldScript's build — process-role crash classification (native host / browser / renderer / GPU / hang-without-crash), symbolization procedure, minidump handling, GPU/Wayland/X11 troubleshooting, and the operational Crash Ops subsystem's actual behavior.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §41.1–§41.5 (Crash Operations), Appendix A.5 (crash/update ops checklist), Appendix D (process attribution schema).

## Outline (to be filled in during Wave 3+)

- Process-role crash taxonomy as implemented (native host / browser / renderer / GPU/utility / hang-without-crash / startup crash loop)
- Symbolization procedure and build-provenance linkage for released builds
- Minidump privacy policy as shipped (local-only by default? consent flow?) — cross-reference §41.3
- Known GPU/Wayland/X11 failure signatures and their resolutions
- Crash-loop → Safe Mode trigger behavior (§77)
- Step-by-step "renderer appears frozen, not crashed" diagnostic procedure (hang detection, §41.1)

## Why this matters beyond crashes

Per roadmap §41.1, a crash reporter alone is insufficient — issue #332-class incidents can manifest as **hangs without a crash**. This playbook must cover both, not just the easier crash-reporting half.
