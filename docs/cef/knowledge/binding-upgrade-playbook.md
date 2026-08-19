# CEF/Binding Upgrade Playbook

**Status:** Not started — this playbook's own prose is unwritten because no CEF/Chromium version upgrade has ever happened yet in this repository. CEF integration itself is real (`apps/desktop-cef/`, ADR-0020), and a version is pinned (`scripts/cef/cef-version.json`, currently `151.3.18+gbeff58d+chromium-151.0.7922.138`) — this doc will get real content the first time that pin actually moves.
**Scope:** The repeatable procedure for upgrading the pinned CEF/Chromium version and/or the Rust binding crate version — what to re-validate, what evidence to collect, and how the competency-regression policy (roadmap §61.1.6) applies.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §34 (CEF version governance), §34.1 (security patch SLA), §44.4 (compatibility-floor gate), §61.1.6 (competency regression policy).

## Outline (to be filled in once a first CEF version upgrade actually happens)

- Routine upgrade checklist: did Linux runtime dependencies change? did the distro/glibc floor move? did Wayland/X11 behavior change? did sandbox requirements change? did packaged resource layout change? (§44.4)
- Emergency security-patch upgrade path — shortened validation, but never skipping signature verification, sandbox smoke, startup, project open/save, updater correctness, basic a11y/focus, migration compatibility (§34.1.2)
- Required re-run of the learning harness (§61.1) before any upgrade merges — an upgrade that breaks the harness is not merge-eligible until fixed or the harness is deliberately updated (§61.1.6)
- Binding-crate upgrade specifics (API surface diffs, new unsafe boundaries, changelog review)
- Last-known-good runtime retention for rollback (Appendix M.1)

## This is a living procedure

Update this playbook every time a real upgrade happens, with what was actually re-validated and what broke — not a hypothetical checklist frozen at Wave 0.
