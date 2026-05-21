# Graph Report - StoryCraft-Studio  (2026-05-21)

## Corpus Check
- 542 files · ~353,551 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2935 nodes · 5828 edges · 38 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 1013 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 105|Community 105]]
- [[_COMMUNITY_Community 106|Community 106]]

## God Nodes (most connected - your core abstractions)
1. `push()` - 168 edges
2. `mt()` - 102 edges
3. `rv()` - 73 edges
4. `IndexedDBService` - 48 edges
5. `bA` - 41 edges
6. `FileSystemService` - 41 edges
7. `gx()` - 39 edges
8. `t()` - 39 edges
9. `wA` - 36 edges
10. `StorageManager` - 36 edges

## Surprising Connections (you probably didn't know these)
- `checkForUpdate()` --calls--> `update()`  [INFERRED]
  register-sw.ts → tests/e2e/html-report/trace/sw.bundle.js
- `withDuckDbRetry()` --calls--> `Fn()`  [INFERRED]
  services/duckdb/duckdbAnalytics.ts → tests/e2e/html-report/trace/sw.bundle.js
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (283): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+275 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (155): makeDeps(), makeStoreState(), e_(), n_(), B(), install_app_menu(), run(), main() (+147 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (64): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleBuildLocalRag(), binderDepth(), handleAddFolder(), handleAddLink() (+56 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (18): bA, Bh(), Cb(), Dh(), el(), gE(), Gy(), Lo (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (88): assertCloudAiAllowed(), assertCloudAiAllowedSync(), _cleanupPendingRequest(), _deduplicateRequest(), generateJson(), generateText(), generateTextSingleProvider(), _pendingKey() (+80 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (28): assertNoSeriousViolations(), navigateToCollaborationSettings(), DE(), f0, Jx(), kr(), La(), lb() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (60): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+52 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (47): getLocalAiSuggestions(), mockT(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), dc() (+39 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (39): create(), b2(), Bi(), br(), Cr, fc(), gA, gv() (+31 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (20): a_, Ah, Bo(), ds(), Fv(), gc(), k0(), l_ (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (23): buildKeyModuleMap(), loadBundleKeys(), loadModuleData(), compressData(), countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey() (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (47): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), useAnnounce(), MapForm() (+39 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (13): AiInferenceCacheService, hashKey(), _clearPendingRequestsForTest(), _2, E2, fr, wo(), registerTauriMenuHandler() (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (34): getFocusable(), onKeyDown(), onPointerUp(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars() (+26 more)

### Community 14 - "Community 14"
Cohesion: 0.1
Nodes (18): buildConsistencyHints(), buildEntityId(), buildRelationshipEdges(), createStoryCodexEntity(), escapeRegExpLiteral(), extractStoryCodex(), loadStoryCodex(), normalizeCandidate() (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.08
Nodes (4): compressData(), decompressData(), IndexedDBService, retryDb()

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (27): start(), handleWebllmDownload(), isCustomOllamaModel(), applyPreset(), async(), close(), handler(), hasMigrationMarker() (+19 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (4): CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 18 - "Community 18"
Cohesion: 0.15
Nodes (4): GpuResourceManager, InferenceProgressEmitter, handleCancel(), handleRetry()

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (6): minimalProject(), buildState(), createTestStore(), loadState(), minimalProjectData(), getInitialState()

### Community 20 - "Community 20"
Cohesion: 0.12
Nodes (1): loadFeatureFlagsState()

### Community 21 - "Community 21"
Cohesion: 0.16
Nodes (7): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), assertLanguageToolAllowed(), languageToolPing(), baseSettings(), applyPreset(), runLanguageToolPing()

### Community 22 - "Community 22"
Cohesion: 0.21
Nodes (8): classifyDevice(), detectIsMobile(), getBatteryLevel(), getHealthReport(), getMemoryInfo(), getStorageQuotaMb(), classifyVram(), detectWebGpuDetails()

### Community 23 - "Community 23"
Cohesion: 0.21
Nodes (2): EcoModeService, handleEcoToggle()

### Community 25 - "Community 25"
Cohesion: 0.22
Nodes (5): renderSheet(), render(), createHookWrapper(), isDispatcherAction(), isStreamGenerationThunk()

### Community 27 - "Community 27"
Cohesion: 0.43
Nodes (5): esc(), exportEpub(), exportEpubViaApi(), toParagraphs(), handleEpubExport()

### Community 31 - "Community 31"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 33 - "Community 33"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 44 - "Community 44"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): fetchCommunityTemplates(), getFallbackTemplates()

### Community 53 - "Community 53"
Cohesion: 0.83
Nodes (3): generateMessageId(), getWorker(), send()

### Community 90 - "Community 90"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 101 - "Community 101"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 105 - "Community 105"
Cohesion: 1.0
Nodes (1): MockGoogleGenAI

### Community 106 - "Community 106"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

## Knowledge Gaps
- **10 isolated node(s):** `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI`, `MockBroadcastChannel`, `MockWorker` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 20`** (17 nodes): `featureFlagsPersistenceMiddleware()`, `loadFeatureFlagsState()`, `saveFeatureFlagsState()`, `selectEnableAppHealthPanel()`, `selectEnableBinderResearch()`, `selectEnableCharacterInterviews()`, `selectEnableCodexAutoTracking()`, `selectEnableCompileWizard()`, `selectEnableCrossProjectSearch()`, `selectEnableDuckDbAnalytics()`, `selectEnableMindMaps()`, `selectEnableObjectsGroups()`, `selectEnablePlotBoardV2()`, `selectEnableProjectHealthScore()`, `selectEnableStoryBibleAdvanced()`, `selectFeatureFlags()`, `featureFlagsSlice.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (13 nodes): `GpuMetricsPanel.tsx`, `EcoModeService`, `.applyAdaptiveMode()`, `.clearExplicitEcoMode()`, `.isCriticalBattery()`, `.isEcoMode()`, `.notify()`, `.onEcoModeChange()`, `._setBatteryLevelForTest()`, `.setEcoModeExplicit()`, `deviceClassColor()`, `handleEcoToggle()`, `ecoModeService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `clearCommunityTemplateCache()`, `fetchCommunityTemplates()`, `getFallbackTemplates()`, `communityTemplateService.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 90`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 105`** (2 nodes): `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 16`, `Community 27`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 5`, `Community 11`, `Community 18`, `Community 21`, `Community 27`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `mt()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 12`, `Community 13`, `Community 14`, `Community 16`, `Community 18`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Are the 167 inferred relationships involving `push()` (e.g. with `.addEventListener()` and `.postMessage()`) actually correct?**
  _`push()` has 167 INFERRED edges - model-reasoned connections that need verification._
- **Are the 85 inferred relationships involving `mt()` (e.g. with `PE()` and `xE()`) actually correct?**
  _`mt()` has 85 INFERRED edges - model-reasoned connections that need verification._
- **What connects `MockIntersectionObserver`, `MockWorker`, `MockGoogleGenAI` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._