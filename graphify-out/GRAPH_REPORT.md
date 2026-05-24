# Graph Report - StoryCraft-Studio  (2026-05-24)

## Corpus Check
- 614 files · ~351,661 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1868 nodes · 2270 edges · 45 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 486 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 109|Community 109]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 124|Community 124]]
- [[_COMMUNITY_Community 125|Community 125]]

## God Nodes (most connected - your core abstractions)
1. `IndexedDBService` - 48 edges
2. `FileSystemService` - 41 edges
3. `push()` - 38 edges
4. `StorageManager` - 36 edges
5. `CloudSyncBackend` - 36 edges
6. `t()` - 33 edges
7. `retryFs()` - 31 edges
8. `VoiceCommandService` - 28 edges
9. `useTranslation()` - 26 edges
10. `useAppDispatch()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts
- `App()` --calls--> `usePushToTalk()`  [INFERRED]
  App.tsx → hooks/usePushToTalk.ts
- `registerServiceWorker()` --calls--> `register()`  [INFERRED]
  register-sw.ts → services/promptLibrary.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (50): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), MapForm() (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (32): CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), buildConsistencyHints(), buildEntityId(), buildRelationshipEdges() (+24 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (53): getLocalAiSuggestions(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), highlightSubsequence(), normalizeSearch() (+45 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (42): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), binderDepth() (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (15): FeedbackService, install_app_menu(), run(), main(), createSttEngine(), WebSpeechSttEngine, createTtsEngine(), WebSpeechTtsEngine (+7 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (55): assertCloudAiAllowed(), assertCloudAiAllowedSync(), _cleanupPendingRequest(), _deduplicateRequest(), generateJson(), generateText(), generateTextSingleProvider(), _pendingKey() (+47 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (22): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), assertCommunityTemplates() (+14 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (8): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), compressData(), decompressData(), IndexedDBService, retryDb()

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (11): compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FileSystemService, loadTauriApis() (+3 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (20): generateMessageId(), getWorker(), send(), getDuckDb(), handleShutdown(), initDuckDb(), isOPFSSupported(), EcoModeService (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (29): applyPreset(), async(), close(), handler(), handleEncryptedLibraryExport(), handleExportSettingsJson(), hasMigrationMarker(), legacyDatabaseListed() (+21 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (18): delay(), withTransientRetry(), renderSheet(), makeDeps(), makeStoreState(), withDuckDbRetry(), componentDidCatch(), render() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (1): StorageManager

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (23): duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow(), queryCharacterCoOccurrence(), queryCrossProjectSearch() (+15 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (4): CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (9): start(), handleBuildLocalRag(), handleWebllmDownload(), detectWebGpuSupport(), runLocalTextGeneration(), sanitizeForPrompt(), WorkerBus, generateLocalText() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (1): loadFeatureFlagsState()

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (14): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (4): GpuResourceManager, InferenceProgressEmitter, handleCancel(), handleRetry()

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (3): AiInferenceCacheService, hashKey(), _clearPendingRequestsForTest()

### Community 22 - "Community 22"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 25 - "Community 25"
Cohesion: 0.22
Nodes (6): registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), setTauriMainWindowVisible(), useTauriUpdater()

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 27 - "Community 27"
Cohesion: 0.31
Nodes (7): handleDelete(), handleFileChange(), deleteAdapter(), getAdapterBlob(), listAdapters(), openDb(), saveAdapter()

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 29 - "Community 29"
Cohesion: 0.25
Nodes (2): makeStore(), setupStore()

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (2): formatLogsForReport(), getRecentLogs()

### Community 32 - "Community 32"
Cohesion: 0.6
Nodes (4): deleteRevision(), getDb(), listRevisions(), saveRevision()

### Community 33 - "Community 33"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 36 - "Community 36"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 38 - "Community 38"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 49 - "Community 49"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 50 - "Community 50"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 78 - "Community 78"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 94 - "Community 94"
Cohesion: 0.67
Nodes (1): PandocEpubResponse

### Community 109 - "Community 109"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 120 - "Community 120"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 124 - "Community 124"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

## Knowledge Gaps
- **9 isolated node(s):** `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel`, `MockWorker` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 12`** (36 nodes): `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 16`** (22 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCloudSync()`, `selectEnableCodexAutoTracking()`, `selectEnableCompileWizard()`, `selectEnableCrossProjectSearch()`, `selectEnableDuckDbAnalytics()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePlotBoardV2()`, `selectEnablePluginSystem()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (8 nodes): `store.ts`, `makeStore()`, `filterUndoableActions()`, `isLoggerEnabled()`, `loggerMiddleware()`, `rootReducer()`, `setupStore()`, `SaveStatusIndicator.stories.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (7 nodes): `clearLogs()`, `disableDebugLogging()`, `enableDebugLogging()`, `formatLogsForReport()`, `formatMessage()`, `getRecentLogs()`, `logger.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (3 nodes): `pandoc_markdown_to_epub()`, `PandocEpubResponse`, `pandoc.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 109`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 120`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 5`, `Community 8`, `Community 9`, `Community 14`, `Community 15`, `Community 17`, `Community 31`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 0`, `Community 10`, `Community 15`, `Community 18`, `Community 27`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `StorageManager` connect `Community 12` to `Community 1`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Are the 37 inferred relationships involving `push()` (e.g. with `.addEventListener()` and `.postMessage()`) actually correct?**
  _`push()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._