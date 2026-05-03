# StoryCraft Studio — TODO (Current Sprint)

Priorisierter Task-Tracker für den aktuellen Sprint.
Status: 🔄 in Arbeit | ⬜ offen | ✅ erledigt

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

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
- ⬜ Visual Regression Tests (Playwright Screenshots + Storybook) — Stub `tests/e2e/visual-regression.spec.ts` (`describe.skip`, Baselines optional)
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
