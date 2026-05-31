# StoryCraft Studio — Completed Tasks (v1.1 Cycle)

Archived from `TODO.md` on 2026-04-18. These items were completed during the v1.1 stabilisation and hardening cycle.

For the **current** documentation map (all `.md` guides), see [`README.md`](../README.md#-documentation-hub) § Documentation Hub and [`AUDIT.md`](../AUDIT.md).

---

## Critical (🔴) — All Completed

- ✅ Set Tauri CSP (`src-tauri/tauri.conf.json`)
- ✅ Correct Tauri identifier → `com.storycraft.studio`
- ✅ Synchronize Tauri version → `1.1.1` (aligned with package.json, fixed build path + window config)
- ✅ Restrict Tauri capabilities granularly
- ✅ AbortController for all 14+ AI thunks in projectSlice
- ✅ AbortController for hooks (ConsistencyChecker, Critic)
- ✅ Activate retry() in geminiService (was defined, never called)
- ✅ Auto-save state validation (null-check, 5MB warning)
- ✅ generationHistory FIFO limit (50 entries)

## High (🟡) — All Completed

- ✅ Per-view error boundaries with recovery
- ✅ Remove TypeScript `any` casts (hooks.ts, store.ts)
- ✅ Redux logger opt-in via localStorage
- ✅ Decrypt errors → explicit recovery flow + UI warning
- ✅ Collaboration PSK-based room isolation
- ✅ Unit tests for critical services (geminiService, dbService, projectSlice, writerSlice, settingsSlice, listenerMiddleware, collaborationService)
- ✅ Coverage thresholds (50%) configured
- ✅ CI: lint (Biome) + typecheck on hard-fail
- ✅ manualChunks extended (leaflet, konva, recharts)

## Medium (🟠) — Completed Items

- ✅ Performance budgets (Lighthouse CI)

## Low (🟢) — Completed Items

- ✅ Extend Storybook stories (Modal, Toast, Spinner, Drawer, ErrorBoundary)

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
