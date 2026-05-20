# Graph Report - StoryCraft-Studio  (2026-05-20)

## Corpus Check
- 473 files · ~283,889 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1441 nodes · 1675 edges · 44 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 284 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 116|Community 116]]

## God Nodes (most connected - your core abstractions)
1. `IndexedDBService` - 48 edges
2. `FileSystemService` - 41 edges
3. `StorageManager` - 36 edges
4. `t()` - 30 edges
5. `retryFs()` - 30 edges
6. `push()` - 29 edges
7. `useTranslation()` - 21 edges
8. `useAppDispatch()` - 19 edges
9. `CollaborationService` - 19 edges
10. `sanitizePathSegment()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useAnnounce()`  [INFERRED]
  App.tsx → contexts/LiveRegionContext.tsx
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (33): App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), TensionCurvePanel(), ToastDemo() (+25 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (31): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), handleAddFolder() (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (18): testAIConnection(), handleBuildLocalRag(), handleWebllmDownload(), flushOnHidden(), collectLibraryBackupPayload(), chunkSection(), hashEmbedText(), rebuildLocalRagIndex() (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (38): getLocalAiSuggestions(), buildConsistencyHints(), buildEntityId(), buildRelationshipEdges(), createStoryCodexEntity(), escapeRegExpLiteral(), extractStoryCodex(), loadStoryCodex() (+30 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (12): compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FileSystemService, loadTauriApis() (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (21): generateMessageId(), getWorker(), send(), getDuckDb(), handleShutdown(), initDuckDb(), isOPFSSupported(), EcoModeService (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (3): compressData(), IndexedDBService, retryDb()

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (33): assertCloudAiAllowed(), assertCloudAiAllowedSync(), _cleanupPendingRequest(), _deduplicateRequest(), generateText(), generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse() (+25 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (34): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+26 more)

### Community 9 - "Community 9"
Cohesion: 0.1
Nodes (4): CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (18): applyPreset(), async(), close(), handler(), hasMigrationMarker(), legacyDatabaseListed(), migrateLegacyStorycraftDbIfNeeded(), openLegacyDatabase() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (21): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), analyzeAsCritic(), assertOnline() (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (8): create(), start(), detectWebGpuSupport(), runLocalTextGeneration(), sanitizeForPrompt(), WorkerBus, generateLocalText(), getLocalWorkerBusTelemetry()

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (4): AiInferenceCacheService, hashKey(), _clearPendingRequestsForTest(), PluginRegistry

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (4): GpuResourceManager, InferenceProgressEmitter, handleCancel(), handleRetry()

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 16 - "Community 16"
Cohesion: 0.16
Nodes (11): navigateToCollaborationSettings(), clickNavItem(), ensureBlankProject(), flushWriterDebounce(), seedGeminiApiKey(), selectFirstEnabledWriterSection(), waitForMainChrome(), waitForSpaReady() (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.2
Nodes (11): handleEncryptedLibraryExport(), handleExportSettingsJson(), base64ToBytes(), buildEncryptedLibraryZipBlob(), bytesToBase64(), copyToFixedBuffer(), decryptLibraryInnerBytes(), decryptLibraryZipBlob() (+3 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (7): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), assertLanguageToolAllowed(), languageToolPing(), baseSettings(), applyPreset(), runLanguageToolPing()

### Community 20 - "Community 20"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (6): eventMatchesShortcutKeys(), findMatchingShortcutAction(), flushProjectSave(), performShortcutAction(), normalizeSaveProjectInputToStoryProject(), saveEnvelopeFromProjectData()

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (1): computeStreak()

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (5): renderSheet(), render(), createHookWrapper(), isDispatcherAction(), isStreamGenerationThunk()

### Community 26 - "Community 26"
Cohesion: 0.32
Nodes (5): parseHash(), readCurrentView(), isValidView(), readInitialView(), useApp()

### Community 29 - "Community 29"
Cohesion: 0.38
Nodes (4): getLocalUser(), getRandomColor(), sanitizeRoomInput(), stripControlChars()

### Community 31 - "Community 31"
Cohesion: 0.43
Nodes (5): esc(), exportEpub(), exportEpubViaApi(), toParagraphs(), handleEpubExport()

### Community 35 - "Community 35"
Cohesion: 0.4
Nodes (2): getFocusable(), onKeyDown()

### Community 36 - "Community 36"
Cohesion: 0.6
Nodes (4): deleteRevision(), getDb(), listRevisions(), saveRevision()

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (5): isPinnedCommand(), loadPalettePreferences(), recordRecentCommand(), savePalettePreferences(), togglePinnedCommand()

### Community 39 - "Community 39"
Cohesion: 0.6
Nodes (3): getTransformers(), loadPipeline(), runInference()

### Community 40 - "Community 40"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 41 - "Community 41"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 42 - "Community 42"
Cohesion: 0.83
Nodes (3): assertCommunityTemplates(), loadJson(), main()

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (2): getFocusable(), handleTabKey()

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (2): applyInitialTheme(), getSystemThemePreference()

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (2): fireSwipe(), makePointerEvent()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (1): PandocEpubResponse

### Community 100 - "Community 100"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 115 - "Community 115"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 116 - "Community 116"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

## Knowledge Gaps
- **6 isolated node(s):** `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel`, `MockWorker` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (11 nodes): `progressTrackerSlice.ts`, `computeStreak()`, `loadState()`, `progressTrackerPersistenceMiddleware()`, `selectActiveSession()`, `selectDailyGoal()`, `selectLongestStreak()`, `selectProgressTracker()`, `selectStreakDays()`, `selectTotalWordsAllTime()`, `selectWeeklyGoal()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (6 nodes): `getFocusable()`, `onKeyDown()`, `onPointerDown()`, `onPointerMove()`, `onPointerUp()`, `BottomSheet.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (4 nodes): `Drawer.tsx`, `getFocusable()`, `handleEsc()`, `handleTabKey()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (3 nodes): `settingsSlice.ts`, `applyInitialTheme()`, `getSystemThemePreference()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `useSwipeGesture.test.ts`, `fireSwipe()`, `makePointerEvent()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `pandoc_markdown_to_epub()`, `PandocEpubResponse`, `pandoc.rs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 116`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 7`, `Community 8`, `Community 12`, `Community 31`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 1` to `Community 0`, `Community 2`, `Community 14`, `Community 17`, `Community 19`, `Community 31`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `rebuildHybridRagIndex()` connect `Community 2` to `Community 8`, `Community 3`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 29 inferred relationships involving `t()` (e.g. with `useHelpView()` and `handleSaveKey()`) actually correct?**
  _`t()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._