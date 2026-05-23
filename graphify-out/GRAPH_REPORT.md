# Graph Report - StoryCraft-Studio  (2026-05-23)

## Corpus Check
- 584 files · ~329,953 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1725 nodes · 1993 edges · 44 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 383 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 127|Community 127]]

## God Nodes (most connected - your core abstractions)
1. `IndexedDBService` - 48 edges
2. `FileSystemService` - 41 edges
3. `StorageManager` - 36 edges
4. `CloudSyncBackend` - 36 edges
5. `push()` - 34 edges
6. `t()` - 32 edges
7. `retryFs()` - 31 edges
8. `useTranslation()` - 26 edges
9. `CollaborationService` - 24 edges
10. `useAppDispatch()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts
- `WriterViewUI()` --calls--> `useSwipeGesture()`  [INFERRED]
  components/writing/WriterViewUI.tsx → hooks/useSwipeGesture.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (46): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), MapForm() (+38 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (34): assertCloudAiAllowed(), assertCloudAiAllowedSync(), CloudSyncBackend, CloudSyncClient, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), buildConsistencyHints() (+26 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (36): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), binderDepth(), handleAddFolder(), handleAddLink(), handleAddNote() (+28 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (38): handleBuildLocalRag(), handleWebllmDownload(), duckdbCodexWrite(), duckdbCrossProjectWrite(), duckdbDualWrite(), duckdbRagWrite(), esc(), execOrThrow() (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (40): _cleanupPendingRequest(), _deduplicateRequest(), generateJson(), generateText(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic() (+32 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (33): getLocalAiSuggestions(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), highlightSubsequence(), normalizeSearch() (+25 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (7): deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), compressData(), IndexedDBService, retryDb()

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (12): compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FileSystemService, loadTauriApis() (+4 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (20): generateMessageId(), getWorker(), send(), EcoModeService, handleEcoToggle(), MockWorker, getPrompt(), importPromptLibrary() (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (29): applyPreset(), async(), close(), handler(), handleEncryptedLibraryExport(), handleExportSettingsJson(), hasMigrationMarker(), legacyDatabaseListed() (+21 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (7): CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, getDuckDb(), initDuckDb(), isOPFSSupported()

### Community 11 - "Community 11"
Cohesion: 0.11
Nodes (1): StorageManager

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (16): delay(), withTransientRetry(), renderSheet(), makeDeps(), makeStoreState(), withDuckDbRetry(), render(), makeApi() (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (20): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (24): attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), handleRemoveKey(), handleSaveKey(), handleTestConnection() (+16 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (7): GpuResourceManager, InferenceProgressEmitter, install_app_menu(), run(), handleCancel(), handleRetry(), main()

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (4): AiInferenceCacheService, hashKey(), _clearPendingRequestsForTest(), PluginRegistry

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
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 25 - "Community 25"
Cohesion: 0.31
Nodes (7): handleDelete(), handleFileChange(), deleteAdapter(), getAdapterBlob(), listAdapters(), openDb(), saveAdapter()

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (2): makeStore(), setupStore()

### Community 30 - "Community 30"
Cohesion: 0.38
Nodes (4): getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars()

### Community 32 - "Community 32"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 33 - "Community 33"
Cohesion: 0.6
Nodes (4): deleteRevision(), getDb(), listRevisions(), saveRevision()

### Community 34 - "Community 34"
Cohesion: 0.67
Nodes (5): isPinnedCommand(), loadPalettePreferences(), recordRecentCommand(), savePalettePreferences(), togglePinnedCommand()

### Community 37 - "Community 37"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 39 - "Community 39"
Cohesion: 0.83
Nodes (3): assertCommunityTemplates(), loadJson(), main()

### Community 40 - "Community 40"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 59 - "Community 59"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (2): applyInitialTheme(), getSystemThemePreference()

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (1): PandocEpubResponse

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 122 - "Community 122"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 127 - "Community 127"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

## Knowledge Gaps
- **9 isolated node(s):** `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel`, `MockWorker` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 11`** (36 nodes): `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (8 nodes): `store.ts`, `makeStore()`, `filterUndoableActions()`, `isLoggerEnabled()`, `loggerMiddleware()`, `rootReducer()`, `setupStore()`, `SaveStatusIndicator.stories.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `settingsSlice.ts`, `applyInitialTheme()`, `getSystemThemePreference()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (3 nodes): `pandoc_markdown_to_epub()`, `PandocEpubResponse`, `pandoc.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 127`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 8`, `Community 10`, `Community 13`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 2` to `Community 0`, `Community 3`, `Community 9`, `Community 14`, `Community 15`, `Community 25`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 12` to `Community 6`, `Community 14`, `Community 7`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 33 inferred relationships involving `push()` (e.g. with `.addEventListener()` and `.postMessage()`) actually correct?**
  _`push()` has 33 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._