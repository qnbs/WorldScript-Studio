# WorldScript Studio — Qt + GPUI Multi-Renderer Desktop Roadmap & Realization Concept

**Status:** Adopted as the binding strategic architecture via ADR-0021 (Wave 0 PR A) — see
[ADR-0021](../adr/0021-qt-gpui-native-desktop-strategy.md). Adoption of the *decision* is distinct
from *execution*: Wave 0's actual CEF source/CI retirement (PR B) has not started as of this
writing — see §15 below for the current per-wave status.
**Repository:** `qnbs/WorldScript-Studio`
**Roadmap generation date:** 2026-08-20
**Supersedes:** the CEF-first desktop migration strategy and all CEF-dependent execution sequencing
(ADR-0019, ADR-0020 — see [`docs/historical/cef/README.md`](../historical/cef/README.md))
**Transitional desktop runtime:** Tauri 2 / system WebView, retained only as a reference/fallback
until Qt admission and cutover gates are satisfied, **and itself retired once Qt reaches Stable**
**Primary native desktop line:** Qt 6 / Qt Quick (QML) — Hardened / Accessible / Long-Lived Edition
**Secondary native desktop line:** GPUI — Vision / High-Performance Edition
**Web line:** React + Vite PWA, retained as a first-class product surface and behavioral reference
**Authoritative product core:** Rust
**Architecture rule:** no domain/business logic duplication across renderers
**Revision:** 1 — CEF-free strategic reset

## Document status and corrections applied at adoption (Wave 0, 2026-08-20)

This document is adopted verbatim from the strategic roadmap supplied at reset time, with two
corrections applied so it accurately reflects current repository state rather than the assumptions
it was drafted against:

1. **Wave 1 (`DesktopPlatform` boundary hardening) is not future work — it is already complete on
   `main`.** `packages/desktop-contracts` (14-facet `DesktopPlatform` interface, Tauri/Web adapters),
   `services/desktopPlatform.ts`, and the zero-tolerance `scripts/check-tauri-import-boundary.mjs`
   guardrail (wired into `.github/workflows/ci.yml`, `pnpm run guardrail:desktop-imports`) all shipped
   via PR #384 and PR #385. See the Wave 1 entry below for the corrected status marker, and
   `docs/architecture/native-readiness.md` for the live scorecard.
2. **The R-15 desktop at-rest-encryption deliverable (§9) has concrete, already-tracked open gaps to
   close**, not an abstract future risk: GitHub issues **#357** (atomic writes need fsync of temp
   file + parent directory), **#359** (fs-data key-rotation migration not crash-resumable), **#360**
   (fs reads/writes don't participate in the encryption-migration admission lock), and **#361** (fs
   ciphertext has no AAD/identity binding, enabling cross-file substitution) are all open, Tauri-
   scoped issues today. R-15 implementation work (Wave 3–4) must close them, not merely avoid
   regressing them. **Issue #332** (a live, user-reported Tauri `.deb` sluggishness report) remains
   open as the historical/ongoing performance baseline referenced throughout this document.

Everything else below is the roadmap as adopted, unmodified.

> **Decision summary:** WorldScript Studio will not continue the CEF desktop-runtime program. The
> product will instead mature into a renderer-independent Rust platform with two native desktop
> surfaces: Qt as the first production-native, hardened reference desktop and GPUI as the
> performance-oriented second native product line. The React/PWA remains first-class. Tauri remains
> transitional only until Qt has proven replacement parity, **and is itself retired once that parity
> is proven** — it is not a permanent third runtime. CEF-specific source, build, runtime, packaging
> and operational requirements are removed from the target architecture.

---

# 0. Executive decision

WorldScript Studio adopts a **Core First → Qt Stable → GPUI Expansion** strategy.

The previous CEF-first path is retired as an implementation target. Work already completed during the
CEF investigation is not discarded blindly: renderer-neutral contracts, lifecycle lessons, process
diagnostics, CI improvements, storage/security findings, accessibility evidence, native-readiness
work and platform-boundary improvements are retained when they are independently useful. CEF-specific
host code, SDK acquisition, Chromium subprocess assumptions, Crashpad-specific integration, CEF
packaging and CEF-only operational complexity are not carried forward as product requirements.

The binding strategic order becomes:

```text
CURRENT
React + Vite + Tauri 2
        │
        ▼
Renderer-neutral platform boundary
        │
        ▼
Rust-authoritative Core
Storage / Crypto / Migration / Tasks / AI / Diagnostics
        │
        ▼
Qt architecture + executable learning harness
        │
        ▼
Qt vertical slices
        │
        ▼
Qt packaged beta
        │
        ▼
Qt parity / security / accessibility / performance / recovery
        │
        ▼
Qt Stable
        │
        ▼
Tauri retirement review
        │
        ├──────────────────────────────┐
        │                              │
        ▼                              ▼
Web/PWA continues                GPUI admission
                                      │
                                      ▼
                               GPUI vertical slices
                                      │
                                      ▼
                               GPUI packaged beta
                                      │
                                      ▼
                               GPUI parity/hardening
                                      │
                                      ▼
                                GPUI Stable
```

The end state is deliberately multi-renderer:

```text
                         WORLD SCRIPT PLATFORM
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
        WorldScript Core                       Shared Contracts
          (pure Rust)                    typed commands/events/schemas
              │                                       │
              └───────────────────┬───────────────────┘
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
                  ▼               ▼               ▼
              Web / PWA        Qt Native       GPUI Native
             React/Vite       QML/Qt Quick      Rust/GPUI
```

The three surfaces are products, not three implementations of the domain.

---

# 1. Strategic vision

WorldScript Studio should become a **renderer-independent writing platform** rather than an
application whose product semantics are entangled with a particular UI runtime.

The durable investment is therefore not Qt, GPUI, React or any windowing toolkit. It is:

- the project format;
- the domain model;
- persistence;
- encryption;
- migration;
- recovery;
- AI orchestration;
- task supervision;
- collaboration semantics;
- diagnostics;
- update policy;
- typed contracts;
- deterministic state transitions;
- testable product behavior.

Renderers consume those capabilities.

The architectural target is:

```text
                         WORLD SCRIPT PLATFORM
                                  │
            ┌─────────────────────┴─────────────────────┐
            │                                           │
     Authoritative Rust Core                    Versioned Contracts
            │                                           │
    ┌───────┼────────┬─────────┬────────┐                │
    │       │        │         │        │                │
 Storage  Crypto  Projects    AI     Tasks/Diag          │
    │       │        │         │        │                │
    └───────┴────────┴─────────┴────────┴────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
             React/PWA          Qt 6              GPUI
             browser           native             native
```

The defining invariant is:

> **A renderer may own presentation. It may not own product truth.**

---

# 2. Why Qt and GPUI

## 2.1 Qt is the primary production-native admission path

Qt is selected as the first native desktop target because WorldScript needs a mature toolkit for a
demanding writing application with:

- complex text input;
- IME;
- BiDi/RTL;
- accessibility;
- high-DPI;
- printing;
- native menus and dialogs;
- clipboard and drag/drop;
- cross-platform windowing;
- mature localization;
- long-lived desktop deployments;
- extensive profiling/debugging facilities;
- native rendering without requiring a browser engine for the principal UI.

The preferred presentation technology is **Qt 6 + Qt Quick/QML**, with a deliberately thin C++
integration layer where Qt's native API requires it and the authoritative application/domain
implementation remaining in Rust.

Qt Widgets are allowed for narrowly justified platform integrations or controls where they are
materially superior, but the default product UI architecture is Qt Quick/QML to avoid two competing
Qt presentation systems.

Qt WebEngine is **not part of the default architecture**. It may only be admitted for a narrowly
isolated capability after a separate architecture/security/license review. Reintroducing a
Chromium-backed primary application surface through Qt WebEngine would defeat the purpose of this
reset.

## 2.2 GPUI is the second native product line

GPUI is selected as the strategic high-performance Rust-native track because it aligns strongly with:

- Rust ownership;
- GPU-accelerated UI;
- editor-centric interaction;
- low-latency rendering;
- large virtualized surfaces;
- native state/entity models;
- direct reuse of the Rust core without a C++/QML boundary.

However, GPUI remains an actively evolving, pre-1.0 framework. Therefore GPUI is not allowed to
become the first replacement for the production desktop until its own admission gates are satisfied.

The project must not assume a stable React→GPUI binding ecosystem. React reuse means, in descending
order of reliability:

1. reuse of domain behavior through the shared Rust core;
2. reuse of schemas/contracts;
3. reuse of design tokens, icons and assets;
4. reuse of behavioral/interaction specifications and Golden Master scenarios;
5. optional generated bindings or adapter layers where proven;
6. direct React component reuse only if a maintained, production-quality mechanism is independently
   demonstrated.

No roadmap milestone may depend on an unproven "React bindings" assumption.

## 2.3 React/PWA remains first-class

The PWA is not merely a temporary artifact. It remains:

- the web product;
- a Chromium/browser behavioral comparator;
- a rapid UI experimentation surface;
- an accessibility and i18n reference;
- a contract consumer;
- a regression oracle for domain behavior where appropriate.

The PWA must consume the same versioned product contracts wherever practical.

---

# 3. Binding program invariants

## 3.1 Core first, renderer second

Any capability that materially affects project truth must be implementable and testable without Qt,
GPUI, React, DOM or Tauri.

Examples:

- save;
- load;
- project validation;
- migration;
- encryption;
- snapshots;
- recovery;
- AI request orchestration;
- task cancellation;
- model metadata;
- export transforms;
- collaboration state;
- diagnostics state.

## 3.2 Qt first, GPUI second

Qt is the first native production target. GPUI implementation does not race Qt to parity.

Before Qt Stable, GPUI work is limited to:

- architecture documentation;
- dependency and license evaluation;
- small disposable spikes;
- performance experiments;
- text/input/accessibility feasibility;
- contract compatibility checks.

No second full feature-parity program begins before the GPUI Admission Gate.

## 3.3 No renderer-specific business rules

Forbidden:

```text
if renderer == Qt:
    save differently
if renderer == GPUI:
    migration behaves differently
```

Allowed:

```text
renderer asks Core to SaveProject(command)
Core validates and persists
renderer presents result
```

## 3.4 DesktopPlatform remains the transition boundary

Existing `DesktopPlatform` work is retained and generalized — **and already exists**:
`packages/desktop-contracts` (PR #384/#385) already defines a 14-facet renderer-neutral capability
interface with `TauriDesktopPlatform` and `WebDesktopPlatform` adapters, enforced by
`scripts/check-tauri-import-boundary.mjs` in CI.

The boundary must evolve from "hide Tauri" into "define product capabilities independent of
renderer" — which is exactly what the existing interface already does; a future Qt or GPUI adapter
implements the same `DesktopPlatform` interface without touching call sites.

During transition:

```text
React/Tauri adapter ─┐
Qt adapter ----------┼→ Shared capability contracts → Rust Core
GPUI adapter --------┘
```

Direct `@tauri-apps/*` imports remain confined to approved Tauri adapter locations, mechanically
enforced.

Qt and GPUI APIs must not leak into shared/domain code.

## 3.5 Data integrity outranks UI velocity

No renderer migration may weaken:

- atomic saves;
- append semantics;
- backups;
- recovery;
- migration;
- encryption;
- corruption detection;
- rollback;
- project compatibility.

## 3.6 IPC/FFI is a security boundary

Qt↔Rust and any process boundary must use:

- named operations;
- typed inputs/outputs;
- validation;
- explicit ownership;
- size limits;
- cancellation where relevant;
- bounded queues/backpressure;
- structured errors;
- auditability;
- no arbitrary command execution.

## 3.7 Renderer parity means workflow parity, not pixel identity

Qt and GPUI may have different UI philosophies.

Parity is defined by user outcomes:

- create/open project;
- write/edit;
- autosave;
- undo/redo;
- plot;
- character/world management;
- AI assist;
- import/export;
- backup/recovery;
- settings;
- diagnostics;
- accessibility;
- update.

## 3.8 Tauri is transitional, not a new investment target

Tauri remains:

- current production/reference runtime;
- fallback while Qt lacks parity;
- regression comparator;
- emergency support path.

Do not build large new Tauri-only architecture. **Tauri is retired (roadmap Wave 20, gate G5) once Qt
reaches Stable (G4) plus a field-observation window — it is not a permanent third runtime alongside
Qt and GPUI.**

## 3.9 CEF is removed from the target architecture

After the reset reconciliation:

- no CEF SDK fetch in required CI;
- no CEF host in product packaging;
- no CEF-specific runtime dependency;
- no Crashpad/Chromium fork obligation;
- no CEF wave may gate Qt/GPUI;
- historical CEF research may remain archived as engineering evidence
  (`docs/historical/cef/README.md`).

---

# 4. Product lines

## 4.1 WorldScript Web/PWA

**Profile:** ubiquitous, browser-native, rapidly deployable.

Responsibilities:

- browser product;
- web collaboration;
- rapid experimentation;
- browser accessibility;
- compatibility reference;
- contract conformance.

## 4.2 WorldScript Qt — Hardened Edition

**Profile:** robustness, accessibility, security, enterprise readiness, predictable support.

Priorities:

1. data integrity;
2. accessibility;
3. IME/BiDi/text correctness;
4. security;
5. recovery;
6. packaging/updater;
7. predictable performance;
8. long-term maintainability.

## 4.3 WorldScript GPUI — Vision Edition

**Profile:** low latency, GPU-native interaction, large-document responsiveness, Rust-native
architecture.

Priorities:

1. editor latency;
2. frame consistency;
3. memory efficiency;
4. large virtualized views;
5. native Rust integration;
6. high-performance graph/board interactions;
7. eventual parity after framework maturity.

---

# 5. Technology decisions

## 5.1 Rust Core

Create or converge toward workspace crates with responsibilities similar to:

```text
crates/
  worldscript-core/
  worldscript-project/
  worldscript-storage/
  worldscript-crypto/
  worldscript-migrations/
  worldscript-tasks/
  worldscript-ai/
  worldscript-diagnostics/
  worldscript-contracts/
  worldscript-update/
  worldscript-collaboration/
```

Exact names follow repository reality; do not perform cosmetic restructuring without benefit. **Note:**
`apps/desktop-cef/rust-core/` (removed in Wave 0) was a 22-line FFI-boundary proof with no domain
logic and does not seed this work — the new Core starts from a fresh capability inventory of existing
TypeScript domain logic, primarily against `src-tauri/`'s ~1,610 lines of real production Rust as the
comparison baseline.

## 5.2 Qt integration model

Preferred model:

```text
QML / Qt Quick
      │
      ▼
thin Qt-facing C++ façade
      │
      ▼
stable Rust FFI boundary
      │
      ▼
WorldScript Rust Core
```

Alternative bridges (`cxx`, generated C ABI, qmetaobject-style approaches, cxx-qt or equivalent)
require an explicit scorecard. Selection criteria:

- Qt 6 support;
- QML property/signal integration;
- async support;
- ownership clarity;
- thread-affinity correctness;
- error mapping;
- build reproducibility;
- Windows/macOS/Linux support;
- maintenance health;
- unsafe surface;
- generated-code inspectability;
- license;
- upgrade burden.

Do not choose the bridge because a prototype compiles.

## 5.3 GPUI integration model

Preferred:

```text
GPUI presentation/state entities
          │
          ▼
worldscript-contracts
          │
          ▼
WorldScript Rust Core
```

No FFI should be required for ordinary Core consumption.

Third-party GPUI component libraries may accelerate controls, docking, tables and text prototypes,
but each must pass:

- license review;
- accessibility review;
- IME review;
- platform review;
- API stability review;
- dependency/supply-chain review;
- performance verification.

---

# 6. Native-readiness scorecard

Every domain capability receives a scorecard:

```text
[ ] no DOM dependency
[ ] no React lifecycle dependency
[ ] no Tauri API dependency
[ ] no Qt dependency
[ ] no GPUI dependency
[ ] deterministic inputs/outputs
[ ] typed errors
[ ] cancellation semantics defined
[ ] persistence semantics defined
[ ] security classification defined
[ ] headless tests exist
[ ] large-input behavior tested
[ ] migration/versioning impact known
[ ] telemetry/diagnostics policy known
```

A capability failing the scorecard is not renderer-ready. The existing `docs/architecture/native-readiness.md`
is the live scorecard document for this repository — extend it, do not fork a duplicate.

---

# 7. Accessibility strategy

Accessibility is a release property, not a renderer feature.

## Shared requirements

- WCAG 2.2 AA target for applicable workflows;
- complete keyboard operation;
- focus visibility;
- logical focus order;
- screen-reader semantics;
- high contrast;
- reduced motion;
- scalable text;
- zoom;
- IME;
- RTL/BiDi;
- no color-only state;
- accessible errors and notifications.

## Qt

Qt Quick accessibility semantics must be explicit for custom controls. Automated smoke tests must be
supplemented by real AT validation on supported platforms.

Required platform matrix eventually includes:

- Windows UI Automation;
- macOS accessibility APIs / VoiceOver;
- Linux AT-SPI / Orca where supported.

## GPUI

Accessibility is an explicit admission risk. GPUI must not be promoted to production parity until its
accessibility behavior is proven for WorldScript's actual editor and complex controls.

A fast renderer that cannot satisfy required assistive-technology workflows is not production-ready.

---

# 8. Security architecture

The desktop reset must strengthen, not postpone, security.

## 8.1 R-15 — desktop data-at-rest encryption

R-15 becomes a cross-renderer Core requirement.

Encryption must not be implemented separately in Qt and GPUI.

Required properties:

- authenticated encryption;
- versioned envelope format;
- key lifecycle;
- key derivation/storage strategy;
- atomic encrypted writes;
- corruption/tamper detection;
- migration from existing desktop data;
- backup compatibility;
- recovery behavior;
- no plaintext temporary-file leakage where avoidable;
- secure deletion claims avoided unless actually supportable;
- tests for interruption and partial writes.

**Concrete open gaps this must close (see Document status note above):** issues #357, #359, #360,
#361 — all open on the current Tauri fs-backed encryption path as of Wave 0.

## 8.2 Historical #359/#360/#361 requirements

The exact current repository state must be reconciled before implementation. Their security/data-
integrity invariants are treated as non-regression requirements, not as closed-history trivia.

A migration PR must explicitly answer:

```text
Does this change affect any invariant established by #359/#360/#361?
YES / NO
Evidence:
```

**Current status (2026-08-20):** all three issues are open on GitHub, each documenting a real,
unresolved correctness gap in the Tauri fs-backed encryption path (crash-resumability, admission-lock
participation, AAD/identity binding respectively). None are fixed by Wave 0 — they remain concrete
inputs to the future Core storage/crypto design.

## 8.3 #332

Issue #332 remains a performance/stability evidence source.

The Qt migration must not merely declare the WebKitGTK symptom irrelevant. It should preserve the
useful lessons:

- long-session memory behavior;
- large-project behavior;
- animation/transparency cost;
- serialization amplification;
- autosave/snapshot amplification;
- process/resource diagnostics.

Qt and GPUI receive their own #332-equivalent performance proofs.

**Current status (2026-08-20):** Issue #332 is open on GitHub — a live, user-reported Tauri `.deb`
sluggishness report on high-end hardware, not yet root-caused by a maintainer. It stays open and
untouched by Wave 0; it is cited here as the ongoing performance baseline any native renderer must
not regress relative to.

---

# 9. Performance SLO framework

Performance is measured against workflows, not framework marketing.

Baseline dimensions:

- cold start;
- warm start;
- project open;
- 1 MB / 10 MB / large-real-world manuscript;
- typing latency;
- cursor latency;
- selection;
- scroll;
- search;
- autosave;
- snapshot;
- AI streaming;
- board interaction;
- graph interaction;
- idle CPU;
- idle RAM;
- 30-minute session;
- 6-hour soak;
- repeated open/close;
- suspend/resume;
- GPU loss/recovery where relevant.

Qt targets:

```text
No visible input jank in normal manuscript editing
P95 interaction latency explicitly budgeted
Idle CPU near quiescent
Memory growth bounded during soak
No unbounded scenegraph/resource accumulation
```

GPUI aspirational target:

```text
120 Hz-capable editor path where hardware/display support it
frame budget < 8.33 ms for designated interactions
```

The 120 fps target is a performance objective, not a release claim until measured on defined
hardware.

---

# 10. Testing architecture

## Layer 1 — pure Core

Fast Rust unit/property tests.

## Layer 2 — contract tests

Every renderer adapter must pass the same capability contract suite.

## Layer 3 — renderer integration

Qt and GPUI-specific tests.

## Layer 4 — packaged E2E

Tests run against the actual packaged application.

## Layer 5 — field/soak

Long-running real-world validation.

## Golden Master philosophy

Golden Masters should capture **behavior and data**, not brittle pixels by default.

Examples:

- project after migration;
- command result;
- export output;
- recovery state;
- event sequence;
- accessibility tree expectations where stable.

Visual regression remains useful for selected UI surfaces.

---

# 11. CI architecture

Use change-aware CI.

```text
                 FAST GATE
                    │
          ┌─────────┼─────────┐
          │         │         │
       Core       Web       Native
                  React       │
                         ┌────┴────┐
                         │         │
                        Qt       GPUI
```

Required principles:

- path-aware heavy jobs;
- concurrency cancellation for obsolete PR runs;
- Rust cache;
- Qt dependency cache where licensing permits;
- CMake/Ninja cache;
- cargo/sccache where useful;
- artifact reuse;
- packaged E2E on relevant changes;
- nightly heavy matrices;
- release-candidate full matrices.

No docs-only change should rebuild every native target without a concrete reason. **No Qt/GPUI CI is
added until real Qt/GPUI code exists** — the retired `cef-learning-harness.yml` is not replaced by a
placeholder.

---

# 12. Governance

## Core ownership

Core/contracts have highest architectural authority.

## Qt ownership

Qt team owns presentation, native integration and Qt packaging, not domain semantics.

## GPUI ownership

GPUI team owns presentation/performance integration, not domain semantics.

## Contract change rule

A breaking contract change requires:

- Core impact;
- Web impact;
- Qt impact;
- GPUI impact once admitted;
- migration plan;
- compatibility window.

## Definition of Done

After multiple renderers are production-active, a new cross-product domain capability is not fully
"done" until:

- Core implementation exists;
- headless tests pass;
- contracts are versioned;
- all currently supported required renderers have an implementation or an explicitly approved
  capability exception.

This does not mean every experimental GPUI surface must block Qt releases.

---

# 13. Competency program

## Qt competency domains

- QObject ownership;
- QML engine;
- Qt Quick scene graph;
- render thread;
- signals/slots;
- queued connections;
- thread affinity;
- model/view;
- text stack;
- IME;
- accessibility;
- platform packaging;
- signing;
- deployment;
- updater integration;
- crash diagnostics;
- QML profiling.

## GPUI competency domains

- Application/Window lifecycle;
- entity ownership;
- retained/immediate hybrid model;
- async execution;
- text shaping/editing;
- focus/keymaps;
- accessibility;
- GPU resource lifecycle;
- platform support;
- framework upgrade/rebase discipline.

Required knowledge artifacts:

```text
docs/native/
  ROADMAP-QT-GPUI-DESKTOP.md        (this document)
  UI-DOMAIN-STATE-CLASSIFICATION.md (relocated from docs/cef/, Wave 0)
  NATIVE-RISK-REGISTER.md           (created when Wave 3+ begins)
  OWNERSHIP.yaml                    (created when Wave 3+ begins)
  qt/
    architecture-primer.md
    rust-bridge-decision.md
    threading-and-lifetimes.md
    accessibility-playbook.md
    packaging-and-updates.md
    debugging-and-crash-playbook.md
    upgrade-playbook.md
  gpui/
    architecture-primer.md
    dependency-policy.md
    text-editor-feasibility.md
    accessibility-playbook.md
    performance-playbook.md
    upgrade-playbook.md
```

---

# 14. Program gates

## G0 — CEF Exit / Strategy Reset

**Status: IN PROGRESS** — met only once both Wave-0 PRs are merged. See the Wave 0 status note above.

Required:

```text
[ ] new ADR (ADR-0021) supersedes CEF production strategy — written, PR A open, pending merge
[ ] CEF PR/issue reconciled: PR #404 closed unmerged, Issue #405 closed as superseded — PR B, not started
[ ] no useful renderer-neutral work lost — DesktopPlatform boundary unaffected (already true,
    independent of this reset); UI-DOMAIN-STATE-CLASSIFICATION.md relocation — PR B, not started
[ ] CEF-only CI removed (cef-learning-harness.yml, advisory-only) — PR B, not started
[ ] CEF-only dependencies no longer required by product build (apps/desktop-cef/, scripts/cef/
    still present on main) — PR B, not started
[x] Tauri remains functional during transition — true throughout, unaffected by either PR
[ ] Qt/GPUI roadmap adopted (this document) — written, PR A open, pending merge
```

## G1 — Core Native-Ready

```text
[ ] DesktopPlatform capability inventory complete (already true — packages/desktop-contracts)
[ ] direct Tauri imports constrained (already true — guardrail:desktop-imports, zero-tolerance)
[ ] project/storage/crypto/migration headless APIs exist
[ ] R-15 architecture approved
[ ] task supervision renderer-neutral
[ ] diagnostics renderer-neutral
[ ] contract versioning policy established
[ ] native-readiness CI gate active (already true — see docs/architecture/native-readiness.md)
```

## G2 — Qt Implementation Admission

```text
[ ] Qt license strategy approved
[ ] Qt version/LTS strategy approved
[ ] bridge technology selected by scorecard
[ ] Qt learning harness passes
[ ] IME feasibility passes
[ ] accessibility feasibility passes
[ ] packaged hello-world/native-core roundtrip passes
[ ] updater/packaging design approved
```

## G3 — Qt Beta Admission

```text
[ ] core writing workflows present
[ ] project compatibility proven
[ ] R-15 implemented for desktop
[ ] recovery proven
[ ] packaged update/rollback proven
[ ] accessibility gate passes
[ ] performance SLOs pass
[ ] no Critical/High unresolved security findings
```

## G4 — Qt Stable Admission

```text
[ ] feature parity matrix accepted
[ ] long-session soak passes
[ ] large-project tests pass
[ ] installer/signing/notarization proven
[ ] rollback proven
[ ] crash diagnostics proven
[ ] support playbooks complete
[ ] migration from Tauri proven
[ ] GO decision record signed
```

## G5 — Tauri Retirement

Only after Qt Stable and an explicit rollback window. **Tauri is removed entirely at this gate — not
kept as a permanent parallel runtime.**

## G6 — GPUI Production Admission

```text
[ ] GPUI platform support meets target matrix
[ ] framework pin/update policy exists
[ ] accessibility feasibility proven
[ ] IME/BiDi proven
[ ] editor spike beats or materially matches Qt on target workloads
[ ] no dependency on speculative React bindings
[ ] packaging/update feasibility proven
[ ] maintenance/bus-factor acceptable
```

## G7 — GPUI Beta

Core workflows + performance + accessibility + data compatibility.

## G8 — Multi-Renderer Stable

Qt and GPUI both supported against one Core/project format. **Tauri is no longer part of the
architecture at this point** — the end state is Web/PWA + Qt + GPUI only.

---

# 15. 24-wave execution roadmap

The roadmap intentionally preserves the original program's small, reviewable, reversible wave
discipline while replacing CEF-specific work with Qt/GPUI-native milestones.

## Wave 0 — Strategy reset and CEF retirement reconciliation

**Status: IN PROGRESS.** Wave 0 executes as two PRs. **PR A** (this document, ADR-0021, ADR-0019/0020
supersession, `ROADMAP.md`/`README.md` pointer updates) establishes the strategic reset — open,
pending merge as of this writing. **PR B** (removal of `apps/desktop-cef/`, `scripts/cef/`,
`.github/workflows/cef-learning-harness.yml`, and 14 of 15 `docs/cef/` files; relocation of
`docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` to `docs/native/`; closure of PR #404 and Issue #405)
performs the actual CEF source/CI/docs retirement and has not started yet — it opens only after PR A
merges. This wave is COMPLETE only once both PRs are merged, `main` CI is green, and #404/#405 are
actually closed. This document will be updated to COMPLETE/CI-PROVEN in PR B or an immediately
following doc-sync commit — not before.

**Goal:** change direction without losing valid work.

Actions:

- write superseding ADR;
- mark CEF strategy historical/superseded;
- inventory every open CEF PR and branch;
- classify each change:
    - renderer-neutral retain;
    - Qt/GPUI-reusable retain;
    - diagnostic archive;
    - CEF-only drop;
- remove CEF from future architecture diagrams;
- preserve research logs where useful;
- ensure main remains green.

Exit:

```text
CEF no longer a target runtime.
No valuable Core/security/CI improvement is accidentally discarded.
```

## Wave 1 — DesktopPlatform boundary hardening

**Status: COMPLETE — CI-PROVEN.** Shipped via PR #384 (`refactor(desktop): introduce renderer-
neutral platform contracts`) and PR #385 (`refactor(desktop): route Tauri consumers through the
DesktopPlatform adapter`), both merged to `main` before Wave 0 began. `packages/desktop-contracts`
defines the 14-facet `DesktopPlatform` interface with `TauriDesktopPlatform`/`WebDesktopPlatform`
adapters; `services/desktopPlatform.ts` is the runtime selector; `scripts/check-tauri-import-boundary.mjs`
is a zero-tolerance CI gate (`.github/workflows/ci.yml`, `pnpm run guardrail:desktop-imports`). Only
3 documented exceptions remain outside the boundary (`services/ai/fetchAdapter.ts` and
`services/localServerHttp.ts` — permanent HTTP-facet exclusion; `services/logger.ts` — scheduled
future-wave debt). **No further Wave 1 work is needed before Wave 2 begins.**

**Goal (as originally written, now satisfied):** make renderer substitution real.

Actions (all complete):

- inventory all direct `@tauri-apps/*` imports;
- enforce allowlist;
- convert Tauri calls to capability-oriented contracts;
- remove renderer assumptions from application/domain modules;
- define async/error/cancellation semantics;
- add architectural lint/test.

Exit (met):

```text
Shared product code cannot casually import Tauri, Qt or GPUI.
```

## Wave 2 — Rust Core extraction and headless harness

**Status: PLANNED — not started.**

**Goal:** establish authoritative renderer-neutral execution.

Actions:

- project load/save;
- validation;
- schema;
- migration;
- storage;
- task orchestration;
- diagnostics;
- AI request model;
- headless CLI/test harness.

Exit:

```text
Representative project lifecycle executes without any GUI runtime.
```

## Wave 3 — Storage correctness and R-15 design

**Status: PLANNED — not started.**

**Goal:** settle data semantics before native UI.

Actions:

- atomic write;
- append semantics;
- fsync/durability policy;
- snapshots;
- backup retention;
- recovery;
- encrypted envelope design;
- key-management decision;
- migration from existing desktop storage.

Reconcile #359/#360/#361 invariants explicitly — all three remain open as of Wave 0 (see §8.2).

Exit: storage specification and destructive-failure tests approved.

## Wave 4 — R-15 implementation

**Status: PLANNED — not started.**

Implement renderer-neutral at-rest encryption.

Required tests:

- encrypt/decrypt;
- wrong key;
- corruption;
- truncated file;
- interrupted save;
- migration;
- backup restore;
- large project;
- key loss behavior;
- no accidental plaintext persistence.

Exit: desktop project data uses the approved encrypted path where required; #357/#359/#360/#361 all
closed with evidence.

## Wave 5 — Qt enablement / executable learning harness

**Status: PLANNED — not started. Gated behind G2.**

Create a minimal isolated Qt 6 application proving:

- window creation;
- QML load;
- Rust call;
- Rust event→QML;
- async operation;
- cancellation;
- clean shutdown;
- repeated launch/close;
- file dialog;
- clipboard;
- keyboard;
- IME smoke;
- accessibility smoke.

No WorldScript feature migration yet.

Exit: bridge/lifetime/threading model is evidence-backed.

## Wave 6 — Qt shell and design-system foundation

**Status: PLANNED — not started.**

Implement:

- application shell;
- command routing;
- menus;
- dock/pane layout;
- theme tokens;
- typography;
- icons;
- focus model;
- shortcuts;
- notifications;
- dialogs;
- error surface.

Exit: shell consumes Core contracts but contains no duplicated domain logic.

## Wave 7 — Qt project lifecycle vertical slice

**Status: PLANNED — not started.**

End-to-end:

```text
launch
→ recent projects
→ open
→ validate/migrate/decrypt
→ edit metadata
→ save
→ close
→ reopen
```

Packaged artifact required.

Exit: real project roundtrip with compatibility evidence.

## Wave 8 — Qt manuscript editor foundation

**Status: PLANNED — not started.**

This is the highest-risk Qt product surface.

Prove:

- large text;
- cursor;
- selection;
- undo/redo;
- composition/IME;
- Unicode;
- grapheme correctness;
- BiDi/RTL;
- clipboard;
- drag/drop;
- find/replace;
- spellcheck strategy;
- autosave integration;
- recovery.

Do not prematurely force the web editor's internal model into Qt.

Exit: editor correctness gate.

## Wave 9 — Qt editor performance and #332 differential

**Status: PLANNED — not started.**

Benchmark against:

- current Tauri;
- PWA;
- Qt.

Measure memory amplification, typing latency, scrolling, long session, reduced-motion behavior and
autosave. Issue #332 remains open and is the concrete comparator.

Exit: no known catastrophic resource behavior; budgets recorded.

## Wave 10 — Qt knowledge surfaces

**Status: PLANNED — not started.**

Migrate:

- Binder/navigation;
- project tree;
- characters;
- locations;
- world entities;
- notes;
- metadata;
- search.

Use virtualized models for large collections.

Exit: primary non-editor authoring workflows complete.

## Wave 11 — Qt Plot Board / graph / visual surfaces

**Status: PLANNED — not started.**

Implement high-interaction visual tools natively.

Requirements:

- pan/zoom;
- keyboard accessibility;
- large graph;
- drag/drop;
- undoable operations;
- deterministic layout state;
- reduced motion;
- GPU fallback behavior.

Exit: interaction/performance/accessibility proof.

## Wave 12 — Qt AI orchestration

**Status: PLANNED — not started.**

UI consumes renderer-neutral AI Core.

Cover:

- streaming;
- cancellation;
- retry;
- provider errors;
- local model tasks;
- downloads;
- progress;
- RAG state;
- privacy controls.

No provider secrets in QML.

Exit: AI workflows parity.

## Wave 13 — Qt task supervisor and native services

**Status: PLANNED — not started.**

Move long-lived desktop tasks behind Rust supervision:

- model downloads;
- export;
- import;
- indexing;
- backup;
- maintenance;
- updater;
- diagnostics.

Requirements:

- cancellation;
- timeout;
- crash-safe state;
- bounded concurrency;
- progress events;
- no orphan work.

## Wave 14 — Qt accessibility hard gate

**Status: PLANNED — not started.**

Build real accessibility evidence.

Test:

- keyboard-only;
- screen reader;
- focus;
- roles/names/states;
- editor semantics;
- board alternatives;
- dialogs;
- notifications;
- high contrast;
- reduced motion;
- zoom;
- RTL.

Exit: documented platform evidence, not merely API usage.

## Wave 15 — Qt packaging, signing and update

**Status: PLANNED — not started.**

Linux, Windows, macOS as applicable.

Define:

- artifact layout;
- Qt runtime deployment;
- dynamic-library policy;
- license notices;
- SBOM;
- signing;
- notarization;
- installer;
- update metadata;
- rollback;
- offline behavior.

No release based solely on dev-run success.

## Wave 16 — Qt crash diagnostics and recovery

**Status: PLANNED — not started.**

Prove:

- Rust panic capture policy;
- native crash collection strategy;
- symbol files;
- anonymization/privacy;
- recovery after crash;
- unsaved-work strategy;
- corrupted-state handling;
- support bundle.

Do not couple the product to a single crash vendor.

## Wave 17 — Qt security hardening

**Status: PLANNED — not started.**

Threat-model:

- local project files;
- malicious imported content;
- path traversal;
- symlink races;
- command injection;
- update trust;
- plugin/extension boundaries if any;
- AI secret storage;
- clipboard;
- drag/drop;
- temporary files;
- log redaction.

Run CodeQL/SAST/dependency/license/secrets review as applicable.

## Wave 18 — Qt packaged beta

**Status: PLANNED — not started.**

Real artifact field validation:

- clean install;
- upgrade;
- rollback;
- old project;
- huge project;
- multi-hour session;
- suspend/resume;
- offline;
- network loss;
- disk full;
- permission denied;
- corrupted backup;
- interrupted update.

Exit: beta evidence set.

## Wave 19 — Qt parity and stable cutover

**Status: PLANNED — not started.**

Maintain explicit matrix:

```text
Capability | Tauri | PWA | Qt | Evidence | Exception
```

No checkbox without evidence.

Stable requires G4.

## Wave 20 — Tauri retirement

**Status: PLANNED — not started. Gated behind G4 + field-observation window.**

Only after stable observation window.

Actions:

- migration communications;
- fallback window;
- remove Tauri-specific product code;
- remove unused dependencies;
- archive adapter;
- preserve migration tooling;
- verify PWA unaffected.

Exit: Qt is primary desktop; **Tauri is fully removed, not kept as a parallel runtime.**

## Wave 21 — GPUI admission spikes

**Status: PLANNED — not started. Gated behind G6.**

Now perform focused, disposable proofs:

- app/window lifecycle;
- manuscript editor;
- text shaping;
- IME;
- RTL/BiDi;
- accessibility;
- clipboard;
- drag/drop;
- virtualized list;
- graph/board;
- GPU;
- 120-Hz target;
- large project;
- Rust Core consumption.

Evaluate GPUI itself and optional `gpui-component` independently.

Exit: G6 GO/NO-GO.

## Wave 22 — GPUI shell + manuscript vertical slice

**Status: PLANNED — not started.**

If admitted:

- shell;
- commands;
- design tokens;
- editor;
- project lifecycle;
- Core contracts;
- diagnostics.

The manuscript editor is first because GPUI's strategic value must be proven where it matters most.

## Wave 23 — GPUI capability expansion

**Status: PLANNED — not started.**

Add:

- Binder;
- knowledge surfaces;
- Plot Board;
- graphs;
- AI;
- tasks;
- settings;
- import/export;
- accessibility;
- packaging/updater.

Every capability remains Core-backed.

## Wave 24 — Multi-renderer maturity

**Status: PLANNED — not started.**

Establish:

- Web/PWA stable;
- Qt Hardened stable;
- GPUI Vision stable;
- shared project format;
- shared collaboration protocol;
- contract compatibility;
- cross-renderer migration tests;
- renderer-specific SLOs;
- release-train governance.

No requirement for identical release cadence. **Tauri is no longer part of the architecture at this
stage.**

---

# 16. Qt architecture in depth

## 16.1 Presentation state vs domain state

QML may own:

- expanded/collapsed;
- current tab;
- hover;
- animation;
- local focus;
- transient selection presentation.

Rust Core owns:

- project entities;
- persisted document state;
- save state;
- encryption state;
- migration state;
- task state;
- collaboration truth.

## 16.2 Model/view

Large lists must not be copied wholesale across FFI on every render.

Prefer:

- stable IDs;
- paged/virtualized access;
- change events;
- diff-oriented updates;
- immutable snapshots where appropriate;
- bounded payloads.

## 16.3 Threading

Document:

- Qt GUI thread;
- Rust worker runtime;
- async bridge;
- cancellation;
- callback lifetime;
- shutdown ordering.

Forbidden:

- blocking disk/AI work on Qt GUI thread;
- Rust callback into destroyed QObject;
- unbounded event queues;
- reentrant mutation without policy.

## 16.4 QML discipline

QML is presentation code.

Avoid:

- project migrations in JavaScript;
- crypto in QML;
- filesystem paths as business logic;
- AI provider orchestration in QML;
- duplicated validation rules.

---

# 17. GPUI architecture in depth

## 17.1 GPUI is not "Qt rewritten in Rust"

GPUI may exploit a different UI architecture.

Shared:

- Core;
- contracts;
- project format;
- commands/events;
- tests.

Not necessarily shared:

- widget hierarchy;
- layout implementation;
- animation implementation;
- editor rendering implementation.

## 17.2 Performance-first editor

Build a dedicated performance model:

- rope/piece-table decision;
- viewport virtualization;
- incremental shaping;
- syntax/semantic decorations;
- selection/caret;
- composition;
- undo integration;
- incremental search;
- background analysis.

Do not optimize for 120 fps by sacrificing text correctness.

## 17.3 Framework volatility

Because GPUI is pre-1.0:

- pin exact revision/version;
- maintain upgrade notes;
- run compatibility CI;
- avoid deep dependence on undocumented internals;
- contribute fixes upstream when strategically useful;
- keep Core insulated.

---

# 18. React reuse policy

The previous proposal's "maximal React reuse via bindings" is refined.

Guaranteed reuse:

- product behavior;
- Rust Core;
- schemas;
- commands/events;
- assets;
- design tokens;
- localization catalogs where format permits;
- test scenarios;
- UX specifications.

Potential reuse:

- generated view models;
- declarative schema→UI generation;
- shared Markdown/content transforms.

Not assumed:

- direct React component execution inside Qt;
- direct React component execution inside GPUI;
- stable "gpuix" bridge.

A bridge may be adopted only after maintenance, performance, accessibility and platform gates.

---

# 19. Qt licensing and compliance gate

Before Qt production work:

- choose commercial vs LGPL/GPL-compatible distribution strategy;
- identify every Qt module;
- classify each module's license;
- decide dynamic/static linking;
- define relinking obligations if LGPL path is used;
- provide required notices/source offers/materials;
- inventory third-party licenses;
- produce SBOM;
- legal review before commercial distribution.

Do not accidentally introduce a GPL-only Qt module into a distribution whose licensing model cannot
accommodate it.

Qt WebEngine, if ever considered, gets a separate Chromium/license/security review and is not
assumed.

---

# 20. Project format and migration policy

The project format is renderer-independent.

Rules:

- explicit schema version;
- forward/backward compatibility policy;
- transactional migration;
- backup before destructive migration;
- downgrade policy;
- encrypted format versioning;
- deterministic validation;
- migration telemetry only with privacy-safe policy;
- test corpus of historical projects.

Cross-renderer invariant:

```text
Project saved by Qt
→ opens in PWA where capability exists
→ opens in GPUI
→ no silent semantic loss
```

Exceptions must be explicit and versioned.

---

# 21. Collaboration architecture

Collaboration cannot depend on renderer implementation.

Define:

- document identity;
- operation/event schema;
- conflict semantics;
- offline queue;
- reconnect;
- auth;
- encryption boundary;
- presence;
- permissions;
- protocol versioning.

Qt and GPUI are protocol clients, not collaboration engines.

---

# 22. AI architecture

Renderer-neutral AI orchestration owns:

- provider abstraction;
- model selection;
- request state;
- cancellation;
- retries;
- token/cost metadata;
- local/remote policy;
- RAG;
- indexing;
- privacy;
- secrets references.

Renderer owns:

- prompt UI;
- streaming presentation;
- interaction affordances.

No renderer stores raw provider secrets unless explicitly delegated to a secure platform capability.

---

# 23. Diagnostics and observability

Shared diagnostics schema:

- app version;
- renderer/product line;
- Core version;
- project schema;
- task state;
- memory samples;
- performance markers;
- crash metadata;
- sanitized logs.

Privacy:

- no manuscript text by default;
- no AI prompt content by default;
- no secrets;
- explicit support-bundle preview;
- user-controlled export.

---

# 24. Packaging and updater architecture

Qt and GPUI have separate artifact pipelines but shared release policy.

Required:

- signed metadata;
- channel model;
- rollback;
- staged rollout;
- minimum supported version;
- schema compatibility;
- delta/full update decision;
- failure recovery;
- offline install;
- provenance;
- SBOM.

Updater state belongs to Core/native services, not QML/GPUI widgets.

---

# 25. Risk register

## N-01 — Qt licensing mistake

Severity: High.
Mitigation: license gate before module adoption.

## N-02 — Qt↔Rust lifetime/FFI defect

Severity: Critical where memory safety affected.
Mitigation: minimal boundary, independent review, sanitizers where feasible, ownership docs.

## N-03 — Domain logic leaks into QML

Severity: High architectural risk.
Mitigation: native-readiness lint/review.

## N-04 — GPUI framework churn

Severity: High.
Mitigation: delayed admission, exact pin, upgrade harness.

## N-05 — GPUI accessibility insufficient

Severity: Release-blocking.
Mitigation: early spike + hard gate.

## N-06 — Text editor semantic divergence

Severity: Critical product risk.
Mitigation: shared document model + extensive corpus/IME/BiDi tests.

## N-07 — R-15 postponed by UI migration

Severity: Critical security risk.
Mitigation: implement before Qt parity. **Concrete tracked instances: #357, #359, #360, #361 (all
open as of Wave 0).**

## N-08 — Too many renderer tracks

Severity: High execution risk.
Mitigation: Qt-first sequentiality; GPUI production starts only after admission.

## N-09 — Tauri boundary regression

Severity: Medium/High.
Mitigation: import allowlist CI (already active — `scripts/check-tauri-import-boundary.mjs`).

## N-10 — Project format drift

Severity: Critical.
Mitigation: Core-owned schema and cross-renderer corpus.

## N-11 — Native packaging complexity

Severity: High.
Mitigation: packaged-artifact tests from early Qt slices.

## N-12 — Performance assumptions

Severity: High.
Mitigation: measured SLOs; no framework-based claims. **Comparator: Issue #332.**

## N-13 — Accessibility treated as late polish

Severity: Critical release risk.
Mitigation: accessibility from harness onward.

## N-14 — Security update lag

Severity: High.
Mitigation: dependency monitoring and release SLA.

## N-15 — Bus factor

Severity: High.
Mitigation: knowledge artifacts, ownership, reproducible harnesses.

---

# 26. Review policy

Independent second-pass review required for:

- Qt/Rust FFI;
- unsafe Rust;
- ownership/lifetimes;
- storage;
- encryption;
- migration;
- updater;
- signing;
- task supervisor;
- crash recovery;
- GPUI framework internals;
- accessibility architecture.

No unresolved High/Critical finding may be waived silently.

Waivers require:

- owner;
- rationale;
- expiry/review date;
- mitigation;
- release impact.

---

# 27. PR discipline

Preferred:

```text
one capability
→ one bounded PR
→ targeted local proof
→ cloud CI
→ independent review
→ merge
```

Avoid:

- giant renderer rewrites;
- mixed Qt + GPUI implementation PRs;
- docs claiming future proof as completed;
- "temporary" direct Core bypasses;
- combining storage migration with unrelated UI redesign.

Every native PR states:

```text
Core impact:
Contract impact:
Qt impact:
GPUI impact:
Web impact:
Tauri transition impact:
Security impact:
Accessibility impact:
Data migration impact:
Performance evidence:
```

---

# 28. Change-aware CI matrix

Examples:

`docs/native/**` only:
- docs validation;
- links;
- schema consistency.

`crates/worldscript-core/**`:
- Rust;
- contract tests;
- Web adapter;
- Qt adapter;
- GPUI adapter when admitted.

`apps/desktop-qt/**`:
- Qt build;
- Qt integration;
- packaged smoke where required.

`apps/desktop-gpui/**`:
- GPUI build;
- GPUI integration/performance smoke.

No obsolete run should consume expensive capacity after a superseding push where cancellation is
safe.

---

# 29. Golden Master suite

Build renderer-independent scenarios:

1. New project.
2. Open historical project.
3. Migrate.
4. Save.
5. Crash/interruption recovery.
6. Snapshot restore.
7. Character edit.
8. Plot change.
9. Manuscript edit.
10. Undo/redo.
11. AI request/cancel.
12. Export.
13. Import.
14. Backup.
15. Encryption roundtrip.
16. Collaboration reconnect.

Each renderer proves equivalent observable outcomes.

---

# 30. Text correctness matrix

Mandatory corpus:

- Latin;
- German;
- combining marks;
- emoji/ZWJ;
- CJK;
- Arabic;
- Hebrew;
- mixed RTL/LTR;
- surrogate-equivalent Unicode edge cases;
- very long paragraphs;
- huge documents;
- IME composition;
- dead keys;
- clipboard rich/plain text.

A native editor is not accepted because ASCII typing works.

---

# 31. Performance laboratory

Create reproducible fixtures and scripts.

Record:

- hardware;
- OS;
- renderer;
- build type;
- project fixture;
- measurement method;
- median/P95/P99 where relevant.

Never compare Qt Release against Tauri Debug or GPUI on different hardware and call it evidence.

---

# 32. Field validation

Qt Stable requires calendar-time evidence:

- repeated daily use;
- long sessions;
- sleep/wake;
- monitor changes;
- DPI changes;
- GPU/driver diversity;
- file permission changes;
- network interruption;
- disk pressure;
- old projects;
- very large projects.

GPUI receives equivalent validation before Stable.

---

# 33. Security non-negotiables

Never solve a migration problem by:

- disabling encryption;
- loosening filesystem permissions broadly;
- executing arbitrary shell strings;
- storing secrets in UI state;
- skipping signature verification;
- accepting unbounded IPC payloads;
- trusting imported paths;
- suppressing security scanners to obtain green CI.

---

# 34. Deprecation policy

CEF-specific implementation was deprecated immediately as a target (Wave 0, complete).

**Tauri is deprecated only after Qt Stable, and then fully removed (Wave 20/gate G5) — it is not a
permanent third runtime.**

React/PWA is not deprecated.

Qt is not a stepping stone that GPUI automatically replaces. Qt remains the Hardened product line
unless a future ADR explicitly changes that.

GPUI is not guaranteed promotion merely because it is fast.

---

# 35. Success metrics

## Core

- 100% of critical domain capabilities headless-testable;
- no renderer-specific business rules;
- deterministic migrations;
- renderer-neutral encryption;
- bounded task lifecycle;
- project-format compatibility.

## Qt Hardened

- accessibility gate;
- security gate;
- packaging/update gate;
- long-session stability;
- large-project stability;
- IME/BiDi correctness;
- supportable LTS/dependency posture.

## GPUI Vision

- editor latency target;
- 120-Hz-capable designated workflows where supported;
- lower idle resource footprint than Qt target where realistic;
- no text-correctness regression;
- accessibility sufficient for release;
- framework upgrade burden acceptable.

## Shared

- identical authoritative project format;
- identical Core semantics;
- compatible collaboration protocol;
- renderer-specific presentation freedom.

---

# 36. Decision records required

Create/supersede ADRs for:

1. CEF strategy retirement. **(ADR-0021, written — PR A open, pending merge)**
2. Qt-first native strategy. **(ADR-0021, written — PR A open, pending merge)**
3. Qt↔Rust bridge selection.
4. Qt licensing/distribution model.
5. R-15 key/storage architecture.
6. Qt packaging/updater.
7. Tauri retirement.
8. GPUI admission.
9. GPUI dependency/component strategy.
10. Multi-renderer release governance.

---

# 37. Immediate transition plan from the current repository state

**Status: IN PROGRESS.** Items 1–3 and 8–9 below reflect completed analysis/pre-existing state; items
4–7 are PR B scope and have not started; item 5 (this document + ADR-0021) is written but not yet
merged.

The first implementation sequence after adopting this roadmap is:

```text
1. Freeze new CEF feature work.                                              [DONE]
2. Inventory current CEF PR(s), especially any Draft work.                   [DONE]
3. Extract only renderer-neutral improvements.                               [ANALYSIS DONE — relocation itself is PR B]
4. Close/supersede CEF-specific PRs with a clear historical note.            [PENDING — PR B, #404/#405 still open]
5. Adopt new ADR + this roadmap.                                             [PR A open, pending merge]
6. Rename/generalize CEF-only governance docs where their content remains
   useful.                                                                   [PENDING — PR B, UI-DOMAIN-STATE-CLASSIFICATION.md still in docs/cef/]
7. Re-run main CI.                                                           [PENDING — after PR A and PR B both merge]
8. Re-audit DesktopPlatform/Tauri import boundary.                           [ALREADY TRUE — Wave 1 complete]
9. Start Wave 1.                                                             [ALREADY COMPLETE before Wave 0]
10. Do not begin Qt UI until Wave 1/2 prerequisites are sufficiently proven.  [Wave 2 not yet started]
```

CEF research remains useful as historical evidence for:

- lifecycle discipline;
- CI false-green prevention;
- accessibility evidence discipline;
- native process diagnostics;
- review rigor;
- packaging skepticism;
- sandbox/security reasoning.

It does not remain a runtime dependency.

---

# 38. Recommended repository shape

Conceptual only; adapt to current repository rather than mass-renaming:

```text
apps/
  web/
  desktop-tauri/       # transitional — removed at Wave 20 / gate G5
  desktop-qt/
  desktop-gpui/        # only after admission

crates/
  worldscript-core/
  worldscript-contracts/
  worldscript-storage/
  worldscript-crypto/
  worldscript-migrations/
  worldscript-tasks/
  worldscript-ai/
  worldscript-diagnostics/

docs/
  native/
    ROADMAP-QT-GPUI-DESKTOP.md   (this document)
    NATIVE-RISK-REGISTER.md
    UI-DOMAIN-STATE-CLASSIFICATION.md
    qt/
    gpui/
  historical/
    cef/                # short pointer doc only, not a maintained tree
```

Do not reorganize purely for aesthetics.

---

# 39. Definition of Qt Stable

Qt Stable means all of the following are true:

- packaged product, not dev host;
- signed/notarized where applicable;
- update and rollback;
- project migration;
- encrypted storage;
- recovery;
- accessibility;
- IME/BiDi;
- editor correctness;
- core workflows;
- AI workflows;
- large project;
- long session;
- diagnostics;
- support bundle;
- security review;
- license compliance;
- no unresolved Critical;
- accepted High-risk disposition;
- field observation window;
- explicit GO record.

---

# 40. Definition of GPUI Stable

GPUI Stable requires everything relevant from Qt Stable plus:

- framework version/update discipline;
- demonstrated reason for product existence beyond novelty;
- measurable performance advantage on designated workflows or another approved strategic advantage;
- accessibility parity sufficient for target users;
- no project-format divergence;
- no hidden renderer-specific domain fork.

---

# 41. Multi-renderer product differentiation

Allowed differentiation:

Qt Hardened:
- conservative defaults;
- longer support windows;
- enterprise deployment;
- maximum accessibility;
- predictable UI behavior.

GPUI Vision:
- experimental high-performance views;
- rapid GPU-native interaction;
- advanced visualizations;
- performance-first ergonomics.

Forbidden differentiation:

- incompatible project truth;
- incompatible encryption semantics;
- divergent migration rules;
- different collaboration meaning.

---

# 42. Unified installer

A unified installer with renderer choice is **not an early goal**.

It may be evaluated only after both native lines are stable.

Risks:

- artifact size;
- support complexity;
- update complexity;
- user confusion;
- duplicated runtime assets.

Separate products/channels are the default.

---

# 43. Release trains

Possible mature model:

```text
Core release train
  ├─ Web/PWA
  ├─ Qt Hardened
  └─ GPUI Vision
```

Contracts declare compatibility ranges.

A Core release cannot assume all renderers ship simultaneously.

---

# 44. Dependency policy

Qt:

- pinned supported Qt 6 line;
- explicit LTS decision;
- module allowlist;
- license inventory.

GPUI:

- exact pin;
- controlled update cadence;
- no wildcard production dependencies;
- compatibility harness;
- upstream monitoring.

Rust:

- `cargo audit`/equivalent;
- lockfile discipline;
- MSRV/toolchain policy;
- unsafe review.

---

# 45. Native supply chain

For every packaged desktop artifact:

- source revision;
- dependency lock;
- compiler/toolchain version;
- Qt/GPUI version;
- build provenance;
- hashes;
- SBOM;
- signing identity metadata;
- reproducible recipe to the extent feasible.

---

# 46. Failure handling

Every Core operation defines:

```text
success
recoverable error
user-actionable error
retryable error
cancelled
fatal/corrupt state
```

Renderers translate errors into presentation; they do not reinterpret persistence truth.

---

# 47. Cancellation and backpressure

AI, indexing, export, import, search and snapshots require explicit cancellation.

UI event streams must be bounded/coalesced where appropriate.

Neither QML signals nor GPUI entity notifications may become an accidental unbounded event bus.

---

# 48. Shutdown semantics

Shared shutdown state machine:

```text
RUNNING
→ QUIESCING
→ FLUSHING
→ TASK_CANCELLATION
→ PERSIST_FINAL_STATE
→ RELEASE_UI
→ RELEASE_NATIVE_SERVICES
→ EXIT
```

Test:

- normal close;
- OS shutdown;
- update restart;
- crash recovery;
- task in progress;
- save in progress.

---

# 49. Recovery semantics

On next launch:

- detect incomplete save/update/migration;
- validate last-known-good state;
- offer recovery;
- never silently overwrite a recoverable backup;
- log privacy-safe evidence.

---

# 50. Large-project strategy

Avoid whole-project cloning across renderer boundaries.

Use:

- stable entity IDs;
- incremental access;
- streaming;
- pagination;
- virtualized views;
- native serialization;
- bounded snapshots.

Large-project performance is a Core+renderer joint SLO.

---

# 51. Printing/export

Qt provides a strong native path, but export semantics stay renderer-neutral.

Core owns:

- document/export model;
- deterministic transforms.

Renderer/native service owns:

- print dialog;
- device integration;
- preview presentation.

GPUI may initially delegate printing through shared native service rather than reimplementing print
layout.

---

# 52. Localization

One authoritative message/catalog strategy where feasible.

Requirements:

- plural rules;
- RTL;
- locale formatting;
- shortcut localization;
- font fallback;
- CJK;
- translation completeness checks.

Qt and React catalogs may require generated adapters, but source meaning should not diverge.

---

# 53. Theme/design tokens

Maintain renderer-neutral tokens:

- semantic colors;
- spacing;
- typography roles;
- radius;
- motion durations;
- contrast requirements.

Renderer-specific implementation is allowed.

Do not attempt pixel-identical rendering across Qt and GPUI.

---

# 54. Plugin/extensibility policy

Do not introduce renderer-specific arbitrary-code plugins during migration.

Any future extension system must define:

- trust model;
- permissions;
- API versioning;
- sandbox/process model;
- data access;
- update/signing.

---

# 55. Privacy

Core privacy policy applies to every renderer.

No renderer-specific telemetry expansion without review.

Support bundles must be inspectable before sharing.

---

# 56. Documentation-as-evidence

Roadmap status must distinguish:

- PLANNED;
- IN PROGRESS;
- IMPLEMENTED;
- CI-PROVEN;
- PACKAGED-PROVEN;
- FIELD-PROVEN;
- BLOCKED;
- DEFERRED.

Never mark "done" because code exists.

---

# 57. Wave advancement rule

A wave advances only when:

- exit criteria satisfied;
- required CI green;
- CodeQL/security gates green where applicable;
- review threads resolved;
- docs match reality;
- no new Critical/High blocker;
- next wave does not invalidate unresolved prerequisite.

Small overlap is allowed only for independent preparation.

---

# 58. Stop conditions

Stop and request architecture review if:

- Qt bridge requires broad unsafe surface;
- Qt license strategy conflicts with distribution model;
- project format must diverge by renderer;
- R-15 would be weakened;
- GPUI cannot meet accessibility/IME requirements;
- a renderer requires domain duplication;
- updater/signing cannot meet trust requirements;
- a Critical security finding lacks a credible mitigation.

---

# 59. What not to do

Do not:

- replace CEF with a Qt big-bang rewrite;
- start Qt and GPUI parity simultaneously;
- embed React in Qt as the default architecture;
- assume Qt WebEngine solves migration;
- assume GPUI's editor architecture can be copied wholesale from Zed;
- treat framework benchmarks as WorldScript benchmarks;
- postpone encryption;
- let UI own migrations;
- merge giant "native rewrite" PRs;
- retire Tauri before packaged Qt proof;
- promise 120 fps without defined evidence.

---

# 60. Near-term 30/60/90-day intent

These are sequencing goals, not date guarantees.

## First horizon

- strategy reset; **[PR A open, pending merge]**
- CEF reconciliation; **[PENDING — PR B, not started]**
- DesktopPlatform boundary; **[ALREADY DONE, pre-Wave-0]**
- Core headless extraction;
- R-15/storage architecture;
- Qt licensing/bridge scorecard.

## Second horizon

- Qt learning harness;
- packaged Qt shell;
- project lifecycle slice;
- editor feasibility;
- accessibility/IME evidence.

## Third horizon

- Qt authoring workflows;
- AI/tasks;
- packaging/update;
- beta hardening.

Actual calendar duration is evidence-driven.

---

# 61. Native-readiness gate template

Every Wave PR may use:

```markdown
## Native-readiness
- [ ] Domain logic is renderer-neutral
- [ ] No new direct Tauri import outside allowlist
- [ ] No Qt type leaked into Core
- [ ] No GPUI type leaked into Core
- [ ] Headless test exists
- [ ] Contract impact documented
- [ ] Storage/migration impact documented
- [ ] Security impact documented
- [ ] Accessibility impact documented
- [ ] Performance impact measured or N/A justified
```

---

# 62. Renderer capability matrix template

| Capability | Core | Web/PWA | Tauri transition | Qt | GPUI | Evidence |
|---|---|---|---|---|---|---|
| Project open | — | — | — | — | — | — |
| Save | — | — | — | — | — | — |
| Encryption | — | — | — | — | — | — |
| Recovery | — | — | — | — | — | — |
| Manuscript | — | — | — | — | — | — |
| Plot Board | — | — | — | — | — | — |
| AI | — | — | — | — | — | — |
| Accessibility | — | — | — | — | — | — |
| Update | — | — | — | — | — | — |

Populate from evidence, not assumptions.

---

# 63. Risk acceptance template

```markdown
Risk:
Severity:
Affected renderer(s):
Observed evidence:
Root cause:
Mitigation:
Residual risk:
Release impact:
Owner:
Review date:
Exit criterion:
```

---

# 64. Architecture review checklist

Before major native decisions:

```text
Does this increase renderer coupling?
Does it duplicate domain logic?
Does it weaken data integrity?
Does it weaken R-15?
Does it create a new privileged boundary?
Does it affect project compatibility?
Does it affect accessibility?
Does it affect update trust?
Can it be headless-tested?
Can it be rolled back?
Is it documented?
Is there an independent review?
```

---

# 65. Historical PR reconciliation rule

Older PRs, including CEF-era work, are never merged because their original goal was once valid.

For each:

1. diff against current main;
2. identify unique useful deltas;
3. classify renderer-neutral vs obsolete;
4. reimplement cleanly if necessary;
5. run current tests;
6. close/supersede stale architecture.

This same rule applies to historical Tauri work.

---

# 66. #332 handling

#332 should remain a tracked performance/stability reference until its useful application-level
causes are either:

- fixed in Core;
- disproven;
- renderer-specific and superseded by measured Qt behavior.

Do not close it merely because WebKitGTK is no longer the future runtime. **Current status
(2026-08-20): open, unresolved, not root-caused by a maintainer yet — see §8.3.**

---

# 67. R-15 handling

R-15 is promoted to an early native-program gate.

Qt Stable is forbidden without the approved desktop at-rest encryption posture.

GPUI inherits the same implementation from Core. **Concrete tracked instances: #357, #359, #360,
#361 (see §8.1–8.2).**

---

# 68. #359/#360/#361 handling

Before the first Qt project-write path:

- inspect current issue/PR state;
- extract the exact invariants;
- encode them in regression tests where possible;
- link those tests from native migration documentation.

Historical closure does not remove their lessons. **Current status (2026-08-20): all three open on
GitHub, unresolved on the Tauri fs-backed encryption path. See §8.2.**

---

# 69. Quality budget

Every wave budgets time for:

- implementation;
- targeted tests;
- CI;
- security review;
- accessibility review where relevant;
- docs;
- review-finding reconciliation;
- performance evidence.

CI latency is optimized through orchestration, not by removing critical evidence.

---

# 70. Qt Beta field program

Beta cohort should cover:

- Windows;
- macOS;
- Linux;
- Intel/AMD;
- relevant GPU diversity;
- screen reader users;
- IME users;
- RTL users;
- large-project users;
- long-session writers.

Collect structured privacy-safe failure reports.

---

# 71. GPUI field program

Start narrower than Qt.

First cohort:

- performance-sensitive users;
- supported platforms with strongest GPUI maturity;
- large manuscripts;
- graph/board-heavy workflows.

Expand only after accessibility and platform evidence.

---

# 72. Support lifecycle

Qt Hardened may use longer support windows.

GPUI Vision may use faster update cadence.

Project format and Core compatibility must make cross-edition movement safe.

---

# 73. Exit from experimental dependencies

Any experimental bridge/component must have:

- replacement strategy;
- pin;
- owner;
- update cadence;
- test coverage.

No critical project capability may depend on an abandoned experimental crate without a contingency.

---

# 74. Final strategic end state

Within the long-term horizon WorldScript Studio should be capable of supporting:

```text
WorldScript Web
    React/PWA
        │
        ├───────────────┐
        │               │
        ▼               ▼
WorldScript Qt      WorldScript GPUI
Hardened Edition    Vision Edition
        │               │
        └───────┬───────┘
                ▼
        WorldScript Core
        authoritative Rust
                │
                ▼
       One project format
       One migration model
       One crypto model
       One collaboration protocol
```

The user chooses the surface. The project does not fork its truth.

Qt is the conservative, mature native product.

GPUI is the performance-forward native product.

React/PWA remains the web product.

**Tauri is retired once Qt proves replacement parity — it does not persist as a fourth surface
alongside Web/PWA, Qt, and GPUI.**

CEF is not part of the target architecture.

---

# 75. Binding program statement

The program is successful only if WorldScript becomes **more maintainable because it has multiple
renderers**, not less.

The multi-renderer strategy is therefore conditional on architectural discipline:

> **One Core. One project truth. Versioned contracts. Multiple surfaces. Evidence before promotion.**

The purpose of Qt is not to replace one wrapper with another.

The purpose of GPUI is not to chase novelty.

The purpose of the roadmap is to turn WorldScript Studio into a durable product platform whose
security, data integrity, accessibility and domain behavior survive renderer change.

That is the binding architectural objective.
