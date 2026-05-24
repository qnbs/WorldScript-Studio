# StoryCraft Studio — Agent Guide

> This file is written for AI coding agents. It assumes you know nothing about the project. Every claim below is derived from the actual codebase — do not generalize beyond what is documented here.

---

## Project Overview

**StoryCraft Studio** is an offline-first, AI-powered creative writing application. It is a React 19 SPA that runs in the browser as a PWA and can also be packaged as a desktop app via Tauri 2. There is no backend server; all project data lives locally (IndexedDB in the browser, filesystem in Tauri). Cloud AI providers are optional and user-triggered only.

- **Primary deploy target:** Static SPA on GitHub Pages (`/StoryCraft-Studio/` base path)
- **Secondary targets:** Vercel (root base) and Cloudflare Pages via edge builds
- **Desktop:** Tauri 2 bundles for Linux, macOS, and Windows; auto-updater enabled
- **License:** MIT

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥ 22 (`.nvmrc`), pnpm ≥ 10 (`packageManager` field) |
| Framework | React 19, TypeScript ~6.0 (strict) |
| Build tool | Vite 8 (`vite.config.ts`) |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite` + semantic CSS custom properties (`index.css`) |
| State | Redux Toolkit 2.x + `redux-undo` (project slice only); Zustand for transient UI (`app/transientUiStore.ts`) |
| Testing | Vitest 4 (jsdom, `maxWorkers: 1`), Playwright 1.60 (E2E, CI-only), Stryker 9 (mutation) |
| Lint/Format | Biome 2.4.15 (`biome.json`) — single toolchain for JS/TS/CSS |
| AI | Multi-provider: Google Gemini (`@google/genai`), OpenAI, Ollama, WebLLM, ONNX Runtime Web, Transformers.js |
| Voice | Web Speech API (fallback); WASM engines prepared (Whisper.cpp, Kokoro, Piper, Silero VAD, Sherpa-ONNX) |
| Storage | IndexedDB (`dbService.ts`) / Tauri filesystem (`fileSystemService.ts`); LZ-String compression; AES-256-GCM encryption for API keys |
| PWA | `vite-plugin-pwa` with `injectManifest` strategy (`public/sw.js`) |
| Desktop | Tauri 2 (`src-tauri/`) — Rust toolchain required |
| Storybook | Storybook 10 with `@storybook/react-vite` |
| Orchestration | Turborepo (`turbo.json`) for parallel task caching; pnpm workspaces (`packages/*`) |

---

## Project Structure

```
StoryCraft-Studio/
├── app/                    # Redux store setup, typed hooks, listener middleware, Zustand transient store
├── components/             # React view components; components/ui/ = design-system primitives
│   ├── ui/                 # Atoms: Button, Modal, Toast, Input, etc.
│   ├── manuscript/         # ManuscriptView sub-components
│   ├── scene-board/        # Plot Board v2 (Swimlane, Canvas, Timeline)
│   ├── dashboard/          # Dashboard cards and widgets
│   ├── settings/           # Settings sections
│   ├── help/               # Help view sub-components
│   └── …
├── contexts/               # One React context per major view + I18nContext + CommandExecutorContext + LiveRegionContext
├── features/               # Redux Toolkit slices
│   ├── project/            # Core project state (undo-able via redux-undo)
│   ├── settings/           # App settings (AI keys, appearance, accessibility, shortcuts)
│   ├── status/             # App-wide status / loading flags
│   ├── writer/             # Writer view state
│   ├── versionControl/     # Snapshots and branches
│   ├── featureFlags/       # 12 experimental flags (all off by default)
│   ├── plotBoard/          # Ephemeral viewport/draw state (NOT undo-able; localStorage)
│   ├── progressTracker/    # Writing sessions, streaks, goals
│   ├── sceneComments/      # Per-scene comments (EntityAdapter)
│   ├── analytics/          # DuckDB boot/migration status
│   ├── mindMap/            # Mind-map viewport state
│   └── voice/              # Voice command state
├── hooks/                  # View business logic hooks (use*View.ts naming)
├── services/               # External adapters and business logic
│   ├── ai/                 # Vercel AI SDK orchestration layer (Strangler pattern)
│   ├── commands/           # Command palette registry, fuzzy search, preferences
│   ├── duckdb/             # DuckDB-WASM client, schema, analytics, migration
│   ├── help/               # Help catalog, search, doc retrieval
│   ├── keyboard/           # Shortcut normalization and conflict detection
│   └── … (aiProviderService, geminiService, dbService, storageService, collaborationService, etc.)
├── packages/               # Internal pnpm workspace packages
│   ├── ai-core/            # WebLLM + inference worker + tab-leader election
│   └── ui/                 # Tailwind preset + design tokens
├── locales/                # i18n source JSON modules (de, en, fr, es, it)
├── public/                 # Static assets; runtime i18n bundles `public/locales/<lang>/bundle.json`
├── tests/
│   ├── unit/               # Vitest tests (co-located with source naming)
│   ├── e2e/                # Playwright specs
│   └── setup.ts            # Global Vitest setup (jsdom mocks, IDB mock, console silencing)
├── workers/                # Web Workers: inference.worker.ts, duckdbWorker.ts
├── scripts/                # Build/deploy helpers (i18n bundle, SW version sync, bundle budget, etc.)
├── infra/low-end-ci/       # Local CI stack for constrained hardware (act + Forgejo)
├── src-tauri/              # Tauri 2 desktop app (Rust)
├── docs/                   # Deep-dive docs: CI.md, DEPLOYMENT.md, ACCESSIBILITY.md, BEST-PRACTICES.md, etc.
├── types.ts                # Core shared TypeScript interfaces
└── types/                  # Supplemental type declarations (duckdb-wasm-worker.d.ts, tauri-plugins.d.ts)
```

### Key Files

- `package.json` — scripts, dependencies, pnpm overrides, `simple-git-hooks` + `lint-staged`
- `vite.config.ts` — dev server (port 3000), PWA plugin, manual chunks, `@tauri-apps/*` externalized for web builds
- `tsconfig.json` — `strict: true`, `exactOptionalPropertyTypes: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noUncheckedIndexedAccess: true`
- `biome.json` — lint + format rules; `a11y`, `security`, `correctness` rules enabled; line width 100; 2-space indent
- `vitest.config.ts` — coverage thresholds (lines 63, branches 55, functions 54, statements 62), `maxWorkers: 1`
- `playwright.config.ts` — E2E projects: Chromium desktop + Pixel 5 mobile in CI; Firefox + optional mobile locally
- `turbo.json` — task graph for `build`, `dev`, `lint`, `typecheck`, `test`
- `pnpm-workspace.yaml` — workspace packages + `onlyBuiltDependencies` allowlist
- `stryker.conf.json` — 13 mutation targets (services + features), `break: null` (informational)
- `.lighthouserc.cjs` — accessibility `error` ≥ 0.95, CLS `error` ≤ 0.1, performance/SEO `warn`
- `src-tauri/tauri.conf.json` — desktop window config, CSP, updater endpoints

---

## Build and Development Commands

```bash
# Development
pnpm run dev                # Vite dev server on http://localhost:3000
pnpm run dev:tauri          # Tauri desktop app (requires Rust)

# Build
pnpm run build              # Production build → dist/ (GitHub Pages base)
pnpm run build:edge         # Edge build (root base) for Vercel / Cloudflare Pages
pnpm run preview            # Preview production build locally (port 4173)

# Code quality
pnpm run lint               # Biome lint (--error-on-warnings)
pnpm run lint:fix           # Biome check --write (lint + format)
pnpm run format             # Biome format only
pnpm run typecheck          # tsc --noEmit
pnpm run i18n:check         # Locale key parity vs English + rebuild bundles

# Testing
pnpm run test               # Vitest watch mode
pnpm run test:run           # Vitest single run
pnpm run test:coverage      # Vitest with V8 coverage (enforces thresholds)
pnpm run test:e2e           # Playwright E2E (CI=true required; CI-only by policy)
pnpm run test:vrt           # Visual regression (Chromium only)
pnpm run mutation           # Stryker mutation testing

# Analysis / budgets
pnpm run analyze            # Rollup visualizer → dist/bundle-analysis.html
pnpm run bundle:budget      # Chunk size guard (max 7000 KB total, 4500 KB entry)
pnpm run storybook          # Storybook dev server on :6006
pnpm run build-storybook    # Static Storybook build

# Tauri
pnpm run tauri:dev          # Tauri dev
pnpm run tauri:build        # Tauri production build

# Quick local CI (low-end hardware)
pnpm run ci:quick           # lint + typecheck + i18n + unit tests (no coverage)
pnpm run ci:quick:unit      # lint + typecheck + i18n only
```

---

## Code Style and Conventions

### TypeScript

- `strict: true` and `exactOptionalPropertyTypes: true` are enforced. Do not assign `undefined` to optional properties; omit the property instead.
- Avoid `any`. Use proper types or `unknown`. Biome flags `noExplicitAny` as error.
- `noUnusedLocals`, `noUnusedParameters`, `noUnusedImports`, `noImplicitReturns`, and `noUncheckedIndexedAccess` are all enabled.
- Event handler props use `onX` prefix. Boolean props use `is*` / `has*` prefix.

### Styling

- **NEVER use the `dark:` Tailwind prefix.** Theming is body-class based (`.light-theme`, `.dark-theme`, `.sepia-theme`, etc.). Use CSS custom properties: `bg-[var(--sc-surface-base)]`.
- Design tokens in `index.css` use `--sc-*` naming. Special families: `--glass-*`, `--nav-*`, `--radius-sc-*`, `--icon-sc-*`, `--text-sc-*`.
- `packages/ui/tailwind-preset.ts` registers `w/h-icon-sc-*`, `text-sc-*`, `rounded-sc-*`, etc. Prefer these for atoms.
- Container queries are used for resizable panels; set `containerType: 'inline-size'` inline and use `@container` queries.

### Component Patterns

- Every major view follows a **three-file pattern**:
  - `components/Xyz.tsx` — pure rendering only
  - `hooks/useXyzView.ts` — business logic, selectors, thunks
  - `contexts/XyzContext.ts` — React context passing hook return to children
- Use `React.memo()` for expensive renders; `React.forwardRef()` for `components/ui/` primitives.
- Wrap view roots with `components/ui/ViewErrorBoundary.tsx`.
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors.

### Comments

On any non-trivial change, add a single-line comment explaining **why**, not what:

| Context | Syntax |
|---------|--------|
| TS / JS | `// QNBS-v3: <reason / impact>` |
| TSX / JSX | `// QNBS-v3: …` above the line; `{/* QNBS-v3: … */}` only when needed inside JSX |
| CSS | `/* QNBS-v3: … */` |
| Config (JSON, YAML) | No inline comments — explain in the commit message |

### Commit Messages

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
Pre-commit hook runs `biome check --write` on staged files via `simple-git-hooks` + `lint-staged`.

---

## Testing Instructions

### Philosophy

- **Cloud CI-first:** The canonical quality gate is GitHub Actions. Low-end local machines should run only the "Quick" tier.
- **Quick tier (local, before every push):** `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`. Optionally: `pnpm exec vitest run` **without** `--coverage`.
- **Heavy tier (CI):** Vitest with coverage thresholds, Playwright E2E (desktop + mobile emulation), Lighthouse CI, Stryker mutation, Storybook static build, bundle budget + analyze.

### Unit Tests (Vitest)

- Config: `vitest.config.ts`
- Environment: `jsdom` (default); Node environment for IDB-heavy tests (`// @vitest-environment node`)
- Setup: `tests/setup.ts` — mocks `localStorage`, `matchMedia`, `speechSynthesis`, `indexedDB`, silences `console.log`
- **Concurrency:** `maxWorkers: 1` is mandatory. Tests run serially. Do not parallelize.
- **Coverage thresholds:** lines ≥ 63, branches ≥ 55, functions ≥ 54, statements ≥ 62
- **Determinism:** Mock `Date.now()`, use fake timers, reset global state in `beforeEach`. Never depend on real network or test execution order.
- **User interactions:** Use `@testing-library/user-event`, not `.click()` directly. Use `findBy*` / `waitFor` for async assertions.
- **IDB tests:** Instantiate `new IDBFactory()` per test in `beforeEach` + call `_resetDbForTest()`.
- **DuckDB tests:** Mock `services/duckdb/duckdbClient` — never initialize real DuckDB-WASM in unit tests.

### E2E Tests (Playwright)

- **CI-only by policy:** `CI=true` is required (`pnpm run test:e2e`). CI runs Chromium desktop + Pixel 5 mobile. Locally, Firefox is included; mobile only with `RUN_MOBILE_E2E=1`.
- **Base URL:** `http://127.0.0.1:3000/StoryCraft-Studio`
- **Do NOT use `networkidle`** against the Vite dev server (HMR keeps WebSocket open). Use `waitForSpaReady()` from `tests/e2e/helpers.ts`.
- **Helpers:** `ensureBlankProject()`, `selectEnglish()`, `sidebar(page)` (scopes to `#sidebar`).
- **Accessibility smoke:** `tests/e2e/a11y.spec.ts` runs axe-core on welcome route and Settings → Accessibility.
- **Visual regression:** Baselines under `tests/e2e/*-snapshots/`. `snapshotPathTemplate` omits OS segment so one PNG works on Linux CI and local dev machines.

### Mutation Testing (Stryker)

- Config: `stryker.conf.json`
- Targets: 13 files across `services/`, `features/`, `app/`
- `break: null` — informational only. CI job uses `continue-on-error: true`.

### Storybook

- Stories live in `stories/`. All `components/ui/` primitives should have a story.
- `storybookProviders.tsx` wraps stories with required contexts.

---

## CI/CD and Deployment

### Pipeline Graph

```
security ──► quality ──┬──► build ──► lighthouse
                       ├──► e2e
                       ├──► storybook
                       └──► mutation (informational)

build (main, non-PR) ──► upload-pages-artifact
deploy (main, non-PR) needs: build + e2e ──► GitHub Pages
```

### Jobs

| Job | Purpose |
|-----|---------|
| `security` | `pnpm audit`, OSV scanner (npm + Rust lockfiles), gitleaks secrets scan, dependency review on PRs |
| `quality` | Node 22 + 24 matrix → Biome lint, `i18n:check`, `tsc`, Vitest + coverage, Codecov upload |
| `build` | Production build, bundle budget, analyze artifact, SLSA build provenance attestation on `main` |
| `e2e` | Playwright Chromium desktop + mobile emulation (`CI=true`) |
| `mutation` | Stryker run (`continue-on-error: true`) |
| `lighthouse` | LHCI against built `dist` (hard-fail on accessibility and CLS) |
| `storybook` | Static Storybook build → artifact |
| `deploy` | Only `main` push: GitHub Pages deploy |

### Desktop Releases

- `tauri-build.yml` runs on-demand / tag push. `v*` tags publish installers on a GitHub Release.
- Artifacts: `.appimage`, `.msi`, `.dmg` + `latest.json` updater manifest.

### Deployment Targets

| Target | Build Command | Vite Base |
|--------|---------------|-----------|
| GitHub Pages (canonical) | `pnpm run build` | `/StoryCraft-Studio/` |
| Vercel | `pnpm run build:edge` | `/` |
| Cloudflare Pages | `pnpm run build:edge` | `/` |

Edge builds run `scripts/build-edge.mjs` which sets `DEPLOY_TARGET=edge` and patches manifest/offline/404 files.

---

## Security Considerations

- **No build-time secrets.** API keys are entered via Settings UI and stored encrypted in IndexedDB (AES-256-GCM). Do not put AI keys in `.env` or host environment variables for inference.
- **CSP:** Defined in `index.html` (web) and `src-tauri/tauri.conf.json` (desktop). Extend `connect-src` only when adding new AI hosts.
- **No `dangerouslySetInnerHTML` without DOMPurify.** Biome flags `noDangerouslySetInnerHtml` as error.
- **Never log API keys, IVs, or plaintext payloads.** Use `services/logger.ts` (ring-buffer + sink). `console.log` is warned by Biome in production paths.
- **Service Worker:** AI hosts are network-only (`public/sw.js`). WASM/ONNX chunks are excluded from precache.
- **Supply-chain:** SHA-pinned GitHub Actions, Dependabot weekly updates, OpenSSF Scorecard, CodeQL SAST, SLSA build provenance on `main`.
- **Collaboration:** Yjs + y-webrtc with AES-256-GCM E2E encryption (PBKDF2, 310k iterations). Signaling URLs are user-configurable.
- **Tauri isolation:** `vite.config.ts` externalizes `/^@tauri-apps\//` so web builds never bundle Tauri APIs. Abstract Tauri calls through `services/tauriRuntime.ts`.

---

## State Management and Architecture Patterns

### Redux

- `app/store.ts` configures the store with `combineReducers`.
- `project` slice is wrapped with `redux-undo` (100-step limit). Thunk actions (`/pending`, `/fulfilled`, `/rejected`) are filtered from undo history.
- All other slices are plain Redux Toolkit reducers.
- `features/voice/voiceSlice.ts` holds runtime voice state (mode, transcript, engine status, dictation, microphone permission). Not undo-able.
- Side effects (auto-save, Codex extraction, DuckDB dual-write, cross-project indexing) live in `app/listenerMiddleware.ts` — **not** in components or hooks.
- Use typed hooks everywhere: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`.

### Transient UI State

- `app/transientUiStore.ts` (Zustand) holds ephemeral UI state: command palette open, cross-project search open, etc.
- Do not introduce a third state framework.

### Persistence

- `storageService.ts` → `StorageBackend` auto-detects IndexedDB (web) vs. Tauri filesystem.
- `dbService.ts` wraps dual IndexedDB databases with LZ-String compression (payloads > 10 KB) and AES-256-GCM encryption for API keys.
- Never use raw IndexedDB or `localStorage` for sensitive data.

### Feature Flags

- `features/featureFlags/featureFlagsSlice.ts` gates 12 experimental flags + `enableVoiceSupport` (all off by default).
- UI: Settings → Experimental flags.
- Do not use scattered `if (true)` hacks.

### Code Splitting

- All 14 views are lazy-loaded in `App.tsx` via `React.lazy()`.
- Heavy libraries live in Vite manual chunks: `export-vendor-pdf`, `export-vendor-docx-ebook`, `collaboration-vendor`, `data-vendor`, `ai-vendor`, `ai-sdk-vendor`, `vendor-ai-onnx`, `vendor-duckdb`, `plot-board`.
- `listenerMiddleware.ts` and `aiApi.ts` use dynamic imports for DuckDB/RAG/provider init to keep cold-start fast.

---

## AI Services Architecture

### Legacy Path

- `geminiService.ts` — primary adapter for legacy thunks (Gemini API, retry logic, prompt construction).
- `aiProviderService.ts` — multi-provider abstraction (Gemini, OpenAI, Ollama, WebLLM, ONNX, Transformers.js).

### Voice Services Architecture

- `services/voice/voiceTypes.ts` — Core interfaces: `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`.
- `services/voice/voiceCommandService.ts` — Singleton orchestrator; bridges engines with Redux and app commands via state machine.
- `services/voice/intentEngine.ts` — `HybridIntentEngine`: exact template → Jaccard fuzzy → slot extraction.
- `services/voice/sttEngine.ts` / `ttsEngine.ts` / `vadEngine.ts` / `wakeWordEngine.ts` — Engine implementations with factories.
- `services/voice/feedbackService.ts` — TTS feedback orchestration (3 verbosity levels).
- `services/voice/audioNavigator.ts` — ARIA landmark scanning and focus management.
- `hooks/useVoice.ts` — Primary React bridge; syncs Redux settings to `VoiceCommandService`.
- Voice is **opt-in** via `featureFlags.enableVoiceSupport` + `settings.voice.enabled`.

### New Path (Vercel AI SDK)

- `services/ai/index.ts` — canonical entry; exports orchestration layer built on `@ai-sdk/google`, `@ai-sdk/openai`, and the `ai` package.
- `providerFactory.ts` — `LanguageModel` factory.
- `storyCraftCompletionFetch.ts` — custom fetch adapter.
- `aiPolicy.ts` — `assertCloudAiAllowed` gates all cloud AI calls.
- `aiRetry.ts` — `withTransientRetry(fn, opts)` wraps provider calls with transient-error retries.
- `hooks/useStoryCraftAI.ts` — wraps `useCompletion` from `@ai-sdk/react`.

### Local Inference

- 4-layer stack: WebLLM → ONNX Runtime Web → Transformers.js → heuristics fallback.
- `services/localAiFacade.ts` wraps WebLLM via `packages/ai-core` + `workers/inference.worker.ts`.
- Tab-leader election via BroadcastChannel prevents multi-tab GPU contention.
- `workers/inference.worker.ts` runs `@xenova/transformers` off the main thread.

### Local RAG

- `services/localRagIndex.ts` + `services/localRagService.ts` — hybrid retrieval (60% semantic MiniLM-L6-v2 + 30% lexical + 10% recency).
- Lazy-loaded; never sends data to the cloud.
- `services/ragPromptAssembly.ts` builds token-budgeted context blocks.
- Prompt templates: `services/promptLibrary.ts`.

### DuckDB Analytics

- `workers/duckdbWorker.ts` runs DuckDB-WASM off main thread (OPFS persistence → in-memory fallback).
- `services/duckdb/duckdbClient.ts` is a singleton proxy with AbortSignal and init retry.
- Schema (`duckdbSchema.ts`): 10 tables + 5 views including `rag_chunks` (FLOAT[384]), `cross_project_index`, `codex_*`.
- Gated behind `featureFlagsSlice.enableDuckDbAnalytics` (off by default).
- Dual-write (IDB + DuckDB) goes through `duckdbListenerLoader.ts` in the listener middleware.

---

## Internationalization (i18n)

- **Custom React Context** (`contexts/I18nContext.tsx`) — not i18next.
- Source modules: `locales/<lang>/*.json` for `de`, `en`, `fr`, `es`, `it`.
- Runtime bundles: `public/locales/<lang>/bundle.json` (rebuilt by `pnpm run i18n:bundle` or automatically via `predev` / `prebuild`).
- Hook: `useTranslation()` returns `t('key.path')`. **No hardcoded text** in UI.
- Key parity is enforced in CI (`pnpm run i18n:check`). Add keys to **all five** locale trees.
- Repair scripts: `services/i18nBootstrap.ts` (cold-start), `services/projectI18nRepair.ts` (project data repair).

---

## Accessibility

- Target: **WCAG 2.2 AA** where practical.
- Biome `a11y` rules are strict and fail CI: `useKeyWithClickEvents`, `useButtonType`, `noLabelWithoutControl`, `useSemanticElements`, `useAriaPropsForRole`, `useAriaPropsSupportedByRole`.
- **Live regions:** `useAnnounce(message, priority?: 'polite' | 'assertive')` from `LiveRegionContext`.
- **Focus traps:** `hooks/useFocusTrap.ts` re-queries focusable elements on every Tab press.
- Modals must trap focus and restore on close. Decorative icons need `aria-hidden="true"`.
- Keyboard focus styles: `focus-visible:ring-2`.
- Command palette uses ARIA combobox/listbox patterns.

---

## Key Constraints for Agents

1. `strict: true` + `exactOptionalPropertyTypes: true` — no `any`; use `undefined` explicitly for optional props.
2. Never log or expose API keys; never `eval()` AI responses.
3. All interactive elements require proper `role`, `aria-label`, `aria-expanded`.
4. Gemini API calls must use `NetworkOnly` caching (never cache AI responses in the Service Worker).
5. No direct `@tauri-apps/api` imports in `components/ui/` atoms; abstract through `services/tauriRuntime.ts`.
6. Never use the `dark:` Tailwind prefix — use `--sc-*` CSS custom properties.
7. File size target: 200–700 lines. Over 700 → split.
8. Never comment out or skip failing tests to green CI. `it.skip` requires a file-level comment with a reason and a TODO reference.
9. Whenever you modify, add, or delete a code file, always check for a corresponding test file and update/extend it.
10. Vitest runs serially (`maxWorkers: 1`). Do not attempt to parallelize.
11. Run `pnpm run i18n:check` after adding any user-facing strings.
12. After modifying code files, consider running `pnpm run graphify:update` to keep the knowledge graph current.

---

## Documentation Index

- `README.md` — Project overview, feature list, live demo links
- `CLAUDE.md` — Detailed agent guidance (commands, architecture, current patterns, known debt)
- `AUDIT.md` — Security audit, technical debt inventory, markdown corpus
- `TODO.md` — Sprint-level task tracker
- `CONTRIBUTING.md` — Contributor guide (setup, PR process, how to add AI providers/tools)
- `docs/CI.md` — Full CI reference (job graph, local simulation, E2E authoring)
- `docs/DEPLOYMENT.md` — GitHub Pages, Vercel, Cloudflare Pages, Tauri
- `docs/BEST-PRACTICES.md` — Architecture summary, content rules, testing expectations
- `docs/ACCESSIBILITY.md` — Live regions, focus traps, Lighthouse / axe / Storybook a11y
- `docs/Design-System.md` — Token architecture, Tailwind preset, component patterns
- `docs/VOICE_MASTER_PLAN.md` — Voice Full Support architecture, roadmap, engine specs
- `infra/low-end-ci/DAILY-DRIVER.md` — Local CI workflow for constrained hardware
