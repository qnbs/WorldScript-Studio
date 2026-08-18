# CEF Threading and Lifetimes

**Status:** Not started — no CEF integration exists yet in this repository.
**Scope:** UI-thread-only callback rules, IO-thread behavior, CEF's reference-counted object model, callback lifetime, renderer/browser process boundaries, async cancellation and object invalidation, and shutdown races — as they actually manifest in WorldScript's host implementation.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("CEF threading and lifetime rules" domain), §4.11.4 (dual-review requirement for this exact area), Appendix A.1.

## Outline (to be filled in during Wave 2)

- Thread map: which WorldScript operations must run on which CEF thread, and why
- Reference-counting discipline for CEF objects touched by our code
- Callback lifetime patterns used in our IPC/bridge implementation
- Documented shutdown-race scenarios we've hit and how they were resolved
- Repeated-startup/shutdown test results (link to the learning harness, §4.11.3)

## Why this file exists before any code

Per roadmap §4.11.4, CEF initialization, message-loop integration, and shutdown require independent dual-review — not a single unchecked implementation path. This document is where that review's findings get recorded, so lifetime knowledge survives beyond one PR conversation.
