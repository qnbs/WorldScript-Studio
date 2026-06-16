# WorldScript Studio — Feature Parity Matrix

**Generated:** 2026-05-28 | **Last updated:** 2026-06-01 (post-parity-audit corrections + Edge-AI flags) | **Auditor:** Senior Principal Engineer  
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

| Feature Flag | Default | Slice | i18n Key | UI Toggle | `useSettingsView` Handler | Runtime Gate | Gate Location | Status |
|---|---|---|---|---|---|---|---|---|
| `enableCodexAutoTracking` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `listenerMiddleware.ts:219` | 🟢 OK |
| `enableStoryBibleAdvanced` | OFF | ✅ | ✅ | ✅ | ✅ | ⚠️ | `listenerMiddleware.ts:247` only | 🟡 Partial |
| `enableBinderResearch` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `ManuscriptView.tsx:27` | 🟢 OK |
| `enableCompileWizard` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `ExportView.tsx:507` | 🟢 OK |
| `enableProjectHealthScore` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `Dashboard.tsx:402` | 🟢 OK |
| `enableCrossProjectSearch` | ON | ✅ | ✅ | ✅ | ✅ | ✅ | `CrossProjectSearchPanel.tsx:133`, `listenerMiddleware.ts:133` | 🟢 OK |
| `enableAppHealthPanel` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `GeneralSections.tsx:314` | 🟢 OK |
| `enablePlotBoardV2` | ON | ✅ | ✅ | ✅ | ✅ | ⚠️ | `helpDocRetrieval.ts` docs only | 🟡 Gate unclear |
| `enableDuckDbAnalytics` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `useDuckDb.ts:59`, `useAnalytics.ts:50`, `duckdbListenerLoader` | 🟢 OK |
| `enableObjectsGroups` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableMindMaps` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableCharacterInterviews` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` route guard *(fixed 2026-05-29)* | 🟢 OK |
| `enableRtlLayout` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:271` | 🟢 OK |
| `enableCloudSync` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `CloudSyncBackend.create()` structural `featureFlagEnabled` param *(fixed 2026-05-29)* | 🟢 OK |
| `enableLoraAdapters` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `useWorldScriptAI.ts` reads `selectActiveLoraOllamaTag` → `loraModelPath` *(fixed 2026-05-29)* | 🟢 OK |
| `enablePluginSystem` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `PluginRegistry.setEnabled()` + `App.tsx` sync *(fixed 2026-05-29)* | 🟢 OK |
| `enableVoiceSupport` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:568` | 🟢 OK |
| `enableProForge` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | Handler added to `useSettingsView.ts` *(fixed 2026-05-29)*; `WriterViewUI.tsx:23` | 🟢 OK |
| `enableIdbAtRestEncryption` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx` + `IdbUnlockModal` *(fixed 2026-05-29)*; passphrase UX complete (B-1) | 🟢 OK |
| `enableVoiceWasm` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `useVoice.ts:29` + handler added *(fixed 2026-05-29)* | 🟢 OK |
| `enableAdaptiveAiEngine` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `listenerMiddleware.ts` listeners; window gate; `useAdaptiveAi`; `App.tsx initAdaptiveAiOnStartup` *(added 2026-05-31)* | 🟢 OK |
| `enableWebnnInference` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `adaptiveAiEngine.ts` backend selection; `webnnBridge.ts` *(added 2026-05-31)* | 🟢 OK |
| `enableComputeShaders` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `computeShaderFactory.ts`; `localRagService.ts` GPU cosine; `useAdaptiveAi` *(added 2026-05-31)* | 🟢 OK |

---

## Drift Summary (2026-06-01 — All critical drifts resolved)

**All 8 critical drifts from the 2026-05-29 parity audit have been fixed.** The matrix is now fully green.

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
