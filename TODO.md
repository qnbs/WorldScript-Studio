# StoryCraft Studio — TODO (Current Sprint)

Priorisierter Task-Tracker für den aktuellen Sprint.
Status: 🔄 in Arbeit | ⬜ offen | ✅ erledigt

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

---

## v1.4.x — Qualitätssteigerung (Master Perfection Plan)

> Vollständige **`.md`-Inventur** (19 kuratierte Quellen): [`AUDIT.md`](AUDIT.md) § *Markdown corpus*; Navigation: [`README.md`](README.md#-documentation-hub). Schwere Tests **CI-first**: [`docs/CI.md`](docs/CI.md).

### Hoch (🟡)

- 🔄 Unit-Test-Coverage Zielkorridor **50–70 %** — Phase 1 erreicht (Schwellen 35/30/22/33 gesetzt); gemessene Coverage **~36 % Zeilen / ~30 % Funktionen / ~25 % Branches** (Stand 2026-05-16); Phase 2 (Ziel 50 % Lines) erfordert weitere Branch-Coverage-Arbeit — insbes. große Komponenten, aiProviderService-Streaming, collaborationService
- ✅ **WebLLM Modell-Selektor** — `WEBLLM_SUPPORTED_MODELS` (4 MLC-Checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress`-Parameter, Settings-UI mit Dropdown + Fortschrittsanzeige (WCAG 2.2 `role="progressbar"`, `useRef`-Mounted-Guard) — [`packages/ai-core`](packages/ai-core), [`services/localAiFacade.ts`](services/localAiFacade.ts), [`components/settings/AiSections.tsx`](components/settings/AiSections.tsx)
- ✅ **Cross-Project-Search Service** — `services/crossProjectSearchService.ts`, `searchAcrossProjects()` via fuzzyScore, transientUiStore-Integration (`isCrossProjectSearchOpen`), commandDefinitions-Command — v1: Einzelprojekt (multi-project erfordert DB_VERSION-Bump)
- ✅ **Collaboration Security Warning** — Sicherheitshinweis-Banner in CollaborationPanel (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) vor Verbindungsaufbau sichtbar; verschwindet nach Connect
- ✅ **Phase 1+2 Unit Tests** — 17 neue Test-Dateien, 733 Tests gesamt; Vitest-Schwellen auf 35/30/22/33 erhöht (zuvor 25/21/17/24)
- ✅ **Stryker Erweiterung (Phase 4)** — `fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts` als zusätzliche Mutations-Ziele
- ✅ **E2E-Tests (Phase 4)** — `commands.spec.ts` (Palette Ctrl+K, „dashboard"-Suche, fuzzy „wrt", Enter-Navigate), `collaboration.spec.ts` (Security-Warning-Banner sichtbar vor Verbindung)
- ✅ **One-Click** verschlüsselter **Library-Export** (ZIP + AES-GCM, META.json + vault.bin) — [`services/libraryBackupService.ts`](services/libraryBackupService.ts), Settings → Data
- ✅ **WebLLM** als wählbarer Provider (`webllm/browser`, Privacy wie Ollama) — [`services/aiProviderService.ts`](services/aiProviderService.ts), [`packages/ai-core`](packages/ai-core)

### Niedrig (🟢)

- ✅ Vollständige Markdown-Doku-Synchronisation (README Hub, CONTRIBUTING, docs/CI, AUDIT, Copilot, CLAUDE, SECURITY, TAURI/graphify, CHANGELOG/ROADMAP/TODO) — 2026-05-16

---

## v1.2.0 — Security & Quality

### Hoch (🟡)

- ✅ E2E-Tests erweitern (Projekt-Import, Charakter-CRUD, Snapshot-Flow + Auto-Snapshot)
- ✅ StorageBackend-Interface — `services/storageBackend.ts` als Kontrakt, `StorageManager.saveProject(StoryProject)`
- ✅ Logger mit Ringbuffer + Sink für Crash-Diagnose

### Mittel (🟠)

- ✅ Signaling-URL für Collaboration in Settings konfigurierbar machen (`webrtcSignalingUrls`, Einstellungen → Zusammenarbeit)
- ⬜ Yjs E2E-Verschlüsselung (libsodium SecretBox, deferred to v2.0)

### Niedrig (🟢)

- ✅ Dokumentations-Audit (CI.md, README Hub, CONTRIBUTING, AUDIT-Follow-up, Copilot/CLAUDE/SECURITY/Graphify) — 2026-05-02
- ✅ Visual Regression (`tests/e2e/visual-regression.spec.ts`) — Chromium-Baseline unter `tests/e2e/*-snapshots/` (`snapshotPathTemplate` ohne OS-Suffix)
- ✅ Bundle-Size-Budgets + rollup-Analyse in CI (`pnpm run bundle:budget`, `pnpm run analyze`, Artifact `bundle-analysis`)
- ✅ FR/ES/IT Key-Parität + CI-Gate (`pnpm run i18n:check`) — inhaltliche Übersetzungen können iterativ verbessert werden
- ✅ Renovate Auto-Merge für Patch-Updates ([`renovate.json`](renovate.json))
- ✅ Onboarding-Spotlight-Tour (`driver.js`, Dashboard + Hilfe)
- ⬜ Tauri v2 Release-Pipeline: auto-update + code-signing — **Installer an GitHub Releases** bei `v*`-Tags ✅ ([`docs/TAURI-CI.md`](docs/TAURI-CI.md))

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
