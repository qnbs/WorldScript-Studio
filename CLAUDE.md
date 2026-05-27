# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev           # Vite dev server on http://localhost:3000
pnpm run build         # Production build to dist/
pnpm run build:edge    # Edge/SSR-compatible build (Vercel, Cloudflare Workers)
pnpm run build:pages   # Cloudflare Pages build
pnpm run preview       # Preview production build locally
pnpm run lint          # Biome lint (--error-on-warnings — warnings fail like CI)
pnpm run lint:fix      # Biome auto-fix (lint + format)
pnpm run typecheck     # TypeScript type check (tsc --noEmit)
pnpm run test          # Vitest watch mode
pnpm run test:run      # Vitest single run (CI mode)
pnpm run test:coverage # Vitest with V8 coverage (thresholds: lines 63%, branches 55%, functions 54%, statements 62%)
pnpm run content:guard # Validate community templates for secrets / eval payloads
pnpm run i18n:check    # Locale key parity + bundle rebuild (runs in CI quality job)
pnpm run mutation      # Stryker mutation report (see stryker.conf.json)
pnpm run test:e2e      # Playwright E2E tests (CI=true required; E2E are CI-only)
pnpm run analyze       # Bundle analysis (ANALYZE=true vite build)
pnpm run bundle:budget # Check vendor chunk sizes (max 7000 KB; entry max 4500 KB)
pnpm run storybook     # Storybook on port 6006
pnpm run test:storybook # Storybook test-runner (CI; needs Storybook running or built)
pnpm run tauri:dev     # Tauri desktop app (requires Rust)
```

**Run a single test file:** `pnpm exec vitest run tests/unit/serviceName.test.ts`
**Run tests matching a name pattern:** `pnpm exec vitest run -t "pattern"`

**Quality gate (matches CI `quality` job):** `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage`. Full pipeline graph: [`docs/CI.md`](docs/CI.md).

**CI pipeline order:** `security` → `quality` (Biome + tsc + Vitest matrix) → `build` / `e2e` / `storybook` (parallel) → `lighthouse` (after build) → `deploy` on `main`.

**Local CI simulation:** `act pull_request --job quality` (requires Docker + [`act`](https://github.com/nektos/act)). Low-end hardware scripts live in [`infra/low-end-ci/`](infra/low-end-ci/) — see `DAILY-DRIVER.md` there for the Forgejo + act workflow and the `ci:quick` / `ci:act` aliases.

**CI-cloud-first workflow (recommended for this project):** On constrained hardware, run only `lint`, `typecheck`, `i18n:check` locally before pushing. Coverage, Playwright E2E, Lighthouse, and Stryker mutation are CI-gate jobs — run them in the cloud, not locally. The authoritative metric source is CI artifacts (Codecov, JUnit). After each push, monitor CI and update docs (README.md badges, AUDIT.md quality-gate line) with the CI-reported numbers. The merge bar is a green CI workflow — not a full local coverage run.

**CI audit & housekeeping policy (ALL CI runs must be fully green):**
- After every commit, monitor ALL CI jobs: security (OSV + CodeQL), quality (Biome + tsc + Vitest), build, e2e, lighthouse, deploy, mutation, storybook.
- **CodeQL scanning**: Check `https://github.com/qnbs/StoryCraft-Studio/security/code-scanning` after every push. Fix the root cause — do not just suppress alerts.
- **Token-Permissions**: All GitHub Actions workflows must set top-level `permissions: contents: read`; write permissions (e.g. `packages: write`) belong at the job level, never top-level.
- **OSV vulnerabilities**: Run `pnpm audit` or check the security CI job for new CVEs. Add `pnpm.overrides` to `package.json` with pinned exact versions.
- Correction loop: fix → commit → verify CI → fix any new issues until all jobs are green and security alerts are resolved.

**E2E notes:** Do NOT use `networkidle` waits against the Vite dev server (HMR keeps WebSocket connections open). Scope sidebar navigation via `#sidebar` when both mobile and desktop nav exist. Shared bootstrap helpers live in `tests/e2e/helpers.ts`. Mobile E2E: set `RUN_MOBILE_E2E=1` locally (off by default).

Pre-commit hook runs Biome check via `simple-git-hooks` + `lint-staged` on staged files.

Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Architecture

StoryCraft Studio is an offline-first PWA — a React 19 SPA with Google Gemini AI, IndexedDB persistence, and optional Tauri desktop packaging. No backend; API keys are entered in the UI and encrypted at rest.

**Stack:** React 19, TypeScript (strict), Vite 8, Tailwind CSS 4.x, Redux Toolkit 2.x, pnpm 10, Node ≥ 22. Two internal workspace packages (`@domain/ai-core`, `@domain/ui` in `packages/`) are consumed as `workspace:*` deps.

**Live:** `https://storycraft-studio-indol.vercel.app/` (Vercel, primary) · GitHub Pages: `https://qnbs.github.io/StoryCraft-Studio/` · Cloudflare Pages: `wrangler.toml` · Vercel: `vercel.json`.

### Directory map

```
app/              → Redux store, typed hooks, listener middleware, transientUiStore (Zustand)
components/       → View components; components/ui/ = design-system atoms (Button, Modal, Toast…)
                     components/manuscript/ = ManuscriptView sub-components (NavigatorPanel, ManuscriptEditor, ResizeHandle)
contexts/         → React context providers — one per major view + I18nContext + CommandExecutorContext
features/         → Redux slices: project, settings, status, writer, versionControl, featureFlags,
                     plotBoard, sceneComments, progressTracker, analytics, proForge
hooks/            → View business logic (use*View.ts naming); useGlobalKeyboardShortcuts here too
services/         → External adapters; notable sub-dirs:
                     ai/          Vercel AI SDK orchestration layer (Strangler pattern over aiProviderService):
                                   index.ts (canonical entry + exports), providerFactory.ts (LanguageModel
                                   factory: Gemini via @ai-sdk/google, OpenAI-compatible via @ai-sdk/openai),
                                   storyCraftCompletionFetch.ts (custom fetch adapter + STORYCRAFT_COMPLETION_URL),
                                   hybridFallback.ts (resolveProviderFallbackChain), aiPolicy.ts
                                   (assertCloudAiAllowed), aiRetry.ts (withTransientRetry), aiInferenceCacheService,
                                   deviceHealthService, gpuResourceManager, ecoModeService,
                                   localEmbeddingService, localNlpService, orchestrationProviders,
                                   inferenceProgressEmitter, webGpuDetectorService
                     commands/    (palette registry, fuzzy rank, recent/pinned)
                     duckdb/      (duckdbClient, duckdbSchema, duckdbAnalytics, duckdbMigration,
                                   duckdbListenerLoader, ragVectorMigration)
                     help/        (helpCatalog.ts — 50+ articles, helpSearch.ts, helpDocRetrieval.ts)
                     keyboard/    (shortcut normalization, conflict detection)
                     proForge/    (proForgeOrchestrator.ts, proForgeMemoryBank.ts,
                                   pipelineAgents/ — baseAgent.ts (abstract base), supervisorAgent.ts
                                   (heuristic gates), + 8 stage agents: diagnosticAgent, structuralAgent,
                                   proseAgent, copyEditAgent, proofAgent, productionAgent,
                                   publishingAgent, analyticsAgent; pipelineOutput/, pipelinePrompts/, pipelineTools/)
                     settingsExchange/
packages/         → Internal workspace packages: ai-core (WebLLM + inference worker), ui
locales/          → i18n source JSON (de/en/es/fr/it × 15 modules); runtime: public/locales/<lang>/bundle.json
tests/            → unit/ (Vitest) + e2e/ (Playwright); shared E2E helpers in tests/e2e/helpers.ts
types/            → Supplemental TypeScript definitions (duckdb-wasm-worker.d.ts, tauri-plugins.d.ts)
types.ts          → Core shared interfaces and types (root level)
workers/          → inference.worker.ts (@xenova/transformers), duckdbWorker.ts (DuckDB-WASM)
infra/low-end-ci/ → Local CI stack: Forgejo + act + systemd units + bash scripts
scripts/          → Build/deploy helpers (sync-deploy-base, cf-pages-deploy, graphify-update, etc.)
```

### State Management

Redux Toolkit with feature-sliced slices: `features/project/`, `features/settings/`, `features/status/`, `features/writer/`, `features/versionControl/`, `features/featureFlags/`, `features/proForge/`. The `project` slice is wrapped with `redux-undo` (100-step history). Side effects (auto-save, Codex extraction, DuckDB dual-write) run in `app/listenerMiddleware.ts`, not in components or hooks.

**`addDebouncedListener` factory** (`listenerMiddleware.ts`): use this helper instead of writing raw `startListening` calls with delay — it handles the `RootState` cast and delay pattern. **Critical RTK constraint:** `listenerApi.getOriginalState()` can only be called synchronously before the first `await` in an effect. Always capture it as `const originalState = listenerApi.getOriginalState() as RootState` at the top of the effect before any `await listenerApi.delay(...)` call.

Use typed hooks everywhere: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`.

Transient / ephemeral UI state (palette open, cross-project search open, Flow Mode) lives in `app/transientUiStore.ts` (Zustand). Do not use a third state framework. Key transient keys: `isCommandPaletteOpen`, `isCrossProjectSearchOpen`, `flowMode` / `setFlowMode` (distraction-free writing toggle).

### View Pattern

Every major view follows this three-file structure:
- `components/Xyz.tsx` — pure rendering only
- `hooks/useXyzView.ts` — business logic, Redux selectors, thunk dispatches
- `contexts/XyzContext.ts` — React context that passes the hook return to child components

React conventions: `React.memo()` for expensive renders; `React.forwardRef()` for `components/ui/` primitives; always clean up event listeners, timeouts, and subscriptions in `useEffect` return.

Wrap each major view root with `components/ui/ViewErrorBoundary.tsx` — provides retry + WCAG live-region announce on render errors.

**Props conventions:** Event handler props use `onX` prefix. Boolean props use `is*`/`has*` prefix. Prefer Tailwind classes over inline styles; inline styles only for dynamic values derived from measurement.

### Design System

**Token architecture:** `index.css` defines the `--sc-*` semantic token layer (60+ tokens). Theming is body-class based (`.light-theme` / `.dark-theme` / `.sepia-theme` etc.). **NEVER use the `dark:` Tailwind prefix** — it bypasses body-class theming and breaks appearance presets. Use `bg-[var(--sc-surface-base)]`, not `bg-white dark:bg-slate-900`.

**Special token families** (do not replace or remove):
- `--glass-*` — glassmorphism effects (standalone design tokens, not bridge vars)
- `--nav-*` — sidebar/nav active/hover states (standalone design tokens)
- `--radius-sc-*` — border radius tokens (`--radius-sc-xl`, `--radius-sc-lg`, etc.)
- `--icon-sc-*` — icon size tokens (`--icon-sc-sm/md/lg/xl`)
- `--text-sc-*` — fluid type scale via `clamp()` (390px → 1280px interpolation)

**Token migration status (DS-1 + DS-2 — complete):** All `dark:` Tailwind prefix violations are eliminated (DS-2 ✅). All undefined bridge CSS vars (`--background-hover`, `--background-elevated`, `--background-selected`, `--foreground-on-interactive`, `--foreground-tertiary`) have been replaced with `--sc-*` equivalents. The bridge block in `index.css` now contains only intentional tokens — do NOT remove them: `--border-interactive` (alias for `--sc-border-focus`), `--nav-*` (sidebar tokens), `--glass-*` (glassmorphism tokens), `--background-gradient-overlay-start` / `--card-gradient-overlay` (per-theme card image gradients). **DS-5 (delete remaining bridge block)** is deferred until one production verification cycle completes.

**Tailwind utilities:** `packages/ui/tailwind-preset.ts` registers `w/h-icon-sc-*`, `text-sc-*`, `rounded-sc-*`, `duration-sc-*`, `ease-sc-*` utilities. Prefer these over one-off `w-4`/`text-sm` for atoms.

**Storybook:** New `components/ui/` primitives require a `.stories.tsx` file with `addon-a11y` checks passing (`pnpm run storybook`). Storybook test-runner (`pnpm run test:storybook`) runs against the built Storybook in CI.

**Keyboard on non-button elements:** Use `useKeyWithClickEvents` rather than adding raw `onKeyDown` alongside `onClick`. Use `useButtonType` on custom button-like components to set the correct `type` attribute.

**Accessibility hooks:** `useAnnounce()` from `LiveRegionContext` — signature is `announce(message: string, priority?: 'polite' | 'assertive')`. The second argument is a **string enum**, not an object. `useFocusTrap` re-queries focusable elements on every Tab press (live DOM query, not a cached list).

**Container queries:** Resizable panels (Navigator, Inspector, WriterView sidebars) set `containerType: 'inline-size'` via inline style. Use `@container` CSS queries or the Tailwind `@container` variant for responsive panel content.

**Tauri build isolation:** `vite.config.ts` uses `external: [/^@tauri-apps\//]` (regex) to exclude all Tauri packages from the web build. When adding new Tauri plugin imports to `services/tauriRuntime.ts`, the regex already covers them — do not add to the explicit list.

**Tauri CSP:** When adding a new external endpoint (AI provider, LanguageTool, WebRTC signaling, etc.), extend `connect-src` in `src-tauri/tauri.conf.json`. Web `fetch` alone is not enough — the Tauri CSP is the gate for desktop.

### AI Services

`geminiService.ts` is the primary adapter for legacy thunks (Gemini API, retry logic, prompt construction). `aiProviderService.ts` provides the multi-provider abstraction (Gemini, OpenAI, Ollama, WebLLM, ONNX Runtime Web, Transformers.js). All legacy AI calls go through one of these. `features/project/aiThunkUtils.ts` provides a deduplicated async-thunk wrapper (service-level `_pendingRequests` Map) to prevent duplicate in-flight requests.

**AI constants:** `services/ai/aiConstants.ts` is the single source for shared AI constants: `CREATIVITY_TO_TEMPERATURE` (AiCreativity → number), `LOCAL_BACKEND_PRESET_DEFAULT_URL`, `ORCHESTRATION_READY_PROVIDERS` + `isOrchestrationReadyProvider()`, `LOCAL_INFERENCE_PROVIDERS` + `isLocalInferenceProvider()`. The older per-constant files (`creativityTemperature.ts`, `localBackendPresets.ts`, `orchestrationProviders.ts`) re-export from here and remain for import compatibility.

**Vercel AI SDK layer (new paths, Strangler pattern):** `services/ai/index.ts` is the canonical entry — it exports the orchestration layer built on `@ai-sdk/google`, `@ai-sdk/openai`, and the `ai` package. New Writer streaming uses `hooks/useStoryCraftAI.ts` (wraps `useCompletion` from `@ai-sdk/react` with the custom `storyCraftCompletionFetch`). New code should route through `services/ai/` + `useStoryCraftAI`; legacy thunks remain in `aiProviderService.ts` / `geminiService.ts` for backwards compatibility. Always gate cloud AI calls with `assertCloudAiAllowed` from `services/ai/aiPolicy.ts`.

`services/ai/aiRetry.ts` — `withTransientRetry(fn, opts)` wraps any AI provider call with transient-error retries (network glitches, rate limits). Use this instead of ad-hoc retry logic.

**WebLLM / local inference:** `services/localAiFacade.ts` wraps `@mlc-ai/web-llm` (via `packages/ai-core` + `workers/inference.worker.ts`). Supported models in `WEBLLM_SUPPORTED_MODELS` (Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B). Tab-leader election via BroadcastChannel prevents multi-tab GPU contention.

**Local RAG:** `services/localRagIndex.ts` + `services/localRagService.ts` — hybrid retrieval (60% semantic MiniLM-L6-v2 + 30% lexical + 10% recency) over project content via `@xenova/transformers`. Lazy-loaded; never sends data to the cloud. `ragMode: 'hybrid' | 'lexical'` in `settings.advancedAi` (default `'hybrid'`).

**Prompt assembly:** `services/ragPromptAssembly.ts` — `assembleRAGPrompt(opts)` builds token-budgeted context blocks from retrieved RAG chunks for Writer continuation/brainstorm/critic and Plot Board beat suggestions. Use this rather than building context strings inline. Templates come from `services/promptLibrary.ts`.

### DuckDB Analytics

`workers/duckdbWorker.ts` runs DuckDB-WASM off main thread (OPFS persistence → in-memory fallback). `services/duckdb/duckdbClient.ts` is a singleton proxy with AbortSignal, init retry (3×, exponential backoff), and OPFS fallback handler. Schema (`duckdbSchema.ts`) has 10 tables + 5 views including `rag_chunks` (FLOAT[384] embeddings), `cross_project_index`, and `codex_*`. `duckdbAnalytics.ts` exposes typed query helpers and `withDuckDbRetry`.

Key rules:
- Gate all DuckDB paths behind `featureFlagsSlice.enableDuckDbAnalytics` (off by default).
- Dual-write (IDB + DuckDB) goes through `duckdbListenerLoader.ts` in `listenerMiddleware` — dynamically imported to avoid blocking cold start.
- `ragVectorMigration.ts` handles the FLOAT[64]→FLOAT[384] column upgrade.
- `hooks/useDuckDb.ts` initializes with 30 s timeout; `hooks/useAnalytics.ts` parallelizes 4 queries behind the feature flag.

### Logging

Use `services/logger.ts` (ring-buffer + sink) for all diagnostic output. Never use `console.log` in production paths — Biome `noConsole` rule enforces this. `console.warn`/`console.error` are allowed per the Biome allowlist. Never write API keys, IVs, or plaintext payloads to any log.

### Environment Variables

Client-side env vars must use the `VITE_*` prefix (from `.env` / `.env.local`, which are git-ignored). Access via `import.meta.env.VITE_*`. Sensitive user keys (Gemini, etc.) are never stored in env files — they go through the AES-256-GCM IDB path in `dbService.ts`.

### Storage

`dbService.ts` wraps **dual** IndexedDB databases (`storycraft-state-db` for Redux state, `storycraft-data-db` for assets/blobs) with LZ-String compression (payloads > 10 KB), AES-256-GCM encryption (API keys), and legacy migration via `services/dbMigration.ts`. `storageService.ts` is the unified interface that auto-detects IndexedDB vs. Tauri filesystem. Data access must go through `dbService` or thunks — never raw IndexedDB calls. Never use `localStorage` for sensitive data.

`services/dbInitialization.ts` exports `checkStorageHealth()` — proactive low-storage warning that runs on app init. Returns a `StorageHealth` object; a low-storage event is surfaced via a toast rather than blocking writes.

### Collaboration

Real-time P2P editing via Yjs + y-webrtc (`services/collaborationService.ts`). Signaling-channel E2E encryption: AES-256-GCM with PBKDF2 (310 000 iterations, SHA-256), deterministic salt from `projectId`. **RTCDataChannel in-flight E2E encryption** is shipped via a patched y-webrtc (`patches/y-webrtc@10.3.0.patch` applied via `pnpm.patchedDependencies`). Signaling URLs come from Redux `settings.collaboration.webrtcSignalingUrls`. Do not introduce a second CRDT layer.

### Code Splitting

All 14 views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy libraries (export: `docx`, `jszip`, `jsPDF`; collaboration: Yjs; graphs: `react-force-graph-2d`) live in separate Vite manual chunks and are dynamically imported only when used. `listenerMiddleware.ts` and `aiApi.ts` use dynamic imports for DuckDB/RAG/provider init to keep cold-start fast. `CollaborationPanel` and Plot Board sub-components are also lazy (Vite `plot-board` manual chunk). Keep export/collaboration dependencies lazy.

### Feature Flags

Experimental features are gated behind `features/featureFlags/featureFlagsSlice.ts` (19 flags). Default **on**: `enableCodexAutoTracking`, `enableCrossProjectSearch`, `enablePlotBoardV2`. All others default **off**. UI: Settings → Experimental flags (`FeatureFlagsSection.tsx`). Do not use scattered `if (true)` hacks.

Key flags: `enableDuckDbAnalytics`, `enableVoiceSupport`, `enableProForge` (ProForge pipeline — off by default; gates the entire pipeline view in WriterView). Stub/future flags (off by default): `enableCloudSync`, `enableLoraAdapters`, `enablePluginSystem`, `enableRtlLayout`, `enableObjectsGroups`, `enableMindMaps`, `enableCharacterInterviews`.

### Command Center & shortcuts

- **`services/commands/`** — single registry for palette entries: definitions, fuzzy rank/score, recent/pinned prefs, lightweight AI suggestions. **`components/CommandPalette.tsx`** renders from this registry (ARIA combobox/listbox patterns).
- **`contexts/CommandExecutorContext.tsx`** + **`CommandExecutorProvider` in `App.tsx`** — expose `executeCommand` / `runCommandById` to deep UI (Help „Try it" via `tryActionId`, toasts with `commandId`).
- **`app/transientUiStore.ts`** — Zustand store includes **`isCommandPaletteOpen`** (palette wired here; avoid duplicate local-only state).
- **`hooks/useGlobalKeyboardShortcuts.ts`** + **`services/keyboard/`** — normalize OS modifiers, match bindings from settings, optional conflict listing for the Shortcuts UI.
- **Help system:** `services/help/helpCatalog.ts` (50+ articles, 6 categories), `services/help/helpSearch.ts` (full-text indexed per locale), `services/help/helpDocRetrieval.ts` builds static retrieval context for `streamAiHelpResponse`.

### i18n

Custom React Context in `I18nContext.tsx` — not i18next. Locale files exist for de, en, es, fr, it (15 modules merged into one **`public/locales/<lang>/bundle.json`** per language — rebuilt by **`pnpm run i18n:bundle`** or automatically via **`pnpm run i18n:check`** / **`prebuild`** / **`predev`**). The in-app selector exposes **de**, **en**, **fr**, **es**, and **it**. All user-facing strings must use `t('key.path')` from `useTranslation()` — no hardcoded text. New keys: add to **all five** locale trees (`node scripts/check-i18n-keys.mjs --fix` for parity), then run **`pnpm run i18n:bundle`**.

**Cold-start repair:** `services/i18nBootstrap.ts` runs a synchronous locale bootstrap on app init; `services/projectI18nRepair.ts` repairs any project with raw i18n keys stored as data (e.g. `initialProject.title`). Both run automatically via `App.tsx` — do not bypass.

**Terminology glossary** (use these terms consistently in UI copy and keys): *Manuscript* (the document), *Outline*, *Template*, *Snapshot* (auto-save point) vs. *Scene Revision* (user-saved via `sceneRevisionService`), *Writing Session*, *Subplot*, *Connection* (plot board edge). AI is always framed as a **Co-Pilot**, not a ghostwriter. See `docs/BEST-PRACTICES.md` for the full glossary.

**Community templates:** canonical English source in `community-templates/index.json`, mirrored to `public/community-templates/`. Validation via Zod in `fetchCommunityTemplates`. Run `pnpm run content:guard` before committing any template changes (rejects embedded secrets and `eval`-like payloads).

### Code comment convention (QNBS-v3)

On any non-trivial code change add a single-line comment explaining **why**, not what:

| Context | Syntax |
|---------|--------|
| TS / JS | `// QNBS-v3: <reason / impact>` |
| TSX / JSX | `// QNBS-v3: …` above the changed line; `{/* QNBS-v3: … */}` only when needed inside JSX |
| CSS | `/* QNBS-v3: … */` |
| Pure config (JSON, YAML) | No inline comment — explain in the commit message |

Skip the annotation for pure formatting, lockfile updates, or generated artefacts. Cursor IDE agents follow the extended rules in `.cursorrules` and `.cursor/rules/*.mdc`.

## Documentation index

All repository `.md` guides are listed in **[`README.md`](README.md#-documentation-hub) § Documentation Hub**; **[`AUDIT.md`](AUDIT.md)** § *Markdown corpus* has the maintainer inventory. Accessibility architecture: **[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)**. Sprint notes: `docs/SPRINT-V1.8.md`, `docs/SPRINT-V1.9.md`, `docs/SPRINT-V1.10.md`, `docs/SPRINT-V1.16.md` (design system completion). Local CI: `infra/low-end-ci/DAILY-DRIVER.md`.

**Before large or cross-cutting changes:** read [`ROADMAP.md`](ROADMAP.md) (planned features + priorities), [`AUDIT.md`](AUDIT.md) (follow-ups, metrics), and [`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md) (architecture decisions, content/CI guidance). ProForge architecture: [`docs/PROFORGE-PIPELINE.md`](docs/PROFORGE-PIPELINE.md). Latest sprint handoff: [`docs/SPRINT-HANDOFF-2026-05-27.md`](docs/SPRINT-HANDOFF-2026-05-27.md). After merging, update README.md badges and the AUDIT.md quality-gate line with CI-reported numbers if the maintainer requests it.

## Key Constraints

- `strict: true` + `exactOptionalPropertyTypes: true` — no `any` types; use `undefined` explicitly for optional props
- Never log or expose API keys; never `eval()` AI responses
- All interactive elements require proper `role`, `aria-label`, `aria-expanded` attributes (WCAG **2.2** AA-oriented; Biome `a11y` warnings fail CI)
- Modals must trap focus and restore on close; decorative icons need `aria-hidden="true"`
- Gemini API calls must use `NetworkOnly` caching (never cache AI responses in the Service Worker)
- Use `focus-visible:ring-2` for keyboard focus styles
- `dangerouslySetInnerHTML` only with DOMPurify-sanitized content — never raw
- No direct `@tauri-apps/api` imports in `components/ui/` atoms; abstract through `services/tauriRuntime.ts` so the web build stays unaffected
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors
- Never comment out or skip failing tests to green CI — fix the root cause. `it.skip` requires a file-level comment with a reason and a ticket/TODO reference
- **Modus operandi — tests:** Whenever you modify, add, or delete a code file, always check whether a corresponding test file exists (in `tests/unit/` for components/hooks/services, or `tests/e2e/` for flows). If it does, update or extend it to cover the change. If it doesn't exist yet and the change is non-trivial, create one. Run the relevant test file with `pnpm exec vitest run <path>` to verify before committing. Write tests to be fully deterministic: mock `Date.now()` / use fake timers; never depend on real network or test execution order; reset global state (Redux store, localStorage, IndexedDB) in `beforeEach` using patterns from `tests/setup.ts`. Use `@testing-library/user-event` for user interactions (not `.click()` directly); use `findBy*` / `waitFor` for async assertions.
- **Vitest concurrency:** `maxWorkers: 1` is set in `vitest.config.ts` — tests run serially. Do not attempt to parallelize Vitest runs on this project (low-end hardware + IDB isolation requirement).
- **IDB unit tests:** Use `// @vitest-environment node` + instantiate `new IDBFactory()` per test in `beforeEach` + call `_resetDbForTest()` to clear state. See `sceneRevisionService` tests as the canonical pattern.

## Current Patterns

### Plot Board

**plotBoardSlice:** `features/plotBoard/plotBoardSlice.ts` — ephemeral viewport/UI state only (zoom/pan/mode/draw state). NOT undo-able; persists to `localStorage`. Selectors: `selectActiveMode`, `selectZoom`, `selectPan`, `selectSnapToGrid`, `selectIsDrawingConnection`, `selectDrawFromSectionId`, `selectSelectedConnectionId`, `selectActiveSubplotFilter`.

Story content (connections, subplots, tensionOverrides) lives in `projectSlice` — use selectors from `features/project/projectSelectors.ts` and dispatch `projectActions.addPlotConnection / removePlotConnection / addPlotSubplot / deletePlotSubplot / setPlotTensionOverride / clearAllPlotTensionOverrides`.

**plotBoardService:** `services/plotBoardService.ts` — `computeTensionCurve(sections, overrides)`, `autoLayoutScenes(sections)`, `exportBoardAsSvg(svgEl)`.

**Plot Board AI:** `features/project/thunks/plotBoardAiThunks.ts` — `suggestNextBeatThunk` calls `assembleRAGPrompt` then dispatches to AI. Hook: `hooks/usePlotBoardAi.ts`. Modal shows suggested beat with accept/reject.

**PlotMinimap:** `components/scene-board/PlotMinimap.tsx` — viewport overview overlay. `plotLayoutUtils.ts` provides grid-snap helpers.

### ProForge Pipeline

**Overview:** 8-stage agentic manuscript editing pipeline with Human-in-the-Loop gates. Gated behind `featureFlags.enableProForge` (off by default). Full docs: `docs/PROFORGE-PIPELINE.md`.

**Stage sequence:** `intake` → `structural` → `lineProse` → `copyEdit` → `proof` → `production` → `publishing` → `analytics`. Each stage supports proceed / retry / skip / abort / rollback. Stages pause at `awaitingReview` — the manuscript is **never auto-modified** without explicit user approval.

**Redux slice:** `features/proForge/proForgeSlice.ts` — root key `proForge`. NOT wrapped with `redux-undo`. Actions: `stageStarted`, `stageCompleted`, `stageAwaitingReview`, `submitStageReview`, `skipStage`, `rollbackToStage`, `pipelineAborted`, `pipelineCompleted`.

**Types:** `features/proForge/types.ts` — `PipelineStage`, `PipelineConfig`, `PipelineRun`, `StageResult`, `ReviewItem`, `ReviewItemStatus`, and all per-stage output interfaces (`DiagnosticReport`, `StructuralEditPlan`, `ProseEditBatch`, `CopyEditPlan`, `QualityGateReport`, `ProductionManifest`, `PublishingPackage`, `PipelineAnalyticsReport`).

**Orchestrator:** `services/proForge/proForgeOrchestrator.ts` — `createProForgeOrchestrator({dispatch, getState, projectId, manuscript, characters, worlds, config})`. Agents are lazy-loaded per stage to avoid circular deps. Call via `hooks/useProForgeOrchestrator.ts` (never instantiate directly in components).

**Agents** (`services/proForge/pipelineAgents/`): all 8 stage agents extend `BaseAgent` (abstract base in `baseAgent.ts`). `BaseAgent` provides `requireProject()`, `getMemoryBank()`, `elapsed(startTime)`, and `selfReflect(excerpt, summary, signal)` — agents implement only `execute(signal): Promise<Pick<StageResult, ...>>`. Do not duplicate these helpers in new agents.

**SupervisorAgent** (`supervisorAgent.ts`): heuristic quality gate — no AI calls. `evaluate(stage, result)` returns `SupervisionDecision { verdict: 'pass'|'retry'|'fail', reason, retryHint? }`. Detects `isFallback: true`, uniform-score sentinels, implausible edit/issue ratios. Called by the orchestrator's `executeStageWithSupervision` loop (up to `maxRetries` retries). Hard gate: intake `qualityScore < 30` → `fail`.

**Honest fallbacks:** All `createFallback*` methods use 0 scores + `isFallback: true`. Never produce fake mid-range values — the SupervisorAgent uses these flags to trigger retries.

**Memory Bank:** `services/proForge/proForgeMemoryBank.ts` — IDB store `proforge-memory-bank` for cross-agent persistent context (lore, style, feedback). Accessed by agents, not by UI components directly.

**View pattern:** `contexts/ProForgeViewContext.ts` + `hooks/useProForgeOrchestrator.ts` + `components/proForge/` (ProForgeDashboard, PipelineProgressPanel, PipelineReviewPanel). The context passes the full `useProForgeOrchestrator` return to sub-components; use `useProForgeViewContext()` to consume.

**`PipelineConfig` key fields:** `genrePreset`, `selectedStages`, `aiProvider`, `ragMode`, `maxTokens`, `creativity`, `useDuckDb`, `autoAcceptThreshold` (0 = never auto-accept), `language`, `maxRetries` (0 | 1, default 1 — controls supervisor retry budget).

**Key type additions (v1.18):** `isFallback?: boolean` on `DiagnosticReport`, `StructuralEditPlan`, `QualityGateReport`; `reflectionNotes?: string` on diagnostic/structural outputs (trace log only, not shown in UI); `supervisorDecision?: SupervisionDecision` on `StageResult`.

### Scene-level services

**sceneRevisionService:** `services/sceneRevisionService.ts` — IDB `scene-revisions` store; `saveRevision(sectionId, snapshot, label?)`, `listRevisions(sectionId)`, `deleteRevision(id)`. Tests: use `@vitest-environment node` + `new IDBFactory()` per test in `beforeEach` + `_resetDbForTest()`.

**sceneCommentsSlice:** `features/sceneComments/sceneCommentsSlice.ts` — EntityAdapter; selectors `selectCommentsBySection(sectionId)`, `selectUnresolvedCount`, `selectUnresolvedCountBySection(sectionId)`. Root state key: `sceneComments`.

**progressTrackerSlice:** `features/progressTracker/progressTrackerSlice.ts` — `startSession(wordCount)`, `endSession({ currentWordCount })`, `setDailyGoal`, `setWeeklyGoal`, `syncStreak`. Exported: `computeStreak(history)` pure function.

**deepLinkService:** `services/deepLinkService.ts` — `parseHash(hash)`, `pushHash(view, sectionId?)`, `readCurrentView()`. Views: `'board' | 'preview' | 'progress' | 'project'`.

### Test mock patterns

**useAppSelectorShallow with plotBoard:** Tests must include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in the mock state. Connections/subplots/tensionOverrides are in `project.present.data` — mock via `selectPlotConnections: () => []` etc. in the `projectSelectors` mock. Add `// biome-ignore lint/suspicious/noExplicitAny: test mock` before `(selector: (s: any) => unknown)` lines.

**ConnectionLayer test IDs:** Connection `<g>` elements use `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize a real DuckDB-WASM instance in unit tests.

**AI thunk tests (localStorageOnly default):** `settingsReducer` initializes with `privacy.localStorageOnly: true`. Any test file that dispatches AI thunks through a real Redux store will have `createDeduplicatedThunk` call `assertCloudAiAllowedSync(provider, privacy)` and throw "Cloud provider blocked" before the payload creator runs. Fix: add this mock **before all imports** in the test file:
```ts
vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));
```

**Context hooks in component tests:** If a component calls `useSomeViewContext()` and the test renders without the provider, it throws "must be used within a Provider". Mock the context module rather than wrapping in the real provider tree:
```ts
vi.mock('../../../contexts/WriterViewContext', () => ({
  useWriterViewContext: vi.fn(() => ({ flowMode: false, toggleFlowMode: vi.fn() })),
}));
```
Apply this pattern for any `use*ViewContext` hook — `useProForgeViewContext`, `useWriterViewContext`, etc.

### Settings Navigation

`components/SettingsView.tsx` uses `NAV_GROUPS` — a typed array of `{ key: string; ids: readonly string[] }` — plus a `NavGroupHeader` component to render semantic sidebar sections (Writing, AI Models, Appearance & Accessibility, Privacy & Data, Connections, System). When adding a new settings tab: add its `id` to the correct group in `NAV_GROUPS`; do not create a flat ungrouped entry.

### Cross-project & backup

**crossProjectIndexService / crossProjectSearchService:** `services/crossProjectIndexService.ts` — IDB `projects-index-store` (DB_VERSION 8); `services/crossProjectSearchService.ts` — `searchAcrossProjects()` via fuzzyScore. Indexing triggered on save via `listenerMiddleware.ts`. UI: `CrossProjectSearchPanel`; Zustand transient key: `isCrossProjectSearchOpen`.

**libraryBackupService:** `services/libraryBackupService.ts` — one-click encrypted ZIP export (AES-GCM, `META.json` + `vault.bin`). Entry point: Settings → Data. No new IDB keys; reads from existing `dbService` stores.

### Voice Full Support

**Abstract engine pattern:** `services/voice/voiceTypes.ts` defines `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine` interfaces. All implementations follow the same contract: `isAvailable()` → `initialize()` → use → `dispose()`.

**Web Speech API fallbacks:** `WebSpeechSttEngine` (auto-restart on unexpected end), `WebSpeechTtsEngine` (voice selection, rate/volume/pitch), `WebRtcVadEngine` (energy-based, pure JS), `EnergyThresholdWakeWordEngine` (configurable phrase, rolling history). These require zero downloads and work immediately in all modern browsers.

**Intent engine:** `HybridIntentEngine.parse(transcript, context)` — exact template match (O(1) via Map) → fuzzy Jaccard scoring + keyword bonus → slot extraction for navigation commands. View-context filtering via `requiredViews` array. Character/section/world names injected from Redux state for slot matching.

**Orchestrator:** `VoiceCommandService` singleton manages engine lifecycle and state machine (idle → listening → processing → speaking → idle + dictating). Dispatches matched commands via `runCommandById`. `appStoreRef` object pattern allows singleton access to Redux state outside React lifecycle.

**Hooks:** `useVoice` (primary bridge), `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation` (editor transcript insertion), `useVoiceAccessibility` (ARIA live regions).

**Opt-in gating:** Voice UI only renders when `settings.voice.enabled === true` AND `featureFlags.enableVoiceSupport === true`. Onboarding notice shown in Settings → Voice on first access.

**currentView fallback:** Intent engine uses `document.body.dataset['view']` as best-effort current view detection. This is React-state-independent but may lag behind rapid view switches.

### Local inference

**localAiFacade / WebLLM:** `services/localAiFacade.ts` wraps WebLLM with the same provider interface as `aiProviderService.ts`. Model download progress surfaced via `onProgress`; mount-guard via `useRef` prevents stale updates after unmount.

### Virtual scrolling

`NavigatorPanel.tsx` uses `useVirtualizer` from `@tanstack/react-virtual`. Pattern: scrollable `<ul>` gets `ref={scrollRef}` + `position: relative`; a sentinel `<li>` sets `height: virtualizer.getTotalSize()`; visible items render as `position: absolute` with `transform: translateY(${virtualRow.start}px)`. Each item `<li>` needs `data-index={index}` + `ref={virtualizer.measureElement}` for dynamic measurement. Use `estimateSize: () => 40, overscan: 5` as defaults. Never lift the virtual container's `overflow-y: auto` into a parent — the virtualizer's scroll element must be the direct scrollable node.

## Known Technical Debt

See `AUDIT.md` and `TODO.md`. Key items:

- **`StorageBackend` + `SaveProjectInput`** — contract in `services/storageBackend.ts`; use `storageService` in app code; backends implement the same `saveProject` union (Redux envelope or flat `StoryProject`).
- `components/AdvancedImportExport.tsx` — keep browser vs Tauri export paths explicit
- `app/listenerMiddleware.ts` — redux-undo `StateWithHistory` typing at boundaries
- `workers/inference.worker.ts:50` — `@ts-expect-error` on `@xenova/transformers` dynamic import (lives in `packages/ai-core`; Vite resolves at build time but `tsc` can't see it from root)
- **DS-5:** Delete legacy bridge block from `index.css` — deferred until DS-1 token migration verified in production (all intentional vars documented above)
- **Voice v1.2 planned:** WASM engines (Whisper.cpp STT, Kokoro/Piper TTS, Silero VAD, Sherpa-ONNX wake-word); semantic intent matching (MiniLM embeddings); local LLM fallback for complex commands; E2E voice tests (Playwright)
- **v2.0 open (stubs behind feature flags):** RTL language support (`enableRtlLayout`); LoRA adapter inference (`enableLoraAdapters`); Cloud-Sync Cloudflare R2 adapter (`enableCloudSync`); Plugin system loader (`enablePluginSystem`). RTCDataChannel in-flight E2E encryption is **shipped** (y-webrtc patch, v1.17.0).

## graphify

This project has a graphify knowledge graph at `graphify-out/`. See [`docs/graphify.md`](docs/graphify.md) for setup. Only `graphify-out/GRAPH_REPORT.md` is committed; `graph.html` and `graph.json` are gitignored.

Rules:
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `pnpm run graphify:update` (or `graphify update .` if the CLI is on `PATH`) to keep the graph current (AST-only, no API cost). First-time Python setup: `pnpm run graphify:bootstrap` (PyPI package **`graphifyy`**).

## codegraph

This project uses CodeGraph (`.codegraph/`) for semantic code intelligence via MCP.

Rules:
- Before answering code-structure, caller/callee, or impact questions, use CodeGraph MCP tools (`codegraph_context`, `codegraph_impact`, `codegraph_trace`)
- If `.codegraph/` exists, answer directly with CodeGraph — don't delegate exploration to a file-reading sub-agent
- For "how does X reach Y", use `codegraph_trace` instead of manual Grep + Read chains
- After modifying code, the graph auto-syncs (2s debounce). For large refactors, run `pnpm run codegraph:update`
- To find affected tests: `pnpm run codegraph:affected`

### Dual-Graph workflow
1. Architecture / high-level questions: Read `graphify-out/GRAPH_REPORT.md` first
2. Code navigation / symbols / impact: Use CodeGraph MCP tools
3. Cross-module relationships: Use Graphify `query`/`path` or CodeGraph `context`
