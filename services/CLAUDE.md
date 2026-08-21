# Scene-level services

**sceneRevisionService:** `services/sceneRevisionService.ts` — IDB `scene-revisions`; `saveRevision(sectionId, snapshot, label?)`, `listRevisions(sectionId)`, `deleteRevision(id)`.

**sceneCommentsSlice:** `features/sceneComments/sceneCommentsSlice.ts` — EntityAdapter; `selectCommentsBySection(sectionId)`, `selectUnresolvedCount`, `selectUnresolvedCountBySection(sectionId)`. Root key: `sceneComments`.

**progressTrackerSlice:** `features/progressTracker/progressTrackerSlice.ts` — `startSession`, `endSession`, `setDailyGoal`, `setWeeklyGoal`, `syncStreak`. Exported: `computeStreak(history)`.

**deepLinkService:** `services/deepLinkService.ts` — `parseHash(hash)`, `pushHash(view, sectionId?)`, `readCurrentView()`. Views: `'board' | 'preview' | 'progress' | 'project'`.

# LanguageTool Integration

Privacy-first, **self-hosted-first** grammar/spell checking is wired into the manuscript editor (`docs/LANGUAGETOOL.md`, `docs/adr/0010-languagetool-self-hosted.md`). It is off by default via `settings.integrations.languageToolEnabled`; local-only privacy blocks remote servers, and every configured endpoint must also be declared in `config/csp-connect-src.json` or the runtime preflight rejects it clearly. `services/languageToolService.ts` never logs manuscript text — only match counts and a `status: 'ok' | 'offline' | 'error'` via `services/logger.ts#log.warn` — and returns an empty match list on network/HTTP failure rather than throwing, so a failed check never blocks typing. Corrections apply offset-safe through `hooks/useLanguageToolCheck.ts` → `applyMatchReplacement` (redux-undo-wrapped); user dictionary persists in `settings.advancedEditor.customDictionary`.

# Cross-project & backup

**crossProjectIndexService / crossProjectSearchService:** IDB `projects-index-store` (DB_VERSION 8); `searchAcrossProjects()` via fuzzyScore. Indexing triggered on save. UI: `CrossProjectSearchPanel`; Zustand key: `isCrossProjectSearchOpen`.

**libraryBackupService:** one-click encrypted ZIP export (AES-GCM, `META.json` + `vault.bin`). Settings → Data.

# Local inference

`services/localAiFacade.ts` wraps WebLLM with the same provider interface as `aiProviderService.ts`. Model download progress via `onProgress`; mount-guard via `useRef`.

# Plugin System

`services/pluginRegistry.ts` — `PluginRegistry` + singleton. Plugins declare `PluginDescriptor` (Zod-validated: `id`, `version`, `type`, `entrypoint`, `permissions`). `PluginSandboxedApi` gates every method behind declared permissions.

**Execution API:** `execute(id, fn, rawApi)` (sync) · `executeAsync` (async) · `loadPlugin(descriptor, rawApi)` (dynamic import + `run(api)`).

Reference plugins: `wordCountOverlay.plugin.ts`, `sceneAppender.plugin.ts`. Gate: `enablePluginSystem`.
