# Graph Report - StoryCraft-Studio  (2026-06-19)

## Corpus Check
- 1092 files · ~1,257,509 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4867 nodes · 8646 edges · 86 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 2097 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 127|Community 127]]
- [[_COMMUNITY_Community 141|Community 141]]
- [[_COMMUNITY_Community 146|Community 146]]
- [[_COMMUNITY_Community 178|Community 178]]
- [[_COMMUNITY_Community 224|Community 224]]
- [[_COMMUNITY_Community 264|Community 264]]
- [[_COMMUNITY_Community 269|Community 269]]
- [[_COMMUNITY_Community 707|Community 707]]
- [[_COMMUNITY_Community 708|Community 708]]
- [[_COMMUNITY_Community 709|Community 709]]
- [[_COMMUNITY_Community 710|Community 710]]
- [[_COMMUNITY_Community 711|Community 711]]
- [[_COMMUNITY_Community 712|Community 712]]
- [[_COMMUNITY_Community 713|Community 713]]
- [[_COMMUNITY_Community 714|Community 714]]
- [[_COMMUNITY_Community 715|Community 715]]
- [[_COMMUNITY_Community 716|Community 716]]
- [[_COMMUNITY_Community 717|Community 717]]
- [[_COMMUNITY_Community 718|Community 718]]
- [[_COMMUNITY_Community 719|Community 719]]
- [[_COMMUNITY_Community 720|Community 720]]
- [[_COMMUNITY_Community 721|Community 721]]
- [[_COMMUNITY_Community 722|Community 722]]
- [[_COMMUNITY_Community 723|Community 723]]
- [[_COMMUNITY_Community 724|Community 724]]
- [[_COMMUNITY_Community 725|Community 725]]
- [[_COMMUNITY_Community 726|Community 726]]
- [[_COMMUNITY_Community 727|Community 727]]
- [[_COMMUNITY_Community 728|Community 728]]
- [[_COMMUNITY_Community 729|Community 729]]
- [[_COMMUNITY_Community 730|Community 730]]
- [[_COMMUNITY_Community 731|Community 731]]

## God Nodes (most connected - your core abstractions)
1. `mt()` - 104 edges
2. `Bv` - 74 edges
3. `fn()` - 58 edges
4. `t()` - 48 edges
5. `Ze()` - 43 edges
6. `wx()` - 41 edges
7. `xA` - 40 edges
8. `CloudSyncBackend` - 39 edges
9. `StorageManager` - 36 edges
10. `tA()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `getItem()` --calls--> `readMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `writeMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `enableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts
- `removeItem()` --calls--> `disableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts
- `removeItem()` --calls--> `clearBenchmarkResults()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/ai/benchmarkService.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (325): md(), _0, _2(), A0, a2(), aA(), ab(), ac() (+317 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (173): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+165 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (107): applyTextEdit(), recordLatency(), AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), _deduplicateRequest(), applyReviewEditsToSection(), containsDisallowedControlChar() (+99 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (90): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), loadAgent(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel() (+82 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (72): pipeline(), isEcoMode(), n2(), installDesktopMenu(), EcoModeService, FeedbackService, buildTimeoutSignal(), createWorldScriptFetch() (+64 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (114): getActiveAiMode(), getLocalFallbackModel(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally() (+106 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (23): a_(), bh, Dh(), eA(), el(), GE(), Gh(), lv() (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.01
Nodes (78): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+70 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (61): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), decryptCloudPayload(), deriveCloudSyncKey() (+53 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (72): AiModeIndicator(), item(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars(), loadFeatureFlagsState() (+64 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (56): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), start(), clearBenchmarkResults(), getLastBenchmarkResults() (+48 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (56): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch(), useAppSelectorShallow() (+48 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (66): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+58 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (37): _clearPendingRequestsForTest(), createCancellationToken(), clearServiceWorkerCaches(), deleteAllIndexedDBDatabases(), runWipe(), wipeAllAppData(), clearIntlCaches(), _clearInsightCache() (+29 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (28): assertNoSeriousViolations(), navigateToCollaborationSettings(), connectSrcTokens(), group1(), tauriCsp(), webCsp(), Bv, fx (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (40): assertCommunityTemplates(), loadJson(), main(), decrypt(), decryptJson(), encrypt(), encryptJson(), DeadLetterQueue (+32 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (49): check(), green(), grep(), hasRuntimeConsumption(), read(), red(), collect(), buildPaletteCommandModels() (+41 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (21): FsAssetStore, FsCodexStore, deleteIdb(), formatStorageError(), initializeStorage(), resetAllDatabases(), countProjectWords(), decompressData() (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.05
Nodes (41): glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders(), saveCheckpoint() (+33 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (22): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, createAttentionPipeline(), createComputePipeline(), createKvCachePipeline() (+14 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (28): AudioNavigator, getFocusable(), onKeyDown(), onPointerUp(), handleKeyDown(), makeProjectData(), makeContext(), makeLargeContext() (+20 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (25): pipeline(), applyPreset(), async(), close(), isSidebar(), onKey(), onPointerDown(), readMode() (+17 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (12): createBrowserProForgeCapability(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), createProForgeCapabilityLayer() (+4 more)

### Community 23 - "Community 23"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (16): smallProject(), buildCharacter(), buildLargeManuscript(), buildParagraph(), buildSectionContent(), buildWorld(), countWords(), makeRng() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.23
Nodes (3): LS, xn(), aa

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (11): cE(), fr(), Go(), jS(), ri(), v_(), wb(), Xd (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.1
Nodes (11): handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore(), cosineSimilarity(), getEmbeddingService(), meanSimilarity(), scoreLabel() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (1): k2

### Community 30 - "Community 30"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.35
Nodes (2): cc, Gb()

### Community 34 - "Community 34"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 38 - "Community 38"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 39 - "Community 39"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 43 - "Community 43"
Cohesion: 0.4
Nodes (1): O0

### Community 44 - "Community 44"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 46 - "Community 46"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 47 - "Community 47"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 50 - "Community 50"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (1): rc

### Community 55 - "Community 55"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 67 - "Community 67"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 68 - "Community 68"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 73 - "Community 73"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 78 - "Community 78"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 83 - "Community 83"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 86 - "Community 86"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 94 - "Community 94"
Cohesion: 0.67
Nodes (1): TaskError

### Community 127 - "Community 127"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 141 - "Community 141"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 146 - "Community 146"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 178 - "Community 178"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 224 - "Community 224"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 264 - "Community 264"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 269 - "Community 269"
Cohesion: 1.0
Nodes (1): IndexedDBService

### Community 707 - "Community 707"
Cohesion: 1.0
Nodes (1): Remove ANSI escape codes from text.

### Community 708 - "Community 708"
Cohesion: 1.0
Nodes (1): Remove timestamp strings from text.

### Community 709 - "Community 709"
Cohesion: 1.0
Nodes (1): Replace long base64 strings with placeholder.

### Community 710 - "Community 710"
Cohesion: 1.0
Nodes (1): Remove NPM/pnpm warning lines.

### Community 711 - "Community 711"
Cohesion: 1.0
Nodes (1): Remove redundant success messages.

### Community 712 - "Community 712"
Cohesion: 1.0
Nodes (1): Apply all preprocessing steps to reduce token payload.

### Community 713 - "Community 713"
Cohesion: 1.0
Nodes (1): Extract only error-related sections from log.

### Community 714 - "Community 714"
Cohesion: 1.0
Nodes (1): Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce

### Community 715 - "Community 715"
Cohesion: 1.0
Nodes (1): Structured CI error for VS Code problem matcher integration.

### Community 716 - "Community 716"
Cohesion: 1.0
Nodes (1): Vitest JSON test result structure.

### Community 717 - "Community 717"
Cohesion: 1.0
Nodes (1): Full Vitest JSON report structure.

### Community 718 - "Community 718"
Cohesion: 1.0
Nodes (1): Stryker per-file mutation report.

### Community 719 - "Community 719"
Cohesion: 1.0
Nodes (1): Full Stryker JSON report structure.

### Community 720 - "Community 720"
Cohesion: 1.0
Nodes (1): Initialize OpenRouter client for Poolside Laguna model.

### Community 721 - "Community 721"
Cohesion: 1.0
Nodes (1): Analyze Vitest JSON report and raw logs for errors.

### Community 722 - "Community 722"
Cohesion: 1.0
Nodes (1): Analyze Stryker JSON report for surviving mutants.

### Community 723 - "Community 723"
Cohesion: 1.0
Nodes (1): Send preprocessed errors to LLM for analysis.

### Community 724 - "Community 724"
Cohesion: 1.0
Nodes (1): Format errors for VS Code problem matcher.

### Community 725 - "Community 725"
Cohesion: 1.0
Nodes (1): Main entry point for CI analyzer.

### Community 726 - "Community 726"
Cohesion: 1.0
Nodes (1): Execute gh CLI command and return parsed JSON output.

### Community 727 - "Community 727"
Cohesion: 1.0
Nodes (1): Get the ID of the most recent failed CI run.

### Community 728 - "Community 728"
Cohesion: 1.0
Nodes (1): Download a specific artifact from a workflow run.

### Community 729 - "Community 729"
Cohesion: 1.0
Nodes (1): Get raw logs from a failed workflow run.

### Community 730 - "Community 730"
Cohesion: 1.0
Nodes (1): Parse Vitest JSON report for failing tests.

### Community 731 - "Community 731"
Cohesion: 1.0
Nodes (1): Parse Stryker JSON report for surviving mutants.

## Knowledge Gaps
- **53 isolated node(s):** `Emits JSON progress events on each training log step.`, `qb`, `v2`, `MockIntersectionObserver`, `MockWorker` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (27 nodes): `.fire()`, `k2`, `.checkBrowsers()`, `.clearCache()`, `.closeGracefully()`, `._dispatchEvent()`, `.findRelatedTestFiles()`, `.initialize()`, `.installBrowsers()`, `.isClosed()`, `.listFiles()`, `.listTests()`, `.open()`, `.openNoReply()`, `.ping()`, `.pingNoReply()`, `.resizeTerminal()`, `.resizeTerminalNoReply()`, `.runGlobalSetup()`, `.runGlobalTeardown()`, `.runTests()`, `._sendMessage()`, `._sendMessageNoReply()`, `.stopTests()`, `.stopTestsNoReply()`, `.watch()`, `.watchNoReply()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (17 nodes): `cc`, `._applyAttribute()`, `._assert()`, `.constructor()`, `._eof()`, `._isWhitespace()`, `._next()`, `.parse()`, `._peek()`, `._readAttributes()`, `._readIdentifier()`, `._readRegex()`, `._readString()`, `._readStringOrRegex()`, `._skipWhitespace()`, `._throwError()`, `Gb()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (5 nodes): `O0`, `.constructor()`, `.toJSON()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `rc`, `.constructor()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 127`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 146`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 178`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 224`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 264`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 269`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 707`** (1 nodes): `Remove ANSI escape codes from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 708`** (1 nodes): `Remove timestamp strings from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 709`** (1 nodes): `Replace long base64 strings with placeholder.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 710`** (1 nodes): `Remove NPM/pnpm warning lines.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 711`** (1 nodes): `Remove redundant success messages.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 712`** (1 nodes): `Apply all preprocessing steps to reduce token payload.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 713`** (1 nodes): `Extract only error-related sections from log.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 714`** (1 nodes): `Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 715`** (1 nodes): `Structured CI error for VS Code problem matcher integration.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 716`** (1 nodes): `Vitest JSON test result structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 717`** (1 nodes): `Full Vitest JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 718`** (1 nodes): `Stryker per-file mutation report.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 719`** (1 nodes): `Full Stryker JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 720`** (1 nodes): `Initialize OpenRouter client for Poolside Laguna model.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 721`** (1 nodes): `Analyze Vitest JSON report and raw logs for errors.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 722`** (1 nodes): `Analyze Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 723`** (1 nodes): `Send preprocessed errors to LLM for analysis.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 724`** (1 nodes): `Format errors for VS Code problem matcher.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 725`** (1 nodes): `Main entry point for CI analyzer.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 726`** (1 nodes): `Execute gh CLI command and return parsed JSON output.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 727`** (1 nodes): `Get the ID of the most recent failed CI run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 728`** (1 nodes): `Download a specific artifact from a workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 729`** (1 nodes): `Get raw logs from a failed workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 730`** (1 nodes): `Parse Vitest JSON report for failing tests.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 731`** (1 nodes): `Parse Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mt()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 10`, `Community 13`, `Community 14`, `Community 18`, `Community 20`, `Community 21`, `Community 22`, `Community 25`, `Community 26`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 16`, `Community 21`, `Community 28`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 7` to `Community 2`, `Community 5`, `Community 8`, `Community 15`, `Community 17`, `Community 20`, `Community 22`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 87 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 87 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 47 inferred relationships involving `t()` (e.g. with `.flattenForSingleProject()` and `fr()`) actually correct?**
  _`t()` has 47 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `qb`, `v2` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._