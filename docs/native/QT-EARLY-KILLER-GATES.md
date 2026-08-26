# Qt Early Killer-Gate Qualification

**Status: PLANNED — sequencing approved in the Qt/GPUI roadmap; no Qt production UI is admitted.**

This document defines the cheap, evidence-producing feasibility checks that must happen before
substantial Qt feature porting. It applies the lesson from the retired CEF path: a native direction
must be able to falsify its most dangerous assumptions before the project has accumulated UI
sunk cost.

The formal qualification is an additive checkpoint after the early feasibility lanes and before
Wave 5 (the reusable Qt learning harness). The disposable pre-G2 qualification probe is the only
pre-G2 artifact; Wave 5 is a distinct later deliverable. It does not replace the later G2, G2.5,
G3, or G4 production gates. Those gates remain necessary because a small feasibility spike cannot
prove production completeness. The early lanes are explicitly allowed before the formal Wave 4.5
checkpoint so the cheapest fatal runtime risks are tested before storage and UI sunk cost.
The pre-G2 authorization boundary is recorded as the clarifying amendment
[`ADR-0022`](../adr/0022-qt-pre-g2-qualification-harness.md); it does not supersede ADR-0021.
Revision-3 graphics/lifecycle requirements are governed by
[`DESKTOP-MIGRATION-ROADMAP-REV3.md`](DESKTOP-MIGRATION-ROADMAP-REV3.md).

## Decision rule

The Qt direction advances only when each gate has a reproducible evidence record, a named owner,
and a result at the appropriate maturity level:

```text
planned → locally proven → CI-proven → packaged-proven → admitted
```

Documentation alone is not a pass. A gate that is not applicable must include a written rationale
and an architecture decision; it must not be silently skipped. A failed kill gate stops Qt work at
the smallest possible investment and returns the program to architecture review.

## Early lanes and formal qualification order

The order is deliberately front-loaded by cost and irreversibility. Once Wave 2 exposes a typed
Core probe, the following disposable lanes may run in parallel with Waves 3 and 4:

### Early feasibility lanes (before formal Wave 4.5)

1. **Lifecycle and bridge spike** — prove window creation, QML load, one typed Rust call, one Rust
   event to QML, bounded async/cancellation, clean shutdown, and repeated launch/close using one
   explicitly provisional bridge candidate.
2. **Accessibility and input feasibility** — prove an observable accessibility tree, keyboard/focus,
   accessible errors, scalable/high-contrast text, RTL/BiDi, and IME smoke behavior.
3. **Crash, hang, lifecycle diagnostics and recovery feasibility** — prove project-owned
   diagnostics/symbolization and deterministic restart/recovery without weakening sandbox/process
   isolation or corrupting test data.
4. **Linux graphics differential** — on representative Linux/Wayland/NVIDIA hardware where
   available, record Qt Quick graphics backend, GPU/driver selection, multi-GPU behavior where
   exposed, Alt-Tab/minimize/restore behavior, and a bounded memory trend. Compare against the same
   semantic PWA/Tauri workload without turning renderer-specific implementation details into shared
   product architecture. If representative hardware is genuinely unavailable for a given run, this
   lane follows the Decision rule above — a written rationale and architecture decision, never a
   silent skip.

These lanes retain their own evidence and maturity labels; they are not checked off as G2/G2.5/G3/G4
production gates. A failed lane stops Qt investment and returns the program to architecture review.

### Formal Wave 4.5 qualification

The formal Wave 4.5 qualification consumes the early-lane evidence and completes the remaining
contract, packaging/update-trust, permission, and admission review work:

1. **Contract and threat-boundary review** — complete the inventory after the early typed Core probe,
   record the provisional bridge and rejected alternatives, and state that G2 retains the final
   scorecard decision.
2. **Packaging, updater, and rollback trust** — test the distribution trust model with throwaway
   artifacts before product packaging work grows around it.
3. **Security and permission posture** — validate IPC/FFI, filesystem, network, and updater
   boundaries under the intended runtime conditions.
4. **Admission review** — use all early-lane and formal evidence to confirm or reject the bridge
   scorecard, record residual risks, and produce the G2 decision package. Larger Qt shell or feature
   work begins only after G2 passes; the later G2.5 renderer differential remains a separate
   pre-broad-UI admission gate under Revision 3.

The formal packaging and security lanes wait for the relevant Wave 4 storage/crypto/recovery
semantics; the admission decision remains conjunctive: one unresolved kill gate blocks Qt
implementation.

## Gate matrix

| Gate | Minimum proof | Kill condition |
|---|---|---|
| Contract/threat boundary | Qt-facing contract inventory identifies every IPC/FFI crossing, data owner, permission, cancellation path, and failure mode; no domain truth moves into QML/C++. | The bridge requires renderer-specific domain rules, arbitrary command execution, or a new broad unsafe/FFI architecture. |
| Lifecycle and Core bridge | A disposable Qt 6/QML probe proves the minimum viability path: process/window creation, QML load, one typed Rust call, one Rust event to QML, one bounded async/cancellation path, clean shutdown, and three repeated launch/close cycles. It records the bridge/lifetime/threading model; it does not build the reusable Wave 5 harness. | Lifetime/threading behavior is nondeterministic, cancellation cannot be bounded, or the Core cannot remain GUI-independent. |
| Accessibility and input | A real Qt Quick control sample exposes a stable accessibility tree and proves keyboard/focus, accessible errors, high contrast, scalable text, RTL/BiDi, and IME smoke behavior on a supported Linux environment. | Required semantics are not observable, custom controls require inaccessible workarounds, or IME/BiDi breaks core writing input. |
| Linux graphics differential | A disposable Qt Quick probe records scene-graph/graphics backend, GPU/driver, Wayland/X11/session context and multi-GPU selection where present; executes Alt-Tab/minimize/restore and a representative memory trend; and preserves the same semantic fixture/workload used for PWA/Tauri comparison. | Catastrophic renderer/lifecycle behavior, unbounded resource growth (explained or not — an explanation does not convert an unbounded Qt leak into a pass), unusable input latency, or a required workaround that violates the Qt Quick/Rust-Core target architecture. |
| Packaging and updater trust | A packaged hello-world/Core roundtrip starts from a clean environment; signed update metadata, artifact identity, downgrade policy, rollback, and tamper rejection are exercised with ephemeral, runtime-injected throwaway test credentials only. The credentials never live in source, artifacts, logs, or production secret stores. | Artifact identity or rollback cannot be trusted, updates accept tampered input, test credentials persist outside the test process, or the packaging model requires bypassing repository signing policy. |
| Crash and recovery | An intentional harness crash produces actionable diagnostics and symbols for project-owned code; restart/recovery behavior is deterministic and does not corrupt test data. | Diagnostics require weakening sandbox/process isolation, recovery loses acknowledged data, or failures cannot be reproduced from packaged evidence. |
| Security and permissions | Runtime review covers sandbox/process boundaries, typed IPC/FFI allowlists and versioning, filesystem/network permissions, secret injection/storage/zeroization, updater privileges and signing trust, temporary-file permissions/cleanup, and the approved Core encryption/identity-binding invariants; negative tests prove denied operations stay denied. | A capability needs arbitrary native execution, broad filesystem/network access, plaintext secret exposure, persistent test credentials, or weakened encryption/identity binding. |
| Admission decision | A signed/reviewed scorecard records evidence links, residual risks, owners, expiry/retest conditions, and explicit GO/NO-GO for Wave 5. | Any Critical/High security issue, unowned residual risk, or missing evidence remains at the decision meeting. |

The lifecycle/bridge, accessibility/input, crash/recovery, and Linux graphics differential rows are
owned by the early lanes when they run before Wave 4.5. Formal Wave 4.5 reviews their evidence and
fills any gaps; it does not manufacture a second pass merely to satisfy the later checkpoint.

## Minimum evidence package

The qualification work should produce a small, reviewable package rather than a premature product
framework:

- `qt-early-killer-gates.md` scorecard with commit/run links and maturity labels;
- disposable Qt feasibility probes, with no WorldScript feature UI and no Qt WebEngine;
- deterministic probe results covering repeated start/close, cancellation, and clean shutdown;
- an accessibility/input fixture with machine-observable tree and keyboard/IME assertions;
- a Linux graphics differential record with Qt Quick backend, GPU/driver/session identity,
  Alt-Tab/minimize/restore outcome, multi-GPU observation where applicable, and memory trend;
- a clean-environment packaged artifact and a test-key update/rollback fixture;
- a crash fixture with a project-owned symbolized frame and recovery-state assertion;
- a permission-negative-test record covering sandbox/process, denied filesystem/network/native-command
  paths, IPC/FFI allowlists, temporary-file cleanup, and secret absence from source/artifacts/logs;
- an architecture decision record for residual risks before Wave 5 admission.

The harness may use a narrow C++/Rust bridge where Qt requires it, but authoritative product
semantics remain in the renderer-neutral Rust Core. It must not become a second product shell,
generic command bridge, or hidden Qt-specific domain layer.

## Required execution environments

The early qualification should use the cheapest environment that can falsify each risk and then
repeat the meaningful checks in CI:

1. **Developer smoke:** fast lifecycle, keyboard, IME, accessibility-tree and basic graphics-
   backend checks on the supported Linux desktop used for development.
2. **Linux CI:** clean build, repeated lifecycle, headless display/compositor smoke, security
   negative tests, crash artifact collection, and deterministic result assertions.
3. **Representative Linux graphics target:** where the `#332` lineage applies, use real
   Linux/Wayland/NVIDIA hardware to capture backend/GPU/driver identity and run
   `GOLDEN-DESKTOP-LIFECYCLE-332-QF-D` — a named, fixed subset of the full
   `GOLDEN-DESKTOP-LIFECYCLE-332` scenario (§5.5 of `DESKTOP-MIGRATION-ROADMAP-REV3.md`) scoped to
   the Alt-Tab and minimize/restore cycles plus a bounded memory-trend sample, not an ad hoc
   reduction — before broad Qt UI investment. The full fourteen-step scenario, including the
   30-minute and longer soak runs, remains the mandatory input for later Qt qualification described
   below; a `-QF-D` run must never be substituted for it.
4. **Clean packaged runtime:** install/launch/update/rollback/tamper tests against the actual
   artifact layout rather than the build tree.
5. **Later platform evidence:** Windows UI Automation, macOS VoiceOver/accessibility APIs, and
   supported compositor/GPU matrices remain part of G2/G2.5/G3/G4; the early Linux spike does not
   claim cross-platform parity.

## Explicit non-goals

- no editor, plot board, AI panel, or broad design-system port;
- no Qt WebEngine or embedded Chromium shortcut;
- no GPUI implementation or Qt/GPUI parity race;
- no Tauri retirement before Qt Stable plus the documented field window;
- no R-15 shortcut, renderer-local encryption, or altered identity binding;
- no broad FFI, unsafe runtime, or generic native command executor;
- no production packaging promise based only on an unpackaged developer binary;
- no permanent graphics/backend override introduced solely to pass one differential run.

## Relationship to later gates

The early feasibility lanes answer **“is Qt still technically and operationally plausible?”** at the
cheapest useful point. Formal Wave 4.5 consumes that evidence and completes the packaging, security,
and admission review needed to confirm or reject the provisional bridge candidate. Wave 5 turns the
accepted disposable probes into the reusable executable learning harness and adds the remaining
file-dialog and clipboard evidence; it does not repeat the early lanes or Wave 4.5's kill-gate work.
G2 answers **“is Qt admitted for implementation?”** with the approved license/version/bridge
strategy and learning harness. G2.5 then answers **“has the admitted Qt renderer avoided a new
catastrophic lifecycle/graphics/resource failure on representative target hardware before broad UI
migration?”** G3 and G4 still require project compatibility, accessibility, security, packaging,
updater, recovery, performance, signing, support, and field evidence at production quality. Passing
this qualification must never be used to check those later boxes early.

## Crash, hang, lifecycle, and graphics hardening from #332

The early crash lane also covers live-process hangs and lifecycle suspension. A native probe must
distinguish an intentional native crash, a Rust Core panic, a GUI event-loop stall, a stalled Core
task, and a renderer or compositor failure without weakening process isolation.

The disposable probe must provide: a bounded UI heartbeat; lifecycle events for focus, blur,
background, resume, minimize, restore, and close; correlation IDs for Core requests; bounded
cancellation and timeout state; and a privacy-safe diagnostic bundle containing build identity,
runtime versions, last lifecycle events, task summaries, heartbeat age, persistence phase, and
memory buckets. It must contain no project text, prompts, tokens, keys, private paths, or raw
encryption material.

The `GOLDEN-DESKTOP-LIFECYCLE-332` scenario (full definition: §5.5 of
`DESKTOP-MIGRATION-ROADMAP-REV3.md` — not the `-QF-D` early-lane subset above) is mandatory input
for later Qt qualification: edit a representative project, cross an autosave boundary, background
for 5 seconds, return and edit immediately, repeat 20 times, then exercise 30-second/two-minute
background intervals, Writer Studio, Settings, minimize/restore, relaunch, and normal close. The
required outcome is no UI disappearance,
unbounded hang, lost acknowledged edit, orphan process, corruption, or force-kill requirement; first
click, caret, and keyboard input must remain responsive. **For Qt admission, memory/resource growth
must be bounded under the admitted fixture and duration; an explanation of unbounded growth is
classification evidence, not a passing result.** Transitional Tauri evidence may remain classified
as runtime-limited where the authoritative stop rule is satisfied.

A hang or graphics gate is not passed by browser-only evidence or by an unpackaged developer binary.
Results must identify their maturity (`LOCAL_ONLY`, `CI_ONLY`, `PACKAGED_LOCAL`,
`PACKAGED_TARGET_ENV`, or `FIELD_OBSERVED`) and include the platform/compositor/GPU context.