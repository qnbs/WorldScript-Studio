# WorldScript Studio — Feature Parity Matrix

**Generated:** 2026-05-28 | **Last updated:** 2026-06-16 (v1.23.0 reconciliation — 23-flag model, defaults corrected, retired flags removed) | **Auditor:** Senior Principal Engineer  
**Source of truth:** `features/featureFlags/featureFlagsSlice.ts`  
**Script:** `pnpm exec tsx scripts/audit-feature-parity.ts`

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Present and correct |
| ❌ | Missing — drift detected |
| ⚠️ | Present but incomplete / misleading |
| 🔒 | Behind flag — not accessible without enabling |
| 🔓 | NOT behind flag — accessible regardless of flag state |
| 🚫 | Explicitly blocked until a prerequisite is met |

---

## Feature Parity Matrix

> **Defaults (v1.24 post-release):** the slice ships the **full feature set** —
> 23 flags, **17 default-on**, **6 opt-in default-off** (`enableProForge`, `enableRtlLayout`,
> `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`).
> `enableProForge` was flipped to opt-in (experimental, token-heavy 8-stage pipeline). The retired/promoted
> flags `enableCodexAutoTracking`, `enableCrossProjectSearch` (both promoted to permanent core),
> `enablePlotBoardV2`, and `enableCloudSync` (retired) are no longer in the slice and have been
> removed from this matrix. `features/featureCatalog.ts` now **derives** each flag's `defaultOn` from
> the slice (single source of truth — the catalog/slice default drift can no longer recur). Run
> `pnpm exec tsx scripts/audit-feature-parity.ts` for the live check.

| Feature Flag | Default | Slice | i18n Key | UI Toggle | `useSettingsView` Handler | Runtime Gate | Gate Location | Status |
|---|---|---|---|---|---|---|---|---|
| `enableStoryBibleAdvanced` | ON | ✅ | ✅ | ✅ | ✅ | ⚠️ | `listenerMiddleware.ts:247` only | 🟡 Partial |
| `enableBinderResearch` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `ManuscriptView.tsx:27` | 🟢 OK |
| `enableCompileWizard` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `ExportView.tsx:507` | 🟢 OK |
| `enableProjectHealthScore` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `Dashboard.tsx:402` | 🟢 OK |
| `enableAppHealthPanel` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `GeneralSections.tsx:314` | 🟢 OK |
| `enableDuckDbAnalytics` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `useDuckDb.ts:59`, `useAnalytics.ts:50`, `duckdbListenerLoader` | 🟢 OK |
| `enableObjectsGroups` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableMindMaps` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableCharacterInterviews` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableLoraAdapters` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `useWorldScriptAI.ts` reads `selectActiveLoraOllamaTag` → `loraModelPath` *(fixed 2026-05-29)* | 🟢 OK |
| `enablePluginSystem` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `PluginRegistry.setEnabled()` + `App.tsx` sync *(fixed 2026-05-29)* | 🟢 OK |
| `enableProForge` | **OFF** | ✅ | ✅ | ✅ | ✅ | ✅ | Handler in `useSettingsView.ts`; `WriterViewUI.tsx:86` *(default flipped to opt-in v1.24 post-release)* | 🟢 OK |
| `enableIdbAtRestEncryption` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` + `IdbUnlockModal` *(fixed 2026-05-29)*; passphrase UX complete (B-1) | 🟢 OK |
| `enableAdaptiveAiEngine` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `listenerMiddleware.ts` listeners; window gate; `useAdaptiveAi`; `App.tsx initAdaptiveAiOnStartup` *(added 2026-05-31)* | 🟢 OK |
| `enableWebnnInference` | ON | ✅ | ✅ | ✅ | ✅ | ⚠️ | Toggle + handler only — **no runtime gate reads `selectEnableWebnnInference`**. WebNN code lives in `packages/ai-core/src/webnnBridge.ts` but is not gated on this flag (ghost/stub) *(corrected 2026-06-21)* | 🟡 Partial |
| `enableComputeShaders` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `computeShaderFactory.ts`; `localRagService.ts` GPU cosine; `useAdaptiveAi` *(added 2026-05-31)* | 🟢 OK |
| `enableWorkerBusV2` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `packages/worker-bus` orchestration; `ensureWebLlmPool()` / WorkerBus init | 🟢 OK |
| `enableRustCompute` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | Tauri Rust compute (`src-tauri/`); verified via `tauri-build.yml` (no PR-CI gate) | 🟢 OK |
| `enableRtlLayout` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:271` | 🟢 OK |
| `enableVoiceSupport` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:568` | 🟢 OK |
| `enableVoiceWasm` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `useVoice.ts:29` + handler added *(fixed 2026-05-29)* | 🟢 OK |
| `enableGlobalCopilot` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` lazy `CopilotPanel` mount; `hooks/useGlobalCopilot.ts` | 🟢 OK |
| `enableLocalFirstSync` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | shadow Yjs projection (ADR-0008); Redux stays SoT | 🟢 OK |

---

## Drift Summary (2026-06-21 — v1.24 post-release: ProForge opt-in + catalog defaultOn derived)

**All 8 critical drifts from the 2026-05-29 parity audit remain fixed.** The 2026-06-21 pass
flipped `enableProForge` to opt-in (now **17 on / 6 off**), made `features/featureCatalog.ts`
**derive** each entry's `defaultOn` from the slice (so the catalog/slice default drift fixed in
v1.24 can no longer recur — guarded by `tests/unit/featureCatalog.test.ts`), brought the catalog to
full 23-flag coverage, and corrected the `enableWebnnInference` row to reflect that it has no runtime
gate (ghost/stub — `scripts/audit-feature-parity.ts` already warns on it). The earlier 2026-06-16
pass corrected the `Default` column and removed the four retired/promoted flags
(`enableCodexAutoTracking`, `enableCrossProjectSearch`, `enablePlotBoardV2`, `enableCloudSync`).
`pnpm exec tsx scripts/audit-feature-parity.ts` is the live gate.

### ✅ Resolved Drifts (2026-05-29 parity audit)

| Flag | Was | Fixed By |
|------|-----|----------|
| `enableProForge` | No handler in `useSettingsView.ts` | Handler added |
| `enableVoiceWasm` | No handler in `useSettingsView.ts` | Handler added |
| `enableIdbAtRestEncryption` | Ghost flag — no UI/handler/service | Full B-1 implementation; handler added |
| `enableObjectsGroups` | No route guard in `App.tsx` | Route guard added |
| `enableMindMaps` | No route guard in `App.tsx` | Route guard added |
| `enableCloudSync` | No structural flag gate | `CloudSyncBackend.create()` param guard |
| `enablePluginSystem` | Registry callable without flag | `PluginRegistry.setEnabled()` |
| `enableLoraAdapters` | `selectActiveLoraOllamaTag` dead selector | Wired into `useWorldScriptAI.ts` |

### 🟡 Remaining Minor Partial Wiring

| Flag | Issue |
|------|-------|
| `enableStoryBibleAdvanced` | Only affects Codex extraction mode, not a separate view |
| `enableCharacterInterviews` | Route guard added in `App.tsx`; hook-level check is redundant but harmless |
| `enableAdaptiveAiEngine` | LoRA Phase 2.2 pending — LoRA view not yet routed; `clickNavItem` in E2E tests skips LoRA wizard until route is added |

---

## Fix Roadmap

All P0/P1/P2 items from the original roadmap are complete. Remaining low-priority items:

| Priority | Fix | Files |
|----------|-----|-------|
| P3 (nice-to-have) | Gate `CharacterInterviewsView` at hook level as well (currently only `App.tsx`) | `hooks/useCharacterInterviewsView.ts` |
| P3 (nice-to-have) | `enableStoryBibleAdvanced` — add UI-visible indicator when advanced features are unlocked | `components/WorldView.tsx` or `StoryBibleView.tsx` |
| Phase 2.2 | Add `LoRA Adapters` view route in `App.tsx` + sidebar nav item when `enableLoraAdapters` is on | `App.tsx`, `components/Sidebar.tsx` |
