# Graph Report - WorldScript-Studio  (2026-08-01)

## Corpus Check
- 1200 files · ~884,131 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 7558 nodes · 14036 edges · 57 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 1998 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 155|Community 155]]
- [[_COMMUNITY_Community 190|Community 190]]
- [[_COMMUNITY_Community 241|Community 241]]
- [[_COMMUNITY_Community 282|Community 282]]
- [[_COMMUNITY_Community 285|Community 285]]

## God Nodes (most connected - your core abstractions)
1. `slice()` - 148 edges
2. `readInt32()` - 80 edges
3. `readInt32()` - 80 edges
4. `fn()` - 69 edges
5. `concat()` - 66 edges
6. `concat()` - 66 edges
7. `position()` - 61 edges
8. `position()` - 61 edges
9. `set()` - 60 edges
10. `set()` - 60 edges

## Surprising Connections (you probably didn't know these)
- `useTranslation()` --calls--> `IdbUnlockModal()`  [INFERRED]
  hooks/useTranslation.ts → components/settings/IdbUnlockModal.tsx
- `isFormat()` --calls--> `includes()`  [INFERRED]
  hooks/useExportView.ts → public/duckdb/duckdb-browser-eh.worker.js
- `toSnapshot()` --calls--> `values()`  [INFERRED]
  hooks/useGlobalCopilot.ts → public/duckdb/duckdb-browser-eh.worker.js
- `offlineFallback()` --calls--> `match()`  [INFERRED]
  public/sw.js → tests/unit/GrammarCheckPanel.test.tsx
- `applyMatchReplacement()` --calls--> `slice()`  [INFERRED]
  services/languageToolService.ts → public/duckdb/duckdb-browser-eh.worker.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.0
Nodes (893): cn(), fromDOMStream(), fromIterable(), getVisitFnByTypeId(), Jn(), pn(), a(), Aa() (+885 more)

### Community 1 - "Community 1"
Cohesion: 0.0
Nodes (949): a(), Aa(), abort(), ac(), accept(), Ad(), addBitWidth(), addBodyLength() (+941 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (250): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), recordLatency(), selectModelForBackend(), AiInferenceCacheService, hashKey() (+242 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (93): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+85 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (104): FsAssetStore, glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders() (+96 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (105): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), handleRemoveKey(), handleSaveKey() (+97 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (69): pipeline(), isEcoMode(), applyPreset(), async(), close(), isSidebar(), onKey(), onPointerDown() (+61 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (114): applyTextEdit(), extractCodeBlock(), backendBadgeClass(), isLocalInferenceProvider(), isOrchestrationReadyProvider(), start(), getLocalAiSuggestions(), normalize() (+106 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (135): AiModeIndicator(), getActiveAiMode(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally() (+127 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (85): getLocalFallbackModel(), AnalyticsAgent, check(), extractCatalogFlags(), extractDedicatedUiFlags(), extractDefaultsFromSlice(), extractFlagsFromSlice(), extractHiddenFlags() (+77 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (147): $(), asUint8Array(), bitWidth(), bodyLength(), buffers(), buffersLength(), bytes(), byteWidth() (+139 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (140): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), $(), bitWidth(), bodyLength(), buffers() (+132 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (76): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), binderDepth(), handleAddFolder(), handleAddLink(), handleAddNote() (+68 more)

### Community 13 - "Community 13"
Cohesion: 0.02
Nodes (62): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch(), useAppSelectorShallow() (+54 more)

### Community 14 - "Community 14"
Cohesion: 0.02
Nodes (46): item(), clearBenchmarkResults(), BookPreviewView(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars() (+38 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (98): __Unwind_RaiseException(), analyzePath(), calculateAt(), chdir(), chmod(), chown(), createDefaultDevices(), createDefaultDirectories() (+90 more)

### Community 16 - "Community 16"
Cohesion: 0.03
Nodes (39): loadAgent(), analyticsPersistenceAllowedNow(), isAnalyticsPersistenceAllowed(), CircuitBreaker, navigateToCollaborationSettings(), _rotozoomSurface(), clickNavItem(), ensureBlankProject() (+31 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (32): _emscripten_enter_soft_fullscreen(), _glutInit(), _emscripten_enter_soft_fullscreen(), _glutInit(), EcoModeService, GpuResourceManager, detectWebGpuSupport(), isAbortError() (+24 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (15): CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), hasMigrationMarker(), legacyDatabaseListed(), migrateLegacyWorldscriptDbIfNeeded() (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (25): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, createAttentionBuffers(), createAttentionPipeline(), createComputePipeline() (+17 more)

### Community 20 - "Community 20"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (16): smallProject(), buildCharacter(), buildLargeManuscript(), buildParagraph(), buildSectionContent(), buildWorld(), countWords(), makeRng() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (19): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), detectBattery(), detectCpuCores() (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (7): characterHeuristicGenerator(), outlineHeuristicGenerator(), planOutlineBeats(), plotBoardHeuristicGenerator(), clampConfidence(), makeHeuristicResult(), worldHeuristicGenerator()

### Community 25 - "Community 25"
Cohesion: 0.29
Nodes (1): PriorityTaskQueue

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (3): useManuscriptLayout(), useMediaQuery(), useResizablePanels()

### Community 27 - "Community 27"
Cohesion: 0.32
Nodes (4): clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), runWipe(), wipeAllAppData()

### Community 29 - "Community 29"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (3): useSwipeGesture(), useWriterLayout(), useWriterViewContext()

### Community 32 - "Community 32"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 33 - "Community 33"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 38 - "Community 38"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 39 - "Community 39"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (1): makeBuffer()

### Community 47 - "Community 47"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 58 - "Community 58"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 59 - "Community 59"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 60 - "Community 60"
Cohesion: 0.5
Nodes (2): ManuscriptDesktopLayout(), useManuscriptViewContext()

### Community 61 - "Community 61"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 69 - "Community 69"
Cohesion: 0.83
Nodes (3): esc(), inline(), renderExportMarkdownToHtml()

### Community 72 - "Community 72"
Cohesion: 1.0
Nodes (2): isTauriBuild(), resolveViteBase()

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 86 - "Community 86"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 88 - "Community 88"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 92 - "Community 92"
Cohesion: 0.67
Nodes (1): FakeAudioContext

### Community 104 - "Community 104"
Cohesion: 0.67
Nodes (1): TaskError

### Community 138 - "Community 138"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 155 - "Community 155"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 190 - "Community 190"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 241 - "Community 241"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 282 - "Community 282"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 285 - "Community 285"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **27 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockWorker`, `MockIntersectionObserver`, `MockGoogleGenAI`, `MockBroadcastChannel` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (10 nodes): `taskQueue.ts`, `PriorityTaskQueue`, `.constructor()`, `.dequeue()`, `.effectivePriority()`, `.enqueue()`, `.peek()`, `.promoteStarvedTasks()`, `.stats()`, `.totalDepth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (4 nodes): `createBinderFakeStore()`, `makeBuffer()`, `makeMeta()`, `dbServiceBinder.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (4 nodes): `ManuscriptDesktopLayout.tsx`, `ManuscriptViewContext.ts`, `ManuscriptDesktopLayout()`, `useManuscriptViewContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (3 nodes): `resolveViteBase.ts`, `isTauriBuild()`, `resolveViteBase()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (3 nodes): `useMicLevel.test.ts`, `FakeAudioContext`, `resolveStream()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 138`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 155`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 190`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 241`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 282`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 285`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `slice()` connect `Community 7` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 8`, `Community 9`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 21`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `from()` connect `Community 2` to `Community 0`, `Community 1`, `Community 4`, `Community 5`, `Community 7`, `Community 9`, `Community 12`, `Community 17`, `Community 18`, `Community 19`, `Community 21`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 3` to `Community 8`, `Community 2`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 118 inferred relationships involving `slice()` (e.g. with `sanitizeSpeechTranscript()` and `useProgressTrackerView()`) actually correct?**
  _`slice()` has 118 INFERRED edges - model-reasoned connections that need verification._
- **Are the 68 inferred relationships involving `fn()` (e.g. with `makeCtx()` and `makeCtx()`) actually correct?**
  _`fn()` has 68 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockWorker`, `MockIntersectionObserver` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0 - nodes in this community are weakly interconnected._