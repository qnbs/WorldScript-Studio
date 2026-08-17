# CEF Architecture Primer

**Status:** Not started — no CEF integration exists yet in this repository.
**Scope:** How CEF's multi-process architecture (browser process, renderer process, GPU/utility processes; browser/frame/client ownership; message-loop integration; subprocess launch and packaging; sandbox model) maps onto WorldScript Studio's specific host and build, written from our actual integration once it exists — not a generic CEF tutorial.
**Tier:** A (release/security-critical) — see [`../OWNERSHIP.yaml`](../OWNERSHIP.yaml).
**Roadmap context:** [`../ROADMAP-CEF-DESKTOP-MIGRATION.md`](../ROADMAP-CEF-DESKTOP-MIGRATION.md) §4.11.1 ("CEF architecture" domain), §4.11.2, Wave 2.

## Outline (to be filled in during Wave 2)

- Process model as implemented in WorldScript's host (which processes exist, what each owns)
- Browser/frame/client object ownership in our integration
- Message-loop choice and why
- Subprocess launch and packaging specifics for our build
- Sandbox configuration as shipped
- Diagram: our actual process tree (not the generic CEF one)

## Do not fill this in speculatively

This document should describe **our real, built integration** once Wave 2 exists. Until then, leave sections empty rather than guessing — a wrong architecture primer is worse than a missing one (see risk register R-10, documentation drift).
