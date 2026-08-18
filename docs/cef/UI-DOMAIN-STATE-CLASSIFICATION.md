# UI / Domain / Durable-Preference State Classification (Wave 1 baseline)

Wave 1 deliverable per `docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md` §3126 ("initial UI-state/domain-state classification") and §7.4.1's three-state model. This is a **classification exercise, not a refactor** — no slice code changes in Wave 1. It documents where the app's actual truth lives today so later waves (5 "persistence core," 7 "crypto," 9 "task runtime") know what to extract into the renderer-neutral core, and what can safely stay React-local forever.

## The three states (roadmap §7.4.1)

- **Domain/business state** — renderer-neutral, ideally core-owned. Project entities, manuscript structure, persisted history.
- **Presentation/UI state** — renderer-specific, allowed to stay in React. Open panel, modal visibility, hover, current tab, transient form focus.
- **Durable user preference state** — renderer-neutral *semantics* even if each frontend renders the setting differently. Locale, AI provider selection, editor preferences.

> Do not put domain truth into transient React component state (§7.4.1).

## Redux slices

| Slice | Classification | Notes |
|---|---|---|
| `project` (redux-undo wrapped) | **Domain** | Manuscript, characters, worlds, codex, binder, plot connections/subplots/tensionOverrides. The app's actual product data. Renderer-neutral *in principle* — today it lives only in Redux, not core-owned (DEBT, see scorecard). |
| `settings` | **Durable preference** | Theme, editor font/spacing, AI creativity, `advancedAi`, accessibility, collaboration, feature flags mirror, keyboard shortcuts, theme customization, desktop prefs, privacy. Already persisted via `storageService` with renderer-neutral semantics; only the *rendering* of each setting is React-specific. |
| `status` | **Presentation/UI**, with one caveat | `notifications: Notification[]` (toasts) is pure UI. `saving: SavingStatus` is a UI *projection* of domain persistence status, not domain truth itself — the real save state lives in `storageService`/`fsCore`'s write path. |
| `writer` | **Presentation/UI** (ephemeral editing session) | Active tool, cursor selection, AI Copilot input fields (scenario/tone/style), loading flags, generation history/stream buffer, RAG chunk preview. None of this is the manuscript itself — the manuscript text is `project`'s domain state. |
| `versionControl` | **Mixed** | `branches`/`snapshots`/`currentBranchId` are Domain state (real persisted version history users rely on). `isPanelOpen` is Presentation/UI. |
| `featureFlags` | **Durable preference** | Each flag is a boolean setting; already persisted, already renderer-neutral in semantics. |
| `proForge` | **Presentation/UI** (slice) + **Domain** (history store) | The Redux slice itself is ephemeral live-pipeline-progress state, not persisted, not undo-wrapped (existing convention). Completed/aborted runs *are* persisted separately to IDB (`proForgeHistoryStore`) — that store, not the slice, is the domain-relevant record. |
| `plotBoard` | **Presentation/UI** | Viewport/interaction state only (zoom/pan/mode/draw/snap). Existing convention: persists to `localStorage`, not undo-able. The actual plot data (connections, subplots, tension overrides) is domain state already correctly placed in `project`. |
| `sceneComments` | **Domain** | User-authored review comments — real content, not transient. |
| `progressTracker` | **Domain** | Session history, streak, daily/weekly goals — meaningful persisted user data. |
| `analytics` | **Domain** (derived) | DuckDB-backed computed statistics; derived from domain data but itself a real, queryable record. |
| `mindMap` | **Presentation/UI** | Viewport only (existing convention: "NOT undo-able"), same shape as `plotBoard`. |
| `lora` | **Mixed, primarily Domain** | Trained-adapter registry/metadata is Domain state (real persisted training artifacts). Wizard step/progress is Presentation/UI. |
| `voice` | **Presentation/UI** (ephemeral runtime) | Listening state, transcript buffer, wake-word status — not durable data; never logged per privacy policy. |
| `copilot` | **Presentation/UI** | Existing convention: ephemeral chat state, not persisted, not undo-wrapped. Any durable insight it produces belongs to the feature that consumes it (e.g. applied edits land in `project`), not to this slice. |

## Non-Redux state

| Store | Classification | Notes |
|---|---|---|
| `app/transientUiStore.ts` (Zustand) | **Presentation/UI** | `isCommandPaletteOpen`, `isCrossProjectSearchOpen`, `flowMode` — explicitly named transient; correctly kept out of Redux/undo. |

## What this means for later waves

No action required in Wave 1. This table is the input for:
- **Wave 5** (persistence core vertical slice) — `project`'s domain state is the first candidate for a renderer-neutral, core-owned representation (open → edit → native save → quit → relaunch → restore).
- **Wave 7** (crypto/credentials) — encrypting domain state at rest on desktop (the #356 gap) operates on exactly the "Domain" rows above, not the Presentation/UI ones.
- **Wave 9** (task runtime) — `proForge`'s live-progress projection is a template for how a future core-owned task's progress should be surfaced into React without becoming the source of truth itself.

Re-classify any slice whose shape changes materially before relying on this table for a later wave's scope decisions — it is a snapshot, not a live-checked contract (see `docs/cef/OWNERSHIP.yaml`, `driftCheckTool: planned`).
