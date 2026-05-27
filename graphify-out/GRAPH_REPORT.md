# Graph Report - StoryCraft-Studio  (2026-05-27)

## Corpus Check
- 778 files · ~445,740 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2193 nodes · 2652 edges · 47 communities detected
- Extraction: 75% EXTRACTED · 25% INFERRED · 0% AMBIGUOUS · INFERRED: 650 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 132|Community 132]]
- [[_COMMUNITY_Community 159|Community 159]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 49 edges
2. `IndexedDBService` - 48 edges
3. `FileSystemService` - 41 edges
4. `StorageManager` - 36 edges
5. `CloudSyncBackend` - 36 edges
6. `t()` - 32 edges
7. `retryFs()` - 31 edges
8. `fn()` - 29 edges
9. `VoiceCommandService` - 28 edges
10. `useTranslation()` - 26 edges

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
Nodes (59): assertCloudAiAllowed(), assertCloudAiAllowedSync(), binderDepth(), CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload() (+51 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (45): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), MapForm() (+37 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (45): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), handleAddFolder() (+37 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (16): FeedbackService, install_app_menu(), run(), addDebouncedListener(), main(), createSttEngine(), WebSpeechSttEngine, createTtsEngine() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (37): delay(), withTransientRetry(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), makeContext() (+29 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (11): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), compressData(), decompressData(), IndexedDBService, retryDb() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (28): _clearPendingRequestsForTest(), AnalyticsAgent, elapsed(), getMemoryBank(), requireProject(), selfReflect(), CopyEditAgent, DiagnosticAgent (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (53): _cleanupPendingRequest(), _deduplicateRequest(), generateJson(), generateText(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic() (+45 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (26): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), assertCommunityTemplates() (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (34): getLocalAiSuggestions(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), highlightSubsequence(), normalizeSearch() (+26 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (32): duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow(), queryCharacterCoOccurrence(), queryCrossProjectSearch() (+24 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (21): handler(), generateMessageId(), getWorker(), send(), getDuckDb(), initDuckDb(), isOPFSSupported(), EcoModeService (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.14
Nodes (11): compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FileSystemService, loadTauriApis() (+3 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (19): start(), handleBuildLocalRag(), handleWebllmDownload(), applyPreset(), async(), close(), openDb(), openDualDatabases() (+11 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (32): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+24 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (1): StorageManager

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (4): CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (1): loadFeatureFlagsState()

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (6): registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), setTauriMainWindowVisible(), useTauriUpdater()

### Community 24 - "Community 24"
Cohesion: 0.31
Nodes (2): AiInferenceCacheService, hashKey()

### Community 25 - "Community 25"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 26 - "Community 26"
Cohesion: 0.31
Nodes (7): handleDelete(), handleFileChange(), deleteAdapter(), getAdapterBlob(), listAdapters(), openDb(), saveAdapter()

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 28 - "Community 28"
Cohesion: 0.25
Nodes (2): makeStore(), setupStore()

### Community 30 - "Community 30"
Cohesion: 0.6
Nodes (4): deleteRevision(), getDb(), listRevisions(), saveRevision()

### Community 31 - "Community 31"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 34 - "Community 34"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 49 - "Community 49"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 70 - "Community 70"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 78 - "Community 78"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (1): PandocEpubResponse

### Community 114 - "Community 114"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 132 - "Community 132"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 159 - "Community 159"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

## Knowledge Gaps
- **9 isolated node(s):** `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel`, `MockIntersectionObserver` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (36 nodes): `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (23 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCloudSync()`, `selectEnableCodexAutoTracking()`, `selectEnableCompileWizard()`, `selectEnableCrossProjectSearch()`, `selectEnableDuckDbAnalytics()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePlotBoardV2()`, `selectEnablePluginSystem()`, `selectEnableProForge()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (11 nodes): `AiInferenceCacheService`, `.constructor()`, `.evictLru()`, `.getCachedInference()`, `.getInMemorySize()`, `.idbEvictOldest()`, `.openDb()`, `.setCachedInference()`, `.shouldSkip()`, `hashKey()`, `aiInferenceCacheService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (8 nodes): `store.ts`, `makeStore()`, `filterUndoableActions()`, `isLoggerEnabled()`, `loggerMiddleware()`, `rootReducer()`, `setupStore()`, `SaveStatusIndicator.stories.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (3 nodes): `pandoc_markdown_to_epub()`, `PandocEpubResponse`, `pandoc.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 132`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 159`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 9` to `Community 0`, `Community 2`, `Community 3`, `Community 6`, `Community 7`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 16`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 2` to `Community 1`, `Community 26`, `Community 13`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 4` to `Community 0`, `Community 12`, `Community 5`, `Community 7`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Are the 48 inferred relationships involving `push()` (e.g. with `.addEventListener()` and `.postMessage()`) actually correct?**
  _`push()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._