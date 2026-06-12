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


## v1.23 — Stabilisation & Verification (ACTIVE)

**Status:** 🔄 In Progress — P0-Audit-Follow-up vom 12. Juni 2026. Ziel-Release: 2026-06-20.

**P0 (Release-Blocker):**
- ✅ ROADMAP.md/TODO.md synchron zu v1.22.0 bringen und v1.23-Ziele definieren.
- 🔄 Tauri Desktop Pipeline final verifizieren (Test-Release, signed Artifacts, In-App-Updater, Window-State, Open Data Folder).
- ✅ Dependency-Hygiene abschließen (`pnpm audit`, `pnpm outdated`, `.npmrc`-Hardening dokumentieren, Known Overrides in AUDIT.md).
- ✅ i18n Parity für `ja/zh/pt/el` + RTL (`ar/he`) auf <5 % EN-Placeholders halten (`pnpm run i18n:check` grün, 2590 Keys × 11 Locales).
- ✅ Manuelles Smoke-Test-Protokoll für v1.22-Features auf Live-Demo + lokalem Tauri-Build (`docs/V1.22-SMOKE-TEST.md`).

**P1 (Diese Woche):**
- Coverage-Ziele erreichen (L≥85 %, B≥75 %, F≥80 %) — Fokus auf AI-Routing, Voice, Copilot.
- Local AI & Voice abschließen/härten (Whisper/Kokoro auf Low-End, Model-Integrity, Eco-Mode).
- Error Boundaries + strukturiertes Logging für AI/Worker-Failures verbessern.
- Accessibility Deep-Dive (manuelle Keyboard + Screen-Reader Tests).

**P2 (Nächster Sprint / v2.0 Foundation):**
- Collaboration E2E-Encryption finalisieren & testen.
- Plugin Registry Beta aus der Sandbox-Härtung herausführen.
- Bundle-Optimierung + Code-Splitting für schwere Chunks.
- Data-Migration/Backup/CloudSync LWW E2E-Tests erweitern.

---

## v1.22.0 — Phase 5: AI Execution Modes, OpenRouter & Copilot v2 (RELEASED 2026-06-11)

**Status:** ✅ Released — siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.22.0]`.

- **OpenRouter provider (Cloud 5):** Unified Gateway zu 100+ Open-Source-Modellen mit Circuit-Breaker, RPM-Tracking und Free-Tier-Katalog.
- **AI Execution Modes:** `hybrid` | `cloud` | `local` | `eco` — vier Routing-Strategien in Settings → AI & Models; `AiModeIndicator` im Copilot-Header.
- **Ultimate Copilot AI v2:** Markdown-Rendering (DOMPurify), Sidebar/Dialog-Mode, Apply-to-Chapter (Undo), `InlineAnnotationLayer`, ProForge Ask-Copilot-Chip.
- **WebLLM Worker Offload:** `@mlc-ai/web-llm` läuft im dedizierten WorkerBus-v2-Pool mit automatischem Main-Thread-Fallback.
- **Whisper WASM STT End-to-End:** Deterministische Deep-E2E-Suite für Model-Download, STT→Intent→Command und Stop-Listening.
- **Prompt-Injection & Plugin-Isolation Hardening (PR #114):** C0-Control-Character-Filter, DOMPurify-Härtung, Plugin-Storage-Key-Validierung, Worker-Sandbox mit `Function`/`eval`/`WebAssembly`-Guards.
- **i18n:** 2 594 Keys × 11 Locales.

---

## v1.21.0 — Integrity & Hardening Cycle (RELEASED 2026-06-10)

**Status:** ✅ Released — siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.21.0]`.

- **CSP `connect-src` Option B:** redundante Cloud-Endpoints entfernt, intentional `https:` für BYOK behalten; ADR-0004 + Regressionstest.
- **Suppression-Debt Ratchet Gate:** `scripts/check-suppressions.mjs` mit Baseline 159 in CI; erste Abatement-Tranche (22 `noExplicitAny`).
- **Bundle-Budget Single Source of Truth:** `package.json` `bundle:budget` = `--max-kb 6500 --max-entry-kb 4000`.
- **Whisper WASM STT Download UI + VAD→Whisper Bridge:** `VoiceModelDownloadModal`, `VoiceActivityCoordinator`.
- **Sepia Dark Mode — "Candlelit Manuscript"** als vierter Theme-Variant.
- **Deep E2E Coverage Layer:** Feature-Flag-Matrix + Error-Path-Specs.
- **Coverage Batches A–C:** Thresholds gehalten bei L74/B60/F67/S72.

---

## v1.20.0 — Deep Correction & Release Hardening (RELEASED 2026-06-07)

**Status:** ✅ Released — siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.20.0]`.

- **Tauri Desktop Pipeline repariert:** pnpm-Config-Migration, Signing-Fix, Native File Associations (`.storycraft`/`.scst`), Single-Instance, Deep-Link-Handler.
- **UI Modernization Phase 1:** `LanguageSelector`, `RadioGroup`, `Tabs`, `ToggleSwitch`.
- **Phase 3 i18n Expansion:** `ja/zh/pt/el` Beta-Sprachen + Intl APIs (`PluralRules`, `NumberFormat`, `RelativeTimeFormat`, `Collator`, `ListFormat`, `DisplayNames`).
- **Coverage C-7:** +96 Tests; Thresholds angehoben.
- **Quality Gates stabil:** lint ✅ · typecheck ✅ · i18n:check ✅ · parity:check ✅ · bundle:budget ✅ · smoke:prod ✅.

---

## v1.19.0 — Phase 2: Security, Voice WASM, Collab Transport, A11y Gate, RTL Beta (RELEASED 2026-05-28)

**Status:** ✅ Released — siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.19.0]` und [`docs/SPRINT-HANDOFF-2026-05-28.md`](docs/SPRINT-HANDOFF-2026-05-28.md).

- **B-1 — IDB At-Rest Encryption:** AES-256-GCM passphrase-derived encryption, PBKDF2 600k iter, `{ extractable: false }`.
- **B-2 — Voice WASM Scaffold:** Whisper.cpp WASM STT + Silero VAD v4 via ONNX Runtime Web.
- **B-3 — collab-transport Vendor Fork:** y-webrtc 10.3.0 mit RTCDataChannel E2E encryption.
- **B-4 — axe-core E2E Accessibility Gate:** 8-view WCAG 2.2 AA Scan, zero violations.
- **B-5 — RTL Layout Beta:** `ar`/`he` Locale Stubs + `enableRtlLayout` Flag.
- **B-6 — StructuredLogger:** IDB + Tauri JSONL sinks, GDPR `sanitizeLogContext`.
- **B-7 — Coverage Thresholds Raised:** L71/F63/B57/S69; gemessen L73/F65/B59/S71.
- **B-8 — Stryker Gate Raised:** `break` 70 → 75; 40 Mutations-Targets.

---

## v1.18.0 — ProForge Humanization & Refinement Sprint (RELEASED 2026-05-27)

**Status:** ✅ Released — commit `60f12fd`, siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.18.0]`.

- **Phase H:** Author-facing Labels, "context passages" Rename, Feature-Flag-Beschreibungen, behavioral tests.
- **Phase A:** `BaseAgent` Abstract Class, `aiConstants.ts`, `addDebouncedListener` Factory.
- **Phase P:** `SupervisorAgent`, `executeStageWithSupervision`, `BaseAgent.selfReflect()`, Honest Fallbacks, `PipelineReviewPanel` Redesign.
- **Phase X:** Settings-Nav Semantische Gruppierung, Flow Mode, Empty States.

---

## v1.17.0 — Voice Full Support Foundation (RELEASED 2026-05-24)

**Status:** ✅ Released — siehe [`CHANGELOG.md`](CHANGELOG.md) `[1.17.0]`.

- Engine-Abstraktionen (`SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`).
- Web Speech API Fallbacks, Hybrid Intent Engine, `VoiceCommandService`, `voiceSlice`.
- React Hooks (`useVoice`, `usePushToTalk`, `useVoiceDictation`, `useVoiceAccessibility`).
- UI Components (`VoiceIndicator`, `VoiceControlPanel`, `VoiceSettingsSection`).
- Audio Navigator + Feedback Service; 83 Voice-Unit-Tests.

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
