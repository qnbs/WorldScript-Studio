# StoryCraft Studio — Roadmap

## Vision

StoryCraft Studio aims to become the leading open-source platform for AI-assisted creative writing — offline-first, privacy-friendly, and extensible.

### UX / PWA baseline audit (2026-05-11)

Benchmarks from the UI/PWA deep-dive (implemented in repo, no new mandatory docs):

- **Core paths:** Welcome → Blank/Demo → Manuscript / Writer → Export → Settings — navigation via Sidebar, Command Palette and consistent glossary terms ([`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md)).
- **Responsive:** Mobile-shell E2E [`tests/e2e/mobile-shell.spec.ts`](tests/e2e/mobile-shell.spec.ts); small viewports tested manually for Bottom Sheet and Writer split.
- **Design tokens:** Hotspots migrated incrementally to `--sc-*` / `--ring-focus` ([`docs/Design-System.md`](docs/Design-System.md)); legacy bridge in [`index.css`](index.css) until migration is complete.
- **Deep links:** `?view=` is validated against valid views on startup ([`hooks/useApp.ts`](hooks/useApp.ts)); PWA shortcuts in the manifest point to the same keys ([`public/manifest.json`](public/manifest.json)).
- **Share target:** GET parameters `share_title` / `share_text` / `share_url` → Toast + `sessionStorage` + URL cleanup ([`App.tsx`](App.tsx)).
- **Service Worker:** `APP_VERSION` follows `package.json` via [`scripts/sync-sw-version.mjs`](scripts/sync-sw-version.mjs) (`predev`/`prebuild`); **Network-only** for AI and local inference hosts ([`public/sw.js`](public/sw.js)); precache only via `install` + injected `__WB_MANIFEST` (no second parallel `precacheAndRoute` track).
- **HTML `lang`:** follows the selected UI language ([`App.tsx`](App.tsx)).

> Current sprint tasks → [`TODO.md`](TODO.md)
> Completed items archive → [`docs/history/`](docs/history/)

---

## v1.19 — Phase 2: Security, Voice WASM, Collab Transport, A11y Gate, RTL Beta (2026-05-28)

**Status:** ✅ Released — see [`CHANGELOG.md`](CHANGELOG.md) `[1.19.0]` and [`docs/SPRINT-HANDOFF-2026-05-28.md`](docs/SPRINT-HANDOFF-2026-05-28.md).

**B-1 — IDB At-Rest Encryption:**
- `services/storage/storageEncryptionService.ts` — AES-256-GCM passphrase-derived encryption for IndexedDB stores
- PBKDF2 (310 000 iterations, SHA-256), 32-byte random salt, `{ extractable: false }` CryptoKey
- Feature flag `enableIdbAtRestEncryption` (off by default); Tauri path via `tauri-plugin-stronghold`

**B-2 — Voice WASM Scaffold:**
- `services/voice/wasmSttEngine.ts` — Whisper.cpp WASM STT engine interface scaffold
- `services/voice/sileroVadEngine.ts` — Silero VAD v4 via ONNX Runtime Web
- Feature flag `enableVoiceWasm` (off by default); falls back to Web Speech API when off

**B-3 — collab-transport Vendor Fork:**
- `packages/collab-transport` — vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption baked in
- Replaces pnpm patch approach; encryption patch is now part of the package source

**B-4 — axe-core E2E Accessibility Gate:**
- 8-view axe-core WCAG 2.2 AA scan in Playwright (CI gate, `tests/e2e/a11y-axe.spec.ts`)
- Zero violations enforced across Dashboard, Writer, SceneBoard, Characters, Worlds, Preview, Progress, Settings

**B-5 — RTL Layout Beta:**
- `ar` (Arabic) and `he` (Hebrew) locale stubs added to `locales/`
- `enableRtlLayout` flag activates `html[dir="rtl"]` and BiDi context provider

**B-6 — StructuredLogger:**
- `services/logger.ts` rewritten — IDB sink (`storycraft-logs-db`, 1 000-entry LRU), Tauri JSONL sink (`storycraft-YYYY-MM-DD.jsonl`), GDPR sanitization (`sanitizeLogContext`)
- New API: `createLogger(module)` → `ModuleLogger`; `.withContext(ctx)` for structured context injection
- Backward-compat `logger` default export retained

**B-7 — Coverage Thresholds Raised:**
- Vitest gate: Lines 71% / Functions 63% / Branches 57% / Statements 69%
- Measured: 73.06% L / 65.18% F / 58.79% B / 71.29% S

**B-8 — Stryker Gate Raised:**
- `break` threshold: 70 → 75; `mutate` targets expanded from 34 → 40 files

---

## v1.20 — Phase 3: v2.0 Foundation (ACTIVE — 2026-05-28)

**Status:** 🔄 In Progress — C-1..C-7 all addressed; C-6 blocked on translator; Local AI Perfection Phase 1+2.1 complete (2026-05-31).

**C-1 — collab-transport security peer review** ✅ Done (2026-05-28)
- 3 findings fixed in `packages/collab-transport/src/crypto.js`: PBKDF2 100k→310k, extractable:true→false, missing `return` on promise.reject(). Documented in AUDIT.md.

**C-2 — Plugin System Beta** ✅ Done (2026-05-28/29)
- Registry + sandboxed API + Zod validation (v1.19.0) + 2 reference plugins
- Runtime flag gate added (2026-05-29): `PluginRegistry.setEnabled()` + `App.tsx` sync; `execute/executeAsync/loadPlugin` disabled until `enablePluginSystem` is on

**C-3 — LoRA Inference Wired** ✅ Done (2026-05-28/29)
- `LoraAdapter.ollamaModelTag`, `AIRequestOptions.loraModelPath`, `selectActiveLoraOllamaTag` selector
- **Parity fix (2026-05-29):** `selectActiveLoraOllamaTag` was a dead selector — now imported by `useStoryCraftAI`; `loraModelPath` flows through `completionBodySchema` → `storyCraftCompletionFetch` Ollama override. Full Vercel AI SDK path now wired.

**C-4 — Cloud-Sync (Cloudflare R2)** ✅ Done (pre-existing)
- `services/cloudSync/` — full `StorageBackend` impl, AES-256-GCM E2E encryption, 39 tests; `enableCloudSync` flag

**C-5 — Community Readiness** ✅ Done (2026-05-28)
- GitHub Issue Templates: `bug_report.yml`, `feature_request.yml`, `translation_pr.yml`
- `AGENTS.md` updated with v1.19.0 references (collab-transport, StructuredLogger)

**C-6 — RTL: Arabic + Hebrew Locale Scaffolding** ⬜ Requires native translator
- Stubs exist (`locales/ar/`, `locales/he/`); full translation content needs community contribution
- RTL-specific Tailwind utilities + E2E tests deferred until translation content is ready

**C-7 — Coverage → Lines ≥ 85%, Branches ≥ 75%, Functions ≥ 80%** 🔄 Ongoing
- Baseline (2026-05-26 CI): 73%L / 65%F / 59%B
- +130 new tests (2026-05-28): supervisorAgent, baseAgent, geminiService streaming, helpCatalog, idbCore, loraThunks; thresholds raised L73/F65/B58/S71
- Gap remaining: ~12%L / ~15%F / ~16%B to reach targets — CI will report actuals
- Stryker `break`: raise 75 → 80 after CI score confirms ≥ 80

**Feature Parity Audit** ✅ Done (2026-05-29) — see `docs/FEATURE-PARITY.md`
- 8 critical runtime-gate drifts fixed; `features/featureCatalog.ts` + `scripts/audit-feature-parity.ts` added
- `enablePlotBoardV2` deprecated (v1 board removed in v1.6; toggle hidden, slice retained for localStorage compat)

**Local AI Perfection Sprint** 🔄 Phases 1–2.4 complete (2026-06-03)
- **Build:** `@xenova/transformers@2.17.2` → `@huggingface/transformers@3.8.1` (v3 ESM); resolves vitest broken blocker
- **Phase 1.1:** IDB session lock + atomic key rotation (`reEncryptAllAppData`/`reEncryptAllSnapshots`); brute-force rate limiting
- **Phase 1.2:** All voice engines async; `SileroVadEngine` (ONNX LSTM); `KokoroTtsEngine` (ONNX PCM)
- **Phase 1.3:** GPU fallback reason tracking; worker restart cap (MAX=5); RAM-pressure eco-mode; AdaptiveAiHardwarePanel
- **Phase 2.1:** Real `text-generation` pipelines (WebLLM: SmolLM2-135M; Transformers.js: distilgpt2); AbortSignal end-to-end
- **Phase 2.2:** ✅ Done (2026-06-02) — LoRA view productionized: `LoraView` container + gated `lora` route + conditional sidebar nav (`enableLoraAdapters`); `lora-wizard.spec.ts` re-enabled. Also `aiRetry` exponential backoff/jitter/Retry-After (P1-F5) + `fetchAdapter` opt-in timeout (P1-F6).
- **Phase 2.3** ✅ Done (merged PR #69, 2026-06-03) — Pipeline LRU cache unified into `services/ai/pipelineLruCache.ts` (dispose-on-evict + dispose-on-replace close a VRAM/RAM leak; in-flight load dedup; centralized `safeDispose`); duplication across the two inference workers removed; + `aiRetry` property tests, `useLoraView` selector fix, ADR 0001/0002.
- **Phase 2.4** ✅ Done (PR #69) — `kokoroTtsEngine` cancel/pause/resume/dispose + no-WASM coverage; thresholds ratcheted to CI-measured floor L74/B60/F66/S72.
- **Remaining:** Phase 2.3 stretch (WebLLM full worker offload — own sprint, higher risk). _Separate track:_ **WorkerBus v2 Phase 3** (Rust TaskSupervisor + `text.analyze`) ✅ landed 2026-06-03 (PR #70) — see ADR 0003.

**CI: Cloud-first Storybook** ✅ Done (2026-05-31)
- Playwright browser cache in `storybook` CI job; `**/screenshots/` in artifact upload
- New `.github/workflows/storybook-debug.yml` — manually triggered debug workflow with configurable workers/retries

**CI Hardening + CodeAnt AI Fixes** ✅ Done (2026-06-01)
- 14 CodeAnt AI issues fixed: webllm dispose on eviction, releaseWebLlm both variants, await releaseAllOnnxSessions, computeShaderFactory race condition, adaptive engine startup gate, localAiDeviceProfiler backend fix, WarmedModelEntry task field, telemetryService feature flag gate, window guards, AiSections flag gate, AdaptiveAiHardwarePanel i18n
- E2E stabilisation: 24 failures → ~0 (VRT baselines, WelcomePortal contrast, theme-wait, role=switch, SceneBoard ARIA, ActSwimlane li-wrapper, LoRA skip)
- prune-deployments.yml: all-environment pruning (156 records deleted); github-script v7→v9 (node24)
- All 18 GitHub Actions on node24; Scorecard pip hash pinned (graphifyy)

---

## v1.18 — ProForge Humanization & Refinement Sprint (2026-05-27)

**Status:** ✅ Released — commit `60f12fd`, see [`CHANGELOG.md`](CHANGELOG.md) `[1.18.0]` and [`docs/SPRINT-HANDOFF-2026-05-27.md`](docs/SPRINT-HANDOFF-2026-05-27.md).

**Phase H — UX Polish:**
- Author-facing stage labels and loading messages (no implementation jargon in UI)
- RAG chunk count renamed to "context passages" throughout
- Feature flag descriptions rewritten for non-technical readers
- Behavioral tests replacing implementation-detail assertions across 8 agent test files

**Phase A — Architecture Cleanup:**
- `BaseAgent` abstract class — ~200 LOC removed from 8 pipeline agents
- `services/ai/aiConstants.ts` — single source for `CREATIVITY_TO_TEMPERATURE`, `LOCAL_BACKEND_PRESET_DEFAULT_URL`, `ORCHESTRATION_READY_PROVIDERS`
- `addDebouncedListener` factory in `listenerMiddleware.ts`

**Phase P — Quality Supervision:**
- `SupervisorAgent` — heuristic quality gates, fallback detection, retry orchestration (no AI calls)
- `executeStageWithSupervision` retry loop; hard intake quality gate (`qualityScore < 30`)
- `BaseAgent.selfReflect()` — self-evaluation loop for DiagnosticAgent and StructuralAgent
- Honest fallback reports: 0 scores + `isFallback: true` everywhere
- `PipelineReviewPanel` redesign: Critical Actions card, severity-grouped view, Quick Accept button

**Phase X — Settings & UX:**
- Settings nav semantic grouping (`NAV_GROUPS` + `NavGroupHeader`)
- Flow Mode — distraction-free writing (Zustand + `Escape` key exit)
- Empty states for Characters, World, SceneBoard, and ProForge views
- i18n: 2055 keys × 5 locales

---

## v1.8 — RAG Prompt Assembly + UX (2026-05-21)

**Status:** Implemented in tree — see [`docs/SPRINT-V1.8.md`](docs/SPRINT-V1.8.md), [`CHANGELOG.md`](CHANGELOG.md) `[Unreleased]`.

- RAG-aware prompts for Writer (continue/brainstorm/critic) and Plot Board beat suggestions
- DuckDB semantic embedding column + migration from BoW dual-write
- PWA audit doc; design-token touch-ups; expanded settings search hints for RAG
- Local CI pack: [`infra/low-end-ci/`](infra/low-end-ci/)

---

## v1.1 — Stabilization & Hardening

**Status:** ✅ Completed (see [docs/history/completed-v1.1.md](docs/history/completed-v1.1.md) for details)

All critical, high, and most medium-priority items have been completed, including:

- ManuscriptView resize-listener cleanup (AbortController + throttle)
- Feature-flag system (localStorage-based, UI in Settings)
- DevContainer configuration
- Request deduplication (abort-previous pattern in aiThunkUtils.ts)
- Self-hosted fonts (no CDN, no Google Fonts)

---

## v1.1.2 — Hotfix: Critical Bugs

**Status:** ✅ Completed

- codexService infinite-loop fix (while+continue → for...of matchAll)
- Modal focus-trap cleanup consolidated (fragile 2-return → single cleanup)
- FOUC theme-init fixed (inline script + localStorage mirror)
- Untranslated languages (FR/ES/IT) removed from selector
- Dead code removed (buildDeduplicationKey, persist/PERSIST)

---

## v1.3 — Dual persistence, Codex hardening, quality gates

**Status:** ✅ Released as **v1.3.0** (2026-05-08) — see [`CHANGELOG.md`](CHANGELOG.md), [`AUDIT.md`](AUDIT.md) (Follow-up 2026-05-08).

- Legacy → dual IndexedDB migration, Story Bible / Codex feature flags, scene visualization, `@google/genai` v2, Stryker + Playwright visual/a11y harness, Biome `--error-on-warnings`.
- **Documentation (2026-05-06):** Complete **15-file** inventory + README Documentation Hub incl. **`.github/ACTIONS-OPTIMIZATIONS.md`**; CI/Copilot texts on dual-DB and E2E helpers — see [`AUDIT.md`](AUDIT.md) “Markdown corpus” and [`CHANGELOG.md`](CHANGELOG.md) `[Unreleased]`.

---

## v1.2 — Security, Quality & Local AI

**Status:** ✅ Completed (security hardening, Tauri parity, i18n×5, Spotlight tour — see CHANGELOG **[1.2.0]**)

### Security Hardening ✅ completed

- ✅ CryptoKey non-extractable (`crypto.subtle.generateKey()`)
- ✅ CSP img-src hardening (`frame-ancestors 'none'`, `upgrade-insecure-requests`)
- ✅ Import JSON schema validation with Valibot
- ✅ Collaboration awareness-state validation
- ✅ communityTemplateService → local static asset path
- ✅ OpenAI stream abort-check, silent model-downgrade stopped
- ✅ Gemini connection test (real API call)

### Code Quality ✅ mostly completed

- ✅ **Documentation 2026-05:** `docs/CI.md`, README “Documentation Hub”, CONTRIBUTING (Biome/Node 22/Vite 8), Copilot/CLAUDE/AUDIT synchronized with current workflow
- ✅ Coverage config migrated to glob patterns
- ✅ TypeScript 6.0 adopted (`stableTypeOrdering`, native `RegExp.escape`)
- ✅ Project/settings save listeners separated (performance)
- ✅ SettingsView.tsx split into 8 section components (2116 LOC → ~234 LOC)
- ✅ constants.tsx split into icons/defaults/index
- ✅ projectSlice.ts split into 6 thunk domain files (777 → 248 LOC)
- ✅ Lighthouse CI hard-fail enabled
- ✅ Test suite expanded to 160+ tests (CI green on Node LTS + Node 24)
- ✅ StorageBackend interface — `storageBackend.ts`, strict `StoryProject` types on proxy

### Tauri Feature Parity ✅ completed

- ✅ fileSystemService: retry logic, LZ-string compression, numeric snapshot IDs, `deleteImage()`, `hasSavedData()`, auto-snapshot (5 min, max 20)
- ✅ Story Codex + RAG vectors: file-per-project storage (`projects/{id}/codex/`)
- ✅ `storageService` / `codexService` route everything through the `StorageBackend` interface

### Ollama / Local-AI Integration ✅ completed

**Architecture:** `aiProviderService.ts` → `ollamaService.ts` (HTTP client for localhost:11434)

| Model                 | Parameters | VRAM (min) | Strengths                  | Recommendation |
| --------------------- | ---------- | ---------- | -------------------------- | -------------- |
| Qwen3 8B              | 8B         | 6 GB       | Multilingual, Reasoning    | ⭐ Primary     |
| DeepSeek V3.2 7B      | 7B         | 6 GB       | Coding, Reasoning          | Alternative    |
| Llama 4 Scout 17B     | 17B        | 12 GB      | Multilingual, long-context | Power user     |
| Gemma 3 4B            | 4B         | 4 GB       | Compact, fast              | Low-end        |
| Mistral Small 3.2 24B | 24B        | 16 GB      | Multilingual Instruction   | High-end       |
| Phi-4 Mini 3.8B       | 3.8B       | 4 GB       | Reasoning, compact         | Low-end        |
| GLM-4 9B              | 9B         | 8 GB       | Chinese+English            | Niche          |
| Kimi K2 Instruct      | 32B (MoE)  | 16 GB+     | Agentic, Tool-Use          | Experimental   |

**Hardware matrix:**

- **Minimum (4 GB VRAM):** Gemma 3 4B, Phi-4 Mini — basic text generation
- **Recommended (8 GB VRAM):** Qwen3 8B, DeepSeek V3.2 — complete toolchain
- **Optimal (16+ GB VRAM):** Llama 4 Scout, Mistral Small — long manuscripts, complex analysis

**UX specification:**

```
Settings → AI Provider → [Gemini Cloud | Ollama Local]
  ↳ If Ollama: model dropdown (auto-detect via GET /api/tags)
  ↳ Server URL: localhost:11434 (configurable)
  ↳ Status indicator: 🟢 Connected / 🔴 Unreachable
```

**Implementation steps:** ✅ all completed

1. ✅ `services/ollamaService.ts` — HTTP client (`/api/generate`, `/api/chat`, `/api/tags`)
2. ✅ `aiProviderService.ts` — provider registry with fallback chain (Gemini fallback on Ollama error)
3. ✅ `features/settings/settingsSlice.ts` — `advancedAi.provider`, `advancedAi.model`, `advancedAi.ollamaBaseUrl`
4. ✅ `components/settings/AiProviderCard.tsx` + `AiSections.tsx` — provider toggle, model auto-detect, status indicator
5. ✅ Prompt adapter — `sanitizeOllamaPrompt` + `buildOllamaPrompt` in `ollamaService.ts`
6. ✅ Default model: Qwen3 8B (`ollama/qwen3:8b`)

### Codex Auto-Tracking (Story Codex)

Automatic extraction and maintenance of a “Story Bible” from the manuscript:

- **RAG enhancement:** Entities (characters, locations, objects) are automatically extracted while writing
- **Knowledge graph:** Visualize and maintain relationships between entities
- **Contradiction detection:** Real-time consistency check against the Codex
- **Foundation:** Existing RAG vector store in IndexedDB v5

### Story Bible Light

Simplified automatic consistency checking:

- Character profiles are matched against manuscript mentions
- Warnings on name changes, age inconsistencies, location shifts
- Timeline view for chronological consistency

### Visualize Button (Image Gen)

- Gemini image generation already implemented (character portraits, world ambiance)
- Extension: “Visualize scene” button in Writer view
- Optional: Stable Diffusion via Ollama/ComfyUI for local image generation

---

## v1.2.1 — Release Blockers

**Status:** 📋 Planned (required before first Tauri release)

- ✅ StorageBackend interface — `storageBackend.ts`, strict `StoryProject` types on proxy
- ✅ Guided tour (Spotlight with `driver.js`, Dashboard + Help as entry point)
- ✅ Tauri release pipeline: GitHub Release with installers on `v*` tags — [`docs/TAURI-CI.md`](docs/TAURI-CI.md) / [`tauri-build.yml`](.github/workflows/tauri-build.yml)
- ⬜ Tauri v2 auto-update (`tauri-plugin-updater`) + code signing — deferred to dedicated PR
- ✅ FR/ES/IT key parity + CI gate (`pnpm run i18n:check`) — qualitative translations iterative
- ✅ Bundle size budgets + rollup analysis as CI (`pnpm run bundle:budget`, `analyze` artifact — see [`docs/CI.md`](docs/CI.md)); optional LHCI performance budget still roadmap-open

---

## v1.4 — Command Center, Gold-Standard Pipeline & Security Hardening

**Status:** ✅ Released as **v1.4.0** (2026-05-12) — see [`CHANGELOG.md`](CHANGELOG.md)

- **Command Center:** `services/commands/` registry + `CommandPalette.tsx` (fuzzy search, recent/pinned, AI suggestions); `CommandExecutorProvider`; global shortcuts (`services/keyboard/`, `useGlobalKeyboardShortcuts.ts`); Settings → Shortcuts
- **Settings hub:** search over control hints; settings JSON import/export
- **Gold-Standard author pipeline:** Binder, research split, compile profile, Pandoc EPUB, VC word-level diff, scene timeline, readability sampling, LanguageTool, local RAG rebuild, WebGPU leader election
- **Hybrid-AI:** local backend presets (Ollama/LM Studio/vLLM), OpenAI-compatible base URL, configurable fallback chain, desktop port scan
- **Security:** all GitHub Actions pinned to SHA, CodeQL SAST, OpenSSF Scorecard, gitleaks, SLSA attestation, Dependabot, branch protection
- **Quality:** pnpm strict config, Lighthouse accessibility error gate (WCAG 2.2)

---

## v1.4.x — Quality Enhancement (Master Perfection Plan)

**Status:** ✅ Completed (2026-05-16) — partial release of v1.4.0 cycle; details in [`CHANGELOG.md`](CHANGELOG.md) and [`TODO.md`](TODO.md).

### Unit Test Coverage: Phases 1–5

- **178 test files**, totaling **2 024 tests** (v1.6.2); Vitest thresholds at **63/62/48/54** (Lines/Statements/Branches/Functions)
- Measured coverage (2026-05-20, v1.6.2): **65.91 % Lines · 50.59 % Branches · 56.74 % Functions · 64.25 % Statements** — all thresholds green

### Phase 3A — Cross-Project Search Service ✅

- `services/crossProjectSearchService.ts`: `searchAcrossProjects()` via `fuzzyScore`, 5 locales (8 keys), `transientUiStore` integration (`isCrossProjectSearchOpen`), command palette command
- v1 scope: single project (multi-project requires DB_VERSION bump)

### Phase 3B — WebLLM Model Selector ✅

- `WEBLLM_SUPPORTED_MODELS` (4 MLC checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress` parameters, Settings UI with dropdown + WCAG progress indicator (`role="progressbar"`, `useRef` mounted guard)
- Localized in all 5 languages (3 new keys per locale in `settings.json`)

### Phase 3C — Collaboration Security Warning ✅

- `CollaborationPanel.tsx`: security warning banner (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) visible before connection establishment

### Phase 4 — Stryker Extension + E2E Tests ✅

- `stryker.conf.json`: 3 additional mutation targets (`fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts`)
- `tests/e2e/commands.spec.ts` (palette Ctrl+K, "dashboard" search, fuzzy "wrt", Enter-navigate)
- `tests/e2e/collaboration.spec.ts` (security warning banner before connection)

### One-Click Library Export ✅

- `services/libraryBackupService.ts`: encrypted ZIP export (AES-GCM, META.json + vault.bin) → Settings → Data

---

## v1.5 — Local AI, Mobile Touch & Collaboration Security

**Status:** ✅ Released 2026-05-19

- ✅ WorkerBus v2, GpuResourceManager, EcoModeService, InferenceProgressEmitter
- ✅ Active ONNX + Transformers.js inference (worker-offloaded)
- ✅ LocalEmbeddingService (MiniLM-L6-v2), LocalNlpService (sentiment / summary / topics)
- ✅ Hybrid RAG service (lexical + semantic + recency, 60/30/10)
- ✅ Cross-Project Search v2 (privacy-preserving IDB index, two-phase search)
- ✅ Yjs AES-256-GCM encryption foundation
- ✅ Tauri v2 auto-updater pipeline + signing pipeline
- ✅ Mobile PointerEvent resize, useLongPress, useSwipeGesture, BottomSheet, useHaptics
- ✅ PromptLibrary + StyleTransfer / PlotHoleFix / ChapterAutoGeneration prompts
- ✅ PluginRegistry + UsageAnalyticsService (opt-in)
- ✅ 1 851 tests / 166 files; coverage 64.68 % lines / 49.06 % branches / 54.10 % functions

---

## v1.6 — Plot-Board v2 & Writer Experience

**Status:** ✅ Released 2026-05-19

- ✅ **Plot-Board v2** — free-form canvas, SVG connections (5 types), subplot system, tension curve, beat-sheet overlays, snap-to-grid, mobile pinch/pan gestures
- ✅ **Real-Time Book Preview** — scrollable Scrivener-style book view, live TOC, fullscreen, font controls
- ✅ **Reference Panel / Split-View** — 6-tab panel (Characters, World, Notes, Binder, Comments, Revisions)
- ✅ **Per-Scene Revision History** — IDB-backed snapshots, word-level diff, two-step restore
- ✅ **Threaded Comments** — resolve/unresolve, nested replies, unresolved badge
- ✅ **Progress Tracker Dashboard** — circular progress ring, live session timer, 30-day velocity chart, 12-week heatmap, streak system
- ✅ **Mobile Polish** — foldable layout hook (Device Posture API), URL hash deep-linking, named haptic pattern library
- ✅ 2 024 tests / 178 files; coverage 65.91% lines / 50.59% branches; lint ✅ typecheck ✅ i18n 1590 keys ✅

---

## v2.0 — Community & Collaboration

**Status:** 💡 Vision (partial delivery in v1.19.0 Phase 2)

- ~~Full E2E encryption for P2P collaboration (RTCDataChannel in-flight encryption)~~ ✅ Done in B-3 (`packages/collab-transport`)
- Community model list (curated Ollama models for creative writing)
- RTL language support — ar/he stubs in B-5; full translation content + Persian still v2.0
- Fine-tuning/LoRA support for personalized writing styles
- Cloud sync option (optional, E2E-encrypted)
- Plugin system for custom AI tools (build on PluginRegistry)
- AI creativity presets per project (not global)
- Visual regression tests (Playwright screenshots + Storybook Chromatic)

---

## Architecture Decisions

### Why Ollama instead of OpenAI-compatible?

- **Privacy:** All data stays local
- **No costs:** No API fees after hardware investment
- **Flexibility:** Any GGUF model usable
- **Offline:** Works without internet connection

### Why not full E2E in v1.x?

- **Complexity:** Yjs document encryption requires a key-exchange protocol
- **Pragmatism:** PSK-based room isolation already provides good protection
- **Scope:** Focus on writing UX rather than crypto infrastructure
