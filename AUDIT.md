# StoryCraft Studio — Codebase Audit Report

**Date:** 2026-04-17
**Scope:** Full application, repository configuration, CI/CD, documentation, release validation
**Version audited:** 1.1.0 → 1.1.1 (package.json)

---

## Self-Audit Summary

- `npm outdated` identified outdated dependencies that should be reviewed in a follow-up dependency refresh cycle.
- `npm audit` baseline in this cycle reported 10 vulnerabilities (4 low, 1 moderate, 4 high, 1 critical).
- `npm run lint:fix` completed successfully; 45 existing warnings remain from legacy `any` usage and React hook dependency concerns.
- `npm run typecheck` passed without type errors.
- `npm run build` completed successfully with production artifact generation.
- `npm run test:coverage` passed with 110 tests, 96.1% statements, 81.81% branches, and 97.87% lines.

### Dependency Hardening Update (2026-04-16)

- Implemented conservative dependency remediation in `package.json` and `package-lock.json`:
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
  - `npm run lint -- --max-warnings=0` passed.
  - `npm run typecheck` passed.
  - `npm run test:run` passed (113/113 tests).
  - `npm run build` passed.
- `npm audit` now reports 4 high vulnerabilities (down from 10 total, including 1 critical):
  - all remaining findings are in `vite-plugin-pwa` / `workbox-build` via `@rollup/plugin-terser` -> `serialize-javascript`.
  - npm suggests `vite-plugin-pwa@0.19.8` as a fix path, which is a major backward downgrade from the current line and not applied in this conservative cycle.

## Current Status

- **`npm audit` reports 0 vulnerabilities** (0 low, 0 moderate, 0 high, 0 critical) as of 2026-04-17.
- `protobufjs` critical vulnerability resolved via `npm audit fix` (upgraded to ≥7.5.5).
- `serialize-javascript` high vulnerabilities resolved via npm overrides (`vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser` → `serialize-javascript@^7.0.5`).
- All localStorage/sessionStorage accesses are now guarded with try/catch for SSR/test safety.
- CI pipeline extended with Security Audit, Lighthouse CI, and Storybook jobs.
- Tauri capabilities updated: added `fs:allow-read-dir` and `fs:allow-remove` permissions.
- AI service utilities deduplicated into shared `services/aiUtils.ts`.
- Bundle analyzer (`rollup-plugin-visualizer`) added as opt-in devDep (`npm run analyze`).
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
| Security         | ★★★★☆  | CSP set, capabilities scoped, PSK collab, decrypt recovery |
| Test Coverage    | ★★★★☆  | 113 unit tests, 17 files, 96% statements, 82% branches     |
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

### 11. No DevContainer Configuration

**Status:** The repository runs in GitHub Codespaces without a `.devcontainer/` folder.
**Impact:** New contributors must manually set up their environment.
**Recommendation:** Create `.devcontainer/devcontainer.json` with:

- Node.js LTS image
- `npm install` as `postCreateCommand`
- Recommended extensions: ESLint, Prettier, Tailwind CSS IntelliSense
- Port forwarding: 3000 (dev), 6006 (Storybook)

**Effort:** Low | **Priority:** Medium

### 12. Redundant `deploy.yml` Workflow

**Files:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
**Issue:** `ci.yml` already handles the full pipeline including deployment. `deploy.yml` appears to be a legacy workflow.
**Recommendation:** Verify `deploy.yml` is not referenced elsewhere, then remove it.
**Effort:** Low | **Priority:** Low

### 13. ~~Version Mismatch: Tauri vs npm~~ ✅ FIXED

**Files:** `src-tauri/tauri.conf.json`, `package.json`
**Issue:** Tauri had version `1.0.0`, package.json `1.1.1`. `frontendDist` pointed to `../build` instead of `../dist` (Vite default output). Window title was lowercase `storycraft-studio`.
**Resolution:** Aligned version to `1.1.1`, fixed `frontendDist` to `../dist`, set proper product name and window title to `StoryCraft Studio`, improved window defaults (1280×800, centered, min size constraints). Narrowed CSP `connect-src` by removing overly broad `https://*.googleapis.com` wildcard.
**Effort:** Low | **Priority:** Low

### 15. ~~No Performance Budgets~~ ✅ FIXED

**Resolution:** Lighthouse CI job added to CI pipeline (`.github/workflows/ci.yml`). Performance budgets defined in `.lighthouserc.js` with assertions for Performance ≥ 0.9, FCP ≤ 1800ms, LCP ≤ 2500ms, TBT ≤ 150ms, CLS ≤ 0.1. Bundle analyzer available via `npm run analyze`.

### 16. Potential Memory Leaks in ManuscriptView Resize

**File:** `components/ManuscriptView.tsx` (line ~67-79)
**Issue:** Resize event listeners are added in `useCallback` but cleanup depends on `stopResizing` being called. If the component unmounts during a resize, listeners may not be removed.
**Recommendation:** Move listeners to `useEffect` with proper cleanup functions.
**Effort:** Low | **Priority:** Medium

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

---

## Environment & Configuration Findings

### CI/CD Pipeline

- ✅ Full pipeline: security → lint → typecheck → test → build → lighthouse → storybook → deploy
- ✅ Security audit job with `npm audit --audit-level=high` and `dependency-review-action`
- ✅ Lighthouse CI job with performance budgets from `.lighthouserc.js`
- ✅ Storybook build + artifact upload
- ✅ ESLint and typecheck now run in hard-fail mode (was soft-fail)
- ✅ Coverage thresholds (50%) configured in vitest.config.ts

### Git Configuration

- ✅ `.gitignore` properly configured (fixed: now includes `src-tauri/target/`)
- ✅ Husky pre-commit hooks with lint-staged (Prettier + ESLint)
- ✅ Conventional Commits recommended in CONTRIBUTING.md

### Prettier Configuration

- ✅ `.prettierrc.json` is authoritative (fixed: removed empty duplicate `.prettierrc`)
- Config: `semi: true`, `singleQuote: true`, `trailingComma: "es5"`, `printWidth: 100`, `tabWidth: 2`

### Package.json

- ✅ `"type": "module"` for ES modules
- ✅ `"private": true` prevents accidental npm publishing
- ⚠️ `--legacy-peer-deps` required in CI — indicates dependency resolution conflicts

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
