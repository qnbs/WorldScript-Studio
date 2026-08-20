# ADR 0022: Bounded pre-G2 Qt qualification harness

**Status:** Accepted — clarifying amendment to [ADR-0021](0021-qt-gpui-native-desktop-strategy.md)
**Date:** 2026-08-20
**Clarifies:** ADR-0021, Decision point 7 and the G2/Wave 5 boundary

## Context

ADR-0021 correctly prohibits production Qt or GPUI UI before the applicable admission gates. Its
wording did not explicitly distinguish a disposable feasibility probe from production UI, while
the adopted roadmap now requires early Wave 4.5 evidence before G2. That ambiguity could either
block a necessary early risk check or let a pre-G2 spike grow into an unadmitted product shell.

## Decision

A bounded, non-product Qt learning/qualification harness under Wave 4.5 is explicitly permitted
before G2 and is not “production UI code”. It exists only to falsify lifecycle, provisional bridge,
accessibility/input, packaging/update trust, crash/recovery, and security-boundary assumptions at
the smallest useful cost. Its non-goals and evidence limits are defined in
[`docs/native/QT-EARLY-KILLER-GATES.md`](../native/QT-EARLY-KILLER-GATES.md).

The harness must remain disposable and isolated:

- no editor, plot board, AI panel, design-system port, or product shell;
- no Qt WebEngine or embedded browser shortcut;
- no generic command executor, broad FFI, or renderer-owned product truth;
- a provisional bridge candidate may be used for the probe, while G2 retains the final bridge
  scorecard confirmation informed by the Wave 4.5 evidence;
- all signing, updater, and security fixtures use ephemeral runtime-injected throwaway credentials;
  no production secret or persistent test key may enter source, artifacts, logs, or secret stores;
- no production packaging promise, Tauri retirement, or G2/G3/G4 checklist shortcut follows from
  a passing probe.

This is an additive clarification, not a reversal or replacement of ADR-0021. The existing
prohibition on production Qt/GPUI UI before admission remains unchanged, and all later production
gates remain mandatory.

## Consequences

- Agents have an explicit authorization boundary for early Qt feasibility work.
- Contract and lifecycle probes may start as soon as the Rust Core exposes a typed probe call,
  parallel to storage and R-15 work; packaging, recovery, and security qualification still wait
  for the relevant Core semantics.
- Wave 4.5 can falsify fatal assumptions before feature-port sunk cost without becoming a hidden
  Qt implementation wave.
- Wave 5 turns accepted probes into a reusable learning harness and adds its remaining capability
  checks; it does not duplicate the Wave 4.5 admission decision.
- G2 remains the formal Qt implementation-admission gate, including final license, version, bridge,
  learning-harness, IME, accessibility, and packaged roundtrip decisions.
