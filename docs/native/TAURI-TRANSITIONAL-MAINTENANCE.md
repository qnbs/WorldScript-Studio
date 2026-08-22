# Tauri Transitional Maintenance Policy

**Status: ACTIVE — Tauri remains a supported transitional runtime until the Qt retirement gate is met.**

This policy operationalizes ADR-0021. It limits new Tauri investment without turning the current desktop build into an unsupported or unsafe product. The PWA remains a first-class product surface, Rust Core remains the renderer-neutral authority, Qt remains gated, and GPUI remains deferred.

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
decision = FIX / INSTRUMENT / MITIGATE / DEFER-TO-CORE / STOP-TAURI-LANE
```

If Tauri-only coupling is high, reusable Qt/Core value is low, and TM-0 does not apply, stop the Tauri lane unless an explicitly documented immediate P0 support exception exists.

## #332 lifecycle evidence

The packaged Alt-Tab incident is classified as `UNRESOLVED-OBSERVABLE` until the owner is proven. The investigation must distinguish:

- JavaScript/event-loop or React presentation stalls;
- persistence, serialization, or I/O stalls;
- Tauri/Rust main-process stalls;
- WebKit WebProcess crashes or hangs;
- GPU/compositor presentation stalls;
- memory-pressure termination;
- Core worker starvation or deadlock.

Safe diagnostics may record build identity, renderer/runtime versions, lifecycle events, bounded heartbeat age, task kinds, persistence phase, dirty-generation, duration buckets, process state, and memory buckets. They must not record manuscript text, prompts, API keys, tokens, private paths, or encryption material.

Do not ship `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`, `__NV_DISABLE_EXPLICIT_SYNC`, or equivalent global overrides without reproducible before/after evidence, a scoped compatibility decision, and a security review.

The first reusable fix target is persistence coordination: avoid duplicate large serialization and writes while preserving dirty generations, fail-closed close behavior, and acknowledged edits. Do not remove a visibility flush or add a single-flight coordinator without proving that newer edits cannot be lost.

## GOLDEN-DESKTOP-LIFECYCLE-332

The following renderer-neutral scenario is a required future Qt acceptance input and a Tauri diagnostic target:

1. Open a representative project and edit the manuscript.
2. Cross an autosave boundary.
3. Background the window for 5 seconds, return, and edit immediately.
4. Repeat for 20 Alt-Tab cycles; also exercise 30-second and two-minute background intervals where supported.
5. Test Settings, Writer Studio, minimize/restore, normal close, relaunch, and a large project.

Required outcomes: no UI disappearance or unbounded hang; first click, caret, and keyboard input are acknowledged promptly; acknowledged edits survive; save and normal close work; no force-kill or orphan process is required; no project corruption occurs.

Packaged evidence must name the build SHA, release, Tauri/WebKitGTK versions, OS, compositor, display protocol, GPU/driver, launch path, and result maturity (`LOCAL_ONLY`, `CI_ONLY`, `PACKAGED_LOCAL`, `PACKAGED_TARGET_ENV`, or `FIELD_OBSERVED`). Browser success is a reference signal, not packaged closure evidence.

## Exit and retirement

Stop deep Tauri-specific debugging when app-owned duplicate work/deadlock and data-integrity defects have been ruled out, the failure correlates with the runtime or host environment, the PWA remains healthy, and the remaining workaround would be large or brittle. Record `RUNTIME-LIMITED` or `ENVIRONMENT-LIMITED`, retain a safe support mitigation if one exists, and move the scenario into Qt killer-gate evidence.

Tauri is removed only after Qt Stable, a field-observation window, project compatibility, update/recovery confidence, and real-user lifecycle evidence all pass. This policy does not authorize production Qt UI or a PWA-only pivot.
