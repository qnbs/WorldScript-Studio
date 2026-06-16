<!-- This file is written for AI coding agents. It assumes you know nothing about the project. Every claim below is derived from the actual codebase — do not generalize beyond what is documented here. -->

# WorldScript Studio — Agent Guide

---

## Project Overview

**WorldScript Studio** is an offline-first, AI-powered creative writing application. It is a React 19 single-page application (SPA) that runs in the browser as a Progressive Web App (PWA) and can also be packaged as a desktop app via Tauri 2. There is no backend server; all project data lives locally (IndexedDB in the browser, filesystem in Tauri). Cloud AI providers are optional and user-triggered only.

- **Primary deploy target:** Static SPA on GitHub Pages (`/WorldScript-Studio/` base path)
- **Secondary targets:** Vercel (root base) and Cloudflare Pages via edge builds (`pnpm run build:edge`)
- **Desktop:** Tauri 2 bundles for Linux (AppImage), macOS (DMG), and Windows (MSI); auto-updater enabled via `latest.json`
- **Version:** `1.23.0`
- **License:** MIT

The app supports a multi-provider AI stack (Gemini, OpenAI, Claude, Grok, OpenRouter, Ollama, WebLLM, ONNX Runtime Web, Transformers.js), four AI execution modes (Hybrid / Cloud / Local / Eco), real-time collaboration with E2E encryption, a Plot Board v2 with swimlane/canvas/timeline modes, character/world management, manuscript export, voice dictation, and an 11-locale i18n layer.

---

## ⚠️ Critical Execution Environment Warning (Agent Must Follow)

> **This local development environment runs on low-end / constrained hardware.**
> **All operations must be executed sequentially and with strict resource conservation.**

### Rules for this Environment

1. **No heavy local test suites** – Never run the full Vitest coverage suite, Playwright E2E tests, Stryker mutation testing, Lighthouse CI, or Storybook test-runner locally. These are CI-only by design and would overwhelm this machine.
2. **CI-Cloud-First Workflow** – The canonical quality gate is GitHub Actions (cloud CI). After making changes, push to a branch and let the cloud runners execute the heavy tier.
3. **Local quick tier only** – Locally, run only the lightweight sanity checks:
   ```bash
   pnpm run lint && pnpm run typecheck && pnpm run i18n:check
   ```
   Optional: `pnpm exec vitest run` **without** `--coverage` for a fast smoke test.
4. **Audit cloud CI logs, fix locally, then re-push** – If the cloud CI run fails, inspect the logs via GitHub web UI or `gh run watch`, reproduce the specific failing test or lint error in isolation, fix it locally (quick tier to verify), commit, and push again for another cloud CI run.
5. **Sequential execution** – Do not parallelize builds, tests, or processes locally. Use single-threaded modes and avoid background tasks that compete for RAM/CPU.
6. **Resource budget** – Avoid spinning up the dev server (`pnpm run dev`) for extended periods if not needed. Prefer one-off commands (`pnpm run build`, `pnpm run typecheck`) and stop the server when done.
7. **No local E2E** – Playwright E2E requires `CI=true` and is CI-only by policy. Do not attempt to run `pnpm run test:e2e` locally.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js `>=22.0.0` (`.nvmrc` → `22`), pnpm `>=11.0.0` (`packageManager: pnpm@11.5.2`) |
| Framework | React `^19.2.7`, TypeScript `~6.0.3` (strict) |
| Build tool | Vite `^8.0.16` (`vite.config.ts`) |
| Type checker | `tsgo` (TypeScript Go port) via `tsconfig.tsgo.json` with 4 checkers (`pnpm run typecheck`) |
| Styling | Tailwind CSS `^4.3.0` via `@tailwindcss/vite` + semantic CSS custom properties (`index.css`) |
| State | Redux Toolkit `^2.12.0` + `redux-undo` (project slice only); Zustand `^5.0.8` for transient UI (`app/transientUiStore.ts`) |
| Testing | Vitest `^4.1.8` (jsdom, `maxWorkers: 1`), Playwright `^1.60.0` (E2E, CI-only), Stryker `^9.2.0` (mutation, manual workflow only) |
| Lint/Format | Biome `^2.4.16` (`biome.json`) — single toolchain for JS/TS/CSS |
| AI | Multi-provider: Google Gemini (`@google/genai`), OpenAI, Anthropic Claude, Grok, OpenRouter, Ollama, WebLLM, ONNX Runtime Web, Transformers.js |
| Voice | Web Speech API (fallback); WASM engines: Whisper.cpp (STT), Kokoro (TTS), Silero VAD; gated by `featureFlags.enableVoiceWasm` |
| Storage | IndexedDB v8 (`dbService.ts` / `storageService.ts`) / Tauri filesystem (`fileSystemService.ts`); LZ-String compression; AES-256-GCM encryption for API keys and optional IDB at-rest encryption |
| PWA | `vite-plugin-pwa` with `injectManifest` strategy (`public/sw.js`) |
| Desktop | Tauri 2 (`src-tauri/`) — Rust toolchain required |
| Storybook | Storybook `^10.4.2` with `@storybook/react-vite` and `@storybook/addon-a11y` |
| Orchestration | Turborepo (`turbo.json`) for parallel task caching; pnpm workspaces (`packages/*`) |
| Collaboration | Yjs + `packages/collab-transport` (vendor fork of y-webrtc 10.3.0) with RTCDataChannel AES-256-GCM E2E encryption |

---

## Project Structure

```text
WorldScript-Studio/
├── app/                    # Redux store setup, typed hooks, listener middleware, Zustand transient store
├── components/             # React view components; components/ui/ = design-system primitives
│   ├── ui/                 # Atoms: Button, Modal, Toast, Input, etc.
│   ├── manuscript/         # ManuscriptView sub-components
│   ├── scene-board/        # Plot Board v2 (Swimlane, Canvas, Timeline)
│   ├── dashboard/          # Dashboard cards and widgets
│   ├── settings/           # Settings sections
│   ├── help/               # Help view sub-components
│   ├── copilot/            # Global AI Copilot sub-components
│   ├── voice/              # Voice dictation UI
│   └── …
├── contexts/               # One React context per major view + I18nContext + CommandExecutorContext + LiveRegionContext
├── features/               # Redux Toolkit slices
│   ├── project/            # Core project state (undo-able via redux-undo)
│   ├── settings/           # App settings (AI keys, appearance, accessibility, shortcuts)
│   ├── status/             # App-wide status / loading flags
│   ├── writer/             # Writer view state
│   ├── versionControl/     # Snapshots and branches
│   ├── featureFlags/       # 23 flags — full set on by default; 5 opt-in (default-off)
│   ├── plotBoard/          # Ephemeral viewport/draw state (NOT undo-able; localStorage)
│   ├── progressTracker/    # Writing sessions, streaks, goals
│   ├── sceneComments/      # Per-scene comments (EntityAdapter)
│   ├── analytics/          # DuckDB boot/migration status
│   ├── mindMapUi/          # Mind-map viewport state
│   ├── proForge/           # ProForge pipeline state
│   ├── lora/               # LoRA adapter state
│   ├── voice/              # Voice command state
│   └── copilot/            # Global AI Copilot ephemeral state
├── hooks/                  # View business logic hooks (use*View.ts naming)
├── services/               # External adapters and business logic
│   ├── ai/                 # Vercel AI SDK orchestration layer + aiModeService, aiPolicy, aiRetry, routingLogger
│   │   └── providers/      # Provider implementations including openrouterProvider
│   ├── commands/           # Command palette registry, fuzzy search, preferences
│   ├── copilot/            # Heuristic engine, insight generator, copilot context, action applier
│   ├── duckdb/             # DuckDB-WASM client, schema, analytics, migration
│   ├── help/               # Help catalog, search, doc retrieval
│   ├── keyboard/           # Shortcut normalization and conflict detection
│   ├── voice/              # Voice engines and orchestration
│   ├── storage/            # IDB stores, encryption, backend abstraction
│   ├── fs/                 # Filesystem helpers (Tauri)
│   ├── lora/               # LoRA adapter services
│   ├── plugins/            # Plugin registry helpers
│   └── proForge/           # ProForge pipeline services
├── packages/               # Internal pnpm workspace packages
│   ├── ai-core/            # Local AI facade: WebLLM → ONNX → Transformers.js → heuristic fallback
│   ├── collab-transport/   # Vendor fork of y-webrtc 10.3.0 with E2E encryption patch
│   ├── ui/                 # Tailwind preset + design tokens
│   └── worker-bus/         # Typed worker pool, circuit breakers, dead-letter queue
├── locales/                # i18n source JSON modules (11 locales)
├── public/                 # Static assets; runtime i18n bundles `public/locales/<lang>/bundle.json`
├── tests/
│   ├── unit/               # Vitest tests (co-located naming convention)
│   ├── e2e/                # Playwright specs (CI-only)
│   └── setup.ts            # Global Vitest setup
├── workers/                # Web Workers: inference, duckdb, plugin, v2 inference/duckdb
├── scripts/                # Build/deploy helpers (i18n bundle, SW version sync, bundle budget, edge build)
├── infra/low-end-ci/       # Local CI stack for constrained hardware
├── src-tauri/              # Tauri 2 desktop app (Rust)
├── stories/                # Storybook stories
├── docs/                   # Deep-dive docs: CI.md, DEPLOYMENT.md, ACCESSIBILITY.md, BEST-PRACTICES.md, etc.
├── types.ts                # Core shared TypeScript interfaces
└── types/                  # Supplemental type declarations
```

### Key Files

- `package.json` — scripts, dependencies, pnpm overrides, `simple-git-hooks` + `lint-staged`
- `vite.config.ts` — dev server (port 3000), PWA plugin, manual chunks, `@tauri-apps/*` externalized for web builds
- `tsconfig.json` / `tsconfig.tsgo.json` — `strict: true`, `exactOptionalPropertyTypes: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noUncheckedIndexedAccess: true`, `noPropertyAccessFromIndexSignature: true`
- `biome.json` — lint + format rules; `a11y`, `security`, `correctness` rules enabled; line width 100; 2-space indent
- `vitest.config.ts` — coverage thresholds (lines 74, branches 60, functions 67, statements 72), `maxWorkers: 1`
- `playwright.config.ts` — E2E projects: Chromium desktop + Pixel 5 mobile in CI; Firefox + optional mobile locally
- `turbo.json` — task graph for `build`, `dev`, `lint`, `typecheck`, `test`, `mutation`
- `pnpm-workspace.yaml` — workspace packages + `onlyBuiltDependencies` allowlist
- `stryker.conf.json` — ~20 mutation targets (services + features), `break: 75`
- `.lighthouserc.cjs` — accessibility `error` ≥ 0.95, CLS `error` ≤ 0.1, performance/SEO `warn`
- `src-tauri/tauri.conf.json` / `Cargo.toml` — desktop window config, CSP, updater endpoints, rust-compute feature

---

## Build and Development Commands

```bash
# Development
pnpm run dev                # Vite dev server on http://localhost:3000
pnpm run dev:turbo          # Turbo parallel dev across workspace
pnpm run dev:tauri          # Tauri desktop app (requires Rust)

# Build
pnpm run build              # Production build → dist/ (GitHub Pages base)
pnpm run build:edge         # Edge build (root base) for Vercel / Cloudflare Pages
pnpm run build:pages        # Alias for vite build
pnpm run preview            # Preview production build locally (port 4173)

# Code quality
pnpm run lint               # Biome lint (--error-on-warnings)
pnpm run lint:fix           # Biome check --write (lint + format)
pnpm run format             # Biome format --write
pnpm run typecheck          # tsgo --project tsconfig.tsgo.json --noEmit --checkers 4
pnpm run i18n:check         # Locale key parity vs English + rebuild bundles + content guard
pnpm run parity:check       # Feature parity audit
pnpm run suppressions:check # Biome-ignore count ratchet

# Testing
pnpm run test               # Vitest watch mode
pnpm run test:run           # Vitest single run (no coverage)
pnpm run test:coverage      # Vitest with V8 coverage (enforces thresholds)
pnpm run test:e2e           # Playwright E2E (CI=true required; CI-only by policy)
pnpm run test:e2e:ui        # Playwright E2E UI mode (CI=true required)
pnpm run test:e2e:deep      # Deep E2E feature-flag matrix (CI=true required)
pnpm run test:vrt           # Visual regression (Chromium only)
pnpm run mutation           # Stryker mutation testing (CI-only; manual workflow)

# Analysis / budgets
pnpm run analyze            # Rollup visualizer → dist/bundle-analysis.html
pnpm run bundle:budget      # Chunk size guard (default max 6200 KB total, 2500 KB entry)
pnpm run storybook          # Storybook dev server on :6006
pnpm run build-storybook    # Static Storybook build
pnpm run test:storybook     # Test-runner against served Storybook

# Tauri
pnpm run tauri:dev          # Tauri dev
pnpm run tauri:build        # Tauri production build

# Knowledge graphs
pnpm run graphify:update    # AST-based knowledge graph update
pnpm run codegraph:update   # Semantic code intelligence update
pnpm run graphs:update      # Update both graphs

# Quick local CI (low-end hardware)
pnpm run ci:quick           # lint + typecheck + i18n + build-storybook + optional unit tests
pnpm run ci:quick:unit      # lint + typecheck + i18n + build-storybook only
pnpm run ci:quick:coverage  # lint + typecheck + i18n + build-storybook + unit tests with coverage
```

---

## Code Style and Conventions

### TypeScript

- `strict: true` and `exactOptionalPropertyTypes: true` are enforced. Do not assign `undefined` to optional properties; omit the property instead.
- Avoid `any`. Use proper types or `unknown`. Biome flags `noExplicitAny` as error.
- `noUnusedLocals`, `noUnusedParameters`, `noUnusedImports`, `noImplicitReturns`, `noUncheckedIndexedAccess`, and `noPropertyAccessFromIndexSignature` are all enabled.
- Event handler props use `onX` prefix. Boolean props use `is*` / `has*` prefix.
- `useImportType` is enforced (Biome error).

### Styling

- **NEVER use the `dark:` Tailwind prefix.** Theming is body-class based (`.light-theme`, `.dark-theme`, `.sepia-theme`, etc.). Use CSS custom properties: `bg-[var(--sc-surface-base)]`.
- Design tokens in `index.css` use `--sc-*` naming. Special families: `--glass-*`, `--nav-*`, `--radius-sc-*`, `--icon-sc-*`, `--text-sc-*`.
- `packages/ui/tailwind-preset.ts` registers `w/h-icon-sc-*`, `text-sc-*`, `rounded-sc-*`, etc. Prefer these for atoms.
- Container queries are used for resizable panels; set `containerType: 'inline-size'` inline and use `@container` queries.
- Focus rings: `focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]`.
- Logical properties: Use `ps-`/`pe-` instead of `pl-`/`pr-` in UI atoms for RTL prep.

### Component Patterns

- Every major view follows a **three-file pattern**:
  - `components/XyzView.tsx` — pure rendering only
  - `hooks/useXyzView.ts` — business logic, selectors, thunks
  - `contexts/XyzContext.ts` — React context passing hook return to children
- Use `React.memo()` for expensive renders; `React.forwardRef()` for `components/ui/` primitives.
- Wrap view roots with `components/ui/ViewErrorBoundary.tsx`.
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors.
- All views are lazy-loaded in `App.tsx` via `React.lazy()`.
- **Custom Select components** (`Select.tsx`, `LanguageSelector.tsx`): Use `role="listbox"` on dropdown container, `role="option"` on items, `aria-haspopup="listbox"` and `aria-expanded` on trigger button. Mock as native `<select>` in tests for compatibility.

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
- **Concurrency:** `pool: threads`, `maxWorkers: 1` is mandatory. Tests run serially. Do not parallelize locally.
- **Coverage thresholds:** lines ≥ 74, branches ≥ 60, functions ≥ 67, statements ≥ 72
- **Determinism:** Mock `Date.now()`, use fake timers, reset global state in `beforeEach`. Never depend on real network or test execution order.
- **User interactions:** Use `@testing-library/user-event`, not `.click()` directly. Use `findBy*` / `waitFor` for async assertions.
- **IDB tests:** Instantiate `new IDBFactory()` per test in `beforeEach` + call `_resetDbForTest()`.
- **DuckDB tests:** Mock `services/duckdb/duckdbClient` — never initialize real DuckDB-WASM in unit tests.

### E2E Tests (Playwright)

- **CI-only by policy:** `CI=true` is required (`pnpm run test:e2e`). CI runs Chromium desktop + Pixel 5 mobile emulation. Locally, Firefox is included; mobile only with `RUN_MOBILE_E2E=1`.
- **Base URL:** `http://127.0.0.1:3000/WorldScript-Studio`
- **Do NOT use `networkidle`** against the Vite dev server (HMR keeps WebSocket open). Use `waitForSpaReady()` from `tests/e2e/helpers.ts`.
- **Helpers:** `ensureBlankProject()`, `selectEnglish()`, `sidebar(page)` (scopes to `#sidebar`).
- **Accessibility smoke:** `tests/e2e/a11y.spec.ts` runs axe-core on welcome route and Settings → Accessibility.
- **Visual regression:** Baselines under `tests/e2e/*-snapshots/`. `snapshotPathTemplate` omits OS segment so one PNG works on Linux CI and local dev machines.

### Mutation Testing (Stryker)

- Config: `stryker.conf.json`
- Targets: ~20 files across `services/`, `features/`, `services/copilot/`, `services/ai/providers/`
- `ignoreStatic: true` drops runtime from ~90 min to ~10 min.
- `break: 75` — score below 75 fails the mutation job.
- **Removed from PR/CI pipeline** (2026-06-02) — now runs only via manual `.github/workflows/mutation.yml` (`workflow_dispatch`).

### Storybook

- Stories live in `stories/`. All `components/ui/` primitives should have a story.
- `storybookProviders.tsx` wraps stories with required contexts.
- `@storybook/addon-a11y` runs axe-core per story.

---

## CI/CD and Deployment

### Pipeline Graph

```
security ──► quality ──┬──► build ──► lighthouse
                       ├──► e2e
                       ├──► e2e-deep (non-blocking)
                       ├──► storybook
                       └──► vrt
build (main, non-PR) ──► upload-pages-artifact
deploy (main, non-PR) needs: build + e2e ──► GitHub Pages
```

### Jobs

| Job | Purpose |
|-----|---------|
| `security` | `pnpm audit --audit-level=high`, OSV scanner (pnpm + Cargo lockfiles), gitleaks secrets scan, dependency review on PRs |
| `quality` | Node 22 + 24 matrix → Biome lint, suppression-debt ratchet, `i18n:check`, `parity:check`, `tsgo --noEmit`, Storybook build, Vitest + coverage, Codecov upload |
| `build` | Production build, smoke-test prod build in Chromium, bundle budget, rollup analyze artifact; on `main`: SLSA build provenance attestation + Pages artifact |
| `e2e` | Playwright Chromium desktop + mobile emulation (`CI=true`); JUnit artifact for PR annotations |
| `e2e-deep` | Feature-flag matrix + error paths; non-blocking (`continue-on-error: true`) |
| `lighthouse` | LHCI against built `dist` (mobile + desktop; hard-fail on accessibility and CLS) |
| `storybook` | Static Storybook build + test-runner; artifact upload |
| `vrt` | Visual regression (Chromium only); uploads baselines + diffs |
| `mutation` | Manual workflow only (`.github/workflows/mutation.yml`) |
| `deploy` | Only `main` push: GitHub Pages deploy |

### Desktop Releases

- `tauri-build.yml` runs on `workflow_dispatch` or `v*` tags. `v*` tags publish installers on a GitHub Release.
- Artifacts: `.appimage`, `.msi`, `.dmg` + `latest.json` updater manifest.
- Signing: Optional `TAURI_SIGNING_PRIVATE_KEY` and password for updater signatures.
- **No PR-CI gate for Rust:** the web `ci.yml` never compiles `src-tauri/`, and the crate may not build on constrained hardware. After **any** `src-tauri/` change, verify by dispatching the build on your branch — `gh workflow run tauri-build.yml --ref <branch>` — and confirm it reaches `Finished N bundles`. ubuntu/macOS are the meaningful Rust signal. See [`docs/TAURI-CI.md`](docs/TAURI-CI.md) § *Verifying native (Rust) changes*.

### Deployment Targets

| Target | Build Command | Vite Base |
|--------|---------------|-----------|
| GitHub Pages (canonical) | `pnpm run build` | `/WorldScript-Studio/` |
| Vercel | `pnpm run build:edge` | `/` |
| Cloudflare Pages | `pnpm run build:edge` | `/` |

Edge builds run `scripts/build-edge.mjs` which sets `DEPLOY_TARGET=edge` and patches manifest/offline/404 files.

---

## Security Considerations

- **No build-time secrets.** API keys are entered via Settings UI and stored encrypted in IndexedDB (AES-256-GCM via Web Crypto API). Do not put AI keys in `.env` or host environment variables for inference.
- **CSP:**
  - Web (`index.html`): `connect-src` includes `https:` scheme-source to support BYOK custom base URLs, plus explicit localhost endpoints for Ollama/LM Studio/local AI and explicit `wss://` signaling endpoints. See ADR-0004 for the web-vs-Tauri rationale.
  - Tauri (`src-tauri/tauri.conf.json`): strict `connect-src` with enumerated cloud provider endpoints, no `https:` blanket.
- **No `dangerouslySetInnerHTML` without DOMPurify.** Biome flags `noDangerouslySetInnerHtml` as error.
- **Never log API keys, IVs, or plaintext payloads.** Use `services/logger.ts` (`createLogger(module)` factory — IDB + Tauri JSONL + DEV console sinks; GDPR `sanitizeLogContext`). `console.log` is blocked by Biome in production paths.
- **Service Worker:** AI hosts are network-only (`public/sw.js`). WASM/ONNX chunks are excluded from precache.
- **Supply-chain:** SHA-pinned GitHub Actions, Dependabot weekly updates, OpenSSF Scorecard, CodeQL SAST, SLSA build provenance on `main`.
- **Collaboration:** Yjs + `packages/collab-transport` (vendor fork of y-webrtc 10.3.0) with AES-256-GCM E2E encryption baked in (PBKDF2, 600k iterations, `extractable: false`). Signaling URLs are user-configurable.
- **Tauri isolation:** `vite.config.ts` externalizes `/^@tauri-apps//` so web builds never bundle Tauri APIs. Abstract Tauri calls through `services/tauriRuntime.ts`.
- **IDB at-rest encryption:** Optional feature (`featureFlags.enableIdbAtRestEncryption`) encrypts all project data, snapshots, and settings with AES-256-GCM + PBKDF2-derived key (600k iterations, SHA-256, 32-byte random salt). Web build uses passphrase unlock screen; Tauri build uses OS keychain via `tauri-plugin-stronghold`.
- **Encrypted library backup:** One-click encrypted ZIP export from Settings → Data; `vault.bin` encrypted with AES-256-GCM, passphrase-derived key via PBKDF2.
- **Vulnerability reporting:** GitHub Private Vulnerability Reporting preferred. 90-day coordinated disclosure embargo.

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

- `app/transientUiStore.ts` (Zustand) holds ephemeral UI state: command palette open, cross-project search open, flow mode, Copilot overlay state, etc.
- Do not introduce a third state framework.

### Persistence

- `storageService.ts` → `StorageBackend` auto-detects IndexedDB (web) vs. Tauri filesystem.
- `dbService.ts` wraps dual IndexedDB databases with LZ-String compression (payloads > 10 KB) and AES-256-GCM encryption for API keys.
- Never use raw IndexedDB or `localStorage` for sensitive data.

### Feature Flags

- `features/featureFlags/featureFlagsSlice.ts` gates **23 flags**. New installs get the **full feature set**: all default **on** except five opt-in flags that default **off** — `enableRtlLayout`, `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`. (`enableCodexAutoTracking` + `enableCrossProjectSearch` were promoted to permanent core; `enablePlotBoardV2` + `enableCloudSync` were retired — none remain in the slice.) See `docs/FEATURE-PARITY.md` for the per-flag matrix.
- UI: Settings → Experimental flags.
- Do not use scattered `if (true)` hacks.

### Code Splitting

- All views are lazy-loaded in `App.tsx` via `React.lazy()`.
- Heavy libraries live in Vite manual chunks: `vendor-ai-core` (small ai-core orchestration layer), `vendor-webllm`, `vendor-onnx`, `vendor-transformers`, `ai-vendor`, `ai-sdk-vendor`, `export-vendor-pdf`, `export-vendor-docx-ebook`, `collaboration-vendor`, `data-vendor`, `vendor-duckdb`, `vendor-voice-wasm`, `lora-feature`, `plot-board`, `worker-bus`, `ui-vendor`.
- `listenerMiddleware.ts` and `aiApi.ts` use dynamic imports for DuckDB/RAG/provider init to keep cold-start fast.

---

## AI Services Architecture

### Legacy Path

- `geminiService.ts` — primary adapter for legacy thunks (Gemini API, retry logic, prompt construction).
- `aiProviderService.ts` — multi-provider abstraction (Gemini, OpenAI, Ollama, WebLLM, ONNX, Transformers.js).

### New Path (Vercel AI SDK)

- `services/ai/index.ts` — canonical entry; exports orchestration layer built on `@ai-sdk/google`, `@ai-sdk/openai`, and the `ai` package.
- `providerFactory.ts` — `LanguageModel` factory.
- `worldScriptCompletionFetch.ts` — custom fetch adapter.
- `aiPolicy.ts` — `assertCloudAiAllowed` gates all cloud AI calls.
- `aiRetry.ts` — `withTransientRetry(fn, opts)` wraps provider calls with transient-error retries.
- `services/ai/providers/openrouterProvider.ts` — OpenRouter gateway with circuit breaker and free-tier catalog.
- `hooks/useWorldScriptAI.ts` — wraps `useCompletion` from `@ai-sdk/react`.

### AI Execution Modes

- `services/ai/aiModeService.ts` implements `hybrid | cloud | local | eco` routing.
- Persisted to `settings.aiMode` and synced via `listenerMiddleware`.
- Mode indicator in Copilot header shows active mode and OpenRouter circuit-breaker state.

### Local Inference

- 4-layer stack: WebLLM → ONNX Runtime Web → Transformers.js → heuristics fallback.
- `services/localAiFacade.ts` wraps WebLLM via `packages/ai-core` + `workers/inference.worker.ts`.
- Tab-leader election via BroadcastChannel prevents multi-tab GPU contention.
- **Adaptive AI Engine** (`services/ai/adaptiveAiEngine.ts`) — runtime hardware-aware backend/model selection. Gated by `enableAdaptiveAiEngine` flag.
- **Device Profiler** (`services/ai/localAiDeviceProfiler.ts`) — WebGPU/WebNN/NPU/battery detection, 30s TTL cache.
- **Benchmarks** (`services/ai/benchmarkService.ts`) — micro-benchmarks per task/backend, localStorage persist.
- **Telemetry** (`services/ai/telemetryService.ts`) — local DuckDB primary + localStorage fallback. No cloud data.

### WebGPU Compute Shaders

- `services/ai/computeShaderFactory.ts` — WGSL pipeline factory. Shaders bundled inline via Vite `?raw` imports.
- `services/ai/shaders/`: `textProcessing.wgsl`, `attention.wgsl`, `feedForward.wgsl`, `kvCache.wgsl`.
- Gated by `enableComputeShaders` flag.

### Local RAG

- `services/localRagIndex.ts` + `services/localRagService.ts` — hybrid retrieval (60% semantic MiniLM-L6-v2 + 30% lexical + 10% recency).
- GPU batch cosine via `batchCosineGpu()` when `enableComputeShaders=true` and WebGPU available. CPU fallback when unavailable.
- Lazy-loaded; never sends data to the cloud.
- `services/ragPromptAssembly.ts` builds token-budgeted context blocks.
- Prompt templates: `services/promptLibrary.ts`.

### WorkerBus v2

Central orchestration layer for all background worker tasks. Messages use short kind literals (`TASK`, `CANCEL`, `PING`, `PONG`, `PROGRESS`, `RESULT`) validated by Zod.

- `packages/worker-bus/src/` — WorkerBus, WorkerPool, PriorityTaskQueue, CircuitBreaker, DeadLetterQueue, ProtocolHandler, workerBootstrap, constants, schemas.
- `services/workerBusManager.ts` — singleton lifecycle; registers `inference` and `duckdb` pools.
- `services/hybridRouter.ts` — routes to Web Worker pool or Rust TaskSupervisor (Tauri only) when `enableRustCompute` is on.
- `services/legacyWorkerBusAdapter.ts` — shims old `@domain/ai-core` WorkerBus API onto v2.
- `services/tauriTaskBridge.ts` — `invokeRustTask()`, `isRustComputeAvailable()` (60s TTL ping cache).
- Feature flags: `enableWorkerBusV2` (on by default), `enableRustCompute` (on by default; effective on Tauri desktop only).
- v2 workers: `workers/v2/inference.worker.ts` (text + embed via Hugging Face transformers), `workers/v2/duckdb.worker.ts` (init/query/exec/shutdown).

### DuckDB Analytics

- `workers/duckdbWorker.ts` runs DuckDB-WASM off main thread (OPFS persistence → in-memory fallback).
- `services/duckdb/duckdbClient.ts` is a singleton proxy with AbortSignal and init retry.
- Schema (`duckdbSchema.ts`): 10 tables + 5 views including `rag_chunks` (FLOAT[384]), `cross_project_index`, `codex_*`.
- Gated behind `featureFlagsSlice.enableDuckDbAnalytics` (on by default).
- Dual-write (IDB + DuckDB) goes through `duckdbListenerLoader.ts` in the listener middleware.

---

## Voice Services Architecture

- `services/voice/voiceTypes.ts` — Core interfaces: `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`.
- `services/voice/voiceCommandService.ts` — Singleton orchestrator; bridges engines with Redux and app commands via state machine.
- `services/voice/intentEngine.ts` — `HybridIntentEngine`: exact template → Jaccard fuzzy → slot extraction.
- `services/voice/sttEngine.ts` / `ttsEngine.ts` / `vadEngine.ts` / `wakeWordEngine.ts` — Engine implementations with factories.
- `services/voice/wasmSttEngine.ts` — Whisper.cpp WASM interface (model download, chunked inference, 99+ language detection).
- `services/voice/sileroVadEngine.ts` — Silero VAD v4 via ONNX Runtime Web (~2 MB model, lazy-loaded).
- `services/voice/feedbackService.ts` — TTS feedback orchestration (3 verbosity levels).
- `services/voice/audioNavigator.ts` — ARIA landmark scanning and focus management.
- `hooks/useVoice.ts` — Primary React bridge; syncs Redux settings to `VoiceCommandService`.
- Voice is **opt-in** via `featureFlags.enableVoiceSupport` + `settings.voice.enabled`.

---

## Internationalization (i18n)

- **Custom React Context** (`contexts/I18nContext.tsx`) — not i18next.
- Source modules: `locales/<lang>/*.json` for **11 locales**: `ar`, `de`, `el`, `en`, `es`, `fr`, `he`, `it`, `ja`, `pt`, `zh`.
- Runtime bundles: `public/locales/<lang>/bundle.json` (rebuilt by `pnpm run i18n:bundle` or automatically via `predev` / `prebuild`).
- Hook: `useTranslation()` returns `t('key.path')`. **No hardcoded text** in UI.
- Key parity is enforced in CI (`pnpm run i18n:check`). Add keys to **all eleven** locale trees.
- Repair scripts: `services/i18nBootstrap.ts` and `services/i18nRepair.ts` handle missing keys / bundle corruption.
- RTL Beta: Arabic (`ar`) and Hebrew (`he`) set `html[dir="rtl"]`. Layout mirroring uses logical properties and a global `[dir="rtl"]` CSS net. Canvas/SVG boards (Plot Board, Character Graph) stay LTR to keep pointer/geometry math correct. `enableRtlLayout` flag forces RTL for testing.

---

## Desktop (Tauri)

- `src-tauri/tauri.conf.json` configures the window, CSP, updater, deep links (`worldscript://`), and file associations (`.worldscript`, `.wsst`).
- `src-tauri/Cargo.toml` defines the Rust crate; `rust-compute` feature optionally includes `candle-core` + `candle-nn` for Rust-side inference.
- `vite.config.ts` externalizes all `@tauri-apps/*` modules for web builds.
- Tauri plugins: log, fs, http, dialog, shell, updater, window-state, deep-link, single-instance.
- `pnpm run tauri:dev` starts the desktop app; `pnpm run tauri:build` produces release bundles.

---

## Useful Documentation

| Document | Description |
| -------- | ----------- |
| `README.md` | Product overview, features, getting started |
| `CONTRIBUTING.md` | Dev setup, Biome/Vitest/Playwright, architecture notes |
| `CHANGELOG.md` | Keep a Changelog–style release notes |
| `docs/CI.md` | GitHub Actions jobs, Node/pnpm parity, Act examples |
| `docs/DEPLOYMENT.md` | GitHub Pages + Vercel + Cloudflare Pages |
| `docs/ACCESSIBILITY.md` | A11y architecture (live regions, focus, WCAG 2.2, Lighthouse 0.95 gate) |
| `docs/BEST-PRACTICES.md` | Engineering + content guidelines, glossary, CI parity checklist |
| `docs/Design-System.md` | Tokens, Tailwind preset, UI primitives under `components/ui` |
| `docs/COPILOT.md` | Global AI Copilot v2 architecture |
| `docs/HEURISTIC-RULES.md` | 8 built-in manuscript analysis rules |
| `docs/PROFORGE-PIPELINE.md` | ProForge Ultimate Author Pipeline |
| `docs/TAURI-CI.md` | Tauri desktop workflow and verification |
| `docs/TAURI-UPDATER.md` | Tauri updater setup and signing |
| `docs/IDB-ENCRYPTION.md` | IDB at-rest encryption architecture |
| `docs/VOICE_MASTER_PLAN.md` | Voice full-support master plan |
| `docs/dual-graph-setup.md` | Graphify + CodeGraph setup |
