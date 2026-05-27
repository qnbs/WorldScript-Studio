# Graph Report - StoryCraft-Studio  (2026-05-28)

## Corpus Check
- 811 files · ~469,020 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2323 nodes · 2845 edges · 49 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 687 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 131|Community 131]]
- [[_COMMUNITY_Community 135|Community 135]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 164|Community 164]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 52 edges
2. `IndexedDBService` - 48 edges
3. `FileSystemService` - 41 edges
4. `StorageManager` - 36 edges
5. `CloudSyncBackend` - 36 edges
6. `t()` - 33 edges
7. `fn()` - 31 edges
8. `retryFs()` - 31 edges
9. `VoiceCommandService` - 28 edges
10. `useTranslation()` - 27 edges

## Surprising Connections (you probably didn't know these)
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts
- `App()` --calls--> `usePushToTalk()`  [INFERRED]
  App.tsx → hooks/usePushToTalk.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (69): _cleanupPendingRequest(), _deduplicateRequest(), generateText(), binderDepth(), CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey() (+61 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (52): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), selectDatasetForProject() (+44 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (49): _clearPendingRequestsForTest(), generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (44): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), handleAddFolder() (+36 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (32): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars(), assertCommunityTemplates() (+24 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (38): delay(), withTransientRetry(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), makeContext() (+30 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (15): FeedbackService, addDebouncedListener(), LoraEnvReport, LoraTrainPayload, train_lora(), ConsentRequiredError, createSttEngine(), WebSpeechSttEngine (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (11): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), compressData(), decompressData(), IndexedDBService, retryDb() (+3 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (39): getLocalAiSuggestions(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), highlightSubsequence(), normalizeSearch() (+31 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (39): handleBuildLocalRag(), handleWebllmDownload(), duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow() (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (23): handler(), generateMessageId(), getWorker(), send(), getDuckDb(), initDuckDb(), isOPFSSupported(), EcoModeService (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (11): compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FileSystemService, loadTauriApis() (+3 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (20): start(), applyPreset(), async(), close(), openDb(), openDualDatabases(), seedLegacyDatabase(), GpuResourceManager (+12 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (33): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+25 more)

### Community 14 - "Community 14"
Cohesion: 0.08
Nodes (31): assertCloudAiAllowed(), assertCloudAiAllowedSync(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI() (+23 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (1): StorageManager

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (5): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (1): loadFeatureFlagsState()

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (6): registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), setTauriMainWindowVisible(), useTauriUpdater()

### Community 25 - "Community 25"
Cohesion: 0.31
Nodes (2): AiInferenceCacheService, hashKey()

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 27 - "Community 27"
Cohesion: 0.53
Nodes (8): abortTraining(), checkTrainingEnvironment(), generateOllamaModelfile(), isTauri(), mergeAdapter(), startTraining(), tauriInvoke(), tauriListen()

### Community 28 - "Community 28"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 29 - "Community 29"
Cohesion: 0.28
Nodes (2): createWakeWordEngine(), EnergyThresholdWakeWordEngine

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (1): AudioNavigator

### Community 32 - "Community 32"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 33 - "Community 33"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 36 - "Community 36"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 38 - "Community 38"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 80 - "Community 80"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 82 - "Community 82"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (1): PandocEpubResponse

### Community 118 - "Community 118"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 131 - "Community 131"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 135 - "Community 135"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 137 - "Community 137"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 164 - "Community 164"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

## Knowledge Gaps
- **12 isolated node(s):** `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel` (+7 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 15`** (36 nodes): `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (23 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCloudSync()`, `selectEnableCodexAutoTracking()`, `selectEnableCompileWizard()`, `selectEnableCrossProjectSearch()`, `selectEnableDuckDbAnalytics()`, `selectEnableLoraAdapters()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePlotBoardV2()`, `selectEnablePluginSystem()`, `selectEnableProForge()`, `selectEnableProjectHealthScore()`, `selectEnableRtlLayout()`, `selectEnableStoryBibleAdvanced()`, `selectEnableVoiceSupport()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (11 nodes): `AiInferenceCacheService`, `.constructor()`, `.evictLru()`, `.getCachedInference()`, `.getInMemorySize()`, `.idbEvictOldest()`, `.openDb()`, `.setCachedInference()`, `.shouldSkip()`, `hashKey()`, `aiInferenceCacheService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (9 nodes): `wakeWordEngine.ts`, `createWakeWordEngine()`, `EnergyThresholdWakeWordEngine`, `.checkTranscript()`, `.dispose()`, `.initialize()`, `.isAvailable()`, `.processChunk()`, `.setPhrase()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (9 nodes): `AudioNavigator`, `.announce()`, `.focusElement()`, `.focusFirstIn()`, `.getFocusedLabel()`, `.nextLandmark()`, `.previousLandmark()`, `.scanLandmarks()`, `audioNavigator.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (3 nodes): `pandoc_markdown_to_epub()`, `PandocEpubResponse`, `pandoc.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 131`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 135`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 137`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 164`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 8` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 16`, `Community 29`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 1`, `Community 12`, `Community 9`, `Community 17`?**
  _High betweenness centrality (0.059) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 5` to `Community 0`, `Community 2`, `Community 11`, `Community 7`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 51 inferred relationships involving `push()` (e.g. with `.addEventListener()` and `.postMessage()`) actually correct?**
  _`push()` has 51 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `MockIntersectionObserver`, `MockWorker` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._