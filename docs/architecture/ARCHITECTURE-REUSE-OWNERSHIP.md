# WorldScript Studio — Architecture Reuse & Ownership Policy

**Status:** Binding implementation-governance companion to the current architecture roadmap set.  
**Date:** 2026-08-24  
**Applies to:** React/PWA, Tauri transitional maintenance, Rust Core extraction, Qt 6/Qt Quick migration, and any future separately admitted renderer such as GPUI.  
**Does not replace:** ADR-0021, the canonical numbered native roadmap, or `DESKTOP-MIGRATION-ROADMAP-REV3.md`.

---

## 1. Purpose

WorldScript Studio already contains mature project, persistence, encryption, worker, AI, diagnostics, feature-gating, import/export, and desktop-abstraction primitives. The main architecture risk is therefore no longer a lack of abstraction. It is accidental duplication while PWA excellence, Rust Core extraction, and Qt migration proceed in parallel.

The governing principle is:

> **Perfect and compose the existing authority first. Introduce a new subsystem only when a real capability or ownership gap remains and the new boundary has a distinct responsibility that cannot be expressed safely by an existing authority or a narrow adapter.**

This policy prevents the repository from becoming separate React, PWA, Tauri, Qt, Rust, and future-GPUI product architectures.

The target is:

```text
ONE PRODUCT MODEL
ONE VERSIONED PROJECT TRUTH
ONE AUTHORITY PER SEMANTIC CAPABILITY

+ renderer-specific presentation
+ platform-specific adapters
+ browser-native PWA enhancements
+ Rust Core where portability, security, durability, or headless authority justify it
```

---

## 2. Authority hierarchy

### 2.1 Native/Desktop strategy

For native/Desktop work, read these as one authority chain:

1. ADR-0021 fixes the Qt-first / GPUI-deferred direction.
2. `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` remains the canonical numbered execution roadmap.
3. `docs/native/DESKTOP-MIGRATION-ROADMAP-REV3.md` is the normative Revision-3 refinement for #332, Tauri stop-loss, G1.5, Wave 2.5, G2.5, Qt differential qualification, and the related R-15 handoff rules.
4. `docs/native/TAURI-TRANSITIONAL-MAINTENANCE.md` is the operational Tauri support and stop-loss policy.
5. `docs/native/CORE-MIGRATION-LEDGER.md` records current authority, parity maturity, and migration state capability by capability.
6. This document constrains *how* new architecture may be introduced while those plans execute.

Where a subject is explicitly narrowed or strengthened by Revision 3, Revision 3 controls.

### 2.2 PWA strategy

Issue #478 is the PWA excellence umbrella. `docs/PWA-AUDIT.md` is to be upgraded in place into the living PWA architecture and acceptance document rather than spawning multiple competing PWA roadmaps.

PWA work may exploit browser-native capabilities where they improve the product, but browser APIs must not leak into Rust/Core or native `DesktopPlatform` contracts merely for implementation symmetry.

---

## 3. Capability boundaries before package/crate boundaries

A capability name in a roadmap does **not** authorize a new crate, package, service, manager, store, registry, queue, or state machine.

Names such as `worldscript-storage`, `worldscript-crypto`, `worldscript-ai`, `worldscript-tasks`, or similar roadmap concepts describe responsibilities. They are not mandatory repository topology.

Prefer extending an existing cohesive owner. Split only when at least one material benefit is demonstrated:

- clearer semantic ownership;
- security-boundary isolation;
- dependency isolation;
- deterministic/headless test isolation;
- renderer reuse that already exists or is immediately required;
- build/runtime isolation;
- removal of existing production duplication;
- a measurable performance or lifecycle benefit that cannot be obtained within the current boundary.

Do not split merely because a diagram looks cleaner or a future renderer exists.

---

## 4. Reuse-first architecture gate

Before adding a non-trivial new architectural component, record:

```text
EXISTING AUTHORITY / SEED AUDIT

Capability:
Current semantic owner:
Current runtime owner(s):
Existing reusable primitives:
Existing fixtures/tests:
Known gap:

Can the current owner be extended safely? YES / NO
Can a narrow adapter solve the gap? YES / NO

Would the proposed component duplicate:
  schema/validation?       YES / NO
  persistence?             YES / NO
  migration?               YES / NO
  encryption?              YES / NO
  locking/admission?       YES / NO
  retries/queueing?        YES / NO
  task supervision?        YES / NO
  capability detection?    YES / NO
  external-input routing?  YES / NO
  diagnostics/redaction?   YES / NO
  feature-gating truth?    YES / NO

If new architecture is still required:
Why no existing authority can own it:
Exact responsibility:
Explicit non-responsibilities:
Which existing duplication it replaces or avoids:
Migration/compatibility strategy:
Rollback/kill criterion:
```

A greenfield subsystem that cannot answer these questions should not be merged.

---

## 5. Preferred implementation order

Use this order unless security/data-integrity evidence requires a different one:

```text
1. FIX THE EXISTING OWNER
2. EXTEND THE EXISTING OWNER
3. ADD A NARROW ADAPTER
4. EXTRACT A SHARED PRIMITIVE FROM REAL DUPLICATION
5. REFACTOR AUTHORITY
6. ONLY THEN CREATE A NEW SUBSYSTEM
```

A new component is justified when the repository lacks the capability or the existing boundary cannot enforce the required invariant. A new component is not justified merely because the functionality is new to one renderer.

---

## 6. Product semantics vs platform implementation

Semantic/data-format/interoperability parity is required where product truth is shared. Implementation parity is not.

```text
                        PRODUCT SEMANTICS
             project / commands / validation / rules
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
          WEB / PWA APP                       NATIVE APP
          React / Vite                       Qt / QML target
              │                                   │
     browser capability/adapters              DesktopPlatform
              │                                   │
       IDB / SW / OPFS /                     Rust Core authority
       WebGPU / Web APIs                    where portability is proven
```

Examples:

- PWA Service Worker update mechanics and a future Qt updater are different implementations. They may share compatibility and data-integrity semantics, not necessarily one updater implementation.
- Browser File System Access handles are PWA adapter details. They do not belong in project/domain models.
- Browser WebGPU/WebLLM remains a PWA execution adapter even if portable AI request/result/error contracts move toward Core authority.
- Qt Quick graphics and lifecycle APIs remain renderer-specific and must not leak into shared/domain code.

---

## 7. Existing authorities and seeds that must be audited before new work

### 7.1 Feature/product maturity

`features/featureCatalog.ts` plus the feature-flag state owns product feature maturity/default/gating truth.

A PWA runtime-capability registry must not replace feature flags. Keep distinct:

```text
Product feature plane:
"Has WorldScript admitted/enabled feature X?"

Runtime capability plane:
"Can this browser expose primitive Y?"

Subsystem admission plane:
"Can this concrete workflow safely use Y?"
```

### 7.2 Persistence

Existing high-level authority includes:

- `services/storageService.ts`;
- `services/storageBackend.ts`;
- existing IndexedDB stores;
- filesystem adapter behavior while Tauri remains supported;
- `app/persistenceCoordinator.ts`;
- `app/persistedStateFlush.ts`.

Do not introduce a second live-project authority to add OPFS or user-selected file handles.

### 7.3 PWA encryption migration admission

`services/storage/protectedWriteAdmission.ts` already provides security-specific shared/exclusive Web Locks admission with a documented fallback.

A future generic multi-context layer may reuse/extract browser primitives but must not replace or weaken this security policy.

### 7.4 Local-AI multi-context coordination

`packages/ai-core/src/tabLeaderElection.ts` already uses BroadcastChannel plus a heartbeat for heavy-inference leadership.

A generic PWA coordination layer must audit this implementation first and either compose it, deliberately replace it with equivalent/proven semantics, or leave it specialized. Do not run two independent leadership authorities indefinitely.

### 7.5 Browser local AI

Existing architecture includes:

- `services/localAiFacade.ts`;
- AI-core;
- WorkerBus v2;
- `services/ai/adaptiveAiEngine.ts`;
- `services/ai/localAiDeviceProfiler.ts`;
- WebGPU detection;
- GPU resource management;
- inference progress/lifecycle facilities.

Browser-local AI work must harden/productize this stack. Do not introduce a parallel `PwaAiService` or second backend-selection layer.

### 7.6 OPFS

OPFS is already used by `workers/v2/duckdb.worker.ts` via `navigator.storage.getDirectory()` and a DuckDB file handle with fallback.

Treat this as the first production seed. Do not describe OPFS as wholly greenfield and do not create a whole-application OPFS project database merely because OPFS exists.

### 7.7 PWA install/update lifecycle

Existing authority begins in:

- `public/sw.js`;
- `register-sw.ts`;
- existing PWA install/update UI.

Future update safety work must refactor this path in place. A second independent update manager is forbidden unless the old path is explicitly retired.

### 7.8 External entry/import

Existing inputs include:

- PWA share-target/query handling;
- manifest launch/protocol/shortcut declarations;
- Tauri deep links;
- the existing project import thunk and validation flow.

These should converge on one typed, bounded, untrusted external-launch intent boundary rather than each feature implementing its own privileged parser.

### 7.9 Diagnostics

Existing logging, diagnostic-model, sink, and redaction facilities remain the seed. PWA capability diagnostics and Qt/native diagnostics may add adapters/snapshots, but must not create unredacted parallel logging authorities.

---

## 8. PWA architecture rules for #478 and #480–#489

### 8.1 #489 — capability/admission facade

`#489` is an aggregation and explanation layer, not a second set of low-level probes.

It should compose existing subsystem probes and expose normalized runtime facts. Workflow-specific admission remains in the owning subsystem.

Example:

```text
PWA capability: WebGPU = AVAILABLE
AI workflow admission: model X = DENIED
Reason: insufficient adapter/memory/workload policy
```

Both statements may be true simultaneously.

### 8.2 #480 — multi-context ownership

Do not create one global lock manager owning storage security, projects, AI, updates, and backups.

If common browser primitives are extracted, keep them narrow:

- context identity;
- lock request helper;
- typed bounded BroadcastChannel envelope;
- channel lifecycle;
- capability/fallback state.

Policy remains with subsystem owners:

```text
storage-security admission -> storage/security
project writer ownership    -> project/PWA coordination
local-AI ownership          -> AI subsystem
update activation           -> SW/update subsystem
```

BroadcastChannel is advisory coordination, never durable truth.

### 8.3 #481 — File System Access

Reuse existing project import/export parsing, validation, and commands.

Default authority:

```text
browser storage = live project authority
selected external file = explicit export/mirror/backup target
```

A future mode where an external file becomes authoritative requires a separate explicit conflict/authority decision. Retaining a file handle must not silently create dual authority.

### 8.4 #482 — storage hierarchy

Preserve IDB for authoritative structured PWA data unless evidence justifies a deliberate migration.

Use OPFS through data-class-specific repositories for measured large/binary/random-access workloads such as model artifacts, analytics databases, or regenerable indexes.

Do not make OPFS another whole-application `StorageBackend` competing with IndexedDB for ordinary project truth.

### 8.5 #483 — browser-local AI

The existing local-AI facade remains the single product abstraction.

A durable model-artifact manifest/catalog may be introduced if current architecture lacks version/integrity/stored-size/backend/compatibility lifecycle truth, but it must live beneath the existing local-AI abstraction.

No hidden local-to-cloud fallback is permitted.

### 8.6 #484 — Capture Inbox and external launch

A bounded durable Capture Inbox is a legitimate new domain capability because it does not currently exist.

After a captured item is assigned, reuse existing project entities/surfaces. Do not create permanent parallel `CaptureNote`, `CaptureScene`, `CaptureCharacter`, etc. models.

Share target, protocol handler, shortcuts, launch queue, file handling, and Tauri deep links should normalize to one typed `ExternalLaunchIntent` before privileged navigation or mutation.

### 8.7 #485 — Service Worker update safety

Current SW registration/activation remains the implementation seed.

Refactor to one authoritative update state machine. Do not leave unconditional `skipWaiting()` plus unconditional `controllerchange` reload as the final dirty-session policy.

Use existing persistence coordination, flush, migration-journal, and multi-client evidence. A save required for update admission must be confirmed durable according to the current persistence contract; never fake a successful flush to activate new code.

### 8.8 #486 — installed PWA shell

Evolve the existing manifest and `window.worldScriptPWA`/registration state. Do not create a second independent install/update state unless the old state is deliberately migrated and retired.

Display mode may alter shell/presentation behavior but not business/domain semantics.

### 8.9 #487 — mobile

Mobile work is presentation, interaction, viewport, performance, and capability adaptation over the same project/domain model.

Do not create a divergent mobile project or editor-domain model merely because layout and input differ.

### 8.10 #488 — deferred work

Authoritative manuscript autosave, encryption commit, key rotation, only-copy backup, or schema-migration finalization must not depend on browser Background Sync.

Use a small bounded/versioned scheduling journal only for safe idempotent deferred work. Reuse existing WorkerBus/application handlers as executors where appropriate; do not create a second general task framework.

---

## 9. Native/Rust/Qt rules

### 9.1 Core Migration Ledger is the anti-rewrite control

Authority moves only when parity is proven. A Rust implementation existing in the repository does not imply it is authoritative.

For project/schema work, converge in this order:

1. canonical persisted schema version;
2. explicit unknown-field policy;
3. import-vs-repair validation semantics;
4. golden accept/reject fixtures;
5. migration fixture parity;
6. real serialized/package-format parity;
7. explicit authority switch.

Qt must consume the resulting authority, not create another schema.

### 9.2 R-15/#445 is canonical native secure-storage integration

Keep #445 as the integration/closure issue for native renderer-neutral encryption, durability, recovery, migration admission, and record identity.

`#357`/`#359`/`#360`/`#361` remain detailed requirements and provenance. Do not create Qt-private or new Tauri-private crypto/storage authority.

### 9.3 Tasks

Do not replace the mature TypeScript WorkerBus with a broad Rust task framework in one migration.

Move task classes when renderer-neutral execution, cancellation/progress semantics, headless ownership, or native-service integration produces proven value.

### 9.4 AI

Portable AI request/result/error/cancellation/provider-policy contracts may migrate toward Core authority when justified. Browser WebGPU/WebLLM implementation remains a PWA adapter. Native local-AI backends may use different adapters.

Do not port browser execution machinery to Rust merely for symmetry.

### 9.5 Updates

Share portable concepts such as version compatibility, migration admission, data-integrity rules, rollback expectations, and evidence maturity.

Do not hide fundamentally different Service Worker, native updater, package-signing, and platform trust mechanisms behind a premature one-size-fits-all implementation.

---

## 10. Cross-renderer evidence architecture

Share semantic scenario definitions and evidence schema, not necessarily one mega-driver.

Preferred shape:

```text
Scenario specification / fixture / metrics / thresholds
                    │
        ┌───────────┼───────────┐
        │           │           │
     PWA driver  Tauri driver  Qt driver
```

This preserves comparable evidence without forcing artificial automation parity.

`GOLDEN-DESKTOP-LIFECYCLE-332` remains the canonical lifecycle/performance scenario family for the #332 lineage.

Every driver must preserve the same semantic workload and report compatible evidence fields while remaining free to use renderer-native instrumentation.

---

## 11. Issue-specific reconciliation rules

### #332

Keep #332 as the canonical cross-renderer lifecycle/performance evidence source. Do not create another broad Linux/WebKit/Qt performance umbrella unless a distinct proven root cause warrants a narrowly owned bug.

### #341

Preserve the original user report and historical evidence. Add/maintain a shared readability oracle for contrast, font metrics, caret/scroll/overlay alignment, theme transitions, scaling, and relevant RTL/IME behavior. PWA and packaged/native evidence consume the same semantic oracle.

### #347

Scenario/workspace features must project the canonical project model. Do not create a parallel screenplay project persistence format.

### #348

Marketplace work extends the existing plugin registry/execution model with provenance, admission, compatibility, permission, revocation, quarantine, and UX. Do not create a second marketplace-only plugin runtime.

### #349

Invite links extend the existing collaboration transport/session semantics. They are admission/scope/expiry/replay UX, not a second collaboration engine. Do not claim server-like revocation semantics if the architecture cannot provide them.

### #446/#447/#449/#450

These remain dedicated quality/build authorities for coverage, suppression debt, locale bundle policy, and bundle budgets. PWA/native programs consume their evidence; they do not duplicate their tooling.

---

## 12. Architecture PR checklist

Every non-trivial architecture/migration PR should answer:

```text
[ ] Existing semantic owner identified
[ ] Existing reusable primitives listed
[ ] No duplicate persistent authority
[ ] No duplicate schema/validation
[ ] No duplicate crypto/migration state machine
[ ] No duplicate queue/task scheduler without explicit justification
[ ] No duplicate runtime capability probe
[ ] No duplicate external-input parser
[ ] No renderer-specific product truth
[ ] Browser APIs stay out of Rust/native domain contracts
[ ] Qt APIs stay out of shared/domain code
[ ] Tauri-only investment passes TM policy
[ ] PWA specialization has explicit fallback/degradation semantics
[ ] State migration/versioning impact is explicit
[ ] Negative/failure tests are defined
[ ] Diagnostics remain privacy-safe
[ ] Existing behavior has compatibility/regression evidence
[ ] Any replaced duplicate has a removal/deprecation plan
[ ] Authority switch is explicit and evidence-backed
```

---

## 13. Refactor justification

A substantial refactor is justified when at least one is true:

- semantic authority is currently split and produces contradictory behavior;
- a security/data-integrity boundary cannot be enforced otherwise;
- renderer migration is blocked by concrete coupling;
- deterministic testing is impossible under current ownership;
- duplicate production implementations already exist;
- measured performance/lifecycle evidence shows the current boundary is structurally inadequate.

A refactor is not justified merely because:

- a future renderer exists;
- a browser/native API is fashionable;
- a new crate/service would make a diagram symmetrical;
- code could theoretically be shared;
- one platform supports a richer capability than another.

---

## 14. Dependency and sequencing rule

Do not use architecture cleanup as an excuse to bypass the active evidence/security/Core program.

Recommended dependency direction:

```text
Rev-3 / #332 classification
        │
        ├── preserve active H1 evidence isolation
        ├── Core authority convergence
        ├── R-15 canonical native security
        └── bounded Qt qualification

#478 PWA excellence
        │
        ├── #489 capability facade
        ├── #480 multi-context correctness
        ├── #482 storage health/tiering
        ├── #485 update correctness
        ├── #484 external intent/capture
        │      ├── #481 files
        │      └── #486 installed shell
        ├── #483 local-AI perfection
        ├── #488 deferred work
        └── #487 mobile presentation
```

The graph is not a strict waterfall. Child work may proceed in parallel when its dependencies are satisfied and ownership is clear.

---

## 15. Final rule

```text
Keep every proven primitive that still has the right responsibility.
Strengthen it.
Compose it.
Extract only the truly shared part after real duplication is visible.
Retire duplicates when consolidation happens.
Create new architecture only where a real capability has no correct existing home.
```

The goal is not the fewest files or the most abstractions. The goal is **one coherent product with explicit authority and evidence-backed boundaries**.