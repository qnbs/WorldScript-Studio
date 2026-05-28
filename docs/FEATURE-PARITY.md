# StoryCraft Studio — Feature Parity Matrix

**Generated:** 2026-05-28 | **Auditor:** Senior Principal Engineer  
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
| `enableObjectsGroups` | OFF | ✅ | ✅ | ✅ | ✅ | ❌ | `App.tsx:466` — **no gate** | 🔴 DRIFT |
| `enableMindMaps` | OFF | ✅ | ✅ | ✅ | ✅ | ❌ | `App.tsx:468` — **no gate** | 🔴 DRIFT |
| `enableCharacterInterviews` | OFF | ✅ | ✅ | ✅ | ✅ | ⚠️ | `useCharacterInterviewsView.ts:39` (hook only, view always mounts) | 🟡 Partial |
| `enableRtlLayout` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:271` | 🟢 OK |
| `enableCloudSync` | OFF | ✅ | ✅ | ✅ | ✅ | ❌ | Comment says gated — **no runtime check** | 🔴 DRIFT |
| `enableLoraAdapters` | OFF | ✅ | ✅ | ✅ | ✅ | ⚠️ | Settings UI gated; `selectActiveLoraOllamaTag` selector dead | 🟡 Partial |
| `enablePluginSystem` | OFF | ✅ | ✅ | ✅ | ✅ | ⚠️ | `PluginsSection.tsx:16` (settings UI only); registry callable without flag | 🟡 Partial |
| `enableVoiceSupport` | OFF | ✅ | ✅ | ✅ | ✅ | ✅ | `App.tsx:568` | 🟢 OK |
| `enableProForge` | OFF | ✅ | ✅ | ✅ | ❌ | ✅ | `WriterViewUI.tsx:23` — **handler missing in useSettingsView** | 🔴 DRIFT |
| `enableIdbAtRestEncryption` | OFF | ✅ | ❌ | ❌ | ❌ | ❌ | Not consumed by any service | 🔴 GHOST FLAG |
| `enableVoiceWasm` | OFF | ✅ | ✅ | ✅ | ❌ | ✅ | `useVoice.ts:29`, `sttEngine.ts`, `vadEngine.ts` — **handler missing** | 🔴 DRIFT |

---

## Drift Summary

### 🔴 CRITICAL — Toggles that silently do nothing

| Flag | Root Cause | Impact |
|------|-----------|--------|
| `enableProForge` | No `case` in `useSettingsView.ts` switch | User toggles flag → `logger.warn('Unknown setting key')` → Redux never updated |
| `enableVoiceWasm` | No `case` in `useSettingsView.ts` switch | Same — WASM STT/VAD can never be user-enabled from UI |
| `enableIdbAtRestEncryption` | Missing across all 5 layers | Ghost flag — defined in slice, toggle invisible, handler absent, service never reads it |

### 🔴 VIEWS WITHOUT FLAG GATES

| Flag | View | App.tsx Line | Issue |
|------|------|-------------|-------|
| `enableObjectsGroups` | `ObjectsView` | 465–466 | Rendered without flag check — accessible regardless of flag |
| `enableMindMaps` | `MindMapView` | 467–468 | Same — mind map always accessible |

### 🟡 PARTIAL / INCOMPLETE WIRING

| Flag | Issue |
|------|-------|
| `enableLoraAdapters` | `selectActiveLoraOllamaTag` selector is dead — nothing reads it to pass `loraModelPath` to AI calls from the lora adapter store |
| `enableCloudSync` | Services have comments claiming flag-gating but `enableCloudSync` is never read at runtime outside settings toggle |
| `enablePluginSystem` | `pluginRegistry.execute()` callable without flag check |
| `enableStoryBibleAdvanced` | Only affects Codex extraction mode, not any UI |
| `enableCharacterInterviews` | Hook checks flag but `CharacterInterviewsView` renders without checking |

---

## Fix Roadmap

| Priority | Fix | Files |
|----------|-----|-------|
| P0 | Add 3 missing handlers to `useSettingsView.ts` | `hooks/useSettingsView.ts` |
| P0 | Add `enableObjectsGroups` gate in `App.tsx` | `App.tsx` |
| P0 | Add `enableMindMaps` gate in `App.tsx` | `App.tsx` |
| P1 | Add `enableIdbAtRestEncryption` to UI + i18n | `FeatureFlagsSection.tsx`, `locales/*/settings.json`, `useSettingsView.ts` |
| P1 | Wire `selectActiveLoraOllamaTag` into `useStoryCraftAI` / Writer thunks | `hooks/useStoryCraftAI.ts`, `features/project/thunks/writingThunks.ts` |
| P2 | Add runtime gate for `enableCloudSync` in `storageService.ts` | `services/storageService.ts` |
| P2 | Add runtime gate for `enablePluginSystem` in `pluginRegistry.ts` | `services/pluginRegistry.ts` |
| P3 | Gate `CharacterInterviewsView` render in `App.tsx` | `App.tsx` |
