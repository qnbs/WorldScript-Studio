# Graph Report - StoryCraft-Studio  (2026-06-23)

## Corpus Check
- 1158 files · ~1,303,886 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5016 nodes · 8806 edges · 86 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 2156 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 131|Community 131]]
- [[_COMMUNITY_Community 142|Community 142]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 181|Community 181]]
- [[_COMMUNITY_Community 229|Community 229]]
- [[_COMMUNITY_Community 269|Community 269]]
- [[_COMMUNITY_Community 274|Community 274]]
- [[_COMMUNITY_Community 744|Community 744]]
- [[_COMMUNITY_Community 745|Community 745]]
- [[_COMMUNITY_Community 746|Community 746]]
- [[_COMMUNITY_Community 747|Community 747]]
- [[_COMMUNITY_Community 748|Community 748]]
- [[_COMMUNITY_Community 749|Community 749]]
- [[_COMMUNITY_Community 750|Community 750]]
- [[_COMMUNITY_Community 751|Community 751]]
- [[_COMMUNITY_Community 752|Community 752]]
- [[_COMMUNITY_Community 753|Community 753]]
- [[_COMMUNITY_Community 754|Community 754]]
- [[_COMMUNITY_Community 755|Community 755]]
- [[_COMMUNITY_Community 756|Community 756]]
- [[_COMMUNITY_Community 757|Community 757]]
- [[_COMMUNITY_Community 758|Community 758]]
- [[_COMMUNITY_Community 759|Community 759]]
- [[_COMMUNITY_Community 760|Community 760]]
- [[_COMMUNITY_Community 761|Community 761]]
- [[_COMMUNITY_Community 762|Community 762]]
- [[_COMMUNITY_Community 763|Community 763]]
- [[_COMMUNITY_Community 764|Community 764]]
- [[_COMMUNITY_Community 765|Community 765]]
- [[_COMMUNITY_Community 766|Community 766]]
- [[_COMMUNITY_Community 767|Community 767]]
- [[_COMMUNITY_Community 768|Community 768]]

## God Nodes (most connected - your core abstractions)
1. `mt()` - 104 edges
2. `Bv` - 74 edges
3. `fn()` - 63 edges
4. `t()` - 51 edges
5. `Ze()` - 43 edges
6. `wx()` - 41 edges
7. `xA` - 40 edges
8. `CloudSyncBackend` - 39 edges
9. `StorageManager` - 36 edges
10. `tA()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `useApp()`  [INFERRED]
  App.tsx → hooks/useApp.ts
- `useTranslation()` --calls--> `IdbUnlockModal()`  [INFERRED]
  hooks/useTranslation.ts → components/settings/IdbUnlockModal.tsx
- `getItem()` --calls--> `readMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `writeMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `enableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (286): _0, _2(), A0, a2(), aA(), ac(), ad(), Ah() (+278 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (208): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+200 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (148): applyTextEdit(), recordLatency(), AiInferenceCacheService, hashKey(), assertCloudAiAllowed(), assertCloudAiAllowedSync(), assertLoraLocalOnly(), _cleanupPendingRequest() (+140 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (88): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), loadAgent(), analyticsPersistenceAllowedNow(), isAnalyticsPersistenceAllowed(), setRetryFeedback() (+80 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (75): FsAssetStore, glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders() (+67 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (18): a_(), bh, Dh(), eA(), el(), GE(), Gh(), mb() (+10 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (33): pipeline(), isEcoMode(), getFocusable(), onKeyDown(), onPointerUp(), n2(), getFocusable(), handleEsc() (+25 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (42): assertNoSeriousViolations(), AudioNavigator, navigateToCollaborationSettings(), md(), connectSrcTokens(), group1(), tauriCsp(), webCsp() (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.02
Nodes (65): makeContext(), makeContext(), renderSheet(), makeDeps(), renderPanel(), makeStoreState(), createFakeAdapter(), createFakeDevice() (+57 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (76): pipeline(), flushMicrotasks(), decrypt(), decryptJson(), encrypt(), encryptJson(), deleteIdb(), formatStorageError() (+68 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (64): AnalyticsBootstrap(), App(), ViewLoader(), BookPreviewView(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch() (+56 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (77): handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel(), countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject() (+69 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (62): item(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars(), loadFeatureFlagsState(), saveFeatureFlagsState() (+54 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (49): loadStoryCodex(), CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), decryptDuckDbData(), encryptDuckDbData(), initDuckDbEncryption(), createImageRegistrar() (+41 more)

### Community 14 - "Community 14"
Cohesion: 0.02
Nodes (42): createCancellationToken(), MockDoc, MockWebrtcProvider, createAttentionPipeline(), createComputePipeline(), createKvCachePipeline(), createMlpPipeline(), createSimilarityBuffers() (+34 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (67): getActiveAiMode(), getLocalFallbackModel(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally() (+59 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (76): AiModeIndicator(), _deduplicateRequest(), generateTextSingleProvider(), isAbortError(), _pendingKey(), streamAiHelpResponse(), streamAnthropic(), streamGrok() (+68 more)

### Community 17 - "Community 17"
Cohesion: 0.03
Nodes (52): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), start(), clearBenchmarkResults(), getLastBenchmarkResults() (+44 more)

### Community 18 - "Community 18"
Cohesion: 0.03
Nodes (39): buildEncodedPayload(), makeCommands(), makeProjectData(), Hb(), makeContext(), makeLargeContext(), makeSection(), smallProject() (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (30): applyPreset(), async(), close(), isSidebar(), onKey(), onPointerDown(), readMode(), writeMode() (+22 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (32): collect(), buildPaletteCommandModels(), collectAllDefinitions(), resolveTitle(), runCommandById(), id, install_app_menu(), run() (+24 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (13): createBrowserProForgeCapability(), buildPorts(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines() (+5 more)

### Community 22 - "Community 22"
Cohesion: 0.11
Nodes (1): StorageManager

### Community 23 - "Community 23"
Cohesion: 0.21
Nodes (4): LS, Th(), xn(), aa

### Community 24 - "Community 24"
Cohesion: 0.09
Nodes (12): mockT(), aE, iE, lE(), rE, sE, analyzeSentiment(), classifyWritingTopic() (+4 more)

### Community 25 - "Community 25"
Cohesion: 0.1
Nodes (11): handleEvaluate(), ScoreGauge(), comparePromptOutputs(), computeStyleConsistencyScore(), cosineSimilarity(), getEmbeddingService(), meanSimilarity(), scoreLabel() (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (15): normalize(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.35
Nodes (2): cc, Gb()

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (14): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+6 more)

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (4): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), baseSettings()

### Community 33 - "Community 33"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (3): useManuscriptLayout(), useMediaQuery(), useResizablePanels()

### Community 36 - "Community 36"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 38 - "Community 38"
Cohesion: 0.33
Nodes (3): useSwipeGesture(), useWriterLayout(), useWriterViewContext()

### Community 39 - "Community 39"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 40 - "Community 40"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 43 - "Community 43"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 46 - "Community 46"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 49 - "Community 49"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 63 - "Community 63"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 64 - "Community 64"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 65 - "Community 65"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 69 - "Community 69"
Cohesion: 0.5
Nodes (2): ManuscriptDesktopLayout(), useManuscriptViewContext()

### Community 71 - "Community 71"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 72 - "Community 72"
Cohesion: 0.83
Nodes (3): esc(), inline(), renderExportMarkdownToHtml()

### Community 77 - "Community 77"
Cohesion: 0.67
Nodes (1): makeSection()

### Community 83 - "Community 83"
Cohesion: 0.67
Nodes (1): MockGoogleGenAI

### Community 86 - "Community 86"
Cohesion: 0.67
Nodes (1): makeDeps()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (1): TaskError

### Community 131 - "Community 131"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 142 - "Community 142"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 148 - "Community 148"
Cohesion: 1.0
Nodes (1): MockBroadcastChannel

### Community 181 - "Community 181"
Cohesion: 1.0
Nodes (1): MockIntersectionObserver

### Community 229 - "Community 229"
Cohesion: 1.0
Nodes (1): MockWorker

### Community 269 - "Community 269"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 274 - "Community 274"
Cohesion: 1.0
Nodes (1): IndexedDBService

### Community 744 - "Community 744"
Cohesion: 1.0
Nodes (1): Remove ANSI escape codes from text.

### Community 745 - "Community 745"
Cohesion: 1.0
Nodes (1): Remove timestamp strings from text.

### Community 746 - "Community 746"
Cohesion: 1.0
Nodes (1): Replace long base64 strings with placeholder.

### Community 747 - "Community 747"
Cohesion: 1.0
Nodes (1): Remove NPM/pnpm warning lines.

### Community 748 - "Community 748"
Cohesion: 1.0
Nodes (1): Remove redundant success messages.

### Community 749 - "Community 749"
Cohesion: 1.0
Nodes (1): Apply all preprocessing steps to reduce token payload.

### Community 750 - "Community 750"
Cohesion: 1.0
Nodes (1): Extract only error-related sections from log.

### Community 751 - "Community 751"
Cohesion: 1.0
Nodes (1): Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce

### Community 752 - "Community 752"
Cohesion: 1.0
Nodes (1): Structured CI error for VS Code problem matcher integration.

### Community 753 - "Community 753"
Cohesion: 1.0
Nodes (1): Vitest JSON test result structure.

### Community 754 - "Community 754"
Cohesion: 1.0
Nodes (1): Full Vitest JSON report structure.

### Community 755 - "Community 755"
Cohesion: 1.0
Nodes (1): Stryker per-file mutation report.

### Community 756 - "Community 756"
Cohesion: 1.0
Nodes (1): Full Stryker JSON report structure.

### Community 757 - "Community 757"
Cohesion: 1.0
Nodes (1): Initialize OpenRouter client for Poolside Laguna model.

### Community 758 - "Community 758"
Cohesion: 1.0
Nodes (1): Analyze Vitest JSON report and raw logs for errors.

### Community 759 - "Community 759"
Cohesion: 1.0
Nodes (1): Analyze Stryker JSON report for surviving mutants.

### Community 760 - "Community 760"
Cohesion: 1.0
Nodes (1): Send preprocessed errors to LLM for analysis.

### Community 761 - "Community 761"
Cohesion: 1.0
Nodes (1): Format errors for VS Code problem matcher.

### Community 762 - "Community 762"
Cohesion: 1.0
Nodes (1): Main entry point for CI analyzer.

### Community 763 - "Community 763"
Cohesion: 1.0
Nodes (1): Execute gh CLI command and return parsed JSON output.

### Community 764 - "Community 764"
Cohesion: 1.0
Nodes (1): Get the ID of the most recent failed CI run.

### Community 765 - "Community 765"
Cohesion: 1.0
Nodes (1): Download a specific artifact from a workflow run.

### Community 766 - "Community 766"
Cohesion: 1.0
Nodes (1): Get raw logs from a failed workflow run.

### Community 767 - "Community 767"
Cohesion: 1.0
Nodes (1): Parse Vitest JSON report for failing tests.

### Community 768 - "Community 768"
Cohesion: 1.0
Nodes (1): Parse Stryker JSON report for surviving mutants.

## Knowledge Gaps
- **53 isolated node(s):** `Emits JSON progress events on each training log step.`, `qb`, `v2`, `MockIntersectionObserver`, `MockWorker` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 22`** (36 nodes): `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (17 nodes): `cc`, `._applyAttribute()`, `._assert()`, `.constructor()`, `._eof()`, `._isWhitespace()`, `._next()`, `.parse()`, `._peek()`, `._readAttributes()`, `._readIdentifier()`, `._readRegex()`, `._readString()`, `._readStringOrRegex()`, `._skipWhitespace()`, `._throwError()`, `Gb()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (4 nodes): `ManuscriptDesktopLayout.tsx`, `ManuscriptViewContext.ts`, `ManuscriptDesktopLayout()`, `useManuscriptViewContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 71`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (3 nodes): `makeSection()`, `plotBoardService.test.ts`, `plotBoardService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `makeStream()`, `MockGoogleGenAI`, `geminiService.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (3 nodes): `makeDeps()`, `aiSuggestions.test.ts`, `aiSuggestions.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (3 nodes): `types.ts`, `TaskError`, `.constructor()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 131`** (2 nodes): `MockIntersectionObserver`, `BookPreviewView.test.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 142`** (2 nodes): `MockWorker`, `duckdbClient.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 148`** (2 nodes): `MockBroadcastChannel`, `tabLeaderElection.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 181`** (2 nodes): `useBookPreviewView.test.ts`, `MockIntersectionObserver`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 229`** (2 nodes): `workerPool.test.ts`, `MockWorker`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 269`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 274`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 744`** (1 nodes): `Remove ANSI escape codes from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 745`** (1 nodes): `Remove timestamp strings from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 746`** (1 nodes): `Replace long base64 strings with placeholder.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 747`** (1 nodes): `Remove NPM/pnpm warning lines.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 748`** (1 nodes): `Remove redundant success messages.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 749`** (1 nodes): `Apply all preprocessing steps to reduce token payload.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 750`** (1 nodes): `Extract only error-related sections from log.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 751`** (1 nodes): `Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 752`** (1 nodes): `Structured CI error for VS Code problem matcher integration.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 753`** (1 nodes): `Vitest JSON test result structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 754`** (1 nodes): `Full Vitest JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 755`** (1 nodes): `Stryker per-file mutation report.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 756`** (1 nodes): `Full Stryker JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 757`** (1 nodes): `Initialize OpenRouter client for Poolside Laguna model.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 758`** (1 nodes): `Analyze Vitest JSON report and raw logs for errors.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 759`** (1 nodes): `Analyze Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 760`** (1 nodes): `Send preprocessed errors to LLM for analysis.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 761`** (1 nodes): `Format errors for VS Code problem matcher.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 762`** (1 nodes): `Main entry point for CI analyzer.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 763`** (1 nodes): `Execute gh CLI command and return parsed JSON output.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 764`** (1 nodes): `Get the ID of the most recent failed CI run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 765`** (1 nodes): `Download a specific artifact from a workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 766`** (1 nodes): `Get raw logs from a failed workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 767`** (1 nodes): `Parse Vitest JSON report for failing tests.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 768`** (1 nodes): `Parse Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mt()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 15`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 23`, `Community 24`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 1`, `Community 2`, `Community 9`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 19`, `Community 20`, `Community 26`, `Community 29`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `wx()` connect `Community 1` to `Community 0`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 9`, `Community 14`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 87 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 87 INFERRED edges - model-reasoned connections that need verification._
- **Are the 62 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 62 INFERRED edges - model-reasoned connections that need verification._
- **Are the 50 inferred relationships involving `t()` (e.g. with `.flattenForSingleProject()` and `fr()`) actually correct?**
  _`t()` has 50 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `qb`, `v2` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._