# Graph Report - StoryCraft-Studio  (2026-06-23)

## Corpus Check
- 1162 files · ~1,305,358 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5027 nodes · 8823 edges · 85 communities detected
- Extraction: 76% EXTRACTED · 24% INFERRED · 0% AMBIGUOUS · INFERRED: 2158 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 131|Community 131]]
- [[_COMMUNITY_Community 142|Community 142]]
- [[_COMMUNITY_Community 148|Community 148]]
- [[_COMMUNITY_Community 181|Community 181]]
- [[_COMMUNITY_Community 229|Community 229]]
- [[_COMMUNITY_Community 270|Community 270]]
- [[_COMMUNITY_Community 275|Community 275]]
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
- [[_COMMUNITY_Community 769|Community 769]]
- [[_COMMUNITY_Community 770|Community 770]]

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
- `useTranslation()` --calls--> `IdbUnlockModal()`  [INFERRED]
  hooks/useTranslation.ts → components/settings/IdbUnlockModal.tsx
- `getItem()` --calls--> `readMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `writeMode()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → components/copilot/CopilotPanel.tsx
- `setItem()` --calls--> `enableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts
- `removeItem()` --calls--> `disableDebugLogging()`  [INFERRED]
  features/featureFlags/featureFlagsStorage.ts → services/logger.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (312): md(), _0, _2(), A0, a2(), ab(), ac(), ad() (+304 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (193): af(), ef(), ff(), Ja(), lf(), mt(), nf(), of() (+185 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (92): pipeline(), pipeline(), isEcoMode(), flushMicrotasks(), decrypt(), decryptJson(), encrypt(), encryptJson() (+84 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (96): handleCopyForNotion(), handleDocxImport(), handleExport(), handlePasteImport(), loadAgent(), handleBuildLocalRag(), handleWebllmDownload(), isCustomOllamaModel() (+88 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (96): recordLatency(), AiInferenceCacheService, hashKey(), _clearPendingRequestsForTest(), collectSubtreeIds(), buildConsistencyHints(), buildEntityId(), buildRelationshipEdges() (+88 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (90): getActiveAiMode(), getOpenRouterFallbackProvider(), getOpenRouterModel(), isCloudOnlyMode(), isOffline(), notifyLocalModelsReady(), shouldRouteLocally(), shouldUseOpenRouter() (+82 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (21): a_(), aA(), bh, Dh(), eA(), el(), GE(), Gh() (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.02
Nodes (73): FsAssetStore, glossaryTranslate(), loadCheckpoint(), loadGlossary(), main(), maskPlaceholders(), parseArgs(), restorePlaceholders() (+65 more)

### Community 8 - "Community 8"
Cohesion: 0.01
Nodes (78): categoryFromMessage(), categoryFromStatus(), classificationFor(), classifyAiError(), extractStatus(), getAiErrorMessage(), isOffline(), clampRetryAfter() (+70 more)

### Community 9 - "Community 9"
Cohesion: 0.02
Nodes (65): accessibilityPresetDefaults(), normalizeAccessibilitySettings(), applyPreset(), loadStoryCodex(), DeadLetterQueue, openDlqDb(), storeClear(), storeGetAll() (+57 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (64): getFocusable(), onKeyDown(), onPointerUp(), applyPreset(), async(), close(), isSidebar(), onKey() (+56 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (62): AnalyticsBootstrap(), App(), ViewLoader(), useCommandExecutor(), CopilotLauncher(), Header(), useAppDispatch(), useAppSelectorShallow() (+54 more)

### Community 12 - "Community 12"
Cohesion: 0.02
Nodes (57): item(), BookPreviewView(), getLocalUser(), getRandomColor(), handleKeyDown(), sanitizeRoomInput(), stripControlChars(), deleteIdb() (+49 more)

### Community 13 - "Community 13"
Cohesion: 0.03
Nodes (67): countWords(), enrichProjectIndex(), extractCharacterNames(), getDb(), indexProject(), listIndexedProjects(), removeProjectIndex(), semanticSearchProjects() (+59 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (48): getLocalFallbackModel(), generateJson(), attachCause(), cleanPrompt(), sanitizePromptBlock(), stripControlChars(), stripJsonFences(), AnalyticsAgent (+40 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (45): AudioNavigator, buildEncodedPayload(), makeCommands(), makeProjectData(), Hb(), makeContext(), makeLargeContext(), makeSection() (+37 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (34): CollabEncryptionRequiredError, CollaborationService, resolveWebRtcSignalingUrls(), MockDoc, MockWebrtcProvider, createAttentionPipeline(), createComputePipeline(), createKvCachePipeline() (+26 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (19): createCancellationToken(), InferenceProgressEmitter, sendMessage(), handleTellMore(), handleCancel(), handleRetry(), abortActivePreload(), detectOnnxExecutionProviders() (+11 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (36): assertNoSeriousViolations(), navigateToCollaborationSettings(), connectSrcTokens(), group1(), tauriCsp(), webCsp(), clickNavItem(), ensureBlankProject() (+28 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (10): bb(), cc, d_, f_, Gb(), h_, mc(), r0() (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (33): collect(), buildPaletteCommandModels(), collectAllDefinitions(), resolveTitle(), runCommandById(), id, install_app_menu(), run() (+25 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (22): applyTextEdit(), applyReviewEditsToSection(), containsDisallowedControlChar(), isValidRange(), nearestFreeOccurrence(), planAcceptedManuscriptEdits(), validateProposedText(), mockT() (+14 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (30): AdaptiveAiEngine, _clearLatencyHistory(), estimateLatency(), getTaskConfig(), selectModelForBackend(), clearBenchmarkResults(), getLastBenchmarkResults(), loadResults() (+22 more)

### Community 23 - "Community 23"
Cohesion: 0.07
Nodes (13): createBrowserProForgeCapability(), buildPorts(), runCopilotDiagnostic(), buildNormManuscriptExport(), paginateNormLines(), stripLightMarkdown(), wrapParagraphToLines(), wrapPlainTextToNormLines() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.1
Nodes (1): StorageManager

### Community 25 - "Community 25"
Cohesion: 0.23
Nodes (3): LS, xn(), aa

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (23): AiModeIndicator(), isOpenRouterFreeModel(), buildHeaders(), buildMessages(), buildRequestBody(), computeBackoffMs(), delay(), _delayProvider() (+15 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (21): handleToggle(), handleDelete(), handleFileChange(), activateAdapter(), clearDatasetEntries(), deactivateAdapter(), deleteAdapter(), exportAdapter() (+13 more)

### Community 28 - "Community 28"
Cohesion: 0.14
Nodes (15): normalize(), buildExcerpt(), extractCharacters(), extractManuscriptSections(), searchAcrossProjectIndex(), searchAcrossProjects(), normalizeSearch(), scoreAgainstQuery() (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (8): check(), extractCatalogFlags(), extractHiddenFlags(), extractSectionFlags(), green(), grep(), hasRuntimeConsumption(), red()

### Community 32 - "Community 32"
Cohesion: 0.42
Nodes (6): emit(), main(), merge(), ProgressCallback, Emits JSON progress events on each training log step., train()

### Community 33 - "Community 33"
Cohesion: 0.25
Nodes (3): useManuscriptLayout(), useMediaQuery(), useResizablePanels()

### Community 35 - "Community 35"
Cohesion: 0.29
Nodes (5): MockAudioContext, MockBufferSource, MockGain, NonEndingSource, TrackingContext

### Community 37 - "Community 37"
Cohesion: 0.33
Nodes (3): useSwipeGesture(), useWriterLayout(), useWriterViewContext()

### Community 38 - "Community 38"
Cohesion: 0.53
Nodes (4): buildWebNNExecutionProviders(), detectWebNN(), isDirectMLAvailable(), isDirectMLHeuristic()

### Community 39 - "Community 39"
Cohesion: 0.7
Nodes (4): check_cuda_and_vram(), check_package(), check_python_version(), main()

### Community 42 - "Community 42"
Cohesion: 0.5
Nodes (3): createStorageMock(), setupStorage(), SpeechSynthesisUtteranceMock

### Community 44 - "Community 44"
Cohesion: 0.4
Nodes (4): Room, SignalingConn, WebrtcConn, WebrtcProvider

### Community 45 - "Community 45"
Cohesion: 0.4
Nodes (2): useDashboardContext(), DashboardHeader()

### Community 48 - "Community 48"
Cohesion: 0.6
Nodes (4): applyFormula(), computeReadabilitySnapshot(), estimateSyllables(), getSyllablePattern()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): makeConfig(), startPipelinePayload()

### Community 58 - "Community 58"
Cohesion: 0.67
Nodes (2): defaultProject(), setProjectData()

### Community 60 - "Community 60"
Cohesion: 0.67
Nodes (2): make(), noop()

### Community 62 - "Community 62"
Cohesion: 0.83
Nodes (3): makeChars(), makeProject(), makeWorlds()

### Community 63 - "Community 63"
Cohesion: 0.83
Nodes (3): emptyChars(), emptyWorlds(), makeProject()

### Community 64 - "Community 64"
Cohesion: 0.5
Nodes (2): ManuscriptDesktopLayout(), useManuscriptViewContext()

### Community 65 - "Community 65"
Cohesion: 0.5
Nodes (3): AsyncDuckDB, AsyncDuckDBConnection, ConsoleLogger

### Community 70 - "Community 70"
Cohesion: 0.67
Nodes (2): getQuestionsForArchetype(), getTemplateForArchetype()

### Community 71 - "Community 71"
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

### Community 270 - "Community 270"
Cohesion: 1.0
Nodes (1): FileSystemService

### Community 275 - "Community 275"
Cohesion: 1.0
Nodes (1): IndexedDBService

### Community 746 - "Community 746"
Cohesion: 1.0
Nodes (1): Remove ANSI escape codes from text.

### Community 747 - "Community 747"
Cohesion: 1.0
Nodes (1): Remove timestamp strings from text.

### Community 748 - "Community 748"
Cohesion: 1.0
Nodes (1): Replace long base64 strings with placeholder.

### Community 749 - "Community 749"
Cohesion: 1.0
Nodes (1): Remove NPM/pnpm warning lines.

### Community 750 - "Community 750"
Cohesion: 1.0
Nodes (1): Remove redundant success messages.

### Community 751 - "Community 751"
Cohesion: 1.0
Nodes (1): Apply all preprocessing steps to reduce token payload.

### Community 752 - "Community 752"
Cohesion: 1.0
Nodes (1): Extract only error-related sections from log.

### Community 753 - "Community 753"
Cohesion: 1.0
Nodes (1): Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce

### Community 754 - "Community 754"
Cohesion: 1.0
Nodes (1): Structured CI error for VS Code problem matcher integration.

### Community 755 - "Community 755"
Cohesion: 1.0
Nodes (1): Vitest JSON test result structure.

### Community 756 - "Community 756"
Cohesion: 1.0
Nodes (1): Full Vitest JSON report structure.

### Community 757 - "Community 757"
Cohesion: 1.0
Nodes (1): Stryker per-file mutation report.

### Community 758 - "Community 758"
Cohesion: 1.0
Nodes (1): Full Stryker JSON report structure.

### Community 759 - "Community 759"
Cohesion: 1.0
Nodes (1): Initialize OpenRouter client for Poolside Laguna model.

### Community 760 - "Community 760"
Cohesion: 1.0
Nodes (1): Analyze Vitest JSON report and raw logs for errors.

### Community 761 - "Community 761"
Cohesion: 1.0
Nodes (1): Analyze Stryker JSON report for surviving mutants.

### Community 762 - "Community 762"
Cohesion: 1.0
Nodes (1): Send preprocessed errors to LLM for analysis.

### Community 763 - "Community 763"
Cohesion: 1.0
Nodes (1): Format errors for VS Code problem matcher.

### Community 764 - "Community 764"
Cohesion: 1.0
Nodes (1): Main entry point for CI analyzer.

### Community 765 - "Community 765"
Cohesion: 1.0
Nodes (1): Execute gh CLI command and return parsed JSON output.

### Community 766 - "Community 766"
Cohesion: 1.0
Nodes (1): Get the ID of the most recent failed CI run.

### Community 767 - "Community 767"
Cohesion: 1.0
Nodes (1): Download a specific artifact from a workflow run.

### Community 768 - "Community 768"
Cohesion: 1.0
Nodes (1): Get raw logs from a failed workflow run.

### Community 769 - "Community 769"
Cohesion: 1.0
Nodes (1): Parse Vitest JSON report for failing tests.

### Community 770 - "Community 770"
Cohesion: 1.0
Nodes (1): Parse Stryker JSON report for surviving mutants.

## Knowledge Gaps
- **53 isolated node(s):** `Emits JSON progress events on each training log step.`, `qb`, `v2`, `MockIntersectionObserver`, `MockWorker` (+48 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 24`** (37 nodes): `.initialize()`, `storageService.ts`, `StorageManager`, `.clearApiKey()`, `.clearGeminiApiKey()`, `.constructor()`, `.deleteAllBinderAssetsForProject()`, `.deleteBinderAsset()`, `.deleteImage()`, `.deleteProject()`, `.deleteRagVectors()`, `.deleteSnapshot()`, `.deleteStoryCodex()`, `.getApiKey()`, `.getBackend()`, `.getBinderAsset()`, `.getGeminiApiKey()`, `.getImage()`, `.getRagVectors()`, `.getSnapshotData()`, `.getStoryCodex()`, `.hasSavedData()`, `.initializeBackend()`, `.listBinderAssetIds()`, `.listProjects()`, `.listSnapshots()`, `.loadProject()`, `.loadSettings()`, `.saveApiKey()`, `.saveBinderAsset()`, `.saveGeminiApiKey()`, `.saveImage()`, `.saveProject()`, `.saveRagVectors()`, `.saveSettings()`, `.saveSnapshot()`, `.saveStoryCodex()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (5 nodes): `DashboardHeader.tsx`, `DashboardContext.ts`, `useDashboardContext()`, `Chip()`, `DashboardHeader()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `makeConfig()`, `makeReviewItem()`, `startPipelinePayload()`, `proForgeSlice.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (4 nodes): `useDashboard.test.ts`, `defaultProject()`, `defaultSection()`, `setProjectData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (4 nodes): `make()`, `noop()`, `aiRetry.test.ts`, `aiRetry.test.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (4 nodes): `ManuscriptDesktopLayout.tsx`, `ManuscriptViewContext.ts`, `ManuscriptDesktopLayout()`, `useManuscriptViewContext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (4 nodes): `getAllTemplates()`, `getQuestionsForArchetype()`, `getTemplateForArchetype()`, `characterInterviewTemplates.ts`
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
- **Thin community `Community 270`** (2 nodes): `FileSystemService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 275`** (2 nodes): `IndexedDBService`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 746`** (1 nodes): `Remove ANSI escape codes from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 747`** (1 nodes): `Remove timestamp strings from text.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 748`** (1 nodes): `Replace long base64 strings with placeholder.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 749`** (1 nodes): `Remove NPM/pnpm warning lines.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 750`** (1 nodes): `Remove redundant success messages.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 751`** (1 nodes): `Apply all preprocessing steps to reduce token payload.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 752`** (1 nodes): `Extract only error-related sections from log.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 753`** (1 nodes): `Pydantic models for CI Analyzer structured output. QNBS-v3: These models enforce`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 754`** (1 nodes): `Structured CI error for VS Code problem matcher integration.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 755`** (1 nodes): `Vitest JSON test result structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 756`** (1 nodes): `Full Vitest JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 757`** (1 nodes): `Stryker per-file mutation report.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 758`** (1 nodes): `Full Stryker JSON report structure.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 759`** (1 nodes): `Initialize OpenRouter client for Poolside Laguna model.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 760`** (1 nodes): `Analyze Vitest JSON report and raw logs for errors.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 761`** (1 nodes): `Analyze Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 762`** (1 nodes): `Send preprocessed errors to LLM for analysis.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 763`** (1 nodes): `Format errors for VS Code problem matcher.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 764`** (1 nodes): `Main entry point for CI analyzer.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 765`** (1 nodes): `Execute gh CLI command and return parsed JSON output.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 766`** (1 nodes): `Get the ID of the most recent failed CI run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 767`** (1 nodes): `Download a specific artifact from a workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 768`** (1 nodes): `Get raw logs from a failed workflow run.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 769`** (1 nodes): `Parse Vitest JSON report for failing tests.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 770`** (1 nodes): `Parse Stryker JSON report for surviving mutants.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mt()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 10`, `Community 14`, `Community 15`, `Community 17`, `Community 21`, `Community 23`, `Community 25`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `t()` connect `Community 3` to `Community 1`, `Community 2`, `Community 4`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 14`, `Community 17`, `Community 20`, `Community 26`, `Community 27`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `wx()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 6`, `Community 7`, `Community 10`, `Community 16`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 87 inferred relationships involving `mt()` (e.g. with `pE()` and `xE()`) actually correct?**
  _`mt()` has 87 INFERRED edges - model-reasoned connections that need verification._
- **Are the 62 inferred relationships involving `fn()` (e.g. with `makeMediaQuery()` and `MockSpeechRecognition()`) actually correct?**
  _`fn()` has 62 INFERRED edges - model-reasoned connections that need verification._
- **Are the 50 inferred relationships involving `t()` (e.g. with `.flattenForSingleProject()` and `fr()`) actually correct?**
  _`t()` has 50 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Emits JSON progress events on each training log step.`, `qb`, `v2` to the rest of the system?**
  _53 weakly-connected nodes found - possible documentation gaps or missing edges._