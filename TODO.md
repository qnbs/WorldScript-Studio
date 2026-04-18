# StoryCraft Studio — TODO (Current Sprint)

Priorisierter Task-Tracker für den aktuellen Sprint.
Status: 🔄 in Arbeit | ⬜ offen | ✅ erledigt

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

---

## v1.2.0 — Security & Quality

### Hoch (🟡)

- ⬜ E2E-Tests erweitern (Projekt-Import, Charakter-CRUD, Snapshot-Flow)
- ⬜ Tauri-Parität: 6 fehlende Features (Kompression, Auto-Snapshot, Retry, deleteImage, hasSavedData, Snapshot-ID-Typ)
- ⬜ StorageBackend-Interface strikt durchsetzen (Union-Typ entfernen, dbService konform machen)
- ⬜ Logger mit Ringbuffer + Sink für Crash-Diagnose

### Mittel (🟠)

- ⬜ projectSlice.ts in Thunk-Module splitten (14 AI-Thunks → thunks/ Verzeichnis)
- ⬜ Signaling-URL für Collaboration in Settings konfigurierbar machen
- ⬜ Yjs E2E-Verschlüsselung (libsodium SecretBox, deferred to v2.0)

### Niedrig (🟢)

- ⬜ Visual Regression Tests (Playwright Screenshots + Storybook)
- ⬜ Bundle-Size-Budgets pro Chunk (rollup-plugin-visualizer in CI)
- ⬜ FR/ES/IT Übersetzungen vervollständigen + CI-Gate
- ⬜ Renovate Auto-Merge für Patch-Updates konfigurieren

---

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
