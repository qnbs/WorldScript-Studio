# Graph Report - StoryCraft-Studio  (2026-06-02)

## Corpus Check
- 926 files · ~564,520 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2865 nodes · 3749 edges · 58 communities detected
- Extraction: 69% EXTRACTED · 31% INFERRED · 0% AMBIGUOUS · INFERRED: 1155 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 144|Community 144]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 216|Community 216]]
- [[_COMMUNITY_Community 247|Community 247]]
- [[_COMMUNITY_Community 252|Community 252]]

## God Nodes (most connected - your core abstractions)
1. `fn()` - 45 edges
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
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts
- `App()` --calls--> `usePushToTalk()`  [INFERRED]
  App.tsx → hooks/usePushToTalk.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (63): AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), _deduplicateRequest(), generateText(), binderDepth(), CloudSyncBackend, CloudSyncClient (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (43): generateMessageId(), getWorker(), send(), EcoModeService, FeedbackService, handleEcoToggle(), routeTask(), addDebouncedListener() (+35 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (32): handleRemoveKey(), handleSaveKey(), handleTestConnection(), CircuitBreaker, loadStoryCodex(), handleInvalidApiKey(), invalidateAiClientCache(), translate() (+24 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (59): clampRetryAfter(), computeRetryDelayMs(), delay(), parseRetryAfterMs(), retryAfterStringToMs(), withTransientRetry(), makeContext(), makeContext() (+51 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (50): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (32): createCancellationToken(), assertCommunityTemplates(), loadJson(), main(), DeadLetterQueue, openDlqDb(), storeClear(), storeGetAll() (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (42): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleAddFolder(), handleAddLink(), handleAddNote(), onImportFiles() (+34 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (39): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, buildAiOpts() (+31 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (52): handleBuildLocalRag(), handleWebllmDownload(), createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline() (+44 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (27): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), HybridIntentEngine (+19 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (39): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), start(), getLastBenchmarkResults(), loadResults() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (20): FsAssetStore, FsCodexStore, deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), countProjectWords(), decompressData() (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (27): decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider (+19 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (28): handler(), getDuckDb(), initDuckDb(), isOPFSSupported(), MockWorker, MockWorker, resolveWorkerMessage(), createCancelMessage() (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (34): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+26 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (31): assertCloudAiAllowed(), assertCloudAiAllowedSync(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI() (+23 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (23): _clearPendingRequestsForTest(), clearCommunityTemplateCache(), fetchCommunityTemplates(), getFallbackTemplates(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache() (+15 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (14): pipeline(), pipeline(), applyPreset(), async(), close(), openDb(), openDualDatabases(), seedLegacyDatabase() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (25): check(), green(), grep(), hasRuntimeConsumption(), read(), red(), formatArgs(), formatLogsForReport() (+17 more)

### Community 19 - "Community 19"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (14): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), IdbProjectStore, normalizePersistedSettings(), getDefaultKeyboardShortcuts(), baseSettings(), computeCentroid() (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (1): loadFeatureFlagsState()

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (8): esc(), exportEpub(), exportEpubViaApi(), toParagraphs(), handleEpubExport(), applyInitialTheme(), getSystemThemePreference(), PriorityTaskQueue

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (12): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 31 - "Community 31"
Cohesion: 0.53
Nodes (8): abortTraining(), checkTrainingEnvironment(), generateOllamaModelfile(), isTauri(), mergeAdapter(), startTraining(), tauriInvoke(), tauriListen()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 33 - "Community 33"
Cohesion: 0.46
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 35 - "Community 35"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 36 - "Community 36"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 37 - "Community 37"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 40 - "Community 40"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 41 - "Community 41"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 42 - "Community 42"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 46 - "Community 46"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (3): MockAudioContext, MockBufferSource, MockGain

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 69 - "Community 69"
Cohesion: 0.67
Nodes (2): buildLcsTable(), diffTokensToOps()

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (1): TaskError

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 139 - "Community 139"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 144 - "Community 144"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 175 - "Community 175"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 216 - "Community 216"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 247 - "Community 247"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 252 - "Community 252"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **22 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 19`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (26 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAdaptiveAiEngine()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCompileWizard()`, `selectEnableComputeShaders()`, `selectEnableDuckDbAnalytics()`, `selectEnableIdbAtRestEncryption()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePluginSystem()`, `selectEnableProForge()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableRustCompute()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectEnableVoiceWasm()`, `selectEnableWebnnInference()`, `selectEnableWorkerBusV2()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (4 nodes): `wordDiff.ts`, `buildLcsTable()`, `diffTokensToOps()`, `tokenizeWordsAndSpaces()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 139`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 144`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 216`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 247`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 252`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 3` to `Community 0`, `Community 2`, `Community 11`, `Community 7`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 6` to `Community 2`, `Community 4`, `Community 8`, `Community 21`, `Community 23`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `embedText()` connect `Community 14` to `Community 8`, `Community 0`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 44 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 44 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._