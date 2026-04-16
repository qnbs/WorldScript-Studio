# StoryCraft Studio — TODO

Priorisierter Task-Tracker. Status: ✅ erledigt | 🔄 in Arbeit | ⬜ offen

---

## Kritisch (🔴)

- ✅ Tauri CSP setzen (`src-tauri/tauri.conf.json`)
- ✅ Tauri Identifier korrigieren → `com.storycraft.studio`
- ✅ Tauri Version synchronisieren → `1.0.0`
- ✅ Tauri Capabilities granular einschränken
- ✅ AbortController für alle 14+ AI-Thunks in projectSlice
- ✅ AbortController für Hooks (ConsistencyChecker, Critic)
- ✅ retry() in geminiService aktivieren (war definiert, nie aufgerufen)
- ✅ Auto-Save State-Validation (null-check, 5MB-Warnung)
- ✅ generationHistory FIFO-Limit (50 Einträge)

## Hoch (🟡)

- ✅ Per-View Error Boundaries mit Recovery
- ✅ TypeScript `any`-Casts entfernen (hooks.ts, store.ts)
- ✅ Redux Logger opt-in via localStorage
- ✅ Decrypt-Fehler → expliziter Recovery-Flow + UI-Warnung
- ✅ Collaboration PSK-basierte Room-Isolation
- ✅ Unit-Tests für kritische Services (geminiService, dbService, projectSlice, writerSlice, settingsSlice, listenerMiddleware, collaborationService)
- ✅ Coverage-Thresholds (50%) konfiguriert
- ✅ CI: ESLint + Typecheck auf Hard-Fail
- ✅ manualChunks erweitert (leaflet, konva, recharts)

## Mittel (🟠)

- ⬜ E2E-Tests erweitern (Projekt-Flow, Settings)
- ⬜ DevContainer-Konfiguration erstellen
- ⬜ ManuscriptView Resize-Listener Cleanup (Potentieller Memory-Leak)
- ⬜ Request-Deduplizierung für AI-Calls
- ⬜ Performance Budgets (Lighthouse CI)
- ⬜ Feature-Flag-System (localStorage-basiert)
- ⬜ Redundante deploy.yml entfernen

## Niedrig (🟢)

- ✅ Deprecated `backend/epubExport.js` archiviert
- ⬜ Logging-Framework statt console.log/warn/error
- ⬜ Storybook Stories erweitern (Modal, Toast, Spinner, Drawer)
- ⬜ Visual Regression Tests

## Roadmap-Items (→ ROADMAP.md)

- ⬜ Ollama/Local-AI Integration
- ⬜ Codex Auto-Tracking (Story Codex)
- ⬜ Story Bible Light
- ⬜ Szene-Visualisierung im Writer
- ⬜ Mobile-Touch-Optimierungen
- ⬜ Full E2E-Encryption für Collaboration
- ⬜ Plugin-System
