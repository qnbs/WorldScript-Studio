# StoryCraft Studio — Codebase Audit Report

**Date:** 2026-04-17 (baseline); **follow-up:** 2026-05-02  
**Scope:** Full application, repository configuration, CI/CD, documentation, release validation  
**Version audited:** 1.1.0 → 1.1.1 (package.json); tooling docs synced with **Node 22**, **Vite 8**, **Biome**, current `ci.yml`

---

## Follow-up Audit — 2026-05-02

### Documentation & DX alignment

- **CI reference** [`docs/CI.md`](docs/CI.md) rewritten to match the live workflow (`security` → `quality` → `build` / `e2e` / `storybook` → `lighthouse`; `deploy` needs `build` + `e2e`). Removed stale references to non-existent jobs (`lint`, `typecheck`, `test` as separate ids; `build-node`; default `tauri` job).
- **Lighthouse config path** standardized to **`.lighthouserc.cjs`** across docs (replacing `.js`/`.json` mentions where incorrect).
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** updated: Node ≥ 22, **Biome** (not ESLint), **simple-git-hooks** + lint-staged, **Vite 8**, Tailwind via Vite plugin, Act examples with real job names, E2E `CI=true` note, i18n selector reality (de/en).
- **[`README.md`](README.md)** CI table + Act examples aligned; new **Documentation Hub** section linking all first-class `.md` guides and **`.cursorrules` (QNBS v3)**.
- **[`.github/ACTIONS-OPTIMIZATIONS.md`](.github/ACTIONS-OPTIMIZATIONS.md)** prefixed with an explicit “historical vs current” disclaimer pointing at `docs/CI.md`.

### Code fix (AI provider)

- **`services/aiProviderService.ts`:** `withMergedAbortSignal()` merges a standalone `AbortSignal` argument into `AIRequestOptions` for **`streamProvider`** and **`generateText`**, so **OpenAI** and **Ollama** honor cancellation the same way as Gemini streaming when callers pass `thunkAPI.signal` (or equivalent) as the optional parameter. Unit tests extended in `tests/unit/aiProviderService.test.ts`.

### Outstanding

- Local validation in this environment requires `pnpm install`; CI remains the canonical full gate (quality matrix, E2E, Lighthouse).

---

## Self-Audit Summary

- `pnpm outdated` identified outdated dependencies that should be reviewed in a follow-up dependency refresh cycle.
- `pnpm audit` baseline in this cycle reported 10 vulnerabilities (4 low, 1 moderate, 4 high, 1 critical).
- `pnpm run lint:fix` completed successfully; 45 existing warnings remain from legacy `any` usage and React hook dependency concerns.
- `pnpm run typecheck` passed without type errors.
- `pnpm run build` completed successfully with production artifact generation.
- `pnpm run test:coverage` passed with 110 tests, 96.1% statements, 81.81% branches, and 97.87% lines.

### Dependency Hardening Update (2026-04-16)

- Implemented conservative dependency remediation in `package.json` and `pnpm-lock.yaml`:
  - Upgraded `jspdf` from `^2.5.1` to `^4.2.1`.
  - Added npm `overrides` for `@lhci/cli` to force modern transitive packages:
    - `chrome-launcher` -> `^1.2.1`
    - `tmp` -> `^0.2.5`
- Removed deprecated transitive chain elements from the active install graph:
  - `inflight@1.0.6` no longer present.
  - `rimraf@2.x/3.x` no longer present.
  - old `glob@7` deprecation path no longer present.
- Remaining deprecation warning is currently limited to `node-domexception@1.0.0`, pulled transitively via:
  - `@google/genai` -> `google-auth-library` -> `gaxios` -> `node-fetch` -> `fetch-blob`.
  - This is currently an upstream dependency-chain constraint.
- Validation after remediation:
  - `pnpm run lint -- --max-warnings=0` passed.
  - `pnpm run typecheck` passed.
  - `pnpm run test:run` passed (113/113 tests).
  - `pnpm run build` passed.
- `pnpm audit` now reports 4 high vulnerabilities (down from 10 total, including 1 critical):
  - all remaining findings are in `vite-plugin-pwa` / `workbox-build` via `@rollup/plugin-terser` -> `serialize-javascript`.
  - npm suggests `vite-plugin-pwa@0.19.8` as a fix path, which is a major backward downgrade from the current line and not applied in this conservative cycle.

## Current Status

- **`pnpm audit` reports 0 vulnerabilities** (0 low, 0 moderate, 0 high, 0 critical) as of 2026-04-17.
- `protobufjs` critical vulnerability resolved via `pnpm audit fix` (upgraded to ≥7.5.5).
- `serialize-javascript` high vulnerabilities resolved via npm overrides (`vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser` → `serialize-javascript@^7.0.5`).
- All localStorage/sessionStorage accesses are now guarded with try/catch for SSR/test safety.
- CI pipeline extended with Security Audit, Lighthouse CI, and Storybook jobs.
- Tauri capabilities updated: added `fs:allow-read-dir` and `fs:allow-remove` permissions.
- AI service utilities deduplicated into shared `services/aiUtils.ts`.
- Bundle analyzer (`rollup-plugin-visualizer`) added as opt-in devDep (`pnpm run analyze`).
- `fileSystemService.ts` type-unsafe references to non-existent `StoryProject.author`/`.description` removed.
- One deprecation (`node-domexception`) remains as an upstream transitive dependency from the Gemini SDK stack — accepted risk, no local fix.
- The repository is stable: build, lint, typecheck, and coverage all pass.

### Light Mode Theming (Resolved 2026-04-17)

- **Fixed:** Tailwind CDN `dark:` prefix was using `media` strategy (OS preference) instead of `selector` strategy (`.dark-theme` body class), causing all `dark:` classes to ignore the in-app theme toggle.
- **Fixed:** ~65 hardcoded dark-mode-only styling patterns (`bg-white/5`, `border-white/5`, `via-white/15`, `bg-black/40`, `ring-white/10`, `via-black/40`, `text-white` on non-interactive backgrounds) replaced with theme-aware CSS custom properties.
- **Added:** 6 new CSS custom properties (`--overlay-backdrop`, `--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight`, `--card-gradient-overlay`) with appropriate values for both dark and light themes.
- **Fixed:** Aurora blob opacity reduced from 0.25 to 0.08 in light mode.

### Tauri Feature Parity (Tech Debt)

`fileSystemService.ts` remains behind `dbService.ts` in the following areas (deferred to a dedicated Tauri hardening sprint):

- No LZ-String compression for stored data
- No auto-snapshot system (manual snapshots only)
- No RAG vector store or Story Codex store
- Snapshot ID type mismatch (`string` vs `number` in dbService)
- No retry logic for filesystem operations
- Missing `deleteImage()` and `hasSavedData()` implementations

## Executive Summary

StoryCraft Studio is a well-architected React 19 + Redux Toolkit PWA with strong TypeScript enforcement, excellent i18n, and sophisticated offline-first data management. The codebase demonstrates mature React patterns and thoughtful accessibility support. Main improvement areas are **test coverage**, **AI request lifecycle management**, and **desktop (Tauri) security hardening**.

### Scorecard

| Aspect           | Rating | Notes                                                      |
| ---------------- | ------ | ---------------------------------------------------------- |
| Type Safety      | ★★★★★  | Strict mode, exactOptionalPropertyTypes                    |
| Architecture     | ★★★★☆  | Clean feature-sliced design, clear patterns                |
| Accessibility    | ★★★★☆  | Strong ARIA, focus management, color-blind modes           |
| i18n             | ★★★★★  | Modular, 5 languages, persistent selection                 |
| PWA / Offline    | ★★★★★  | Workbox, versioned caches, smart strategies                |
| State Management | ★★★★☆  | Redux-Undo well integrated, auto-save validated            |
| Security         | ★★★★☆  | CSP hardened, non-extractable CryptoKey, PSK collab, import validation |
| Test Coverage    | ★★★☆☆  | 113+ unit tests, glob-based coverage, honest all-up thresholds |
| Documentation    | ★★★★★  | README, CONTRIBUTING, ROADMAP, TODO, CHANGELOG, AUDIT      |
| Performance      | ★★★★☆  | Code-splitting with 10+ manual chunks, Lighthouse CI       |
| CI/CD            | ★★★★★  | Full pipeline with hard-fail lint/typecheck + coverage     |

---

## Critical Findings (🔴)

### 1. ~~Hardcoded Language in AI Hooks~~ ✅ FIXED

**Files:** `hooks/useConsistencyCheckerView.ts`, `hooks/useCriticView.ts`
**Issue:** Both hooks passed hardcoded `'en'` to AI service functions instead of reading from user settings.
**Impact:** Non-English users received AI prompts and responses in the wrong language.
**Resolution:** Fixed — now reads `language` from `useTranslation()` and `aiCreativity` from Redux settings selector.

### 2. ~~Tauri CSP is `null` — No Content Security Policy~~ ✅ FIXED

**File:** `src-tauri/tauri.conf.json`
**Issue:** `"security": { "csp": null }` — the desktop app has no Content Security Policy.
**Resolution:** Set comprehensive CSP string including `connect-src` for Gemini API + WebRTC signaling. Identifier fixed to `com.storycraft.studio`, version synced to `1.0.0`. Capabilities narrowed to granular permissions.

### 3. ~~No Request Cancellation for AI Thunks~~ ✅ FIXED

**Files:** `features/project/projectSlice.ts`, `hooks/useWriterView.ts`
**Issue:** AI generation thunks did not accept or use `AbortController` / `AbortSignal`.
**Resolution:** Added `thunkAPI.signal` to all 14 AI-calling thunks. Added AbortController + cleanup to useConsistencyCheckerView and useCriticView hooks. Activated the unused `retry()` function in geminiService.

### 4. ~~Auto-Save Memory Exhaustion Risk~~ ✅ FIXED

**File:** `app/listenerMiddleware.ts`
**Issue:** No validation that `state.project.present` was valid before saving.
**Resolution:** Added null-check for `presentData`, 5MB size warning, and generationHistory capped at 50 entries FIFO.

---

## High Priority Findings (🟡)

### 5. ~~Minimal Test Coverage~~ ✅ IMPROVED

**Previous:** 4 unit test files.
**Current:** 11 unit test files, 80 tests passing. Coverage thresholds (50%) set.
**Remaining:** E2E tests, view hook tests, additional component tests.

### 6. ~~`any` Type Casts in Multiple Hooks~~ ✅ PARTIALLY FIXED

**Files:** `app/hooks.ts`, `app/store.ts`
**Resolution:** Removed `shallowEqual as any` and `preloadedState as any`. Remaining `as any` casts in view hooks (useSceneBoardView, useSettingsView) tracked for future fix.

### 7. ~~Logger Middleware Performance in Dev~~ ✅ FIXED

**File:** `app/store.ts`
**Resolution:** Logger now opt-in via `localStorage.getItem('debugRedux') === 'true'`.

### 8. ~~No Per-View Error Boundaries~~ ✅ FIXED

**File:** `App.tsx`, `components/ui/ErrorBoundary.tsx`
**Resolution:** Added `key={currentView}` for auto-reset on view switch. ErrorBoundary now has `onReset` prop with "Reset View" button.

### 9. ~~P2P Collaboration Without Encryption~~ ✅ IMPROVED

**File:** `services/collaborationService.ts`, `components/CollaborationPanel.tsx`
**Resolution:** Added PSK-based room isolation via SHA-256 room ID derivation. Room password input in CollaborationPanel. Full E2E encryption deferred to v2.0.

### 10. ~~Device-Scoped Encryption Key~~ ✅ FIXED

**File:** `services/dbService.ts`, `components/ApiKeySection.tsx`
**Resolution:** `getGeminiApiKey()` and `getApiKey()` now return `'DECRYPT_FAILED'` on decrypt errors. `hasGeminiApiKey()` filters this value. ApiKeySection shows red warning banner with re-entry prompt.

---

## Medium Priority Findings (🟠)

### 11. ~~No DevContainer Configuration~~ ✅ FIXED

**Resolution:** `.devcontainer/devcontainer.json` added with Node.js LTS image, `corepack enable && pnpm install --frozen-lockfile` as `postCreateCommand`, recommended extensions (ESLint, Prettier, Tailwind CSS IntelliSense), and port forwarding for dev (3000) and Storybook (6006).

### 12. ~~Redundant `deploy.yml` Workflow~~ ✅ FIXED

**Resolution:** No separate `deploy.yml` exists. `ci.yml` handles the full pipeline including deployment to GitHub Pages via `actions/deploy-pages@v4`.

### 13. ~~Version Mismatch: Tauri vs npm~~ ✅ FIXED

**Files:** `src-tauri/tauri.conf.json`, `package.json`
**Issue:** Tauri had version `1.0.0`, package.json `1.1.1`. `frontendDist` pointed to `../build` instead of `../dist` (Vite default output). Window title was lowercase `storycraft-studio`.
**Resolution:** Aligned version to `1.1.1`, fixed `frontendDist` to `../dist`, set proper product name and window title to `StoryCraft Studio`, improved window defaults (1280×800, centered, min size constraints). Narrowed CSP `connect-src` by removing overly broad `https://*.googleapis.com` wildcard.
**Effort:** Low | **Priority:** Low

### 15. ~~No Performance Budgets~~ ✅ FIXED

**Resolution:** Lighthouse CI job added to CI pipeline (`.github/workflows/ci.yml`). Performance budgets defined in `.lighthouserc.cjs` with assertions for Performance ≥ 0.9, FCP ≤ 1800ms, LCP ≤ 2500ms, TBT ≤ 150ms, CLS ≤ 0.1. Bundle analyzer available via `pnpm run analyze`.

### 16. ~~Potential Memory Leaks in ManuscriptView Resize~~ ✅ FIXED

**File:** `components/ManuscriptView.tsx`
**Issue:** Resize event listeners were added in `useCallback` without guaranteed cleanup on unmount.
**Resolution:** Refactored to `useEffect` with `AbortController` + `{ signal }` option and throttled handlers. Cleanup runs on unmount via `controller.abort()`.

---

## New Findings (2026-04-18 Audit)

### 17. ~~Feature-Flag-System~~ ✅ FIXED

**Files:** `features/featureFlags/featureFlagsSlice.ts`, `contexts/FeatureFlagsContext.tsx`, `components/SettingsView.tsx`
**Resolution:** Fully implemented with 3 flags (`enableOllama`, `enablePerformanceBudgets`, `enableVisualRegression`), localStorage persistence via `featureFlagsPersistenceMiddleware`, UI toggle in SettingsView, and `useFeatureFlags()` hook.

### 18. Infinite Loop in codexService.extractStoryCodex ✅ FIXED (v1.1.2)

**File:** `services/codexService.ts` (line 118-127)
**Issue:** `while` loop with `exec()` and three `continue` statements skipped the `match = regex.exec(text)` re-assignment, causing an infinite loop when any matched proper noun was a stopword (e.g. "The"), shorter than 3 chars, or already a known entity. Triggered on virtually every English manuscript.
**Impact:** Browser tab freeze after 1.2s debounced codex extraction on every manuscript edit.
**Resolution:** Replaced `while` + manual `exec()` with `for (const match of text.matchAll(...))` pattern.

### 19. Modal Focus-Trap Cleanup Fragility ✅ FIXED (v1.1.2)

**File:** `components/ui/Modal.tsx`
**Issue:** `useEffect` had two conditional return paths for cleanup. While React's cleanup semantics prevent actual leaks, the pattern was fragile and hard to reason about.
**Resolution:** Consolidated into single cleanup function with early return for `!isOpen`. Added test for body overflow restoration.

### 20. FOUC Theme Initialization ✅ FIXED (v1.1.2)

**File:** `features/settings/settingsSlice.ts`, `index.html`
**Issue:** `applyInitialTheme()` read `localStorage.getItem('storycraft-state')` — a key never written in production (only in tests). `JSON.parse` had no try/catch. Result: flash of wrong theme on every page load.
**Resolution:** Added inline `<script>` in `<head>` reading `storycraft-theme` from localStorage. Theme mirrored to localStorage on save. Wrapped `JSON.parse` in try/catch. Removed dead `storycraft-state` read.

### 21. Untranslated FR/ES/IT Locales ✅ FIXED (v1.1.2)

**Issue:** French, Spanish, Italian locale files contained 96% English strings verbatim. Language selector offered all 5 languages, giving users untranslated UI.
**Resolution:** Removed FR/ES/IT from language selector. Locale files retained for future translation work.

### 22. CryptoKey Derived From Public Inputs ✅ FIXED (v1.2.0)

**File:** `services/dbService.ts`
**Issue:** AES-256-GCM encryption key was derived from `location.origin + hardcoded string + navigator.userAgent` — all publicly reconstructible. Anyone with IndexedDB access could decrypt API keys.
**Resolution:** Replaced with `crypto.subtle.generateKey()` producing a non-extractable `CryptoKey` stored directly in IndexedDB via structured clone. Migration path re-encrypts existing keys automatically.

### 23. CSP img-src Too Permissive ✅ FIXED (v1.2.0)

**File:** `index.html`
**Issue:** `img-src 'self' data: blob: https:` allowed any HTTPS host, enabling image-beacon exfiltration via XSS.
**Resolution:** Tightened to `img-src 'self' data: blob:`. Added `frame-ancestors 'none'` and `upgrade-insecure-requests`.

### 24. Import JSON Without Schema Validation ✅ FIXED (v1.2.0)

**File:** `features/project/projectSlice.ts`
**Issue:** `JSON.parse(text) as ImportedProjectData` — compile-time-only assertion with zero runtime validation. Malformed imports could corrupt state or enable XSS via injected content.
**Resolution:** Added Valibot schema validation before dispatch. Invalid imports show user-facing error toast.

### 25. Dead Code in aiThunkUtils and store ✅ FIXED (v1.1.2)

**Files:** `features/project/aiThunkUtils.ts`, `app/store.ts`
**Issue:** `buildDeduplicationKey` was never imported (dead code). `'persist/PERSIST'` in `ignoredActions` referenced non-existent redux-persist.
**Resolution:** Removed both.

### 26. Coverage Config Vanity Metric ✅ FIXED (v1.2.0)

**File:** `vitest.config.ts`
**Issue:** Coverage included only 24 specific files (those with tests), not the full project. Thresholds measured a curated island, not real coverage.
**Resolution:** Replaced with glob patterns covering all source directories. Thresholds lowered to honest all-up baseline.

### 27. _tempStore Type Derivation — Kept (v1.2.0)

**File:** `app/store.ts`
**Issue:** A second `configureStore()` call at module-import just to derive `RootState`/`AppDispatch` types. Runs serializable check middleware, doubles side effects.
**Resolution:** Investigated — deriving types from `setupStore` return type causes `RootState` to resolve to `unknown` because `storeOptions` is typed as `Parameters<typeof configureStore>[0]` which widens the inferred state. The `_tempStore` approach is the recommended RTK pattern for factory-based store setup. Added clarifying comment. Removed dead `'persist/PERSIST'` from `ignoredActions`.

### 28. Settings Change Triggers Full Project Save ✅ FIXED (v1.2.0)

**File:** `app/listenerMiddleware.ts`
**Issue:** Auto-save listener fired on both project and settings changes, always saving both. Toggling a theme slider triggered full multi-MB project serialization.
**Resolution:** Split into separate listeners: project changes → `saveProject`, settings changes → `saveSettings`.

### 29. testAIConnection('gemini') Returns Fake Success ✅ FIXED (v1.2.0)

**File:** `services/aiProviderService.ts`
**Issue:** `case 'gemini': return { ok: true }` — no actual API call. Users got "connected" confirmation with invalid API keys.
**Resolution:** Added real lightweight API validation call with timeout.

### 30. Silent Model Downgrade in OpenAI Provider ✅ FIXED (v1.2.0)

**File:** `services/aiProviderService.ts`
**Issue:** Non-gpt-prefixed models (e.g. `o1-preview`, `claude-sonnet-4-5`) silently replaced with `gpt-4o-mini`. No warning to user.
**Resolution:** Throws descriptive error instead of silent fallback.

### 31. OpenAI Stream Loop Missing Abort Check ✅ FIXED (v1.2.0)

**File:** `services/aiProviderService.ts`
**Issue:** `while(true) { reader.read() }` loop never checked `signal.aborted`. Cancel action continued streaming until server closed connection.
**Resolution:** Added `signal.aborted` check at loop start.

### 32. communityTemplateService Misleading Error Messages ✅ FIXED (v1.2.0)

**File:** `services/communityTemplateService.ts`
**Issue:** Error messages and comments referenced "GitHub API" but the service fetches local static assets.
**Resolution:** Updated all references to reflect bundled static asset source.

### 33. Collaboration Awareness State Without Validation ✅ FIXED (v1.2.0)

**File:** `services/collaborationService.ts`
**Issue:** Remote peer awareness state cast directly to `CollaborationUser` without validation. Malicious peers could inject arbitrary data.
**Resolution:** Added validation for user id (string, max length), name (string, max 100 chars), and color (hex format).

### 34. SettingsView.tsx 2116 LOC Monolith ✅ FIXED (v1.2.0)

**File:** `components/SettingsView.tsx`
**Issue:** Single 2116-line component — untestable, unreviewable.
**Resolution:** Decomposed into section sub-components (Appearance, AI, Accessibility, Data, Collaboration, FeatureFlags).

---

## Low Priority Findings (🟢)

### 17. No Feature Flags

No mechanism to selectively enable/disable features for rollout or testing.
**Recommendation:** Consider a simple `localStorage`-based feature flag system for experimental features.

### 18. Console Logging Instead of Logging Framework

Multiple `console.log`, `console.warn`, and `console.error` calls throughout the codebase.
**Recommendation:** Create a minimal logging utility that can be configured per-environment and optionally integrated with error tracking (e.g., Sentry).

### 19. ~~Storybook Has Only 3 Stories~~ ✅ FIXED

**Directory:** `stories/`
**Previous:** Button, Card, Input stories.
**Current:** 10 stories — Button, Card, Input, Modal, Toast, Spinner, Drawer, ErrorBoundary, ManuscriptView, plus storybookProviders utility.
**Resolution:** Stories for Modal, Toast, Spinner, Drawer, and ErrorBoundary added with a11y addon assertions.

### 20. No Request Deduplication for AI Calls

**Issue:** Identical AI requests can be sent simultaneously (e.g., double-clicking a generation button).
**Recommendation:** Implement request deduplication in `geminiService.ts` using a pending-request map keyed by a hash of the prompt parameters.

### 21. ~~Render-Blocking Google Fonts `@import`~~ ✅ FIXED

**File:** `index.css` (lines 3–5)
**Issue:** Three `@import url("https://fonts.googleapis.com/...")` statements were render-blocking and required external network requests, breaking offline font loading and widening the CSP surface.
**Resolution:** Replaced with self-hosted `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/merriweather`. Removed `fonts.googleapis.com` from CSP `style-src`/`connect-src` and `fonts.gstatic.com` from `font-src`/`connect-src`. Removed preconnect links and Google Fonts SW cache handler.

---

## Environment & Configuration Findings

### CI/CD Pipeline

- ✅ Full pipeline: security → lint → typecheck → test → build → lighthouse → storybook → deploy
- ✅ Security audit job with `pnpm audit --audit-level=high` and `dependency-review-action`
- ✅ Lighthouse CI job with performance budgets from `.lighthouserc.cjs`
- ✅ Storybook build + artifact upload
- ✅ ESLint and typecheck now run in hard-fail mode (was soft-fail)
- ✅ Coverage thresholds (50%) configured in vitest.config.ts

### Git Configuration

- ✅ `.gitignore` properly configured (fixed: now includes `src-tauri/target/`)
- ✅ Pre-commit: simple-git-hooks + lint-staged (Biome)
- ✅ Conventional Commits recommended in CONTRIBUTING.md

### Biome (lint + format)

- ✅ **Biome** is authoritative ([`biome.json`](biome.json)); `pnpm run lint` / `lint:fix` / Prettier-era duplicates removed from contributor docs
- Pre-commit: **simple-git-hooks** + **lint-staged** → `biome check --write` on staged files

### Package.json

- ✅ `"type": "module"` for ES modules
- ✅ `"private": true` prevents accidental npm publishing
- ⚠️ Watch `pnpm.peerDependencyRules` / overrides when upgrading Vite or vite-plugin-pwa (documented in `package.json`)

---

## Recommended Next Steps (Prioritized)

| #   | Action                                    | Effort | Impact | Priority      |
| --- | ----------------------------------------- | ------ | ------ | ------------- |
| 1   | ~~Add Tauri CSP~~                         | Low    | High   | ✅ Done       |
| 2   | ~~Add AbortController to AI thunks~~      | Medium | High   | ✅ Done       |
| 3   | ~~Validate undo-envelope reconstruction~~ | Low    | High   | ✅ Done       |
| 4   | ~~Add per-view error boundaries~~         | Low    | Medium | ✅ Done       |
| 5   | ~~Make Redux logger opt-in~~              | Low    | Medium | ✅ Done       |
| 6   | ~~Fix `any` type casts~~                  | Medium | Medium | ✅ Partial    |
| 7   | Increase unit test coverage to 60%+       | High   | High   | 🟡 Ongoing    |
| 8   | Add DevContainer configuration            | Low    | Medium | 🟠 Backlog    |
| 9   | Fix ManuscriptView resize memory leak     | Low    | Medium | 🟠 Backlog    |
| 10  | ~~Add performance budgets~~               | Medium | Medium | ✅ Done       |
| 11  | ~~Encrypt P2P collaboration~~             | Medium | Medium | ✅ Done (PSK) |
| 12  | ~~Align Tauri/npm versions~~              | Low    | Low    | ✅ Done       |
| 14  | Add logging framework                     | Medium | Low    | 🟢 Backlog    |

---

## Files Changed in This Audit

| File                                 | Change                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| `hooks/useConsistencyCheckerView.ts` | Fixed hardcoded `'en'` → dynamic language from settings            |
| `hooks/useCriticView.ts`             | Fixed hardcoded `'en'` → dynamic language from settings            |
| `.gitignore`                         | Added `src-tauri/target/`                                          |
| `.prettierrc`                        | Removed (empty duplicate; `.prettierrc.json` is authoritative)     |
| `README.md`                          | Fixed 50+ Markdown lint errors (MD022, MD031, MD032, MD040, MD060) |
| `CHANGELOG.md`                       | Created — Keep a Changelog format                                  |
| `.github/copilot-instructions.md`    | Created — Project coding guidelines for Copilot                    |
| `AUDIT.md`                           | Created — This document                                            |

---

## Historical Baseline Audit (2026-04-15)

The following section preserves the original repository audit performed on 2026-04-15. All critical and high-priority findings from this baseline have since been addressed in the main audit above.

<details>
<summary>Click to expand the 2026-04-15 baseline audit</summary>

### Executive Summary (Baseline)

StoryCraft Studio was assessed as a strong, modern React/TypeScript application with good architectural design, strict TypeScript configuration, and a comprehensive CI/CD pipeline. The largest risks at that time were in the desktop backend implementation, the persistence layer, incomplete test coverage, and inconsistent dev/prod logging.

### Critical Findings (Baseline)

1. **Desktop-Backend stored Provider API keys unencrypted** — `services/fileSystemService.ts` saved keys as plaintext via `saveApiKey()`. → *Resolved: AES-GCM encryption applied.*
2. **Type incompatibility between StorageBackend and dbService** — `services/storageService.ts` defined `StorageBackend` interface but `dbService` had different method signatures. → *Tracked for refactor.*
3. **`AUTO_SNAPSHOT_INTERVAL` mismatch** — `services/dbService.ts` used 30s but comment said 30 minutes. → *Clarified and documented.*
4. **No production logging control** — `console.*` calls scattered across services without environment filtering. → *Logger service introduced (`services/logger.ts`).*
5. **`DECRYPT_FAILED` as API key sentinel** — `dbService.ts` returned the string `'DECRYPT_FAILED'` on decrypt errors instead of `null`. → *Resolved: explicit recovery flow with UI warning added.*

### High-Priority Findings (Baseline)

- Incomplete E2E test coverage → *Ongoing improvement.*
- Storage backend dynamic initialization could cause runtime errors → *Guards added.*
- Scattered `console.*` statements in service files → *Centralized via logger.*
- Auto-save persistence validation at risk from redux-undo format changes → *`serializeProjectForSave()` extraction recommended.*

### Medium-Priority Findings (Baseline)

- No performance budget / bundle limits → *Lighthouse CI added.*
- No per-view Error Boundaries → *Added with recovery button.*
- Feature flag system incomplete → *FeatureFlags slice exists, runtime toggle deferred.*
- No dedicated logging service → *`services/logger.ts` created.*
- Unsafe type casts in `fileSystemService.ts` → *Partially addressed.*

### Low-Priority Findings (Baseline)

- Storybook expansion needed → *10 stories now available.*
- Changelog standardization → *Keep a Changelog format adopted.*
- Outdated dependencies → *Conservative remediation applied.*

### Remediation Steps Applied Post-Baseline

- All `console.log`/`console.warn`/`console.error` calls in app code replaced by central `services/logger.ts` system.
- `public/sw.js` switched to internal `swLogger` for consistent Service Worker logging.
- `features/featureFlags/featureFlagsSlice.ts` corrected (empty object type ESLint error).
- `tests/unit/featureFlagsSlice.test.ts` switched to `import type` for type-only imports.
- ESLint and TypeScript checks pass after all changes.

</details>
