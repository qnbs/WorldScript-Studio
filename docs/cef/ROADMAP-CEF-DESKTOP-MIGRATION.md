# WorldScript Studio — CEF Desktop Roadmap & Realization Concept

**Status:** Binding strategic architecture and execution roadmap
**Repository:** `qnbs/WorldScript-Studio`
**Baseline:** WorldScript Studio `v1.27.1` on current `main`
**Primary next-generation desktop runtime:** Chromium Embedded Framework (CEF)
**Current transitional desktop runtime:** Tauri 2 / system WebView
**Future secondary product line:** `egui` + `wgpu`, explicitly deferred
**Original roadmap draft:** 2026-08-15
**Architecture refinement review:** 2026-08-17
**Adopted as project documentation:** 2026-08-18, via [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md) (Wave 0)
**Revision:** 4 — §65 replaced with a `gh`-verified PR reconciliation (the original draft's PR-content guesses for #352–#356 have been checked against real GitHub state; dispositions for #353/#354/#355 held up, #352's guessed content did not and is corrected, #356 remains the one genuinely open gap)

> **Provenance note (Wave 0):** This document was originally drafted as a standalone strategic proposal before being adopted as project documentation. Section numbering is preserved from that draft so later PRs can cite `§NN` stably. The only substantive content correction applied during adoption is §65 below; everything else reflects the reviewed draft as accepted by ADR-0019. Companion documents: `docs/cef/CEF-RISK-REGISTER.md`, `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md`, `docs/cef/TAURI-COUPLING-INVENTORY.md`, `docs/cef/knowledge/`, `docs/cef/OWNERSHIP.yaml`.

---

## 0. Executive decision

WorldScript Studio will now pursue **Chromium Embedded Framework (CEF) as the primary next-generation desktop runtime**.

This is not a throwaway proof of concept, not merely a Linux workaround, and not one of several competing desktop experiments. CEF is the planned successor desktop architecture that will be designed, implemented, validated, hardened, productionized, and eventually promoted to the preferred WorldScript Studio desktop runtime.

The current Tauri implementation remains important during the transition, but its role changes:

- **reference runtime** for current desktop behavior;
- **migration fallback** while CEF lacks parity;
- **regression comparator** for feature and lifecycle behavior;
- **temporary support path** for critical production fixes;
- **not** the target for large new architectural investments that would immediately need to be rebuilt under CEF.

The future `egui` + `wgpu` architecture is **not cancelled**. It is intentionally gated. No production WorldScript Native effort starts until CEF and the wider product have reached the maturity, stability, security, performance, accessibility, storage, updater, recovery, and field-validation standards defined in this document.

The strategic order is therefore fixed:

```text
CURRENT
React + Vite + Tauri 2
        │
        ▼
CEF architecture + platform abstraction
        │
        ▼
CEF Linux proof and #332 differential validation
        │
        ▼
CEF production implementation
Linux + Windows + macOS
        │
        ▼
CEF security / storage / updater / packaging / crash recovery
        │
        ▼
CEF feature parity and packaged-artifact validation
        │
        ▼
CEF Stable
        │
        ▼
Tauri retirement
        │
        ▼
WorldScript-wide perfection and hardening
        │
        ▼
Native-v2 admission review
        │
        ▼
ONLY THEN: separate egui/wgpu WorldScript Native product
```

---

# 1. Strategic vision

The objective is larger than "replace WebKitGTK".

WorldScript Studio should evolve from a web application wrapped by a desktop shell into a **renderer-independent product platform** with a durable native core and multiple presentation targets.

Long-term target:

```text
                         WORLD SCRIPT PLATFORM
                                  │
                   ┌──────────────┴──────────────┐
                   │                             │
             WorldScript Core              Shared Contracts
                  Rust                           │
                   │                             │
                   └──────────────┬──────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    │             │             │
                    ▼             ▼             ▼
                 Web/PWA      CEF Desktop   Future Native
                 React        React/CEF     egui/wgpu
```

The defining architectural rule is:

> **Product logic must not be duplicated across renderers.**

CEF is therefore both a desktop-runtime migration and a platform-maturation program.

It should produce:

- renderer-independent domain boundaries;
- renderer-independent persistence;
- renderer-independent encryption;
- renderer-independent migrations;
- renderer-independent native task orchestration;
- typed platform contracts;
- deterministic crash recovery;
- explicit lifecycle semantics;
- measurable performance SLOs;
- reproducible packaged-desktop validation;
- mature release engineering.

CEF should make the eventual native Rust client easier to build, while **not developing that client yet**.

---

# 2. Why CEF is the chosen next runtime

CEF gives WorldScript Studio a particularly strong combination of:

- preservation of the current React/Vite application;
- a controlled Chromium engine rather than Linux distribution WebKitGTK;
- mature DOM/CSS/text/IME/BiDi/accessibility behavior;
- mature browser profiling and debugging;
- cross-platform renderer consistency;
- process isolation;
- renderer crash detection;
- a clean path to a Rust-authoritative native core;
- reuse of the successful PWA/Chromium frontend assumptions.

WorldScript is no longer a trivial desktop wrapper. Its surface includes:

- a professional writing environment;
- large manuscript state;
- undo/version history;
- AI orchestration;
- local AI and model downloads;
- RAG;
- DuckDB/WASM;
- workers;
- images and Binder assets;
- advanced UI effects;
- a large i18n surface;
- accessibility requirements;
- desktop lifecycle;
- storage, encryption, backups and recovery.

For that class of application, owning the desktop browser-engine version is strategically valuable.

---

# 3. Current baseline and known pressure points

At roadmap creation the authoritative baseline is `v1.27.1` on `main`.

Important current characteristics:

- React 19 / Vite 8 frontend;
- Tauri 2 desktop shell;
- substantial direct `@tauri-apps/*` dependency surface;
- browser and desktop storage paths;
- extensive CI, browser E2E, VRT, Storybook and security checks;
- recently strengthened Rust/Tauri CI gating;
- recent atomic-write and desktop persistence work;
- Linux desktop remains dependent on WebKitGTK;
- issue #332 remains the principal desktop performance/stability investigation;
- one diagnostic case produced a WebKit process footprint around 26.7 GB before WebKit killed it at its 16 GiB threshold;
- application-side memory-amplification risks exist around serialization, autosave, snapshots and snapshot listing;
- disabling motion/transparency produced a major usability improvement for the affected Linux reporter;
- the PWA remains a valuable Chromium performance/control reference;
- desktop project-data encryption remains an area requiring renderer-independent completion;
- historical Tauri PRs #352–#356 remain candidates for reconciliation, not blind merge (see §65 for the `gh`-verified disposition of each, established at Wave 0 / 2026-08-18).

The CEF program must preserve recent reliability gains and must not reintroduce previously corrected storage, lifecycle or security defects.

---

# 4. Binding program principles

## 4.1 CEF is production infrastructure

Every CEF decision must be evaluated against real production operation:

- installers;
- signing;
- updates;
- rollback;
- sandbox;
- crash handling;
- long sessions;
- large projects;
- field support;
- migrations;
- accessibility;
- privacy;
- security patch cadence.

A window that renders `dist/` is merely an early milestone.

## 4.2 No big-bang rewrite

The React application remains the production frontend during migration.

Preferred progression:

```text
current main
→ platform boundary
→ CEF bootstrap
→ vertical slices
→ packaged beta
→ parity
→ hardening
→ stable cutover
→ Tauri retirement
```

## 4.3 Current `main` is the only implementation baseline

Do not build CEF on stale Tauri PR branches.

Unique useful deltas from older PRs are reimplemented or extracted after diffing against current main.

## 4.4 Do not reproduce Tauri coupling under a new name

The migration target is not:

```text
Tauri API
→ matching CEF API
```

It is:

```text
Tauri-specific behavior
→ product capability
→ renderer-neutral platform/core implementation
```

## 4.5 Rust becomes increasingly authoritative

Move critical desktop responsibilities out of the renderer where this materially improves correctness, security, performance or future portability:

- persistence;
- large serialization;
- compression;
- snapshots;
- crypto;
- migrations;
- filesystem;
- tasks;
- diagnostics;
- updater state;
- large native transforms.

## 4.6 IPC is a security boundary

No arbitrary privileged command bridge.

Every operation must be:

- named;
- typed;
- validated;
- capability-scoped;
- size-limited;
- origin-aware;
- observable;
- cancellable where relevant.

## 4.7 Measure performance

CEF is not accepted because "Chromium should be faster".

Benchmark:

- PWA Chromium;
- Tauri/WebKitGTK;
- CEF Chromium.

## 4.8 Data integrity outranks visual polish

No renderer, GPU or performance optimization may weaken:

- save correctness;
- migration safety;
- encryption;
- recovery;
- backups.

## 4.9 Tauri retirement requires proof

Tauri remains until CEF has replaced its relevant functional and operational guarantees.

## 4.10 `egui/wgpu` remains locked

Allowed before Native-v2 admission:

- documentation;
- renderer-neutral core design needed for CEF;
- APIs that do not prevent a future native client.

Not allowed:

- native UI implementation;
- egui Writer;
- native packaging;
- second desktop feature-parity track.

---

# 4.11 CEF/Rust competency and knowledge-building program

CEF plus a deeper Rust core is deliberately ambitious. The program must therefore treat **knowledge acquisition as an engineering deliverable**, not as an informal prerequisite that is assumed to happen automatically while production code is being written.

The objective is not to make every contributor a Chromium specialist. The objective is to ensure that the project has explicit competence in the areas where incorrect assumptions can create hard-to-debug crashes, security defects, lifetime errors, deadlocks, packaging failures, or renderer instability.

## 4.11.1 Required competency domains

Before the CEF host becomes a critical production dependency, the team/agent workflow must establish working knowledge of:

### CEF architecture
- browser process vs renderer process vs GPU/utility processes;
- CEF browser/frame/client ownership;
- process callbacks;
- message-loop choices;
- shutdown ordering;
- subprocess launch and packaging;
- Chromium sandbox expectations.

### CEF threading and lifetime rules
- UI-thread-only callbacks;
- IO-thread behavior;
- reference-counted CEF objects;
- callback lifetime;
- renderer/browser process boundaries;
- async cancellation and object invalidation;
- shutdown races.

### Rust binding layer
- exact binding crate/version selected;
- unsafe and FFI boundaries;
- wrapper ownership model;
- supported CEF API coverage;
- missing/partial APIs;
- platform-specific gaps;
- binding upgrade procedure.

### Cross-platform native host
- Linux loader/resource layout;
- Windows process/installer/sandbox behavior;
- macOS bundle/helper-process/signing structure;
- native window lifecycle;
- high-DPI behavior;
- input/IME/accessibility integration.

### Operational CEF
- crash reporting;
- symbol handling;
- Chromium/CEF version updates;
- sandbox verification;
- packaging dependencies;
- runtime diagnostics;
- GPU/process troubleshooting.

---

## 4.11.2 Knowledge-building phase

Before the first production-capable native bridge, create a focused **CEF Enablement / Knowledge-Building phase** with concrete artifacts.

Required outputs (skeletons created at Wave 0; real content arrives Wave 2+ as the corresponding competency is actually built):

```text
docs/cef/knowledge/cef-architecture-primer.md
docs/cef/knowledge/cef-rust-binding-cookbook.md
docs/cef/knowledge/threading-and-lifetimes.md
docs/cef/knowledge/subprocess-and-shutdown.md
docs/cef/knowledge/linux-runtime-notes.md
docs/cef/knowledge/debugging-and-crash-playbook.md
docs/cef/knowledge/binding-upgrade-playbook.md
```

These documents should be written from the actual WorldScript integration, not copied generic CEF tutorials.

---

## 4.11.3 Minimal executable learning harness

Create a small, isolated CEF integration harness before the full WorldScript host becomes complex.

The harness should prove:

- browser creation;
- renderer subprocess launch;
- controlled internal content;
- JS↔native request/response;
- browser close;
- renderer crash detection;
- GPU-process observation where available;
- accessibility enablement/smoke;
- clean CEF shutdown;
- repeat launch/close cycles.

This harness becomes both:

1. a learning tool; and
2. a regression test for binding/CEF upgrades.

This is Wave 2 scope — not built in Wave 0. Wave 0 only records the plan for it (§61.1 below) and the competency gate it must pass.

---

## 4.11.4 Pairing and dual-review policy

The first critical CEF milestones should not be implemented by a single unchecked path.

Require **pairing or independent second-pass review** for:

- CEF initialization;
- message-loop integration;
- subprocess setup;
- sandbox configuration;
- unsafe Rust/FFI;
- browser/client ownership;
- shutdown;
- IPC bridge;
- crash reporting;
- packaging/signing.

"Pairing" may be:

- two human engineers;
- human + specialist coding agent with explicit review pass;
- primary implementer + independent expert reviewer.

The important invariant is **independent challenge of lifecycle and security assumptions**.

---

## 4.11.5 External expertise escalation

Budget an explicit option for external CEF/Chromium expertise for the earliest high-risk milestones.

External review becomes strongly recommended if any of the following occur:

- unclear binding lifetime semantics;
- production requires disabling sandbox behavior;
- repeated process shutdown hangs;
- unexplained GPU/Wayland/X11 failures;
- cross-platform subprocess packaging uncertainty;
- crash reporting cannot reliably distinguish process roles;
- binding API gaps force significant custom FFI;
- CEF upgrades repeatedly break the integration.

External expertise should be used strategically for architecture validation and unblockers, not as permanent ownership of WorldScript business logic.

---

## 4.11.6 CEF competency gate

Before `WS-CEF-IPC` or production storage capabilities are allowed to expose privileged native operations, require:

```text
[ ] CEF process architecture documented
[ ] chosen Rust/C++ integration model documented
[ ] binding version pinned
[ ] unsafe/FFI boundary identified
[ ] threading/lifetime map reviewed
[ ] clean repeated startup/shutdown proven
[ ] renderer termination observed and handled
[ ] sandbox development plan validated
[ ] Linux runtime dependencies inventoried
[ ] at least one accessibility smoke test performed
[ ] at least one crash-reporting/symbolization path proven
[ ] upgrade playbook exists
```

This is an engineering gate, not a training checkbox. Current status: not started — see `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md` for the live checklist.

---

# 4.12 Bus-factor and maintainability requirement

CEF knowledge must not live in one person, one agent conversation, or one undocumented workaround.

For every critical native subsystem maintain:

- an architectural owner;
- an operational playbook;
- reproducible tests;
- failure examples;
- upgrade notes.

Any CEF workaround that cannot be explained in repository documentation is temporary technical debt and must be tracked explicitly.

---

# 5. Required architecture decision record

**Status: done at Wave 0.** [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md) locks:

1. CEF is the intended production successor to Tauri/system-WebView Desktop.
2. React/Vite remains the primary frontend during the migration.
3. Rust increasingly owns critical desktop concerns.
4. Tauri is a transition/reference/fallback runtime.
5. CEF development starts from current `main`.
6. Renderer-native integration occurs through typed contracts.
7. Renderer IPC is allowlisted.
8. `egui/wgpu` production development is forbidden before the Native-v2 admission gate.
9. New desktop functionality should avoid unnecessary Tauri-only coupling.
10. Storage, updater, diagnostics and crash recovery are first-class CEF deliverables.

---

# 5.1 Language boundary — Rust/TypeScript primary, C++ narrowly conditional, Go default-NO

The CEF program must retain language-focus discipline.

The default architecture is:

```text
React / TypeScript
→ presentation

Rust
→ native/core/product capabilities

C/C++
→ only a thin CEF integration layer if the evidence-based integration decision requires it
```

**Go is not part of the CEF core plan.**

Introducing Go now for storage, IPC, task supervision, updater orchestration or native business logic would create another toolchain and ownership boundary without a demonstrated need.

---

## 5.1.1 When Go may be reconsidered

A future Go component is admissible only if it is an **independently deployable process/tool** with a strong concrete reason.

Potential examples, if future requirements justify them:

- an optional standalone network/server component;
- a separately distributed operations/service daemon;
- a utility whose Go ecosystem provides a uniquely compelling operational advantage.

Even in those cases, require all of:

```text
[ ] separate-process boundary is natural
[ ] component can be versioned/deployed independently
[ ] Rust would impose a demonstrated material disadvantage
[ ] no duplicate WorldScript domain logic
[ ] protocol boundary is stable and documented
[ ] security/operations ownership exists
[ ] benchmark/operational evidence supports the choice
[ ] architecture review explicitly approves it
```

Default decision if these conditions are not met:

```text
NO-GO for Go
```

---

## 5.1.2 Explicit non-use cases for Go

Do not introduce Go merely to:

- avoid learning CEF/Rust FFI;
- implement a second task supervisor;
- proxy CEF IPC;
- duplicate the updater;
- duplicate storage/crypto;
- replace a Rust utility because a contributor prefers Go;
- create an unnecessary local microservice around a desktop application.

Language diversity must solve a real boundary problem, not dilute focus.

---

# 6. Target repository shape

The repository should evolve incrementally toward a structure similar to:

```text
WorldScript-Studio/
│
├── apps/
│   ├── web/
│   ├── desktop-cef/
│   └── desktop-tauri/            # transitional
│
├── crates/
│   ├── worldscript-core/
│   ├── worldscript-domain/
│   ├── worldscript-storage/
│   ├── worldscript-crypto/
│   ├── worldscript-tasks/
│   ├── worldscript-diagnostics/
│   └── worldscript-platform/
│
├── packages/
│   ├── ui/
│   ├── ai-core/
│   ├── worker-bus/
│   ├── collab-transport/
│   ├── desktop-contracts/
│   └── shared-types/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── desktop-cef/
│   ├── packaged/
│   ├── perf/
│   └── fixtures/
│
└── docs/
    ├── architecture/
    ├── cef/
    ├── migration/
    └── release/
```

This is a target direction, not a mandate for an immediate repository mega-reorganization. Note: `packages/` today already contains `ai-core`, `ui`, `worker-bus`, `collab-transport` — `desktop-contracts`/`shared-types` are the new additions this shape implies (Wave 1+). No `apps/` directory or `crates/` exist yet as of Wave 0.

---

# 7. WorldScript Core strategy

## 7.1 Core purpose

The native core is the authority for behavior that should not depend on React, CEF, Tauri, browser storage or future egui.

## 7.2 High-value early extraction

Prioritize:

### Persistence
- project save/load;
- settings persistence;
- active-project identity;
- autosave coordination;
- dirty state;
- save coalescing.

### Snapshots
- metadata;
- payload storage;
- pruning;
- byte/count budgets;
- recovery.

### Filesystem
- path resolution;
- project roots;
- atomic replacement;
- durability;
- temp cleanup;
- corruption checks.

### Diagnostics
- process/runtime identity;
- storage health;
- migration state;
- encryption state;
- crash data.

### Tasks
- priority;
- cancellation;
- deadline;
- retry;
- progress;
- concurrency;
- resource class.

## 7.3 Later extraction

Once CEF is operating:

- crypto;
- migration orchestration;
- project domain;
- search;
- RAG;
- export;
- AI provider/local AI layers;
- collaboration support where appropriate.

---

# 7.4 Native-readiness during the CEF phase — design now, implement later

`egui/wgpu` remains implementation-locked, but **Native-readiness is a cross-cutting architectural quality attribute starting now**.

The purpose is not to prematurely generalize every interface. The purpose is to prevent the CEF implementation from moving business rules deeper into React, browser lifecycle hooks, or CEF-only services in ways that would later force a second product rewrite.

The rule is:

> **Prepare interfaces and ownership boundaries for a future non-web renderer; do not build that renderer yet.**

## 7.4.1 Three-state separation

Every major feature should distinguish:

### Domain/business state
Renderer-neutral and ideally core-owned.

Examples:
- project entities;
- manuscript structure;
- semantic commands;
- snapshot metadata;
- task state;
- migration state.

### Presentation/UI state
Renderer-specific and allowed to remain in React.

Examples:
- open panel;
- modal visibility;
- hover;
- current tab;
- animation progress;
- temporary form focus.

### Durable user preference state
Renderer-neutral semantics even if each frontend renders the setting differently.

Examples:
- locale;
- reduced motion;
- autosave policy;
- AI provider selection;
- editor preferences.

Do not put domain truth into transient React component state.

---

## 7.4.2 Business-logic extraction rule

New business rules should not be introduced inside:

- React components;
- rendering hooks;
- CSS-driven state machines;
- CEF callback handlers.

Prefer:

```text
renderer event
→ typed command/use-case
→ core/domain behavior
→ renderer-neutral result/event
→ presentation
```

React may validate for immediate UX, but the authoritative rule remains outside the renderer.

---

## 7.4.3 Renderer-free testability

A capability is more Native-ready when its important behavior can be tested without:

- DOM;
- React;
- CEF;
- Tauri;
- browser storage.

For each major CEF wave, ask:

```text
Can the core behavior be tested headlessly?
```

If not, determine whether the coupling is genuinely presentation-specific or accidental.

---

## 7.4.4 Browser-only API quarantine

Browser APIs that are useful for presentation remain allowed.

But canonical product semantics should not become dependent on:

- `document.visibilityState`;
- service worker lifecycle;
- browser IndexedDB as the only durable source;
- DOM events as business commands;
- CSS state as application state.

Place unavoidable browser-specific behavior behind adapters.

---

## 7.4.5 Native-Readiness scorecard

At architecture-changing PRs and major CEF wave exits, record:

| Check | PASS / N/A / DEBT |
|---|---|
| Domain logic renderer-neutral | |
| Critical behavior headless-testable | |
| Canonical data outside UI state | |
| Browser APIs adapter-contained | |
| Platform APIs adapter-contained | |
| Stable semantic commands/events | |
| No duplicate business rule in JS/native | |
| Durable schema UI-independent | |
| Error taxonomy UI-independent | |
| Task semantics UI-independent | |

A `DEBT` result is allowed during migration, but must have an issue/owner.

---

## 7.4.6 Native-readiness anti-patterns

Reject or explicitly track:

```text
React hook becomes authoritative storage coordinator
CEF IPC handler contains product business rules
CSS/DOM state determines durable behavior
same validation duplicated in React and Rust
project schema shaped around a single React component
native core returns presentation-specific HTML
core errors encoded as toast text
business commands expressed as DOM event names
```

---

## 7.4.7 Native-readiness gate for CEF Stable

CEF Stable requires:

- critical product logic demonstrably separated from presentation;
- canonical project/storage schemas renderer-independent;
- storage/crypto/migration/task APIs usable without React;
- no new critical Tauri/CEF-only business-rule islands;
- Native-Readiness scorecard with no unowned high-impact debt.

This does **not** authorize egui implementation. It only prevents architecture debt that would make the later implementation unnecessarily destructive.

---

# 8. DesktopPlatform contract

React must progressively stop importing framework-specific desktop APIs.

Conceptual contract:

```ts
interface DesktopPlatform {
  readonly runtime: RuntimeInfo;

  filesystem: DesktopFilesystem;
  persistence: DesktopPersistence;
  dialogs: DesktopDialogs;
  window: DesktopWindow;
  menu: DesktopMenu;
  tray: DesktopTray;
  notifications: DesktopNotifications;
  updater: DesktopUpdater;
  lifecycle: DesktopLifecycle;
  tasks: DesktopTasks;
  diagnostics: DesktopDiagnostics;
  clipboard: DesktopClipboard;
  deepLinks: DesktopDeepLinks;
}
```

The exact implementation may be split into modules. The requirement is architectural separation, not one giant object. Not implemented at Wave 0 — this is Wave 1 scope.

---

# 9. Typed CEF ↔ Rust protocol

Define a versioned desktop protocol.

Conceptual request:

```json
{
  "protocolVersion": 1,
  "id": "uuid",
  "method": "project.save",
  "params": {}
}
```

Response:

```json
{
  "protocolVersion": 1,
  "id": "uuid",
  "ok": true,
  "result": {}
}
```

Structured failure:

```json
{
  "protocolVersion": 1,
  "id": "uuid",
  "ok": false,
  "error": {
    "code": "PROJECT_SAVE_FAILED",
    "message": "Safe user-facing message",
    "retryable": true
  }
}
```

Events:

```text
task.progress
project.saved
storage.warning
renderer.recovered
update.available
update.progress
```

Protocol requirements:

- request IDs;
- cancellation;
- timeout;
- progress;
- structured errors;
- capability negotiation;
- schema version;
- payload size limits;
- binary-transfer policy;
- backpressure;
- instrumentation.

Large binary or huge project data must not automatically be base64/JSON copied through IPC. Wave 4 scope — not implemented at Wave 0.

---

# 10. CEF integration implementation choice

A constrained spike must choose between:

## Option A — Rust CEF bindings

Advantages:
- Rust-centric host;
- less C++ surface;
- potentially tight integration.

Risks:
- binding maturity;
- unsafe surface;
- cross-platform parity;
- ecosystem/documentation depth.

## Option B — thin C++ CEF host + Rust core

Advantages:
- closest to upstream CEF examples and lifecycle model;
- mature CEF integration patterns.

Risks:
- additional C++ toolchain;
- FFI boundary.

Rule if selected:

> C++ owns CEF integration only. It must not become the home of WorldScript business logic.

## Option C — C API boundary

Potentially stable but verbose.

The selection spike must explicitly evaluate:

- Linux/Windows/macOS support;
- sandbox integration;
- crash callbacks;
- packaging;
- browser/renderer lifecycle;
- automation;
- upstream cadence;
- FFI maintenance.

Document the result in an ADR. Wave 2 scope — not decided at Wave 0. Scorecard template: Appendix H.

---

# 11. Secure CEF application origin and resource loading

Avoid a loosely privileged `file://` application.

Prefer a controlled internal application origin or CEF resource scheme, conceptually:

```text
worldscript://app/index.html
```

Requirements:

- only bundled application resources;
- deterministic MIME handling;
- no arbitrary path traversal;
- explicit external navigation interception;
- explicit download policy;
- strict CSP;
- no accidental privilege inheritance by remote content.

The custom scheme/resource handler must be tested against:

- `../` traversal;
- URL-encoded traversal;
- mixed slash styles;
- null bytes;
- oversized paths;
- invalid MIME types;
- origin spoofing.

Wave 3 scope.

---

# 12. CEF security model

The renderer should be treated as a **potentially compromised presentation process**.

It may:

- render UI;
- request approved native capabilities;
- receive approved project/application DTOs;
- perform browser-local presentation work.

It may not:

- arbitrarily read OS paths;
- execute arbitrary shell commands;
- access signing keys;
- retrieve native credentials;
- bypass storage policy;
- create unrestricted processes;
- disable the production sandbox.

Production invariants:

- Chromium sandbox enabled;
- no `--no-sandbox` workaround;
- remote debugging disabled or explicitly gated;
- no Node.js runtime injected into the renderer;
- external navigation intercepted;
- native bridge allowlisted;
- browser permissions denied by default unless a feature requires them.

---

# 13. Browser capability policy

Every browser-level permission must be classified.

Initial policy:

| Capability | Policy |
|---|---|
| Camera | deny unless an explicit future feature requires it |
| Microphone | explicit user-controlled grant for voice features |
| Geolocation | deny |
| Notifications | prefer native abstraction |
| Clipboard | controlled |
| WebGPU | feature-dependent, diagnosed |
| MIDI | deny |
| USB | deny |
| Serial | deny |
| Web filesystem APIs | not canonical desktop persistence |
| External navigation | intercepted |
| Downloads | controlled |

---

# 14. Persistence redesign

The renderer must stop being the durability authority.

Target conceptual flow:

```text
React interaction
      ↓
domain/native command
      ↓
Rust core
      ↓
authoritative state / transaction
      ↓
durable persistence
      ↓
acknowledged event
```

This does not require an IPC round-trip for every keystroke. It requires a design where a renderer crash cannot be equivalent to losing the only authoritative unsaved project state.

---

# 15. Dirty-state and save coordinator

Introduce explicit persistence states:

```text
clean
dirty
saving
saved
save_failed
recovery_required
```

A single save coordinator should own durable writes.

Requirements:

- no overlapping full project serializations;
- lifecycle flush and autosave share the same coordinator;
- no unbounded queue;
- "latest state wins" semantics where safe;
- obsolete saves can be dropped before expensive work;
- current write is never corrupted by cancellation;
- renderer lifecycle does not create duplicate save work;
- shutdown awaits required durable completion.

The existing "visibility hidden → full flush" behavior should be replaced by dirty-aware, coalesced persistence.

---

# 16. Large-data serialization and compression

Desktop-critical persistence should migrate away from repeated renderer-side:

```text
JSON.stringify
→ JS compression
→ IPC
→ filesystem
```

Target:

```text
structured change / canonical native state
→ Rust serialization
→ Rust compression
→ encryption
→ durable storage
```

Evaluate:

- streaming behavior;
- zstd or other appropriate native codec;
- backward compatibility;
- CPU cost;
- memory amplification;
- migration implications.

Do not change storage format merely for novelty. Measure and justify.

---

# 17. Snapshot redesign

The CEF program must eliminate current snapshot memory-risk patterns.

Required invariants:

1. Snapshot list rendering does not load full snapshot payloads.
2. Metadata is stored/indexed separately from heavy content.
3. Automatic snapshot count is bounded.
4. Total snapshot byte usage is bounded or actively monitored.
5. A project save and auto-snapshot do not perform uncontrolled duplicate full serialization.
6. Snapshot pruning is deterministic.
7. Snapshot failure cannot corrupt the active project.
8. Readers see only committed generations.
9. Snapshot payload format supports future deduplication/delta evaluation.

Current whole-manuscript word counting should become streaming/chunked rather than whole-document `join → split → filter`.

---

# 18. Durability model

Atomic rename protects readers from partial final files but does not by itself prove power-loss durability.

Document exact guarantees per platform.

Where strong durability is required, evaluate a sequence equivalent to:

```text
write temporary
→ flush/fsync temporary
→ atomic replace
→ flush/fsync parent metadata
```

Multi-file state should use a true commit concept:

- generation files + atomic manifest;
- journal;
- single transactional container;
- database transaction.

Binder binary + metadata must not rely on two independent final writes being "close enough".

---

# 19. Storage architecture decision checkpoint

CEF does not automatically imply "use SQLite".

At the appropriate wave, evaluate:

### File-oriented
Pros:
- portability;
- transparency;
- existing model.

### SQLite/native DB
Pros:
- transactions;
- partial updates;
- indexing;
- bounded incremental persistence.

### Hybrid
Potentially:
- portable project/export format;
- native transactional working store.

Criteria:

- recoverability;
- encryption;
- migration;
- large-project behavior;
- backup;
- user portability;
- future Native-v2 reuse.

No storage-engine migration without explicit ADR and recovery plan.

---

# 20. Encryption architecture

Desktop crypto must become renderer-independent.

Target `worldscript-crypto` responsibilities:

- versioned encrypted envelopes;
- AEAD;
- AAD bound to record identity/type;
- strong KDF;
- passphrase lifecycle;
- session lock/unlock;
- platform secret integration where appropriate;
- crash-resumable migrations;
- migration admission lock;
- binary assets;
- corruption detection;
- recovery.

No UI runtime may make security claims that exceed the actual native storage behavior. **This is the direct successor scope for PR #356's goal** (§65) — desktop project-text-at-rest encryption remains an open gap on `main` today and is tracked in the risk register as Wave-7 scope, not patched into the current Tauri filesystem architecture.

---

# 21. Credential storage

API credentials should not remain normal frontend persistence.

Preferred hierarchy:

1. Windows Credential Manager / platform-equivalent;
2. macOS Keychain;
3. Linux Secret Service;
4. carefully designed encrypted fallback when platform secret service is unavailable and policy allows it.

Rules:

- no silent protected→plaintext downgrade;
- no secrets in logs;
- no secrets in diagnostics;
- no full API key echoed back to UI after storage if not necessary.

This is the direct successor scope for PR #355's deeper goal (§65) — merged PR #363 already unified fail-closed API-key routing and discarded legacy derived-key files, but full platform-keychain integration remains future (Wave 7) scope.

---

# 22. Tauri → CEF data migration

CEF must safely adopt existing users.

Migration requirements:

- discover current data;
- identify schema/runtime version;
- validate source;
- create backup;
- checksum;
- migrate idempotently;
- journal progress;
- resume after interruption;
- verify result before cleanup;
- preserve fallback during beta;
- never destroy the old store before successful commit.

Early CEF beta should favor safety over seamlessness.

A separate CEF profile/cache is strongly preferred initially. Canonical project-data migration can be explicit and guarded.

---

# 23. Concurrent runtime protection

Tauri and CEF must not write the same canonical project concurrently without a defined lock/transaction model.

During transition evaluate:

- process-level project lock;
- runtime ownership marker;
- read-only fallback if another runtime owns the project;
- explicit "open anyway" recovery only when safe.

---

# 23.1 Accessibility integration must be proven early

Accessibility cannot wait until the late polish phase.

CEF/Chromium provides platform accessibility integration for windowed browsers, but WorldScript must prove that its **chosen host/window integration actually exposes the expected accessibility tree and interaction model**.

The early CEF bootstrap must therefore include an Accessibility Integration Spike.

Minimum early checks:

- accessibility is not accidentally disabled by host settings or command-line flags;
- CEF accessibility state can be enabled/observed intentionally;
- the WorldScript root, navigation and primary controls appear in the platform accessibility tree;
- keyboard focus reaches the CEF content correctly;
- native menu ↔ browser focus transitions work;
- one screen-reader smoke path works on the first target platform;
- focus is restored after native dialogs;
- renderer restart does not leave accessibility/focus broken.

Where useful, instrument CEF accessibility callbacks in development builds for tree/location diagnostics.

This early spike is not full certification. It prevents discovering after months of CEF work that the selected host/window strategy has a fundamental accessibility integration defect.

---

# 23.2 Accessibility regression ladder

Accessibility validation occurs at three levels:

### Early integration gate
During bootstrap:
- tree exists;
- keyboard/focus works;
- basic screen-reader smoke.

### Continuous feature gate
During normal CEF development:
- changed dialogs/menus/navigation receive keyboard/a11y tests;
- ARIA/browser semantics preserved.

### Final certification gate
Later hardening:
- representative screen readers;
- keyboard-only workflows;
- Writer;
- IME interaction;
- high contrast/scaling;
- complete cross-platform matrix.

The late Accessibility wave is therefore **certification and deep regression**, not the first time CEF accessibility is tested.

---

# 24. CEF bootstrap milestone

The first CEF milestone should intentionally be small:

1. initialize CEF correctly;
2. create native window;
3. load existing Vite `dist/`;
4. render WorldScript;
5. expose no dangerous native bridge;
6. support clean shutdown;
7. report CEF/Chromium/runtime identity.

This is the first production program milestone, not the end product. Wave 2 scope.

---

# 25. Immediate renderer bake-off

As soon as bootstrap works, compare:

```text
A — PWA / Chromium
B — Tauri / WebKitGTK
C — CEF / Chromium
```

Use identical frontend revision and workload.

Measure:

- cold start;
- warm start;
- Settings switching;
- Writer typing;
- Writer scrolling;
- motion/transparency ON/OFF;
- Alt-Tab loops;
- idle;
- autosave;
- snapshot boundary;
- large project;
- 30–60 minute session.

---

# 26. #332 differential validation

Issue #332 becomes an explicit CEF acceptance track.

On the reporter-class environment, collect:

- host RSS/PSS;
- CEF browser-process memory;
- CEF renderer-process memory;
- GPU-process memory where available;
- JS heap;
- frame/input latency;
- renderer crash count;
- GPU crash count;
- Alt-Tab failures;
- hard freezes.

CEF success must be evidence-based, not subjective.

The program should especially test:

```text
Ubuntu
KDE/Plasma
Wayland
NVIDIA
```

while also expanding beyond one machine.

---

# 27. Memory SLOs

Exact numerical budgets follow baseline measurement, but the contract is immediate:

> Repeated equivalent workloads must converge toward a stable memory plateau rather than exhibit monotonic unbounded growth.

Track:

- idle baseline;
- large project;
- save peak;
- snapshot peak;
- AI peak;
- 30-minute slope;
- 2-hour slope;
- GPU process;
- recovery.

A renderer reaching catastrophic multi-gigabyte growth without recovery is a release blocker.

---

# 28. CEF process diagnostics

WorldScript Diagnostics must distinguish:

```text
WorldScript native host
CEF browser process
CEF renderer process
CEF GPU process
JS heap
Rust core memory where measurable
```

This is mandatory.

The #332 investigation exposed how costly it is to have only one undifferentiated "the app used a lot of memory" observation.

---

# 29. Renderer crash recovery

CEF should turn process isolation into product resilience.

Target:

```text
renderer terminates
      ↓
host records sanitized crash context
      ↓
Rust core remains alive
      ↓
pending durable state secured
      ↓
renderer recreated
      ↓
UI rehydrated
      ↓
user sees recovery notice
```

A renderer crash should not automatically equal application-data loss.

Repeated crash loops should trigger Safe Mode.

---

# 30. GPU failure recovery

Handle explicitly:

- GPU process crash;
- device/context loss;
- software fallback;
- repeated GPU crash;
- driver/backend diagnostics.

Do not silently remain in a severely degraded software-rendering mode without observability.

---

# 31. Visual-effects policy

CEF will likely improve renderer behavior, but Chromium is not an excuse for unlimited visual cost.

Maintain or improve:

- Reduce Motion;
- Reduce Transparency;
- Plain Writing Surface.

Audit:

- `backdrop-filter`;
- large blur layers;
- permanent `will-change`;
- large fixed animated surfaces;
- unnecessary compositor promotion.

Define internal visual performance profiles if measurement justifies them:

```text
Full
Balanced
Reduced
```

Accessibility preferences always override decorative ambitions.

---

# 32. Desktop Diagnostics feature

Implement:

```text
Settings
→ About / Diagnostics
→ Copy Desktop Diagnostics
```

Include safe data such as:

- app version;
- runtime;
- CEF version;
- Chromium version;
- OS;
- kernel;
- desktop environment;
- Wayland/X11;
- GPU/driver;
- sandbox status;
- renderer backend;
- memory snapshot;
- project size class;
- snapshot count/bytes;
- storage health;
- encryption configured/locked state;
- migration state;
- update channel;
- crash/recovery counters;
- reduce-motion/transparency state.

Explicitly exclude:

- manuscript contents;
- API keys;
- passphrases;
- auth headers;
- signing keys;
- sensitive raw paths unless essential.

---

# 33. Logging and privacy

Use structured logs with:

- timestamp;
- process;
- subsystem;
- event;
- correlation ID;
- severity;
- sanitized metadata.

Never log full project objects as routine diagnostics.

Crash dumps may contain sensitive memory and therefore require a deliberate privacy/consent policy.

Prefer local diagnostics by default.

---

# 34. CEF version governance

Bundling CEF means WorldScript owns the desktop browser-runtime lifecycle.

Required automation:

```text
CEF/Chromium release
→ monitored
→ dependency update PR
→ build
→ unit/integration
→ packaged smoke
→ GPU/runtime checks
→ security evaluation
→ candidate release
```

Critical Chromium/CEF vulnerabilities require a defined patch-response policy.

Do not allow a stale embedded browser runtime to persist indefinitely.

---

# 34.1 CEF/Chromium security patch SLA

WorldScript Studio must operate its embedded Chromium runtime under an explicit internal **security response SLA**.

The purpose is not to promise that every upstream Chromium vulnerability requires an emergency WorldScript release. The purpose is to ensure that every relevant CEF/Chromium security event is triaged quickly, classified consistently, and patched within a defined risk window when the WorldScript threat model is affected.

## 34.1.1 Severity-based response targets

Use these internal targets unless a stricter incident-specific response is justified:

| Upstream risk class | Internal triage target | Patch/release target when applicable |
|---|---:|---:|
| Actively exploited / known exploitation relevant to embedded Chromium | within 24 hours | emergency candidate immediately; production release target <= 72 hours |
| Critical, remotely exploitable, plausible in WorldScript threat model | <= 1 business day | target <= 5 calendar days |
| High severity, relevant but mitigated by WorldScript usage/sandbox | <= 2 business days | target <= 10 calendar days |
| Medium | <= 5 business days | next planned maintenance release unless risk changes |
| Low / not applicable | document during normal dependency review | normal cadence |

These are **internal operational targets**, not guarantees to users. If a vulnerability is not exploitable in the WorldScript configuration, record why.

## 34.1.2 Emergency browser-runtime update lane

Maintain an emergency path capable of:

```text
upstream advisory
→ relevance assessment
→ CEF candidate selection
→ build
→ security smoke
→ core packaged smoke
→ updater/signature verification
→ targeted Linux/Windows/macOS runtime validation
→ emergency release
```

The emergency lane may shorten only non-risk-relevant long-tail validation. It must never omit:

- signature verification;
- sandbox smoke;
- application startup;
- project open/save;
- updater correctness;
- basic accessibility/focus;
- migration compatibility.

## 34.1.3 Patch deferral policy

A CEF/Chromium patch may be deferred only with a recorded decision containing:

- advisory/CVE;
- affected CEF/Chromium versions;
- affected WorldScript version;
- exploit prerequisites;
- renderer/network exposure analysis;
- sandbox relevance;
- mitigations and compensating controls;
- re-evaluation date;
- accountable owner.

No silent "update later" disposition is acceptable.

## 34.1.4 Security freshness indicators

Expose in release/governance reporting:

```text
Current CEF version
Current Chromium version
Latest evaluated upstream security release
Days since last CEF security review
Open browser-runtime security exceptions
Oldest exception age
```

An overdue critical/high exception becomes a release-management escalation.

## 34.1.5 Routine update cadence

Separate emergency security servicing from routine browser-runtime maintenance.

Operational policy:

- monitor upstream automatically where practical;
- evaluate each relevant stable CEF/Chromium security release;
- uptake routine CEF updates on a predictable maintenance cadence;
- avoid unnecessary large multi-version jumps;
- maintain one tested last-known-good runtime for rollback.

Security review must never depend on maintainers remembering to inspect upstream manually.

## 34.1.6 SLA automation

Repository/CI automation should enforce or at least surface:

- version-age checks;
- stale security-exception warnings;
- dependency-update issue/PR generation;
- release-blocking alerts when critical accepted-risk deadlines expire.

The final risk decision remains maintainer-owned, while deadline tracking is automated.

---

# 35. CEF binary provenance and licensing

Track:

- exact CEF version;
- Chromium version;
- binary source;
- checksum;
- third-party notices;
- redistribution requirements.

Initially prefer official/prebuilt CEF distributions.

Do not build Chromium from source unless a demonstrated product requirement justifies the large CI and security-maintenance burden.

---

# 36. Desktop capability parity inventory

Before replacing Tauri, inventory every current desktop responsibility. **Baseline established at Wave 0** — see `docs/cef/TAURI-COUPLING-INVENTORY.md` for the verified file-level detail behind this table.

Minimum matrix:

| Capability | Current | CEF target |
|---|---|---|
| renderer | system WebView | bundled Chromium/CEF |
| filesystem | Tauri FS (`services/fs/fsCore.ts`) | Rust core/platform |
| dialogs | Tauri Dialog (`services/fs/fsCore.ts`, `services/lora/loraTrainingService.ts`) | native platform adapter |
| tray | Tauri (`services/desktop/desktopTray.ts`, `services/tauriTrayService.ts`) | native CEF-host/platform |
| menus | Tauri (`services/desktop/desktopMenu.ts`, `services/tauriMenuService.ts`) | native command registry |
| quit/lifecycle | Tauri process/window (`App.tsx`, `plugin-process`) | native lifecycle coordinator |
| updater | Tauri Updater (`hooks/useTauriUpdater.ts`) | signed CEF updater |
| notifications | Tauri plugin (`services/desktop/desktopNotifications.ts`) | native adapter |
| deep links | Tauri (`services/tauriDeepLink.ts`) | native host |
| file associations | Tauri bundle (`src-tauri/tauri.conf.json`) | native installer |
| native tasks | Tauri commands (`services/tauriTaskBridge.ts`, `src-tauri/src/`) | Rust task runtime |
| diagnostics | partial | first-class |
| storage | mixed (IDB browser path + Tauri fs path) | core-owned |
| encryption | mixed — IDB path complete (ADR-0018), Tauri filesystem path incomplete (§65, PR #356 gap) | core-owned |

No capability disappears silently.

---

# 37. Command registry

Menus, shortcuts, command palette and future native frontend should converge on shared command IDs:

```text
CommandId::Save
CommandId::OpenProject
CommandId::Search
CommandId::Settings
CommandId::CommandPalette
CommandId::Generate
CommandId::Quit
```

Native menu actions trigger command IDs rather than duplicate product logic.

---

# 38. Lifecycle semantics

Define distinct states:

```text
hide window
close window
quit application
OS shutdown
renderer crash
browser-process crash
system suspend
resume
update restart
```

One authoritative shutdown protocol should exist:

```text
request quit
→ stop accepting unsafe new work
→ cancel/defer tasks
→ flush save coordinator
→ persist window/application state
→ stop renderer
→ stop CEF
→ stop core
→ exit
```

Failure and timeout policy must be explicit.

---

# 39. Tray and menu parity

Required:

- localized menu labels;
- Show;
- Settings;
- Command Palette;
- Quit;
- close-to-tray;
- no duplicate event handlers;
- clean quit flush.

---

# 40. Deep links and file associations

Preserve/evaluate current schemes and project extensions.

Current project extensions:

- `.worldscript`
- `.wsst`

Test:

- cold-start deep link;
- already-running instance;
- malformed input;
- newer/older schema;
- encrypted project;
- project already open;
- untrusted invite token.

---

# 41. Single-instance and multi-window policy

Decide deliberately.

Avoid accidental multiple write owners.

If multi-window is introduced later, prefer a model such as:

```text
one native core
→ multiple CEF views
→ explicit project ownership
```

Do not add multi-project windows before locking storage ownership semantics.

---

# 41.1 Crash reporting and hang diagnostics are an independent operations track

CEF has its own multi-process crash-reporting facilities and process lifecycle. WorldScript must build an explicit **Crash Operations** subsystem rather than treating crashes as ordinary application log messages.

The subsystem must distinguish at least:

```text
native host crash/panic
CEF browser-process crash
CEF renderer-process crash
CEF GPU/utility-process crash
renderer termination/OOM
hang/freeze without crash
startup crash loop
```

A crash reporter alone is insufficient because #332-like incidents can manifest as hangs/frozen UI. Therefore Crash Operations must combine:

- CEF crash reporting/minidumps where appropriate;
- process termination callbacks;
- application heartbeat/watchdog diagnostics where safe;
- hang detection;
- structured runtime logs;
- process-memory snapshots;
- renderer recovery counters.

## 41.2 Symbolization and release provenance

Every crash artifact must be attributable to:

- WorldScript version;
- commit;
- CEF version;
- Chromium version;
- platform/architecture;
- symbol set/build ID.

Maintain a symbol retention/symbolization strategy for released builds.

Unsymbolized dumps without build provenance have limited operational value.

## 41.3 Crash privacy

Creative-writing content can be exceptionally sensitive.

Crash/minidump policy must therefore define:

- whether dump collection is local-only by default;
- user consent before upload;
- retention;
- filesystem permissions;
- redaction limits;
- transport encryption;
- deletion;
- who can access submitted dumps.

Never assume that a minidump is free of manuscript or credential material.

## 41.4 Crash-free and hang-free quality metrics

For beta/stable readiness, track:

- crash-free sessions;
- renderer-recovery success;
- startup crash-loop count;
- unrecovered hangs;
- forced-kill reports.

Do not use crash-free percentage as the only metric; a frozen renderer that never crashes is still a severe defect.

## 41.5 Crash Operations gate

Before broad CEF beta:

```text
[ ] native-host crash path tested
[ ] renderer termination path tested
[ ] GPU/utility crash observation tested where possible
[ ] symbols/build provenance available
[ ] privacy policy documented
[ ] local diagnostic bundle available
[ ] repeated startup crash invokes safe recovery path
[ ] at least one hang-diagnostic path exists
```

---

# 42. Updater as independent critical workstream

WorldScript must distinguish **two different update problems**:

1. **WorldScript application update** — the complete product, schemas, Rust core, frontend and bundled runtime.
2. **CEF/Chromium runtime servicing** — keeping the embedded browser engine on an acceptable security/stability revision.

CEF documents installer/runtime mechanisms on some platforms, including a Windows shared-runtime installer model, but that is **not a cross-platform replacement for the WorldScript application updater**. WorldScript must own an application-level update architecture even if platform-specific CEF servicing mechanisms are later used internally.

The CEF application updater must provide at least:

- signed manifest;
- signed artifact;
- cryptographic verification;
- release channels;
- version policy;
- download progress;
- disk-space checks;
- interrupted download recovery;
- atomic activation;
- rollback;
- failed-new-version crash-loop handling.

Treat updater bugs as potential P0/P1 issues.

---

# 43. Release channels

Plan for:

```text
stable
beta
nightly
```

During migration:

- Tauri can remain Stable;
- CEF initially Nightly/Internal;
- CEF then Beta;
- CEF Stable only after formal admission.

---

# 44. Packaging — Linux

Target staged support:

- `.deb`;
- AppImage;
- `.rpm` where justified.

Validation matrix:

- Ubuntu/Debian family;
- Fedora family where supported;
- KDE;
- GNOME;
- Wayland;
- X11 where in support policy;
- NVIDIA;
- AMD;
- Intel.

---

# 44.1 Linux runtime compatibility is its own engineering workstream

CEF removes the production dependency on the system WebKitGTK renderer, but it does **not** make Linux dependency-free.

CEF binary distributions ship a platform-specific `libcef` plus required resources and have Linux package/runtime dependencies that vary with the selected CEF build and compatibility floor.

Therefore define a **Linux Runtime Compatibility Contract**.

It must specify:

- minimum supported distribution/runtime baseline;
- CPU architectures;
- required dynamic libraries/packages;
- `libcef.so` and resource layout;
- loader/rpath policy;
- sandbox requirements;
- X11 policy;
- Wayland policy;
- Ozone/backend policy where relevant;
- GPU/driver support expectations;
- installer dependency behavior.

Do not hardcode a glibc/distro minimum in architecture docs until the selected CEF distribution and packaged builds have proven it.

---

# 44.2 Wayland and X11 must be tested from bootstrap onward

The historical problem involved WebKitGTK, but CEF/Chromium has its own Linux display and GPU stack.

Therefore:

> **"CEF uses Chromium" is not accepted as proof of Wayland/X11 correctness.**

The first Linux milestones should run both display-server paths where supported by policy.

Track separately:

```text
KDE / Wayland
KDE / X11
GNOME / Wayland
GNOME / X11 where supported
```

and combine them with:

```text
NVIDIA
AMD
Intel
```

Do not wait until Release Candidate to discover compositor/backend-specific behavior.

---

# 44.3 Clean-machine dependency tests

For every supported Linux package type, test in clean VMs/images:

- install dependencies;
- install WorldScript;
- launch;
- sandbox;
- GPU renderer;
- fonts;
- native dialogs;
- accessibility bridge;
- update;
- uninstall.

A developer workstation with accumulated packages is not sufficient proof.

---

# 44.4 CEF version compatibility-floor gate

Every CEF/Chromium upgrade must answer:

```text
Did required Linux runtime dependencies change?
Did the minimum supported distro/glibc floor move?
Did Wayland/X11 behavior change?
Did sandbox requirements change?
Did packaged resource layout change?
```

If yes, treat it as a product compatibility decision, not a routine dependency bump.

---

# 44.5 Hardware CI versus virtual CI

Cloud CI is valuable for compilation/install/smoke tests but cannot replace real graphics hardware for:

- NVIDIA Wayland;
- AMD Wayland;
- Intel GPU;
- suspend/resume;
- compositor integration.

Maintain at least a small real-hardware validation lane before Stable.

---

# 44.6 Low-end and resource-constrained device qualification

WorldScript Studio is a writing application first. It must remain useful on machines substantially weaker than a typical AI/developer workstation.

CEF carries a higher baseline runtime footprint than a minimal system-WebView shell, while local AI can add major RAM/VRAM pressure. Therefore the CEF program requires a dedicated **Low-End Qualification Track**.

This is not optional polish. It prevents the product from drifting toward high-end-hardware exclusivity.

## 44.6.1 Resource classes

Maintain at least three stable reference classes:

### Class L1 — minimum practical desktop
Representative profile:

- 8 GB system RAM;
- older integrated Intel/AMD GPU;
- 2–4 physical cores / modest mobile CPU;
- no dedicated GPU;
- SATA SSD or modest NVMe;
- 1080p display.

### Class L2 — constrained modern

- 12–16 GB RAM;
- recent integrated GPU;
- 4–6 CPU cores;
- no dedicated AI GPU.

### Class L3 — mainstream baseline

- 16 GB RAM;
- mainstream integrated or entry dedicated GPU;
- modern 6+ core CPU.

Exact devices may change, but class semantics must remain stable enough for trend comparisons.

## 44.6.2 Mandatory low-end scenarios

Test:

```text
cold start
small project
100k-word project
500k-word project
typing
search
Settings
autosave
snapshot
export
background/resume
update
```

Test local AI disabled and enabled separately.

## 44.6.3 Local AI resource-admission policy

Local AI must never destabilize the core writing workflow.

Add a resource-admission layer able to:

- inspect available RAM/VRAM;
- estimate model footprint;
- warn before model download/load;
- reject clearly unsafe combinations;
- prefer smaller models on constrained devices;
- unload models when not needed;
- avoid simultaneous model-load + snapshot/export peaks.

The Writer and project persistence always outrank model residency.

## 44.6.4 Graceful degradation hierarchy

Under pressure, degrade in this order where applicable:

```text
decorative effects
nonessential background indexing
preview caches
local AI model residency
derived analytics
```

before degrading:

```text
typing
save correctness
project load
recovery
```

Never trade data safety for AI or visual effects.

## 44.6.5 Low-end memory budgets

CEF Stable must establish measured budgets for:

- runtime baseline;
- small project;
- large project;
- local AI disabled;
- local AI active;
- autosave peak;
- snapshot peak;
- acceptable swap behavior.

A material L1/L2 regression requires explicit GO/NO-GO review.

## 44.6.6 Thermal and battery-aware behavior

On laptops and constrained devices consider:

- reduced nonessential background polling on battery;
- deferred indexing;
- lower-frequency diagnostics;
- explicit local-AI power/resource warnings;
- avoiding continuous decorative GPU work.

Never reduce persistence correctness to save power.

## 44.6.7 Low-end qualification gate

Before CEF Stable:

```text
[ ] L1 launch and core Writer workflow passes
[ ] L1 100k-word project usable
[ ] L2 500k-word project acceptable or documented limit
[ ] no OOM during routine save/snapshot
[ ] local-AI admission prevents unsafe model load
[ ] visual-reduction mode demonstrably lowers resource cost
[ ] swap/memory-pressure behavior documented
[ ] low-end regression baseline stored
```

---

# 45. Packaging — Windows

Required:

- signing;
- installer;
- upgrade-in-place;
- uninstall;
- AppData correctness;
- deep links;
- file associations;
- updater;
- crash/recovery.

---

# 46. Packaging — macOS

Required:

- Apple Silicon first-class;
- signing;
- notarization;
- entitlements;
- app bundle;
- DMG or equivalent;
- deep links;
- file associations;
- updater.

Intel support follows explicit product policy.

---

# 47. Profile/data separation

Do not mix disposable CEF browser state with durable WorldScript data.

Separate:

```text
canonical project data
native settings/credentials
CEF profile/cache
temporary files
logs
crash data
update staging
model files
```

Deleting a corrupt Chromium profile must never delete user manuscripts.

---

# 48. IndexedDB policy

Long-term desktop principle:

- canonical project data → native core;
- browser-local caches/UI convenience → IndexedDB if useful;
- secrets → not ordinary IndexedDB;
- large native assets → native storage.

Service-worker behavior must be explicitly reviewed so PWA update mechanics do not conflict with the native CEF updater.

---

# 49. Local AI and provider parity

CEF must preserve the useful provider matrix:

- Gemini;
- OpenAI;
- Anthropic;
- OpenRouter;
- Groq where supported;
- Ollama;
- LM Studio;
- local browser/CEF inference where still appropriate.

Validate:

- download;
- progress;
- cancellation;
- storage space;
- memory pressure;
- renderer responsiveness.

Over time prefer renderer-neutral AI orchestration for desktop.

---

# 50. TaskSupervisor evolution

CEF should evolve the current Rust supervisor from a thin bridge into a real task runtime.

Minimum task contract:

```text
task id
task type
priority
deadline
timeout
retry policy
cancellation
progress
resource class
result
structured error
```

Candidate workloads:

- compression;
- serialization;
- indexing;
- export;
- conversion;
- large text analysis;
- local AI helper tasks.

Move only measured bottlenecks.


---

# 51. Test architecture

CEF needs layered validation.

## Layer 1 — core unit tests

No renderer, no CEF.

Test:

- domain;
- storage;
- crypto;
- migrations;
- tasks;
- parsers;
- project format.

## Layer 2 — frontend/platform contract tests

React against mock DesktopPlatform.

## Layer 3 — native CEF integration

Real CEF host + real IPC.

## Layer 4 — packaged smoke

Real built artifact.

## Layer 5 — packaged E2E

Real installation/runtime flows.

## Layer 6 — performance / memory / soak

Long-running real-runtime tests.

## Layer 7 — field validation

Representative end-user systems.

A green web E2E suite is never sufficient evidence that CEF Desktop is healthy.

---

# 52. Bridge contract tests

Every privileged method requires tests for:

- valid input;
- missing input;
- invalid type;
- unknown enum;
- oversized payload;
- cancellation;
- timeout;
- permission denial;
- renderer disposal;
- native error;
- malformed protocol version.

Unknown methods must be rejected.

---

# 53. Failure injection

Persistence:

- temp-write failure;
- rename failure;
- flush failure;
- disk full;
- permission denied;
- corrupted file;
- truncated file;
- orphan temp;
- interrupted migration;
- crash during snapshot.

Updater:

- bad signature;
- corrupt download;
- disk full;
- network disconnect;
- restart during update;
- bad new binary;
- rollback.

Runtime:

- renderer crash;
- renderer OOM;
- GPU-process crash;
- IPC disconnect;
- native panic/test fault.

---

# 54. Deterministic project fixtures

Create reusable fixtures:

```text
project-small
project-medium
project-large
project-huge
project-snapshot-heavy
project-binder-heavy
project-image-heavy
project-ai-history-heavy
project-arabic
project-hebrew
project-mixed-bidi
project-japanese
project-chinese
project-korean
project-corrupt
```

Suggested text scale classes:

```text
small   < 25k words
medium  ~100k
large   ~500k
huge    1M+
```

The exact fixtures should represent actual WorldScript structures, not synthetic repeated text only.

---

# 55. Performance metrics

Track at least:

- cold start;
- warm start;
- project open;
- time to interactive;
- typing input latency;
- navigation p50/p95/p99;
- Writer scroll frame time;
- Settings switch;
- search;
- save duration;
- save main-thread block;
- snapshot duration;
- AI progress responsiveness;
- renderer memory;
- native memory;
- GPU process memory;
- CPU;
- IPC round-trip and throughput.

---

# 56. Performance budget policy

Do not invent final budgets before baseline measurement.

The program must nevertheless establish hard categories such as:

- routine interactions must feel immediate;
- no routine operation may block the UI thread for hundreds of milliseconds;
- typing must remain responsive under large documents;
- save/snapshot must not create multi-gigabyte transient amplification;
- background work must not cause visible UI starvation;
- memory must stabilize under soak.

Once measured, record numerical thresholds in CI/perf documentation.

---

# 57. Soak tests

CEF Release Candidate must survive a representative soak such as:

```text
2 hours total session
100–500 Alt-Tab cycles
large project
continuous editing
repeated autosaves
multiple snapshot cycles
project switching
Settings navigation
AI start/cancel
network loss/recovery
idle/background/resume
renderer restart
```

Required outcome:

- no hard freeze;
- no manual SIGKILL;
- no unrecovered renderer death;
- no monotonic unbounded PSS/RSS;
- no project corruption;
- no lost settings;
- no stuck save state.

---

# 58. Accessibility

CEF must preserve or exceed web accessibility.

Validate:

- keyboard-only use;
- focus order;
- screen reader;
- menu semantics;
- dialog semantics;
- Writer selection;
- large text;
- high contrast;
- reduced motion;
- reduced transparency;
- scaling;
- 200% zoom where applicable.

Accessibility is a release gate, not polish.

---

# 59. i18n / IME / BiDi

The existing multilingual surface must remain first-class.

Mandatory representative test set:

- English;
- German;
- Arabic;
- Hebrew;
- Japanese;
- Simplified Chinese;
- Korean.

IME validation:

- start composition;
- modify composition;
- cancel;
- commit;
- move cursor;
- selection during composition;
- candidate window behavior.

BiDi validation:

- RTL-only;
- mixed Latin/RTL;
- numbers;
- punctuation;
- AI suggestions and highlights.

---

# 60. Visual regression and browser automation

Retain existing browser/VRT strengths.

Add CEF-specific automation without unnecessarily exposing production remote debugging.

Development/test mode may enable:

- DevTools;
- controlled remote debugging;
- browser automation.

Production should not expose a debug port by default.

---

# 61. CI target architecture

Progressively add:

```text
cef-core
cef-native-compile
cef-linux-build
cef-windows-build
cef-macos-build
cef-learning-harness
cef-competency-gate
cef-integration
cef-packaged-smoke
cef-security
cef-security-sla
cef-doc-drift
cef-low-end-smoke
cef-perf-smoke
cef-success
```

Not all jobs must become mandatory on day one.

By Release Candidate, the aggregate CEF success gate must represent the actual product artifact.

---

# 61.1 Competency and Learning Harness must be observable in CI

The CEF learning harness and competency gates must not remain documentation-only.

Create a dedicated executable lane, conceptually:

```text
cef-learning-harness
```

and a policy validation job:

```text
cef-competency-gate
```

## 61.1.1 CI-enforceable harness checks

Where platform CI permits, automate:

```text
CEF initializes
browser process starts
renderer subprocess starts
internal page loads
typed IPC ping/pong works
renderer termination is detected
browser closes cleanly
CEF shutdown completes
second launch after shutdown succeeds
unknown privileged IPC method is rejected
runtime version/provenance is reported
```

On capable runners additionally exercise:

- accessibility-tree smoke;
- sandbox smoke;
- crash-artifact generation;
- Linux dependency presence.

## 61.1.2 Wave dependency enforcement

Encode prerequisite evidence into CI/repository policy.

Examples:

```text
WS-CEF-IPC
requires
cef-learning-harness = PASS
cef-competency-gate = PASS

WS-CEF-STORAGE
requires
cef-ipc-contract = PASS

WS-CEF-BETA
requires
cef-packaged-smoke = PASS
cef-crash-ops-smoke = PASS
cef-accessibility-smoke = PASS
```

This need not become a complex workflow engine. The invariant is that critical waves cannot silently bypass prerequisite evidence.

## 61.1.3 Machine-readable competency manifest

Maintain a manifest such as:

```yaml
cef_competency:
  binding_model_documented: true
  lifetime_model_reviewed: true
  repeated_shutdown_ci: true
  renderer_crash_ci: true
  sandbox_smoke: true
  accessibility_smoke: true
  crash_symbolization_smoke: true
```

Validation must fail CI when a required item for the active program phase is absent or false. Live tracking: `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md` (currently all items `false`/not-started — Wave 0 baseline).

Manifest entries should reference real tests/docs/evidence where practical rather than function as self-attestation.

## 61.1.4 Documentation-to-test evidence links

For critical integration assumptions maintain:

```text
Invariant
→ test
→ CI job
→ failure playbook
```

Example:

```text
CEF cleanly restarts after shutdown
→ tests/cef/lifecycle/restart
→ cef-learning-harness
→ docs/cef/knowledge/subprocess-and-shutdown.md
```

This converts learning into a maintained operational contract.

## 61.1.5 Required failure artifacts

The harness should publish compact sanitized diagnostics on failure:

- CEF/Chromium version;
- platform;
- process start/stop sequence;
- exit codes;
- sanitized logs;
- crash-artifact metadata;
- accessibility smoke status where relevant.

Never include user manuscripts or secrets.

## 61.1.6 Competency regression policy

A CEF upgrade that breaks the learning harness is automatically **not merge-eligible** until:

- integration is fixed; or
- changed upstream behavior is understood, documented, and the harness is deliberately updated.

This prevents dependency upgrades from silently invalidating hard-earned lifecycle knowledge.

---

# 62. Nightly Desktop Candidate lane

Nightly must build real CEF artifacts and run:

- startup;
- project open;
- edit;
- save;
- quit;
- relaunch;
- persistence verification;
- Settings;
- AI cancellation;
- diagnostics;
- crash-recovery smoke where practical.

---

# 63. Release Candidate lane

Add:

- fresh install;
- upgrade;
- migration;
- signed artifact;
- updater;
- rollback;
- uninstall;
- longer soak;
- security verification.

---

# 64. Field validation matrix

CEF must not be certified from one machine.

Linux reference set:

```text
NVIDIA + KDE + Wayland
AMD + KDE + Wayland
AMD + GNOME + Wayland
Intel integrated GPU + GNOME/KDE
```

Windows:

```text
NVIDIA
AMD
Intel integrated
```

macOS:

```text
Apple Silicon
Intel only if maintained by support policy
```

The #332 reporter environment remains an unusually valuable regression reference, but never the sole validation source.

The field program must also include at least one **resource-constrained / low-end reference system** representative of L1 or L2. High-end GPU stability and low-end usability are separate release dimensions.

---

# 65. Current open-PR reconciliation

**Verified 2026-08-18 via `gh pr view` against `qnbs/WorldScript-Studio` — this replaces the original draft's guessed dispositions with checked GitHub state.** The CEF program starts from `main`, not from #352–#356.

All five PRs opened 2026-08-13, branching from `main` (#352, #353, #354 directly; #355 stacked on #354; #356 stacked on #355). One day later, merged PR **#363** ("fix: stabilize critical desktop persistence and release gates," merged 2026-08-14, released as v1.27.1) shipped: atomic same-directory temp-write-plus-rename across every Tauri filesystem-backed store (project, settings, snapshots, Codex/RAG, images, binder payloads); unified fail-closed desktop API-key routing through the shared storage service with legacy derived-key files discarded; destructive confirmed recovery-reset; and blocking Rust/Tauri fmt/check/clippy/test CI plus required E2E/VRT gates. This overlaps heavily with #353's, #354's, and #355's stated goals.

Use disposition categories:

```text
MERGE_AFTER_FIXES
EXTRACT_UNIQUE_DELTA
REIMPLEMENT_ON_CURRENT_MAIN
SUPERSEDED_CLOSE
DEFER
```

## #352 — `docs(security): correct false desktop encryption claims`

**Verified content (the original draft guessed "image MIME/storage behavior" — incorrect; actual scope is documentation truthfulness):** corrects `docs/IDB-ENCRYPTION.md`'s false claim that Tauri desktop shares the web build's full IDB encryption lifecycle; it does not — `services/fs/*Store.ts` writes project/settings/snapshot/Codex/RAG/binder-asset data outside that path. Docs-only, no code changed. 16 files, +105/−55.

**State:** `mergeable: MERGEABLE`, `mergeStateStatus: BLOCKED` (likely pending review — `reviewDecision` empty; `codecov/patch` is the one failing check, all substantive CI green including the Tauri Rust Gate).

**Disposition: MERGE_AFTER_FIXES.** Pure docs correction, but it predates #363, which changed the very behavior it documents (fail-closed API-key routing, atomic writes). Re-diff its claims against current `main` before merging — some corrected claims may need a further update now that #363 shipped, or may already be accurate. Do not merge unread.

## #353 — `ci: add required Rust/Tauri compile gate on pull requests`

**Verified content:** adds a `rust-check` CI job (`cargo fmt --check`, `cargo check`, clippy, test) — previously Rust code in `src-tauri/` could merge without ever compiling. 19 files, +6796/−197.

**State:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, CI **failing** (Security Audit, Rust Check, CI Success all FAILURE).

**Disposition: SUPERSEDED_CLOSE.** #363 already shipped "blocking Rust/Tauri fmt/check/clippy/test CI" — visible today as the passing "🦀 Tauri Rust Gate" check on #352. Diff for any unique delta (e.g. a specific clippy rule or Linux build-dependency install step #363 didn't cover) before closing; close with a comment citing #363 and this roadmap.

## #354 — `fix(desktop): atomic writes for all filesystem-backed stores`

**Verified content:** every `services/fs/*Store.ts` writer previously wrote directly to its final path (`writeTextFile`/`writeFile`); a crash or power loss mid-write could truncate/corrupt with no recovery. Adds `writeTextFileAtomic` (temp-write + rename) across project, active-project marker, settings, API keys, snapshots, Codex, RAG vectors, binder assets, images. 14 files, +1318/−66.

**State:** `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, CI green (Quality Gate, Build, E2E, Storybook, Lighthouse, VRT all SUCCESS; only `codecov/patch` fails).

**Disposition: SUPERSEDED_CLOSE** (verify first). #363's description — "Replace authoritative Tauri AppData writes with same-directory temp-write plus rename, including project, settings, snapshots, Codex/RAG, images, and binder payload files" — is the same scope, same mechanism. Diff #354 against what actually shipped in #363 for any correctness edge case #363 missed (e.g. specific retry/error-path handling) before closing. Remember: atomic rename alone does not prove power-loss durability (§18) — this remains true regardless of which PR's implementation is kept.

## #355 — `security(desktop): fix API-key encryption using a real secret`

**Verified content:** F-05/F-06 (2026-07-29) was credited as fixed for upgrading desktop API-key encryption from unsalted SHA-256 to PBKDF2 + random salt, but never addressed the actual secret material used. Stacked on #354 ("needs `writeTextFileAtomic`"). 12 files, +364/−144.

**State:** base branch is `fix/desktop-atomic-writes` (#354), not `main`. `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, most CI not yet run (stacked).

**Disposition: SUPERSEDED_CLOSE, likely** (verify first) **+ DEFER the deeper fix.** #363's "unified fail-closed desktop API-key routing... legacy derived-key files discarded" covers the immediate secret-material issue this PR targets. Per §21 above, the durable fix — real platform-keychain integration (Windows Credential Manager / macOS Keychain / Linux Secret Service) — belongs in the renderer-neutral CEF/native core, not patched further into today's Tauri filesystem architecture. Do not restore or extend the old filesystem-key design; close citing #363, and track platform-keychain credential storage as Wave 7 scope.

## #356 — `security(desktop): encrypt project data at rest (text stores, desktop)`

**Verified content:** enabling Settings → Privacy → "Encrypt project data at rest" only ever protected the browser/PWA IndexedDB path; on Tauri desktop, `services/fs/*Store.ts` wrote project text unencrypted. Stacked on #355 ("Sibling of #355 — both branch from #354 independently"). 70 files, +2603/−116 — the largest and most architecturally significant of the five.

**State:** base branch is `fix/desktop-api-key-encryption` (#355). `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`, most CI not yet run (stacked).

**Disposition: EXTRACT_UNIQUE_DELTA / REIMPLEMENT_LATER — the one genuine gap.** Unlike #353/#354/#355, **nothing in #363 covers this.** #363 was atomic writes + API-key routing + CI gating, not full project-text encryption for the desktop filesystem path. Desktop Tauri builds today still lack at-rest encryption for project text stores; browser/PWA IDB encryption (ADR-0018, B-1) does not reach the Tauri filesystem path at all. The security goal remains fully valid. Per §20 above, do not merge the stale implementation as final CEF architecture — do not merge it at all in its current conflicting state — but do not let the goal quietly disappear either: it is carried forward explicitly as a named, owned risk (`docs/cef/CEF-RISK-REGISTER.md`) and as Wave 7 (`worldscript-crypto`) scope: migration journal, admission lock, AAD, binary assets, recovery, performance bounds — the same rigor already proven for the IDB path in ADR-0018.

## Execution note

The disposition table above is the analysis; **executing it (closing #353/#354/#355 with cited rationale, commenting on #356 to preserve intent and link the risk register, re-validating and merging #352) is a separate, explicitly user-confirmed action** — not a side effect of committing this document. See `docs/cef/CEF-RISK-REGISTER.md` for how #356's goal is tracked going forward.

---

# 66. CEF workstream catalogue

Use stable IDs:

```text
WS-CEF-ADR
WS-CEF-STATE
WS-CEF-PLATFORM
WS-CEF-BOOT
WS-CEF-ORIGIN
WS-CEF-IPC
WS-CEF-SECURITY
WS-CEF-SECURITY-SLA
WS-CEF-STORAGE
WS-CEF-SNAPSHOT
WS-CEF-CRYPTO
WS-CEF-MIGRATION
WS-CEF-CREDENTIALS
WS-CEF-LIFECYCLE
WS-CEF-MENU
WS-CEF-TRAY
WS-CEF-DIALOG
WS-CEF-DEEPLINK
WS-CEF-FILEASSOC
WS-CEF-TASKS
WS-CEF-AI
WS-CEF-UPDATER
WS-CEF-PACKAGING
WS-CEF-DIAGNOSTICS
WS-CEF-CRASH
WS-CEF-PERF
WS-CEF-MEMORY
WS-CEF-GPU
WS-CEF-LOWEND
WS-CEF-A11Y
WS-CEF-I18N
WS-CEF-TEST
WS-CEF-CI
WS-CEF-COMPETENCY-CI
WS-CEF-DOCS
WS-CEF-FIELD
WS-CEF-CUTOVER
WS-TAURI-RETIRE
WS-PERFECTION
WS-NATIVE-ADMISSION
```

---

# 67. Program waves

## Wave 0 — State reconciliation, architecture freeze and CEF enablement

**Status: in progress (this commit).**

Deliver:

- fresh current-main audit — done, see §3, §36, `docs/cef/TAURI-COUPLING-INVENTORY.md`;
- open PR/issue reconciliation — done, §65 (verified against real GitHub state);
- ADR — done, [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md);
- runtime capability inventory — done, `docs/cef/TAURI-COUPLING-INVENTORY.md` + `docs/cef/tauri-coupling-inventory.json`;
- risk register — done, `docs/cef/CEF-RISK-REGISTER.md`;
- this roadmap committed — done, this file;
- CEF/Rust competency matrix — done (baseline, all items not-started), `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md`;
- knowledge-building documentation skeleton — done, `docs/cef/knowledge/*.md`;
- isolated CEF learning harness plan — captured in §4.11.3 and §61.1 above (plan only; harness itself is Wave 2);
- external-expertise escalation criteria — §4.11.5 above;
- CI plan for the executable learning harness — §61.1 above (plan only; not implemented);
- documentation ownership manifest for Tier A CEF docs — done, `docs/cef/OWNERSHIP.yaml`.

Exit additionally requires the **CEF Competency Gate** for the scope about to be implemented — not required yet, since no CEF implementation starts until Wave 2.

Exit:

- source of truth unambiguous — satisfied: `main` is the baseline, and every historical PR (#352–#356) has a verified, evidence-based disposition rather than an assumption;
- no CEF dependency on stale branches — satisfied: nothing here depends on #352–#356; the one live gap they revealed (#356's goal) is tracked forward, not resurrected.

## Wave 1 — DesktopPlatform boundary and Native-readiness baseline

Deliver:

- renderer-neutral contracts;
- Tauri adapter;
- web adapter where needed;
- tests;
- initial UI-state/domain-state classification;
- first Native-Readiness scorecard;
- automated guardrail plan for direct platform imports.

Exit:

- direct Tauri imports confined to explicit transitional adapter surface.

## Wave 2 — CEF integration selection, competency proof and bootstrap

Deliver:

- binding/C++ decision;
- binding/lifetime/threading cookbook;
- isolated learning harness;
- CEF host;
- existing `dist/`;
- safe repeated startup/shutdown;
- version diagnostics;
- Linux dependency inventory;
- initial X11/Wayland launch checks;
- early accessibility integration smoke;
- initial crash-reporting/symbolization proof;
- learning harness running in CI;
- competency manifest initialized.

Exit:

- WorldScript renders reliably under CEF on Linux development systems;
- no production-critical lifecycle assumption remains undocumented;
- the Early Accessibility Gate passes on the first target platform;
- clean repeated start/close cycles pass.

## Wave 3 — secure origin, renderer validation and crash-operations foundation

Deliver:

- internal app origin/resource handler;
- CSP;
- navigation policy;
- PWA/Tauri/CEF benchmark harness;
- #332 comparison;
- process-role crash/termination diagnostics;
- hang-diagnostic foundation;
- Linux display-server/GPU compatibility matrix.

Exit:

- CEF renderer viability proven with evidence.

## Wave 4 — typed IPC v1

Deliver:

- requests;
- responses;
- events;
- errors;
- cancellation;
- capability negotiation;
- size limits;
- schema tests.

Exit:

- no generic privileged bridge.

## Wave 5 — persistence core vertical slice

Deliver:

```text
open project
→ edit
→ native save
→ quit
→ relaunch
→ restore
```

plus save coordinator and dirty-state model.

Exit:

- renderer is no longer sole durability authority.

## Wave 6 — snapshot / memory hardening

Deliver:

- metadata-only listing;
- retention/byte policy;
- efficient word counting;
- save/snapshot coordination;
- memory benchmarks.

Exit:

- no known snapshot-driven memory bomb.

## Wave 7 — crypto, credentials and migration

Deliver:

- renderer-independent crypto;
- binary protection;
- credential storage;
- migration journal;
- recovery.

**This is where #356's goal (desktop project-text-at-rest encryption) and #355's deeper goal (platform-keychain credentials) are actually implemented** — properly, on the renderer-neutral core, per §65's disposition.

Exit:

- desktop security claims truthful and tested.

## Wave 8 — desktop integration parity

Deliver:

- dialogs;
- tray;
- menus;
- window;
- notifications;
- clipboard;
- deep links;
- file associations.

Exit:

- user-visible shell parity.

## Wave 9 — task runtime and heavy native work

Deliver:

- mature TaskSupervisor;
- native compression/index/export work where measured;
- cancellation/timeouts/progress.

Exit:

- expensive work no longer unnecessarily burdens renderer.

## Wave 10 — AI/local AI parity

Deliver:

- cloud providers;
- Ollama;
- LM Studio;
- model downloads;
- cancellation;
- memory/space checks.

Exit:

- no material AI regression.

## Wave 11 — updater

Deliver:

- signed update system;
- channels;
- staging;
- activation;
- rollback;
- failure recovery.

Exit:

- production-grade update path.

## Wave 12 — cross-platform packaging and compatibility-floor qualification

Deliver:

- Linux;
- Windows;
- macOS packages;
- signing/notarization as applicable;
- clean-machine Linux dependency validation;
- initial low-end L1/L2 package/runtime smoke;
- documented CEF/Linux compatibility floor.

Exit:

- installable real artifacts on all supported platforms;
- no unknown mandatory Linux runtime dependency;
- basic low-end Writer workflow passes.

## Wave 13 — packaged-artifact E2E

Deliver:

- install;
- launch;
- edit;
- save;
- relaunch;
- migrate;
- update;
- recovery;
- uninstall.

Exit:

- CI tests the product, not merely the web app.

## Wave 14 — security hardening

Deliver:

- CEF threat-model review;
- IPC audit;
- sandbox verification;
- updater audit;
- dependency review;
- fuzz/property tests.

Exit:

- no unresolved security P0/P1.

## Wave 15 — performance / memory / GPU / low-end hardening

Deliver:

- numerical budgets;
- large fixtures;
- soak tests;
- GPU recovery;
- memory plateau proof;
- L1/L2 resource budgets;
- local-AI resource-admission validation;
- battery/thermal behavior review.

Exit:

- no known catastrophic runaway or reproducible hard freeze.

## Wave 16 — accessibility / i18n / IME certification

This is the **deep certification wave**, not the first accessibility test.

Deliver:

- cross-platform representative screen-reader validation;
- keyboard-only end-to-end workflows;
- CJK IME;
- RTL/BiDi;
- scale/theme/high-contrast tests;
- Writer-specific accessibility validation;
- regression comparison against Web/PWA.

Exit:

- no major accessibility/internationalization regression;
- early accessibility assumptions proven across the supported platform matrix.

## Wave 17 — controlled field beta

Deliver:

- beta channel;
- diagnostics;
- representative tester matrix;
- at least one low-end/resource-constrained tester;
- crash/hang operational dashboards;
- security-SLA dashboard;
- issue triage.

Exit:

- stable field operation across multiple hardware stacks.

## Wave 18 — Release Candidate

Deliver:

- full GO/NO-GO dossier;
- migration rehearsal;
- updater rehearsal;
- rollback rehearsal;
- known-risk ledger;
- security-patch SLA compliance report;
- documentation freshness report;
- competency/learning-harness CI status;
- low-end qualification report.

Exit:

- GO recommendation.

## Wave 19 — CEF Stable cutover

CEF becomes preferred Desktop.

Tauri becomes explicitly transitional/deprecated.

## Wave 20 — Tauri retirement

After a stabilization interval:

- remove obsolete runtime code;
- remove old dependencies;
- remove old CI;
- retain historical data-compatibility tests.

## Wave 21 — post-cutover perfection

WorldScript-wide:

- defect burn-down;
- tail-performance optimization;
- memory efficiency;
- recovery polish;
- UX consistency;
- accessibility;
- documentation;
- dependency cleanup.

## Wave 22 — Native-v2 admission review

Only now decide whether to start the separate `egui/wgpu` product.

---

# 68. PR slicing policy

CEF must not arrive as a 30,000-line replacement PR.

Preferred early sequence:

```text
PR A — ADR + roadmap
PR B — runtime/capability inventory
PR C — DesktopPlatform contract
PR D — Tauri adapter
PR E — CEF bootstrap
PR F — secure resource origin
PR G — diagnostics foundation
PR H — renderer benchmark/#332 harness
PR I — typed IPC foundation
PR J — persistence vertical slice
```

Each PR should:

- have one dominant concern;
- be independently testable;
- preserve buildability;
- include rollback path;
- add targeted tests;
- update architecture docs if an invariant changes.

Avoid long stacked PR chains. Merge frequently behind inactive build targets/feature gates.

(PR A and PR B are Wave 0's own two PRs — see the Wave 0 section above and Appendix G.)

---

# 69. Tauri feature-freeze policy

During CEF implementation:

### Always allowed
- security fixes;
- data-integrity fixes;
- severe regressions;
- critical production reliability;
- necessary release fixes.

### Strongly discouraged
- large Tauri-only architecture;
- major new Tauri-native capabilities that CEF would immediately replace.

Feature work should increasingly target renderer-neutral core + React presentation.

---

# 70. Product feature prioritization

During critical CEF waves, prioritize:

```text
stability
data integrity
security
migration
performance
packaging
diagnostics
```

over broad feature expansion.

Large plugin/collaboration/workspace additions should not destabilize the runtime transition.

---

# 71. CEF stable admission gate

CEF may be called Stable only when all major categories pass.

## Correctness
- open P0 = 0;
- open unaccepted P1 = 0;
- no known data corruption;
- migration verified.

## Runtime
- no reproducible hard freeze;
- no unrecovered renderer crash loop;
- safe recovery.

## Memory
- no unbounded standard-workload growth;
- bounded save/snapshot peaks;
- soak passes.

## Security
- sandbox verified;
- IPC audited;
- updater signatures verified;
- credentials protected;
- threat model current.

## Packaging
- Linux pass;
- Windows pass;
- macOS pass.

## Accessibility/i18n
- early CEF accessibility integration was proven before feature expansion;
- critical flows pass;
- representative screen-reader paths pass;
- IME/RTL validated.

## Native-readiness
- critical domain behavior renderer-neutral;
- storage/crypto/migration/task APIs usable without React;
- no unowned high-impact Native-readiness debt.

## Operational readiness
- crash reporting/symbolization works;
- hang diagnostics works;
- CEF/Chromium servicing playbook works;
- explicit security patch SLA operational;
- no overdue critical/high browser-runtime security exception without approved escalation;
- Linux dependency compatibility floor documented;
- learning/competency harness is CI-enforced;
- Tier A documentation ownership and drift checks are green.

## Resource constrained
- L1/L2 qualification completed;
- no routine core-workflow OOM;
- local-AI resource admission works;
- low-end regression baseline stored.

## Field
- representative systems pass.

---

# 72. Tauri retirement gate

Tauri may only be removed after:

```text
CEF feature parity                    PASS
CEF migration                         PASS
CEF encryption                        PASS
CEF credentials                       PASS
CEF updater                           PASS
CEF rollback                          PASS
CEF packaged Linux                    PASS
CEF packaged Windows                  PASS
CEF packaged macOS                    PASS
CEF memory soak                       PASS
CEF renderer recovery                 PASS
CEF GPU stability                     PASS
CEF accessibility                     PASS
CEF i18n / IME / RTL                  PASS
CEF field beta                        PASS
CEF low-end qualification              PASS
CEF security-patch SLA                 PASS
CEF competency CI                      PASS
CEF Tier A doc drift                    PASS
CEF open P0                           0
CEF open unaccepted P1                0
```

---

# 73. Native-v2 admission gate

No `egui/wgpu` production implementation begins until:

```text
CEF Stable                            PASS
Tauri retirement                     PASS or effectively complete
Storage core renderer-neutral         PASS
Crypto core renderer-neutral          PASS
AI core renderer-neutral              PASS
Task runtime renderer-neutral         PASS
Packaged E2E mature                   PASS
Updater mature                        PASS
Diagnostics mature                    PASS
Open P0                               0
Open unaccepted P1                    0
Large-project performance             PASS
Accessibility maturity                PASS
Product semantics stable              PASS
UI/business-state separation mature     PASS
Core behavior headless-testable         PASS
No critical renderer-owned business logic PASS
Native-Readiness debt reviewed          PASS
Engineering capacity confirmed          PASS
```

The future Native effort is then a **separate product implementation**, not an emergency CEF replacement.

---

# 74. Why Native v2 waits

The eventual native frontend will already face difficult work:

- professional Writer;
- text layout;
- IME;
- accessibility;
- BiDi;
- font fallback;
- rich presentation;
- feature parity.

It must not simultaneously chase moving targets in:

- storage;
- encryption;
- project format;
- AI;
- migrations;
- tasks.

CEF is the stabilization platform that makes Native v2 rational.

---

# 75. Program governance

Maintain a roadmap ledger:

| ID | Workstream | Goal/Finding | Status | Severity | Evidence | PR | Test | Exit |
|---|---|---|---|---|---|---|---|---|

Statuses:

```text
PLANNED
IN_PROGRESS
BLOCKED
VALIDATING
DONE
SUPERSEDED
DEFERRED
ACCEPTED_RISK
```

Severity:

```text
P0 Critical
P1 High
P2 Medium
P3 Low
```

CEF Stable blockers include:

- data loss;
- corruption;
- sandbox/IPC security failure;
- updater signature bypass;
- unbounded memory;
- hard freeze;
- renderer crash loop;
- migration dead end.

---

# 76. Risk register

**Live version: `docs/cef/CEF-RISK-REGISTER.md`** (kept as a separate document so it can be updated without editing this roadmap).

Initial high-level risks:

| Risk | Initial severity | Mitigation |
|---|---:|---|
| data migration corruption | Critical | backup, journal, idempotence, failure injection |
| updater defect | Critical | signatures, staging, rollback, RC rehearsal |
| unrestricted IPC | Critical | typed allowlist, schemas, fuzzing |
| CEF packaging complexity | High | incremental cross-platform CI |
| Chromium security cadence | High | automated monitoring/update lane |
| browser-runtime security patch delay | Critical/High | explicit SLA, automated freshness checks, emergency lane |
| CEF/Rust/C++ lifetime defects | High | minimal wrapper, competency harness, documented ownership |
| memory regression | High | process attribution, soak, budgets |
| GPU regression | High | matrix, recovery, diagnostics |
| low-end/resource regression | High | L1/L2 budgets, resource-admission, low-end CI/field lane |
| documentation drift | High | ownership tiers, generated facts, drift CI, freshness SLO |
| feature parity drift | High | machine-readable parity ledger |
| two-runtime transition burden | High | short-lived parity period, feature freeze |
| accessibility regression | High | early smoke + final certification |
| oversized binaries/low-end cost | Medium/High | low-end benchmark, lazy startup |
| **desktop project-text-at-rest encryption gap (ex-#356)** | **High** | **tracked forward to Wave 7; see risk register for owner/status** |

Every P0/P1 risk must have an owner, test and exit condition.

Operational quality evidence must therefore span more than ordinary CI:

```text
CI
+ executable competency evidence
+ documentation freshness
+ packaged artifacts
+ runtime measurements
+ high-end GPU evidence
+ low-end resource evidence
+ security-SLA status
+ field evidence
+ recovery evidence
```

---

# 77. Safe Mode and crash-loop prevention

CEF Stable should eventually provide Safe Mode.

Potential Safe Mode behavior:

- reduced effects;
- optional GPU fallback;
- plugins disabled if plugins exist;
- nonessential AI deferred;
- derived indexes delayed;
- clean CEF profile option;
- project recovery tools.

If renderer crashes repeatedly at startup:

```text
detect crash loop
→ preserve durable state
→ start Safe Mode
→ expose recovery/diagnostics
```

Profile corruption recovery must never delete canonical project data.

---

# 78. Supportability

Create a CEF-specific issue template requesting:

- WorldScript version;
- CEF/Chromium version;
- OS/kernel;
- desktop environment;
- Wayland/X11;
- GPU/driver;
- diagnostics output;
- project size class;
- repro steps;
- motion/transparency settings.

This turns future field reports into actionable evidence rather than generic "slow/frozen" descriptions.

---

# 79. Supply-chain and security operations

CEF increases the binary dependency surface.

Maintain:

- CEF/Chromium inventory;
- Rust SBOM/dependency inventory;
- Node dependency inventory;
- third-party notices;
- accepted-risk register;
- secret scanning;
- vulnerability scanning;
- release provenance.

A critical browser-runtime CVE must have an internal response process.

---

# 80. Documentation set

Create/maintain (paths adapted to the `docs/cef/` layout adopted at Wave 0 — see `docs/cef/OWNERSHIP.yaml` for the authoritative live list):

```text
docs/architecture/cef-runtime.md
docs/architecture/desktop-platform-contract.md
docs/architecture/worldscript-core.md
docs/cef/security.md
docs/cef/ipc.md
docs/cef/storage.md
docs/cef/migration.md
docs/cef/packaging.md
docs/cef/updater.md
docs/cef/diagnostics.md
docs/cef/testing.md
docs/cef/performance.md
docs/cef/release-gates.md
docs/cef/security-patch-sla.md
docs/cef/low-end-qualification.md
docs/cef/OWNERSHIP.yaml
docs/cef/knowledge/cef-rust-binding-cookbook.md
docs/cef/knowledge/threading-and-lifetimes.md
docs/cef/knowledge/debugging-and-crash-playbook.md
docs/cef/knowledge/linux-runtime-notes.md
docs/architecture/native-readiness.md
docs/architecture/language-boundaries.md
```

Documentation must describe actual current behavior, not intended future behavior as if already shipped.

---

# 80.1 Documentation ownership and drift control

The CEF program intentionally requires substantial documentation because lifecycle, FFI, security, migration, packaging and operational knowledge must not live only in code or individual memory.

That documentation volume creates its own risk:

> **Stale documentation can be more dangerous than missing documentation.**

Documentation therefore requires ownership, evidence linkage and automated freshness controls.

## 80.1.1 Documentation ownership metadata

Critical documents should declare or be represented in a central manifest with:

```text
Owner role
Backup owner/reviewer role
Last verified against WorldScript version/commit
Last verified against CEF version
Review cadence
Related tests/CI jobs
```

## 80.1.2 Document classes

### Tier A — release/security critical
- CEF integration/lifetimes;
- sandbox/security;
- updater;
- storage/migration;
- crash recovery;
- Linux runtime compatibility.

### Tier B — architecture/reference
- DesktopPlatform;
- Native-readiness;
- language boundaries.

### Tier C — explanatory/how-to
Lower enforcement.

## 80.1.3 Automated drift checks

Create a command such as:

```text
pnpm docs:cef-check
```

Validate:

- documented app version vs package version;
- documented CEF version vs pinned runtime;
- IPC list vs generated registry;
- runtime capabilities vs manifest;
- platform/package list vs release matrix;
- overdue verification date;
- missing owner metadata;
- missing related-test reference for Tier A docs.

Run it in CI.

**Deferred at Wave 0** (see `docs/cef/OWNERSHIP.yaml`): building even a minimal stub now would add an npm script and CI job with nothing real to check drift against yet, since no CEF code exists. Recorded as planned/not-implemented rather than silently omitted; revisit at Wave 1.

## 80.1.4 Generate facts, write rationale

Generate or validate machine facts from source where practical:

```text
CEF version
Chromium version
protocol methods
capability list
release channels
package targets
```

Human docs focus on rationale, invariants, trade-offs, failure semantics and recovery.

## 80.1.5 Change-triggered documentation review

Examples:

```text
desktop-cef/** → CEF lifecycle/architecture docs
worldscript-storage/** → storage/migration docs
worldscript-crypto/** → crypto/security docs
updater/** → updater/runbook
CEF version bump → Linux compatibility + binding cookbook + crash/sandbox assumptions
```

CI may accept relevant doc changes or explicit PR metadata: `docs reviewed — no change required`.

## 80.1.6 Documentation freshness SLO

Suggested internal policy:

- Tier A: every 90 days or relevant dependency/architecture change, whichever comes first;
- Tier B: every 180 days or major architecture change;
- Tier C: as needed.

## 80.1.7 Documentation debt ledger

Track:

```text
DOC-DEBT
owner
document
reason
risk
due date
```

High-risk Tier A drift becomes a release blocker.

## 80.1.8 Ownership must survive personnel changes

Prefer role/subsystem ownership and CODEOWNERS mapping over one person's name.

---

# 81. Developer experience

Target commands, exact naming subject to implementation:

```text
pnpm cef:dev
pnpm cef:build
pnpm cef:test
pnpm cef:smoke
pnpm cef:learning-harness
pnpm cef:low-end-smoke
pnpm cef:security-sla-check
pnpm docs:cef-check
pnpm cef:package
```

None of these exist yet as of Wave 0 — `package.json` has only `tauri`, `tauri:dev`, `tauri:build`, `dev:tauri`.

Provide reproducible bootstrap instructions and verified CEF binary checksums.

Cache CEF by exact version/platform/architecture.

---

# 82. Static architecture guardrails

Once DesktopPlatform exists, add automated checks preventing direct `@tauri-apps/*` imports outside approved transitional adapters.

Similarly:

- reject unknown IPC methods;
- validate generated contracts;
- enforce schema migration discipline;
- scan diagnostics for forbidden secret fields.

---

# 83. Renderer-neutral project commands

Long-term, evolve toward semantic operations:

```text
UpdateSection
AddCharacter
MoveBinderNode
CreateSnapshot
RenameProject
```

rather than whole-state replacement for every change.

Benefits:

- bounded IPC;
- smaller persistence work;
- deterministic undo possibilities;
- future Native-v2 reuse.

Do not force a full command-system rewrite before CEF needs it.

---

# 84. Canonical data vs derived data

Classify:

### Canonical
- project/manuscript;
- user settings;
- user-defined entities;
- explicit version data.

### Derived/rebuildable
- search index;
- analytics mirrors;
- RAG embeddings where reproducible;
- caches.

Derived-data failure must not block critical project saves unnecessarily.

---

# 85. Backup and repair

Long-term consider a renderer-independent Rust repair CLI capable of:

- verify project;
- inspect storage;
- migrate;
- rebuild derived indexes;
- export diagnostics;
- recover from partial states.

This benefits CEF today and Native v2 later.

---

# 86. Definition of Done for each CEF workstream

A workstream is not complete because code compiles.

Done means, where applicable:

- implementation;
- unit tests;
- integration tests;
- failure-path tests;
- diagnostics;
- docs;
- migration;
- packaged validation;
- rollback/recovery consideration;
- no unresolved high-severity review finding.

---

# 87. Final GO / NO-GO dossier

Before CEF Stable, produce a formal dossier containing:

1. current release candidate SHA/version;
2. feature-parity ledger;
3. unresolved issues;
4. accepted risks;
5. security audit results;
6. CEF/Chromium vulnerability status;
7. IPC/sandbox verification;
8. persistence/durability results;
9. migration rehearsal;
10. encryption/credential results;
11. updater rehearsal;
12. rollback rehearsal;
13. packaged platform results;
14. memory/soak results;
15. GPU results;
16. performance vs PWA/Tauri;
17. accessibility/i18n/IME results;
18. field beta evidence;
19. Tauri fallback readiness;
20. final GO/NO-GO recommendation.

---

# 88. Definition of success

The CEF program succeeds when WorldScript Desktop has:

- a controlled Chromium runtime;
- no production dependency on Linux WebKitGTK;
- a renderer-independent critical core;
- durable storage owned outside the renderer;
- complete desktop encryption/credential design;
- mature signed updater;
- reliable rollback;
- process-attributed diagnostics;
- renderer crash recovery;
- packaged E2E;
- measurable bounded memory behavior;
- an explicit, functioning Chromium/CEF security-response SLA;
- low-end/resource-constrained qualification as a first-class release dimension;
- CI-enforced CEF competency/lifecycle evidence;
- owned, freshness-checked critical documentation;
- cross-platform field evidence;
- preserved accessibility and internationalization;
- a clear path to retire Tauri;
- a core reusable by the later separate Native implementation.

---

# 89. Explicit anti-goals

The CEF program is **not**:

- a React rewrite;
- a simultaneous egui rewrite;
- a "bundle Chromium and hope" exercise;
- a reason to weaken sandbox/CSP;
- a reason to ignore current application-side memory amplification;
- a reason to abandon PWA quality;
- a reason to blindly merge stale Tauri PRs;
- a reason to duplicate business rules in native code and JS.

---

# 90. Immediate execution order

The immediate next actions should be:

1. Commit the CEF ADR. **[Done — ADR-0019]**
2. Commit this perfected roadmap. **[Done — this file]**
3. Reconcile #352–#356 against current main. **[Done — §65, verified against real `gh` state; execution of the disposition is a separate confirmed step]**
4. Inventory all direct `@tauri-apps/*` imports. **[Done — `docs/cef/TAURI-COUPLING-INVENTORY.md`]**
5. Inventory all Tauri capabilities and runtime assumptions. **[Done — §36]**
6. Establish the CEF/Rust competency matrix and knowledge-building artifacts. **[Done — `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md`, `docs/cef/knowledge/`]**
7. Define DesktopPlatform contracts. **[Wave 1]**
8. Produce the first Native-Readiness/UI-vs-domain-state scorecard. **[Wave 1]**
9. Route current behavior through a Tauri adapter without changing semantics. **[Wave 1]**
10. Run the CEF integration-choice spike. **[Wave 2]**
11. Build the isolated CEF learning/lifecycle harness. **[Wave 2]**
12. Bootstrap CEF and load current `dist/`. **[Wave 2]**
13. Implement secure resource origin. **[Wave 3]**
14. Prove early accessibility integration. **[Wave 3]**
15. Implement process/runtime/crash diagnostics foundation. **[Wave 3]**
16. Inventory Linux runtime dependencies and launch-test both supported display-server paths. **[Wave 3]**
17. Build PWA/Tauri/CEF #332 benchmark harness. **[Wave 3]**
18. Run the differential. **[Wave 3]**
19. Implement typed IPC v1 only after the CEF Competency Gate passes. **[Wave 4]**
20. Implement project persistence vertical slice. **[Wave 5]**
21. Establish application updater + CEF servicing strategy and explicit security-patch SLA. **[Wave 11, §34.1]**
22. Add documentation ownership metadata and CEF doc-drift validation. **[Ownership manifest done at Wave 0; drift-check tooling deferred to Wave 1, §80.1.3]**
23. Add packaged CEF CI plus `cef-learning-harness`/competency enforcement. **[Wave 2]**
24. Establish L1/L2 low-end reference devices and baseline measurements. **[Wave 12/15]**
25. Continue wave-by-wave with Native-Readiness checks at every architecture-changing gate. **[Ongoing]**

---

# 91. Strategic directive

> **WorldScript Studio will migrate its production desktop runtime from the current Tauri system-webview architecture toward a Chromium Embedded Framework based desktop runtime. CEF is the primary next-generation desktop target. The existing React/Vite frontend will be preserved and progressively decoupled from Tauri through typed platform abstractions and an increasingly authoritative Rust core. Persistence, encryption, migrations, native tasks, diagnostics, updater behavior, and other critical desktop responsibilities will be designed to be renderer-independent.**
>
> **The CEF implementation will originate from current `main`, will be delivered incrementally, and will be validated against both the Chromium PWA and the current Tauri runtime. It will be subjected to packaged-artifact, security, memory, GPU, performance, accessibility, migration, updater, crash-recovery, and field-validation gates. Tauri remains a transitional reference/fallback until CEF has demonstrated full required parity and production maturity.**
>
> **No production `egui/wgpu` implementation will begin while the CEF program is incomplete. WorldScript Native becomes eligible only after CEF is stable, the Tauri transition is complete, the wider application has been comprehensively hardened and substantially perfected, and the renderer-neutral core is mature enough to serve as the authoritative foundation for a second UI implementation.**
>
> **The objective is not merely to replace WebKitGTK. The objective is to establish a durable WorldScript platform whose desktop runtime is controlled, measurable, secure, recoverable, high-performance, and architecturally prepared for a later native presentation without duplicating product logic.**


---

# Appendix A — Master implementation checklist

## A.1 Architecture

```text
[x] CEF ADR committed
[x] roadmap committed
[x] current-main architecture baseline documented
[x] Tauri capability inventory complete
[x] direct Tauri import inventory complete
[ ] DesktopPlatform contract approved
[ ] renderer/core responsibility matrix approved
[ ] CEF integration approach selected
[ ] CEF lifetime/threading model documented
[x] Native-v2 gate documented
```

## A.2 CEF bootstrap

```text
[ ] CEF initializes
[ ] Chromium version exposed in diagnostics
[ ] bundled React/Vite app loads
[ ] secure internal origin implemented
[ ] external navigation intercepted
[ ] sandbox works in production package
[ ] clean shutdown works
[ ] crash callbacks wired
```

## A.3 IPC

```text
[ ] protocol version
[ ] typed methods
[ ] generated/shared types
[ ] request IDs
[ ] structured errors
[ ] timeout
[ ] cancellation
[ ] progress events
[ ] method allowlist
[ ] size limits
[ ] binary strategy
[ ] backpressure
[ ] unknown-method rejection
[ ] malformed-request tests
```

## A.4 Persistence

```text
[ ] explicit dirty state
[ ] single save coordinator
[ ] lifecycle flush coalesced
[ ] no duplicate whole-state serialization
[ ] canonical native project storage
[ ] native settings storage
[ ] active-project persistence
[ ] durable write semantics documented
[ ] disk-full behavior
[ ] permission-failure behavior
[ ] corruption detection
[ ] recovery
```

## A.5 Snapshots

```text
[ ] metadata separated
[ ] listing does not load full payloads
[ ] count budget
[ ] byte budget
[ ] pruning
[ ] streaming/efficient word count
[ ] serialization overlap eliminated
[ ] multi-file commit semantics where needed
[ ] failure injection
```

## A.6 Crypto

```text
[ ] versioned envelope
[ ] AEAD
[ ] AAD
[ ] passphrase/KDF policy
[ ] session lock
[ ] project text
[ ] settings if sensitive
[ ] Codex/RAG as required
[ ] images
[ ] Binder binary
[ ] migration journal
[ ] admission lock
[ ] corruption handling
[ ] recovery UI
```

## A.7 Credentials

```text
[ ] Windows credential backend
[ ] macOS Keychain backend
[ ] Linux Secret Service backend
[ ] fallback policy
[ ] locked-state behavior
[ ] no plaintext silent downgrade
[ ] no secrets in logs/diagnostics
```

## A.8 Desktop shell

```text
[ ] native dialogs
[ ] menus
[ ] tray
[ ] close-to-tray
[ ] clean quit
[ ] notifications
[ ] clipboard
[ ] deep links
[ ] file associations
[ ] single-instance policy
[ ] window-state persistence
```

## A.9 Updater

```text
[ ] signed manifest
[ ] signed package
[ ] verification
[ ] stable/beta/nightly channels
[ ] progress
[ ] retry
[ ] interrupted download
[ ] staging
[ ] atomic activation
[ ] rollback
[ ] bad-version crash-loop recovery
[ ] CEF/Chromium security-SLA integration
[ ] emergency browser-runtime update lane
[ ] last-known-good runtime rollback
```

## A.10 Packaging

```text
[ ] Linux .deb
[ ] Linux AppImage
[ ] RPM if adopted
[ ] Windows signed installer
[ ] macOS signed app
[ ] macOS notarization
[ ] file associations per platform
[ ] deep links per platform
[ ] uninstall
[ ] upgrade-in-place
```

## A.11 Testing

```text
[ ] core unit
[ ] contract tests
[ ] CEF native integration
[ ] packaged smoke
[ ] packaged E2E
[ ] migration
[ ] update
[ ] rollback
[ ] failure injection
[ ] memory
[ ] GPU
[ ] soak
[ ] a11y
[ ] IME
[ ] RTL
[ ] field beta
[ ] low-end L1/L2
[ ] CEF learning harness
[ ] security-SLA check
[ ] documentation drift check
```

---


# Appendix A.1 — CEF/Rust competency checklist

Live tracking: `docs/cef/CEF-RUST-COMPETENCY-MATRIX.md`.

```text
[ ] Process architecture understood/documented
[ ] Message loop decision documented
[ ] Thread affinity documented
[ ] CEF reference-count/lifetime rules documented
[ ] Rust binding unsafe surface reviewed
[ ] Binding API gaps catalogued
[ ] Subprocess packaging proven
[ ] Repeated startup/shutdown harness green
[ ] Renderer crash observation green
[ ] Accessibility smoke green
[ ] Crash-reporting/symbolization smoke green
[ ] Linux dependency inventory complete
[ ] X11/Wayland initial smoke complete
[ ] Upgrade playbook written
[ ] External-expertise escalation path documented
```

---

# Appendix A.2 — Native-Readiness review template

For every major architecture PR:

```text
Domain logic renderer-neutral:           PASS / N/A / DEBT
Canonical data outside UI state:          PASS / N/A / DEBT
Critical behavior headless-testable:      PASS / N/A / DEBT
Browser APIs adapter-contained:           PASS / N/A / DEBT
Platform APIs adapter-contained:          PASS / N/A / DEBT
Business rules not duplicated:            PASS / N/A / DEBT
Semantic command/event available:         PASS / N/A / DEBT
Error type renderer-independent:          PASS / N/A / DEBT
Durable schema renderer-independent:      PASS / N/A / DEBT
Future native consumer blocked by design: NO / EXPLAIN
```

Every `DEBT`/`EXPLAIN` item requires an issue or explicit accepted rationale.

---

# Appendix A.3 — Linux compatibility matrix template

| DE/Display | GPU | Package | Launch | Sandbox | GPU accel | A11y | Suspend/Resume | Soak |
|---|---|---|---|---|---|---|---|---|
| KDE/Wayland | NVIDIA | .deb | | | | | | |
| KDE/Wayland | AMD | .deb | | | | | | |
| KDE/X11 | NVIDIA | .deb | | | | | | |
| GNOME/Wayland | AMD | .deb | | | | | | |
| GNOME/Wayland | Intel | .deb | | | | | | |
| supported variants | ... | AppImage/RPM | | | | | | |

Every selected CEF upgrade re-runs the compatibility-floor subset.

---

# Appendix A.4 — Go decision boundary

Default:

```text
GO IN CORE?  NO
GO IN CEF HOST?  NO
GO FOR STORAGE/CRYPTO/TASKS?  NO
GO FOR UPDATER?  NO
```

Reconsider only for an independently deployable component with a demonstrated ecosystem/operational advantage and explicit architecture approval.

---

# Appendix A.5 — Crash and update operations checklist

```text
[ ] Host crash classified
[ ] Renderer crash classified
[ ] GPU/utility crash classified
[ ] Hang detection path exists
[ ] Minidump/crash artifact privacy documented
[ ] Symbols retained per release
[ ] Build IDs/provenance linked
[ ] Crash-loop Safe Mode works
[ ] App updater signed
[ ] App updater rollback works
[ ] CEF/Chromium servicing process documented
[ ] CEF security update response policy documented
[ ] Runtime upgrade compatibility floor checked
```

---

# Appendix B — Runtime comparison benchmark

Maintain the same test fixture and app revision across all three runtimes.

| Metric | PWA Chromium | Tauri/WebKitGTK | CEF Chromium | Target/Decision |
|---|---:|---:|---:|---|
| Cold start | | | | |
| Warm start | | | | |
| Time to interactive | | | | |
| Idle RSS/PSS | | | | |
| Large-project RSS/PSS | | | | |
| Peak save memory | | | | |
| Peak snapshot memory | | | | |
| 30-min memory slope | | | | |
| 2-h memory slope | | | | |
| Settings switch p95 | | | | |
| Writer typing p95 | | | | |
| Writer scroll frame time | | | | |
| Search latency | | | | |
| Autosave duration | | | | |
| Snapshot duration | | | | |
| Alt-Tab 100× | | | | |
| Alt-Tab 500× | | | | |
| Effects ON | | | | |
| Effects OFF | | | | |
| Renderer crashes | | | | |
| GPU crashes | | | | |
| Hard freezes | | | | |
| Manual SIGKILL needed | | | | |
| CJK IME | | | | |
| RTL/BiDi | | | | |
| Screen reader | | | | |

---

# Appendix C — #332 memory investigation acceptance matrix

## Scenario 1 — Effects matrix

```text
Transparency OFF / Motion OFF
Transparency ON  / Motion OFF
Transparency OFF / Motion ON
Transparency ON  / Motion ON
```

Record:

- input responsiveness;
- Settings p95;
- frame time;
- renderer memory;
- GPU process memory;
- stability.

## Scenario 2 — Background/resume

```text
cold start
→ 2 min idle
→ 20 Alt-Tabs
→ 5 min idle
→ 20 Alt-Tabs
→ Settings switching
→ 10 min idle
```

## Scenario 3 — Snapshot boundary

```text
launch
→ large project
→ edit
→ cross autosnapshot interval
→ save
→ inspect memory
→ repeat
```

## Scenario 4 — Long soak

```text
2 hours
→ repeated editing
→ repeated saves
→ snapshots
→ AI start/cancel
→ background/resume
```

Required CEF result:

- no WebKit-style catastrophic memory event;
- no equivalent CEF runaway;
- no unrecovered renderer death;
- stable memory plateau.

---

# Appendix D — Process attribution schema

Diagnostics should conceptually report:

```json
{
  "runtime": {
    "appVersion": "...",
    "runtime": "cef",
    "cefVersion": "...",
    "chromiumVersion": "..."
  },
  "processes": [
    {
      "role": "native-host",
      "pid": 0,
      "rssMb": 0,
      "pssMb": 0
    },
    {
      "role": "browser",
      "pid": 0,
      "rssMb": 0,
      "pssMb": 0
    },
    {
      "role": "renderer",
      "pid": 0,
      "rssMb": 0,
      "pssMb": 0
    },
    {
      "role": "gpu",
      "pid": 0,
      "rssMb": 0,
      "pssMb": 0
    }
  ]
}
```

Do not treat exact schema above as final API; preserve the role separation.

---

# Appendix E — Security invariants

1. Production sandbox is enabled.
2. Renderer has no arbitrary filesystem access.
3. Renderer has no arbitrary shell execution.
4. Renderer does not receive signing material.
5. Unknown IPC methods are denied.
6. Every privileged method validates input.
7. External content never inherits native bridge privilege.
8. Native bridge origin is validated.
9. Secrets never enter routine diagnostics.
10. Update artifacts are cryptographically verified.
11. User project data is not routine telemetry.
12. Crash data is treated as potentially sensitive.
13. Security state cannot silently downgrade.
14. Project import is considered untrusted input.
15. CEF/Chromium security updates are actively governed.

---

# Appendix F — Persistence invariants

1. A renderer crash cannot be equivalent to project loss.
2. Only one coordinator owns durable project writes.
3. Autosave and shutdown save do not independently full-serialize the same state.
4. Readers never observe an uncommitted generation.
5. Snapshot listing is metadata-only.
6. Derived indexes are rebuildable.
7. Migration is idempotent or resumable.
8. A failed migration preserves a recoverable source.
9. A corrupt derived cache cannot destroy canonical project data.
10. Tauri and CEF cannot concurrently write the same project without explicit ownership.

---

# Appendix G — Suggested early PR sequence

## PR 1 — `docs(architecture): adopt CEF desktop runtime strategy`

**Status: this PR.**

Contents:

- ADR;
- this roadmap (with §65 verified against real GitHub state);
- risk register, competency matrix, knowledge skeletons, ownership manifest;
- no runtime changes.

## PR 2 — `chore(desktop): inventory runtime capabilities and Tauri coupling`

**Status: follows this PR (Wave 0, second half).**

Contents:

- machine-readable capability ledger;
- direct `@tauri-apps` import report;
- no behavior change.

## PR 3 — `refactor(desktop): introduce renderer-neutral platform contracts`

Contents:

- interfaces/types;
- tests;
- no CEF yet.

## PR 4 — `refactor(desktop): route current Tauri behavior through platform adapter`

Contents:

- current behavior preserved;
- direct imports reduced.

## PR 5 — `feat(cef): bootstrap Chromium Embedded Framework host`

Contents:

- minimal host;
- existing `dist/`;
- no broad native bridge.

## PR 6 — `security(cef): add controlled app origin and navigation policy`

## PR 7 — `feat(cef): add runtime/process diagnostics foundation`

## PR 8 — `perf(cef): add PWA/Tauri/CEF desktop comparison harness`

## PR 9 — `feat(cef): add typed desktop protocol v1`

## PR 10 — `feat(storage): first Rust-owned project persistence vertical slice`

After these, continue by workstream rather than creating an enormous stacked chain.

---

# Appendix H — CEF integration decision scorecard

Score each candidate 1–5.

| Criterion | Rust binding | Thin C++ host | C API |
|---|---:|---:|---:|
| Linux support | | | |
| Windows support | | | |
| macOS support | | | |
| Sandbox | | | |
| Renderer callbacks | | | |
| GPU/crash callbacks | | | |
| Packaging | | | |
| Upstream docs | | | |
| Memory/lifetime safety | | | |
| FFI complexity | | | |
| Maintenance | | | |
| CI complexity | | | |
| Rust-core fit | | | |

Decision must be recorded, including why rejected alternatives were rejected.

---

# Appendix I — CEF Stable GO/NO-GO template

## Candidate

```text
Version:
Commit:
CEF:
Chromium:
Release channel:
```

## Correctness

```text
Open P0:
Open P1:
Data corruption known:
Migration blockers:
```

## Runtime

```text
Hard freeze reproductions:
Renderer crash loop:
GPU crash loop:
Recovery:
```

## Memory

```text
Idle:
Large project:
Save peak:
Snapshot peak:
2-hour slope:
```

## Security

```text
Sandbox:
IPC audit:
Credential audit:
Crypto audit:
Updater signatures:
CEF/Chromium CVEs:
Security-SLA compliance:
Open security exceptions:
```

## Packaging

```text
Linux:
Windows:
macOS:
```

## Accessibility/i18n

```text
Screen reader:
Keyboard:
IME:
RTL:
Scaling:
```

## Field

```text
Linux NVIDIA:
Linux AMD:
Linux Intel:
Windows:
macOS:
```

## Decision

```text
GO / NO-GO
Rationale:
Accepted risks:
Required follow-up:
```

---

# Appendix J — Tauri retirement checklist

```text
[ ] CEF is Stable
[ ] CEF is default Desktop runtime
[ ] migration adoption confirmed
[ ] no Tauri-only critical feature remains
[ ] no updater dependency on Tauri remains
[ ] old project-data compatibility tests exist
[ ] docs updated
[ ] release artifacts no longer require Tauri
[ ] direct Tauri imports removed
[ ] Tauri CI removed
[ ] Tauri dependencies removed
[ ] src-tauri archived/removed as planned
[ ] support documentation updated
```

Retirement should be its own reviewed program milestone, not cleanup hidden inside another PR.

---

# Appendix K — Native-v2 admission checklist

This checklist remains intentionally locked during the CEF program.

```text
[ ] CEF Stable
[ ] Tauri retired/effectively retired
[ ] storage core mature
[ ] crypto core mature
[ ] migration model mature
[ ] project schema stable
[ ] AI core mature
[ ] task runtime mature
[ ] packaged E2E mature
[ ] updater mature
[ ] diagnostics mature
[ ] no open P0
[ ] no open unaccepted P1
[ ] large-project performance strong
[ ] accessibility mature
[ ] i18n/IME/RTL mature
[ ] CEF can serve as behavioral reference
[ ] explicit engineering capacity exists
[ ] formal GO decision recorded
```

Only after this checklist passes may a separate `WorldScript Native / egui+wgpu` roadmap move from deferred concept to implementation.

---

# Appendix L — Long-term architectural invariants

1. **Canonical product state is independent of UI renderer.**
2. **Durable project state survives renderer failure.**
3. **Native privilege is explicit and least-privilege.**
4. **Storage and crypto are reusable by future runtimes.**
5. **Large workloads do not require repeated whole-state copies.**
6. **Every long-running task is cancellable or has documented non-cancellability.**
7. **Every critical migration has recovery semantics.**
8. **Every supported platform is validated as a packaged artifact.**
9. **Performance claims are based on measurements.**
10. **Security claims describe real deployed behavior.**
11. **Diagnostics are useful without exposing creative content or secrets.**
12. **Future Native v2 reuses product logic rather than reproducing it.**

---

# Appendix M — Visionary end-state

A mature WorldScript platform should be able to survive failures at layers that currently look inseparable.

Conceptually:

```text
Renderer crashes?
→ project remains safe.

GPU process crashes?
→ runtime diagnoses and recovers.

Update fails?
→ prior version boots.

Migration is interrupted?
→ journal resumes or rolls back.

Search index corrupts?
→ rebuild it.

CEF profile corrupts?
→ reset profile without touching manuscripts.

User moves from old Tauri?
→ verified migration.

Future Native client opens same project?
→ same core/storage semantics.

Large manuscript grows?
→ memory remains bounded and observable.
```

At that point the renderer ceases to be the architecture.

It becomes one replaceable presentation surface over a mature product core.

CEF is the immediate path to that state because it gives WorldScript Studio a controlled Chromium runtime while preserving its strongest existing UI investment. The later native Rust implementation becomes viable precisely because CEF first forces storage, security, tasks, diagnostics and product semantics into clean, reusable boundaries.

---

# Closing statement

This roadmap deliberately chooses **sequential ambition** over simultaneous architectural experimentation.

First:

> **Build CEF completely, rigorously, securely and measurably.**

Then:

> **Harden and perfect the entire application until the desktop product is robust enough to act as a reference implementation.**

Only after that:

> **Begin the separate WorldScript Native `egui/wgpu` product against the mature shared core.**

This sequencing maximizes the chance that both long-term architectures become excellent rather than leaving WorldScript with two partially finished desktop systems.



---

# Appendix M.1 — Chromium/CEF security SLA checklist

```text
[ ] Upstream release/advisory monitoring automated
[ ] 24h actively-exploited triage path documented
[ ] Critical patch target documented
[ ] High patch target documented
[ ] Emergency release lane tested
[ ] Patch-deferral template exists
[ ] Open exceptions have owners/due dates
[ ] Security freshness visible in dashboard
[ ] CI warns on overdue exception
[ ] Last-known-good runtime retained for rollback
```

---

# Appendix M.2 — Low-end qualification checklist

```text
[ ] L1 reference system selected
[ ] L2 reference system selected
[ ] cold start baseline
[ ] idle memory baseline
[ ] 100k Writer baseline
[ ] 500k Writer baseline
[ ] autosave peak
[ ] snapshot peak
[ ] local AI disabled baseline
[ ] local AI admission tested
[ ] visual reduction measured
[ ] battery/thermal behavior reviewed
[ ] regression thresholds stored
```

---

# Appendix M.3 — Documentation ownership manifest example

See the real, live manifest at `docs/cef/OWNERSHIP.yaml` (Wave 0). Template:

```yaml
documents:
  - path: docs/cef/security.md
    tier: A
    owner_role: desktop-security
    backup_role: cef-runtime
    last_verified:
      worldscript: "vX.Y.Z"
      cef: "X.Y"
    review_days: 90
    related_ci:
      - cef-security
      - cef-doc-drift

  - path: docs/cef/knowledge/threading-and-lifetimes.md
    tier: A
    owner_role: cef-runtime
    backup_role: rust-core
    review_days: 90
    related_ci:
      - cef-learning-harness
      - cef-competency-gate
```

---

# Appendix M.4 — Competency CI release invariant

A foundational CEF change is not eligible for merge if:

```text
cef-learning-harness != PASS
or
cef-competency-gate != PASS
or
required Tier A docs are overdue/missing
```

Exceptions require explicit maintainer override with written rationale and a short expiry date.


---

# Appendix N — Primary technical reference baseline

This roadmap should be kept synchronized with the selected CEF version. The following upstream references are particularly relevant to the integration assumptions made here:

- CEF Documentation index — architecture, API versioning, crash reporting, sandbox setup and installer documentation:
  https://chromiumembedded.github.io/cef/

- CEF General Usage — multi-process architecture, binary distributions, platform layout and Linux dependency guidance:
  https://chromiumembedded.github.io/cef/general_usage.html

- CEF Rust bindings (`cef` crate) — exact version must be pinned by the implementation ADR:
  https://docs.rs/cef/latest/cef/

- CEF BrowserHost accessibility API — verify against the exact selected CEF release:
  https://cef-builds.spotifycdn.com/docs/

- CEF installer/runtime documentation — currently includes platform-specific runtime installer concepts; it must not be confused with the cross-platform WorldScript application updater:
  https://chromiumembedded.github.io/cef/installer.html

**Rule:** Upstream behavior can change. During each CEF upgrade, revalidate version-specific assumptions instead of treating this appendix as timeless truth.
