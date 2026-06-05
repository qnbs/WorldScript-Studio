# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Shell Execution — Environment-Aware Rules

### GitHub Codespaces (CODESPACES=true) — 8-Core / 16 GB RAM

Parallel Bash calls are safe. Use the full Claude Code parallel tooling model:
- **Multiple Bash tool calls in the same message are allowed** — run independent commands in parallel.
- **`run_in_background` is allowed** for long builds (`pnpm run build`, `pnpm run build:edge`, `pnpm exec vitest run --coverage`).
- Chain dependent steps with `&&` in a single call; fire independent reads/greps in parallel.
- Full quality gate runs locally: `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage`

### On Low-End Local Hardware (< 4 GB RAM free)

**ONE Bash tool call per turn.** This machine had ~3.7 GB RAM with < 500 MB free. Concurrent shells (vitest, biome, tsc, vite, pnpm build) cause OOM, VS Code force-closes, and pool-worker timeouts.
- ONE Bash tool call per turn. Wait for the result. Then proceed.
- NO `run_in_background` for vitest, biome, tsc, vite, or any pnpm build command.
- NO parallel Agent tool calls that each issue shell commands.
- NO multiple Bash tool calls in the same response block.
- Chain sequential steps inside ONE Bash call using `&&` if needed.

## Commands

```bash
pnpm run dev           # Vite dev server on http://localhost:3000
pnpm run dev:turbo     # Turbo parallel dev (all packages)
pnpm run build         # Production build to dist/
pnpm run build:edge    # Edge/SSR-compatible build (Vercel, Cloudflare Workers)
pnpm run build:pages   # Cloudflare Pages build
pnpm run preview       # Preview production build locally
pnpm run smoke:prod    # Headless-browser mount check on the built dist/ (run AFTER build; catches prod-only crashes)
pnpm run lint          # Biome lint (--error-on-warnings — warnings fail like CI)
pnpm run lint:fix      # Biome auto-fix (lint + format)
pnpm run format        # Biome format --write (format only)
pnpm run typecheck     # TypeScript type check (tsgo --noEmit)
pnpm run typecheck:parallel # TypeScript type check with parallel workers (tsgo --checkers 4 --builders 4)
pnpm run parity:check  # Feature flag parity audit (must report 0 drifts)
pnpm run test          # Vitest watch mode
pnpm run test:run      # Vitest single run (CI mode)
pnpm run test:coverage # Vitest with V8 coverage (thresholds: lines 67%, branches 56%, functions 68%, statements 68%)
pnpm run test:vrt      # Visual regression tests (Chromium only; CI-only by policy)
pnpm run content:guard # Validate community templates for secrets / eval payloads
pnpm run i18n:check    # Locale key parity + bundle rebuild (runs in CI quality job)
pnpm run mutation      # Stryker mutation report (see stryker.conf.json)
pnpm run test:e2e      # Playwright E2E tests (CI=true required; E2E are CI-only)
pnpm run analyze       # Bundle analysis (ANALYZE=true vite build)
pnpm run bundle:budget # Check vendor chunk sizes (max 7000 KB; entry max 4500 KB)
pnpm run storybook     # Storybook on port 6006
pnpm run test:storybook # Storybook test-runner (CI; needs Storybook running or built)
pnpm run tauri:dev     # Tauri desktop app (requires Rust)
pnpm run i18n:bundle   # Rebuild public/locales/<lang>/bundle.json from source JSON
pnpm run graphify:update    # Rebuild AST-only knowledge graph (no API cost)
pnpm run graphify:bootstrap # First-time graph setup
pnpm run codegraph:update   # Force-reindex CodeGraph
pnpm run codegraph:affected # List files/tests affected by current diff
pnpm run graphs:update      # Update both graphify + CodeGraph in one shot
pnpm run ci:quick           # lint + typecheck + i18n:check + unit tests (no coverage) — low-end hardware shortcut
pnpm run ci:quick:unit      # lint + typecheck + i18n:check only
pnpm run ci:quick:coverage  # lint + typecheck + i18n:check + unit tests with coverage
```

**Run a single test file:** `pnpm exec vitest run tests/unit/serviceName.test.ts`
**Run tests matching a name pattern:** `pnpm exec vitest run -t "pattern"`

**Quality gate (matches CI `quality` job):** `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage`. Full pipeline graph: [`docs/CI.md`](docs/CI.md). Coverage thresholds: lines 67, branches 56, functions 68, statements 68 (P1 target, see `vitest.config.ts`).

**CI pipeline order:** `security` → `quality` (Biome + tsgo + Vitest matrix) → `build` / `e2e` / `storybook` (parallel) → `lighthouse` (after build) → `deploy` on `main`.

**CI-cloud-first workflow (constrained local hardware only):** On low-end hardware, run only `lint`, `typecheck`, `i18n:check` locally before pushing. Coverage, E2E, Lighthouse, and Stryker are CI-gate jobs. After each push, update README.md badges and AUDIT.md quality-gate line with CI-reported numbers. Local CI simulation: `act pull_request --job quality` (Docker + `act`; see `infra/low-end-ci/DAILY-DRIVER.md`).

**CI audit & housekeeping policy (ALL CI runs must be fully green):**
- After every commit, monitor ALL CI jobs: security (OSV + CodeQL), quality (Biome + tsc + Vitest), build, e2e, lighthouse, deploy, mutation, storybook.
- **CodeQL scanning**: Check `https://github.com/qnbs/StoryCraft-Studio/security/code-scanning` after every push. Fix the root cause — do not just suppress alerts.
- **Token-Permissions**: All GitHub Actions workflows must set top-level `permissions: contents: read`; write permissions belong at the job level, never top-level.
- **OSV vulnerabilities**: Run `pnpm audit` or check the security CI job. Add `pnpm.overrides` with pinned exact versions.
- Correction loop: fix → commit → verify CI → fix until all jobs green.

**PR review-comment policy (proactive, exhaustive, immediate — every PR, always):**
- On every open PR, treat **all** inline review comments, suggestions, issues, bug reports, and notes — from **CodeAnt AI and any other reviewer/bot** (human or automated) — as actionable work to be addressed **proactively and immediately**, without waiting to be asked.
- Fetch them all: inline via `gh api repos/qnbs/StoryCraft-Studio/pulls/<N>/comments --paginate`; issue-level via `.../issues/<N>/comments`; thread/resolution state via the GraphQL `reviewThreads` query.
- For **each** comment: (1) **validate** the finding against the *current* code — never trust a comment's line/anchor, which may be stale (CodeAnt pins to the old commit); (2) if valid, **implement the real fix directly** (root cause, fully worked out — code + tests + i18n + docs, everything that belongs to it), not a suppression or a partial patch; (3) if already fixed or a false positive, say so explicitly with evidence.
- After fixing, **reply** to each thread (`POST .../pulls/<N>/comments/<id>/replies`) citing the resolving commit + what changed, then **resolve** the thread (GraphQL `resolveReviewThread`). Leave **0 unresolved threads**.
- Then commit (Conventional Commits), push, and verify CI goes green per the correction loop above. This is a standing rule: do it now and on every future PR.

**E2E notes:** Do NOT use `networkidle` waits (HMR keeps WebSocket open). Scope sidebar navigation via `#sidebar`. Shared helpers: `tests/e2e/helpers.ts`. Mobile E2E: set `RUN_MOBILE_E2E=1` locally (off by default).

Pre-commit hook runs Biome check via `simple-git-hooks` + `lint-staged` on staged files.

Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Codespaces Modus Operandi

**Session-start checklist (every Codespace session):**
1. `git pull origin main` — sync with remote
2. `pnpm install --frozen-lockfile` — pick up lockfile changes (fast via volume cache)
3. `pnpm run lint && pnpm run typecheck` — 60-second smoke test
4. `gh run list --limit 5` — review recent CI runs

**Test failure triage:**
```bash
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u        # failing files
pnpm exec vitest run tests/unit/FILENAME.test.ts             # single file
```

## Architecture

StoryCraft Studio is an offline-first PWA — a React 19 SPA with Google Gemini AI, IndexedDB persistence, and optional Tauri desktop packaging. No backend; API keys are entered in the UI and encrypted at rest.

**Stack:** React 19, TypeScript (strict), Vite 8, Tailwind CSS 4.x, Redux Toolkit 2.x, pnpm 10, Node ≥ 22. Four internal workspace packages (`@domain/ai-core`, `@domain/ui`, `collab-transport`, `@domain/worker-bus` in `packages/`) are consumed as `workspace:*` deps.

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
services/         → External adapters; key sub-dirs:
                     ai/          Vercel AI SDK layer (index.ts entry, providerFactory, storyCraftCompletionFetch,
                                   hybridFallback, aiPolicy, aiRetry + cache/health/gpu/eco/embedding services)
                     commands/    (palette registry, fuzzy rank, recent/pinned)
                     duckdb/      (duckdbClient, duckdbSchema, duckdbAnalytics, duckdbMigration, ragVectorMigration)
                     help/        (helpCatalog, helpSearch, helpDocRetrieval)
                     keyboard/    (shortcut normalization, conflict detection)
                     proForge/    (proForgeOrchestrator, proForgeMemoryBank, pipelineAgents/ — baseAgent,
                                   supervisorAgent + 8 stage agents; pipelineOutput/, pipelinePrompts/, pipelineTools/)
                     storage/     (idbCore, idbProjectStore, idbSnapshotStore, idbKeyStore, idbCodexStore,
                                   idbAssetStore, storageEncryptionService — AES-256-GCM at-rest via B-1)
                     voice/       (voiceCommandService, voiceTypes, stt/tts/vad/wakeWord/intent engines,
                                   wasmSttEngine + sileroVadEngine — B-2 scaffolds)
packages/         → Internal workspace packages: ai-core (WebLLM + inference worker), ui,
                     collab-transport (vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption),
                     worker-bus (typed worker pool, circuit breakers, dead-letter queue — see § WorkerBus below)
locales/          → i18n source JSON (de/en/es/fr/it/ar/he × 15 modules); runtime: public/locales/<lang>/bundle.json
                     ar/ + he/ — locale stubs added in B-5 (RTL beta); full translation content is v2.0
tests/            → unit/ (Vitest) + e2e/ (Playwright); shared E2E helpers in tests/e2e/helpers.ts
types/            → Supplemental TypeScript definitions (duckdb-wasm-worker.d.ts, tauri-plugins.d.ts)
types.ts          → Core shared interfaces and types (root level)
workers/          → inference.worker.ts (@huggingface/transformers v3), duckdbWorker.ts (DuckDB-WASM)
infra/low-end-ci/ → Local CI stack: Forgejo + act + systemd units + bash scripts
scripts/          → Build/deploy helpers (sync-deploy-base, cf-pages-deploy, graphify-update, etc.)
```

### State Management

Redux Toolkit with feature-sliced slices: `features/project/`, `features/settings/`, `features/status/`, `features/writer/`, `features/versionControl/`, `features/featureFlags/`, `features/proForge/`, `features/plotBoard/`, `features/sceneComments/`, `features/progressTracker/`, `features/analytics/`, `features/mindMap/` (mind-map viewport, NOT undo-able), `features/lora/` (LoRA adapter state), `features/voice/` (voice command runtime state). The `project` slice is wrapped with `redux-undo` (100-step history). Side effects (auto-save, Codex extraction, DuckDB dual-write) run in `app/listenerMiddleware.ts`, not in components or hooks.

**`addDebouncedListener` factory** (`listenerMiddleware.ts`): use this helper instead of writing raw `startListening` calls with delay. **Critical RTK constraint:** `listenerApi.getOriginalState()` can only be called synchronously before the first `await`. Always capture it as `const originalState = listenerApi.getOriginalState() as RootState` at the top before any `await listenerApi.delay(...)`.

Use typed hooks everywhere: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`.

Transient / ephemeral UI state (palette open, cross-project search open, Flow Mode) lives in `app/transientUiStore.ts` (Zustand). Do not use a third state framework. Key transient keys: `isCommandPaletteOpen`, `isCrossProjectSearchOpen`, `flowMode` / `setFlowMode`.

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
- `--sc-success-fg/bg`, `--sc-info-fg/bg`, `--sc-warning-fg/bg`, `--sc-danger-fg/bg/border` — state color tokens; always use these, not hardcoded `text-green-700` or `text-blue-600` (break on dark theme)

**DS-1/DS-2 complete:** `dark:` violations eliminated. Bridge block in `index.css` contains only intentional vars — do NOT remove: `--border-interactive` (→`--sc-border-focus`), `--nav-*`, `--glass-*`, `--background-gradient-overlay-start`/`--card-gradient-overlay`. **DS-5** (delete bridge block) deferred until production verification.

**Tailwind utilities:** `packages/ui/tailwind-preset.ts` registers `w/h-icon-sc-*`, `text-sc-*`, `rounded-sc-*`, `duration-sc-*`, `ease-sc-*` utilities. Prefer these over one-off `w-4`/`text-sm` for atoms.

**Storybook:** New `components/ui/` primitives require a `.stories.tsx` file with `addon-a11y` checks passing. Test-runner (`pnpm run test:storybook`) runs against the built Storybook in CI.

**Keyboard on non-button elements:** Use `useKeyWithClickEvents` rather than adding raw `onKeyDown` alongside `onClick`. Use `useButtonType` on custom button-like components.

**Accessibility hooks:** `useAnnounce()` from `LiveRegionContext` — signature is `announce(message: string, priority?: 'polite' | 'assertive')`. The second argument is a **string enum**, not an object. `useFocusTrap` re-queries focusable elements on every Tab press (live DOM query, not a cached list).

**Container queries:** Resizable panels set `containerType: 'inline-size'` via inline style. Use `@container` CSS queries or the Tailwind `@container` variant for responsive panel content.

**Tauri build isolation:** `vite.config.ts` uses `external: [/^@tauri-apps\//]` (regex) to exclude all Tauri packages from the web build. When adding new Tauri plugin imports to `services/tauriRuntime.ts`, the regex already covers them.

**Tauri CSP:** When adding a new external endpoint, extend `connect-src` in `src-tauri/tauri.conf.json`. Web `fetch` alone is not enough.

### AI Services

`geminiService.ts` is the primary adapter for legacy thunks. `aiProviderService.ts` provides the multi-provider abstraction (Gemini, OpenAI, Ollama, WebLLM, ONNX Runtime Web, Transformers.js). `features/project/aiThunkUtils.ts` provides a deduplicated async-thunk wrapper (service-level `_pendingRequests` Map).

**AI constants:** `services/ai/aiConstants.ts` is the single source for `CREATIVITY_TO_TEMPERATURE`, `LOCAL_BACKEND_PRESET_DEFAULT_URL`, `ORCHESTRATION_READY_PROVIDERS`, `LOCAL_INFERENCE_PROVIDERS`. Older per-constant files re-export from here and remain for import compatibility.

**Vercel AI SDK layer (Strangler pattern):** `services/ai/index.ts` is the canonical entry. New Writer streaming uses `hooks/useStoryCraftAI.ts` (wraps `useCompletion` with `storyCraftCompletionFetch`). New code routes through `services/ai/` + `useStoryCraftAI`; legacy thunks remain for backwards compatibility. Always gate cloud AI calls with `assertCloudAiAllowed` from `services/ai/aiPolicy.ts`.

`services/ai/aiRetry.ts` — `withTransientRetry(fn, opts)` wraps any AI call with transient-error retries. Use this instead of ad-hoc retry logic.

**WebLLM / local inference:** `services/localAiFacade.ts` wraps `@mlc-ai/web-llm` (via `packages/ai-core`). Supported models: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B. Tab-leader election via BroadcastChannel prevents multi-tab GPU contention.

**Local RAG:** `services/localRagIndex.ts` + `localRagService.ts` — hybrid retrieval (60% semantic MiniLM-L6-v2 + 30% lexical + 10% recency). `ragMode: 'hybrid' | 'lexical'` in `settings.advancedAi` (default `'hybrid'`).

**Prompt assembly:** `services/ragPromptAssembly.ts` — `assembleRAGPrompt(opts)`. Templates from `services/promptLibrary.ts`.

### DuckDB Analytics

`workers/duckdbWorker.ts` runs DuckDB-WASM off main thread (OPFS → in-memory fallback). `services/duckdb/duckdbClient.ts`: singleton with AbortSignal, init retry 3× exponential backoff. Schema: 10 tables + 5 views incl. `rag_chunks` (FLOAT[384]), `cross_project_index`, `codex_*`.

Key rules:
- Gate all DuckDB paths behind `featureFlagsSlice.enableDuckDbAnalytics` (off by default).
- Dual-write (IDB + DuckDB) goes through `duckdbListenerLoader.ts` — dynamically imported to avoid blocking cold start.
- `ragVectorMigration.ts` handles the FLOAT[64]→FLOAT[384] column upgrade.
- `hooks/useDuckDb.ts` initializes with 30 s timeout; `hooks/useAnalytics.ts` parallelizes 4 queries behind the feature flag.

### Logging

Use `services/logger.ts` (StructuredLogger — B-6, v1.19.0) for all diagnostic output. Never use `console.log` in production paths. `console.warn`/`console.error` are allowed. Never write API keys, IVs, or plaintext payloads to any log.

**StructuredLogger API:**
```ts
const log = createLogger('myModule');
log.info('Initialized');
log.warn('Retry', { attempt: 2 });
log.error('Failed', new Error('...'));
const scopedLog = log.withContext({ projectId: 'abc' });
```

**GDPR sanitization:** `sanitizeLogContext(ctx)` redacts `/key|token|password|passphrase/i` → `'[REDACTED]'` on every `.withContext()` and all IDB/Tauri writes.

**Sinks:** IDB (`storycraft-logs-db`, 1 000-entry LRU) + Tauri JSONL (`$APPDATA/logs/storycraft-YYYY-MM-DD.jsonl`) + console (DEV-only). `getRecentLogs()` / `clearLogs()` — backward-compat ring-buffer API retained.

### Environment Variables

Client-side env vars must use the `VITE_*` prefix. Access via `import.meta.env.VITE_*`. Sensitive user keys go through the AES-256-GCM IDB path in `dbService.ts` — never in env files.

### Storage

**Decomposed IDB layer (`services/storage/`):** `dbService.ts` re-exports from: `idbCore.ts`, `idbProjectStore.ts`, `idbSnapshotStore.ts`, `idbKeyStore.ts`, `idbCodexStore.ts`, `idbAssetStore.ts`, `storageEncryptionService.ts`.

`storageService.ts` auto-detects IndexedDB vs. Tauri filesystem. Data access must go through `dbService` or thunks — never raw IndexedDB. Never use `localStorage` for sensitive data.

**At-rest encryption (B-1, `enableIdbAtRestEncryption`):** PBKDF2 (600 000 iter, SHA-256) → AES-256-GCM, `extractable: false`. Call `initIdbEncryption(passphrase)` before any IDB read/write when flag is on. Passphrase UX complete: Settings → Privacy → "Encrypt project data at rest". On startup with flag on, `IdbUnlockModal` prompts for the passphrase; `PassphraseModal` in Settings handles set/change/disable flows.

`services/dbInitialization.ts` exports `checkStorageHealth()` — proactive low-storage warning on app init.

### Collaboration

Real-time P2P via Yjs + `packages/collab-transport` (`collaborationService.ts`). Signaling-channel AES-256-GCM with PBKDF2 (600 000 iter, SHA-256), deterministic salt from `projectId`. **RTCDataChannel E2E encryption** baked into `packages/collab-transport` (vendor fork y-webrtc 10.3.0, crypto hardened in C-1). Signaling URLs: `settings.collaboration.webrtcSignalingUrls`. No second CRDT layer.

**Fork maintenance:** All files imported by `y-webrtc.js` must exist in `src/` — missing relative imports cause `UNRESOLVED_IMPORT` on Vercel builds. Security audit checklist: [issue #60](https://github.com/qnbs/StoryCraft-Studio/issues/60).

### WorkerBus v2 (`packages/worker-bus`)

`@domain/worker-bus` is the central orchestration layer for all background worker tasks. It replaces the ad-hoc worker wiring in `packages/ai-core` with a production-grade runtime.

**Key components:**
- `WorkerBus` (`workerBus.ts`) — top-level orchestrator; routes tasks to the right pool via priority queue and circuit breakers.
- `WorkerPool` (`workerPool.ts`) — lifecycle-managed pool of `PooledWorker` instances; auto-scales between `MIN_WORKERS` and `MAX_WORKERS_INFERENCE`; idle workers time out after `WORKER_IDLE_TIMEOUT_MS`.
- `PriorityTaskQueue` (`taskQueue.ts`) — heap-ordered by `TaskPriority` (`critical > high > normal > low > background`); bounded by `MAX_QUEUE_SIZE`.
- `CircuitBreaker` (`circuitBreaker.ts`) — per-worker health gate; opens after `CIRCUIT_BREAKER_THRESHOLD` consecutive failures within `CIRCUIT_BREAKER_WINDOW_MS`; auto-resets after `CIRCUIT_BREAKER_RECOVERY_MS`.
- `DeadLetterQueue` (`deadLetterQueue.ts`) — captures undeliverable tasks (capacity `DEAD_LETTER_CAPACITY`); inspect via `WorkerBusTelemetry`.
- `ProtocolHandler` (`protocolHandler.ts`) — typed `postMessage` with version negotiation (`PROTOCOL_VERSION`) and ping/pong health-check.
- `WorkerRegistry` (`workerRegistry.ts`) — maps `WorkerCapability` tags to pool instances.
- `workerBootstrap.ts` — `registerTaskHandler` / `deregisterTaskHandler` for use inside worker scripts; provides `WorkerHandlerContext` with `ProgressEmitter`.

**Usage pattern in workers:**
```ts
import { registerTaskHandler, postMessageFromWorker } from '@domain/worker-bus';
registerTaskHandler('inference', async (task, ctx) => {
  ctx.progress.emit(0.5);
  return result;
});
```

**All constants** are re-exported from `constants.ts` — never hardcode timeouts or thresholds. **Schemas** (Zod) in `schemas.ts` gate all cross-thread messages; `validateWorkerMessage` throws on protocol mismatch.

After any modification to `packages/worker-bus`, run `pnpm exec vitest run tests/unit/workerBus` to verify the runtime contracts.

### Code Splitting

All 22 views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy libraries (export: `docx`, `jszip`, `jsPDF`; collaboration: Yjs; graphs: `react-force-graph-2d`) live in separate Vite manual chunks. `listenerMiddleware.ts` and `aiApi.ts` use dynamic imports for DuckDB/RAG/provider init. Keep export/collaboration dependencies lazy.

**SW-excluded chunks** (in `vite.config.ts` `globIgnores` — never precache): `vendor-duckdb` (~2 MB gzip), `vendor-ai-onnx` (ONNX + @xenova/transformers), `vendor-webllm` (~6 MB). When adding a new heavy optional chunk, add it to both `manualChunks` and `globIgnores`.

### Build & bundler gotchas (Vite 8 + rolldown)

The production build uses **rolldown** (not esbuild/rollup), and its behavior differs from dev. These bit hard once (2026-06-02 production blank screen) — read before touching deps, `vite.config.ts`, or debugging a prod-only failure:

- **CI E2E runs `vite dev`** (`playwright.config.ts` `webServer.command`), so the **production rolldown bundle is never exercised by E2E or Lighthouse** — a prod-only crash ships green. `pnpm run smoke:prod` (build → `vite preview` → headless mount check) is the guard; it runs in the CI **build** job. Run it locally after any change to `vite.config.ts`, the bundler, or a vendor dep.
- **rolldown ignores `rollupOptions.treeshake`** (incl. `moduleSideEffects`) in this Vite version — confirmed via canary. Tree-shaking is controlled by each package's `package.json` `"sideEffects"`. A dep with `"sideEffects": false` whose side-effect-only modules are needed at runtime can have its lazy `__esm` init wrappers **dropped while the `init_*()` calls survive** → `init_<name> is not defined` ReferenceError at bootstrap → blank screen. Fix at the dependency level with `pnpm patch <dep>` → `"sideEffects": true` (see `patches/zod@4.4.3.patch`).
- **`pnpm patch-commit` re-resolves** and can trip the pre-existing peer-dep strictness (`vite-plugin-pwa` wants `workbox@^7.4.1`). Apply with `pnpm install --no-strict-peer-dependencies`; CI/Vercel use `--frozen-lockfile` and are unaffected.
- **Canary test "is my `vite.config.ts` even read?"**: rename a `manualChunks` return string, rebuild, check the output filename changed. Chunk hashes are content-derived, so an unchanged `[hash]` means the option had **no effect on content** (not that the config was skipped).
- **`tsc` incremental cache can mask new type errors locally** while CI (clean checkout) fails. Before trusting a local `typecheck`, delete `*.tsbuildinfo`. `vitest` uses esbuild and does **not** type-check, so a green test run says nothing about types.
- **Diagnose blank/white screens by loading the built/live bundle in a real browser**, not by theorizing: `pnpm exec playwright install chromium-headless-shell`, then `import { chromium } from '@playwright/test'` from inside the repo and capture `pageerror`. `index.tsx` renders a recovery screen on `error` **and** `unhandledrejection` — a pure blank `#root` with a `pageerror` is a hard module-eval/bundler crash.

### Feature Flags

Experimental features are gated behind `features/featureFlags/featureFlagsSlice.ts` (20 flags). Default **on**: `enableCodexAutoTracking`, `enableCrossProjectSearch`, `enablePlotBoardV2` (@deprecated — v1 board removed in v1.6; retained in slice for localStorage compat; hidden from Settings UI). All others default **off**. UI: Settings → Experimental flags (`FeatureFlagsSection.tsx`, 19 visible toggles). Do not use scattered `if (true)` hacks.

Key flags: `enableDuckDbAnalytics`, `enableVoiceSupport`, `enableProForge`, `enableStoryBibleAdvanced`, `enableBinderResearch`, `enableCompileWizard`, `enableProjectHealthScore`, `enableAppHealthPanel`. **B-series (all off):** `enableIdbAtRestEncryption` (B-1, passphrase UX complete — enable via Settings › Privacy), `enableVoiceWasm` (B-2, model download UI not wired), `enableRtlLayout` (B-5, ar/he stubs only). **Stub/future (all off):** `enableCloudSync`, `enableLoraAdapters`, `enablePluginSystem`, `enableObjectsGroups`, `enableMindMaps`, `enableCharacterInterviews`.

### Command Center & shortcuts

- **`services/commands/`** — single registry for palette entries: definitions, fuzzy rank/score, recent/pinned prefs, lightweight AI suggestions. **`components/CommandPalette.tsx`** renders from this registry (ARIA combobox/listbox patterns).
- **`contexts/CommandExecutorContext.tsx`** + **`CommandExecutorProvider` in `App.tsx`** — expose `executeCommand` / `runCommandById` to deep UI (Help „Try it" via `tryActionId`, toasts with `commandId`).
- **`app/transientUiStore.ts`** — Zustand store includes **`isCommandPaletteOpen`** (palette wired here; avoid duplicate local-only state).
- **`hooks/useGlobalKeyboardShortcuts.ts`** + **`services/keyboard/`** — normalize OS modifiers, match bindings from settings.
- **Help system:** `services/help/` — `helpCatalog.ts` (50+ articles), `helpSearch.ts`, `helpDocRetrieval.ts`.

### i18n

Custom React Context in `I18nContext.tsx` — not i18next. Locale files for de, en, es, fr, it (15 modules merged into `public/locales/<lang>/bundle.json` — rebuilt by `pnpm run i18n:bundle` or auto via `pnpm run i18n:check`). All user-facing strings must use `t('key.path')` from `useTranslation()`. New keys: add to **all five** locale trees (`node scripts/check-i18n-keys.mjs --fix`), then `pnpm run i18n:bundle`.

**RTL stubs (B-5):** `locales/ar/` + `locales/he/` are English-fallback stubs behind `enableRtlLayout`. Full content is v2.0 community task.

**Cold-start repair:** `services/i18nBootstrap.ts` + `services/projectI18nRepair.ts` run automatically via `App.tsx` — do not bypass.

**Terminology glossary:** *Manuscript*, *Outline*, *Template*, *Snapshot* (auto-save) vs. *Scene Revision* (user-saved), *Writing Session*, *Subplot*, *Connection* (plot board edge). AI is always **Co-Pilot**. See `docs/BEST-PRACTICES.md`.

**Community templates:** `community-templates/index.json` → `public/community-templates/`. Run `pnpm run content:guard` before committing (rejects secrets + `eval`-like payloads).

### Code comment convention (QNBS-v3)

On any non-trivial code change add a single-line comment explaining **why**, not what:

| Context | Syntax |
|---------|--------|
| TS / JS | `// QNBS-v3: <reason / impact>` |
| TSX / JSX | `// QNBS-v3: …` above the changed line; `{/* QNBS-v3: … */}` only when needed inside JSX |
| CSS | `/* QNBS-v3: … */` |
| Pure config (JSON, YAML) | No inline comment — explain in the commit message |

Skip for pure formatting, lockfile updates, or generated artefacts.

## Documentation index

All `.md` guides listed in **[`README.md`](README.md#-documentation-hub) § Documentation Hub**; **[`AUDIT.md`](AUDIT.md)** § *Markdown corpus* has the maintainer inventory. Accessibility: [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md). ProForge: [`docs/PROFORGE-PIPELINE.md`](docs/PROFORGE-PIPELINE.md). Before large changes: read [`ROADMAP.md`](ROADMAP.md), [`AUDIT.md`](AUDIT.md), [`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md).

## Key Constraints

- **TypeScript strict mode (v1.19.0):** `strict`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`. Every declared variable/parameter must be used; array index access returns `T | undefined` (always guard it); index-sig props require bracket notation; no `any` — use `unknown` + type guards or a targeted `// biome-ignore` with reason.
- Never log or expose API keys; never `eval()` AI responses.
- All interactive elements require `role`, `aria-label`, `aria-expanded` (WCAG **2.2** AA; Biome `a11y` warnings fail CI).
- Modals must trap focus and restore on close; decorative icons need `aria-hidden="true"`.
- Gemini API calls must use `NetworkOnly` caching (never cache AI responses in the Service Worker).
- Use `focus-visible:ring-2` for keyboard focus styles.
- `dangerouslySetInnerHTML` only with DOMPurify-sanitized content — never raw.
- No direct `@tauri-apps/api` imports in `components/ui/` atoms; abstract through `services/tauriRuntime.ts`.
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors.
- Never skip failing tests to green CI — fix the root cause. `it.skip` requires a file-level comment with reason + ticket.
- **Modus operandi — tests:** When you modify, add, or delete a code file, check whether a corresponding test file exists (`tests/unit/` or `tests/e2e/`). If it does, update it. If it doesn't and the change is non-trivial, create it. Run with `pnpm exec vitest run <path>` to verify. Write fully deterministic tests: mock `Date.now()` / fake timers; no real network; reset Redux store + IDB in `beforeEach` (patterns from `tests/setup.ts`). Use `@testing-library/user-event` for interactions; `findBy*` / `waitFor` for async assertions.
- **Vitest concurrency:** `maxWorkers: 1` — tests run serially. Do not parallelize.
- **IDB unit tests:** `// @vitest-environment node` + `new IDBFactory()` per test + `_resetDbForTest()`. See `sceneRevisionService` tests as canonical pattern.

## Current Patterns

### Plot Board

**plotBoardSlice:** `features/plotBoard/plotBoardSlice.ts` — ephemeral viewport/UI state only (zoom/pan/mode/draw state). NOT undo-able; persists to `localStorage`. Selectors: `selectActiveMode`, `selectZoom`, `selectPan`, `selectSnapToGrid`, `selectIsDrawingConnection`, `selectDrawFromSectionId`, `selectSelectedConnectionId`, `selectActiveSubplotFilter`.

Story content (connections, subplots, tensionOverrides) lives in `projectSlice` — use selectors from `features/project/projectSelectors.ts` and dispatch `projectActions.addPlotConnection / removePlotConnection / addPlotSubplot / deletePlotSubplot / setPlotTensionOverride / clearAllPlotTensionOverrides`.

**plotBoardService:** `services/plotBoardService.ts` — `computeTensionCurve(sections, overrides)`, `autoLayoutScenes(sections)`, `exportBoardAsSvg(svgEl)`.

**Plot Board AI:** `features/project/thunks/plotBoardAiThunks.ts` — `suggestNextBeatThunk` calls `assembleRAGPrompt` then dispatches to AI. Hook: `hooks/usePlotBoardAi.ts`.

**PlotMinimap:** `components/scene-board/PlotMinimap.tsx` — viewport overview overlay. `plotLayoutUtils.ts` provides grid-snap helpers.

### ProForge Pipeline

8-stage agentic editing pipeline. Flag: `enableProForge` (off by default). Full docs: `docs/PROFORGE-PIPELINE.md`.

**Stage sequence:** `intake` → `structural` → `lineProse` → `copyEdit` → `proof` → `production` → `publishing` → `analytics`. Stages pause at `awaitingReview` — **manuscript is never auto-modified** without explicit user approval.

**Redux slice** (`features/proForge/proForgeSlice.ts`, root key `proForge`, NOT undo-wrapped): actions `stageStarted`, `stageCompleted`, `stageAwaitingReview`, `submitStageReview`, `skipStage`, `rollbackToStage`, `pipelineAborted`, `pipelineCompleted`.

**Types:** `features/proForge/types.ts` — `PipelineStage`, `PipelineConfig`, `PipelineRun`, `StageResult`, `ReviewItem`, `ReviewItemStatus` + per-stage output interfaces (`DiagnosticReport`, `StructuralEditPlan`, `ProseEditBatch`, etc.).

**Orchestrator:** `services/proForge/proForgeOrchestrator.ts` — call via `hooks/useProForgeOrchestrator.ts` (never instantiate in components). Agents are lazy-loaded per stage.

**Agents** (`pipelineAgents/`): all 8 extend `BaseAgent`. Always call `this.buildAiOpts({ maxTokens: N })` — `AIRequestOptions` requires `model` and `provider`. Do not duplicate `requireProject()`, `getMemoryBank()`, `selfReflect()`, `elapsed()` — they're in BaseAgent.

**SupervisorAgent** (`supervisorAgent.ts`): heuristic gate, no AI calls. `evaluate(stage, result)` → `{verdict: 'pass'|'retry'|'fail', reason, retryHint?}`. Detects `isFallback: true`, uniform-score sentinels, implausible ratios. Hard gate: intake `qualityScore < 30` → fail.

**Honest fallbacks:** All `createFallback*` use 0 scores + `isFallback: true`. Never fake mid-range values — the SupervisorAgent uses these flags to trigger retries.

**Memory Bank:** IDB store `proforge-memory-bank` (`proForgeMemoryBank.ts`). Accessed by agents only, not UI.

**View:** `ProForgeViewContext` + `useProForgeOrchestrator` + `components/proForge/`. Use `useProForgeViewContext()` to consume.

**`PipelineConfig` key fields:** `genrePreset`, `selectedStages`, `aiProvider`, `ragMode`, `maxTokens`, `creativity`, `useDuckDb`, `autoAcceptThreshold` (0 = never auto-accept), `language`, `maxRetries` (0|1, default 1).

### Scene-level services

**sceneRevisionService:** `services/sceneRevisionService.ts` — IDB `scene-revisions`; `saveRevision(sectionId, snapshot, label?)`, `listRevisions(sectionId)`, `deleteRevision(id)`.

**sceneCommentsSlice:** `features/sceneComments/sceneCommentsSlice.ts` — EntityAdapter; `selectCommentsBySection(sectionId)`, `selectUnresolvedCount`, `selectUnresolvedCountBySection(sectionId)`. Root key: `sceneComments`.

**progressTrackerSlice:** `features/progressTracker/progressTrackerSlice.ts` — `startSession`, `endSession`, `setDailyGoal`, `setWeeklyGoal`, `syncStreak`. Exported: `computeStreak(history)`.

**deepLinkService:** `services/deepLinkService.ts` — `parseHash(hash)`, `pushHash(view, sectionId?)`, `readCurrentView()`. Views: `'board' | 'preview' | 'progress' | 'project'`.

### Test mock patterns

**useAppSelectorShallow with plotBoard:** Include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in mock state. Connections/subplots/tensionOverrides are in `project.present.data` — mock via `selectPlotConnections: () => []` etc. Add `// biome-ignore lint/suspicious/noExplicitAny: test mock` before `(selector: (s: any) => unknown)` lines.

**FeatureFlagsState mocks:** Always include ALL 20 flags (TypeScript strict rejects partial). B-series to include: `enableIdbAtRestEncryption: false, enableVoiceWasm: false`.

**ConnectionLayer test IDs:** Connection `<g>` elements use `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize real DuckDB-WASM in unit tests.

**AI thunk tests:** `settingsReducer` defaults to `privacy.localStorageOnly: true`, so AI thunks throw "Cloud provider blocked". Fix: add before all imports:
```ts
vi.mock('../../../services/ai/aiPolicy', () => ({
  assertCloudAiAllowedSync: vi.fn(),
  assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined),
}));
```

**Context hooks in component tests:** Mock the context module rather than wrapping in the real provider tree:
```ts
vi.mock('../../../contexts/WriterViewContext', () => ({
  useWriterViewContext: vi.fn(() => ({ flowMode: false, toggleFlowMode: vi.fn() })),
}));
```
Apply for any `use*ViewContext` hook.

### Settings Navigation

`components/SettingsView.tsx` uses `NAV_GROUPS` — typed array of `{ key: string; ids: readonly string[] }` — for semantic sidebar sections (Writing, AI Models, Appearance & Accessibility, Privacy & Data, Connections, System). When adding a new settings tab: add its `id` to the correct group in `NAV_GROUPS`; do not create a flat ungrouped entry.

### Cross-project & backup

**crossProjectIndexService / crossProjectSearchService:** IDB `projects-index-store` (DB_VERSION 8); `searchAcrossProjects()` via fuzzyScore. Indexing triggered on save. UI: `CrossProjectSearchPanel`; Zustand key: `isCrossProjectSearchOpen`.

**libraryBackupService:** one-click encrypted ZIP export (AES-GCM, `META.json` + `vault.bin`). Settings → Data.

### Voice Full Support

**Abstract engine pattern:** `services/voice/voiceTypes.ts` defines `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`. Contract: `isAvailable()` → `initialize()` → use → `dispose()`.

**Web Speech API fallbacks:** `WebSpeechSttEngine`, `WebSpeechTtsEngine`, `WebRtcVadEngine`, `EnergyThresholdWakeWordEngine` — zero downloads, all modern browsers.

**WASM scaffolds (B-2, gated behind `enableVoiceWasm`):** `WasmSttEngine` (Whisper.cpp WASM) + `SileroVadEngine` (Silero VAD v4 via ONNX). Model download UI is Phase 3.

**Intent engine:** `HybridIntentEngine.parse(transcript, context)` — exact Map match → fuzzy Jaccard + keyword bonus → slot extraction. Character/section/world names injected from Redux state.

**Orchestrator:** `VoiceCommandService` singleton — state machine (idle → listening → processing → speaking + dictating). Dispatches via `runCommandById`. `appStoreRef` object pattern for Redux access outside React.

**Hooks:** `useVoice`, `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation`, `useVoiceAccessibility`.

**Gating:** Requires `settings.voice.enabled && featureFlags.enableVoiceSupport`.

### Local inference

`services/localAiFacade.ts` wraps WebLLM with the same provider interface as `aiProviderService.ts`. Model download progress via `onProgress`; mount-guard via `useRef`.

### Plugin System

`services/pluginRegistry.ts` — `PluginRegistry` + singleton. Plugins declare `PluginDescriptor` (Zod-validated: `id`, `version`, `type`, `entrypoint`, `permissions`). `PluginSandboxedApi` gates every method behind declared permissions.

**Execution API:** `execute(id, fn, rawApi)` (sync) · `executeAsync` (async) · `loadPlugin(descriptor, rawApi)` (dynamic import + `run(api)`).

Reference plugins: `wordCountOverlay.plugin.ts`, `sceneAppender.plugin.ts`. Gate: `enablePluginSystem`.

### Cloud Sync (Cloudflare R2)

`services/cloudSync/` — `cloudSyncBackend.ts` (StorageBackend, API keys never sent to cloud), `cloudSyncClient.ts` (fetch + Bearer token), `cloudSyncEncryption.ts` (AES-256-GCM E2E). Gate: `enableCloudSync` flag.

### LoRA Adapter Inference

**Wiring (C-3):** `AIRequestOptions.loraModelPath?: string` — when set and `provider === 'ollama'`, `streamProvider()` substitutes it as the Ollama model identifier. `selectActiveLoraOllamaTag` (`features/lora/loraSelectors.ts`) returns active adapter's `ollamaModelTag` or null.

**Prerequisite:** `ollama create <tag> -f Modelfile` before setting `ollamaModelTag`. Training is a Python sidecar.

**Gating:** `enableLoraAdapters` flag. UI: Settings → AI → Fine-Tuning.

### Virtual scrolling

`NavigatorPanel.tsx` uses `useVirtualizer` from `@tanstack/react-virtual`. Pattern: scrollable `<ul>` with `ref={scrollRef}` + `position: relative`; sentinel `<li>` sets `height: virtualizer.getTotalSize()`; items `position: absolute` with `transform: translateY(${virtualRow.start}px)`. Each item `<li>` needs `data-index={index}` + `ref={virtualizer.measureElement}`. Use `estimateSize: () => 40, overscan: 3`. Never lift `overflow-y: auto` into a parent.

## Known Technical Debt

See `AUDIT.md` and `TODO.md` for the full list. Key items:

- **`StorageBackend` + `SaveProjectInput`** — contract in `services/storageBackend.ts`; use `storageService` in app code.
- `app/listenerMiddleware.ts` — redux-undo `StateWithHistory` typing at boundaries.
- `workers/inference.worker.ts` — `@huggingface/transformers` v3 (migrated from `@xenova` 2026-05-31); resolved via `tsconfig.json` `paths` alias; if alias breaks, restore `@ts-expect-error`.
- **DS-5:** Delete legacy bridge block from `index.css` — deferred until DS-1 verified in production.
- **Voice WASM (B-2 scaffold ready):** `wasmSttEngine.ts` + `sileroVadEngine.ts` exist but model download UI not wired. Phase 3: connect to `WasmSttEngine.initialize()`.
- **IDB at-rest encryption (B-1 complete):** Passphrase UX shipped — `IdbUnlockModal` (startup), `PassphraseModal` (set/change/disable in Settings › Privacy). Flag `enableIdbAtRestEncryption` may be enabled; actual IDB read/write integration for `idbProjectStore` etc. is a separate Phase 4 task (currently service-layer only).

## graphify

This project has a graphify knowledge graph at `graphify-out/`. See [`docs/graphify.md`](docs/graphify.md) for setup. Only `graphify-out/GRAPH_REPORT.md` is committed; `graph.html` and `graph.json` are gitignored.

Rules:
- Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` for god nodes and community structure
- If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep
- After modifying code files in this session, run `pnpm run graphify:update` (AST-only, no API cost). First-time setup: `pnpm run graphify:bootstrap`.

## codegraph

This project uses CodeGraph (`.codegraph/`) for semantic code intelligence via MCP.

Rules:
- Before answering code-structure, caller/callee, or impact questions, use CodeGraph MCP tools (`codegraph_context`, `codegraph_impact`, `codegraph_trace`)
- If `.codegraph/` exists, answer directly with CodeGraph — don't delegate exploration to a file-reading sub-agent
- For "how does X reach Y", use `codegraph_trace` instead of manual Grep + Read chains
- After modifying code, the graph auto-syncs (2s debounce). For large refactors, run `pnpm run codegraph:update`
- To find affected tests: `pnpm run codegraph:affected`

### Dual-Graph workflow
- Architecture questions → `graphify-out/GRAPH_REPORT.md`
- Symbol/impact → CodeGraph MCP tools
- Cross-module → Graphify `query`/`path` or CodeGraph `context`

## Agent Checklist — Post-Change Verification

The following rules are derived from the v1.19.0 audit (AUDIT.md) and MUST be
followed after any change in the respective area.

### Feature Flags
- When adding, removing, or modifying a feature flag, always run:
  ```bash
  pnpm exec tsx scripts/audit-feature-parity.ts
  ```
  The script must report **0 drifts** before the change is considered complete.

### Content Security Policy (CSP)
- When modifying `src-tauri/tauri.conf.json` CSP directives or `index.html` CSP
  meta tags, validate the result with:
  ```bash
  # Online validator (manual)
  open https://csp-evaluator.withgoogle.com
  ```
  Tauri builds must never contain `*` in `default-src`, `connect-src`, or
  `img-src`. WebSocket sources must be explicit hostnames, not protocol-only.

### Dependencies & Supply Chain
- When adding a new dependency (prod or dev), run:
  ```bash
  pnpm audit --audit-level=high
  ```
  If transitive vulnerabilities are introduced, evaluate:
  1. Can the dependency be replaced with a lighter alternative?
  2. Can the vulnerable transitive dep be overridden via `pnpm.overrides`?
  3. Document the accepted risk in `AUDIT.md` under "Known Vulnerabilities".

### Vendor Forks
- When modifying `packages/collab-transport/`, update `VENDOR-FORKS.md` and
  ensure `scripts/verify-vendor-fork.mjs` still passes:
  ```bash
  pnpm run verify:vendor
  ```

### Settings / Storage
- When adding a new nested settings object, add a corresponding default-merge
  guard in **both** places:
  1. `services/storage/idbProjectStore.ts` → `normalizePersistedSettings`
  2. `features/settings/settingsSlice.ts` → `setSettings` reducer
  3. The consuming component must use `?? defaults` as a defensive fallback.
