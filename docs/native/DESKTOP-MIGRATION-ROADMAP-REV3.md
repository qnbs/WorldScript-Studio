# WorldScript Studio — Desktop Migration Roadmap Revision 3

**Status:** Proposed binding refinement to ADR-0021 and `ROADMAP-QT-GPUI-DESKTOP.md`  
**Repository:** `qnbs/WorldScript-Studio`  
**Date:** 2026-08-24  
**Primary native target:** Qt 6 + Qt Quick/QML  
**Authoritative product core:** Rust  
**Transitional desktop runtime:** Tauri 2 / system WebView  
**Web product:** React/Vite PWA  
**Deferred exploration:** GPUI  
**CEF:** retired as an implementation target  
**Cross-cutting implementation governance:** [`../architecture/ARCHITECTURE-REUSE-OWNERSHIP.md`](../architecture/ARCHITECTURE-REUSE-OWNERSHIP.md)

---

## 1. Executive decision

WorldScript Studio must no longer optimize toward **“a perfect Tauri desktop before Qt may start.”**

The binding program objective becomes:

> **Perfect the renderer-neutral product foundation; fix portable defects; classify runtime-specific defects to a defensible stop decision; convert those defects into cross-renderer acceptance tests; qualify Qt early; migrate authority deliberately; retire Tauri only after Qt Stable and field evidence.**

The desired sequence is:

```text
CURRENT: React/PWA + Tauri/WebKitGTK
        │
        ├── preserve a safe supported Tauri transitional product
        ├── fix TM-0 data/security defects
        ├── fix portable app/Core defects
        └── classify renderer/runtime-specific residuals
                    │
                    ▼
        Renderer-neutral DesktopPlatform
                    │
                    ▼
           Authoritative Rust Core
 Project / Storage / Crypto / Migration / Tasks / AI / Diagnostics
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
 Qt early qualification    PWA reference
          │
          ▼
 Qt Quick/QML + thin bridge + Rust
          │
          ▼
 packaged cross-renderer proof
          │
          ▼
       Qt Stable
          │
          ▼
 Tauri retirement G5
          │
          ├──────────────► PWA continues
          └──────────────► GPUI exploration/admission later
```

Qt is **not** planned as a Qt-WebEngine recreation of the Tauri webview shell. The principal UI target remains Qt Quick/QML with a thin native integration layer to the Rust Core. Qt WebEngine may only be introduced for a narrowly isolated capability after a separate architecture, security, performance, and licensing decision.

This roadmap also adopts the repository-wide reuse rule from `ARCHITECTURE-REUSE-OWNERSHIP.md`: capability names describe responsibilities, not mandatory new crates/packages/services. Existing semantic owners and proven primitives are extended first; new architecture is introduced only for a real ownership/capability gap.

---

## 2. Why Revision 3 is necessary

Issue #332 now provides enough packaged field evidence to distinguish several problem classes that were originally conflated:

1. persistence/preferences — fixed and field-verified;
2. app-owned visual/compositing cost — real and materially improvable;
3. Tauri/WebKitGTK/Wayland/NVIDIA differential — plausible and increasingly isolated;
4. Alt-Tab/background-resume hard hangs — repeatedly reproduced and user-blocking;
5. abnormal WebKit process memory growth — observed, potentially related, not yet causally proven.

The program must treat **renderer-neutral defects** and **renderer-specific defects** differently. A renderer replacement makes it wasteful to build large WebKitGTK-specific architecture when the useful engineering outcome can instead be preserved as a reusable acceptance scenario.

Revision 3 therefore introduces:

- a formal **Tauri Investment Gate**;
- a formal **Tauri Exit/Stop-Loss Rule**;
- explicit **portable-vs-runtime classification**;
- a **cross-renderer performance/lifecycle benchmark program**;
- **G1.5 — Tauri Evidence Exit / Qt Transfer Readiness**;
- **G2.5 — Qt Renderer Differential Gate**;
- **Wave 2.5 — Desktop Differential Baseline & #332 Classification**;
- an early **Qt Linux/Wayland/NVIDIA graphics differential lane**;
- a binding **reuse-first / one-authority-per-capability** implementation constraint through `ARCHITECTURE-REUSE-OWNERSHIP.md`.

---

## 3. Binding architectural invariants

### 3.1 Renderer owns presentation; Core owns truth

No renderer may become authoritative for:

- project truth;
- persistence semantics;
- migration;
- encryption;
- recovery;
- durable task state;
- AI orchestration truth;
- project compatibility rules.

```text
React / Tauri adapter / Qt QML / future GPUI
                    │
                    ▼
           versioned contracts
                    │
                    ▼
           WorldScript Rust Core
```

### 3.2 DesktopPlatform remains a permanent substitution boundary

The existing `packages/desktop-contracts` / `DesktopPlatform` investment is strategic infrastructure, not temporary Tauri cleanup.

Requirements:

- direct Tauri imports remain mechanically constrained;
- the existing zero-tolerance import guard remains required CI;
- Qt APIs must not leak into shared/domain code;
- future renderer adapters implement capability contracts rather than inventing alternate product semantics.

### 3.3 No second desktop domain architecture

Forbidden:

- Tauri-only storage authority;
- Qt-only storage authority;
- renderer-specific crypto or migration rules;
- renderer-specific project formats;
- duplicated validation;
- QML/JavaScript business rules;
- broad GPU/environment heuristics as product architecture.

### 3.4 Data integrity and security outrank migration velocity

The transition must not weaken:

- atomicity;
- durability;
- encryption;
- backup/recovery;
- migration admission;
- corruption/tamper detection;
- record identity binding;
- rollback.

### 3.5 Evidence maturity is explicit

Use the common vocabulary:

```text
LOCAL_ONLY
CI_ONLY
PACKAGED_LOCAL
PACKAGED_TARGET_ENV
FIELD_OBSERVED
```

No browser-only or unit-only result may be described as packaged desktop closure.

### 3.6 Reuse before new architecture

`docs/architecture/ARCHITECTURE-REUSE-OWNERSHIP.md` is the cross-cutting implementation-governance companion for this roadmap.

Before adding a non-trivial new crate, package, service, manager, store, queue, registry, capability detector, state machine, or renderer-specific subsystem:

1. identify the current semantic owner;
2. inventory existing reusable primitives/tests/fixtures;
3. determine whether the current owner can be extended;
4. prefer a narrow adapter where the gap is platform-specific;
5. extract a shared primitive only after real duplication exists;
6. create a new subsystem only when a distinct capability/ownership gap remains.

A roadmap capability name does **not** authorize a new crate/package by itself.

The target remains:

```text
ONE PRODUCT MODEL
ONE VERSIONED PROJECT TRUTH
ONE AUTHORITY PER SEMANTIC CAPABILITY
```

---

## 4. Tauri transitional investment policy

### TM-0 — mandatory

Fix immediately, preferably in Core/shared contracts:

- data loss/corruption;
- incorrect save/load/recovery;
- security vulnerabilities;
- secret leakage;
- updater/package integrity failures;
- startup/recovery lockout.

### TM-1 — user-blocking

Investigate hard hangs, crashes, unreadable content, broken input, or startup failure. Fix when app-owned/shared or addressable by a narrow adapter correction.

### TM-2 — high-ROI only

Allow focused responsiveness, accessibility, privacy-safe diagnostics, packaging, or adapter work only when small, measured, and reusable.

### TM-3 — reject

Do not start:

- WebKitGTK/browser-engine forks;
- broad NVIDIA/DMABUF workaround frameworks;
- global graphics override matrices as architecture;
- large Tauri-only crash/recovery subsystems;
- new Tauri-only product features;
- security weakening for compatibility.

### Mandatory investment record

Before non-trivial Tauri work:

```text
severity = TM-0 / TM-1 / TM-2 / TM-3
root cause owner = app / shared-core / adapter / runtime / compositor / driver / unknown
reproduced = yes / no / environment-limited
renderer-neutral fix = yes / no
Qt/Core reuse = high / medium / low
Tauri-only coupling = none / low / medium / high
safe small mitigation = yes / no
upstream/environment evidence = yes / no
decision = FIX / INSTRUMENT / MITIGATE / DEFER-TO-CORE / STOP-TAURI-LANE / TRANSFER-TO-QT-ACCEPTANCE
```

TM-3 proposals are rejected directly under this classification. The specialized #332 stop rule in `TAURI-TRANSITIONAL-MAINTENANCE.md` applies only to #332-style runtime investigations where evidence is being transferred to Qt; it is not a prerequisite for rejecting unrelated low-value Tauri-only work.

---

## 5. #332 becomes a cross-renderer acceptance program

### 5.1 Decomposition

| Track | Current classification | Roadmap treatment |
| --- | --- | --- |
| A Persistence/preferences | Resolved + field verified | Preserve regression tests |
| B App-owned visual/performance cost | Partially hardened | Continue portable/high-ROI work |
| C WebKitGTK/Wayland/NVIDIA differential | Runtime/environment candidate | Bounded classification; no deep workaround program |
| D Alt-Tab/background resume hang | Unresolved observable | Instrument owner; transfer scenario to Qt |
| E abnormal WebKit memory growth | Unresolved observable | Classify portable leak vs runtime amplification |

### 5.2 Portable-vs-runtime decision tree

```text
symptom
  │
  ├─ data/security defect? ───────────────► FIX (TM-0)
  │
  ├─ app/Core/state/task/memory defect? ─► FIX / DEFER-TO-CORE
  │
  ├─ small adapter defect? ───────────────► FIX / MITIGATE
  │
  ├─ WebKit/compositor/driver correlated? ► bounded evidence
  │                                          │
  │                                          ▼
  │                                  STOP-TAURI-LANE
  │                                          │
  └──────────────────────────────► Qt acceptance scenario
```

### 5.3 Alt-Tab objective

Do not ask “how do we perfect WebKitGTK?” Ask:

> **Does WorldScript-owned work cause the background/resume failure, or does the presentation runtime fail after app-owned work is bounded?**

Distinguish:

- JS/event-loop stall;
- persistence/serialization/I/O stall;
- Tauri/Rust main-process stall;
- WebKit WebProcess crash/hang;
- GPU/compositor stall;
- memory-pressure termination;
- Core worker starvation/deadlock.

### 5.4 Memory objective

**Portable leak:** application state, editor models, listeners, queues, buffers, snapshots, Core data, or app-owned resources grow without bound → fix.

**Runtime amplification/leak:** app-owned heaps remain bounded while WebKit/GPU/WebProcess memory grows abnormally → establish ownership, then transfer the soak test to Qt.

The objective is not a forensic proof of every WebKit allocation.

### 5.5 GOLDEN-DESKTOP-LIFECYCLE-332

Required semantic scenario:

1. open representative project;
2. edit manuscript;
3. cross autosave boundary;
4. background 5 seconds;
5. return and type immediately;
6. repeat 20 Alt-Tab cycles;
7. repeat with 30-second and two-minute background intervals;
8. minimize/restore;
9. navigate Settings and Writer Studio;
10. normal close/relaunch;
11. repeat with a large project;
12. 30-minute editing/memory run;
13. longer soak;
14. repeat on PWA, Tauri and Qt using the same semantic workload.

Required outcomes shared by all renderers:

- zero unbounded hangs;
- zero force-kills in an admitted acceptance run;
- no UI disappearance;
- prompt post-resume input acknowledgement;
- acknowledged edits survive;
- save/close/relaunch succeeds;
- no corruption;
- clean process-tree expectations are satisfied where the renderer has helper processes attributable to the run.

Memory outcome is renderer-status specific:

- **Qt/PWA admission or regression acceptance:** memory/resource growth must be bounded under the admitted fixture/duration and SLO; an explanation of unbounded growth is not a pass.
- **Transitional Tauri classification:** abnormal renderer/runtime-side growth may remain explicitly explained and classified only when portable/app-owned leakage has been fixed or ruled out and the authoritative #332 stop rule is otherwise satisfied. That is transfer evidence, not a generic acceptance pass.

---

## 6. Cross-renderer benchmark harness

Create reusable cross-renderer **scenario semantics and evidence contracts** before substantial Qt feature migration. Do not require one monolithic driver/framework to control React/PWA, Tauri/WebKitGTK, and Qt identically.

Preferred architecture:

```text
Scenario specification / fixture / metrics / thresholds
                    │
        ┌───────────┼───────────┐
        │           │           │
     PWA driver  Tauri driver  Qt driver
```

Share:

- scenario IDs/versions;
- fixture definitions;
- semantic workloads;
- measurement vocabulary;
- evidence manifest schema;
- accepted thresholds/decision rules.

Keep renderer-specific:

- lifecycle automation details;
- process/runtime instrumentation;
- graphics/backend probes;
- packaging/install mechanics;
- native/browser driver implementation.

### Workloads

- cold/warm startup;
- Settings navigation burst;
- manuscript typing burst;
- cursor/selection;
- scroll;
- panel/view switching;
- autosave;
- large project open/save;
- Alt-Tab/background-resume;
- minimize/restore;
- 30-minute session;
- 6-hour soak where practical;
- repeated launch/close;
- suspend/resume where supported.

### Metrics

| Metric | PWA | Tauri | Qt | GPUI later |
| --- | --- | --- | --- | --- |
| cold/warm start | baseline | baseline | target | future |
| interaction p50/p95 | baseline | baseline | target | future |
| editor input p95 | baseline | baseline | target | future |
| frame consistency | baseline | baseline | target | future |
| autosave p95 | baseline | baseline | target | future |
| idle CPU/RSS | baseline | baseline | target | future |
| 30m memory slope | baseline | baseline | target | future |
| long-soak peak | baseline | baseline | target | future |
| Alt-Tab failures | baseline | known issue | **0 target** | future |
| force-kill/crash count | baseline | baseline | **0 target** | future |

Every measurement record names build SHA, package, toolkit/runtime, OS, display protocol, compositor, GPU, driver, fixture, methodology, and evidence maturity.

---

## 7. Rust Core is the highest-value migration work

Qt must not become a new place to hide TypeScript/Tauri authority.

The **current execution order must remain consistent with `CORE-MIGRATION-LEDGER.md`**. Revision 3 does not silently reorder active Wave-2 work.

Recommended authority progression:

1. project schema/validation/migration convergence;
2. storage semantics / real serialized-project compatibility;
3. bounded task-supervision extraction already identified as a Wave-2 fast-follow;
4. diagnostics model/redaction/sink convergence already identified as a Wave-2 fast-follow;
5. Wave 3 durability/atomicity/recovery and R-15 design;
6. Wave 4 R-15 crypto/migration/rekey/admission/identity implementation;
7. AI request/orchestration contracts when separately justified by portability and stable semantics;
8. update compatibility/contracts where portable concepts genuinely exist;
9. collaboration semantics when ready.

This is an authority progression, not a mandate to create one crate per line. `ARCHITECTURE-REUSE-OWNERSHIP.md` applies: extend cohesive existing owners first and split only with demonstrated ownership/security/test/reuse value.

A renderer-ready capability has:

- no DOM dependency;
- no React lifecycle dependency;
- no Tauri dependency;
- no Qt dependency;
- deterministic typed inputs/outputs;
- typed errors;
- cancellation/backpressure where relevant;
- persistence semantics;
- security classification;
- headless tests;
- large-input behavior tests;
- migration/versioning impact;
- privacy-safe diagnostics policy.

---

## 8. R-15 and #357/#359/#360/#361 are migration accelerators

R-15 must be implemented in Rust Core and consumed by renderers. It must not be delayed merely because Tauri is transitional.

Required properties:

- authenticated encryption;
- versioned envelope;
- renderer-neutral key lifecycle;
- atomic encrypted writes;
- durability/fsync policy;
- tamper/corruption detection;
- no avoidable plaintext temporary leakage;
- backup/recovery compatibility;
- migration from existing plaintext desktop data;
- interruption testing;
- key-loss behavior;
- large-project behavior.

### #357 — durability

Define temp-file fsync, rename ordering, parent-directory fsync, platform differences, errors, and recovery evidence.

### #359 — crash-resumable rekey

Rekey/re-encryption must be resumable and idempotent with persisted progress, old/new key identity, rollback/recovery, and interruption tests.

### #360 — migration admission

Reads/writes must participate in coherent migration admission. No renderer may bypass a crypto migration lock or accidentally observe mixed authority.

### #361 — AAD/record identity

Ciphertext must bind to the logical record/file identity and relevant envelope metadata so cross-file substitution is detected.

**Qt Beta is blocked until required R-15 desktop properties are implemented.** No renderer may create a private substitute.

---

## 9. Revised program gates

### G0 — CEF Exit

**Complete.** Preserve historical evidence only.

### G1 — Core Native-Ready

Requires DesktopPlatform enforcement, headless project lifecycle, renderer-neutral contracts, storage semantics, R-15 architecture approval, and native-readiness CI.

### G1.5 — Tauri Evidence Exit / Qt Transfer Readiness — NEW

This gate does **not** require #332 to be fully fixed in Tauri.

Requires:

- #332 decomposed by ownership;
- persistence/data-loss risks fixed or separately TM-0 tracked;
- portable memory leak investigation reaches defensible classification;
- Alt-Tab owner narrowed enough to choose FIX/MITIGATE/STOP;
- no planned broad WebKitGTK/NVIDIA workaround architecture;
- GOLDEN-DESKTOP-LIFECYCLE-332 encoded as reusable evidence specification;
- PWA/Tauri baseline measurements captured on representative target hardware;
- residual Tauri runtime limitations documented.

Exit:

> **Qt may proceed without waiting for perfection of WebKitGTK-specific residuals.**

### G2 — Qt Implementation Admission

Requires:

- Qt license strategy;
- Qt version/LTS strategy;
- bridge scorecard;
- early killer gates;
- packaged native/Core roundtrip;
- IME/input feasibility;
- accessibility feasibility;
- lifecycle/background-resume feasibility;
- Linux/Wayland/NVIDIA probe where applicable;
- updater/packaging design.

### G2.5 — Qt Renderer Differential Gate — NEW

Before broad UI migration:

- capture Qt Quick graphics backend;
- capture GPU/driver and Wayland/X11 identity;
- observe multi-GPU selection where applicable;
- run 20-cycle Alt-Tab scenario;
- demonstrate no catastrophic memory growth;
- demonstrate competitive basic input latency;
- demonstrate no new killer renderer/lifecycle problem.

Failure pauses broad Qt investment and triggers architecture review.

### G3 — Qt Beta

Requires core writing workflows, project compatibility, R-15, recovery, updater/rollback, accessibility, performance SLOs, packaged #332 lifecycle acceptance, and no unresolved Critical/High security findings.

### G4 — Qt Stable

Requires parity, soak, large-project, installer/signing/notarization, rollback, diagnostics, migration, support playbooks, and field evidence.

### G5 — Tauri Retirement

Only after Qt Stable plus field-observation/rollback window. Remove Tauri; do not keep a permanent third desktop runtime.

### G6+ — GPUI

Remains separately admitted after Qt evidence and must consume the same Core/contracts/benchmark architecture.

---

## 10. Revised execution waves

### Wave 0 — Strategy reset / CEF retirement — COMPLETE

Preserve the current completed status.

### Wave 1 — DesktopPlatform boundary — COMPLETE

Preserve and strengthen as a permanent architecture guardrail.

### Wave 2 — Rust Core extraction — IN PROGRESS

Continue renderer-neutral authority extraction according to the current Core Migration Ledger: project/schema/validation and storage convergence remain the primary work; bounded task-supervision and diagnostics extraction remain the documented fast-follows. Do not substitute broad Qt UI work or pull Wave-3/4 R-15 implementation ahead of unresolved Wave-2 authority prerequisites.

### Wave 2.5 — Desktop differential baseline & #332 classification — NEW

Bounded evidence work, not a Tauri optimization wave.

Deliverables:

- decomposed #332 issue;
- process/lifecycle instrumentation plan;
- portable-memory classification;
- baseline PWA/Tauri benchmark;
- GOLDEN-DESKTOP-LIFECYCLE-332;
- Tauri stop-rule decision record;
- known-runtime-limitations record where justified.

Exit: G1.5.

### Wave 3 — Storage correctness and R-15 design

All output renderer-neutral and Qt-consumable. This wave begins from the Wave-2 storage/schema authority baseline rather than replacing it.

### Wave 4 — R-15 implementation

Implement in Rust Core. Close #357/#359/#360/#361 only with destructive/interruption/security evidence.

### Early Qt feasibility lanes

Begin as soon as the typed Core probe permits. Disposable only; no product shell.

#### QF-A — lifecycle/bridge

Window, QML, typed Rust call/event, async/cancellation, shutdown, repeated launch/close.

#### QF-B — input/accessibility

Keyboard/focus, IME, Unicode, BiDi/RTL, scalable/high-contrast text, accessibility tree.

#### QF-C — crash/recovery

Intentional failure, diagnostics, restart/recovery, no data corruption.

#### QF-D — Linux graphics differential — NEW

On representative Linux/Wayland/NVIDIA hardware:

- identify Qt Quick graphics backend;
- record GPU/driver selection;
- test multi-GPU behavior where present;
- run reduced-motion/high-contrast paths;
- run Alt-Tab/minimize/restore;
- capture memory trend;
- compare with PWA/Tauri without framework-marketing conclusions.

Kill criterion: catastrophic renderer/lifecycle behavior that cannot be bounded without violating the target architecture.

The formal checklist and evidence row for QF-D live in `QT-EARLY-KILLER-GATES.md`; it must not remain a roadmap-only lane.

### Wave 4.5 — Formal Qt killer-gate qualification

Consume early-lane evidence; add packaged identity, signing/update trust, rollback, least privilege, and security evidence.

### Wave 5 — Reusable Qt learning/benchmark harness

Include:

- accepted bridge/thread/lifetime proof;
- file dialog;
- clipboard;
- packaged artifact;
- benchmark hooks;
- GOLDEN-DESKTOP-LIFECYCLE-332 runner/spec;
- evidence manifest.

The harness consumes the shared semantic scenario/evidence contract from Section 6 and may use renderer-specific drivers; it does not require PWA/Tauri/Qt automation internals to be identical.

### Wave 6 — Qt shell/design system

Qt Quick/QML shell, menus, pane/dock model, theme tokens, typography, icons, focus, shortcuts, notifications, dialogs, errors. No duplicated domain logic.

### Wave 7 — Qt project lifecycle vertical slice

Launch → recent/open → validate/migrate/decrypt → edit metadata → save → close → reopen using real Core storage/R-15 semantics.

### Wave 8 — Qt manuscript editor foundation

Highest-risk product surface. Prove correctness before polish: large text, graphemes, Unicode, IME, BiDi/RTL, selection, cursor, undo/redo, clipboard, drag/drop, find/replace, autosave/recovery.

### Wave 9 — Qt performance + #332 differential

Formal cross-renderer acceptance wave comparing PWA, final supported Tauri baseline, and Qt packaged artifact.

Required scenarios:

- input p50/p95;
- navigation;
- scroll/frame consistency;
- background/resume;
- memory slope;
- long soak;
- large project;
- autosave;
- reduced-motion/effects-equivalent presentation modes;
- target Linux/Wayland/NVIDIA hardware.

Exit: no catastrophic resource/lifecycle behavior, **bounded Qt memory/resource growth under admitted fixtures**, and accepted budgets.

### Waves 10–20

Retain the existing canonical roadmap domains and sequencing:

- Wave 10 — knowledge surfaces;
- Wave 11 — plot/graph/visual surfaces;
- Wave 12 — AI orchestration;
- Wave 13 — task supervisor/native services;
- Wave 14 — accessibility hard gate;
- Wave 15 — packaging/signing/update;
- Wave 16 — crash diagnostics/recovery;
- Wave 17 — security hardening;
- Wave 18 — packaged beta;
- Wave 19 — parity/stable cutover;
- Wave 20 — Tauri retirement.

Revision 3 tightens their admission evidence; it does not discard their existing product scope.

---

## 11. Qt graphics/performance strategy

Because the target is Qt Quick/QML, performance work must use Qt-native concepts rather than importing WebKitGTK assumptions.

Record for relevant packaged runs:

- Qt version/build;
- Qt Quick scene-graph backend;
- graphics API/backend selected;
- GPU identity;
- driver version;
- Wayland/X11;
- compositor/desktop environment;
- multi-GPU selection where applicable;
- render-thread stalls;
- GUI-thread stalls;
- scene-graph/resource growth;
- memory trend;
- fallback/software-rendering state if encountered.

Do not add permanent backend overrides solely to make one benchmark green. Any override needs a compatibility matrix and explicit rationale.

---

## 12. Performance SLO policy

Do not invent absolute SLOs before baseline data exists. Establish budgets from representative hardware and workflows, then freeze them as regression gates.

At minimum define:

- input latency p50/p95;
- navigation latency p95;
- project-open p50/p95 by fixture class;
- autosave p95;
- idle CPU/RSS;
- 30-minute memory-growth slope;
- long-soak maximum tolerated growth;
- resume-to-first-input budget;
- zero-hang lifecycle requirement;
- zero-corruption requirement.

A faster average must not hide catastrophic tail latency or hangs. For Qt admission, unexplained or explained **unbounded** growth is a failure; explanation may classify a transitional Tauri limitation but cannot convert an unbounded Qt leak into a pass.

---

## 13. Testing architecture

1. **Core:** Rust unit/property/fuzz/destructive tests.
2. **Contracts:** common capability contract suites.
3. **Renderer integration:** Qt lifecycle/input/accessibility/model tests; Tauri only while supported.
4. **Packaged E2E:** actual artifacts on target OS/runtime.
5. **Cross-renderer benchmark:** shared semantic workloads/fixtures/evidence schema with renderer-specific drivers.
6. **Field/soak:** representative user environments, especially Linux/Wayland/NVIDIA for #332 lineage.

---

## 14. CI/CD strategy

Keep CI change-aware and authoritative.

Add Qt jobs only when real Qt code exists; do not create placeholder native CI.

When Qt begins, separate:

```text
fast Core/contracts gate
web/PWA gate
Qt build/unit gate
Qt packaged smoke
nightly heavy platform matrix
scheduled soak/performance evidence
release-candidate full matrix
```

Performance results should be retained as evidence artifacts. Do not make noisy microbenchmarks required until variance and runner suitability are understood.

CodeQL/SAST/SCA/signature/release-authority requirements remain independent of renderer migration.

---

## 15. Security and bridge hardening

The Qt↔Rust boundary is a security and correctness boundary.

Require:

- named typed operations;
- versioned contracts;
- bounded payloads;
- explicit ownership/lifetimes;
- thread-affinity rules;
- structured errors;
- cancellation;
- bounded queues/backpressure;
- no arbitrary command execution;
- negative tests;
- fuzz/property tests where appropriate;
- no secrets in QML;
- no project truth in QML JavaScript.

Bridge selection is scorecard-driven, not prototype-driven.

---

## 16. Migration observability

Create a privacy-safe desktop evidence manifest with fields such as:

```text
app_version
build_sha
package_kind
renderer
runtime_or_qt_version
core_contract_version
os
kernel
session_type
compositor
gpu_vendor/model
driver
graphics_backend
fixture_id/size_class
scenario_id/scenario_version
duration buckets
memory buckets
result
failure classification
evidence maturity
```

Never include manuscript text, prompts, API keys, tokens, encryption keys, or private paths.

---

## 17. Stop-loss / sunk-cost rules

Stop or reframe a task when all are true:

- strongly renderer-specific;
- does not protect data/security;
- reusable Core/Qt value is low;
- renderer replacement is already approved;
- workaround is broad/brittle;
- a bounded diagnostic can preserve the lesson as an acceptance test.

| Work | Reuse value |
| --- | --- |
| DesktopPlatform/contracts | Very high |
| Rust Core | Very high |
| storage/recovery/R-15 | Very high |
| task supervision/diagnostics | Very high |
| portable app performance | High |
| lifecycle acceptance specs | High |
| memory classification | Medium-high |
| small Tauri adapter fixes | Medium |
| WebKitGTK compositor tuning | Low |
| global NVIDIA/DMABUF workaround architecture | Very low |
| WebKitGTK-specific recovery subsystem | Very low |

This is a prioritization heuristic, not an accounting claim.

---

## 18. Migration PR governance

Every migration PR should state:

```text
Wave / gate:
Authority changed? YES/NO
Existing semantic owner / seed audited? YES/NO
New crate/package/service introduced? YES/NO — if YES, why extension/adapter/extraction was insufficient:
Duplicate authority removed/avoided? YES/NO
DesktopPlatform boundary affected? YES/NO
Direct Tauri import added? YES/NO
Qt-specific API leaked into shared code? YES/NO
R-15 / #357/#359/#360/#361 invariant affected? YES/NO
#332 acceptance scenario affected? YES/NO
Data format changed? YES/NO
Security boundary changed? YES/NO
Evidence maturity:
Rollback:
```

Merge only after the **complete applicable required and advisory validation suite** is green, including CI, CodeQL/security/signature checks and all change-relevant advisory jobs such as E2E Deep, Lighthouse, Storybook, VRT, or equivalent evidence lanes. An advisory failure is not merge-permissive merely because branch protection does not technically require that context. All material review threads must also be resolved. Evidence-only work must not silently change product authority.

---

## 19. Definition of Qt success

Qt succeeds only if it demonstrates:

- correct text editing/input;
- renderer-neutral data semantics;
- R-15/security parity;
- robust recovery;
- accessible workflows;
- predictable and bounded memory/resource behavior under admitted fixtures;
- acceptable interaction latency;
- background/resume stability;
- packaged update/rollback;
- representative Linux/Wayland/NVIDIA behavior;
- target Windows/macOS evidence as applicable;
- no reintroduction of renderer-specific domain authority.

#332-derived scenarios become positive proof that the migration escaped the old renderer failure class without carrying portable defects forward.

---

## 20. Tauri retirement readiness

Tauri can be retired when:

- Qt has G4 Stable admission;
- field-observation window passes;
- project compatibility/migration are proven;
- update/rollback/recovery are proven;
- #332 lifecycle scenario passes on Qt packaged target hardware;
- residual Tauri-only limitations are documented;
- no Tauri-only data is stranded;
- PWA remains unaffected;
- rollback/communication plan exists;
- removal deletes obsolete Tauri code/dependencies without weakening shared contracts.

Tauri retirement is **not** contingent on retroactively fixing every WebKitGTK limitation.

---

## 21. GPUI re-entry boundary

GPUI remains deferred. If later admitted, it must consume the same Core and evidence architecture.

Admission must prove platform support, framework/update policy, text/IME/BiDi, accessibility, performance value, packaging/update feasibility, maintenance health, no speculative React-binding dependency, GOLDEN-DESKTOP-LIFECYCLE-332 equivalent, and project/R-15 compatibility.

Qt work should maximize Core/contracts/test reuse so future GPUI work is a renderer project rather than another domain migration.

---

## 22. Immediate next actions

### Now

1. keep current H1 CI/evidence work isolated from desktop authority changes;
2. adopt the revised #332 decomposition and stop rule;
3. preserve the Tauri import boundary as required CI;
4. define the shared cross-renderer scenario/evidence schema and renderer-specific drivers;
5. create privacy-safe lifecycle/process instrumentation;
6. classify Alt-Tab only far enough to determine app/shared/runtime ownership;
7. classify abnormal memory growth as portable vs runtime-side;
8. avoid new global WebKitGTK/NVIDIA product overrides.

### Current/next Core tranche

9. complete Wave-2 first-slice convergence — project schema/validation (`CORE-MIGRATION-LEDGER.md` rows 1-2) and the narrow fs plain load/save round-trip (row 3); this excludes IDB/encryption, which stays Wave 3-4 (row 6);
10. complete the project state-shape compatibility adapter (row 9) — a required prerequisite before G1 evaluation, already locally proven with a first observation-only desktop caller, no authority switch;
11. continue the bounded task-supervision (row 5) and logger/diagnostics (row 4) fast-follows already recorded in `CORE-MIGRATION-LEDGER.md`;
12. then enter Wave 3 for durability/recovery/R-15 architecture and destructive-test design;
13. then implement Wave-4 crash-resumable rekey, migration admission, AAD/record identity, and durable protected writes in Rust Core;
14. keep AI/domain authority out of Qt/QML and do not pull browser WebGPU implementation into Rust for symmetry.

### Earliest Qt tranche

15. disposable lifecycle/bridge probe;
16. input/accessibility probe;
17. crash/recovery probe;
18. Linux/Wayland/NVIDIA graphics differential probe;
19. GOLDEN-DESKTOP-LIFECYCLE-332 as soon as semantically possible;
20. G2/G2.5 GO/NO-GO before broad UI migration.

---

## 23. Final strategic rule

```text
Fix what can migrate.
Measure what can regress.
Classify what is runtime-specific.
Stop when Tauri-only ROI collapses.
Turn failures into acceptance tests.
Prove Qt early on the hardware that hurt Tauri.
Keep project truth in Rust.
Reuse proven owners before inventing new architecture.
Retire Tauri only after Qt earns it.
```

This minimizes sunk cost without using the Qt migration as an excuse to ignore data-integrity, security, lifecycle, application-owned performance defects, or architecture duplication.