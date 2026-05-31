# Graph Report - StoryCraft-Studio  (2026-05-31)

## Corpus Check
- 880 files · ~527,740 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2640 nodes · 3343 edges · 54 communities detected
- Extraction: 71% EXTRACTED · 29% INFERRED · 0% AMBIGUOUS · INFERRED: 984 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 144|Community 144]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 244|Community 244]]
- [[_COMMUNITY_Community 249|Community 249]]

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
Nodes (67): AiInferenceCacheService, hashKey(), binderDepth(), CloudSyncBackend, CloudSyncClient, buildConsistencyHints(), buildEntityId(), buildRelationshipEdges() (+59 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (52): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+44 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (51): delay(), withTransientRetry(), makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState() (+43 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (18): pipeline(), EcoModeService, FeedbackService, handleEcoToggle(), addDebouncedListener(), ConsentRequiredError, createSttEngine(), WebSpeechSttEngine (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (31): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), assertCommunityTemplates() (+23 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (47): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleAddFolder(), handleAddLink(), handleAddNote(), onImportFiles() (+39 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (40): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, buildAiOpts() (+32 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (51): applyPreset(), async(), close(), countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject() (+43 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (21): handleRemoveKey(), handleSaveKey(), handleTestConnection(), loadStoryCodex(), deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases() (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (47): decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), decrypt(), decryptJson(), encrypt(), encryptJson(), deletePassphraseSentinel() (+39 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (42): assertCloudAiAllowed(), assertCloudAiAllowedSync(), _cleanupPendingRequest(), _deduplicateRequest(), generateText(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse() (+34 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (41): handleBuildLocalRag(), handleWebllmDownload(), duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow() (+33 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (17): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, createAttentionPipeline(), createComputePipeline(), createKvCachePipeline() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (29): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), recordLatency(), selectModelForBackend(), getLastBenchmarkResults(), loadResults(), runAllBenchmarks() (+21 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (2): HybridIntentEngine, StorageManager

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (25): check(), green(), grep(), hasRuntimeConsumption(), read(), red(), formatArgs(), formatLogsForReport() (+17 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (22): _clearPendingRequestsForTest(), clearCommunityTemplateCache(), fetchCommunityTemplates(), getFallbackTemplates(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), wipeAllAppData(), clearEmbeddingCache() (+14 more)

### Community 18 - "Community 18"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (10): handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore(), cosineSimilarity(), getEmbeddingService(), meanSimilarity(), scoreLabel() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 22 - "Community 22"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (7): computeCentroid(), countWords(), extractScenePairs(), generateSyntheticPairs(), getEmbeddingService(), scoreDatasetEntries(), scoreDatasetEntry()

### Community 27 - "Community 27"
Cohesion: 0.22
Nodes (6): registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), setTauriMainWindowVisible(), useTauriUpdater()

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 29 - "Community 29"
Cohesion: 0.53
Nodes (8): abortTraining(), checkTrainingEnvironment(), generateOllamaModelfile(), isTauri(), mergeAdapter(), startTraining(), tauriInvoke(), tauriListen()

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 31 - "Community 31"
Cohesion: 0.46
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 33 - "Community 33"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 34 - "Community 34"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (1): SileroVadEngine

### Community 36 - "Community 36"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 39 - "Community 39"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 40 - "Community 40"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 67 - "Community 67"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (2): buildLcsTable(), diffTokensToOps()

### Community 76 - "Community 76"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 81 - "Community 81"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 87 - "Community 87"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

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

### Community 244 - "Community 244"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 249 - "Community 249"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **18 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+13 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (45 nodes): `HybridIntentEngine`, `.computeSimilarity()`, `.extractNavigationSlot()`, `.findNavigationCommand()`, `.initialize()`, `.rebuildIndex()`, `.registerCommands()`, `.scoreCommand()`, `storageService.ts`, `intentEngine.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (6 nodes): `sileroVadEngine.ts`, `SileroVadEngine`, `.dispose()`, `.initialize()`, `.isAvailable()`, `.processChunk()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `wordDiff.ts`, `buildLcsTable()`, `diffTokensToOps()`, `tokenizeWordsAndSpaces()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 139`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 144`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 244`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 249`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 2` to `Community 0`, `Community 8`, `Community 12`, `Community 6`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 5` to `Community 8`, `Community 1`, `Community 18`, `Community 11`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `retryDb()` connect `Community 8` to `Community 0`, `Community 2`, `Community 10`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 40 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `retryFs()` (e.g. with `.saveProject()` and `.loadProject()`) actually correct?**
  _`retryFs()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _18 weakly-connected nodes found - possible documentation gaps or missing edges._