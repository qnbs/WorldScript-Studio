# StoryCraft Studio — TODO (Current Sprint)

Priorisierter Task-Tracker für den aktuellen Sprint.
Status: 🔄 in Arbeit | ⬜ offen | ✅ erledigt

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

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
- ⬜ DS-5: Delete legacy bridge block from index.css (after DS-1 verified in production)

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
