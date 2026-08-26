# WorldScript Studio — Living PWA Architecture & Acceptance Audit

**Status:** ACTIVE living PWA architecture/acceptance specification  
**Updated:** 2026-08-24  
**Umbrella issue:** #478 — first-class PWA excellence/hardening  
**Cross-cutting architecture governance:** [`architecture/ARCHITECTURE-REUSE-OWNERSHIP.md`](architecture/ARCHITECTURE-REUSE-OWNERSHIP.md)  
**Native relationship:** [`native/DESKTOP-MIGRATION-ROADMAP-REV3.md`](native/DESKTOP-MIGRATION-ROADMAP-REV3.md)

---

## 1. Product contract

WorldScript PWA is a **first-class product surface**, not a compatibility fallback for Tauri and not a temporary shell waiting for Qt.

The product strategy is:

```text
Shared product/domain semantics
        │
        ├── PWA: browser-native excellence
        │     IDB / Service Worker / Web APIs / WebGPU / OPFS where admitted
        │
        └── Native: DesktopPlatform + renderer-neutral Rust Core + Qt target
```

PWA and native renderers share semantic/data-format/interoperability contracts where the product truth is common. They do **not** require identical implementation mechanics.

Browser APIs must not leak into Rust/Core or `DesktopPlatform` merely to make PWA and Qt look symmetrical.

---

## 2. Reuse-first implementation invariant

This program is **refinement-first, not greenfield**.

Before adding a new PWA service, store, manager, queue, registry, state machine, worker framework, capability detector, or persistence layer, apply `ARCHITECTURE-REUSE-OWNERSHIP.md`.

Preferred order:

```text
1. FIX THE EXISTING OWNER
2. EXTEND THE EXISTING OWNER
3. ADD A NARROW PWA ADAPTER
4. EXTRACT A SHARED PRIMITIVE FROM REAL DUPLICATION
5. REFACTOR AUTHORITY
6. ONLY THEN CREATE A NEW SUBSYSTEM
```

At minimum inspect these existing seeds before designing replacements:

- `services/storageService.ts` / `services/storageBackend.ts` / existing IndexedDB stores;
- `app/persistenceCoordinator.ts` / `app/persistedStateFlush.ts`;
- encryption migration/journal/admission, including `services/storage/protectedWriteAdmission.ts`;
- `public/sw.js` / `register-sw.ts` / existing install-update UI;
- `services/localAiFacade.ts` / AI-core / WorkerBus v2 / adaptive AI / device profiling;
- current DuckDB OPFS integration in `workers/v2/duckdb.worker.ts`;
- `features/featureCatalog.ts` and feature flags for product feature truth;
- existing diagnostics/redaction facilities;
- existing project import/export and Tauri deep-link flow.

No new PWA enhancement may silently create a second project, schema, crypto, migration, AI, task, update, feature-gating, or diagnostics authority.

---

## 3. PWA workstream / issue graph

#478 is the umbrella. Child work should remain traceable to the following dependency model:

```text
#478 PWA excellence
│
├─ foundation
│  └─ #489 capability/admission facade
│
├─ correctness/lifecycle
│  ├─ #480 multi-context ownership
│  ├─ #482 storage health/tiering
│  └─ #485 update lifecycle
│
├─ external I/O / installed app
│  ├─ #484 ExternalLaunchIntent + Capture Inbox
│  ├─ #481 File System Access / file handling
│  └─ #486 installed shell
│
├─ local AI
│  └─ #483 existing local-AI stack perfection
│      ├ uses #489 capability facts
│      ├ coordinates #480
│      └ artifact/storage policy from #482
│
├─ deferred work
│  └─ #488
│      ├ uses #489 capability facts
│      ├ ownership via #480
│      ├ update compatibility via #485
│      └ reuses existing WorkerBus/application executors
│
└─ mobile
   └─ #487
      ├ same canonical project/domain model
      ├ capture enhancement via #484
      ├ storage truth via #482
      └ AI enhancement via #483
```

This is a dependency graph, not a mandatory waterfall. Work may proceed in parallel when its prerequisites and ownership are explicit.

---

## 4. Capability truth model (#489)

Keep four planes separate:

```text
1. Product feature plane
   featureCatalog / feature flags
   "Has WorldScript admitted/enabled feature X?"

2. Runtime capability plane
   PWA capability facade
   "Can this runtime expose primitive Y?"

3. Subsystem admission plane
   AI / storage / update / files / mobile
   "Can this concrete workflow safely use Y?"

4. Diagnostics/support plane
   privacy-safe composed explanation
```

A capability facade should compose existing probes instead of duplicating them.

Example:

```text
WebGPU runtime capability = AVAILABLE
Model X AI admission      = DENIED
Reason                    = device/workload limit
```

Both statements may be correct.

Support/runtime states may include:

```text
UNAVAILABLE
AVAILABLE
AVAILABLE_WITH_LIMITATIONS
PERMISSION_REQUIRED
PERMISSION_GRANTED
PERMISSION_DENIED
BROKEN_OR_FAILED_PROBE
DISABLED_BY_POLICY
```

Use feature/probe results first; browser/version detection is diagnostic context or a narrowly documented compatibility exception, not the normal architecture gate.

---

## 5. Manifest / installed-app contract

Current manifest capabilities must correspond to real, tested product behavior rather than decorative metadata.

Audit at least:

- `display: standalone` and `display_override` including `window-controls-overlay` where present;
- 192/512 icons and maskable safe zones;
- shortcuts;
- `share_target`;
- `launch_handler`;
- `handle_links`;
- `protocol_handlers`;
- any Edge side-panel declaration;
- future admitted `file_handlers`.

Installed mode is progressive enhancement:

```text
normal browser tab       = complete baseline product
installed PWA            = enhanced shell
supported Chromium       = additional window/OS integration
mobile installed PWA     = touch/mobile shell
```

Installation is never required for project safety or core writing.

---

## 6. Offline-first correctness

Core writing must have an explicit offline contract.

Required tests/evidence:

- cold offline launch;
- warm offline launch;
- mid-session disconnect;
- flaky/captive/failed network;
- open local project;
- edit/autosave;
- close/relaunch;
- export/backup where local APIs permit;
- browser process eviction/restart;
- network-dependent feature failure without core writing failure.

Acknowledged edits must not be lost merely because connectivity changes.

AI/provider endpoints whose caching would be unsafe or misleading remain network-only.

Offline UX must distinguish:

- local writing available;
- cloud/provider unavailable;
- local model unavailable/not downloaded;
- update waiting;
- storage problem;
- application-shell failure.

Do not collapse all failures into a generic “offline” message.

---

## 7. Persistence and storage authority (#482)

### 7.1 Structured live project state

Existing IndexedDB/browser storage remains the live authoritative PWA project path unless a separate evidence-backed authority decision changes that.

`storageService` / `StorageBackend` remain the high-level seed.

Do not create a second whole-application OPFS project database merely because OPFS is available.

### 7.2 OPFS

OPFS is already present in the DuckDB worker via `navigator.storage.getDirectory()` and a DuckDB file handle with fallback.

Treat that as the production seed.

Preferred use is **per data class**, e.g. where measured benefit exists for:

- analytics/WASM database files;
- local-AI model artifacts;
- large RAG/index artifacts;
- selected large binary/regenerable data.

Each admitted class needs:

- authority classification;
- performance/storage rationale;
- fallback;
- staging/commit/recovery model;
- cleanup/orphan policy;
- encryption classification.

### 7.3 Cache Storage

Use Cache Storage for explicit safe network-derived/refetchable resources, not as a generic project database.

### 7.4 User-controlled export / File System Access

File System Access (#481) is an optional adapter over existing import/export semantics.

Default:

```text
browser storage = live project authority
selected file   = explicit mirror/export/backup target
```

Retaining a file handle must not silently create a second writer authority.

### 7.5 Persistence/quota UX

Where supported, expose truthful `navigator.storage.persisted()` / `persist()` / `estimate()` state.

The storage-health UI should distinguish:

- authoritative projects/structured data;
- images/assets;
- snapshots/backups;
- RAG/indexes;
- local-AI models;
- regenerable caches;
- Service Worker assets;
- quota/persistence state.

Factory reset/clear-site-data is a destructive last resort, not normal first-line recovery.

---

## 8. Encryption and migration truth

Browser origin privacy is not equivalent to WorldScript product encryption.

Keep distinct:

- credential/API-key storage;
- opt-in project-data encryption;
- collaboration crypto;
- origin-private storage;
- native R-15 protection.

Existing IDB encryption journal/admission remains authoritative for current PWA protected-data semantics.

`services/storage/protectedWriteAdmission.ts` already uses security-specific shared/exclusive Web Locks. Generic #480 coordination may compose/extract browser primitives but must not replace/weaken security migration policy.

Any IDB→OPFS protected-data movement must preserve the admitted encryption/migration/identity semantics and avoid plaintext staging downgrades.

---

## 9. Multi-context correctness (#480)

The PWA may have browser tabs, installed windows, workers and a Service Worker active concurrently.

The goal is safe ownership, not accidental last-writer-wins.

Existing coordination seeds include:

- Web Locks protected-write admission;
- BroadcastChannel/localStorage heartbeat local-AI leadership.

Generic extraction, if justified, should be limited to primitives such as:

- context identity;
- lock request helper;
- typed/versioned bounded channel envelope;
- channel lifecycle;
- capability/fallback reporting.

Subsystem policy remains with subsystem owners.

For project writer ownership, safely handle:

- same project opened twice;
- different projects in different windows;
- read-only secondary context;
- explicit takeover;
- active writer crash/reload;
- background/frozen context;
- migration during editing;
- installed PWA + normal tab.

BroadcastChannel is advisory coordination, never durable truth.

Unsupported Web Locks capability must not silently restore unsafe concurrent writing.

---

## 10. Service Worker and update safety (#485)

Existing authority begins in:

- `public/sw.js`;
- `register-sw.ts`;
- current PWA update/install UI.

Update hardening must refactor this path **in place** or explicitly retire replaced paths. Do not build a second update manager next to the current one.

The current unconditional install-time `skipWaiting()` / controller-change reload behavior is not sufficient as the final dirty-session/multi-client protocol.

Target update state model:

```text
NO_UPDATE
→ UPDATE_DISCOVERED
→ DOWNLOADED_WAITING
→ CLIENTS_ASSESSED
→ SAFE_TO_ACTIVATE | USER_ACTION_REQUIRED
→ ACTIVATING
→ RELOADING/RECONNECTING
→ VERIFIED
→ RECOVERY_REQUIRED
```

Before activation consider:

- dirty/acknowledged edit state;
- confirmed persistence/flush state;
- live clients;
- active migration/recovery;
- backup/export critical section;
- local-AI/model artifact transition where interruption matters;
- app-code/storage-schema compatibility.

A `Save & update` action must wait for the real durable persistence contract, not an optimistic or queued save request.

Large model artifacts should have a lifecycle independent of app-shell cache churn unless compatibility requires invalidation.

Required N→N+1 tests include clean/dirty/multiple clients, offline transition, asset failure and representative schema migration.

---

## 11. Local AI (#483)

The existing local-AI architecture remains the single product abstraction:

- `services/localAiFacade.ts`;
- AI-core;
- WorkerBus v2;
- adaptive AI;
- local device profiling/WebGPU detection;
- GPU resource management;
- existing progress/cancellation/lifecycle facilities.

Do not create a parallel PWA AI facade/backend selector/worker queue.

Expose execution truth clearly:

```text
Browser local — WebGPU
Browser local — WASM/CPU
Local server — Ollama / compatible endpoint
Cloud provider
Unavailable / fallback
```

Never label a path local if manuscript context leaves the device.

Model/workload admission must be more specific than `navigator.gpu` existence.

A durable model-artifact manifest/catalog is justified only if existing architecture lacks lifecycle truth for:

- model/version/quantization identity;
- size/hash/integrity;
- stored generation/location;
- backend/runtime compatibility;
- download/ready/active/removable state;
- provenance/license metadata.

If introduced, it lives beneath the existing local-AI facade and coordinates storage with #482.

No hidden local→cloud escalation is permitted.

---

## 12. External launch / capture / files (#484/#481/#486)

Unify external entry mechanisms under one bounded typed boundary:

```text
PWA share target
protocol handler
shortcut
launch handler / launchQueue
file handler
Tauri/native deep-link adapter
        │
        ▼
ExternalLaunchIntent
        │
        ▼
allowlisted router / required confirmation
        │
        ▼
existing commands/import/domain actions
```

External payloads are untrusted and may never directly trigger:

- provider calls;
- plugin installation;
- secret/token changes;
- destructive project replacement;
- arbitrary filesystem/network access;
- arbitrary URL execution.

### Capture Inbox

A bounded durable Capture Inbox is a legitimate new product capability because persistent capture does not currently exist.

Once assigned, captured content should reuse canonical existing project entities/surfaces. Do not maintain parallel `CaptureNote`, `CaptureScene`, `CaptureCharacter`, etc. models after assignment.

Durable acknowledgement must precede “Captured” success UI.

Current GET share-target compatibility may remain initially, but evaluate an admitted POST/multipart path for private content when browser support and bounded threat/size handling are proven.

---

## 13. Installed shell (#486)

Evolve current manifest + `register-sw.ts` + `window.worldScriptPWA`/events rather than creating an unrelated second install/update state.

If a typed service/store replaces the global/event path, migrate and retire the duplicate deliberately.

Installed-mode enhancements may include:

- contextual install UX;
- Window Controls Overlay;
- shortcuts;
- link/protocol/file/share handling;
- meaningful local badging;
- explicit opt-in notifications for justified long tasks;
- compact/side-panel companion workflow where genuinely useful.

Display mode affects shell/presentation behavior, not project/business/persistence/AI semantics.

---

## 14. Mobile (#487)

Mobile uses the same canonical project/domain/command/persistence model.

Mobile-specific concerns include:

- responsive shell/drawers/sheets;
- touch targets;
- `VisualViewport` / Virtual Keyboard behavior;
- safe areas/orientation;
- wake-lock lifecycle;
- mobile performance/admission policy;
- compact action/status presentation.

Do not create a separate mobile project model or editor domain merely because presentation differs.

Test the existing editor's caret/selection/IME/touch/viewport correctness before proposing a replacement editor architecture.

Heavy AI/analytics/graph/model initialization remains lazy and capability-admitted; editor-ready time and autosave responsiveness take priority.

---

## 15. Deferred/background work (#488)

Browser background APIs are opportunistic, not a native daemon.

Authoritative manuscript autosave, encryption commit, key rotation, only-copy backup, destructive cleanup, and schema-migration finalization must not depend on Background Sync.

The current `worldscript-autosave` Background Sync naming/contract must be reconciled so future code/docs cannot mistake SW scheduling for durability authority.

A new component may be introduced only as a small bounded/versioned scheduling journal owning:

- task identity/kind;
- idempotency key;
- eligibility/backoff;
- attempt/cancellation/failure state;
- bounded non-sensitive payload/reference metadata;
- queue-schema version.

Execution should reuse existing WorkerBus/application services where suitable. Do not create a second general PWA task framework.

---

## 16. Performance and responsiveness

PWA is a measured reference renderer, not merely “faster than Tauri.”

Measure representative hardware/classes for:

- cold/warm startup;
- editor-ready/time-to-interactive;
- input latency p50/p95;
- scroll/frame consistency;
- Settings/Writer Studio navigation;
- project open/save/autosave;
- large-project behavior;
- background/resume;
- 30-minute and long-session memory/resource trend;
- WebGPU/model initialization;
- bundle/chunk transfer + parse/execute cost.

Coordinate bundle limits with #450 rather than creating competing PWA-only bundle-budget tooling.

Lazy-load genuinely cold work, but never hide correctness work or move expensive initialization onto the first critical user interaction merely to improve a synthetic startup number.

PWA memory/resource growth must be bounded for admitted regression acceptance. An explanation of unbounded growth is diagnostic classification, not a pass.

---

## 17. Accessibility and readability

Coordinate with #341 and use a shared semantic oracle rather than renderer-specific definitions of “readable.”

Validate:

- contrast under themes/accessibility presets;
- editable/mirror/overlay font and geometry parity;
- caret/selection/scroll alignment;
- theme transitions;
- zoom/text scaling;
- reduced motion/transparency;
- keyboard-only workflows;
- focus restoration;
- screen-reader announcements for save/offline/update/model states;
- RTL/BiDi/IME where applicable;
- mobile keyboard/viewport behavior.

PWA evidence does not automatically close packaged Tauri/Qt rendering regressions; the semantic oracle is shared while renderer evidence is classified separately.

---

## 18. Cross-browser support policy

Maintain evidence-backed tiers:

```text
SUPPORTED
SUPPORTED_WITH_LIMITATIONS
BEST_EFFORT
UNSUPPORTED
```

At minimum classify current:

- Chrome/Chromium desktop;
- Edge desktop;
- Firefox desktop;
- Safari macOS;
- Android Chromium;
- iOS/iPadOS Safari browser/installed mode.

Document relevant differences in:

- installability;
- Service Worker/update behavior;
- Web Locks/BroadcastChannel;
- OPFS/StorageManager;
- File System Access/file handling;
- WebGPU/local AI;
- background APIs;
- mobile keyboard/viewport APIs.

Do not block high-value Chromium-native enhancement merely to simulate feature parity. Baseline writing must degrade explicitly and safely.

---

## 19. Security/privacy

Audit:

- CSP and worker boundaries;
- cross-origin isolation requirements if introduced;
- provider routing, especially Claude web proxy truth;
- local-vs-cloud AI truth;
- cache poisoning/stale-code/version skew;
- external launch/share/protocol/file inputs;
- imports/archives;
- storage/encryption semantics;
- diagnostics/redaction;
- telemetry policy.

No performance/capability/support diagnostic may contain manuscript text, prompts/results, API keys/tokens, encryption material, private local paths or raw provider payloads.

Coordinate translated security wording with #382 rather than introducing PWA-specific contradictory claims.

---

## 20. CI / release evidence

PWA acceptance should grow beyond “production build succeeds.”

Evidence categories include:

- manifest/installability validation;
- Service Worker policy tests;
- offline smoke/E2E;
- transactional update lifecycle tests;
- IndexedDB migration/recovery fixtures;
- PWA accessibility smoke;
- capability-registry normalization/fallback tests;
- browser matrix at evidence-appropriate cadence;
- Pages/Vercel routing/base-path/SW-scope parity;
- deterministic performance/bundle ratchets where runner variance permits them.

Do not duplicate dedicated quality authorities:

- #446 remains executable coverage-scope authority;
- #447 remains suppression-debt/ratchet authority;
- #449 remains generated locale-bundle policy authority;
- #450 remains bundle-budget authority.

PWA owns the PWA acceptance contract consuming those controls.

---

## 21. Cross-renderer relationship to #332 / Qt

PWA is both:

1. an independently valuable product;
2. a useful reference renderer for portable-vs-runtime differential evidence.

`GOLDEN-DESKTOP-LIFECYCLE-332` should share semantic scenario definitions/fixtures/metrics/evidence schema across PWA, Tauri and Qt, while each renderer uses its own appropriate driver/instrumentation.

PWA success does not equal packaged native closure. Qt success does not retire/freeze PWA.

Portable fixes move into shared/domain/Core layers only when they are actually portable. Browser-specific excellence remains behind PWA/browser boundaries.

---

## 22. User-driven evidence

When field observations are useful, prefer small privacy-safe records:

- browser/version and OS;
- normal tab vs installed PWA;
- online/offline state;
- approximate project size;
- local AI/Ollama/cloud AI active or not;
- exact workflow and visible symptom;
- redacted screenshot where safe.

Never ask users to post manuscript content, API keys/tokens, encryption material, private paths, full storage dumps or sensitive provider payloads.

---

## 23. Current acceptance checklist

### Architecture / ownership

- [ ] Every major PWA capability has one named semantic owner.
- [ ] Existing seeds were inventoried before new architecture was introduced.
- [ ] No silent duplicate project/storage/schema/crypto/migration/AI/task/update/feature-gating authority exists.
- [ ] Any replaced path has an explicit migration/deprecation/removal plan.
- [ ] Browser APIs remain outside native Core/DesktopPlatform contracts unless the shared contract is genuinely platform-neutral.

### Offline / persistence

- [ ] Cold/warm offline writing path is deterministic.
- [ ] Acknowledged edits survive offline/relaunch/process eviction.
- [ ] IDB migration/recovery/storage-pressure tests exist.
- [ ] OPFS use is data-class-specific and evidence-driven.
- [ ] Persistence/quota UX is truthful.
- [ ] Export/backup exists before destructive recovery actions.

### Concurrency / update

- [ ] Same project cannot silently have two independent PWA writers.
- [ ] Security migration admission remains fail-closed.
- [ ] Dirty clients block unsafe update activation/reload.
- [ ] N→N+1 update lifecycle has multi-client/offline/schema-transition evidence.
- [ ] Service Worker is not project-data or migration authority.

### Local AI

- [ ] Existing local-AI facade remains the single product abstraction.
- [ ] Runtime capability and model/workload admission are distinct.
- [ ] Heavy inference is off the UI thread.
- [ ] Cancellation/device-loss/OOM recovery preserves editor/autosave state.
- [ ] Model artifact lifecycle/integrity/storage is explicit.
- [ ] No hidden local→cloud fallback exists.

### Installed / external / mobile

- [ ] Manifest declarations correspond to admitted tested behavior or are explicitly deferred/removed.
- [ ] External inputs normalize through one typed validation boundary.
- [ ] Capture Inbox acknowledgement is durable.
- [ ] File System Access cannot silently create dual project authority.
- [ ] Mobile uses the canonical project/domain model.
- [ ] Virtual keyboard/safe-area/touch/accessibility evidence exists.

### Security / quality / deployment

- [ ] Browser support matrix is explicit and evidence-backed.
- [ ] PWA diagnostics are privacy-safe.
- [ ] Security wording aligns with #382/current provider/storage truth.
- [ ] Coverage/suppression/locale/bundle controls reconcile #446/#447/#449/#450 rather than duplicate them.
- [ ] Pages/Vercel PWA routing and Service Worker scope are smoke-tested.
- [ ] Performance/resource regression budgets are measured rather than arbitrary.

---

## 24. Local verification

On constrained development machines, use the repository's bounded pre-push gate as the local baseline:

```bash
pnpm run ci:prepush
```

Do **not** run Lighthouse, E2E/deep-E2E, VRT, Storybook browser suites, or broad browser-matrix jobs locally on constrained machines merely to satisfy this document. Those heavyweight checks are cloud-CI evidence and must remain there unless the repository's explicit machine policy later changes. Targeted lightweight unit/typecheck/policy commands may be run locally when they are directly relevant and remain within the documented resource envelope.

Documentation-only evidence must not be presented as runtime acceptance. Lighthouse/E2E/browser-matrix acceptance is established from the corresponding CI runs and artifacts, not by overloading low-end developer hardware.

See also:

- [`docs/CI.md`](CI.md)
- [`infra/low-end-ci/DAILY-DRIVER.md`](../infra/low-end-ci/DAILY-DRIVER.md)
- [`architecture/ARCHITECTURE-REUSE-OWNERSHIP.md`](architecture/ARCHITECTURE-REUSE-OWNERSHIP.md)
- [`native/DESKTOP-MIGRATION-ROADMAP-REV3.md`](native/DESKTOP-MIGRATION-ROADMAP-REV3.md)

---

## 25. Non-goals

- forcing PWA to emulate every native OS integration;
- forcing Qt to embed a web renderer to preserve PWA implementation details;
- creating a second live project store because OPFS/File System Access exists;
- creating a second local-AI/task/update stack for PWA;
- treating browser origin privacy as product encryption;
- sacrificing offline safety/security for Lighthouse scores;
- requiring installation for core writing;
- making basic writing Chromium-only because enhanced local AI is Chromium-first;
- treating PWA as disposable after Qt succeeds.