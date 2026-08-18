# CEF Rust Binding Cookbook

**Status:** Not started — no CEF integration exists yet in this repository. No binding crate has been selected.
**Scope:** Practical recipes for the exact Rust CEF-binding crate/version WorldScript adopts (Wave 2 decision, roadmap §10/Appendix H) — unsafe/FFI boundary patterns, wrapper ownership idioms, API coverage gaps we've hit, and workarounds, written against our real usage.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("Rust binding layer" domain), §10 (integration choice), Appendix H (decision scorecard).

## Outline (to be filled in during Wave 2)

- Selected binding crate, pinned version, and why (link to the Appendix H scorecard decision)
- Unsafe/FFI boundary map — where WorldScript code crosses into unsafe Rust or C/C++, and why each crossing is necessary
- Wrapper ownership model (who owns what CEF object, when it's valid, how it's dropped)
- Known API coverage gaps in the chosen binding and how WorldScript works around them
- Binding upgrade procedure (cross-reference [`binding-upgrade-playbook.md`](binding-upgrade-playbook.md))

## Do not fill this in speculatively

No binding has been chosen as of Wave 0. This file is a placeholder for real recipes derived from actual integration work, not a summary of upstream binding documentation.
