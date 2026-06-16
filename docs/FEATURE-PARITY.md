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

> **Defaults reconciled 2026-06-16 (v1.23.0):** the slice now ships the **full feature set** —
> 23 flags, **18 default-on**, **5 opt-in default-off** (`enableRtlLayout`, `enableVoiceSupport`,
> `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`). The retired/promoted flags
> `enableCodexAutoTracking`, `enableCrossProjectSearch` (both promoted to permanent core),
> `enablePlotBoardV2`, and `enableCloudSync` (retired) are no longer in the slice and have been
> removed from this matrix. Run `pnpm exec tsx scripts/audit-feature-parity.ts` for the live check.

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
| `enableProForge` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | Handler added to `useSettingsView.ts` *(fixed 2026-05-29)*; `WriterViewUI.tsx:23` | 🟢 OK |
| `enableIdbAtRestEncryption` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` + `IdbUnlockModal` *(fixed 2026-05-29)*; passphrase UX complete (B-1) | 🟢 OK |
| `enableAdaptiveAiEngine` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `listenerMiddleware.ts` listeners; window gate; `useAdaptiveAi`; `App.tsx initAdaptiveAiOnStartup` *(added 2026-05-31)* | 🟢 OK |
| `enableWebnnInference` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `adaptiveAiEngine.ts` backend selection; `webnnBridge.ts` *(added 2026-05-31)* | 🟢 OK |
| `enableComputeShaders` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `computeShaderFactory.ts`; `localRagService.ts` GPU cosine; `useAdaptiveAi` *(added 2026-05-31)* | 🟢 OK |
| `enableWorkerBusV2` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `packages/worker-bus` orchestration; `ensureWebLlmPool()` / WorkerBus init | 🟢 OK |
| `enableRustCompute` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | Tauri Rust compute (`src-tauri/`); verified via `tauri-build.yml` (no PR-CI gate) | 🟢 OK |
| `enableRtlLayout` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:271` | 🟢 OK |
| `enableVoiceSupport` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:568` | 🟢 OK |
| `enableVoiceWasm` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `useVoice.ts:29` + handler added *(fixed 2026-05-29)* | 🟢 OK |
| `enableGlobalCopilot` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` lazy `CopilotPanel` mount; `hooks/useGlobalCopilot.ts` | 🟢 OK |
| `enableLocalFirstSync` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | shadow Yjs projection (ADR-0008); Redux stays SoT | 🟢 OK |

---

## Drift Summary (2026-06-16 — reconciled to the v1.23.0 23-flag model)

**All 8 critical drifts from the 2026-05-29 parity audit remain fixed.** The 2026-06-16 pass
corrected the `Default` column (the slice ships the full set: 18 on, 5 opt-in off), removed the
four retired/promoted flags (`enableCodexAutoTracking`, `enableCrossProjectSearch`,
`enablePlotBoardV2`, `enableCloudSync`), and added the four flags introduced since v1.21
(`enableWorkerBusV2`, `enableRustCompute`, `enableGlobalCopilot`, `enableLocalFirstSync`).
The matrix is now fully green; `pnpm exec tsx scripts/audit-feature-parity.ts` is the live gate.

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
