# Graph Report - StoryCraft-Studio  (2026-06-02)

## Corpus Check
- 926 files · ~563,642 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2864 nodes · 3746 edges · 58 communities detected
- Extraction: 69% EXTRACTED · 31% INFERRED · 0% AMBIGUOUS · INFERRED: 1153 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 30|Community 30]]
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
- [[_COMMUNITY_Community 248|Community 248]]
- [[_COMMUNITY_Community 253|Community 253]]

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
Cohesion: 0.03
Nodes (63): AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), _deduplicateRequest(), generateText(), binderDepth(), buildConsistencyHints(), buildEntityId() (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (51): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+43 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (53): makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), createFakeAdapter(), createFakeDevice() (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (40): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), loadStoryCodex(), IdbAssetStore (+32 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (22): generateMessageId(), getWorker(), send(), EcoModeService, FeedbackService, handleEcoToggle(), MockWorker, LoraEnvReport (+14 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (44): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, handleRemoveKey() (+36 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (45): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleBuildLocalRag(), handleWebllmDownload(), handleAddFolder(), handleAddLink() (+37 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (31): createCancellationToken(), assertCommunityTemplates(), loadJson(), main(), DeadLetterQueue, openDlqDb(), storeClear(), storeGetAll() (+23 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (34): clampRetryAfter(), computeRetryDelayMs(), delay(), parseRetryAfterMs(), retryAfterStringToMs(), withTransientRetry(), buildKeyModuleMap(), loadBundleKeys() (+26 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (36): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), routeTask(), addDebouncedListener(), initAdaptiveAiOnStartup(), initWorkerBusOnStartup() (+28 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (38): pipeline(), applyPreset(), async(), close(), countWords(), enrichProjectIndex(), extractCharacterNames(), getDb() (+30 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (22): CircuitBreaker, minimalProject(), getNotifications(), handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore(), cosineSimilarity() (+14 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (29): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), pipeline(), start(), getLastBenchmarkResults() (+21 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (48): createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms(), getComputeDevice() (+40 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (40): assertCloudAiAllowed(), assertCloudAiAllowedSync(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI() (+32 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (18): CloudSyncBackend, CloudSyncClient, translate(), flushOnHidden(), eventMatchesShortcutKeys(), findMatchingShortcutAction(), flushProjectSave(), performShortcutAction() (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (28): handler(), getDuckDb(), initDuckDb(), isOPFSSupported(), MockWorker, resolveWorkerMessage(), createCancelMessage(), createPongMessage() (+20 more)

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
Cohesion: 0.08
Nodes (1): loadFeatureFlagsState()

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (17): _clearPendingRequestsForTest(), clearCommunityTemplateCache(), fetchCommunityTemplates(), getFallbackTemplates(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache() (+9 more)

### Community 24 - "Community 24"
Cohesion: 0.13
Nodes (8): esc(), exportEpub(), exportEpubViaApi(), toParagraphs(), handleEpubExport(), applyInitialTheme(), getSystemThemePreference(), PriorityTaskQueue

### Community 25 - "Community 25"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (10): formatArgs(), formatLogsForReport(), getRecentLogs(), loadTauriSink(), openLogDb(), sanitizeLogContext(), write(), writeToConsole() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 30 - "Community 30"
Cohesion: 0.19
Nodes (5): check(), green(), grep(), hasRuntimeConsumption(), red()

### Community 32 - "Community 32"
Cohesion: 0.29
Nodes (7): computeCentroid(), countWords(), extractScenePairs(), generateSyntheticPairs(), getEmbeddingService(), scoreDatasetEntries(), scoreDatasetEntry()

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (1): AudioNavigator

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

### Community 248 - "Community 248"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 253 - "Community 253"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **22 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (26 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAdaptiveAiEngine()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCompileWizard()`, `selectEnableComputeShaders()`, `selectEnableDuckDbAnalytics()`, `selectEnableIdbAtRestEncryption()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePluginSystem()`, `selectEnableProForge()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableRustCompute()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectEnableVoiceWasm()`, `selectEnableWebnnInference()`, `selectEnableWorkerBusV2()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
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
- **Thin community `Community 248`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 253`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 2` to `Community 0`, `Community 3`, `Community 5`, `Community 8`, `Community 14`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 6` to `Community 24`, `Community 1`, `Community 21`, `Community 5`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `embedText()` connect `Community 10` to `Community 0`, `Community 11`, `Community 13`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Are the 44 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 44 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._