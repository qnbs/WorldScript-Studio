# Graph Report - StoryCraft-Studio  (2026-06-19)

## Corpus Check
- 1095 files · ~1,258,846 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4873 nodes · 8652 edges · 85 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 2100 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 140|Community 140]]
- [[_COMMUNITY_Community 145|Community 145]]
- [[_COMMUNITY_Community 177|Community 177]]
- [[_COMMUNITY_Community 223|Community 223]]
- [[_COMMUNITY_Community 263|Community 263]]
- [[_COMMUNITY_Community 268|Community 268]]
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
- [[_COMMUNITY_Community 732|Community 732]]

## God Nodes (most connected - your core abstractions)
1. `mt()` - 104 edges
2. `Bv` - 74 edges
3. `fn()` - 58 edges
4. `t()` - 49 edges
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
Nodes (328): md(), _0, _2(), A0, a2(), aA(), ab(), ac() (+320 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (145): applyTextEdit(), recordLatency(), AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), _clearPendingRequestsForTest(), applyReviewEditsToSection(), containsDisallowedControlChar() (+137 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (100): pipeline(), isEcoMode(), getFocusable(), onKeyDown(), onPointerUp(), handleKeyDown(), deleteIdb(), formatStorageError() (+92 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (152): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+144 more)

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (77): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), loadAgent(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel() (+69 more)

### Community 5 - "Community 5"
Cohesion: 0.01
Nodes (114): AiModeIndicator(), item(), glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs() (+106 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (35): hasMigrationMarker(), legacyDatabaseListed(), migrateLegacyWorldscriptDbIfNeeded(), openLegacyDatabase(), promisifyRequest(), readAllFromStore(), setMigrationMarker(), stateDbHasProjectOrSettings() (+27 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (68): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), CloudSyncBackend, decryptCloudPayload() (+60 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (103): getActiveAiMode(), getLocalFallbackModel(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally() (+95 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (84): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+76 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (63): makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), createFakeAdapter(), createFakeDevice() (+55 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (57): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), start(), clearBenchmarkResults(), getLastBenchmarkResults() (+49 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (58): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch(), useAppSelectorShallow() (+50 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (58): buildPaletteCommandModels(), collectAllDefinitions(), resolveTitle(), runCommandById(), assertCommunityTemplates(), loadJson(), main(), handler() (+50 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (36): pipeline(), CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, applyPreset(), async() (+28 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (37): AudioNavigator, makeProjectData(), makeContext(), makeLargeContext(), makeSection(), smallProject(), buildCharacter(), buildLargeManuscript() (+29 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (6): createCancellationToken(), releaseAllOnnxSessions(), PriorityTaskQueue, WorkerBus, shutdownWorkerBus(), WorkerPool

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (24): assertNoSeriousViolations(), navigateToCollaborationSettings(), connectSrcTokens(), group1(), tauriCsp(), webCsp(), clickNavItem(), ensureBlankProject() (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (16): mockT(), aE, iE, lE(), rE, sE, _clearInsightCache(), evictIfNeeded() (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (12): createBrowserProForgeCapability(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), createProForgeCapabilityLayer() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (7): bb(), d_, f_, h_, r0(), u_, Ze()

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 23 - "Community 23"
Cohesion: 0.23
Nodes (3): LS, xn(), aa

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (11): cE(), fr(), Go(), jS(), ri(), v_(), wb(), Xd (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (1): k2

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (15): check(), green(), grep(), hasRuntimeConsumption(), read(), red(), createOllamaModelFromAdapter(), deleteOllamaModel() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 29 - "Community 29"
Cohesion: 0.35
Nodes (2): cc, Gb()

### Community 30 - "Community 30"
Cohesion: 0.2
Nodes (14): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+6 more)

### Community 33 - "Community 33"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 35 - "Community 35"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 37 - "Community 37"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 38 - "Community 38"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 42 - "Community 42"
Cohesion: 0.4
Nodes (1): O0

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 46 - "Community 46"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 49 - "Community 49"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 50 - "Community 50"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 51 - "Community 51"
Cohesion: 0.5
Nodes (1): rc

### Community 54 - "Community 54"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 65 - "Community 65"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 66 - "Community 66"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 67 - "Community 67"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 72 - "Community 72"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 82 - "Community 82"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 93 - "Community 93"
Cohesion: 0.67
Nodes (1): TaskError

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 140 - "Community 140"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 145 - "Community 145"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 177 - "Community 177"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 223 - "Community 223"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 263 - "Community 263"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 268 - "Community 268"
Cohesion: 1.0
Nodes (1): IndexedDBService

### Community 708 - "Community 708"
Cohesion: 1.0
Nodes (1): Remove ANSI escape codes from text.

### Community 709 - "Community 709"
Cohesion: 1.0
Nodes (1): Remove timestamp strings from text.

### Community 710 - "Community 710"
Cohesion: 1.0
Nodes (1): Replace long base64 strings with placeholder.

### Community 711 - "Community 711"
Cohesion: 1.0
Nodes (1): Remove NPM/pnpm warning lines.

### Community 712 - "Community 712"
Cohesion: 1.0
Nodes (1): Remove redundant success messages.

### Community 713 - "Community 713"
Cohesion: 1.0
Nodes (1): Apply all preprocessing steps to reduce token payload.

### Community 714 - "Community 714"
Cohesion: 1.0
Nodes (1): Extract only error-related sections from log.

### Community 715 - "Community 715"
Cohesion: 1.0
Nodes (1): Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce

### Community 716 - "Community 716"
Cohesion: 1.0
Nodes (1): Structured CI error for VS Code problem matcher integration.

### Community 717 - "Community 717"
Cohesion: 1.0
Nodes (1): Vitest JSON test result structure.

### Community 718 - "Community 718"
Cohesion: 1.0
Nodes (1): Full Vitest JSON report structure.

### Community 719 - "Community 719"
Cohesion: 1.0
Nodes (1): Stryker per-file mutation report.

### Community 720 - "Community 720"
Cohesion: 1.0
Nodes (1): Full Stryker JSON report structure.

### Community 721 - "Community 721"
Cohesion: 1.0
Nodes (1): Initialize OpenRouter client for Poolside Laguna model.

### Community 722 - "Community 722"
Cohesion: 1.0
Nodes (1): Analyze Vitest JSON report and raw logs for errors.

### Community 723 - "Community 723"
Cohesion: 1.0
Nodes (1): Analyze Stryker JSON report for surviving mutants.

### Community 724 - "Community 724"
Cohesion: 1.0
Nodes (1): Send preprocessed errors to LLM for analysis.

### Community 725 - "Community 725"
Cohesion: 1.0
Nodes (1): Format errors for VS Code problem matcher.

### Community 726 - "Community 726"
Cohesion: 1.0
Nodes (1): Main entry point for CI analyzer.

### Community 727 - "Community 727"
Cohesion: 1.0
Nodes (1): Execute gh CLI command and return parsed JSON output.

### Community 728 - "Community 728"
Cohesion: 1.0
Nodes (1): Get the ID of the most recent failed CI run.

### Community 729 - "Community 729"
Cohesion: 1.0
Nodes (1): Download a specific artifact from a workflow run.

### Community 730 - "Community 730"
Cohesion: 1.0
Nodes (1): Get raw logs from a failed workflow run.

### Community 731 - "Community 731"
Cohesion: 1.0
Nodes (1): Parse Vitest JSON report for failing tests.

### Community 732 - "Community 732"
Cohesion: 1.0
Nodes (1): Parse Stryker JSON report for surviving mutants.

## Knowledge Gaps
- **53 isolated node(s):** `Emits JSON progress events on each training log step.`, `qb`, `v2`, `MockIntersectionObserver`, `MockWorker` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (27 nodes): `.fire()`, `k2`, `.checkBrowsers()`, `.clearCache()`, `.closeGracefully()`, `._dispatchEvent()`, `.findRelatedTestFiles()`, `.initialize()`, `.installBrowsers()`, `.isClosed()`, `.listFiles()`, `.listTests()`, `.open()`, `.openNoReply()`, `.ping()`, `.pingNoReply()`, `.resizeTerminal()`, `.resizeTerminalNoReply()`, `.runGlobalSetup()`, `.runGlobalTeardown()`, `.runTests()`, `._sendMessage()`, `._sendMessageNoReply()`, `.stopTests()`, `.stopTestsNoReply()`, `.watch()`, `.watchNoReply()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (17 nodes): `cc`, `._applyAttribute()`, `._assert()`, `.constructor()`, `._eof()`, `._isWhitespace()`, `._next()`, `.parse()`, `._peek()`, `._readAttributes()`, `._readIdentifier()`, `._readRegex()`, `._readString()`, `._readStringOrRegex()`, `._skipWhitespace()`, `._throwError()`, `Gb()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (5 nodes): `O0`, `.constructor()`, `.toJSON()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `rc`, `.constructor()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 72`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 82`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 140`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 145`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 177`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 223`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 263`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 268`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 708`** (1 nodes): `Remove ANSI escape codes from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 709`** (1 nodes): `Remove timestamp strings from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 710`** (1 nodes): `Replace long base64 strings with placeholder.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 711`** (1 nodes): `Remove NPM/pnpm warning lines.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 712`** (1 nodes): `Remove redundant success messages.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 713`** (1 nodes): `Apply all preprocessing steps to reduce token payload.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 714`** (1 nodes): `Extract only error-related sections from log.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 715`** (1 nodes): `Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 716`** (1 nodes): `Structured CI error for VS Code problem matcher integration.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 717`** (1 nodes): `Vitest JSON test result structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 718`** (1 nodes): `Full Vitest JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 719`** (1 nodes): `Stryker per-file mutation report.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 720`** (1 nodes): `Full Stryker JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 721`** (1 nodes): `Initialize OpenRouter client for Poolside Laguna model.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 722`** (1 nodes): `Analyze Vitest JSON report and raw logs for errors.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 723`** (1 nodes): `Analyze Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 724`** (1 nodes): `Send preprocessed errors to LLM for analysis.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 725`** (1 nodes): `Format errors for VS Code problem matcher.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 726`** (1 nodes): `Main entry point for CI analyzer.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 727`** (1 nodes): `Execute gh CLI command and return parsed JSON output.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 728`** (1 nodes): `Get the ID of the most recent failed CI run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 729`** (1 nodes): `Download a specific artifact from a workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 730`** (1 nodes): `Get raw logs from a failed workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 731`** (1 nodes): `Parse Vitest JSON report for failing tests.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 732`** (1 nodes): `Parse Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mt()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 8`, `Community 11`, `Community 15`, `Community 19`, `Community 20`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 26`, `Community 30`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `fn()` connect `Community 10` to `Community 1`, `Community 7`, `Community 8`, `Community 15`, `Community 16`, `Community 18`, `Community 20`, `Community 30`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 87 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 87 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 48 inferred relationships involving `t()` (e.g. with `.flattenForSingleProject()` and `fr()`) actually correct?**
  _`t()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `qb`, `v2` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._