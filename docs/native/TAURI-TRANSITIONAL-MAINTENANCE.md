# Tauri Transitional Maintenance Policy

**Status: ACTIVE — Tauri remains a supported transitional runtime until the Qt retirement gate is met.**

This policy operationalizes ADR-0021. It limits new Tauri investment without turning the current desktop build into an unsupported or unsafe product. The PWA remains a first-class product surface, Rust Core remains the renderer-neutral authority, Qt remains gated, and GPUI remains deferred.

## Normative roadmap set

Desktop/native work must read the roadmap set as one authority chain:

1. `docs/adr/0021-qt-gpui-native-desktop-strategy.md` locks the architecture direction.
2. `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` remains the canonical numbered execution roadmap and historical Wave/Revision-2 record.
3. `docs/native/DESKTOP-MIGRATION-ROADMAP-REV3.md` is the **normative Revision-3 amendment** for Tauri investment/exit, #332 cross-renderer evidence, G1.5/G2.5, Wave 2.5, Qt differential qualification, and related R-15 handoff rules. Where Revision 3 narrows or strengthens an older rule in those subjects, Revision 3 controls.
4. `docs/architecture/ARCHITECTURE-REUSE-OWNERSHIP.md` is the cross-cutting implementation-governance companion: reuse existing semantic owners first, prefer narrow adapters/extraction over parallel architecture, and require one authority per semantic capability.
5. This maintenance policy is the operational Tauri support/stop-loss policy consumed by both roadmap records.
6. `pnpm run native-readiness:check` mechanically validates that the Revision-3 amendment and mandatory reuse/ownership invariants remain present; removing or silently bypassing them is therefore a CI policy failure.

Revision 3 does **not** authorize production Qt UI ahead of the existing admission gates, does not alter shipped runtime authority, and does not weaken the Core-first ordering.

## Support boundary

Until Qt reaches Stable and completes its field-observation window, Tauri must continue to provide:

- current security and updater fixes;
- correct save/load/recovery behavior without silent data loss or corruption;
- basic startup, editing, and close behavior;
- triage and evidence for user-blocking crashes, hangs, unreadable content, and broken input;
- a maintained Known-Issues record when the limitation belongs to WebKitGTK, a compositor, a GPU driver, or the host environment.

“Supported” does not mean that Tauri is the long-term native investment target.

## Maintenance classes

### TM-0 — mandatory

Fix immediately, preferably in Rust Core or a shared contract:

- data loss, corruption, or incorrect save/load/recovery semantics;
- security vulnerabilities, secret leakage, or false security claims;
- updater/package integrity failures;
- startup lockout or recovery failures.

### TM-1 — user-blocking

Investigate and fix when the cause is app-owned, shared, or addressable by a small adapter change:

- hard hangs requiring a force-kill;
- reproducible crashes;
- unreadable editor content;
- broken writing input, selection, caret, or core workflow;
- application start failures.

If the evidence instead identifies a WebKitGTK/compositor/driver limitation and the safe workaround would require a large Tauri-only architecture, stop at a bounded diagnostic or narrow mitigation and transfer the acceptance scenario to Qt.

### TM-2 — high-ROI only

Allow only when the change is small, measured, and does not create a second desktop architecture:

- focused responsiveness or transition fixes;
- targeted accessibility corrections;
- privacy-safe diagnostics;
- packaging cleanup;
- low-risk adapter maintenance.

### TM-3 — do not start

Reject new work that would create:

- a Tauri-specific domain, storage, crypto, or migration authority;
- a WebKitGTK, browser-engine, or GPU fork;
- broad renderer workarounds or global graphics environment hacks;
- new native product features only in Tauri;
- large Tauri-only UI or IPC architecture;
- security or sandbox weakening to make diagnostics pass.

TM-3 is an immediate general stop classification. It does **not** need to satisfy the #332 runtime-specific exit rule.

## Investment gate

Before a non-trivial Tauri change, record:

```text
severity = TM-0 / TM-1 / TM-2 / TM-3
root cause owner = app / shared-core / adapter / runtime / compositor / driver / unknown
reproduced = yes / no / environment-limited
renderer-neutral fix = yes / no
Qt/Core reuse = high / medium / low
Tauri-only coupling = none / low / medium / high
safe small mitigation = yes / no
upstream or environment evidence = yes / no
decision = FIX / INSTRUMENT / MITIGATE / DEFER-TO-CORE / STOP-TAURI-LANE / TRANSFER-TO-QT-ACCEPTANCE
```

Decision handling:

- **TM-0:** fix or separately track the mandatory data/security invariant; renderer transition is not an excuse to defer it unsafely.
- **TM-3:** reject the proposal immediately under the maintenance-class definition above.
- **TM-1/TM-2 unrelated to #332:** use the investment record and reuse/ownership policy directly; choose a small reusable fix/mitigation or stop the proposed Tauri-only work when ROI/architecture constraints fail.
- **#332 runtime investigations:** if Tauri-only coupling is high, reusable Qt/Core value is low, and TM-0 does not apply, any decision to stop deep investigation must satisfy the single authoritative **Tauri exit rule for #332** below. Do not substitute a shorter implicit #332 stop criterion.

Before proposing new architecture, also apply `docs/architecture/ARCHITECTURE-REUSE-OWNERSHIP.md`: identify the existing semantic owner/seed, prefer extension or a narrow adapter, and do not create a Tauri-only subsystem where a renderer-neutral authority is the correct destination.

## #332: lifecycle, performance, and memory evidence

Issue #332 is no longer treated as one generic “Tauri is sluggish” defect. It is a cross-renderer evidence source with distinct subproblems:

```text
A. persistence / preference survival          RESOLVED + FIELD-VERIFIED
B. app-owned presentation/performance cost   PARTIALLY HARDENED
C. WebKitGTK / Wayland / NVIDIA differential RUNTIME/ENVIRONMENT CANDIDATE
D. Alt-Tab / background-resume hard hang      UNRESOLVED-OBSERVABLE
E. abnormal WebKit process memory growth      UNRESOLVED-OBSERVABLE
```

The packaged Alt-Tab incident remains `UNRESOLVED-OBSERVABLE` until the owner is proven. Investigation must distinguish:

- JavaScript/event-loop or React presentation stalls;
- persistence, serialization, or I/O stalls;
- Tauri/Rust main-process stalls;
- WebKit WebProcess crashes or hangs;
- GPU/compositor presentation stalls;
- memory-pressure termination;
- Core worker starvation or deadlock.

Safe diagnostics may record build identity, renderer/runtime versions, lifecycle events, bounded heartbeat age, task kinds, persistence phase, dirty-generation, duration buckets, process state, and memory buckets. They must not record manuscript text, prompts, API keys, tokens, private paths, or encryption material.

Do not ship `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`, `__NV_DISABLE_EXPLICIT_SYNC`, or equivalent global overrides without reproducible before/after evidence, a scoped compatibility decision, and a security review. These are diagnostic levers, not architecture.

The first reusable fix target is persistence coordination: avoid duplicate large serialization and writes while preserving dirty generations, fail-closed close behavior, and acknowledged edits. Do not remove a visibility flush or add a single-flight coordinator without proving that newer edits cannot be lost.

## Portable-vs-runtime classification gate

Before further non-trivial #332 work:

1. **App/shared-Core ownership:** if state transitions, serialization, I/O, task scheduling, retained resources, editor models, queues, or application memory grow/stall, fix it because the defect can migrate with the product.
2. **Adapter ownership:** if a narrow Tauri lifecycle/adapter correction removes the defect without creating new architecture, fix it as TM-1/TM-2.
3. **Runtime/compositor/driver ownership:** if the defect survives after app-owned work is bounded and correlates with WebKitGTK, Wayland, NVIDIA, DMABUF, compositor state, or WebProcess failure, preserve the evidence and evaluate the authoritative stop rule below.
4. **Unknown:** instrument only until ownership is narrow enough to choose FIX, MITIGATE, or STOP-TAURI-LANE. Do not turn uncertainty into open-ended WebKitGTK archaeology.

## Memory classification gate

The abnormal WebKit process footprint observed during #332 must be separated into two classes:

### Portable/application leak

Application/Redux/Core state, editor models, listeners, task queues, buffers, snapshots, object URLs, or other app-owned resources grow without bound.

**Action:** fix it because it can survive the Qt migration.

### Renderer/runtime amplification or leak

App-owned heaps/resources remain bounded while WebKit/WebProcess/GPU-side footprint grows abnormally.

**Action:** capture enough evidence to establish ownership, then transfer the same soak scenario to Qt instead of building a WebKitGTK-specific recovery architecture.

The objective is classification, not proving every internal WebKit allocation.

## GOLDEN-DESKTOP-LIFECYCLE-332

The following renderer-neutral scenario is a required future Qt acceptance input and a Tauri diagnostic target:

1. Open a representative project and edit the manuscript.
2. Cross an autosave boundary.
3. Background the window for 5 seconds, return, and edit immediately.
4. Repeat for 20 Alt-Tab cycles.
5. Exercise 30-second and two-minute background intervals where supported.
6. Test Settings, Writer Studio, minimize/restore, normal close, relaunch, and a large project.
7. Run a 30-minute editing/memory session and a longer soak suitable for the target environment.
8. Repeat the same semantic scenario on PWA, Tauri, and Qt; later GPUI may consume it after separate admission.

Required outcomes: no UI disappearance or unbounded hang; no force-kill; first click, caret, and keyboard input are acknowledged promptly; acknowledged edits survive; save and normal close work; **every normal close/relaunch leaves a clean process tree with no orphaned WorldScript WebKit/GPU/helper process attributable to that run**; no project corruption occurs. For admitted Qt/PWA acceptance, memory/resource growth must be bounded under the accepted fixture/duration. Transitional Tauri runtime-side growth may remain explicitly classified only when portable leakage has been ruled out and the authoritative stop rule is otherwise satisfied.

Packaged evidence must name the build SHA, release, runtime/toolkit versions, OS, compositor, display protocol, GPU/driver, launch path, fixture/scenario version, and result maturity (`LOCAL_ONLY`, `CI_ONLY`, `PACKAGED_LOCAL`, `PACKAGED_TARGET_ENV`, or `FIELD_OBSERVED`). Browser success is a reference signal, not packaged closure evidence.

## Cross-renderer benchmark record

For #332-derived scenarios, preserve comparable measurements where practical:

```text
Metric / scenario                  PWA       Tauri       Qt       GPUI-if-admitted
cold/warm start                    ...       ...         ...      ...
Settings navigation latency        ...       ...         ...      ...
editor input latency p50/p95       ...       ...         ...      ...
scroll/frame consistency           ...       ...         ...      ...
Alt-Tab recovery                   ...       ...         ...      ...
idle RSS                           ...       ...         ...      ...
30-minute RSS / slope              ...       ...         ...      ...
long-soak peak RSS                 ...       ...         ...      ...
save/autosave latency              ...       ...         ...      ...
large-project open/save            ...       ...         ...      ...
force-kill/crash/hang count        ...       ...         ...      ...
orphan process after close count   ...       ...         ...      ...
```

Numbers are evidence, not framework marketing. Use the same project fixture, workflow, measurement definition, and target machine when comparing renderers. Share semantic scenarios and evidence schema; renderer-specific drivers/instrumentation may differ.

## Tauri exit rule for #332 — authoritative

**This is the single authoritative stop rule for deep #332 runtime investigation in this policy.** It does not govern unrelated TM-3 rejection or ordinary TM-1/TM-2 investment decisions.

Deep #332 Tauri-specific debugging may stop only when **all** of the following are true:

- data-integrity and security risks are either fixed or separately tracked as TM-0;
- app-owned duplicate work, deadlock, unbounded serialization, and portable memory leaks have been ruled out or fixed;
- the remaining failure correlates materially with WebKitGTK, compositor, GPU driver, or host-environment behavior;
- the PWA or another renderer reference remains healthy under the same product workflow;
- the remaining proposed remedy would require broad WebKitGTK/NVIDIA heuristics, global graphics overrides, runtime forks, or substantial Tauri-only recovery architecture;
- a renderer-neutral acceptance scenario and enough evidence to reproduce/compare the behavior in Qt exist.

At that point record `RUNTIME-LIMITED` or `ENVIRONMENT-LIMITED`, retain only a safe narrow support mitigation if justified, and move the scenario into Qt killer-gate/performance evidence. This is an intended stop-loss outcome, not an engineering failure.

## Qt handoff rule

#332 is a **Qt migration acceptance baseline**, not a requirement to perfect Tauri before Qt begins.

The Qt target in ADR-0021 is Qt Quick/QML with Rust Core; Qt WebEngine is not the principal UI architecture. Therefore a WebKitGTK-specific failure is not automatically portable to Qt, while app/Core/lifecycle invariants are.

Qt qualification must rerun the semantic #332 scenarios using Qt-native instrumentation and explicitly compare:

- input/interaction latency;
- GUI/render-thread behavior;
- process memory and long-session growth;
- background/resume and minimize/restore;
- clean process-tree shutdown/relaunch behavior;
- large-project open/save/autosave;
- graphics backend/GPU identity on Linux/Wayland/NVIDIA;
- multi-GPU behavior where target hardware exposes it.

A Tauri failure may remain open as a documented transitional runtime limitation while Qt proves the same workflow stable. Tauri removal still requires the normal G4/G5 retirement gates; #332 does not authorize an unsafe early cutover.

## Retirement gate

The **#332 debugging stop decision** is governed only by the authoritative Tauri exit rule above. It is distinct from both general TM-3 rejection and **runtime retirement**.

Tauri may be removed only after Qt Stable, a field-observation window, project compatibility, update/recovery confidence, real-user lifecycle evidence, and clean shutdown/process-tree evidence all pass. This policy does not authorize production Qt UI or a PWA-only pivot.