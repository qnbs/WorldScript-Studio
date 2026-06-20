# Graph Report - StoryCraft-Studio  (2026-06-17)

## Corpus Check
- 1092 files · ~1,256,969 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4869 nodes · 8647 edges · 87 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 2090 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 143|Community 143]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 180|Community 180]]
- [[_COMMUNITY_Community 226|Community 226]]
- [[_COMMUNITY_Community 266|Community 266]]
- [[_COMMUNITY_Community 271|Community 271]]
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
- [[_COMMUNITY_Community 733|Community 733]]

## God Nodes (most connected - your core abstractions)
1. `mt()` - 104 edges
2. `Bv` - 74 edges
3. `fn()` - 58 edges
4. `t()` - 47 edges
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
- `removeItem()` --calls--> `clearBenchmarkResults()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/ai/benchmarkService.ts
- `Ja()` --calls--> `matches()`  [INFERRED]
  e2e-deep-report/trace/assets/codeMirrorModule-Ds_H_9Yq.js → tests/unit/ai/localModelStorageService.test.ts
- `handleWebllmDownload()` --calls--> `generateLocalText()`  [INFERRED]
  components/settings/AiSections.tsx → services/localAiFacade.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (325): md(), _0, _2(), A0, a2(), aA(), ab(), ac() (+317 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (175): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+167 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (128): applyTextEdit(), recordLatency(), AiInferenceCacheService, hashKey(), _cleanupPendingRequest(), _clearPendingRequestsForTest(), applyReviewEditsToSection(), containsDisallowedControlChar() (+120 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (83): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), loadAgent(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel() (+75 more)

### Community 4 - "Community 4"
Cohesion: 0.01
Nodes (112): item(), glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders() (+104 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (61): pipeline(), pipeline(), isEcoMode(), n2(), EcoModeService, FeedbackService, buildTimeoutSignal(), createWorldScriptFetch() (+53 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (25): a_(), bh, Dh(), eA(), el(), GE(), Gh(), iE (+17 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (63): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), handleRemoveKey(), handleSaveKey(), handleTestConnection(), CloudSyncBackend, decryptCloudPayload() (+55 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (81): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+73 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (64): makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), createFakeAdapter(), createFakeDevice() (+56 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (58): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch(), useAppSelectorShallow() (+50 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (56): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), start(), clearBenchmarkResults(), getLastBenchmarkResults() (+48 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (65): getActiveAiMode(), getLocalFallbackModel(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally() (+57 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (71): AiModeIndicator(), assertCloudAiAllowed(), _deduplicateRequest(), generateTextSingleProvider(), isAbortError(), _pendingKey(), streamAiHelpResponse(), streamAnthropic() (+63 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (28): assertNoSeriousViolations(), navigateToCollaborationSettings(), connectSrcTokens(), group1(), tauriCsp(), webCsp(), Bv, fx (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (38): createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers(), createSimilarityPipeline(), encodeSimilarityUniforms(), getComputeDevice() (+30 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (16): FsAssetStore, FsCodexStore, countProjectWords(), decompressData(), decryptText(), deriveFileSystemCryptoKey(), encryptText(), FsCore (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (29): AudioNavigator, getFocusable(), onKeyDown(), onPointerUp(), handleKeyDown(), makeProjectData(), makeContext(), makeLargeContext() (+21 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (34): collect(), buildPaletteCommandModels(), collectAllDefinitions(), resolveTitle(), runCommandById(), id, install_app_menu(), run() (+26 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (12): k2, routeTask(), analyzeTextViaRust(), registerTauriMenuHandler(), getTauriAppVersion(), isTauriRuntime(), openTauriDataDirectory(), invokeRustTask() (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (29): applyPreset(), async(), close(), isSidebar(), onKey(), onPointerDown(), readMode(), writeMode() (+21 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (12): createBrowserProForgeCapability(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines(), createProForgeCapabilityLayer() (+4 more)

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (16): smallProject(), buildCharacter(), buildLargeManuscript(), buildParagraph(), buildSectionContent(), buildWorld(), countWords(), makeRng() (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (5): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider

### Community 25 - "Community 25"
Cohesion: 0.1
Nodes (23): collectSubtreeIds(), formatArgs(), formatLogsForReport(), getRecentLogs(), loadTauriSink(), newCorrelationId(), openLogDb(), sanitizeLogContext() (+15 more)

### Community 26 - "Community 26"
Cohesion: 0.23
Nodes (3): LS, xn(), aa

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (11): cE(), fr(), Go(), jS(), ri(), v_(), wb(), Xd (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 29 - "Community 29"
Cohesion: 0.16
Nodes (14): buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery(), subsequenceScore() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.35
Nodes (2): cc, Gb()

### Community 31 - "Community 31"
Cohesion: 0.2
Nodes (14): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+6 more)

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (1): PriorityTaskQueue

### Community 35 - "Community 35"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 39 - "Community 39"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 40 - "Community 40"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (1): O0

### Community 45 - "Community 45"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 47 - "Community 47"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 48 - "Community 48"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 51 - "Community 51"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): sanitizeSpeechTranscript(), stripControlChars()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (1): rc

### Community 56 - "Community 56"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 61 - "Community 61"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 67 - "Community 67"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 68 - "Community 68"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 74 - "Community 74"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 79 - "Community 79"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 87 - "Community 87"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 96 - "Community 96"
Cohesion: 0.67
Nodes (1): TaskError

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 143 - "Community 143"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 148 - "Community 148"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 180 - "Community 180"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 226 - "Community 226"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 266 - "Community 266"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 271 - "Community 271"
Cohesion: 1.0
Nodes (1): IndexedDBService

### Community 709 - "Community 709"
Cohesion: 1.0
Nodes (1): Remove ANSI escape codes from text.

### Community 710 - "Community 710"
Cohesion: 1.0
Nodes (1): Remove timestamp strings from text.

### Community 711 - "Community 711"
Cohesion: 1.0
Nodes (1): Replace long base64 strings with placeholder.

### Community 712 - "Community 712"
Cohesion: 1.0
Nodes (1): Remove NPM/pnpm warning lines.

### Community 713 - "Community 713"
Cohesion: 1.0
Nodes (1): Remove redundant success messages.

### Community 714 - "Community 714"
Cohesion: 1.0
Nodes (1): Apply all preprocessing steps to reduce token payload.

### Community 715 - "Community 715"
Cohesion: 1.0
Nodes (1): Extract only error-related sections from log.

### Community 716 - "Community 716"
Cohesion: 1.0
Nodes (1): Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce

### Community 717 - "Community 717"
Cohesion: 1.0
Nodes (1): Structured CI error for VS Code problem matcher integration.

### Community 718 - "Community 718"
Cohesion: 1.0
Nodes (1): Vitest JSON test result structure.

### Community 719 - "Community 719"
Cohesion: 1.0
Nodes (1): Full Vitest JSON report structure.

### Community 720 - "Community 720"
Cohesion: 1.0
Nodes (1): Stryker per-file mutation report.

### Community 721 - "Community 721"
Cohesion: 1.0
Nodes (1): Full Stryker JSON report structure.

### Community 722 - "Community 722"
Cohesion: 1.0
Nodes (1): Initialize OpenRouter client for Poolside Laguna model.

### Community 723 - "Community 723"
Cohesion: 1.0
Nodes (1): Analyze Vitest JSON report and raw logs for errors.

### Community 724 - "Community 724"
Cohesion: 1.0
Nodes (1): Analyze Stryker JSON report for surviving mutants.

### Community 725 - "Community 725"
Cohesion: 1.0
Nodes (1): Send preprocessed errors to LLM for analysis.

### Community 726 - "Community 726"
Cohesion: 1.0
Nodes (1): Format errors for VS Code problem matcher.

### Community 727 - "Community 727"
Cohesion: 1.0
Nodes (1): Main entry point for CI analyzer.

### Community 728 - "Community 728"
Cohesion: 1.0
Nodes (1): Execute gh CLI command and return parsed JSON output.

### Community 729 - "Community 729"
Cohesion: 1.0
Nodes (1): Get the ID of the most recent failed CI run.

### Community 730 - "Community 730"
Cohesion: 1.0
Nodes (1): Download a specific artifact from a workflow run.

### Community 731 - "Community 731"
Cohesion: 1.0
Nodes (1): Get raw logs from a failed workflow run.

### Community 732 - "Community 732"
Cohesion: 1.0
Nodes (1): Parse Vitest JSON report for failing tests.

### Community 733 - "Community 733"
Cohesion: 1.0
Nodes (1): Parse Stryker JSON report for surviving mutants.

## Knowledge Gaps
- **53 isolated node(s):** `Emits JSON progress events on each training log step.`, `qb`, `v2`, `MockIntersectionObserver`, `MockWorker` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (17 nodes): `cc`, `._applyAttribute()`, `._assert()`, `.constructor()`, `._eof()`, `._isWhitespace()`, `._next()`, `.parse()`, `._peek()`, `._readAttributes()`, `._readIdentifier()`, `._readRegex()`, `._readString()`, `._readStringOrRegex()`, `._skipWhitespace()`, `._throwError()`, `Gb()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (10 nodes): `taskQueue.ts`, `PriorityTaskQueue`, `.constructor()`, `.dequeue()`, `.effectivePriority()`, `.enqueue()`, `.peek()`, `.promoteStarvedTasks()`, `.stats()`, `.totalDepth()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (5 nodes): `O0`, `.constructor()`, `.toJSON()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `useSpeechRecognition.ts`, `sanitizeSpeechTranscript()`, `stripControlChars()`, `useSpeechRecognition()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (4 nodes): `rc`, `.constructor()`, `.toSource()`, `.toString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 96`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 143`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 180`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 226`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 266`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 271`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 709`** (1 nodes): `Remove ANSI escape codes from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 710`** (1 nodes): `Remove timestamp strings from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 711`** (1 nodes): `Replace long base64 strings with placeholder.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 712`** (1 nodes): `Remove NPM/pnpm warning lines.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 713`** (1 nodes): `Remove redundant success messages.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 714`** (1 nodes): `Apply all preprocessing steps to reduce token payload.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 715`** (1 nodes): `Extract only error-related sections from log.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 716`** (1 nodes): `Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 717`** (1 nodes): `Structured CI error for VS Code problem matcher integration.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 718`** (1 nodes): `Vitest JSON test result structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 719`** (1 nodes): `Full Vitest JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 720`** (1 nodes): `Stryker per-file mutation report.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 721`** (1 nodes): `Full Stryker JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 722`** (1 nodes): `Initialize OpenRouter client for Poolside Laguna model.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 723`** (1 nodes): `Analyze Vitest JSON report and raw logs for errors.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 724`** (1 nodes): `Analyze Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 725`** (1 nodes): `Send preprocessed errors to LLM for analysis.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 726`** (1 nodes): `Format errors for VS Code problem matcher.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 727`** (1 nodes): `Main entry point for CI analyzer.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 728`** (1 nodes): `Execute gh CLI command and return parsed JSON output.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 729`** (1 nodes): `Get the ID of the most recent failed CI run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 730`** (1 nodes): `Download a specific artifact from a workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 731`** (1 nodes): `Get raw logs from a failed workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 732`** (1 nodes): `Parse Vitest JSON report for failing tests.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 733`** (1 nodes): `Parse Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mt()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 11`, `Community 12`, `Community 14`, `Community 17`, `Community 20`, `Community 21`, `Community 26`, `Community 27`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 7`, `Community 10`, `Community 11`, `Community 13`, `Community 18`, `Community 20`, `Community 28`, `Community 31`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `wx()` connect `Community 0` to `Community 1`, `Community 3`, `Community 5`, `Community 14`, `Community 15`, `Community 16`, `Community 18`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Are the 87 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 87 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 46 inferred relationships involving `t()` (e.g. with `.flattenForSingleProject()` and `fr()`) actually correct?**
  _`t()` has 46 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `qb`, `v2` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._