# ADR 0021: Qt 6 + GPUI as the native desktop strategy; CEF retired

**Status:** Accepted. **Supersedes:** [[0019-cef-desktop-runtime-strategy]],
[[0020-cef-binding-choice-thin-cpp-host]]. This ADR does not add any Qt, GPUI, or Rust-Core code —
it locks direction only, exactly as ADR-0019 and ADR-0020 did for CEF. Full strategy, waves, and
gates: `docs/native/ROADMAP-QT-GPUI-DESKTOP.md`.

## Context

ADR-0019 (2026-08-18) locked Chromium Embedded Framework (CEF) as "the primary next-generation
desktop runtime… subject to the maturity gates in the roadmap," with Tauri as transition/reference
runtime until CEF demonstrated Tauri-retirement-gate parity. ADR-0020 (2026-08-18) then chose a thin
C++ CEF host + Rust core over a Rust CEF-binding crate or CEF's C API, backed by a real hands-on
spike proving the FFI boundary, clean build/launch/shutdown cycles, and a working Rust `staticlib`
link.

Both ADRs explicitly wrote their own reversal clause rather than treating the CEF direction as
closed. ADR-0019 point 1 states the decision is locked "non-negotiable **without a superseding
ADR**." ADR-0020 states plainly: "This is not a closed door — if Wave 2's later, larger integration
work surfaces a concrete blocker specific to Option B, **revisit via a superseding ADR, not a silent
pivot**." This ADR is that superseding ADR — a deliberate, evidence-driven reversal using the exact
mechanism both prior decisions pre-authorized, not an undocumented change of direction.

### New evidence since ADR-0020

Wave 2's real sandbox-enable attempt (PR #404, `feat(cef): real Linux sandbox-enable attempt
(no_sandbox=false)`) got the CEF Linux sandbox genuinely operational — observed renderer processes
running under `Seccomp=2`, the `chrome-sandbox` SUID helper correctly owned/permissioned, zero
sandbox-weakening flags. That work surfaced a structural blocker, tracked as **R-19 / Issue #405**:
with sandboxing enabled and Linux's default Yama `ptrace_scope=1` in effect, Crashpad's
`PtraceStrategyDecider::ChooseStrategy()` takes a `multiple_clients` shortcut to
`Strategy::kDirectPtrace` — a path that requires ptrace access the sandbox denies — bypassing
Crashpad's own intended fallback. This was root-caused against the pinned CEF 151.3.18 / Chromium
151.0.7922.138 source, not inferred from symptoms alone. The practical result: **sandboxed renderer
crashes produce no `.dmp` file**, closing off the crash-diagnostics pipeline the roadmap's own Wave 2
exit criteria required (`docs/architecture/native-readiness.md`'s Wave 2 snapshot has the full
evidence trail). No sandbox-weakening workaround is an acceptable trade against ADR-0019's own
security posture.

PR #404 itself remained Draft with the required `✅ CI Success` aggregator and `🎭 E2E Tests`,
`🏗️ Build`, and `🔬 E2E Deep Coverage` jobs all failing, and its own PR body states directly: "Wave 2
is not fully closed by this PR." Issue #405's exit checklist (9 items, from `.dmp` generation through
symbolized WorldScript stack-frame recovery) remains fully unmet.

## Previous decision (superseded)

- **ADR-0019** locked CEF as the non-experimental successor to Tauri, with React/Vite retained as
  the rendered frontend, Rust made increasingly authoritative for desktop concerns, Tauri kept as
  transition/fallback until a Tauri-retirement gate, typed `DesktopPlatform`/IPC contracts, and
  `egui`/`wgpu` explicitly gated out pending a "Native-v2 admission gate."
- **ADR-0020** locked the CEF integration shape as a thin C++ host talking to CEF only, with all
  real logic in a linked Rust core over a proven FFI boundary (Option B), on the strength of a real
  spike rather than a desk comparison.

Both remain accurate historical records of real, evidence-based engineering — they are not being
rewritten as though CEF were an irrational choice in August 2026. The direction changes here because
of concrete new evidence (R-19), not because the original reasoning was flawed.

## Decision

**CEF is retired from WorldScript Studio's target architecture — not deferred, not paused, removed.**
The desktop strategy becomes:

1. **React/PWA remains first-class.** Unchanged from ADR-0019 point 2 — this was never a UI rewrite
   and still isn't.
2. **Tauri 2 is transitional only, and is itself retired once Qt reaches Stable.** This is a firmer
   statement than ADR-0019 point 4's "transition/reference/fallback… until CEF has demonstrated
   parity" — the successor is now Qt, and Tauri's own retirement (roadmap Wave 20, gate G5) happens
   only after Qt Stable (G4) plus a field-observation window. Tauri is not a permanent third runtime
   alongside Qt and GPUI; it is a bridge that gets removed once it has served its purpose.
3. **Rust becomes the authoritative product/domain Core**, unchanged in spirit from ADR-0019 point 3,
   but now explicitly a multi-wave prerequisite program (project schema/validation, storage
   correctness, encryption, migrations, recovery, task supervision, diagnostics, AI orchestration)
   that must exist and be headless-testable *before* any Qt or GPUI UI implementation is admitted —
   see "Rust Core authority" below for why this gate matters.
4. **Qt 6 / Qt Quick (QML) becomes the primary native desktop product** ("Hardened Edition"),
   admitted only after the Core-first prerequisites (gates G1–G2) are satisfied. Qt Widgets are
   allowed only where narrowly justified, not the default architecture. Qt WebEngine is explicitly
   **not** part of the default architecture — reintroducing a Chromium-backed primary surface through
   Qt WebEngine would defeat the purpose of this reset, and any future narrow use requires its own
   ADR.
5. **GPUI becomes a secondary native product** ("Vision Edition"), admitted much later behind a
   strict gate (G6) that requires proven accessibility, IME/BiDi, and platform-support evidence — not
   promoted merely for being fast, and not raced against Qt for parity.
6. **Renderer-native integration stays through typed, versioned contracts** — ADR-0019 point 6/7's
   `DesktopPlatform` abstraction and allowlisted-IPC principles carry forward unchanged; they were
   never CEF-specific. (`packages/desktop-contracts`, merged via PR #384/#385, already implements
   this for the Tauri era and needs no rework to remain valid under Qt/GPUI.)
7. **No production Qt or GPUI UI code begins before the admission gates in
   `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` are satisfied.** Documentation, architecture, and
   Core-first design work that doesn't block a future native client are allowed now; native UI
   implementation is not.

## Alternatives considered

- **Weaken the sandbox to unblock crash diagnostics.** Rejected — a working sandbox is a stronger
  security property than working crash telemetry; trading it away contradicts the security posture
  ADR-0019 itself assumed CEF would deliver.
- **Wait indefinitely for an upstream Crashpad/Chromium fix.** Rejected — Issue #405's own
  disposition states no WorldScript-specific Chromium fork is planned, and there is no committed
  upstream timeline to gate a product roadmap on.
- **Ship CEF Stable with sandboxed-crash-diagnostics as a permanently accepted gap.** Rejected as a
  silent, unaudited regression against ADR-0019 point 10, which named storage/updater/diagnostics/
  crash-recovery as first-class CEF deliverables gating CEF Stable, not deferred polish.
- **Continue indefinitely on Tauri/WebKitGTK without a native successor.** Rejected for the same
  reason ADR-0019 originally rejected it: WorldScript does not control WebKitGTK's version or patch
  cadence on Linux (Issue #332's historical WebKitGTK memory blow-up remains the concrete evidence),
  and that risk is not fully addressable from the application side alone.

## Why not CEF

R-19 is structural, not a WorldScript misconfiguration: it follows directly from how Chromium's
Crashpad client shares its connection across sandboxed and unsandboxed processes, and from Linux
distributions' default `ptrace_scope=1`. Fixing it from WorldScript's side means either weakening the
sandbox (rejected above) or maintaining a Chromium/Crashpad fork (explicitly out of scope — this
project does not maintain a browser-engine fork). A desktop writing application that cannot both
sandbox its embedded browser engine *and* diagnose its crashes is carrying a permanent, unresolvable
trade-off at its architectural core.

## Why Qt first, GPUI second

Qt 6/Qt Quick is a mature, widely-audited toolkit with a real native accessibility stack (`QAccessible`)
and no embedded-browser sandboxing model to re-litigate — it sidesteps R-19's entire problem class by
construction. It has proven IME, BiDi, high-DPI, printing, and native dialog support, all
requirements this application actually needs (`docs/architecture/native-readiness.md`'s accessibility
gate). GPUI is deliberately sequenced second: it is a pre-1.0, fast-evolving framework whose
accessibility and IME story is not yet proven for WorldScript's own editor and complex controls.
Running two simultaneous native parity programs would fragment review bandwidth and risk neither
reaching production quality; Qt goes first because it is the lower-risk path to a real native
product, and GPUI is admitted only once its own gate (G6) is satisfied on independent evidence, not
on Qt's coattails.

## Tauri's transitional role

Tauri remains the production desktop runtime and the regression/behavior comparator throughout the
Core-first and Qt build-out. It is explicitly not a target for new architectural investment — new
desktop work should flow into the renderer-neutral `DesktopPlatform` boundary and the future Rust
Core, not into deeper Tauri-specific coupling. Tauri's own retirement (roadmap Wave 20 / gate G5)
happens only after Qt Stable (G4) and a field-observation window, mirroring exactly the rigor CEF
itself would have needed to clear before a Tauri cutover.

## Rust Core authority

Almost no product/domain logic exists in Rust today outside `src-tauri/`'s ~1,610 lines (task
supervision, LoRA training, Pandoc export). `apps/desktop-cef/rust-core/` — the CEF-era FFI-boundary
proof — is 22 lines with no domain logic and is being removed alongside the rest of `apps/desktop-cef/`
(see Consequences); nothing there seeds the new Core. Becoming "authoritative" is therefore a real,
multi-wave migration/reimplementation program (project schema/validation, storage, encryption,
migrations, recovery, tasks, diagnostics, AI orchestration state), not a code move. This program is a
gate, not a formality: it is the mechanism that prevents this reset from quietly becoming a
Qt-implementation wave before the renderer-neutral foundation it depends on actually exists.

## Security consequences

No change to today's security posture — Tauri's existing at-rest encryption work and the open
correctness gaps in it (`#357` atomic-write fsync, `#359` non-crash-resumable key rotation, `#360`
fs writes not participating in the encryption-migration admission lock, `#361` no AAD/identity
binding on fs-backed ciphertext) remain open, Tauri-scoped issues, unaffected by this ADR. They
become explicit inputs to the future Rust Core storage/crypto design (`docs/native/ROADMAP-QT-GPUI-DESKTOP.md`'s
risk register) rather than CEF-era scope. R-19 itself closes as "no longer WorldScript's problem" —
not because it's fixed, but because CEF is no longer in the architecture that would need it fixed.

## Accessibility consequences

CEF's accessibility story was never proven for WorldScript's editor (`docs/architecture/native-readiness.md`
had this as an open gate). Qt's `QAccessible` stack is mature and widely deployed; GPUI's
accessibility remains an explicit, evidence-gated admission risk (G6) rather than an assumption.

## License consequences

CEF/Chromium is BSD-licensed with no distribution obligations beyond attribution. Qt 6 introduces a
real licensing decision (LGPL dynamic-linking vs. commercial) that must be resolved before any Qt
module is adopted — tracked as a required decision record in `docs/native/ROADMAP-QT-GPUI-DESKTOP.md`,
not resolved by this ADR. No Qt code ships until that decision is made.

## Migration consequences

The Wave 1 `DesktopPlatform` boundary (`packages/desktop-contracts`, merged via PR #384/#385) is
unaffected — it was designed renderer-neutral from the start and needs no rework for Qt/GPUI to
consume it later. `apps/desktop-cef/`, `scripts/cef/`, and 14 of 15 `docs/cef/` files will be removed
in the companion Wave 0 cleanup PR (git history will be the archive; see
`docs/historical/cef/README.md`); `docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` will be relocated to
`docs/native/` because its Redux domain/UI-state classification remains directly useful for the
future Core migration-priority work. This ADR alone does not remove any of those paths.

## Operational consequences

`.github/workflows/cef-learning-harness.yml` is removed; it was advisory-only (never part of the
required `ci-success` aggregator), so this has zero effect on required CI gates. No new CI is added
for Qt/GPUI in this ADR — that begins only once real Qt/GPUI code exists.

## Rollback / reconsideration criteria

This ADR itself would need superseding, not silent reversal, if: the Rust Core prerequisite program
proves structurally infeasible within a reasonable timeframe; Qt's licensing model proves
incompatible with WorldScript's distribution model; or a Qt-specific blocker as structural as R-19
surfaces during the learning-harness phase (gate G2). Any such reversal follows this same
precedent — a superseding ADR citing concrete evidence, not an undocumented pivot.

## Implementation gates (summary — full definitions in `docs/native/ROADMAP-QT-GPUI-DESKTOP.md`)

| Gate | Name | Unlocks |
|---|---|---|
| G0 | CEF Exit / Strategy Reset | This ADR + Wave 0 cleanup (this PR sequence) |
| G1 | Core Native-Ready | Headless project/storage/crypto/migration APIs, native-readiness CI gate |
| G2 | Qt Implementation Admission | Qt license + bridge decisions, learning-harness proof |
| G3 | Qt Beta Admission | Core workflows, R-15 desktop encryption, accessibility/performance gates |
| G4 | Qt Stable Admission | Full parity matrix, field-proven, signed GO record |
| G5 | Tauri Retirement | Only after G4 + field-observation window |
| G6 | GPUI Production Admission | Accessibility/IME/platform proof, no speculative React-binding dependency |
| G7–G8 | GPUI Beta / Multi-Renderer Stable | Both native lines stable against one Core/project format |

## Consequences

- No code, dependency, or build-target changes ship from this ADR beyond the documentation/cleanup
  diffs in the same PR sequence (Wave 0).
- `docs/native/` becomes the living documentation set for the Qt/GPUI program (roadmap, and future
  risk register / readiness scorecard / ownership artifacts as those waves begin), mirroring the
  structure `docs/cef/` used, per the same doc-drift-ownership lesson.
- Every subsequent Qt/GPUI-labeled PR should cite this ADR and the relevant roadmap wave/gate.
- PR #404 will be closed unmerged (superseded, not a quality judgment on the investigative work);
  Issue #405 will be closed as "no longer applicable to the target architecture," explicitly not
  "fixed" — the Crashpad root cause remains real and correctly diagnosed. Both remain open as of this
  ADR's adoption; their closure is companion Wave 0 PR B's action, not this ADR's.
- `apps/desktop-cef/`, `scripts/cef/`, and `.github/workflows/cef-learning-harness.yml` will be
  removed in the companion cleanup PR; git history will be the archive, per
  `docs/historical/cef/README.md`.
- The `DesktopPlatform` boundary, `packages/desktop-contracts`, and `scripts/check-tauri-import-boundary.mjs`
  are unaffected and remain load-bearing for whatever native renderer eventually adopts them.

**Rejected alternative:** treating this as a routine roadmap update rather than a formal ADR.
Rejected because ADR-0019 explicitly required "a superseding ADR, not a silent pivot" for exactly
this kind of reversal, and the decision materially changes security posture, licensing exposure, and
multi-quarter engineering investment — it warrants the same rigor as the original decision.
