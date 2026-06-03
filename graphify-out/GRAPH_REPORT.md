# Graph Report - StoryCraft-Studio  (2026-06-03)

## Corpus Check
- 936 files · ~576,240 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2915 nodes · 3885 edges · 55 communities detected
- Extraction: 68% EXTRACTED · 32% INFERRED · 0% AMBIGUOUS · INFERRED: 1234 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 142|Community 142]]
- [[_COMMUNITY_Community 173|Community 173]]
- [[_COMMUNITY_Community 216|Community 216]]
- [[_COMMUNITY_Community 247|Community 247]]
- [[_COMMUNITY_Community 252|Community 252]]

## God Nodes (most connected - your core abstractions)
1. `fn()` - 47 edges
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
Nodes (63): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), CloudSyncBackend, CloudSyncClient (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (59): AiInferenceCacheService, hashKey(), assertCloudAiAllowed(), assertCloudAiAllowedSync(), assertLoraLocalOnly(), _cleanupPendingRequest(), _deduplicateRequest(), generateText() (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (60): clampRetryAfter(), computeRetryDelayMs(), delay(), parseRetryAfterMs(), retryAfterStringToMs(), withTransientRetry(), makeContext(), makeContext() (+52 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (51): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (54): createCancellationToken(), createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms() (+46 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (27): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), loadFeatureFlagsState() (+19 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (17): EcoModeService, FeedbackService, handleEcoToggle(), LoraEnvReport, LoraTrainPayload, train_lora(), ConsentRequiredError, createSttEngine() (+9 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (39): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, buildAiOpts() (+31 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (44): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleAddFolder(), handleAddLink(), handleAddNote(), onImportFiles() (+36 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (32): _clearPendingRequestsForTest(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache(), createTaskMessage(), detectOnnxExecutionProviders(), getCacheKey() (+24 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (27): CircuitBreaker, translate(), minimalProject(), getNotifications(), handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore() (+19 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (34): pipeline(), pipeline(), deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), routeTask(), KokoroTtsEngine (+26 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (48): handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc() (+40 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (42): generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI(), streamProvider(), testAIConnection() (+34 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (28): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), start(), getLastBenchmarkResults(), loadResults() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (36): applyPreset(), async(), close(), countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject() (+28 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (23): handler(), getDuckDb(), initDuckDb(), isOPFSSupported(), MockWorker, MockWorker, resolveWorkerMessage(), createPongMessage() (+15 more)

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (1): StorageManager

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
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (12): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+4 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (14): analyze_text(), count_sentences(), count_syllables(), counts_words_chars_and_spaces(), empty_text_is_all_zero(), flesch_score_is_finite_for_real_prose(), run_text_analyze(), RustTaskRequest (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (10): formatArgs(), formatLogsForReport(), getRecentLogs(), loadTauriSink(), openLogDb(), sanitizeLogContext(), write(), writeToConsole() (+2 more)

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 29 - "Community 29"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 30 - "Community 30"
Cohesion: 0.46
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 33 - "Community 33"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 34 - "Community 34"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 35 - "Community 35"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 39 - "Community 39"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 40 - "Community 40"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 41 - "Community 41"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 44 - "Community 44"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 66 - "Community 66"
Cohesion: 0.67
Nodes (2): buildLcsTable(), diffTokensToOps()

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 79 - "Community 79"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 95 - "Community 95"
Cohesion: 0.67
Nodes (1): TaskError

### Community 124 - "Community 124"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 137 - "Community 137"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 142 - "Community 142"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 173 - "Community 173"
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
- **26 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+21 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (4 nodes): `wordDiff.ts`, `buildLcsTable()`, `diffTokensToOps()`, `tokenizeWordsAndSpaces()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 137`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 142`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 173`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 216`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 247`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 252`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 2` to `Community 0`, `Community 1`, `Community 15`, `Community 7`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 8` to `Community 0`, `Community 3`, `Community 4`, `Community 12`, `Community 21`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `embedText()` connect `Community 16` to `Community 1`, `Community 10`, `Community 12`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 46 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _26 weakly-connected nodes found - possible documentation gaps or missing edges._