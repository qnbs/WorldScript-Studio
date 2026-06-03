# Graph Report - StoryCraft-Studio  (2026-06-03)

## Corpus Check
- 947 files · ~583,486 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2941 nodes · 3893 edges · 59 communities detected
- Extraction: 68% EXTRACTED · 32% INFERRED · 0% AMBIGUOUS · INFERRED: 1228 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 133|Community 133]]
- [[_COMMUNITY_Community 146|Community 146]]
- [[_COMMUNITY_Community 151|Community 151]]
- [[_COMMUNITY_Community 182|Community 182]]
- [[_COMMUNITY_Community 224|Community 224]]
- [[_COMMUNITY_Community 257|Community 257]]
- [[_COMMUNITY_Community 262|Community 262]]

## God Nodes (most connected - your core abstractions)
1. `fn()` - 47 edges
2. `StorageManager` - 36 edges
3. `CloudSyncBackend` - 36 edges
4. `retryFs()` - 31 edges
5. `t()` - 29 edges
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
Nodes (68): AiInferenceCacheService, hashKey(), assertCloudAiAllowed(), assertCloudAiAllowedSync(), assertLoraLocalOnly(), _cleanupPendingRequest(), _deduplicateRequest(), generateText() (+60 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (35): pipeline(), EcoModeService, FeedbackService, handleEcoToggle(), routeTask(), addDebouncedListener(), initAdaptiveAiOnStartup(), initWorkerBusOnStartup() (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (60): clampRetryAfter(), computeRetryDelayMs(), delay(), parseRetryAfterMs(), retryAfterStringToMs(), withTransientRetry(), makeContext(), makeContext() (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (48): decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), loadStoryCodex(), IdbAssetStore, IdbCodexStore, compressData(), IdbConnectionManager (+40 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (49): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+41 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (27): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), loadFeatureFlagsState() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (45): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), handleAddFolder() (+37 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (34): createCancellationToken(), createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms() (+26 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (39): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, buildAiOpts() (+31 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (46): pipeline(), applyPreset(), async(), close(), countWords(), enrichProjectIndex(), extractCharacterNames(), getDb() (+38 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (35): handler(), generateMessageId(), getWorker(), send(), getDuckDb(), initDuckDb(), isOPFSSupported(), MockWorker (+27 more)

### Community 11 - "Community 11"
Cohesion: 0.08
Nodes (20): FsAssetStore, FsCodexStore, deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), countProjectWords(), decompressData() (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (42): handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc() (+34 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (28): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), start(), getLastBenchmarkResults(), loadResults() (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (22): CircuitBreaker, translate(), getNotifications(), createOllamaModelFromAdapter(), deleteOllamaModel(), generateModelfile(), getOllamaUrl(), listOllamaAdapterModels() (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (37): generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI(), streamProvider(), streamText() (+29 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (27): _clearPendingRequestsForTest(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache(), detectOnnxExecutionProviders(), getCacheKey(), getOnnxSession() (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (21): assertCommunityTemplates(), loadJson(), main(), DeadLetterQueue, openDlqDb(), storeClear(), storeGetAll(), analyze_text() (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (5): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (19): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), detectBattery(), detectCpuCores() (+11 more)

### Community 21 - "Community 21"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.12
Nodes (8): esc(), exportEpub(), exportEpubViaApi(), toParagraphs(), handleEpubExport(), applyInitialTheme(), getSystemThemePreference(), PriorityTaskQueue

### Community 23 - "Community 23"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (12): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+4 more)

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (10): formatArgs(), formatLogsForReport(), getRecentLogs(), loadTauriSink(), openLogDb(), sanitizeLogContext(), write(), writeToConsole() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

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
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 37 - "Community 37"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 39 - "Community 39"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 46 - "Community 46"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 47 - "Community 47"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 60 - "Community 60"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 67 - "Community 67"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (2): buildLcsTable(), diffTokensToOps()

### Community 81 - "Community 81"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 86 - "Community 86"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 91 - "Community 91"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (1): TaskError

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 146 - "Community 146"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 151 - "Community 151"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 182 - "Community 182"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 224 - "Community 224"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 257 - "Community 257"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 262 - "Community 262"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **26 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+21 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 17`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (4 nodes): `wordDiff.ts`, `buildLcsTable()`, `diffTokensToOps()`, `tokenizeWordsAndSpaces()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 146`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 151`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 257`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 262`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 2` to `Community 0`, `Community 8`, `Community 11`, `Community 3`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 6` to `Community 21`, `Community 4`, `Community 12`, `Community 22`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `useTranslation()` connect `Community 4` to `Community 6`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 46 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **Are the 28 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 28 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _26 weakly-connected nodes found - possible documentation gaps or missing edges._