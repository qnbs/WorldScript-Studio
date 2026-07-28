# Graph Report - WorldScript-Studio  (2026-07-28)

## Corpus Check
- 1182 files · ~803,833 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3739 nodes · 4920 edges · 72 communities detected
- Extraction: 70% EXTRACTED · 30% INFERRED · 0% AMBIGUOUS · INFERRED: 1482 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 163|Community 163]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 182|Community 182]]
- [[_COMMUNITY_Community 219|Community 219]]
- [[_COMMUNITY_Community 271|Community 271]]
- [[_COMMUNITY_Community 315|Community 315]]
- [[_COMMUNITY_Community 319|Community 319]]

## God Nodes (most connected - your core abstractions)
1. `fn()` - 63 edges
2. `t()` - 42 edges
3. `CloudSyncBackend` - 39 edges
4. `StorageManager` - 36 edges
5. `useTranslation()` - 33 edges
6. `retryFs()` - 31 edges
7. `VoiceCommandService` - 30 edges
8. `useAppDispatch()` - 29 edges
9. `match()` - 27 edges
10. `getItem()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `offlineFallback()` --calls--> `match()`  [INFERRED]
  public/sw.js → tests/unit/GrammarCheckPanel.test.tsx
- `getItem()` --calls--> `readMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `writeMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `enableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts
- `removeItem()` --calls--> `disableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (125): recordLatency(), AiInferenceCacheService, hashKey(), assertCloudAiAllowed(), assertCloudAiAllowedSync(), assertLoraLocalOnly(), _clearPendingRequestsForTest(), createCancellationToken() (+117 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (60): makeContext(), makeContext(), makeDeps(), makeStoreState(), createFakeAdapter(), createFakeDevice(), makeCopilot(), makeContext() (+52 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (65): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), parseHash(), readCurrentView(), Header() (+57 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (42): loadAgent(), analyticsPersistenceAllowedNow(), isAnalyticsPersistenceAllowed(), bindAbortSignal(), setRetryFeedback(), CircuitBreaker, loadStoryCodex(), translate() (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (61): getActiveAiMode(), getLocalFallbackModel(), AnalyticsAgent, check(), extractCatalogFlags(), extractDefaultsFromSlice(), extractFlagsFromSlice(), extractHiddenFlags() (+53 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (57): glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders(), saveCheckpoint() (+49 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (57): item(), BookPreviewView(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars(), deleteIdb() (+49 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (58): collectSubtreeIds(), installDesktopMenu(), installCloseToTray(), installDesktopTray(), routeTask(), addDebouncedListener(), getLocalFirstHandle(), initAdaptiveAiOnStartup() (+50 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (39): attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), FsAssetStore (+31 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (40): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), binderDepth(), handleAddFolder(), handleAddLink(), handleAddNote() (+32 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (65): getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally(), shouldUseOpenRouter(), _cleanupPendingRequest() (+57 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (48): MockDoc, MockWebrtcProvider, releaseComputeDevice(), decrypt(), decryptJson(), encrypt(), encryptJson(), dbNameForProject() (+40 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (16): isEcoMode(), FeedbackService, ConsentRequiredError, createSttEngine(), WebSpeechSttEngine, createTtsEngine(), WebSpeechTtsEngine, createVadEngine() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (49): createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms(), getComputeDevice() (+41 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (22): CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), hasMigrationMarker(), legacyDatabaseListed(), migrateLegacyWorldscriptDbIfNeeded() (+14 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (30): pipeline(), applyPreset(), async(), close(), isSidebar(), onKey(), onPointerDown(), readMode() (+22 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (26): start(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), EcoModeService, GpuResourceManager, detectWebGpuSupport(), isAbortError() (+18 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (25): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), getDuckDb(), initDuckDb(), isOPFSSupported(), decryptDuckDbData(), encryptDuckDbData() (+17 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (39): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (17): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+9 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (30): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), clearBenchmarkResults(), getLastBenchmarkResults(), loadResults() (+22 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (13): createBrowserProForgeCapability(), buildPorts(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines() (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (16): smallProject(), buildCharacter(), buildLargeManuscript(), buildParagraph(), buildSectionContent(), buildWorld(), countWords(), makeRng() (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.1
Nodes (20): handleEncryptedLibraryExport(), handleExportSettingsJson(), createImageRegistrar(), esc(), exportEpub(), exportEpubViaApi(), renderBody(), renderLine() (+12 more)

### Community 25 - "Community 25"
Cohesion: 0.16
Nodes (23): AiModeIndicator(), isOpenRouterFreeModel(), buildHeaders(), buildMessages(), buildRequestBody(), computeBackoffMs(), delay(), _delayProvider() (+15 more)

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (15): normalize(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.16
Nodes (15): collect(), analyze_text(), count_sentences(), count_syllables(), counts_words_chars_and_spaces(), empty_text_is_all_zero(), flesch_score_is_finite_for_real_prose(), run_text_analyze() (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (9): renderSheet(), renderPanel(), componentDidCatch(), render(), renderEdges(), renderPanel(), createHookWrapper(), isDispatcherAction() (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.2
Nodes (14): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (9): applyTextEdit(), extractCodeBlock(), applyReviewEditsToSection(), containsDisallowedControlChar(), isValidRange(), nearestFreeOccurrence(), planAcceptedManuscriptEdits(), validateProposedText() (+1 more)

### Community 34 - "Community 34"
Cohesion: 0.2
Nodes (7): characterHeuristicGenerator(), outlineHeuristicGenerator(), planOutlineBeats(), plotBoardHeuristicGenerator(), clampConfidence(), makeHeuristicResult(), worldHeuristicGenerator()

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (7): assertPermission(), createDeniedConstructor(), createSandboxedRunner(), installRuntimeGuards(), normalizePluginSource(), restoreConstructor(), restoreRuntimeGuards()

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (1): PriorityTaskQueue

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (3): useManuscriptLayout(), useMediaQuery(), useResizablePanels()

### Community 40 - "Community 40"
Cohesion: 0.32
Nodes (4): clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), runWipe(), wipeAllAppData()

### Community 42 - "Community 42"
Cohesion: 0.43
Nodes (4): getTransformers(), handleInference(), loadPipeline(), runInference()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 45 - "Community 45"
Cohesion: 0.33
Nodes (3): useSwipeGesture(), useWriterLayout(), useWriterViewContext()

### Community 46 - "Community 46"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 47 - "Community 47"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 48 - "Community 48"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 53 - "Community 53"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 54 - "Community 54"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 67 - "Community 67"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 70 - "Community 70"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 73 - "Community 73"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 74 - "Community 74"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 75 - "Community 75"
Cohesion: 0.5
Nodes (2): ManuscriptDesktopLayout(), useManuscriptViewContext()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 86 - "Community 86"
Cohesion: 0.83
Nodes (3): esc(), inline(), renderExportMarkdownToHtml()

### Community 89 - "Community 89"
Cohesion: 1.0
Nodes (2): isTauriBuild(), resolveViteBase()

### Community 93 - "Community 93"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 105 - "Community 105"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 107 - "Community 107"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 111 - "Community 111"
Cohesion: 0.67
Nodes (1): FakeAudioContext

### Community 123 - "Community 123"
Cohesion: 0.67
Nodes (1): TaskError

### Community 163 - "Community 163"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 175 - "Community 175"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 182 - "Community 182"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 219 - "Community 219"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 271 - "Community 271"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 315 - "Community 315"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 319 - "Community 319"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **27 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (10 nodes): `taskQueue.ts`, `PriorityTaskQueue`, `.constructor()`, `.dequeue()`, `.effectivePriority()`, `.enqueue()`, `.peek()`, `.promoteStarvedTasks()`, `.stats()`, `.totalDepth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (4 nodes): `ManuscriptDesktopLayout.tsx`, `ManuscriptViewContext.ts`, `ManuscriptDesktopLayout()`, `useManuscriptViewContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (3 nodes): `resolveViteBase.ts`, `isTauriBuild()`, `resolveViteBase()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (3 nodes): `useMicLevel.test.ts`, `FakeAudioContext`, `resolveStream()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 163`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 175`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 182`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 219`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 271`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 315`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 319`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fn()` connect `Community 1` to `Community 0`, `Community 3`, `Community 8`, `Community 15`, `Community 21`, `Community 24`, `Community 29`, `Community 30`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 9` to `Community 2`, `Community 7`, `Community 8`, `Community 15`, `Community 16`, `Community 24`, `Community 25`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `useTranslation()` connect `Community 2` to `Community 0`, `Community 25`, `Community 6`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Are the 62 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 62 INFERRED edges - model-reasoned connections that need verification._
- **Are the 41 inferred relationships involving `t()` (e.g. with `handleSaveKey()` and `handleRemoveKey()`) actually correct?**
  _`t()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 32 inferred relationships involving `useTranslation()` (e.g. with `ViewLoader()` and `App()`) actually correct?**
  _`useTranslation()` has 32 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._