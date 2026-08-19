# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Shell Execution — Environment-Aware Rules

### Low-End Local Hardware (Current Environment)

Shell-execution rules (one Bash call per turn, no parallel heavy shells, plan-mode exception) live in the user-global `~/.claude/CLAUDE.md` and apply here. Project-specific addition: DevContainer / Codespaces configuration has been removed; this is a local-only development environment.

## Commands

```bash
pnpm run dev           # Vite dev server on http://localhost:3000
pnpm run build         # Production build to dist/
pnpm run smoke:prod    # Headless mount check on dist/ (run AFTER build; catches prod-only crashes)
pnpm run lint          # Biome lint (--error-on-warnings — warnings fail like CI)
pnpm run lint:fix      # Biome auto-fix (lint + format)
pnpm run typecheck     # TypeScript type check — EXACT CI command (tsgo --project tsconfig.tsgo.json --noEmit --checkers 4). typecheck:single = lighter single-checker (may miss errors the gate catches; do not trust for the gate)
pnpm run test          # Vitest watch mode
pnpm run test:run      # Vitest single run (CI mode)
pnpm run test:coverage # Vitest with V8 coverage (thresholds: lines 74%, branches 60%, functions 67%, statements 72%)
pnpm run bench         # Vitest perf benchmarks (tests/bench) — baseline gate for the Y.Doc-as-SoT / Local-First migration
pnpm run content:guard # Validate community templates for secrets / eval payloads
pnpm run i18n:check    # Locale key parity + bundle rebuild (runs in CI quality job)
pnpm run i18n:bundle   # Rebuild public/locales/<lang>/bundle.json from source JSON
pnpm run mutation      # Stryker mutation — CI-ONLY; trigger via: gh workflow run mutation.yml
pnpm run test:e2e      # Playwright E2E tests (CI=true required; CI-only)
pnpm run test:e2e:deep # Deep coverage suite — feature-flag matrix + error paths (CI-only; non-blocking)
pnpm run test:storybook # Storybook test-runner (CI; needs Storybook running or built)
pnpm run graphify:update    # Rebuild AST-only knowledge graph (no API cost)
pnpm run ci:quick           # lint + typecheck + i18n:check + unit tests — low-end hardware shortcut
pnpm run parity:check       # tsx scripts/audit-feature-parity.ts — feature-flag parity audit (CI gate; must report 0 drifts)
pnpm run suppressions:check # check-suppressions.mjs — biome-ignore/eslint-disable ratchet gate (never add a new suppression)
pnpm run token:audit        # audit-tokens.mjs — design-token usage gate (CI baseline guard)
```

**Run a single test file:** `pnpm exec vitest run tests/unit/serviceName.test.ts`
**Run tests matching a name pattern:** `pnpm exec vitest run -t "pattern"`

**Quality gate (matches CI `quality` job):** `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage`. Full pipeline graph: [`docs/CI.md`](docs/CI.md). Coverage thresholds: lines 74, branches 60, functions 67, statements 72 (see `vitest.config.ts`).

**CI pipeline order:** `security` → `quality` (Biome + tsgo + Vitest matrix) → `build` / `e2e` / `storybook` (parallel) → `lighthouse` (after build) → `deploy` on `main`. `ci-success` is a required-status aggregator (`needs: [security, quality, build]`) so branch protection can require one context instead of three/four individual ones — see `docs/CI.md`.

**CI-cloud-first workflow (constrained local hardware only):** On low-end hardware, run only `lint`, `typecheck`, `i18n:check` locally before pushing. Coverage, E2E, Lighthouse, and Stryker are CI-gate jobs. After each push, update README.md badges and AUDIT.md quality-gate line with CI-reported numbers. Local CI simulation: `act pull_request --job quality` (Docker + `act`; see `infra/low-end-ci/DAILY-DRIVER.md`).

**CI audit & housekeeping policy (ALL CI runs must be fully green):**
- After every commit, monitor ALL CI jobs: security (OSV + CodeQL), quality (Biome + tsc + Vitest), build, e2e, lighthouse, deploy, mutation, storybook.
- **CodeQL scanning**: Check `https://github.com/qnbs/WorldScript-Studio/security/code-scanning` after every push. Fix the root cause — do not just suppress alerts.
- **Token-Permissions**: All GitHub Actions workflows must set top-level `permissions: contents: read`; write permissions belong at the job level, never top-level.
- **OSV vulnerabilities**: Run `pnpm audit` or check the security CI job. Add `pnpm.overrides` with pinned exact versions.
- Correction loop: fix → commit → verify CI → fix until all jobs green.

**PR review-comment policy — the CodeRabbit Correction Loop (proactive, automatic, every PR):** Fix ALL inline comments (CodeRabbit + any other bot/human) on every PR, **without being asked** — this explicitly includes CodeRabbit's collapsed **nitpick** sections and **outside-diff-range** findings (both easy to miss since they're collapsed by default in the review UI), not just its top-level actionable comments. Validate findings against the *current* code (anchors may be stale); implement real **root-cause** fixes (code **+ tests + i18n + docs** in lockstep) or reply with evidence if a false positive. **Never add a new `biome-ignore`** — the suppression ratchet (`scripts/check-suppressions.mjs`) fails the quality gate; refactor so the rule passes honestly. Reply to each thread citing the resolving commit (`POST .../comments/<id>/replies`), resolve it (GraphQL `resolveReviewThread`), leave **0 unresolved**. Then commit, push, and **re-trigger** (`gh pr comment <N> --body "@coderabbitai review"`) — check its **full review history**, not just the latest status (a "rate limited" latest status can hide an earlier real review). **Iron rule — loop until quiescent:** a push triggers a fresh review that often raises NEW findings (a "wave"); repeat the full cycle until **BOTH** a fresh review yields **0 new comments** AND **0 threads unresolved**. Only then merge (auto-squash; admin-squash only after CI is green + loop quiescent). CodeAnt AI shows up as 5 CI **status checks** (`CodeAnt - Quality Gates/SAST/SCA/SCR/Test Coverage`) to verify green — it is not the bot posting inline comments in this repo, so don't re-trigger it expecting a comment thread. Full canonical procedure: [`docs/CODEANT-REVIEW-LOOP.md`](docs/CODEANT-REVIEW-LOOP.md).

**PR-size limit — keep every PR under ~100 changed files so CodeAnt actually reviews it.** CodeAnt does **not** post inline review comments on PRs that exceed ~100 changed files (the >100-file check hangs/skips). Since any i18n-touching change fans out across 19 locale source files + 19 rebuilt `bundle.json` per module, a multi-feature branch crosses 100 fast. **Before pushing, run `git diff --name-only <base>...HEAD | wc -l`.** If it is over ~100, split the work into the **fewest** stacked PRs that each stay clearly under the limit — group by which locale module-files they touch so the per-PR fan-out stays small (e.g. P0 batch touching `writer.json`; P1/P2 batch touching `common.json`/`dashboard.json`). Stack them (PR2 base = PR1's branch) so each PR's incremental diff — what CodeAnt sees — is small; when PR1 merges, PR2 auto-retargets to `main`. **Do not** make more PRs than needed: if everything fits under ~100 in one (or two) PRs, use that. Keep commits atomic per concern regardless of how they are bundled into PRs.

**Branching & merge discipline (every change, no exceptions):** Never commit directly to `main` — always create a feature branch, push, and open a PR, even for a single-file doc/config/chore edit. Before merging, wait for the **full CI suite to go green, including non-required/advisory jobs** (`E2E Tests`, `E2E Deep Coverage`, `Storybook`, `Lighthouse`, `Visual Regression`) — not just the branch-protection-required checks (Security Audit, Build, Quality Gate ×2). When doing a structured multi-step sprint (an audit, a migration broken into workstreams), group related small workstreams into the fewest PRs that stay reviewable — by natural/documented boundaries, not one PR per tiny item — while keeping one commit per logical concern inside each PR.

**Known merge-gate quirks (GitHub, this repo):**
- **Mergeable-state cache lag vs. this repo's own wait-for-everything policy — two different things:** (1) GitHub itself blocks the merge button while *any* check is still `pending`, required or not (a real, observed technical constraint — it clears on its own once every check concludes, pass or fail); separately, once all checks have actually concluded, GitHub's branch protection only re-blocks on a *failing required* check. (2) This repo's own policy above is stricter than that floor: wait for the advisory jobs to *pass*, not just stop being `pending`, before merging. If `gh pr merge` still fails with "base branch policy prohibits the merge" after every job (required and advisory) shows a concluded `success`, and `mergeable: MERGEABLE`, and 0 review threads are unresolved, that's the mergeable-state *cache* lagging behind reality, not either policy above. Re-poll a few times at ~60s spacing. Never use `--admin` to route around any of this without a maintainer's fresh, explicit authorization for that specific merge.
- **Stacked-PR auto-close on squash-merge:** squash-merging a PR with `--delete-branch` can cause GitHub to **auto-close (not retarget)** a downstream PR whose base was the just-deleted branch, instead of the usual automatic retarget-to-`main`. Recovery: `git push origin <last-known-head-sha>:refs/heads/<deleted-branch-name>` to temporarily restore the ref, `gh pr reopen <n>`, `gh pr edit <n> --base main`, then delete the temp branch once `gh pr list --state open --json baseRefName` shows nothing still depends on it.

**E2E notes:** Do NOT use `networkidle` waits (HMR keeps WebSocket open). Scope sidebar navigation via `#sidebar`. Shared helpers: `tests/e2e/helpers.ts`. Mobile E2E: set `RUN_MOBILE_E2E=1` locally (off by default).

**Feature-flag E2E coverage (anti-pattern guard):** Every test that relies on a specific flag state MUST use `setFeatureFlags(page, {...})` from `helpers.ts` to make that dependency explicit and guard against future default changes. Call it BEFORE `page.goto()` — it uses `addInitScript` so it runs before app JS.

Three E2E layers: (1) feature specs (`proforge-flags.spec.ts`, `voice-flags.spec.ts`, `lora-wizard.spec.ts`) — flag explicitly seeded, required CI gate; (2) deep matrix (`tests/e2e/deep/feature-flag-matrix.spec.ts`) — parametrized smoke across all `testConfigurations` in `test-matrix.ts`, non-blocking `e2e-deep` job; (3) error paths (`tests/e2e/deep/error-paths.spec.ts`) — offline AI, rapid nav, all flags on; also in `e2e-deep`.

When adding a new feature flag: (a) add an entry to `tests/e2e/config/test-matrix.ts`, (b) write at least one test in `tests/e2e/<feature>-flags.spec.ts` that seeds the flag and verifies a critical UI element. Ask: *"If this flag were off by default tomorrow, would CI still catch a regression?"*

Pre-commit hook runs Biome check via `simple-git-hooks` + `lint-staged` on staged files.

Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
## Architecture

WorldScript Studio is an offline-first PWA — a React 19 SPA with Google Gemini AI, IndexedDB persistence, and optional Tauri desktop packaging. No backend; API keys are entered in the UI and encrypted at rest via one of four platform-specific mechanisms (no single blanket guarantee) — see README § [Encryption — which mechanism protects what](README.md#-encryption--which-mechanism-protects-what).

**Live:** `https://worldscript-studio.vercel.app/` (Vercel, primary) · GitHub Pages: `https://qnbs.github.io/WorldScript-Studio/` · Cloudflare Pages: `wrangler.toml` · Vercel: `vercel.json`.

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
                     ai/          Vercel AI SDK layer (index.ts entry, providerFactory, worldScriptCompletionFetch,
                                   hybridFallback, aiPolicy, aiRetry, aiModeService + cache/health/gpu/eco/embedding services)
                                   providers/ — openrouterProvider (circuit breaker, free-tier catalog, RPM tracking)
                     copilot/     heuristicEngine (8 manuscript rules), insightGenerator, copilotContextService,
                                   actionApplier (apply-to-chapter, offset-safe, ≥70% length gate)
                     commands/    (palette registry, fuzzy rank, recent/pinned)
                     duckdb/      (duckdbClient, duckdbSchema, duckdbAnalytics, duckdbMigration, ragVectorMigration)
                     help/        (helpCatalog, helpSearch, helpDocRetrieval)
                     keyboard/    (shortcut normalization, conflict detection)
                     proForge/    (proForgeOrchestrator, proForgeMemoryBank, proForgeHistoryStore,
                                   applyReviewEdits, pipelineAgents/ — baseAgent, supervisorAgent + 8
                                   stage agents; pipelineOutput/)
                     storage/     (idbCore, idbProjectStore, idbSnapshotStore, idbKeyStore, idbCodexStore,
                                   idbAssetStore, storageEncryptionService — AES-256-GCM at-rest via B-1)
                     voice/       (voiceCommandService, voiceTypes, stt/tts/vad/wakeWord/intent engines,
                                   wasmSttEngine + sileroVadEngine — B-2 scaffolds)
packages/         → Internal workspace packages: ai-core (WebLLM + inference worker), ui,
                     collab-transport (vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption),
                     worker-bus (typed worker pool, circuit breakers, dead-letter queue — see § WorkerBus below)
locales/          → i18n source JSON — 19 locales (de/en/es/fr/it/ar/he/el/ja/pt/zh/fi/sv/hu/is/eu/fa/ru/ko × 21 modules); runtime: public/locales/<lang>/bundle.json
                     ar/ + he/ + fa/ — RTL (fa is Arabic-script Persian); el/ja/pt/zh — Near-production; fi/sv/hu/is/eu/ru/ko — Beta (Phase X + Tier-1 2026 expansion). SSOT: i18n/locales.ts
tests/            → unit/ (Vitest) + e2e/ (Playwright); shared E2E helpers in tests/e2e/helpers.ts
types/            → Supplemental TypeScript definitions (duckdb-wasm-worker.d.ts, tauri-plugins.d.ts)
types.ts          → Core shared interfaces and types (root level)
workers/          → plugin.worker.ts (sandboxed plugin execution, P0-2)
                     v2/ → sole worker generation since ADR-0015: inference.worker.ts (@huggingface/transformers v3),
                     duckdb.worker.ts (DuckDB-WASM), webllm.worker.ts (P1-1, @mlc-ai/web-llm)
infra/low-end-ci/ → Local CI stack: Forgejo + act + systemd units + bash scripts
scripts/          → Build/deploy helpers (sync-deploy-base, cf-pages-deploy, graphify-update, etc.)
```

### State Management

Redux Toolkit with feature-sliced slices: `features/project/`, `features/settings/`, `features/status/`, `features/writer/`, `features/versionControl/`, `features/featureFlags/`, `features/proForge/`, `features/plotBoard/`, `features/sceneComments/`, `features/progressTracker/`, `features/analytics/`, `features/mindMap/` (mind-map viewport, NOT undo-able), `features/lora/` (LoRA adapter state), `features/voice/` (voice command runtime state), `features/copilot/` (ephemeral chat state, NOT persisted, NOT undo-wrapped). The `project` slice is wrapped with `redux-undo` (100-step history). Side effects (auto-save, Codex extraction, DuckDB dual-write) run in `app/listenerMiddleware.ts`, not in components or hooks.

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

**Tauri build isolation:** `vite.config.ts` uses `external: [/^@tauri-apps\//]` (regex) to exclude all Tauri packages from the web build. The regex covers any `@tauri-apps/*` import, but new Tauri capability access should go through `packages/desktop-contracts` (the `DesktopPlatform` interface, consumed via `services/desktopPlatform.ts`) rather than a direct import — enforced by `pnpm run guardrail:desktop-imports` (`scripts/check-tauri-import-boundary.mjs`), a zero-tolerance CI gate.

**Tauri CSP:** When adding a new external endpoint, extend `connect-src` in `src-tauri/tauri.conf.json`. Web `fetch` alone is not enough.

### AI Services

`geminiService.ts` is the primary adapter for legacy thunks. `aiProviderService.ts` provides the multi-provider abstraction (Gemini, OpenAI, OpenRouter, Claude, Grok, Ollama, WebLLM, ONNX Runtime Web, Transformers.js). `features/project/aiThunkUtils.ts` provides a deduplicated async-thunk wrapper (service-level `_pendingRequests` Map).

**AI Execution Modes:** `services/ai/aiModeService.ts` — singleton managing `AiMode = 'hybrid' | 'cloud' | 'local' | 'eco'`. Mode persisted to `settings.aiMode`; synced from `listenerMiddleware` on change (no page reload). `AiModeIndicator` chip in Copilot header shows active mode + OpenRouter circuit-breaker state.

**OpenRouter (Cloud 5):** `services/ai/providers/openrouterProvider.ts` — circuit breaker (4 × 429 → 5 min pause), RPM tracking, free-tier catalog (`:free` suffix = zero cost). Slots in after primary cloud provider in the routing chain.

**AI constants:** `services/ai/aiConstants.ts` is the single source for `CREATIVITY_TO_TEMPERATURE`, `LOCAL_BACKEND_PRESET_DEFAULT_URL`, `ORCHESTRATION_READY_PROVIDERS`, `LOCAL_INFERENCE_PROVIDERS`. Older per-constant files re-export from here and remain for import compatibility.

**Vercel AI SDK layer (Strangler pattern):** `services/ai/index.ts` is the canonical entry. New Writer streaming uses `hooks/useWorldScriptAI.ts` (wraps `useCompletion` with `worldScriptCompletionFetch`). New code routes through `services/ai/` + `useWorldScriptAI`; legacy thunks remain for backwards compatibility. Always gate cloud AI calls with `assertCloudAiAllowed` from `services/ai/aiPolicy.ts`.

`services/ai/aiRetry.ts` — `withTransientRetry(fn, opts)` wraps any AI call with transient-error retries. Use this instead of ad-hoc retry logic.

**WebLLM / local inference:** `services/localAiFacade.ts` wraps `@mlc-ai/web-llm` (via `packages/ai-core`). Supported models: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B. Tab-leader election via BroadcastChannel prevents multi-tab GPU contention. **WebLLM offload (P1-1, ADR-0005):** inference runs in the dedicated WorkerBus v2 `webllm` pool (`workers/v2/webllm.worker.ts`, capability `inference.webllm`), NOT on the main thread. `generateLocalText` is worker-first via `ensureWebLlmPool()` (decoupled from `enableWorkerBusV2`) with an automatic main-thread fallback (`runLocalTextGeneration`) on `NO_WEBGPU` / worker-spawn failure / circuit-open. GPU mutex (`gpuResourceManager`) + tab election stay main-thread, acquired before enqueue.

**Local RAG:** `services/localRagIndex.ts` + `localRagService.ts` — hybrid retrieval (60% semantic MiniLM-L6-v2 + 30% lexical + 10% recency). `ragMode: 'hybrid' | 'lexical'` in `settings.advancedAi` (default `'hybrid'`).

**Prompt assembly:** `services/ragPromptAssembly.ts` — `assembleRAGPrompt(opts)`. Templates from `services/promptLibrary.ts`.

**Heuristic-fallback layer:** `services/ai/heuristicFallback/` — when every provider in the chain fails terminally (offline, quota, Eco/Heuristics-only mode), `aiProviderService` calls `applyHeuristicFallback(task, ctx)` (`seam.ts`) before falling through to the generic local stub. It looks up a per-feature generator in `registry.ts` (keyed by task id: `outline`, `character.profile`, `world.profile`, `plotBoard.beat`) and builds a `HeuristicFallbackResult` from existing project data — no network call. Returns `null` when no generator is registered for a task, so wiring a new call site is always non-breaking. Generators self-register via `registerHeuristicGenerator(task, fn)` at module load (mirrors the `services/copilot/heuristicEngine.ts` pluggable-rule pattern). `useHeuristicFallback()` + `<AssistedModeBadge>` surface an "Assisted (offline)" badge wherever a result came from this layer; events also feed `telemetryService` as `backend: 'heuristic'`.

### DuckDB Analytics

`workers/v2/duckdb.worker.ts` off main thread via the shared WorkerBus v2 `duckdb` pool (OPFS → in-memory fallback, ADR-0015). `duckdbClient.ts`: adapter over `ensureDuckDbPool()`/`bus.enqueue()`, auto-reinits on a respawned worker's "not initialized" error. Schema: 10 tables + 5 views incl. `rag_chunks` (FLOAT[384]). Gate all paths behind `enableDuckDbAnalytics`. Dual-write via `duckdbListenerLoader.ts` (dynamically imported). `ragVectorMigration.ts`: FLOAT[64]→FLOAT[384] upgrade. `useDuckDb.ts` 30s timeout; `useAnalytics.ts` parallelizes 4 queries.

### Logging

Use `services/logger.ts` (StructuredLogger — B-6, v1.19.0) for all diagnostic output. Never use `console.log` in production paths. `console.warn`/`console.error` are allowed. Never write API keys, IVs, or plaintext payloads to any log.

**StructuredLogger API:** `createLogger('module')` → `.info/.warn/.error(msg, ctx?)` + `.withContext(ctx)` for scoped logging. **GDPR sanitization:** `sanitizeLogContext(ctx)` redacts `/key|token|password|passphrase/i` → `'[REDACTED]'` on every `.withContext()` and all IDB/Tauri writes.

**Sinks:** IDB (`worldscript-logs-db`, 1 000-entry LRU) + Tauri JSONL (`$APPDATA/logs/worldscript-YYYY-MM-DD.jsonl`) + console (DEV-only). `getRecentLogs()` / `clearLogs()` — backward-compat ring-buffer API retained.

### Environment Variables

Client-side env vars must use the `VITE_*` prefix. Access via `import.meta.env.VITE_*`. Sensitive user keys go through the AES-256-GCM IDB path in `dbService.ts` — never in env files.

### Storage

**Decomposed IDB layer (`services/storage/`):** `dbService.ts` re-exports from: `idbCore.ts`, `idbProjectStore.ts`, `idbSnapshotStore.ts`, `idbKeyStore.ts`, `idbCodexStore.ts`, `idbAssetStore.ts`, `storageEncryptionService.ts`.

`storageService.ts` auto-detects IndexedDB vs. Tauri filesystem. Data access must go through `dbService` or thunks — never raw IndexedDB. Never use `localStorage` for sensitive data.

**At-rest encryption (B-1, `enableIdbAtRestEncryption`):** PBKDF2 (600 000 iter, SHA-256) → AES-256-GCM, `extractable: false`. Call `initIdbEncryption(passphrase)` before any IDB read/write when flag is on. Passphrase UX complete: Settings → Privacy → "Encrypt project data at rest". On startup with flag on, `IdbUnlockModal` prompts for the passphrase; `PassphraseModal` in Settings handles set/unlock/disable/rotate. **Phase 4 (#338) production wiring shipped:** `services/storage/encryptionMigrationOrchestrator.ts` combines the primary-store adapters (`primaryProtectedStoreAdapters.ts` — images, binder assets, codex, app-data, snapshots; `ragVectorsProtectedStoreAdapter.ts` — bespoke per-project adapter) with the pre-existing secondary-store adapters into one journal-backed migration; `clearIdbPassphrase()`/`rotateIdbPassphrase()` in `storageEncryptionService.ts` are the real disable/rekey entry points (no longer stubs). `services/storage/protectedWriteAdmission.ts` (Web Locks API) admits ordinary protected writes/deletes in shared mode and migration batches in exclusive mode, closing the write-vs-migration race. If a migration is interrupted (reload/crash) before reaching `'completed'`, `EncryptionRecoveryModal` (App.tsx startup guard, priority over `IdbUnlockModal`) lets the user re-enter their passphrase(s) to resume via `resumeEncryptionMigration()`; a `'recovery-required'` journal (the migration's own verification found an inconsistency) is surfaced as an honest stuck state requiring manual recovery, not auto-fixed.

`services/dbInitialization.ts` exports `checkStorageHealth()` — proactive low-storage warning on app init.

### Collaboration

Real-time P2P via Yjs + `packages/collab-transport`. Signaling AES-256-GCM/PBKDF2, deterministic salt from `projectId`. RTCDataChannel E2E encryption in vendor fork y-webrtc 10.3.0 (C-1). No second CRDT layer. **Fork maintenance:** All files imported by `y-webrtc.js` must exist in `src/` — missing imports cause `UNRESOLVED_IMPORT` on Vercel (security checklist: issue #60).

### WorkerBus v2 (`packages/worker-bus`)

Central orchestration layer for all background tasks — since ADR-0015, the **sole** worker generation (no more v1/v2 duplication). Key files: `workerBus.ts` (authoritative bounded priority scheduler + circuit breakers, `hasPool()`/`terminatePool()` for scoped pool lifecycle), `workerPool.ts` (event-driven availability, auto-scaling `MIN`→`MAX_WORKERS_INFERENCE`, idle timeout), `taskQueue.ts` (`critical > high > normal > low`; 32 ordinary slots + 8 critical reserve), `circuitBreaker.ts` (per-worker health gate), `deadLetterQueue.ts`, `protocolHandler.ts` (typed postMessage + version negotiation, currently unused by the live `runTask()` path — not wired up), `workerBootstrap.ts` (`registerTaskHandler` inside worker scripts; handlers receive `WorkerHandlerContext.emitProgress(stage, progress, message?)`, a flat function, not `context.progress.emit(...)`). `timeoutMs` is an inactivity watchdog beginning at enqueue and rearmed by valid progress.

**All constants** re-exported from `constants.ts`. **Schemas** (Zod) in `schemas.ts` gate cross-thread messages. After changes: `pnpm exec vitest run tests/unit/workerBus`.

### Code Splitting

All 22 views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy libraries (export: `docx`, `jszip`, `jsPDF`; collaboration: Yjs; graphs: `react-force-graph-2d`) live in separate Vite manual chunks. `listenerMiddleware.ts` and `aiApi.ts` use dynamic imports for DuckDB/RAG/provider init. Keep export/collaboration dependencies lazy.

**SW-excluded chunks** (in `vite.config.ts` `globIgnores` — never precache): `vendor-duckdb` (~2 MB gzip), `vendor-onnx` (ONNX Runtime Web), `vendor-transformers` (@huggingface/transformers), `vendor-webllm` (~4-5 MB). `vendor-ai-core` is the small orchestration layer and is precached. When adding a new heavy optional chunk, add it to both `manualChunks` and `globIgnores`.

### Build & bundler gotchas (Vite 8 + rolldown)

Production uses **rolldown** (not esbuild/rollup); CI E2E runs `vite dev` — prod bundle is never exercised by E2E. `pnpm run smoke:prod` (CI build job) is the guard; run locally after any `vite.config.ts` or dep change.

- **rolldown ignores `rollupOptions.treeshake`** — tree-shaking controlled by `package.json "sideEffects"`. A dep with `"sideEffects": false` can drop its `__esm` init wrappers → `init_<name> is not defined` blank screen. Fix: `pnpm patch <dep>` → `"sideEffects": true` (see `patches/zod@4.4.3.patch`). Apply with `pnpm install --no-strict-peer-dependencies`.
- **`tsc` incremental cache** can mask new type errors — delete `*.tsbuildinfo` before trusting local typecheck. `vitest` uses esbuild and does NOT type-check.
- **Blank screen diagnosis:** capture `pageerror` in real Chromium on the built bundle. `index.tsx` renders a recovery screen on `error`/`unhandledrejection`; pure blank `#root` = hard module-eval crash.

### Feature Flags

Experimental features are gated behind `features/featureFlags/featureFlagsSlice.ts` (**23 flags**). New installs get the **full feature set**: all flags default **on** except seven user-opt-in flags. `enableCodexAutoTracking` + `enableCrossProjectSearch` were promoted to permanent core behaviour (v1.20 / v1.8); `enablePlotBoardV2` and `enableCloudSync` were retired — none of those four remain in the slice. UI: Settings → Experimental flags (`FeatureFlagsSection.tsx`). Do not use scattered `if (true)` hacks.

**Default on (16):** `enableStoryBibleAdvanced`, `enableBinderResearch`, `enableCompileWizard`, `enableProjectHealthScore`, `enableAppHealthPanel`, `enableDuckDbAnalytics`, `enableObjectsGroups`, `enableMindMaps`, `enableCharacterInterviews`, `enableLoraAdapters`, `enablePluginSystem`, `enableIdbAtRestEncryption` (B-1, passphrase UX complete — Settings › Privacy), `enableAdaptiveAiEngine`, `enableComputeShaders`, `enableWorkerBusV2`, `enableRustCompute`. **User opt-in — default off (7):** `enableProForge` (experimental, token-heavy 8-stage agentic pipeline — flipped to opt-in in v1.24 post-release), `enableVoiceSupport` (requires browser mic permission), `enableVoiceWasm` (B-2, ~57 MB Whisper download), `enableGlobalCopilot` (ambient AI), `enableRtlLayout` (B-5, ar/he stubs only), `enableLocalFirstSync` (shadow Yjs projection, ADR-0008; Redux stays SoT), `enableBrowserOllama` (ADR-0017, Issue #266 — direct browser→Ollama fetch in the web/PWA build, only works if the user's own server has OLLAMA_ORIGINS configured for this origin; advanced/unsupported). The Settings UI groups these by catalog tier; `features/featureCatalog.ts` **derives** each flag's `defaultOn` from the slice (no hand-keyed drift). Note: `enableCloudSync` was **retired** in v1.20 (no UI shipped; `CloudSyncBackend.create()` requires explicit-consent boolean instead).

### Command Center & shortcuts

- **`services/commands/`** — single registry for palette entries: definitions, fuzzy rank/score, recent/pinned prefs, lightweight AI suggestions. **`components/CommandPalette.tsx`** renders from this registry (ARIA combobox/listbox patterns).
- **`contexts/CommandExecutorContext.tsx`** + **`CommandExecutorProvider` in `App.tsx`** — expose `executeCommand` / `runCommandById` to deep UI (Help „Try it" via `tryActionId`, toasts with `commandId`).
- **`app/transientUiStore.ts`** — Zustand store includes **`isCommandPaletteOpen`** (palette wired here; avoid duplicate local-only state).
- **`hooks/useGlobalKeyboardShortcuts.ts`** + **`services/keyboard/`** — normalize OS modifiers, match bindings from settings.
- **Help system:** `services/help/` — `helpCatalog.ts` (50+ articles), `helpSearch.ts`, `helpDocRetrieval.ts`.

### i18n

Custom React Context in `I18nContext.tsx` — not i18next. SSOT for locale metadata: `i18n/locales.ts` (`LOCALES` — code/name/status/script/LanguageTool tier; everything else derives from it). **19** source locales: **de, en, es, fr, it** (production), **ja, zh, pt, el** (near-production — full key parity, `help.json` still falls back to English), **ar, he, fa** (RTL beta; fa = Persian/Arabic script), **fi, sv, hu, is, eu, ru, ko** (beta). All 19 ship as `public/locales/<lang>/bundle.json` rebuilt by `pnpm run i18n:bundle` or auto via `pnpm run i18n:check`. All user-facing strings must use `t('key.path')` from `useTranslation()`. New keys: add to **all 19** locale trees (`node scripts/check-i18n-keys.mjs --fix`), then `pnpm run i18n:bundle`. The `/i18n-key` skill targets the **5 production** locales only; update the remaining 14 manually afterward. See [`docs/LANGUAGE-EXPANSION-2026.md`](docs/LANGUAGE-EXPANSION-2026.md) for the fi/sv/hu/is/eu/fa rollout and the user-run bulk-translate workflow (ru/ko followed the same Tier-1 2026 expansion pattern).

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
| C++ / Rust (`apps/desktop-cef/`) | `// QNBS-v3: <reason / impact>` |
| CMake (`CMakeLists.txt`) | `# QNBS-v3: <reason / impact>` |
| Pure config (JSON, YAML, TOML — e.g. `package.json`, workflow `.yml`, `Cargo.toml`) | No inline comment — explain in the commit message |

**Hard rule — one physical line, never wrapped, in every syntax above:** a `QNBS-v3: …` comment MUST fit on a single physical line, however long, regardless of which comment syntax (`//`, `#`, `/* */`) the language uses. Never split it across two lines (`// QNBS-v3: foo\n// bar`) — CodeRabbit and Qodo both flag this as a nitpick on every PR that does it, and it has recurred across TS/JS, YAML, and C++ files in this repo's history. If the reason doesn't fit on one line, shorten it; don't wrap it. This applies the first time a new language/file type is touched too — don't wait for a review bot to point out that the language wasn't in the table yet before applying the same one-line discipline.

Skip for pure formatting, lockfile updates, or generated artefacts.

### Recurring review-loop findings — codified to prevent repeats

These patterns have each triggered a CodeRabbit/DeepSource finding more than once. Apply proactively, don't wait for the bot:

- **QNBS-v3 comments:** one line only (see hard rule above).
- **DOM elements for download/print (`document.createElement('a')`):** name the variable descriptively (`anchor`, `link`) — never the single letter `a`/`el`.
- **Never mutate a `ref.current` directly during render** (e.g. `tRef.current = t;` as a bare statement in the component body). Sync it in an effect instead: `useEffect(() => { tRef.current = t; }, [t]);` — a bare-render assignment can leak a stale value from a discarded/interrupted render.
- **Tests — prefer `@testing-library/user-event` over `fireEvent`** for anything simulating a real user interaction (`click`, `type`, `change` on a form field). `fireEvent` is fine only for low-level DOM events `userEvent` doesn't cover.
- **Cyclomatic complexity:** replace long `if/else if` format/type dispatch chains with a lookup table (`Partial<Record<Key, Fn>>` + a single ternary/optional call) instead of adding more branches — especially inside `useCallback`.

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
- No direct `@tauri-apps/api` imports in `components/ui/` atoms; abstract through the `DesktopPlatform` interface (`packages/desktop-contracts`, consumed via `services/desktopPlatform.ts`), mechanically enforced by `pnpm run guardrail:desktop-imports`.
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors.
- Never skip failing tests to green CI — fix the root cause. `it.skip` requires a file-level comment with reason + ticket.
- **Modus operandi — tests:** When you modify, add, or delete a code file, check whether a corresponding test file exists (`tests/unit/` or `tests/e2e/`). If it does, update it. If it doesn't and the change is non-trivial, create it. Run with `pnpm exec vitest run <path>` to verify. Write fully deterministic tests: mock `Date.now()` / fake timers; no real network; reset Redux store + IDB in `beforeEach` (patterns from `tests/setup.ts`). Use `@testing-library/user-event` for interactions; `findBy*` / `waitFor` for async assertions.
- **Vitest concurrency:** `maxWorkers: 1` — tests run serially. Do not parallelize.
- **IDB unit tests:** `// @vitest-environment node` + `new IDBFactory()` per test + `_resetDbForTest()`. See `sceneRevisionService` tests as canonical pattern.

## Current Patterns

### Plot Board

**plotBoardSlice:** `features/plotBoard/plotBoardSlice.ts` — ephemeral viewport/UI state only (zoom/pan/mode/draw). NOT undo-able; persists to `localStorage`. Story content (connections, subplots, tensionOverrides) lives in `projectSlice` — use selectors from `features/project/projectSelectors.ts` and dispatch `projectActions.add/removePlotConnection`, `add/deletePlotSubplot`, `setPlotTensionOverride`.

**plotBoardService:** `services/plotBoardService.ts` — `computeTensionCurve(sections, overrides)`, `autoLayoutScenes(sections)`, `exportBoardAsSvg(svgEl)`.

**Plot Board AI:** `features/project/thunks/plotBoardAiThunks.ts` — `suggestNextBeatThunk` calls `assembleRAGPrompt` then dispatches to AI. Hook: `hooks/usePlotBoardAi.ts`.

**PlotMinimap:** `components/scene-board/PlotMinimap.tsx` — viewport overview overlay. `plotLayoutUtils.ts` provides grid-snap helpers.

### ProForge Pipeline

8-stage agentic editing pipeline. Flag: `enableProForge`. Full docs: `docs/PROFORGE-PIPELINE.md`. Stages: `intake` → `structural` → `lineProse` → `copyEdit` → `proof` → `production` → `publishing` → `analytics`. Pauses at `awaitingReview` — manuscript never auto-modified without user approval. On review submit, accepted `ReviewItem`s for **editing stages** are applied back into the manuscript via `applyReviewEdits.ts` (offset-safe, back-to-front, stale-match skip) before the post-stage snapshot; redux-undo makes them reversible.

**Redux slice** (`features/proForge/proForgeSlice.ts`, root key `proForge`, NOT undo-wrapped, **ephemeral**). Completed/aborted runs persist per project to IDB `proforge-run-history` (`proForgeHistoryStore.ts`, cap 20) and rehydrate via `useProForgeOrchestrator`. **Types** in `features/proForge/types.ts`. **Orchestrator:** `services/proForge/proForgeOrchestrator.ts` — call via `hooks/useProForgeOrchestrator.ts` (reads live state via `appStoreRef` from `app/storeRef.ts`), never instantiate in components. Agents (all 8 extend `BaseAgent`) lazy-loaded per stage; call `this.buildAiOpts({ maxTokens: N })` — `AIRequestOptions` requires `model` + `provider`. `BaseAgent` provides `requireProject()`, `getMemoryBank()`, `selfReflect()`, `elapsed()`, `setRetryFeedback()` (supervisor reasons injected into retry prompts).

**SupervisorAgent**: heuristic gate, no AI calls, gates **all 8 stages**. `evaluate(stage, result)` → `SupervisionDecision { pass, retryRecommended, qualityScore, reasons }`. Detects `isFallback: true` (intake/structural/proof). Hard gate: intake `qualityScore < 30` → fail. All `createFallback*` use 0 scores + `isFallback: true` — never fake mid-range values. **Memory Bank:** IDB `proforge-memory-bank`; `search(query, limit, mode)` honours `ragMode` (`lexical` | `semantic` | `hybrid` via MiniLM embeddings, keyword fallback). **View:** `ProForgeViewContext` + `useProForgeViewContext()`.

### Scene-level services

**sceneRevisionService:** `services/sceneRevisionService.ts` — IDB `scene-revisions`; `saveRevision(sectionId, snapshot, label?)`, `listRevisions(sectionId)`, `deleteRevision(id)`.

**sceneCommentsSlice:** `features/sceneComments/sceneCommentsSlice.ts` — EntityAdapter; `selectCommentsBySection(sectionId)`, `selectUnresolvedCount`, `selectUnresolvedCountBySection(sectionId)`. Root key: `sceneComments`.

**progressTrackerSlice:** `features/progressTracker/progressTrackerSlice.ts` — `startSession`, `endSession`, `setDailyGoal`, `setWeeklyGoal`, `syncStreak`. Exported: `computeStreak(history)`.

**deepLinkService:** `services/deepLinkService.ts` — `parseHash(hash)`, `pushHash(view, sectionId?)`, `readCurrentView()`. Views: `'board' | 'preview' | 'progress' | 'project'`.

### Test mock patterns

**useAppSelectorShallow with plotBoard:** Include `plotBoard: { activeMode: 'swimlane', snapToGrid: false, selectedConnectionId: null, isDrawingConnection: false, drawFromSectionId: null, activeSubplotFilter: null, zoom: 1, panX: 0, panY: 0 }` in mock state. Connections/subplots/tensionOverrides are in `project.present.data`. Add `// biome-ignore lint/suspicious/noExplicitAny: test mock` before `(selector: (s: any) => unknown)` lines.

**FeatureFlagsState mocks:** Always include ALL 23 flags (TypeScript strict rejects partial). Only **seven** default **off**: `enableProForge`, `enableRtlLayout`, `enableVoiceSupport`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`, `enableBrowserOllama` — every other flag (including all edge-AI flags and `enableIdbAtRestEncryption`) defaults **on**. When a test needs a non-default flag state, set it explicitly in the mock — don't assume the default.

**ConnectionLayer test IDs:** `data-testid="connection-group"` — query by testid, not role.

**DuckDB in tests:** Mock `services/duckdb/duckdbClient` with `{ execAsync: vi.fn(), queryAsync: vi.fn() }`. Never initialize real DuckDB-WASM.

**AI thunk tests:** `settingsReducer` defaults to `privacy.localStorageOnly: true` → AI thunks throw. Fix: mock `services/ai/aiPolicy` with `assertCloudAiAllowedSync: vi.fn()` + `assertCloudAiAllowed: vi.fn().mockResolvedValue(undefined)` before all imports.

**Context hooks in component tests:** Mock the context module (`vi.mock('../../../contexts/XyzContext', ...)`) rather than wrapping in the real provider tree. Apply for any `use*ViewContext` hook.

**Custom Select/LanguageSelector mocks:** Mock as native `<select>` element for testing-library compatibility. See canonical pattern in existing settings test files.

### Settings Navigation

`components/SettingsView.tsx` uses `NAV_GROUPS` — typed array of `{ key: string; ids: readonly string[] }` — for semantic sidebar sections (Writing, AI Models, Appearance & Accessibility, Privacy & Data, Connections, System). When adding a new settings tab: add its `id` to the correct group in `NAV_GROUPS`; do not create a flat ungrouped entry.

### Cross-project & backup

**crossProjectIndexService / crossProjectSearchService:** IDB `projects-index-store` (DB_VERSION 8); `searchAcrossProjects()` via fuzzyScore. Indexing triggered on save. UI: `CrossProjectSearchPanel`; Zustand key: `isCrossProjectSearchOpen`.

**libraryBackupService:** one-click encrypted ZIP export (AES-GCM, `META.json` + `vault.bin`). Settings → Data.

### Global AI Copilot (v2)

Flag: `enableGlobalCopilot`. Redux slice: `features/copilot/copilotSlice.ts` (ephemeral, NOT persisted, NOT undo-wrapped). Hook: `hooks/useGlobalCopilot.ts`. Mount: `App.tsx` (lazy, `ErrorBoundary` + `Suspense`).

**Services (`services/copilot/`):**
- `copilotContextService.ts` — pure system-prompt builder from current view + project metadata
- `insightGenerator.ts` — debounced heuristic analysis; result LRU-cached per section
- `heuristicEngine.ts` — 8 built-in manuscript rules (tension-drop, underdeveloped-character, open-loop, slow-pacing, high-repetition, plot-hole, missing-world-context, overlength-scene); zero network calls
- `actionApplier.ts` — `applyTextEdit(sectionId, newText)`: offset-safe rewrite dispatched into redux-undo; only runs when block ≥ 70 % of section length

**UI (`components/copilot/`):** `CopilotPanel` (dialog/sidebar toggle, persisted to `localStorage`), `CopilotMessageList` (DOMPurify + micro-markdown renderer — no new runtime dep), `InlineAnnotationLayer` (badge inside `ManuscriptEditor`), `CopilotComposer`. ProForge: each `ReviewItemCard` has an ✦ Ask Copilot chip (pre-fills composer with review-item context).

Docs: `docs/COPILOT.md` (feature guide), `docs/HEURISTIC-RULES.md` (8 rules catalogue).

### Voice Full Support

Engines defined in `services/voice/voiceTypes.ts` (`SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine`). Contract: `isAvailable()` → `initialize()` → use → `dispose()`. Web Speech API fallbacks: `WebSpeechSttEngine`, `WebSpeechTtsEngine`, `WebRtcVadEngine` (zero downloads). WASM path (B-2, `enableVoiceWasm`): `WasmSttEngine` (Whisper.cpp) + `SileroVadEngine`; model download via `VoiceModelDownloadModal` + `VoiceCommandService.preloadModel(modelType)`.

**Intent engine:** `HybridIntentEngine.parse(transcript, context)` — exact match → fuzzy Jaccard + slot extraction. **Orchestrator:** `VoiceCommandService` singleton (state machine), dispatches via `runCommandById`, `appStoreRef` for Redux outside React. **Hooks:** `useVoice`, `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation`, `useVoiceAccessibility`. **Gating:** `settings.voice.enabled && featureFlags.enableVoiceSupport`. **Never log transcripts** (PII → IDB log sink); `startListening` has a single-flight guard (C-P1).

**Voice E2E seam (P1-2):** `services/voice/voiceTestSeam.ts` — `getVoiceTestHarness()` reads `window.__voiceTestHarness` (only ever set by Playwright `addInitScript`; undefined in production). `createSttEngine`/`createVadEngine` return injected mock engines, and `downloadVoiceModels` runs a simulated download, when the harness is present. Installers: `tests/e2e/mocks/voiceMockEngines.ts`. Deterministic suite: `tests/e2e/deep/voice/whisper-stt.spec.ts` (e2e-deep); real-inference nightly: `whisper-real.spec.ts` + `voice-nightly.yml` (`RUN_REAL_VOICE_E2E=1`). Chromium fake-media flags live in `playwright.config.ts`.

### Local inference

`services/localAiFacade.ts` wraps WebLLM with the same provider interface as `aiProviderService.ts`. Model download progress via `onProgress`; mount-guard via `useRef`.

### Plugin System

`services/pluginRegistry.ts` — `PluginRegistry` + singleton. Plugins declare `PluginDescriptor` (Zod-validated: `id`, `version`, `type`, `entrypoint`, `permissions`). `PluginSandboxedApi` gates every method behind declared permissions.

**Execution API:** `execute(id, fn, rawApi)` (sync) · `executeAsync` (async) · `loadPlugin(descriptor, rawApi)` (dynamic import + `run(api)`).

Reference plugins: `wordCountOverlay.plugin.ts`, `sceneAppender.plugin.ts`. Gate: `enablePluginSystem`.

### Cloud Sync (Cloudflare R2)

`services/cloudSync/` — `cloudSyncBackend.ts` (StorageBackend, API keys never sent to cloud), `cloudSyncClient.ts` (fetch + Bearer token), `cloudSyncEncryption.ts` (AES-256-GCM E2E). The `enableCloudSync` feature flag was **retired** in v1.20; use `CloudSyncBackend.create(..., explicitConsent = true)` as the activation gate. This service is not yet wired into `storageService` (v2.0 feature).

### LoRA Adapter Inference

**Wiring (C-3):** `AIRequestOptions.loraModelPath?: string` — when set and `provider === 'ollama'`, `streamProvider()` substitutes it as the Ollama model identifier. `selectActiveLoraOllamaTag` (`features/lora/loraSelectors.ts`) returns active adapter's `ollamaModelTag` or null.

**Prerequisite:** `ollama create <tag> -f Modelfile` before setting `ollamaModelTag`. Training is a Python sidecar.

**Gating:** `enableLoraAdapters` flag. UI: Settings → AI → Fine-Tuning.

### Virtual scrolling

Feature-specific implementation patterns (Plot Board, ProForge Pipeline, scene-level services, LanguageTool, test mock patterns, Settings Navigation, cross-project & backup, Global AI Copilot, Voice Full Support, local inference, Plugin System, Cloud Sync, LoRA Adapter Inference, virtual scrolling) now live in nested `CLAUDE.md` files, loaded automatically only when working under that directory: `features/plotBoard/`, `services/proForge/`, `services/`, `tests/`, `components/`, `services/copilot/`, `services/voice/`, `services/cloudSync/`, `features/lora/`.

## Known Technical Debt

See `AUDIT.md` and `TODO.md`. Key items:
- `workers/v2/inference.worker.ts` (v1 deleted, ADR-0015) — `@huggingface/transformers` v3 path alias in `tsconfig.json`; if the alias breaks, fix the path alias or the package's type declaration directly — do not suppress with `@ts-expect-error` (conflicts with the suppression-ratchet policy above).
- **DS-5:** Delete legacy bridge block from `index.css` — deferred until DS-1 verified in production.
- **B-1 (IDB encryption):** Passphrase UX complete (`IdbUnlockModal`, `PassphraseModal` set/unlock/disable/rotate, `EncryptionRecoveryModal`). Phase 4 (#338) production migration wiring shipped — see § At-rest encryption above. Remaining: E2E coverage for the disable/rotate/recovery round trips (unit + component tests only so far).
- **B-2 (Voice WASM):** Engine + download UI shipped. Remaining: E2E integration test coverage.
- **SW version sync:** `public/sw.js` `APP_VERSION` and the Tauri versions are **auto-synced** from `package.json` `version` by `scripts/sync-sw-version.mjs` + `scripts/sync-tauri-version.mjs`, which run on every `predev`/`prebuild` — no manual edit needed (just bump `package.json` for a release). The earlier "must hand-sync" note is obsolete.

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

- **Feature flags:** After any flag change run `pnpm exec tsx scripts/audit-feature-parity.ts` — must report 0 drifts.
- **CSP:** After modifying CSP directives in `src-tauri/tauri.conf.json` or `index.html`, validate at `https://csp-evaluator.withgoogle.com`. No `*` in `default-src`, `connect-src`, or `img-src`; WebSocket sources must be explicit hostnames.
- **Dependencies:** After adding a dep run `pnpm audit --audit-level=high`. Override vulnerabilities via `pnpm.overrides`; document accepted risk in `AUDIT.md`.
- **Vendor forks:** After modifying `packages/collab-transport/`, update `VENDOR-FORKS.md` + run `pnpm run verify:vendor`.
- **Settings / Storage:** New nested settings objects need default-merge guards in both `services/storage/idbProjectStore.ts → normalizePersistedSettings` AND `features/settings/settingsSlice.ts → setSettings`. Components use `?? defaults`.
