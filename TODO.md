# StoryCraft Studio — TODO (Current Sprint)

Priorisierter Task-Tracker für den aktuellen Sprint.
Status: 🔄 in Arbeit | ⬜ offen | ✅ erledigt

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

---

## v1.19.0 — Phase 2: B-Series Sprint (RELEASED 2026-05-28)

- ✅ **B-1** — `services/storage/storageEncryptionService.ts` — AES-256-GCM IDB at-rest encryption; PBKDF2 (310k iter), 32-byte random salt, `extractable: false`; `enableIdbAtRestEncryption` flag
- ✅ **B-2** — `services/voice/wasmSttEngine.ts` + `sileroVadEngine.ts` — Whisper WASM STT scaffold + Silero VAD v4 via ONNX; `enableVoiceWasm` flag
- ✅ **B-3** — `packages/collab-transport` — vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption baked in (replaces pnpm patch approach)
- ✅ **B-4** — `tests/e2e/a11y-axe.spec.ts` — 8-view axe-core WCAG 2.2 AA E2E gate (CI-enforced, zero violations)
- ✅ **B-5** — `locales/ar/` + `locales/he/` locale stubs; `enableRtlLayout` flag activates `html[dir="rtl"]` + BiDi context provider
- ✅ **B-6** — `services/logger.ts` StructuredLogger rewrite — IDB sink (1 000-entry LRU), Tauri JSONL sink, GDPR `sanitizeLogContext`; `createLogger(module)` + `.withContext(ctx)` API
- ✅ **B-7** — Coverage thresholds raised: L 71 / F 63 / B 57 / S 69 (measured: 73/65/58/71)
- ✅ **B-8** — Stryker `break` 70→75; `mutate` targets 34→40 files
- ✅ **Docs** — `docs/SPRINT-HANDOFF-2026-05-28.md`, CHANGELOG `[1.19.0]`, ROADMAP, TODO, README, CLAUDE.md, SECURITY.md, IDB-ENCRYPTION.md, VOICE_MASTER_PLAN.md all updated
- ✅ **Quality gate** — lint ✅ · typecheck ✅ · i18n:check ✅ · tests ✅

---

## Phase 3 — v2.0 Foundation (ACTIVE 2026-05-28)

- ✅ **C-1** — `packages/collab-transport/src/crypto.js` security hardening: PBKDF2 100k→310k, extractable:false, return promise.reject() fix
- ✅ **C-2** — Reference plugins: `services/plugins/wordCountOverlay.plugin.ts` + `sceneAppender.plugin.ts` (8 tests) + runtime flag gate (2026-05-29)
- ✅ **C-3** — LoRA Ollama wiring: `LoraAdapter.ollamaModelTag`, `AIRequestOptions.loraModelPath`, `selectActiveLoraOllamaTag`; **parity fix (2026-05-29)**: selector now wired into `useStoryCraftAI` + `storyCraftCompletionFetch`
- ✅ **C-4** — Cloud-Sync verified: `services/cloudSync/` (3 files, 41 tests, AES-256-GCM); `create()` structural flag gate added (2026-05-29)
- ✅ **C-5** — GitHub Issue Templates (`bug_report.yml`, `feature_request.yml`, `translation_pr.yml`) + AGENTS.md hardening
- ✅ **Feature Parity Audit** (2026-05-29) — 8 critical drifts fixed; `docs/FEATURE-PARITY.md` + `features/featureCatalog.ts` + `scripts/audit-feature-parity.ts`
- ✅ **C-7 partial** (2026-05-28) — +130 tests; thresholds raised L73/F65/B58/S71; 4 192 tests / 392 files
- ⬜ **C-6** — Full ar/he translation content — requires native translator review (stubs exist in `locales/ar/`, `locales/he/`)
- 🔄 **C-7 remainder** — Coverage → L85%/B75%/F80%; Stryker break 75→80 (current thresholds: L73/F65/B58)
- ⬜ IDB at-rest encryption UX (passphrase unlock modal, forgot-passphrase flow, key rotation) — `enableIdbAtRestEncryption` flag now in UI with ⚠ warning
- ⬜ Complete Whisper WASM STT model download + inference pipeline (B-2 continuation)
- ⬜ Kokoro/Piper TTS WASM engines
- ⬜ PLANbib v1.7 features (Objects → MindMap → Interviews → Timeline → Wizard → Analysis → ReadMode → Guide → Desktop) — 9 phases, go-ahead from user required

---

## v1.18.1 — TypeScript strict-mode compliance sweep (2026-05-27)

- ✅ **All pre-existing TypeScript errors fixed** — zero `tsc --noEmit` errors across 47 changed files
- ✅ **`BaseAgent.buildAiOpts()`** — new protected helper derives valid `AIRequestOptions` (model + provider) from `PipelineConfig`; applied to all 7 pipeline agents + `selfReflect()`
- ✅ **Voice components** — `VoicePrivacyConsentModal` + `VoicePrivacyStatus` import paths, action names, and selector names corrected
- ✅ **`versionControlSlice`** — added stub `restoreSnapshot` reducer (typed cross-slice signal)
- ✅ **35+ test fixture corrections** — StorySection shape, AiModel/Theme/MindMapNodeType/StoryObjectType literals, PrivacySettings required fields, DeviceHealthReport shape, FlatHelpArticle.contentKey
- ✅ **Quality gate** — lint ✅ · typecheck ✅ · i18n:check ✅ · tests ✅

---

## v1.18.0 — ProForge Humanization & Refinement Sprint (RELEASED 2026-05-27)

- ✅ **Phase H** — Author-facing vocabulary: stage labels, loading messages, RAG "passages" rename, flag descriptions, behavioral tests
- ✅ **Phase A** — `BaseAgent` abstract class (~200 LOC removed); `aiConstants.ts` consolidation; `addDebouncedListener` factory in `listenerMiddleware.ts`
- ✅ **Phase P-1** — `SupervisorAgent`: heuristic quality gates (no AI calls), fallback sentinel detection
- ✅ **Phase P-2** — Orchestrator `executeStageWithSupervision` retry loop; hard gate: intake `qualityScore < 30`
- ✅ **Phase P-3** — `BaseAgent.selfReflect()` self-evaluation loop; DiagnosticAgent + StructuralAgent re-run on INCOHERENT flag
- ✅ **Phase P-4** — Honest fallbacks: all `createFallback*` use 0 scores + `isFallback: true`
- ✅ **Phase P-5** — `PipelineReviewPanel` redesign: Critical Actions card, severity-grouped view, Quick Accept High-Confidence button
- ✅ **Phase X-1** — Settings nav semantic grouping: `NAV_GROUPS` + `NavGroupHeader`
- ✅ **Phase X-2** — Flow Mode: `transientUiStore` `flowMode`/`setFlowMode`; `Escape` exits
- ✅ **Phase X-3** — Empty states for Characters, World, SceneBoard, ProForge views
- ✅ **i18n parity** — 2055 keys × 5 locales; `proforge.pipeline.title/noneActive` added to DE/ES/FR/IT
- ✅ **Test fixes** — 84 previously-failing tests green: `listenerMiddleware` (sync `getOriginalState`), `WriterViewUI` (context mock), `ProForgeDashboard` (i18n key assertion), 3× thunk files (aiPolicy mock)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · tests ✅ (84 tests recovered, 0 regressions)

---

## Coverage Sprint — Test Expansion + Maintenance (2026-05-26)

- ✅ **89 new test files** — settings, writing, manuscript, mind-map, ui, services, hooks, root components
- ✅ **~400 new unit tests** — AiScratchpad, ContextPanel, ToolInputs, InspectorPanel, NavigatorPanel, MindMapNodeEditor, MindMapNodeShape, ecoModeService, creativityTemperature, useCharacterInterviewsView, GpuMetricsPanel, FeatureFlagsSection, PrivacySection, SettingsOverviewCard, SettingsModals, + 70 more modules
- ✅ **Biome lint clean** — 895 files, 0 errors
- ✅ **Total test files:** 360 (was 178 files before this sprint)
- ✅ **ProForge test suite TypeScript errors fixed** — 15 test files, 30+ TS errors resolved (EntityState, ProForgeState shape, PipelineStage/ReviewItemType/ReviewItemSeverity casts, i18n generic mock, biome-ignore placement)
- ✅ **Coverage Sprint test failures fixed** — NotificationsSection (role=switch), Progress (CSS selector), ManuscriptEditor (word count regex), AnalyticsBootstrap (mock reset), ragPromptAssembly (token budget)
- ✅ **Dependencies updated** — 16 packages (patch + minor); `pnpm audit`: 0 vulnerabilities
- ✅ **Coverage (2026-05-26):** Stmts 71.29% / Branches 58.79% / Funcs 65.18% / Lines 73.06% — all CI thresholds passed (S≥67/B≥55/F≥60/L≥68); 4 044 tests / 360 files, 0 failures

---

## v1.17 — Voice Full Support Foundation (RELEASED 2026-05-24)

- ✅ **Abstract Engine Interfaces** — `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine` in `services/voice/voiceTypes.ts`
- ✅ **Web Speech API Fallbacks** — `WebSpeechSttEngine`, `WebSpeechTtsEngine`, `WebRtcVadEngine`, `EnergyThresholdWakeWordEngine` (sofort verfügbar, 0 Downloads)
- ✅ **Hybrid Intent Engine** — Template-Matching (exakt) → Jaccard fuzzy scoring → Slot-Extraction (Navigation); View-Context-Filtering; 25 statische Voice Commands
- ✅ **VoiceCommandService** — Singleton-Orchestrator mit State Machine (idle → listening → processing → speaking → idle)
- ✅ **Redux State** — `voiceSlice` (mode, transcript, processing, dictation, engine status, microphone permission, onboarding); `VoiceSettings` in `settingsSlice`; `enableVoiceSupport` in `featureFlagsSlice`
- ✅ **React Hooks** — `useVoice` (Service-Bridge), `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation` (Editor-Einfügung), `useVoiceAccessibility` (ARIA + Focus)
- ✅ **UI Components** — `VoiceIndicator` (Status-Overlay), `VoiceControlPanel` (Command-Panel), `VoiceSettingsSection` (Settings-Tab mit Onboarding)
- ✅ **App Integration** — `App.tsx` (conditional Rendering, `document.body.dataset['view']` für Intent-Engine), `Header.tsx` (Voice-Status), `ManuscriptEditor.tsx` (Dictation-Support)
- ✅ **Audio Navigator** — `audioNavigator` Singleton: ARIA-Landmark-Scanning, Focus-Management, `aria-live` Regionen
- ✅ **Feedback Service** — 3 Verbosity-Level (minimal/standard/verbose); TTS-Queue; Event-Listener für visuelles Feedback
- ✅ **i18n** — 2025 keys × 5 locales (voice.* settings hinzugefügt)
- ✅ **Tests** — 83 Unit Tests / 9 Test-Dateien (voiceSlice, intentEngine, feedbackService, sttEngine, ttsEngine, vadEngine, wakeWordEngine, audioNavigator, commandVoiceMappings)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · 83/83 voice tests ✅

### DevEx — Dual-Graph Integration (2026-05-24)

- ✅ **CodeGraph Setup** — global install, `codegraph init -i`, `.codegraph/` solo-repo policy
- ✅ **pnpm Scripts** — `codegraph:*` + `graphs:update` + `codegraph:affected`
- ✅ **VS Code: Tasks** — CodeGraph status/update/report + Dual-Graph update
- ✅ **Documentation** — `docs/codegraph.md`, `docs/dual-graph-setup.md`, README Hub, CONTRIBUTING
- ✅ **Agent Instructions** — `CLAUDE.md` + `.github/copilot-instructions.md` CodeGraph rules
- ✅ **Automation** — `scripts/codegraph-report.mjs`, `scripts/dual-graph-update.mjs`, `scripts/pre-commit-codegraph.mjs`
- ✅ **CI-AUDIT.md** — `graphs:update` as post-feature repo policy
- ✅ **Quality gate** — lint ✅ · Biome ignores `.codegraph/` ✅

### v2.0 Open Items

- ⬜ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch)
- ⬜ RTL language support (Arabic, Hebrew, Persian)
- ⬜ Fine-Tuning / LoRA-Support für personalisierte Schreibstile
- ⬜ Cloud-Sync (optional, E2E-verschlüsselt)
- ✅ DS-5: Delete legacy bridge block from index.css (after DS-1 verified in production) — DONE: bridge block already removed in prior sprints; remaining aliases (`--nav-*`, `--glass-*`, `--border-interactive`, `--ring-focus`) are intentional semantic tokens, not legacy bridges.

---

## v1.11 — Stabilization Sprint (RELEASED 2026-05-22)

- ✅ **Cloudflare deploy fix (P0)** — `resolve-deploy-base.mjs` `base` → `deployBase`; `sync-deploy-base.mjs` error propagation
- ✅ **`services/dbInitialization.ts`** — `initializeStorage()` + `resetAllDatabases()` extracted from inline IIFE
- ✅ **StorageBackend retries** — `retryDb()` applied to `saveProject` + `saveSettings` in `dbService.ts`
- ✅ **`StorageErrorScreen` recovery UI** — `index.tsx` shows React component with Reload + Reset on DB init failure
- ✅ **Settings auto-save toast** — `listenerMiddleware.ts` catch dispatches error notification
- ✅ **Help Center complete** — 13 stub articles fully written (700–1000 chars HTML) × 5 locales; 1931 keys × 5 at parity
- ✅ **Tests** — `dbInitialization.test.ts` (8 tests) + `dbServiceRetry.test.ts` (7 tests)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · 15/15 new tests ✅

---

## v1.7 — DuckDB Analytics + Hybrid RAG + AI Extensions (RELEASED 2026-05-20)

- ✅ **DuckDB-WASM P0–P3** — worker, client, schema (10 tables + 5 views), analytics queries, migration, dual-write, RAG vectors, cross-project, codex, scene timeline
- ✅ **DuckDB resilience** — init retry (3×), dual-write retry (3×), OPFS fallback to in-memory, error surface to Redux
- ✅ **Hybrid RAG wired end-to-end** — `ragMode` setting, mode selector UI, consistency checker uses RAG context, Re-Index button in Reference Panel, Settings button bug fix
- ✅ **ONNX + Transformers.js** as selectable primary AI providers
- ✅ **Service-level dedup** — `aiThunkUtils` prevents concurrent duplicate AI requests
- ✅ **Per-project AI preset** — hash-based deep links, dedup key hardening
- ✅ **WorkerBus backpressure** — `MAX_QUEUE_SIZE` = 32, telemetry extended
- ✅ **Y-WebRTC E2E encryption** — AES-256-GCM, PBKDF2 310k iter, CollaborationPanel badge
- ✅ **PlotCanvas rAF throttle** — eliminates 60 Hz Redux dispatch storm
- ✅ **i18n** — 1 625 keys × 5 locales (+35 new keys)
- ✅ **Quality gate** — lint ✅ typecheck ✅ i18n ✅ 2 024+ tests / 178 files ✅

## v1.8 — RAG Prompt Assembly + UX (2026-05-21)

- ✅ **`assembleRAGPrompt`** — `services/ragPromptAssembly.ts` + PromptLibrary templates
- ✅ **Writer** — RAG toggle + chunk badge; continuation/brainstorm/critic use hybrid context
- ✅ **Plot Board AI** — `suggestNextBeatThunk` + modal UI
- ✅ **DuckDB embedding** — `rag_chunks.embedding` 384-dim migration + dual-write fix
- ✅ **PWA audit** — [`docs/PWA-AUDIT.md`](docs/PWA-AUDIT.md), `handle_links`, SW comment for WASM/ONNX
- ✅ **Settings & Help** — RAG hybrid hint, help article + `tryActionId`, `helpDocRetrieval` chunk
- ✅ **UI tokens** — Writer, Command Palette, Modal, Project AI preset (`--ring-focus`)
- ✅ **Docs** — README hub, ROADMAP, CHANGELOG `[Unreleased]`, AUDIT, `.cursor/index.mdc`
- ✅ **Tauri audit** — [`docs/TAURI-CI.md`](docs/TAURI-CI.md) checklist v1.8
- ✅ **Sprint ref** — [`docs/SPRINT-V1.8.md`](docs/SPRINT-V1.8.md)

### v2.0 Open Items

- ⬜ DuckDB `rag_chunks` schema migration: `FLOAT[64]` BoW → `FLOAT[384]` semantic vectors — **superseded by v1.8 embedding column** (verify on device)
- ⬜ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch)
- ⬜ RTL language support (Arabic, Hebrew, Persian)
- ⬜ Fine-Tuning / LoRA-Support für personalisierte Schreibstile
- ⬜ Cloud-Sync (optional, E2E-verschlüsselt)
- ✅ **Branches coverage ≥ 55 %** (v1.10: Vitest gate 55 %, RAG/help/plot tests)

---

## v1.6 — Plot-Board v2 & Writer Experience (RELEASED 2026-05-19)

- ✅ **Plot-Board v2** — `plotBoardSlice`, `plotBoardService`, `PlotCanvas`, `ConnectionLayer`, `SubplotPanel`, `TensionCurvePanel`, `ConnectionToolbar`, beat-sheet overlays, mobile pinch/pan
- ✅ **Real-Time Book Preview** — `BookPreviewView`, `useBookPreviewView`, `BookPreviewContext`, IntersectionObserver TOC, fullscreen
- ✅ **Reference Panel** — `ReferencePanelView` (6 tabs: Characters, World, Notes, Binder, Comments, Revisions)
- ✅ **Per-Scene Revision History** — `sceneRevisionService` (IDB), `SceneRevisionPanel`, word-level diff, named snapshots
- ✅ **Threaded Comments** — `sceneCommentsSlice`, `CommentsPanel`, resolve/reply/delete
- ✅ **Progress Tracker** — `progressTrackerSlice`, `ProgressTrackerView`, session timer, streak, velocity chart, heatmap
- ✅ **Mobile Polish** — `useFoldableLayout`, `deepLinkService`, `HAPTIC_PATTERNS` named library
- ✅ **i18n** — 1590 keys × 5 locales
- ✅ **Quality gate** — lint ✅ typecheck ✅ 2024 tests / 178 files (0 failures) ✅ coverage 65.91% lines ✅

### v2.0 Open Items

- ⬜ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch)
- ⬜ RTL language support (Arabic, Hebrew, Persian)
- ⬜ Fine-Tuning / LoRA-Support für personalisierte Schreibstile
- ⬜ Cloud-Sync (optional, E2E-verschlüsselt)
- ⬜ AI-Creativity-Presets pro Projekt (nicht global)
- ✅ **Branches coverage ≥ 55 %** (v1.10: Vitest gate 55 %, RAG/help/plot tests)

---

## v1.4.x — Qualitätssteigerung (Master Perfection Plan)

> Vollständige **`.md`-Inventur** (19 kuratierte Quellen): [`AUDIT.md`](AUDIT.md) § *Markdown corpus*; Navigation: [`README.md`](README.md#-documentation-hub). Schwere Tests **CI-first**: [`docs/CI.md`](docs/CI.md).

### Hoch (🟡)

- ✅ Unit-Test-Coverage Zielkorridor **50–70 %** — v1.10: Vitest-Schwellen **63 Lines · 55 Branches · 54 Functions · 62 Statements**; Fokus-Tests RAG, Help-Index, Plot-Snap, AI-Streaming
- ✅ **E2E mobile Selectors (2026-05-17)** — `clickNavItem()` Helper + ARIA-Tabs in WriterViewUI + `data-testid`-Anker in VersionControlPanel/ExportView; alle 4 Spec-Dateien auf 2026 Golden Hierarchy umgestellt (CI-Gate wieder grün)
- ✅ **CI-Hardening (2026-05-17)** — Stryker `break: 30` erzwungen, Lighthouse Performance→error, OSV-Scanner in Security-Job, Concurrency-Fix (cancel-in-progress nur PRs), Artifact-Retention vereinheitlicht, JUnit-E2E-Upload
- ✅ **WebLLM Modell-Selektor** — `WEBLLM_SUPPORTED_MODELS` (4 MLC-Checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress`-Parameter, Settings-UI mit Dropdown + Fortschrittsanzeige (WCAG 2.2 `role="progressbar"`, `useRef`-Mounted-Guard) — [`packages/ai-core`](packages/ai-core), [`services/localAiFacade.ts`](services/localAiFacade.ts), [`components/settings/AiSections.tsx`](components/settings/AiSections.tsx)
- ✅ **Cross-Project-Search v2 (2026-05-18)** — DB_VERSION 8, `projects-index-store`, `crossProjectIndexService.ts` (privacy-preserving IDB index), `searchAcrossProjectIndex()`, two-phase CrossProjectSearchPanel; indexing on save via listenerMiddleware is the next step
- ✅ **Cross-Project-Search Service v1** — `services/crossProjectSearchService.ts`, `searchAcrossProjects()` via fuzzyScore, transientUiStore-Integration (`isCrossProjectSearchOpen`), commandDefinitions-Command
- ✅ **Collaboration Security Warning** — Sicherheitshinweis-Banner in CollaborationPanel (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) vor Verbindungsaufbau sichtbar; verschwindet nach Connect
- ✅ **Phase 1+2 Unit Tests** — 17 neue Test-Dateien, 733 Tests gesamt; Vitest-Schwellen auf 35/30/22/33 erhöht (zuvor 25/21/17/24)
- ✅ **Stryker Erweiterung (Phase 4)** — `fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts` als zusätzliche Mutations-Ziele
- ✅ **E2E-Tests (Phase 4)** — `commands.spec.ts` (Palette Ctrl+K, „dashboard"-Suche, fuzzy „wrt", Enter-Navigate), `collaboration.spec.ts` (Security-Warning-Banner sichtbar vor Verbindung)
- ✅ **One-Click** verschlüsselter **Library-Export** (ZIP + AES-GCM, META.json + vault.bin) — [`services/libraryBackupService.ts`](services/libraryBackupService.ts), Settings → Data
- ✅ **WebLLM** als wählbarer Provider (`webllm/browser`, Privacy wie Ollama) — [`services/aiProviderService.ts`](services/aiProviderService.ts), [`packages/ai-core`](packages/ai-core)

### Niedrig (🟢)

- ✅ **i18n Comprehensive Sweep (2026-05-18)** — alle hardcodierten Strings eliminiert; 1 440 Keys in 5 Locales (`help.tryTour`, `Chapter 1`, `manifest.resizer.*`, `export.pasteSection.heading`, `outline.result.body`, `templates.tabs.*`, `error.boundary.*` u. v. m.); ErrorBoundary mit `ErrorFallback`-Funktionskomponente für `useTranslation()` refaktoriert; TypeScript-6-Strict-Fixes (TS2322/TS2352/TS4111/TS2375); Testmocks für `ErrorBoundary.test.tsx` + `AdvancedImportExport.test.tsx` angepasst
- ✅ Vollständige Markdown-Doku-Synchronisation (README Hub, CONTRIBUTING, docs/CI, AUDIT, Copilot, CLAUDE, SECURITY, TAURI/graphify, CHANGELOG/ROADMAP/TODO) — 2026-05-16

---

## v1.2.0 — Security & Quality

### Hoch (🟡)

- ✅ E2E-Tests erweitern (Projekt-Import, Charakter-CRUD, Snapshot-Flow + Auto-Snapshot)
- ✅ StorageBackend-Interface — `services/storageBackend.ts` als Kontrakt, `StorageManager.saveProject(StoryProject)`
- ✅ Logger mit Ringbuffer + Sink für Crash-Diagnose

### Mittel (🟠)

- ✅ Signaling-URL für Collaboration in Settings konfigurierbar machen (`webrtcSignalingUrls`, Einstellungen → Zusammenarbeit)
- ✅ **Yjs AES-256-GCM Encryption Foundation (2026-05-18)** — `collaborationService.ts` gains `encryptUpdate/decryptUpdate/deriveEncryptionKey/getEncryptionStatus`; CollaborationPanel shows encryption badge; full RTCDataChannel in-flight encryption requires y-webrtc patching (v2.0)

### Niedrig (🟢)

- ✅ Dokumentations-Audit (CI.md, README Hub, CONTRIBUTING, AUDIT-Follow-up, Copilot/CLAUDE/SECURITY/Graphify) — 2026-05-02
- ✅ Visual Regression (`tests/e2e/visual-regression.spec.ts`) — Chromium-Baseline unter `tests/e2e/*-snapshots/` (`snapshotPathTemplate` ohne OS-Suffix)
- ✅ Bundle-Size-Budgets + rollup-Analyse in CI (`pnpm run bundle:budget`, `pnpm run analyze`, Artifact `bundle-analysis`)
- ✅ FR/ES/IT Key-Parität + CI-Gate (`pnpm run i18n:check`) — inhaltliche Übersetzungen können iterativ verbessert werden
- ✅ Renovate Auto-Merge für Patch-Updates ([`renovate.json`](renovate.json))
- ✅ Onboarding-Spotlight-Tour (`driver.js`, Dashboard + Hilfe)
- ✅ **Tauri v2 Release-Pipeline (2026-05-18)** — `tauri-build.yml` generates `latest.json` from signed `.sig` artifacts; `TAURI-UPDATER.md` has full secrets table; `TAURI-CI.md` has 7-step first-release checklist; macOS notarization + Windows Authenticode still require maintainer certificates

---

## Archiviert (v1.2.0 Sprint — erledigt)

- ✅ E2E-Tests erweitern: project-import.spec.ts (3 Tests), characters.spec.ts (4 Tests), snapshots.spec.ts (4 Tests)
- ✅ Ollama / Local-AI Integration: ollamaService.ts + aiProviderService.ts + Settings-UI vollständig, Default-Modell auf Qwen3 8B
- ✅ projectSlice.ts in Thunk-Module splitten (14 AI-Thunks → `features/project/thunks/`)
- ✅ Tauri-Parität: 6 fehlende Features — fileSystemService Retry/Kompression/Snapshot-ID/deleteImage/hasSavedData/Auto-Snapshot + Story Codex & RAG vectors (Gap 3)
- ✅ Test-Suite von ~80 auf ~160+ Tests ausgebaut (12 neue Test-Dateien)
- ✅ Node 24 localStorage-Polyfill (CI grün auf Node LTS + current)

## Archiviert (v1.1.2 Hotfix — erledigt)

- ✅ codexService Infinite-Loop Fix (CRIT-1)
- ✅ Modal Focus-Trap Cleanup konsolidiert (BUG-1)
- ✅ FOUC Theme-Init behoben (BUG-2)
- ✅ Unübersetzte Sprachen aus Selector entfernt (CRIT-2)
- ✅ Dead Code entfernt (buildDeduplicationKey, persist/PERSIST)
- ✅ ManuscriptView Resize-Listener Cleanup (bereits gefixt, TODO war veraltet)
- ✅ DevContainer-Konfiguration (bereits gefixt, TODO war veraltet)
- ✅ Redundante deploy.yml (bereits gefixt, TODO war veraltet)
- ✅ Feature-Flag-System (bereits gefixt, TODO war veraltet)
- ✅ Request-Deduplizierung (abort-previous Pattern in aiThunkUtils.ts)
