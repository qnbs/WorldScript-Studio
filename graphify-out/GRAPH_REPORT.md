# Graph Report - StoryCraft-Studio  (2026-06-10)

## Corpus Check
- 998 files · ~1,160,450 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4475 nodes · 8039 edges · 54 communities detected
- Extraction: 77% EXTRACTED · 23% INFERRED · 0% AMBIGUOUS · INFERRED: 1870 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 134|Community 134]]
- [[_COMMUNITY_Community 164|Community 164]]
- [[_COMMUNITY_Community 204|Community 204]]
- [[_COMMUNITY_Community 237|Community 237]]
- [[_COMMUNITY_Community 242|Community 242]]

## God Nodes (most connected - your core abstractions)
1. `mt()` - 103 edges
2. `Bv` - 74 edges
3. `fn()` - 47 edges
4. `Ze()` - 43 edges
5. `wx()` - 41 edges
6. `xA` - 40 edges
7. `t()` - 40 edges
8. `CloudSyncBackend` - 39 edges
9. `StorageManager` - 36 edges
10. `tA()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `checkForUpdate()` --calls--> `update()`  [INFERRED]
  register-sw.ts → e2e-deep-report/trace/sw.bundle.js
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts
- `ViewLoader()` --calls--> `useTranslation()`  [INFERRED]
  App.tsx → hooks/useTranslation.ts
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `App()` --calls--> `useGlobalKeyboardShortcuts()`  [INFERRED]
  App.tsx → hooks/useGlobalKeyboardShortcuts.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (301): _0, _2(), A0, a2(), aA(), ac(), ad(), Ah() (+293 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (171): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+163 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (117): recordLatency(), AiInferenceCacheService, hashKey(), assertCloudAiAllowed(), assertCloudAiAllowedSync(), assertLoraLocalOnly(), _cleanupPendingRequest(), _clearPendingRequestsForTest() (+109 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (82): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), handleAddFolder() (+74 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (63): pipeline(), pipeline(), getFocusable(), onKeyDown(), onPointerUp(), handleKeyDown(), applyPreset(), async() (+55 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (35): hasMigrationMarker(), legacyDatabaseListed(), migrateLegacyStorycraftDbIfNeeded(), openLegacyDatabase(), promisifyRequest(), readAllFromStore(), setMigrationMarker(), stateDbHasProjectOrSettings() (+27 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (73): CloudSyncBackend, decryptCloudPayload(), deriveCloudSyncKey(), encryptCloudPayload(), decryptDuckDbData(), encryptDuckDbData(), initDuckDbEncryption(), translate() (+65 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (53): assertNoSeriousViolations(), AudioNavigator, navigateToCollaborationSettings(), ab(), B_(), br(), bs(), Bv (+45 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (50): item(), glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), parseArgs(), saveCheckpoint(), sleep() (+42 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (63): clampRetryAfter(), computeRetryDelayMs(), delay(), parseRetryAfterMs(), retryAfterStringToMs(), withTransientRetry(), makeContext(), makeContext() (+55 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (53): AnalyticsBootstrap(), App(), ViewLoader(), Header(), useAppDispatch(), useAppSelectorShallow(), IdbUnlockModal(), useAnnounce() (+45 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (54): generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent, handleRemoveKey() (+46 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (47): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), start(), getLastBenchmarkResults(), loadResults() (+39 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (35): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, createAttentionPipeline(), createComputePipeline(), createKvCachePipeline() (+27 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (45): check(), green(), grep(), hasRuntimeConsumption(), read(), red(), collect(), id (+37 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (42): NT, getDuckDb(), handleExec(), handleQuery(), handleShutdown(), initDuckDb(), isOPFSSupported(), duckdbCodexWrite() (+34 more)

### Community 16 - "Community 16"
Cohesion: 0.08
Nodes (20): FsAssetStore, FsCodexStore, deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), countProjectWords(), decompressData() (+12 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (27): DeadLetterQueue, openDlqDb(), storeClear(), storeGetAll(), k2, download_artifact(), get_failed_logs(), get_latest_failed_run() (+19 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (38): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+30 more)

### Community 19 - "Community 19"
Cohesion: 0.06
Nodes (26): mockT(), aE, iE, lE(), rE, sE, analyzeSentiment(), classifyWritingTopic() (+18 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (38): analyze_stryker_failure(), analyze_vitest_failure(), analyze_with_llm(), format_for_vscode(), get_openrouter_client(), main(), Send preprocessed errors to LLM for analysis., Format errors for VS Code problem matcher. (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.08
Nodes (27): generateTextSingleProvider(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok(), streamOpenAI(), streamProvider(), testAIConnection() (+19 more)

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 23 - "Community 23"
Cohesion: 0.21
Nodes (4): LS, Th(), xn(), aa

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (11): cE(), fr(), Go(), jS(), ri(), v_(), wb(), Xd (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.35
Nodes (2): cc, Gb()

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (6): buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), UsageAnalyticsService

### Community 31 - "Community 31"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 32 - "Community 32"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 36 - "Community 36"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 37 - "Community 37"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 41 - "Community 41"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 42 - "Community 42"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 44 - "Community 44"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 45 - "Community 45"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 46 - "Community 46"
Cohesion: 0.5
Nodes (1): SpeechSynthesisUtteranceMock

### Community 48 - "Community 48"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 57 - "Community 57"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 68 - "Community 68"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 75 - "Community 75"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (1): TaskError

### Community 115 - "Community 115"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 134 - "Community 134"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 164 - "Community 164"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 204 - "Community 204"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 237 - "Community 237"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 242 - "Community 242"
Cohesion: 1.0
Nodes (1): IndexedDBService

## Knowledge Gaps
- **47 isolated node(s):** `Emits JSON progress events on each training log step.`, `Remove ANSI escape codes from text.`, `Remove timestamp strings from text.`, `Replace long base64 strings with placeholder.`, `Remove NPM/pnpm warning lines.` (+42 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (17 nodes): `cc`, `._applyAttribute()`, `._assert()`, `.constructor()`, `._eof()`, `._isWhitespace()`, `._next()`, `.parse()`, `._peek()`, `._readAttributes()`, `._readIdentifier()`, `._readRegex()`, `._readString()`, `._readStringOrRegex()`, `._skipWhitespace()`, `._throwError()`, `Gb()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (4 nodes): `makeStorageMock()`, `SpeechSynthesisUtteranceMock`, `.constructor()`, `setup.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 75`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 134`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 164`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 204`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 237`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 242`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `t()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 7`, `Community 10`, `Community 11`, `Community 14`, `Community 25`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `mt()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`, `Community 11`, `Community 14`, `Community 19`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `wx()` connect `Community 0` to `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 13`, `Community 16`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Are the 86 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 86 INFERRED edges - model-reasoned connections that need verification._
- **Are the 46 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `wx()` (e.g. with `for()` and `.addEventListener()`) actually correct?**
  _`wx()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `Remove ANSI escape codes from text.`, `Remove timestamp strings from text.` to the rest of the system?**
  _47 weakly-connected nodes found - possible documentation gaps or missing edges._