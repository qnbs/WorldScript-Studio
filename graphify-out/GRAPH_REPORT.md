# Graph Report - StoryCraft-Studio  (2026-06-01)

## Corpus Check
- 886 files · ~544,004 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2677 nodes · 3409 edges · 58 communities detected
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 1011 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 143|Community 143]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 179|Community 179]]
- [[_COMMUNITY_Community 248|Community 248]]
- [[_COMMUNITY_Community 253|Community 253]]

## God Nodes (most connected - your core abstractions)
1. `fn()` - 41 edges
2. `StorageManager` - 36 edges
3. `CloudSyncBackend` - 36 edges
4. `t()` - 33 edges
5. `retryFs()` - 31 edges
6. `useTranslation()` - 28 edges
7. `VoiceCommandService` - 28 edges
8. `useAppDispatch()` - 25 edges
9. `CollaborationService` - 24 edges
10. `collectLibraryBackupPayload()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts
- `App()` --calls--> `usePushToTalk()`  [INFERRED]
  App.tsx → hooks/usePushToTalk.ts
- `registerServiceWorker()` --calls--> `register()`  [INFERRED]
  register-sw.ts → services/promptLibrary.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (35): handleRemoveKey(), handleSaveKey(), handleTestConnection(), CloudSyncBackend, CloudSyncClient, handleInvalidApiKey(), invalidateAiClientCache(), translate() (+27 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (64): AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), binderDepth(), buildConsistencyHints(), buildEntityId(), buildRelationshipEdges(), createStoryCodexEntity() (+56 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (24): pipeline(), deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), EcoModeService, FeedbackService, handleEcoToggle() (+16 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (50): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+42 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (51): delay(), withTransientRetry(), makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState() (+43 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (50): createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms(), getComputeDevice() (+42 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (40): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, buildAiOpts() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (45): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleAddFolder(), handleAddLink(), handleAddNote(), onImportFiles() (+37 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (37): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), assertCommunityTemplates() (+29 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (35): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), handleBuildLocalRag(), handleWebllmDownload(), getLastBenchmarkResults() (+27 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (38): duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow(), queryCharacterCoOccurrence(), queryCrossProjectSearch() (+30 more)

### Community 12 - "Community 12"
Cohesion: 0.07
Nodes (36): assertCloudAiAllowed(), assertCloudAiAllowedSync(), _deduplicateRequest(), generateText(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic() (+28 more)

### Community 13 - "Community 13"
Cohesion: 0.08
Nodes (29): decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), handleEncryptedLibraryExport(), handleExportSettingsJson(), deletePassphraseSentinel(), getPassphraseSentinel(), PassphraseSentinelStore (+21 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (2): HybridIntentEngine, StorageManager

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (26): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+18 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (5): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (11): pipeline(), start(), applyPreset(), async(), close(), handler(), openDb(), openDualDatabases() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (1): loadFeatureFlagsState()

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (17): _clearPendingRequestsForTest(), clearCommunityTemplateCache(), fetchCommunityTemplates(), getFallbackTemplates(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache() (+9 more)

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (10): handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore(), cosineSimilarity(), getEmbeddingService(), meanSimilarity(), scoreLabel() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (10): formatArgs(), formatLogsForReport(), getRecentLogs(), loadTauriSink(), openLogDb(), sanitizeLogContext(), write(), writeToConsole() (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (5): check(), green(), grep(), hasRuntimeConsumption(), red()

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (7): computeCentroid(), countWords(), extractScenePairs(), generateSyntheticPairs(), getEmbeddingService(), scoreDatasetEntries(), scoreDatasetEntry()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (6): registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), setTauriMainWindowVisible(), useTauriUpdater()

### Community 33 - "Community 33"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 34 - "Community 34"
Cohesion: 0.53
Nodes (8): abortTraining(), checkTrainingEnvironment(), generateOllamaModelfile(), isTauri(), mergeAdapter(), startTraining(), tauriInvoke(), tauriListen()

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 37 - "Community 37"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 39 - "Community 39"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 42 - "Community 42"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 43 - "Community 43"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 44 - "Community 44"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 45 - "Community 45"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 58 - "Community 58"
Cohesion: 0.5
Nodes (3): MockAudioContext, MockBufferSource, MockGain

### Community 59 - "Community 59"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 66 - "Community 66"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 71 - "Community 71"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (2): buildLcsTable(), diffTokensToOps()

### Community 80 - "Community 80"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 143 - "Community 143"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 148 - "Community 148"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 179 - "Community 179"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 248 - "Community 248"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 253 - "Community 253"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **21 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 14`** (45 nodes): `HybridIntentEngine`, `.computeSimilarity()`, `.extractNavigationSlot()`, `.findNavigationCommand()`, `.initialize()`, `.rebuildIndex()`, `.registerCommands()`, `.scoreCommand()`, `storageService.ts`, `intentEngine.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (28 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAdaptiveAiEngine()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCloudSync()`, `selectEnableCodexAutoTracking()`, `selectEnableCompileWizard()`, `selectEnableComputeShaders()`, `selectEnableCrossProjectSearch()`, `selectEnableDuckDbAnalytics()`, `selectEnableIdbAtRestEncryption()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePlotBoardV2()`, `selectEnablePluginSystem()`, `selectEnableProForge()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectEnableVoiceWasm()`, `selectEnableWebnnInference()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (4 nodes): `wordDiff.ts`, `buildLcsTable()`, `diffTokensToOps()`, `tokenizeWordsAndSpaces()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 143`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 179`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 248`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 253`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 4` to `Community 0`, `Community 1`, `Community 10`, `Community 6`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 7` to `Community 0`, `Community 3`, `Community 9`, `Community 13`, `Community 19`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `useAppDispatch()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Are the 40 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._