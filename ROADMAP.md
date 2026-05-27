# StoryCraft Studio — Roadmap

## Vision

StoryCraft Studio soll die führende Open-Source-Plattform für KI-gestütztes kreatives Schreiben werden — offline-first, datenschutzfreundlich und erweiterbar.

### UX / PWA baseline audit (2026-05-11)

Messlatten aus dem UI-/PWA-Deep-Dive (Umsetzung im Repo, keine neue Pflicht-Doku):

- **Kernpfade:** Willkommen → Blank/Demo → Manuskript / Writer → Export → Settings — Orientierung über Sidebar, Command Palette und konsistente Glossar-Begriffe ([`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md)).
- **Responsive:** Mobile-Shell-E2E [`tests/e2e/mobile-shell.spec.ts`](tests/e2e/mobile-shell.spec.ts); kleine Viewports manuell für Bottom-Sheet und Writer-Split.
- **Design-Tokens:** Hotspots schrittweise auf `--sc-*` / `--ring-focus` ([`docs/Design-System.md`](docs/Design-System.md)); Legacy-Bridge in [`index.css`](index.css) bis Migration fertig.
- **Deep Links:** `?view=` wird beim Start gegen gültige Views validiert ([`hooks/useApp.ts`](hooks/useApp.ts)); PWA-Shortcuts im Manifest zeigen auf dieselben Keys ([`public/manifest.json`](public/manifest.json)).
- **Share Target:** GET-Parameter `share_title` / `share_text` / `share_url` → Toast + `sessionStorage` + URL-Bereinigung ([`App.tsx`](App.tsx)).
- **Service Worker:** `APP_VERSION` folgt `package.json` via [`scripts/sync-sw-version.mjs`](scripts/sync-sw-version.mjs) (`predev`/`prebuild`); **Network-only** für KI- und Local-Inference-Hosts ([`public/sw.js`](public/sw.js)); Precache nur über `install` + injiziertes `__WB_MANIFEST` (kein zweites `precacheAndRoute`-Paralleltrack).
- **HTML `lang`:** folgt der gewählten UI-Sprache ([`App.tsx`](App.tsx)).

> Current sprint tasks → [`TODO.md`](TODO.md)
> Completed items archive → [`docs/history/`](docs/history/)

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

## v1.1 — Stabilisierung & Härtung

**Status:** ✅ Abgeschlossen (siehe [docs/history/completed-v1.1.md](docs/history/completed-v1.1.md) für Details)

All critical, high, and most medium-priority items have been completed, including:

- ManuscriptView Resize-Listener Cleanup (AbortController + throttle)
- Feature-Flag-System (localStorage-basiert, UI in Settings)
- DevContainer-Konfiguration
- Request-Deduplizierung (abort-previous Pattern in aiThunkUtils.ts)
- Self-hosted Fonts (kein CDN, kein Google Fonts)

---

## v1.1.2 — Hotfix: Kritische Bugs

**Status:** ✅ Abgeschlossen

- codexService Infinite-Loop Fix (while+continue → for...of matchAll)
- Modal Focus-Trap Cleanup konsolidiert (fragile 2-return → single cleanup)
- FOUC Theme-Init behoben (inline script + localStorage mirror)
- Unübersetzte Sprachen (FR/ES/IT) aus Selector entfernt
- Dead Code entfernt (buildDeduplicationKey, persist/PERSIST)

---

## v1.3 — Dual persistence, Codex hardening, quality gates

**Status:** ✅ Released as **v1.3.0** (2026-05-08) — siehe [`CHANGELOG.md`](CHANGELOG.md), [`AUDIT.md`](AUDIT.md) (Follow-up 2026-05-08).

- Legacy → dual IndexedDB migration, Story Bible / Codex feature flags, scene visualization, `@google/genai` v2, Stryker + Playwright visual/a11y harness, Biome `--error-on-warnings`.
- **Documentation (2026-05-06):** Vollständige **15-Dateien**-Inventur + README Documentation Hub inkl. **`.github/ACTIONS-OPTIMIZATIONS.md`**; CI-/Copilot-Texte zu Dual-DB und E2E-Helfern — siehe [`AUDIT.md`](AUDIT.md) „Markdown corpus“ und [`CHANGELOG.md`](CHANGELOG.md) `[Unreleased]`.

---

## v1.2 — Security, Quality & Local AI

**Status:** ✅ Abgeschlossen (Security-Härting, Tauri-Parität, i18n×5, Spotlight-Tour — siehe CHANGELOG **[1.2.0]**)

### Security Hardening ✅ abgeschlossen

- ✅ CryptoKey non-extractable (`crypto.subtle.generateKey()`)
- ✅ CSP img-src hardening (`frame-ancestors 'none'`, `upgrade-insecure-requests`)
- ✅ Import-JSON Schema-Validation mit Valibot
- ✅ Collaboration Awareness-State Validation
- ✅ communityTemplateService → lokaler Static-Asset-Pfad
- ✅ OpenAI Stream Abort-Check, silent Model-Downgrade gestoppt
- ✅ Gemini Connection Test (echter API-Call)

### Code Quality ✅ größtenteils abgeschlossen

- ✅ **Dokumentation 2026-05:** `docs/CI.md`, README „Documentation Hub“, CONTRIBUTING (Biome/Node 22/Vite 8), Copilot/CLAUDE/AUDIT mit aktuellem Workflow synchronisiert
- ✅ Coverage-Config auf Glob-Patterns umgestellt
- ✅ TypeScript 6.0 übernommen (`stableTypeOrdering`, native `RegExp.escape`)
- ✅ Project/Settings-Save-Listener getrennt (Performance)
- ✅ SettingsView.tsx in 8 Sektions-Komponenten aufgeteilt (2116 LOC → ~234 LOC)
- ✅ constants.tsx in icons/defaults/index aufgeteilt
- ✅ projectSlice.ts in 6 Thunk-Domain-Dateien aufgeteilt (777 → 248 LOC)
- ✅ Lighthouse CI hard-fail aktiviert
- ✅ Test-Suite auf 160+ Tests ausgebaut (CI grün auf Node LTS + Node 24)
- ✅ StorageBackend-Interface — `storageBackend.ts`, strikte `StoryProject`-Typen am Proxy

### Tauri Feature-Parität ✅ abgeschlossen

- ✅ fileSystemService: Retry-Logik, LZ-String-Kompression, numerische Snapshot-IDs, `deleteImage()`, `hasSavedData()`, Auto-Snapshot (5 min, max 20)
- ✅ Story Codex + RAG-Vektoren: file-per-project Storage (`projects/{id}/codex/`)
- ✅ `storageService` / `codexService` routen alles über `StorageBackend`-Interface

### Ollama / Local-AI Integration ✅ abgeschlossen

**Architektur:** `aiProviderService.ts` → `ollamaService.ts` (HTTP-Client für localhost:11434)

| Modell                | Parameter | VRAM (min) | Stärken                    | Empfehlung    |
| --------------------- | --------- | ---------- | -------------------------- | ------------- |
| Qwen3 8B              | 8B        | 6 GB       | Multilingual, Reasoning    | ⭐ Primär     |
| DeepSeek V3.2 7B      | 7B        | 6 GB       | Coding, Reasoning          | Alternativ    |
| Llama 4 Scout 17B     | 17B       | 12 GB      | Multilingual, lang-context | Power-User    |
| Gemma 3 4B            | 4B        | 4 GB       | Kompakt, schnell           | Low-End       |
| Mistral Small 3.2 24B | 24B       | 16 GB      | Multilingual Instruction   | High-End      |
| Phi-4 Mini 3.8B       | 3.8B      | 4 GB       | Reasoning, kompakt         | Low-End       |
| GLM-4 9B              | 9B        | 8 GB       | Chinesisch+Englisch        | Nische        |
| Kimi K2 Instruct      | 32B (MoE) | 16 GB+     | Agentic, Tool-Use          | Experimentell |

**Hardware-Matrix:**

- **Minimum (4 GB VRAM):** Gemma 3 4B, Phi-4 Mini — Basis-Textgenerierung
- **Empfohlen (8 GB VRAM):** Qwen3 8B, DeepSeek V3.2 — Vollständige Toolchain
- **Optimal (16+ GB VRAM):** Llama 4 Scout, Mistral Small — Lange Manuskripte, komplexe Analyse

**UX-Spezifikation:**

```
Einstellungen → AI Provider → [Gemini Cloud | Ollama Local]
  ↳ Wenn Ollama: Modell-Dropdown (auto-detect via GET /api/tags)
  ↳ Server-URL: localhost:11434 (konfigurierbar)
  ↳ Status-Indikator: 🟢 Verbunden / 🔴 Nicht erreichbar
```

**Implementation-Schritte:** ✅ alle abgeschlossen

1. ✅ `services/ollamaService.ts` — HTTP-Client (`/api/generate`, `/api/chat`, `/api/tags`)
2. ✅ `aiProviderService.ts` — Provider-Registry mit Fallback-Chain (Gemini-Fallback bei Ollama-Fehler)
3. ✅ `features/settings/settingsSlice.ts` — `advancedAi.provider`, `advancedAi.model`, `advancedAi.ollamaBaseUrl`
4. ✅ `components/settings/AiProviderCard.tsx` + `AiSections.tsx` — Provider-Toggle, Modell-Auto-Detect, Status-Indikator
5. ✅ Prompt-Adapter — `sanitizeOllamaPrompt` + `buildOllamaPrompt` in `ollamaService.ts`
6. ✅ Default-Modell: Qwen3 8B (`ollama/qwen3:8b`)

### Codex Auto-Tracking (Story Codex)

Automatische Erfassung und Pflege einer „Story Bible" aus dem Manuskript:

- **RAG-Enhancement:** Beim Schreiben werden Entitäten (Charaktere, Orte, Gegenstände) automatisch extrahiert
- **Knowledge-Graph:** Beziehungen zwischen Entitäten visualisieren und pflegen
- **Widerspruchserkennung:** Echtzeit-Konsistenzprüfung gegen den Codex
- **Basis:** Existierender RAG-Vektoren-Store in IndexedDB v5

### Story Bible Light

Vereinfachte automatische Konsistenzprüfung:

- Charakter-Steckbriefe werden mit Manuskript-Erwähnungen abgeglichen
- Warnungen bei Namensänderungen, Altersinkonsistenzen, Ortwechseln
- Timeline-View für chronologische Konsistenz

### Visualize-Button (Image-Gen)

- Gemini Image Generation bereits implementiert (Charakter-Portraits, Welt-Ambiance)
- Erweiterung: „Szene visualisieren"-Button im Writer-View
- Optional: Stable Diffusion via Ollama/ComfyUI für lokale Bildgenerierung

---

## v1.2.1 — Release Blockers

**Status:** 📋 Geplant (vor erstem Tauri-Release erforderlich)

- ✅ StorageBackend-Interface — `storageBackend.ts`, strikte `StoryProject`-Typen am Proxy
- ✅ Geführte Tour (Spotlight mit `driver.js`, Dashboard + Hilfe als Einstieg)
- ✅ Tauri Release-Pipeline: GitHub Release mit Installern bei `v*`-Tags — [`docs/TAURI-CI.md`](docs/TAURI-CI.md) / [`tauri-build.yml`](.github/workflows/tauri-build.yml)
- ⬜ Tauri v2 Auto-Update (`tauri-plugin-updater`) + Code-Signing — deferred to dedicated PR
- ✅ FR/ES/IT Key-Parität + CI-Gate (`pnpm run i18n:check`) — qualitative Übersetzungen iterativ
- ✅ Bundle-Size-Budgets + rollup-Analyse als CI (`pnpm run bundle:budget`, `analyze` Artifact — siehe [`docs/CI.md`](docs/CI.md)); optionales LHCI-Performance-Budget weiterhin roadmap-offen

---

## v1.4 — Command Center, Gold-Standard Pipeline & Security Hardening

**Status:** ✅ Released as **v1.4.0** (2026-05-12) — siehe [`CHANGELOG.md`](CHANGELOG.md)

- **Command Center:** `services/commands/` registry + `CommandPalette.tsx` (fuzzy search, recent/pinned, AI suggestions); `CommandExecutorProvider`; global shortcuts (`services/keyboard/`, `useGlobalKeyboardShortcuts.ts`); Settings → Shortcuts
- **Settings hub:** search over control hints; settings JSON import/export
- **Gold-Standard author pipeline:** Binder, research split, compile profile, Pandoc EPUB, VC word-level diff, scene timeline, readability sampling, LanguageTool, local RAG rebuild, WebGPU leader election
- **Hybrid-AI:** local backend presets (Ollama/LM Studio/vLLM), OpenAI-compatible base URL, configurable fallback chain, desktop port scan
- **Security:** all GitHub Actions pinned to SHA, CodeQL SAST, OpenSSF Scorecard, gitleaks, SLSA attestation, Dependabot, branch protection
- **Quality:** pnpm strict config, Lighthouse accessibility error gate (WCAG 2.2)

---

## v1.4.x — Qualitätssteigerung (Master Perfection Plan)

**Status:** ✅ Abgeschlossen (2026-05-16) — Teil-Release von v1.4.0-Zyklus; Details in [`CHANGELOG.md`](CHANGELOG.md) und [`TODO.md`](TODO.md).

### Unit-Test-Coverage: Phase 1–5

- **178 Test-Dateien**, insgesamt **2 024 Tests** (v1.6.2); Vitest-Schwellen auf **63/62/48/54** (Lines/Statements/Branches/Functions)
- Gemessene Coverage (2026-05-20, v1.6.2): **65.91 % Lines · 50.59 % Branches · 56.74 % Functions · 64.25 % Statements** — alle Schwellen grün

### Phase 3A — Cross-Project-Search Service ✅

- `services/crossProjectSearchService.ts`: `searchAcrossProjects()` via `fuzzyScore`, 5 Locales (8 Keys), `transientUiStore`-Integration (`isCrossProjectSearchOpen`), Command-Palette-Command
- v1-Scope: Einzelprojekt (Multi-Projekt erfordert DB_VERSION-Bump)

### Phase 3B — WebLLM Modell-Selektor ✅

- `WEBLLM_SUPPORTED_MODELS` (4 MLC-Checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress`-Parameter, Settings-UI mit Dropdown + WCAG-Fortschrittsanzeige (`role="progressbar"`, `useRef`-Mounted-Guard)
- Lokalisiert in allen 5 Sprachen (3 neue Keys je Locale in `settings.json`)

### Phase 3C — Collaboration Security Warning ✅

- `CollaborationPanel.tsx`: Security-Warning-Banner (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) vor Verbindungsaufbau sichtbar

### Phase 4 — Stryker-Erweiterung + E2E-Tests ✅

- `stryker.conf.json`: 3 weitere Mutations-Ziele (`fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts`)
- `tests/e2e/commands.spec.ts` (Palette Ctrl+K, „dashboard"-Suche, fuzzy „wrt", Enter-Navigate)
- `tests/e2e/collaboration.spec.ts` (Security-Warning-Banner vor Verbindung)

### One-Click Library-Export ✅

- `services/libraryBackupService.ts`: verschlüsselter ZIP-Export (AES-GCM, META.json + vault.bin) → Settings → Data

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

**Status:** 💡 Vision

- Full E2E-Encryption für P2P-Collaboration (RTCDataChannel in-flight encryption)
- Community-Model-Liste (kuratierte Ollama-Modelle für kreatives Schreiben)
- RTL language support (Arabic, Hebrew, Persian)
- Fine-Tuning/LoRA-Support für personalisierte Schreibstile
- Cloud-Sync Option (optional, E2E-verschlüsselt)
- Plugin-System für benutzerdefinierte AI-Tools (build on PluginRegistry)
- AI-Creativity-Presets pro Projekt (nicht global)
- Visual Regression Tests (Playwright Screenshots + Storybook chromatic)

---

## Architektur-Entscheidungen

### Warum Ollama statt OpenAI-kompatibel?

- **Datenschutz:** Alle Daten bleiben lokal
- **Keine Kosten:** Keine API-Gebühren nach Hardware-Investition
- **Flexibilität:** Jedes GGUF-Modell nutzbar
- **Offline:** Funktioniert ohne Internetverbindung

### Warum nicht Full E2E in v1.x?

- **Komplexität:** Yjs-Dokument-Verschlüsselung erfordert Key-Exchange-Protokoll
- **Pragmatismus:** PSK-basierte Room-Isolation bietet bereits guten Schutz
- **Scope:** Focus auf Schreib-UX statt Crypto-Infrastruktur
