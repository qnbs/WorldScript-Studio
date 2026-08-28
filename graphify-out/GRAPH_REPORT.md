# Graph Report - worldscript-studio

Report schema: 1
Source fingerprint: sha256:c1d44a4509f3611922df3cddfddb56e85f81833b39170388a44599cace03287d
Tool: graphifyy
Tool version: graphify 0.9.51
Generation mode: AST-only local build (graphify update .)

## Corpus Check
- 2053 files · ~2,176,128 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 12269 nodes · 24866 edges · 713 communities (607 shown, 106 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 286 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `useTranslation()` - 227 edges
2. `useAppSelector` - 144 edges
3. `useAppDispatch()` - 128 edges
4. `scripts` - 94 edges
5. `logger` - 94 edges
6. `WorkerBus` - 79 edges
7. `ProjectData` - 76 edges
8. `StorySection` - 70 edges
9. `Button` - 67 edges
10. `WorldScript Studio — Codebase Audit Report` - 61 edges

## Surprising Connections (you probably didn't know these)
- `ViewLoader()` --calls--> `useTranslation()`  [EXTRACTED]
  App.tsx → hooks/useTranslation.ts
- `App()` --indirect_call--> `selectFeatureFlags()`  [INFERRED]
  App.tsx → features/featureFlags/featureFlagsSlice.ts
- `App()` --indirect_call--> `selectProjectData()`  [INFERRED]
  App.tsx → features/project/projectSelectors.ts
- `AdvancedAiSection()` --indirect_call--> `analyticsPersistenceAllowedNow()`  [INFERRED]
  components/settings/AiSections.tsx → app/analyticsGate.ts
- `AssignPopover()` --calls--> `useAppDispatch()`  [EXTRACTED]
  components/scene-board/SubplotPanel.tsx → app/hooks.ts

## Import Cycles
- 2-file cycle: `app/store.ts -> app/storeRef.ts -> app/store.ts`
- 2-file cycle: `features/project/projectSlice.ts -> features/project/thunks/binderThunks.ts -> features/project/projectSlice.ts`
- 2-file cycle: `features/project/projectSlice.ts -> features/project/thunks/projectManagementThunks.ts -> features/project/projectSlice.ts`
- 2-file cycle: `packages/ai-core/src/index.ts -> packages/ai-core/src/onnxRuntimeEngine.ts -> packages/ai-core/src/index.ts`
- 2-file cycle: `packages/ai-core/src/index.ts -> packages/ai-core/src/webllmOptimizer.ts -> packages/ai-core/src/index.ts`
- 3-file cycle: `features/project/adapters.ts -> types.ts -> features/project/projectSlice.ts -> features/project/adapters.ts`
- 3-file cycle: `features/project/aiThunkUtils.ts -> types.ts -> features/project/projectSlice.ts -> features/project/aiThunkUtils.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/projectState.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/binderReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/characterReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/interviewReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/manuscriptReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/mindMapReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/outlineReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/plotReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/relationshipReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/storyObjectReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/worldReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/reducers/writingAnalyticsReducers.ts -> types.ts -> features/project/projectSlice.ts`
- 3-file cycle: `features/project/projectSlice.ts -> features/project/thunks/binderThunks.ts -> types.ts -> features/project/projectSlice.ts`

## Knowledge Gaps
- **5194 isolated node(s):** `$schema`, `config:recommended`, `dependencyDashboard`, `prHourlyLimit`, `prConcurrentLimit` (+5189 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **106 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logger` connect `logger` to `SettingsView.tsx`, `useTranslation`, `localEmbeddingService.ts`, `App.tsx`, `localRagService.ts`, `store.ts`, `VoiceControlPanel.tsx`, `telemetryService.ts`, `ToolsPanel.tsx`, `storageService.ts`, `CharacterView.tsx`, `idbProjectStore.ts`, `proForgeOrchestrator.ts`, `shortcutActions.ts`, `Character`, `PipelineStage`, `types.ts`, `VersionControlPanel.tsx`, `aiInferenceCacheService.ts`, `computeShaderFactory.ts`, `loraDatasetBuilder.ts`, `worldScriptCompletionFetch.ts`, `geminiService.ts`, `I18nContext.tsx`, `loraEvaluationService.ts`, `dbConstants.ts`, `localAiDeviceProfiler.ts`, `index.tsx`, `fsCore.ts`, `benchmarkService.ts`, `libraryBackupService.ts`, `AudioNavigator`, `localAiFacade.ts`, `epubApiService.ts`, `deviceHealthService.ts`, `sanitizePathSegment`, `logger.ts`, `useVoice.ts`, `sttEngine.ts`, `ragPromptAssembly.ts`, `loraOllamaService.ts`, `useDuckDb.ts`, `voiceCommandService.ts`, `useConsistencyCheckerView.ts`, `kokoroTtsEngine.ts`, `IdbUnlockModal.tsx`, `loraTrainingService.ts`, `duckdbClient.ts`, `useApp.ts`, `projectFsStore.ts`, `loraAdapterService.ts`, `voiceTypes.ts`, `diagnosticAgent.test.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `useTranslation()` connect `useTranslation` to `SettingsView.tsx`, `LoraTrainingWizard.tsx`, `App.tsx`, `projectSlice.ts`, `BookPreviewView.tsx`, `aiPolicy.ts`, `Dashboard.tsx`, `VoiceControlPanel.tsx`, `ToolsPanel.tsx`, `MindMapCanvas.tsx`, `useMindMapView.ts`, `viewContexts.test.tsx`, `Icon.tsx`, `proForgeOrchestrator.ts`, `SceneBoardView.tsx`, `types.ts`, `useCommandPalette.ts`, `VersionControlPanel.tsx`, `loraDatasetBuilder.ts`, `useCharacterInterviewsView.ts`, `ProgressTrackerView.tsx`, `sceneCommentsSlice.ts`, `CollaborationPanel.tsx`, `localAiDeviceProfiler.ts`, `encryptionMigrationJournal.ts`, `crossProjectIndexService.ts`, `ExportView.tsx`, `localAiFacade.ts`, `deviceHealthService.ts`, `sceneRevisionService.ts`, `ObjectsView.tsx`, `AiProviderCard.test.tsx`, `useConsistencyCheckerView.ts`, `PipelineReviewPanel.tsx`, `useHelpView.ts`, `useGlobalCopilot.ts`, `IdbUnlockModal.tsx`, `LocalAiDownloadProgress.tsx`, `GpuMetricsPanel.tsx`, `loraTrainingService.ts`, `useLanguageToolCheck.ts`, `storybookProviders.tsx`, `MindMapView.tsx`, `fallbackEvents.ts`, `useTransientUiStore`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `StoryCodex` connect `storageService.ts` to `storageEncryptionService.ts`, `geminiService.ts`, `viewContexts.test.tsx`, `idbProjectStore.ts`, `useConsistencyCheckerView.ts`, `types.ts`, `sanitizePathSegment`, `CloudSyncBackend`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `$schema`, `config:recommended`, `dependencyDashboard` to the rest of the system?**
  _5194 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `SettingsView.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.030653266331658293 - nodes in this community are weakly interconnected._
- **Should `useTranslation` be split into smaller, more focused modules?**
  _Cohesion score 0.031800766283524906 - nodes in this community are weakly interconnected._
- **Should `primaryProtectedStoreAdapters.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.03211122047244094 - nodes in this community are weakly interconnected._

## Top 20 Communities by size (of 713 total)

_693 smaller communities omitted from this committed summary — full detail in local graphify-out/graph.json / graph.html (gitignored, not committed). Rebuild anytime: `pnpm run graphify:update`._

### Community 0 - "SettingsView.tsx"
Cohesion: 0.03
Nodes (122): ApiKeySection(), containsAsciiControlCharacter(), isSyntacticallySafeGeminiApiKey(), SETTINGS_CATEGORY_STORAGE_KEY, AccessibilitySection(), PRESET_IDS, MODES, ConnectionTestStatus (+114 more)

### Community 2 - "primaryProtectedStoreAdapters.ts"
Cohesion: 0.03
Nodes (104): Props, beginEncryptionMigration(), EncryptionMigrationOperation, EncryptionMigrationPhase, releaseEncryptionMigrationOwnership(), createMigrationOperationId(), getRegisteredProtectedStoreAdapters(), resumeProductionEncryptionMigration() (+96 more)

### Community 1 - "useTranslation"
Cohesion: 0.03
Nodes (100): analyticsPersistenceAllowedNow(), useAppDispatch(), useAppSelector, LoraView, WelcomePortal, AdvancedImportExport(), binderDepth(), BinderPanel() (+92 more)

### Community 11 - "scripts"
Cohesion: 0.02
Nodes (94): scripts, analyze, bench, build, build:edge, build:pages, build-storybook, build:turbo (+86 more)

### Community 3 - "App.tsx"
Cohesion: 0.03
Nodes (84): App(), AppProps, CopilotLauncher, CriticView, Dashboard, ManuscriptView, ScenarioWorkspaceView, SettingsView (+76 more)

### Community 4 - "projectSlice.ts"
Cohesion: 0.05
Nodes (82): RootState, ToastContext, ToastContextType, useToast(), WorldView(), activeControllers, createDeduplicatedThunk(), DeduplicatedThunkAPI (+74 more)

### Community 5 - "storageEncryptionService.ts"
Cohesion: 0.04
Nodes (78): AppDispatch, IdbUnlockStartupGuardOptions, log, useIdbUnlockStartupGuard(), decryptDuckDbData(), initDuckDbEncryption(), opfsEncryptionKey, clearCompletedEncryptionMigration() (+70 more)

### Community 12 - "CharacterView.tsx"
Cohesion: 0.04
Nodes (70): CharacterView, WorldView, AIProfileModal(), CharacterCard, CharacterDossier(), CharacterViewUI(), DeleteConfirmationModal(), DetailField (+62 more)

### Community 8 - "Dashboard.tsx"
Cohesion: 0.04
Nodes (66): OutlineGeneratorView, AuthorInsightsCard(), Dashboard(), DashboardHeader(), baseProps, BookOpenIcon(), CalendarIcon(), FlameIcon() (+58 more)

### Community 7 - "store.ts"
Cohesion: 0.03
Nodes (64): aiApi, isAnalyticsPersistenceAllowed(), selectAnalyticsPersistenceAllowed, DebouncedEffectApi, getLocalFirstHandle(), initAdaptiveAiOnStartup(), initLocalFirstSyncOnStartup(), listenerMiddleware (+56 more)

### Community 10 - "ToolsPanel.tsx"
Cohesion: 0.03
Nodes (64): WriterView, STATUS_COLORS, DebouncedTextarea, DebouncedTextareaProps, DictationButton(), DictationButtonProps, DictationInput, Textarea (+56 more)

### Community 15 - "viewContexts.test.tsx"
Cohesion: 0.04
Nodes (63): CharacterGraphView, ConsistencyCheckerView, HelpView, TemplateView, CharacterForceGraph(), CharacterGraphUI(), ForceGraph2D, getRelationshipColor() (+55 more)

### Community 28 - "devDependencies"
Cohesion: 0.03
Nodes (63): @axe-core/playwright, @biomejs/biome, http-server, jsdom, lint-staged, devDependencies, @axe-core/playwright, @biomejs/biome (+55 more)

### Community 13 - "StorySection"
Cohesion: 0.03
Nodes (61): ACT_GRADIENT_CLASSES, ActSwimlane(), ActSwimlaneProps, CanvasCardProps, MINIMAP_H, MINIMAP_W, PlotMinimap(), PlotMinimapProps (+53 more)

### Community 29 - "ROADMAP-QT-GPUI-DESKTOP.md"
Cohesion: 0.03
Nodes (60): 0. Executive decision, 11. CI architecture, 18. React reuse policy, 19. Qt licensing and compliance gate, 1. Strategic vision, 20. Project format and migration policy, 21. Collaboration architecture, 22. AI architecture (+52 more)

### Community 33 - "signing-core.mjs"
Cohesion: 0.08
Nodes (56): cwd, hookMode, identity, jsonMode, signing, summary, unsafeOverrides, aggregateDiagnosticState() (+48 more)

### Community 17 - "Icon.tsx"
Cohesion: 0.04
Nodes (55): ManuscriptDesktopLayout(), ManuscriptDesktopLayoutProps, ManuscriptEditor, TYPOS_DE, TYPOS_EN, ManuscriptMobileLayout(), ManuscriptMobileLayoutProps, NavigatorItem (+47 more)

### Community 23 - "types.ts"
Cohesion: 0.05
Nodes (55): formatKeysForDisplay(), ShortcutsSection(), STORY_TEMPLATES, getDefaultKeyboardShortcuts(), SHORTCUT_ACTION_REGISTRY, defaultDesktopSettings, defaultVoiceSettings, applyInitialTheme() (+47 more)

### Community 6 - "ProjectData"
Cohesion: 0.05
Nodes (54): SceneBoardViewContextType, charactersAdapter, worldsAdapter, initialState, ProjectData, ProjectSliceState, binderReducers, characterReducers (+46 more)

### Community 14 - "proForgeCapabilityLayer.ts"
Cohesion: 0.05
Nodes (54): PipelineRun, getStartupPayload(), BrowserProForgeCapabilityDeps, createBrowserProForgeCapability(), applyEditsPure(), ApplyEditsResultSummary, buildAgentContext(), PartialConfigOverrides (+46 more)
