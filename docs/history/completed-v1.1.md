# StoryCraft Studio — Completed Tasks (v1.1 Cycle)

Archived from `TODO.md` on 2026-04-18. These items were completed during the v1.1 stabilisation and hardening cycle.

---

## Critical (🔴) — All Completed

- ✅ Tauri CSP setzen (`src-tauri/tauri.conf.json`)
- ✅ Tauri Identifier korrigieren → `com.storycraft.studio`
- ✅ Tauri Version synchronisieren → `1.1.1` (aligned with package.json, fixed build path + window config)
- ✅ Tauri Capabilities granular einschränken
- ✅ AbortController für alle 14+ AI-Thunks in projectSlice
- ✅ AbortController für Hooks (ConsistencyChecker, Critic)
- ✅ retry() in geminiService aktivieren (war definiert, nie aufgerufen)
- ✅ Auto-Save State-Validation (null-check, 5MB-Warnung)
- ✅ generationHistory FIFO-Limit (50 Einträge)

## High (🟡) — All Completed

- ✅ Per-View Error Boundaries mit Recovery
- ✅ TypeScript `any`-Casts entfernen (hooks.ts, store.ts)
- ✅ Redux Logger opt-in via localStorage
- ✅ Decrypt-Fehler → expliziter Recovery-Flow + UI-Warnung
- ✅ Collaboration PSK-basierte Room-Isolation
- ✅ Unit-Tests für kritische Services (geminiService, dbService, projectSlice, writerSlice, settingsSlice, listenerMiddleware, collaborationService)
- ✅ Coverage-Thresholds (50%) konfiguriert
- ✅ CI: ESLint + Typecheck auf Hard-Fail
- ✅ manualChunks erweitert (leaflet, konva, recharts)

## Medium (🟠) — Completed Items

- ✅ Performance Budgets (Lighthouse CI)

## Low (🟢) — Completed Items

- ✅ Storybook Stories erweitern (Modal, Toast, Spinner, Drawer, ErrorBoundary)

---

## Post-v1.1 Hardening Batch (2026-04-18)

The following follow-up tasks were completed after the initial v1.1 archive and are fully implemented:

- ✅ CI Codecov migration to `codecov/codecov-action@v5` (deprecated npm uploader removed)
- ✅ Storybook CI changed to hard-fail mode (`continue-on-error` removed)
- ✅ Lighthouse CI behavior tuned with `--assert.exitCode=0` while keeping crash visibility
- ✅ Added repository security disclosure policy in `.github/SECURITY.md`
- ✅ PWA update flow switched to explicit user consent (no automatic update activation)
- ✅ Removed install-time `self.skipWaiting()` from service worker install path
- ✅ Added y-webrtc signaling failover endpoint (`wss://signaling.yjs.dev`)
- ✅ Extended CSP `connect-src` for signaling fallback and self-hosted worker endpoints
- ✅ Added owner-facing README guidance for self-hosted signaling (Cloudflare Worker path)
- ✅ Replaced `settingsSlice` stub tests with comprehensive reducer/action coverage
- ✅ Added `applyInitialTheme` roundtrip tests (persisted state + auto/system theme resolution)
