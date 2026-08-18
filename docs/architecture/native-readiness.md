# Native-Readiness Scorecard

First instance of the recurring check defined in `docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md` §7.4.5 (checked at architecture-changing PRs and major CEF wave exits) and §7.4.7 (part of the CEF-Stable admission gate). Wave 1 deliverable: "produce the first Native-Readiness/UI-vs-domain-state scorecard" (§3126).

**A `DEBT` result is allowed during migration but must have an owner** (§7.4.5). This scorecard is scored honestly against the codebase as it stands at each snapshot below — it is not aspirational.

## Snapshot: Wave 1 PR A (`packages/desktop-contracts` contracts only, before migration)

Owner roles below use `docs/cef/OWNERSHIP.yaml`'s existing taxonomy (`desktop-architecture`, `cef-runtime`, `rust-core`, `desktop-security`) — a wave reference alone is not an owner.

| Check | Result | Owner | Notes |
|---|---|---|---|
| Domain logic renderer-neutral | DEBT | desktop-architecture | Product logic (thunks, business rules) still lives in Redux/React. No extraction attempted yet — Wave 5+ scope. |
| Critical behavior headless-testable | DEBT | desktop-architecture | Some services (`fsCore.ts`, thunks) are already Vitest-testable without a DOM; most business logic is still coupled to React hooks/components — Wave 5+ scope. |
| Canonical data outside UI state | PASS (partial) | — | `docs/cef/UI-DOMAIN-STATE-CLASSIFICATION.md` (this wave) confirms domain data (`project`, `sceneComments`, `progressTracker`, etc.) is already separated from Presentation/UI slices — it just isn't core-owned yet (see "Domain logic renderer-neutral" above). |
| Browser APIs adapter-contained | DEBT | desktop-architecture | Out of Wave 1 scope — no browser-API (localStorage/matchMedia/service-worker) audit performed this wave; not yet scheduled to a specific wave. |
| Platform APIs adapter-contained | DEBT — in progress | desktop-architecture (Wave 1 PR B) | `packages/desktop-contracts`'s `DesktopPlatform` contract and both reference adapters exist (this PR), but the 14 files identified in `docs/cef/TAURI-COUPLING-INVENTORY.md` still import `@tauri-apps/*` directly. Re-score to PASS once PR B (`services/desktopPlatform.ts` + migration) merges and `pnpm run guardrail:desktop-imports` is green. |
| Stable semantic commands/events | DEBT | desktop-architecture | No semantic command layer exists yet (roadmap §83, explicitly deferred: "do not force a full command-system rewrite before CEF needs it"); not yet scheduled to a specific wave. |
| No duplicate business rule in JS/native | PASS | — | No Rust-side duplication of JS business rules exists today; the small set of native commands (LoRA training, Pandoc conversion, TaskSupervisor) are each single-sourced in Rust with no JS re-implementation. |
| Durable schema UI-independent | PASS (partial) | — | `Settings`/`StoryProject` types are plain, framework-independent TypeScript interfaces (`types.ts`) — not React-coupled. Storage backend selection (`StorageBackend`) already abstracts IndexedDB vs. Tauri filesystem. |
| Error taxonomy UI-independent | DEBT | desktop-architecture | Error handling is inconsistent across services — some throw typed errors (`LocalServerError`), most throw generic `Error`. No unified taxonomy audited this wave; not yet scheduled to a specific wave. |
| Task semantics UI-independent | DEBT | cef-runtime (Wave 4) | `DesktopTasks` facet (this PR) names/types the existing native commands, but their result shapes are not yet a stable, versioned contract — that's Wave 4's typed-IPC-v1 scope. |

**Overall**: 3 PASS (2 partial), 7 DEBT, every DEBT row has a named owner role (per `docs/cef/OWNERSHIP.yaml`), not just a wave reference. No unowned high-impact debt.

## Snapshot: Wave 1 PR B (`services/desktopPlatform.ts` + consumer migration + guardrail)

Of the 17 files in the Wave 0 baseline (`docs/cef/tauri-coupling-inventory.json`'s `resolvedWave1PrB` + the files still remaining in `directApiCoupling`), 3 are permanently out of the DesktopPlatform boundary by design (`services/ai/fetchAdapter.ts`, `services/localServerHttp.ts` — the HTTP facet, Wave 10, never becomes part of `DesktopPlatform` per roadmap §8; `vite.config.ts` — build tooling, not application source). Of the remaining 14 migration-target files, 13 now route through `desktopPlatform`; `services/logger.ts` is scheduled debt, not migrated this PR (see the "Platform APIs adapter-contained" row below).

Migrated this PR: `App.tsx`, `hooks/useTauriUpdater.ts`, `services/desktop/desktopMenu.ts`, `services/desktop/desktopNotifications.ts`, `services/desktop/desktopTray.ts`, `services/fs/fsCore.ts`, `services/lora/loraTrainingService.ts`, `services/pandocTauri.ts`, `services/tauriDeepLink.ts`, `services/tauriMenuService.ts`, `services/tauriTaskBridge.ts`, `services/tauriTrayService.ts` (12), plus `services/tauriRuntime.ts` (partial — its two functions that imported `@tauri-apps/*` directly, `getTauriAppVersion`/`openTauriDataDirectory`, moved into `desktopPlatform.diagnostics`; `isTauriRuntime`/`getDesktopOs`/`applyDesktopRuntimeFlags` are pure detection with no Tauri import and correctly stay untouched, still used by 25+ call sites including `desktopPlatform.ts` itself) = 13 of 14 migration-target files.

`packages/desktop-contracts`'s `DesktopTasks` facet also grew two LoRA-specific additions discovered during this migration, both already reviewed/tested: `onLoraTrainingProgress` (a typed progress-event subscription — `loraTrainingService.ts`'s `startTraining` needed this and no facet covered it) and concrete response types for `abortLoraTraining`/`checkLoraEnvironment`/`setLoraPythonPath` (previously `Promise<unknown>`; now validated at the adapter boundary against `LoraAbortOutcome`/`LoraTrainingEnvironmentResult` before being trusted, per the "native command responses must be validated before trusting result shapes" contract — a malformed native response now throws instead of being passed through unchecked).

| Check | Result | Owner | Notes |
|---|---|---|---|
| Platform APIs adapter-contained | **PASS** | desktop-architecture | Mechanically verified — `pnpm run guardrail:desktop-imports` (`scripts/check-tauri-import-boundary.mjs`, wired into the CI `quality` job and `ci:quick`) scans all application `.ts`/`.tsx` source and reports zero `@tauri-apps/*` imports outside `packages/desktop-contracts/src/` and 3 documented exceptions (see below). This is not a documentation claim — the gate fails CI on any new violation. |
| — `services/logger.ts` (JSONL log sink) | DEBT | desktop-architecture, Wave 5/7 | Not migrated this PR — `packages/desktop-contracts`'s own Tauri adapter imports `services/logger.ts` for its `logger.warn(...)` failure-observability calls; having `logger.ts` also import `desktopPlatform` would create a circular import (`logger → desktopPlatform → tauriDesktopPlatform → logger`). Exit condition: give `packages/desktop-contracts` its own lightweight logging port (injected callback, or plain `console.warn` internally) so it stops depending on the app-level logger, then route `logger.ts`'s JSONL sink through `desktopPlatform.filesystem` (the `DesktopWriteOptions.append`/`.create` semantics it needs already exist on the facet — see `packages/desktop-contracts/src/types.ts`'s `DesktopFilesystem.writeTextFile` doc comment). Explicitly allowlisted in `scripts/check-tauri-import-boundary.mjs` with this same reasoning, so the guardrail stays honest about the one remaining gap rather than silently passing. |

Other rows are unchanged from the Wave 1 PR A snapshot above; this PR did not touch domain-logic extraction, browser-API containment, semantic commands, error taxonomy, or task-semantics versioning.

### Scheduling decisions for the remaining "not yet scheduled" DEBT rows (this PR)

The Wave 1 PR A snapshot left three DEBT rows marked "not yet scheduled to a specific wave." Per the migration guardrails, every DEBT row needs an explicit scheduling decision, not open-ended deferral — resolved here without doing the underlying work (that stays out of Wave 1's scope):

- **Browser APIs adapter-contained → Wave 5.** This is a natural companion to "Domain logic renderer-neutral" / "Critical behavior headless-testable" (both already Wave 5+): browser APIs (`localStorage`, `matchMedia`, service-worker registration) are consumed by the same business logic Wave 5 extracts out of React. Exit condition: an audited inventory of direct browser-API call sites (mirroring this wave's `TAURI-COUPLING-INVENTORY.md` methodology) plus adapter wrapping for the ones inside extracted domain logic, gated by a guardrail script analogous to `check-tauri-import-boundary.mjs`.
- **Stable semantic commands/events → Wave 4.** Roadmap §83 defers this explicitly ("do not force a full command-system rewrite before CEF needs it") — Wave 4's typed-IPC-v1 work is the concrete forcing function, since a stable native command surface and a stable semantic command/event naming scheme are the same boundary crossing. Exit condition: `services/commands/` command IDs and `DesktopTasks`-style native command names are reconciled into one versioned contract as part of Wave 4's IPC-v1 deliverable.
- **Error taxonomy UI-independent → Wave 4 (native-crossing half) + Wave 5 (JS-service half).** The native/IPC-crossing half needs a stable typed-error shape as part of Wave 4's typed-IPC-v1 contract (a native command's failure mode is exactly the kind of thing IPC-v1 is meant to stabilize). The JS-service-layer half (e.g. `LocalServerError` vs. generic `Error` across other services) is folded into Wave 5's domain extraction, since taxonomy work is most efficient once the services being extracted are already being touched. Exit condition: both halves produce one documented error-taxonomy reference (types + when each is thrown), not two independent ad hoc schemes.

## Next scoring checkpoint

Re-score "Platform APIs adapter-contained" again once `services/logger.ts`'s JSONL sink migrates (Wave 5/7, see above). Re-score the three newly-scheduled rows at each wave's exit (Wave 4 typed-IPC-v1, Wave 5 domain extraction).
