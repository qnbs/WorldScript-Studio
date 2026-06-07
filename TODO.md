# StoryCraft Studio — TODO (Current Sprint)

Prioritized task tracker for the current sprint.
Status: 🔄 in progress | ⬜ open | ✅ done

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

---

## v1.20.0 — Deep Correction & Release Hardening (2026-06-06)

> Master Plan: `docs/AUDIT-2026-06-06-Deep-Correction-Plan.md` (aus `.kimi/plans/obsidian-swamp-thing-tempest.md`)

### P0 — Release Unblock
- ✅ **P0-1** — Tauri Desktop Pipeline: pnpm config migration + signing fix + production hardening audit. Vercel green; CI Quality Gate running; Tauri builds active with new signing key. Commits `946045e`–`9d222c3`.
- ✅ **P0-2** — Coverage C-7: 96 neue Tests geschrieben (Ziel 90 übertroffen).
  - LoRA: datasetBuilder (19) + evaluationService (16)
  - Voice: intentEngine (17) + feedbackService (23) + audioNavigator (21)
- 🔄 **P0-3** — Quality Gates stabil: lint ✅ · typecheck ✅ · i18n:check ✅ (2026-06-07). parity:check + bundle:budget + smoke:prod benötigen Build → CI-only auf Low-End. Warte auf nächsten CI-Run für Bestätigung.

### P1 — AI Resilience & Core Reliability
- ⬜ **P1-1** — WebLLM Worker Offload: Full GPU-Isolation in Dedicated Worker (nicht gestartet, 5–7 Tage)
- ⬜ **P1-2** — Whisper WASM STT: Download → VAD → Inference → Transcript (end-to-end) (nicht gestartet, 7–10 Tage)
- ✅ **P1-3** — Redux-Undo × Zustand Race Condition: `manuscriptPinnedBinderNodeId` reconciler in `listenerMiddleware.ts` — prüft nach project save/undo/redo/import ob pinned node noch existiert, reset auf `null` wenn stale. Commit `a799bc9`.
  - **Hinweis:** Rust TaskSupervisor UI (ManuscriptStatsPanel) ist separat in WorkerBus v2 Phase 3 (siehe unten).

### P2 — Global Readiness & i18n
- 🔄 **P1-5** — Beta-Sprachen: ja/zh/pt/el ≤ 5% English-Placeholders. **Stand (2026-06-07):**
  - ✅ `scripts/bulk-translate-locales.mjs` — kostenloser Google-Translate-Endpoint mit Rate-Limiting, Retry, Checkpointing, Glossary
  - ✅ `locales/translation-glossary.json` — feste Übersetzungen für Produktbegriffe
  - ✅ `docs/BULK-TRANSLATION.md` — vollständige Anleitung für User
  - ✅ Übersetzte Files: portal.json (40) + sidebar.json (23) + dashboard.json (107) + common.json (509)
  - EN-Placeholder-Rate reduziert: **100% → ~71.5%** (660–668 Keys übersetzt pro Sprache)
  - ⬜ Verbleibend: settings.json (648), writer.json (80), manuscript.json (67), characters.json (71), etc.
  - ⬜ Ziel ≤5% erfordert ~1550 weitere Übersetzungen pro Sprache
  - Command: `node scripts/bulk-translate-locales.mjs --lang=ja,zh,pt,el --all --delay=400`
- ✅ **P1-4** — Error Boundaries + Logging: Alle 19+ Views in `App.tsx` mit `ErrorBoundary`/`ViewErrorBoundary` gewrappt (WelcomePortal früher Return-Path + alle Modals/Portals). Commits `f810d51` + `6305d64`.

### P3 — Architektur-Hardening & Performance
- ✅ **P1-6** — Race-Condition Audit: Redux-Undo + Zustand reconcile (`listenerMiddleware.ts` clears `manuscriptPinnedBinderNodeId` when node no longer exists after project change/undo/redo). Commit `a799bc9`.
- ⬜ **P1-7** — Bundle Budget: Entry ≤ 4000 KB, Total ≤ 6500 KB. Aktuell ~4000 KB Entry (nahe Limit). Monitoring via CI.
- ⬜ **P2-1** — Error Boundaries + Logging: Alle 19 Views, Kein console.error

### P4 — v2.0 Foundation
- ⬜ **P2-2** — Cloud-Sync Conflict Resolution
- ⬜ **P2-3** — Plugin Registry Beta
- ⬜ **P2-4** — ADRs 0004/0005 + CLAUDE.md/AGENTS.md Update

---

## v1.20.0 — CI Hardening + AI Core + Local AI Perfection (2026-06-01)

- ✅ **pnpm lockfile sync** — `@xenova/transformers` → `@huggingface/transformers@^3.8.1`; `ERR_PNPM_OUTDATED_LOCKFILE` blocked all CI runs
- ✅ **14 CodeAnt AI issues fixed** — webllm dispose on eviction, releaseWebLlm both variants, await releaseAllOnnxSessions, computeShaderFactory race condition, localAiDeviceProfiler backend recommendation, adaptiveAiEngine task field, telemetryService feature flag gate, window guards, AiSections conditional mount, AdaptiveAiHardwarePanel i18n (2160 keys × 5 locales)
- ✅ **E2E stabilisation (24 → ~0 failures)** — VRT baselines, WelcomePortal contrast, waitForSpaReady theme-wait, seedGeminiApiKey role=switch fix, SceneBoard ARIA (toolbar/li), LoRA wizard skip, a11y locators, export localStorageOnly
- ✅ **Local AI Perfection — Phase 1 + 2.1 complete** — IDB session lock + key rotation, Silero VAD + Kokoro TTS async, GPU diagnostics, real text-gen pipelines, AbortSignal
- ✅ **Scorecard Pinned-Dependencies #72** — graphifyy pip install pinned by SHA256 hash
- ✅ **prune-deployments.yml** — all-environment pruning (Production/Preview/github-pages); 156 records deleted; github-script v7→v9 (node24)
- ✅ **Storybook cloud-first CI** — storybook-debug.yml (manual dispatch), Playwright browser cache v5 (node24)
- ✅ **Local AI Perfection Phase 2.2** — LoRA productionization (2026-06-02): `LoraView` container assembles library/dataset/evaluation/wizard behind `LoraViewContext`; gated `lora` route in App.tsx; conditional sidebar nav (`enableLoraAdapters`); `View`/`APP_SECTIONS`/`viewNavigationLabels`/`LORA` icon/`sidebar.lora` (7 locales); `lora-wizard.spec.ts` re-enabled; LoraView unit test
- ✅ **AI retry/fetch hardening** (2026-06-02) — `aiRetry` exponential backoff + jitter + Retry-After (P1-F5); `fetchAdapter` opt-in streaming-safe timeout (P1-F6)
- 🔄 **Local AI Perfection Phase 2.3** — Performance hardening. ✅ (2026-06-02) Pipeline LRU cache unified into `services/ai/pipelineLruCache.ts` (was duplicated in `workers/inference.worker.ts` + `workers/v2/inference.worker.ts`); adds **dispose-on-evict** (closes VRAM/RAM leak) + **in-flight load dedup**; 9 deterministic tests. ⬜ Remaining: WebLLM worker offload, LRU result-pipeline warmup tuning
- 🔄 **Local AI Perfection Phase 2.4** — Coverage. Correction: `sileroVadEngine.ts` (5 tests) + `kokoroTtsEngine.ts` already had tests since 2026-05-31 (TODO "0 tests" was stale). ✅ (2026-06-02) Filled real Kokoro gaps — `cancel()`/`pause()`/`resume()`/`dispose()` + no-WebAssembly branch (+4 tests → 10). Inference-worker LRU now covered via `pipelineLruCache.test.ts` (13). ⬜ Remaining: threshold bump to CI-measured floor
- ✅ **WorkerBus v2 Phase 1** — `@domain/worker-bus` package: typed worker pool, circuit breakers, dead-letter queue, priority task queue, progress emitter, protocol handler; 123 tests / 12 suites; 84.5% coverage
- ✅ **WorkerBus v2 Phase 2** — runtime wiring complete (2026-06-02): `workerBusManager` (singleton lifecycle), `hybridRouter` (web/Rust routing), `legacyWorkerBusAdapter` (ai-core shim), `tauriTaskBridge` (Tauri invoke); feature flag UI exposed; listenerMiddleware listeners; 154 combined tests; Rust backend stub deferred to Phase 3
- 🔄 **WorkerBus v2 Phase 3** — Rust TaskSupervisor. ✅ (2026-06-03) `src-tauri/src/commands/task_supervisor.rs` + `commands/mod.rs`; `storycraft_task_supervisor_ping` (version) + `storycraft_task_supervisor_submit` (taskType dispatcher, honest `success:false` on unknown/bad payload) registered in `lib.rs`. First real compute task `text.analyze` (word/char/sentence/syllable counts + Flesch Reading Ease, pure-Rust, 8 `#[cfg(test)]` tests). TS front-end `services/rustTaskSupervisor.ts` (`analyzeTextViaRust` — probes `isRustComputeAvailable` before routing so a Rust-only task never hits the web pool; null → JS fallback) + 5 unit tests. ⬜ Remaining: full `cargo build`/desktop verification (CI/Tauri — heavy locally); wire a real UI consumer (analytics/progress health); add more native tasks; `candle` `rust-compute` feature inference path
- ⬜ **C-7** — Coverage L85%/B75%/F80%; Stryker break 75→80
- 🔄 **C-6** — ar/he Beta shipped (2026-06-03): all 18 UI modules fully translated (ar + he), Noto Sans Arabic/Hebrew + Naskh fonts wired, `[dir="rtl"]` CSS net + shell logical-property conversion + canvas LTR islands, WelcomePortal ar/he selectors, "(Beta)" labels retained. `i18n:check` now validates ar/he parity (2259 keys × 7 locales). Help Center gained an **Advanced & Power Features** category (8 articles, en/de/fr/es/it; ar/he English fallback) + 3 offline RAG chunks; in-app **Settings Guide** now documents every live category (Fine-Tuning/LoRA, Community, Plugins). ⬜ Remaining: native-speaker review + `help.json` long-form prose (English fallback for Beta) — community follow-up

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
- ~~✅ **Codespace Uplift** (2026-05-30) — CLAUDE.md environment-aware shell rules; devcontainer re-activated (8-core/16GB); `.devcontainer/README.md` Modus Operandi section~~ **REVERTED** — DevContainer/Codespaces config removed; local low-end hardware only
- ✅ **Vercel blank screen fix** (2026-05-30) — `index.html` `%BASE_URL%` for manifest/favicon/og; `index.tsx` error safety net; 382 test files / 4567 tests all green
- ✅ **Production blank screen — zod/rolldown DCE** (2026-06-02) — `init_locales is not defined`: rolldown's prod DCE dropped zod's `__esm` init wrappers (zod `sideEffects:false`). Fixed via `patches/zod@4.4.3.patch` (`sideEffects:true`). Added `smoke:prod` (headless mount check on built `dist/`) to CI build job + `unhandledrejection` startup handler — closes the dev-mode-E2E blind spot
- 🔄 **C-6** — ar/he UI translation **complete** (2026-06-03): 18 modules translated in `locales/{ar,he}/` (help.json English fallback), Noto fonts + RTL shell layout shipped as Beta. Remaining: native-speaker review + help-article prose — community task. See `docs/I18N-GLOSSARY-RTL.md`
- 🔄 **C-7 remainder** — Coverage → L85%/B75%/F80%; Stryker break 75→80 (current thresholds: L73/F65/B58). **Phase 3 started (2026-06-02):** +33 LoRA tests (useLoraView, training wizard, sub-panels — were 0%)
- ✅ IDB at-rest encryption UX (2026-06-02 reconciliation) — `IdbUnlockModal` (startup unlock + 2-step forgot-passphrase escape hatch, `App.tsx:182-188,638-643`), `PassphraseModal` (set/change/disable), real read/write gating `idbProjectStore.ts:209-265`, session lock + key rotation (Phase 1). `enableIdbAtRestEncryption` flag in Settings › Privacy with ⚠ warning
- ✅ **P0-2** — Plugin worker isolation (`workers/plugin.worker.ts`) — routes plugin execution to isolated worker context with timeout and sandboxed API
- ✅ **P0-4** — DuckDB OPFS encryption (`services/duckdb/duckdbEncryption.ts`) — encrypts DuckDB analytics data at rest using shared passphrase-derived key
- ✅ **P0-5** — Voice WASM model download UI (`components/voice/VoiceModelDownloadModal.tsx`) — progress modal for Whisper/Kokoro model downloads with cancel/retry
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
- ✅ **Web Speech API Fallbacks** — `WebSpeechSttEngine`, `WebSpeechTtsEngine`, `WebRtcVadEngine`, `EnergyThresholdWakeWordEngine` (immediately available, 0 downloads)
- ✅ **Hybrid Intent Engine** — template matching (exact) → Jaccard fuzzy scoring → slot extraction (navigation); view-context filtering; 25 static voice commands
- ✅ **VoiceCommandService** — singleton orchestrator with state machine (idle → listening → processing → speaking → idle)
- ✅ **Redux State** — `voiceSlice` (mode, transcript, processing, dictation, engine status, microphone permission, onboarding); `VoiceSettings` in `settingsSlice`; `enableVoiceSupport` in `featureFlagsSlice`
- ✅ **React Hooks** — `useVoice` (service bridge), `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation` (editor insertion), `useVoiceAccessibility` (ARIA + focus)
- ✅ **UI Components** — `VoiceIndicator` (status overlay), `VoiceControlPanel` (command panel), `VoiceSettingsSection` (settings tab with onboarding)
- ✅ **App Integration** — `App.tsx` (conditional rendering, `document.body.dataset['view']` for intent engine), `Header.tsx` (voice status), `ManuscriptEditor.tsx` (dictation support)
- ✅ **Audio Navigator** — `audioNavigator` singleton: ARIA landmark scanning, focus management, `aria-live` regions
- ✅ **Feedback Service** — 3 verbosity levels (minimal/standard/verbose); TTS queue; event listeners for visual feedback
- ✅ **i18n** — 2025 keys × 5 locales (voice.* settings added)
- ✅ **Tests** — 83 unit tests / 9 test files (voiceSlice, intentEngine, feedbackService, sttEngine, ttsEngine, vadEngine, wakeWordEngine, audioNavigator, commandVoiceMappings)
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
- ⬜ Fine-tuning / LoRA support for personalized writing styles
- ⬜ Cloud sync (optional, E2E-encrypted)
- ✅ DS-5: Delete legacy bridge block from index.css (after DS-1 verified in production) — DONE: bridge block already removed in prior sprints; remaining aliases (`--nav-*`, `--glass-*`, `--border-interactive`, `--ring-focus`) are intentional semantic tokens, not legacy bridges.

---

## v1.20.0 — UI Modernization Phase 1 (IN PROGRESS)

- ✅ **LanguageSelector** — Modern combobox with search, flag emojis, RTL support
- ✅ **RadioGroup** — Accessible radio group component
- ✅ **Tabs** — WAI-ARIA compliant tabs component
- ✅ **ToggleSwitch** — RTL-aware with reduced-motion support
- ✅ **WelcomePortal** — Updated to use new LanguageSelector
- ⬜ **Select/Combobox** — Replace native `<select>` in Settings/AI sections
- ⬜ **Dropdown Menu** — Action menus with icons and keyboard navigation
- ⬜ **Unit tests** — Add tests for LanguageSelector, RadioGroup, Tabs
- ⬜ **Storybook stories** — Add stories for new components
- ⬜ **CI verification** — Wait for green CI before merge

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
- ⬜ Fine-tuning / LoRA support for personalized writing styles
- ⬜ Cloud sync (optional, E2E-encrypted)
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
- ⬜ Fine-tuning / LoRA support for personalized writing styles
- ⬜ Cloud sync (optional, E2E-encrypted)
- ⬜ AI creativity presets per project (not global)
- ✅ **Branches coverage ≥ 55 %** (v1.10: Vitest gate 55 %, RAG/help/plot tests)

---

## v1.4.x — Quality Enhancement (Master Perfection Plan)

> Complete **`.md` inventory** (19 curated sources): [`AUDIT.md`](AUDIT.md) § *Markdown corpus*; navigation: [`README.md`](README.md#-documentation-hub). Heavy tests **CI-first**: [`docs/CI.md`](docs/CI.md).

### High (🟡)

- ✅ Unit test coverage target range **50–70 %** — v1.10: Vitest thresholds **63 Lines · 55 Branches · 54 Functions · 62 Statements**; focus tests: RAG, help index, plot snap, AI streaming
- ✅ **E2E mobile selectors (2026-05-17)** — `clickNavItem()` helper + ARIA tabs in WriterViewUI + `data-testid` anchors in VersionControlPanel/ExportView; all 4 spec files migrated to 2026 golden hierarchy (CI gate green again)
- ✅ **CI hardening (2026-05-17)** — Stryker `break: 30` enforced, Lighthouse performance→error, OSV scanner in security job, concurrency fix (cancel-in-progress for PRs only), artifact retention unified, JUnit E2E upload
- ✅ **WebLLM model selector** — `WEBLLM_SUPPORTED_MODELS` (4 MLC checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress` parameters, Settings UI with dropdown + progress indicator (WCAG 2.2 `role="progressbar"`, `useRef` mounted guard) — [`packages/ai-core`](packages/ai-core), [`services/localAiFacade.ts`](services/localAiFacade.ts), [`components/settings/AiSections.tsx`](components/settings/AiSections.tsx)
- ✅ **Cross-project search v2 (2026-05-18)** — DB_VERSION 8, `projects-index-store`, `crossProjectIndexService.ts` (privacy-preserving IDB index), `searchAcrossProjectIndex()`, two-phase CrossProjectSearchPanel; indexing on save via listenerMiddleware is the next step
- ✅ **Cross-project search service v1** — `services/crossProjectSearchService.ts`, `searchAcrossProjects()` via fuzzyScore, transientUiStore integration (`isCrossProjectSearchOpen`), commandDefinitions command
- ✅ **Collaboration security warning** — security warning banner in CollaborationPanel (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) visible before connection establishment; disappears after connect
- ✅ **Phase 1+2 unit tests** — 17 new test files, 733 tests total; Vitest thresholds raised to 35/30/22/33 (previously 25/21/17/24)
- ✅ **Stryker extension (phase 4)** — `fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts` as additional mutation targets
- ✅ **E2E tests (phase 4)** — `commands.spec.ts` (palette Ctrl+K, "dashboard" search, fuzzy "wrt", Enter-navigate), `collaboration.spec.ts` (security warning banner visible before connection)
- ✅ **One-click** encrypted **library export** (ZIP + AES-GCM, META.json + vault.bin) — [`services/libraryBackupService.ts`](services/libraryBackupService.ts), Settings → Data
- ✅ **WebLLM** as selectable provider (`webllm/browser`, privacy same as Ollama) — [`services/aiProviderService.ts`](services/aiProviderService.ts), [`packages/ai-core`](packages/ai-core)

### Low (🟢)

- ✅ **i18n comprehensive sweep (2026-05-18)** — all hardcoded strings eliminated; 1 440 keys in 5 locales (`help.tryTour`, `Chapter 1`, `manifest.resizer.*`, `export.pasteSection.heading`, `outline.result.body`, `templates.tabs.*`, `error.boundary.*` and many more); ErrorBoundary refactored with `ErrorFallback` function component for `useTranslation()`; TypeScript 6 strict fixes (TS2322/TS2352/TS4111/TS2375); test mocks adjusted for `ErrorBoundary.test.tsx` + `AdvancedImportExport.test.tsx`
- ✅ Complete markdown documentation sync (README Hub, CONTRIBUTING, docs/CI, AUDIT, Copilot, CLAUDE, SECURITY, TAURI/graphify, CHANGELOG/ROADMAP/TODO) — 2026-05-16

---

## v1.2.0 — Security & Quality

### High (🟡)

- ✅ Expand E2E tests (project import, character CRUD, snapshot flow + auto-snapshot)
- ✅ StorageBackend interface — `services/storageBackend.ts` as contract, `StorageManager.saveProject(StoryProject)`
- ✅ Logger with ring buffer + sink for crash diagnostics

### Medium (🟠)

- ✅ Make signaling URL for collaboration configurable in Settings (`webrtcSignalingUrls`, Settings → Collaboration)
- ✅ **Yjs AES-256-GCM encryption foundation (2026-05-18)** — `collaborationService.ts` gains `encryptUpdate/decryptUpdate/deriveEncryptionKey/getEncryptionStatus`; CollaborationPanel shows encryption badge; full RTCDataChannel in-flight encryption requires y-webrtc patching (v2.0)

### Low (🟢)

- ✅ Documentation audit (CI.md, README Hub, CONTRIBUTING, AUDIT follow-up, Copilot/CLAUDE/SECURITY/Graphify) — 2026-05-02
- ✅ Visual regression (`tests/e2e/visual-regression.spec.ts`) — Chromium baseline under `tests/e2e/*-snapshots/` (`snapshotPathTemplate` without OS suffix)
- ✅ Bundle size budgets + rollup analysis in CI (`pnpm run bundle:budget`, `pnpm run analyze`, artifact `bundle-analysis`)
- ✅ FR/ES/IT key parity + CI gate (`pnpm run i18n:check`) — translation content can be improved iteratively
- ✅ Renovate auto-merge for patch updates ([`renovate.json`](renovate.json))
- ✅ Onboarding spotlight tour (`driver.js`, Dashboard + Help)
- ✅ **Tauri v2 release pipeline (2026-05-18)** — `tauri-build.yml` generates `latest.json` from signed `.sig` artifacts; `TAURI-UPDATER.md` has full secrets table; `TAURI-CI.md` has 7-step first-release checklist; macOS notarization + Windows Authenticode still require maintainer certificates

---

## Archived (v1.2.0 sprint — done)

- ✅ Expand E2E tests: project-import.spec.ts (3 tests), characters.spec.ts (4 tests), snapshots.spec.ts (4 tests)
- ✅ Ollama / local AI integration: ollamaService.ts + aiProviderService.ts + Settings UI complete, default model set to Qwen3 8B
- ✅ Split projectSlice.ts into thunk modules (14 AI thunks → `features/project/thunks/`)
- ✅ Tauri parity: 6 missing features — fileSystemService retry/compression/snapshot-ID/deleteImage/hasSavedData/auto-snapshot + Story Codex & RAG vectors (gap 3)
- ✅ Test suite expanded from ~80 to ~160+ tests (12 new test files)
- ✅ Node 24 localStorage polyfill (CI green on Node LTS + current)

## Archived (v1.1.2 hotfix — done)

- ✅ codexService infinite-loop fix (CRIT-1)
- ✅ Modal focus-trap cleanup consolidated (BUG-1)
- ✅ FOUC theme-init fixed (BUG-2)
- ✅ Untranslated languages removed from selector (CRIT-2)
- ✅ Dead code removed (buildDeduplicationKey, persist/PERSIST)
- ✅ ManuscriptView resize-listener cleanup (already fixed, TODO was stale)
- ✅ DevContainer configuration (already fixed, TODO was stale)
- ✅ Redundant deploy.yml (already fixed, TODO was stale)
- ✅ Feature-flag system (already fixed, TODO was stale)
- ✅ Request deduplication (abort-previous pattern in aiThunkUtils.ts)
