<!-- This file is written for AI coding agents. It assumes you know nothing about the project. Every claim below is derived from the actual codebase — do not generalize beyond what is documented here. -->

# WorldScript Studio — Agent Guide

---

## Project Overview

**WorldScript Studio** is an offline-first, AI-powered creative writing application. It is a React 19 single-page application (SPA) that runs in the browser as a Progressive Web App (PWA) and can also be packaged as a desktop app via Tauri 2. There is no backend server; all project data lives locally (IndexedDB in the browser, filesystem in Tauri). Cloud AI providers are optional and user-triggered only.

- **Primary deploy target:** Static SPA on GitHub Pages (`/WorldScript-Studio/` base path)
- **Secondary targets:** Vercel (root base) and Cloudflare Pages via edge builds (`pnpm run build:edge`)
- **Desktop:** Tauri 2 bundles for Linux (AppImage), macOS (DMG), and Windows (MSI); auto-updater enabled via `latest.json`
- **Version:** `1.28.1`
- **License:** MIT

The app supports a multi-provider AI stack (Gemini, OpenAI, Claude, Grok, OpenRouter, Ollama, WebLLM, ONNX Runtime Web, Transformers.js), four AI execution modes (Hybrid / Cloud / Local / Eco), real-time collaboration with E2E encryption, a Plot Board v2 with swimlane/canvas/timeline modes, character/world management, manuscript export, voice dictation, and a 19-locale i18n layer.

**Native desktop strategy is changing (ADR-0021, 2026-08-20) — read before touching desktop/native code.** CEF is retired from the target architecture. Current direction: React/PWA stays the web product → Tauri 2 is **transitional only** (itself retired once Qt reaches Stable) → an authoritative Rust Core (`crates/`, an independent Cargo workspace from `src-tauri/`) → Qt 6/Qt Quick as the primary native product → GPUI admitted later, behind a strict gate. Full plan: `docs/native/ROADMAP-QT-GPUI-DESKTOP.md`; decision record: `docs/adr/0021-qt-gpui-native-desktop-strategy.md`. Extraction has started: `crates/worldscript-project` (renderer-neutral project schema/validation/migration, headless — no GUI deps) is wired to one real Tauri command (`worldscript_project_validate` in `src-tauri/src/commands/project_core.rs`) via a cross-workspace Cargo path dependency, and the first typed DesktopPlatform caller observes its bounded verdict on desktop loads without changing the existing TS authority. The envelope is synthesized and partial; unknown TS-only fields are not validated. Priority order for what gets extracted next: `docs/native/CORE-MIGRATION-LEDGER.md`.

---

## ⚠️ Critical Execution Environment Warning (Agent Must Follow)

> **This local development environment runs on low-end / constrained hardware.**
> **All operations must be executed sequentially and with strict resource conservation.**

### Rules for this Environment

1. **No heavy local test suites** – Never run the full Vitest coverage suite, Playwright E2E tests, Stryker mutation testing, Lighthouse CI, or Storybook test-runner locally. These are CI-only by design and would overwhelm this machine.
2. **CI-Cloud-First Workflow** – The canonical quality gate is GitHub Actions (cloud CI). After making changes, push to a branch and let the cloud runners execute the heavy tier.
3. **Local quick tier only** – Locally, run only the lightweight sanity checks:
   ```bash
   pnpm run ci:prepush
   ```
   This gate is mandatory before every push and after every local correction before re-pushing; it classifies the changed files first, runs only applicable local checks, and reports `DEFERRED_TO_REQUIRED_CI` for provably non-TypeScript changes. TypeScript-impacting, dependency, build, native-contract, mixed, ambiguous, and TypeScript test changes run bounded single-checker `tsgo`. The pre-commit hook separately runs staged-file Biome checks. Full repository lint, coverage, E2E, Storybook, Lighthouse, and mutation checks belong to cloud CI. If branch switching or a lockfile/package-manifest change makes pnpm report dependency verification errors, run `node scripts/dependency-state.mjs reconcile` and rerun the complete pre-push gate.
   Optional targeted smoke test: `pnpm exec vitest run <path>` **without** `--coverage`.
   **Hard rule:** Never invoke `pnpm test`, `npm run test`, or a bare Vitest wrapper; always use an explicit `pnpm exec vitest run <path>` command to avoid watch-mode hangs on constrained hardware. Never start multiple heavyweight processes concurrently.
4. **Audit cloud CI logs, fix locally, then re-push** – If the cloud CI run fails, inspect the logs via GitHub web UI or `gh run watch`, reproduce the specific failing test or lint error in isolation, fix it locally (quick tier to verify), commit, and push again for another cloud CI run.
5. **Sequential execution** – Do not parallelize builds, tests, or processes locally. Use single-threaded modes and avoid background tasks that compete for RAM/CPU.
6. **Resource budget** – Avoid spinning up the dev server (`pnpm run dev`) for extended periods if not needed. Prefer one-off commands (`pnpm run build`, `pnpm run typecheck`) and stop the server when done.
7. **No local E2E** – Playwright E2E requires `CI=true` and is CI-only by policy. Do not attempt to run `pnpm run test:e2e` locally.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js `>=22.0.0` (`.nvmrc` → `22`), pnpm `11.22.0` (`packageManager: pnpm@11.22.0`) |
| Framework | React `^19.2.7`, TypeScript 7 via `@typescript/native-preview` (tsgo, strict) — no pinned classic `typescript` package |
| Build tool | Vite `^8.0.16` (`vite.config.ts`) |
| Type checker | `tsgo` (TypeScript Go port) via `tsconfig.tsgo.json` with 4 checkers (`pnpm run typecheck`) |
| Styling | Tailwind CSS `^4.3.1` via `@tailwindcss/vite` + semantic CSS custom properties (`index.css`) |
| State | Redux Toolkit `^2.12.0` + `redux-undo` (project slice only); Zustand `^5.0.14` for transient UI (`app/transientUiStore.ts`) |
| Testing | Vitest `^4.1.10` (jsdom, `maxWorkers: 1`), Playwright `^1.61.1` (E2E, CI-only), Stryker `9.6.1` (mutation, manual workflow only) |
| Lint/Format | Biome `^2.5.4` (`biome.json`) — single toolchain for JS/TS/CSS |
| AI | Multi-provider: Google Gemini (`@google/genai`), OpenAI, Anthropic Claude, Grok, OpenRouter, Ollama, WebLLM, ONNX Runtime Web, Transformers.js |
| Voice | Web Speech API (fallback); WASM engines: Whisper.cpp (STT), Kokoro (TTS), Silero VAD; gated by `featureFlags.enableVoiceWasm` |
| Storage | IndexedDB v8 (`dbService.ts` / `storageService.ts`) / Tauri filesystem (`fileSystemService.ts`); LZ-String compression; AES-256-GCM encryption for API keys and optional IDB at-rest encryption |
| PWA | `vite-plugin-pwa` with `injectManifest` strategy (`public/sw.js`) |
| Desktop | Tauri 2 (`src-tauri/`) — Rust toolchain required |
| Storybook | Storybook `^10.5.3` with `@storybook/react-vite` and `@storybook/addon-a11y` |
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
│   ├── featureFlags/       # 23 flags — full set on by default; 7 opt-in (default-off)
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
├── locales/                # i18n source JSON modules (19 locales)
├── public/                 # Static assets; runtime i18n bundles `public/locales/<lang>/bundle.json`
├── tests/
│   ├── unit/               # Vitest tests (co-located naming convention)
│   ├── e2e/                # Playwright specs (CI-only)
│   └── setup.ts            # Global Vitest setup
├── workers/                # Web Workers: plugin.worker.ts; v2/ is the sole worker generation since ADR-0015 (inference, duckdb, webllm)
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
- `pnpm-workspace.yaml` — workspace packages + pnpm v11 `allowBuilds` default-deny map
- `stryker.config.mjs` + `stryker-scope.json` — 25 curated production targets across 8 risk-tiered modules, `break: 75`
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
pnpm run typecheck:single   # local low-end typecheck: one checker, sequential
pnpm run i18n:check         # Locale key parity vs English + rebuild bundles + content guard
pnpm run parity:check       # Feature parity audit
pnpm run suppressions:check # Biome-ignore count ratchet

# Testing
pnpm exec vitest run <path> # Targeted Vitest single run (no coverage)
pnpm exec vitest run <path> --coverage # Targeted Vitest run with V8 coverage
pnpm run test:e2e           # Playwright E2E (CI=true required; CI-only by policy)
pnpm run test:e2e:ui        # Playwright E2E UI mode (CI=true required)
pnpm run test:e2e:deep      # Deep E2E feature-flag matrix (CI=true required)
pnpm run test:vrt           # Visual regression (Chromium only)
pnpm run mutation           # Stryker incremental mutation testing (CI-only; manual workflow)
pnpm run mutation:force     # Stryker force/no-cache audit (CI-only)
pnpm run mutation:report    # Aggregate downloaded reports; fails on missing/invalid shards

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

**Hard rule:** a `// QNBS-v3: …` comment MUST fit on one physical line, however long — never wrap it across two `//` lines. Shorten the reason instead of splitting it.

### Recurring review-loop findings (codified to avoid repeats)

- **QNBS-v3 comments:** one line only (see hard rule above) — this has recurred 3× in a single PR.
- **DOM elements for download/print** (`document.createElement('a')`): name it `anchor`, not the single letter `a`.
- **Never mutate `ref.current` during render.** Sync refs from props/state inside `useEffect(() => { ref.current = value }, [value])`, never as a bare statement in the component body — a bare assignment can leak a stale value from a discarded render.
- **Tests:** prefer `@testing-library/user-event` over `fireEvent` for click/type/change interactions; keep `fireEvent` only for low-level DOM events `user-event` doesn't model.
- **Cyclomatic complexity:** prefer a lookup table (`Partial<Record<Key, Fn>>`) over long `if/else if` dispatch chains, especially inside `useCallback`.

### Commit Messages

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
After an explicit `pnpm run hooks:install`, the pre-commit hook runs `lint-staged` on staged files
through `node scripts/hooks/pre-commit.mjs`; the pre-push hook runs
`node scripts/hooks/pre-push.mjs`. These direct Node entrypoints verify the content fingerprint
and invoke local binaries without pnpm's workspace-state preflight in the hook path.
The pre-commit hook is not a substitute for the complete pre-push gate; CI remains mandatory when
hooks are not installed.

### Verified signing cutover

`required_signatures` remains enabled on `main`. Before creating or pushing new history, run
`pnpm run signing:doctor` and install the hooks with `pnpm run hooks:install`. The pre-commit hook
fails closed when the effective signing configuration cannot create and Git-verify a signed commit;
the pre-push hook verifies every commit introduced by every ref update and verifies both annotated
release tags and their target commits. CI verifies GitHub's `commit.verification.verified` result
for the complete introduced range and includes that gate in `✅ CI Success`.

Local Git verification and GitHub Verified status are distinct: a local `git verify-commit` pass is
necessary but cannot establish GitHub account/key association. Never use `--no-gpg-sign`, `--no-verify`,
unsigned temporary commits, or unsigned release tags as recovery. Squash merges create a new signed
result and do not rewrite or retroactively verify legacy unsigned source commits. Worktree-local Git
configuration overrides repository and global configuration; the doctor reports unsafe environment
overrides. See [`docs/VERIFIED-SIGNING.md`](docs/VERIFIED-SIGNING.md) for the recovery and audit
procedure.

---

## Testing Instructions

### Philosophy

- **Cloud CI-first:** The canonical quality gate is GitHub Actions. Low-end local machines should run only the "Quick" tier.
- **Quick tier (local, before every push):** `pnpm run ci:prepush` runs the project typecheck with
  one checker, i18n parity/quality/bundle/content checks, release/doc truth, and lightweight desktop guardrails sequentially;
  the pre-commit hook separately runs staged-file Biome checks. Run the gate again after every
  correction before re-pushing; do not
  push based only on a targeted test or a changed-file lint run. Optionally:
  `pnpm exec vitest run <path>` **without** `--coverage`.
- **Dependency state:** `pnpm run deps:verify` compares a content fingerprint of dependency
  manifests, workspace package manifests, and patches. After a dependency-related branch switch,
  run `node scripts/dependency-state.mjs reconcile` (or `pnpm run deps:reconcile` when pnpm can
  start); never use `--no-verify` as the
  normal recovery path.
- **Low-resource policy:** Never run Biome, multiple TypeScript checkers, Vitest, Cargo, Vite,
  Storybook, or other heavyweight processes concurrently on the development workstation. Full
  repository lint/tests, E2E, coverage, Lighthouse, and mutation testing are cloud-CI work unless
  the user explicitly requests a narrowly scoped local run.
- **Vitest watch-mode hard rule:** Never invoke `pnpm test`, `npm run test`, or a bare Vitest wrapper; use an explicit targeted `pnpm exec vitest run <path>` command so constrained hardware never waits on watch mode.
- **First-attempt CI evidence:** The required Vitest job intentionally has no `--retry`; a first-attempt failure remains authoritative. Do not hide a suspected flake with `skip`/`todo` or retries. Temporary quarantine requires a `flaky-test` issue, owner, reproduction evidence, adjacent QNBS-v3 issue/expiry comment, visible CI summary, and removal or explicit renewal within 14 days; see `docs/CI.md`.
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

- Config: `stryker.config.mjs`, with the authoritative target/risk registry in `stryker-scope.json`.
- Scope: 25 production files across 8 modules; Tier A is pure/domain/policy logic, Tier B is bounded adapter/orchestration logic. Generated, type-only, test, and presentation-only glue stays out of scope.
- Incremental mode uses Stryker's supported `--incrementalFile` option and one cache file per module; `vitest.related: true` keeps each mutant on related tests instead of rerunning the full suite. `mutation:force` intentionally bypasses that cache for release, security, or major-refactor audits.
- The manual workflow supports `module: all`, `tier-a`, or one module name. Matrix artifacts retain module identity; aggregation derives canonical metrics from mutant statuses, fails if any expected shard/report is missing or invalid, and exposes killed, survived, timeout, no-coverage, ignored, pending, and error counts separately.
- `break: 75`, `low: 70`, and `high: 85` remain the current operational thresholds; they are not a claimed measured baseline until a trusted force run records one. Do not change them to make a run green.
- **Removed from PR/CI pipeline** (2026-06-02) — mutation runs only via manual `.github/workflows/mutation.yml` (`workflow_dispatch`). Routine local validation must never run broad Stryker; cloud CI owns incremental, force, and report aggregation.

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
deploy (main, non-PR) needs: ci-success ──► GitHub Pages
```

### Jobs

| Job | Purpose |
|-----|---------|
| `security` | `pnpm audit --audit-level=high`, OSV scanner (pnpm + `src-tauri/` + `crates/` Cargo lockfiles), gitleaks secrets scan, dependency review on PRs |
| `quality` | Node 22 + 24 matrix → Biome lint, suppression-debt ratchet, `i18n:check`, `docs:check`, `csp:verify`, `parity:check`, `tsgo --noEmit`, Storybook build, Vitest + coverage, Codecov upload |
| `rust-tauri` | `fmt`/`check`/`clippy`/`test` for `src-tauri/`; path-scoped (skips on PRs that don't touch it), needs GTK/WebKit apt-get steps |
| `core-rust` | Same `fmt`/`check`/`clippy`/`test` for `crates/worldscript-project` (renderer-neutral Rust Core); path-scoped, no GUI deps so no apt-get steps needed |
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

## PR Review & Merge Discipline

Never commit directly to `main` — always a feature branch + PR, even for a single-file edit. Wait for the **full CI suite to go green, including non-required/advisory jobs** (E2E, E2E Deep Coverage, Storybook, Lighthouse, Visual Regression), not just the branch-protection-required checks. Any `FAILURE` status — required or advisory — is zero-tolerance: investigate the actual root cause (pull the coverage report / job log) before deciding how to proceed; never assume a failing check is "probably fine" because your own latest commit looked unrelated — e.g. `codecov/patch` evaluates the PR's **entire accumulated diff**, not just your last commit.

**Review-comment completeness — check three independent channels before declaring a PR review-clean, every time:** (1) GraphQL `reviewThreads` for inline per-line comments; (2) `gh api repos/<owner>/<repo>/issues/<PR>/comments` for plain top-level bot comments (qodo-code-review posts its real findings only here, never as `reviewThreads`); (3) `gh api repos/<owner>/<repo>/pulls/<PR>/reviews`, reading each review's full `.body` text (CodeRabbit's "🧹 Nitpick comments" and outside-diff-range findings live here, collapsed, invisible to the other two channels). A bot using one channel on a PR doesn't mean the others are covered.

**Squash-merge verification:** Never infer a missing merge from `git merge-base --is-ancestor` alone. For every PR, verify `state=MERGED`, `merged_at`, and the resulting `merge_commit_sha`; compare the base commit immediately before the merge with that resulting `main` commit, including changed files, additions, and deletions. Use patch/tree equivalence as an optional corroboration. This is required because GitHub squash merges intentionally produce a new commit whose SHA is not the PR head SHA.

**Known review bots on this repo** (confirm still installed — this list can drift): CodeRabbit (`@coderabbitai review` to re-trigger), CodeAnt AI (5 CI status checks only — `CodeAnt - Quality Gates/SAST/SCA/SCR/Test Coverage` — not inline PR comments here), qodo-code-review (top-level comments, see above), Amazon Q Developer (`/q review` as a fresh top-level comment — not inside an existing thread; quota-conscious — call it once CodeRabbit/CodeAnt's own loop has already reached quiescence, not after every fix commit), Graphite AI Reviews (automatic, no confirmed manual trigger), chatgpt-codex-connector (intermittent/quota-limited availability — verify it's currently active rather than assuming silence means "nothing to report"). A bot's silence is not a clean pass by itself — for security/sandbox/IPC/FFI/packaging-adjacent PRs, verify at least one bot produced real review output (its actual comment/review text), not just a green check-run.

**PR size:** keep every PR's changed-file count under ~100 — several review bots skip inline comments above that threshold. Check with `git diff --name-only <base>...HEAD | wc -l` before pushing; split into the fewest stacked PRs that stay under the limit if needed.

**Known GitHub merge-gate quirks on this repo:**
- **Mergeable-state cache lag:** `gh pr merge` can fail with "base branch policy prohibits the merge" even after every check (required and advisory) shows concluded `success`, `mergeable: MERGEABLE`, and 0 unresolved review threads. Re-poll a few times (~60s) before concluding it's stuck.
- **Zombie `QUEUED` check-suites:** several installed GitHub Apps (Renovate, Cursor, Claude, Greptile, CodeAnt AI, Cloudflare Pages, coderabbitai, Codecov, Amazon Q Developer) can leave a check-suite stuck at `status: QUEUED` on a PR that never actually triggers their logic — invisible via `gh pr checks` (named checks look fine), only visible via GraphQL `commits(last:1){nodes{commit{checkSuites(first:20){nodes{app{name} status}}}}}`.
- **Stacked-PR auto-close on squash-merge + `--delete-branch`:** can auto-*close* (not retarget) a downstream PR based on the deleted branch. Recovery: temporarily restore the ref (`git push origin <sha>:refs/heads/<deleted-branch>`), `gh pr reopen`, `gh pr edit --base main`, delete the temp ref once nothing else depends on it. The reopened branch's history still contains the original un-squashed commits, so a plain `git rebase origin/main` re-conflicts even though the diff is clean — rebase only what's after the merged base's old tip: `git rebase --onto origin/main <old-base-tip-sha> <branch>`.
- Neither quirk is authorization to bypass branch protection casually — `--admin` requires a maintainer's fresh, explicit go-ahead for that specific merge.

---

## Security Considerations

- **No build-time secrets.** API keys are entered via Settings UI and stored encrypted in IndexedDB (AES-256-GCM via Web Crypto API). Do not put AI keys in `.env` or host environment variables for inference.
- **CSP:** Web and Tauri use the same explicit `connect-src` origin allowlist from `config/csp-connect-src.json`; arbitrary `https:`, `http:`, and `ws:` scheme wildcards are forbidden. Run `pnpm run csp:sync` followed by `pnpm run csp:check` after changing a provider, local service, or signaling endpoint; CI enforces the non-mutating `pnpm run csp:verify` drift check. Runtime preflight rejects unlisted browser BYOK endpoints with an actionable error.
- **No `dangerouslySetInnerHTML` without DOMPurify.** Biome flags `noDangerouslySetInnerHtml` as error.
- **Never log API keys, IVs, or plaintext payloads.** Use `services/logger.ts` (`createLogger(module)` factory — IDB + Tauri JSONL + DEV console sinks; GDPR `sanitizeLogContext`). `console.log` is blocked by Biome in production paths.
- **Service Worker:** AI hosts are network-only (`public/sw.js`). WASM/ONNX chunks are excluded from precache.
- **Supply-chain:** SHA-pinned GitHub Actions, Dependabot weekly updates, OpenSSF Scorecard, CodeQL SAST, SLSA build provenance on `main`.
- **Collaboration:** Yjs + `packages/collab-transport` (vendor fork of y-webrtc 10.3.0) with AES-256-GCM E2E encryption baked in (PBKDF2, 600k iterations, `extractable: false`). Signaling URLs are user-configurable.
- **Tauri isolation:** `vite.config.ts` externalizes `/^@tauri-apps\//` so web builds never bundle Tauri APIs. Abstract Tauri calls through `services/desktopPlatform.ts` (the `DesktopPlatform` interface from `packages/desktop-contracts`) — new code must not import `@tauri-apps/*` directly outside `components/ui/`; enforced by `pnpm run guardrail:desktop-imports`.
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

- `features/featureFlags/featureFlagsSlice.ts` gates **23 flags**. New installs get the **full feature set**: all default **on** except seven opt-in flags that default **off** — `enableRtlLayout`, `enableVoiceSupport`, `enableProForge`, `enableVoiceWasm`, `enableGlobalCopilot`, `enableLocalFirstSync`, `enableBrowserOllama`. (`enableCodexAutoTracking` + `enableCrossProjectSearch` were promoted to permanent core; `enablePlotBoardV2` + `enableCloudSync` were retired — none remain in the slice.) See `docs/FEATURE-PARITY.md` for the per-flag matrix.
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
- `services/localAiFacade.ts` wraps WebLLM via `packages/ai-core` + `workers/v2/inference.worker.ts`.
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

Central orchestration layer for all background worker tasks — since ADR-0015, the **sole** worker generation (v1's `workers/duckdbWorker.ts`/`workers/inference.worker.ts` deleted). Messages use short kind literals (`TASK`, `CANCEL`, `PING`, `PONG`, `PROGRESS`, `RESULT`) validated by Zod.

- `packages/worker-bus/src/` — WorkerBus (`hasPool()`/`terminatePool()` for scoped pool lifecycle), WorkerPool, authoritative PriorityTaskQueue scheduler (`critical > high > normal > low`, no `background` tier; 32 ordinary slots + 8 critical reserve), CircuitBreaker, DeadLetterQueue, ProtocolHandler (unused by the live `runTask()` path), workerBootstrap (`WorkerHandlerContext.emitProgress(stage, progress, message?)` — a flat function, not `context.progress.emit(...)`), constants, schemas.
- `services/workerBusManager.ts` — singleton lifecycle; registers `inference`, `duckdb`, `webllm`, `plugin` pools. `ensureDuckDbPool()`/`ensureInferencePool()`/`ensureWebLlmPool()` force-init and re-register a pool removed via `terminatePool()`, decoupled from `enableWorkerBusV2` (these are core features, not experimental infra).
- `services/hybridRouter.ts` — routes to Web Worker pool or Rust TaskSupervisor (Tauri only) when `enableRustCompute` is on.
- `services/legacyWorkerBusAdapter.ts` — shims old `@domain/ai-core` WorkerBus API onto v2.
- `services/tauriTaskBridge.ts` — `invokeRustTask()`, `isRustComputeAvailable()` (60s TTL ping cache).
- Feature flags: `enableWorkerBusV2` (on by default), `enableRustCompute` (on by default; effective on Tauri desktop only).
- Workers: `workers/v2/inference.worker.ts` (text + embed via Hugging Face transformers, prepared-statement-free), `workers/v2/duckdb.worker.ts` (init/query/exec/shutdown, binds params via DuckDB-WASM prepared statements), `workers/v2/webllm.worker.ts` (WebGPU, ADR-0005), `workers/plugin.worker.ts` (sandboxed plugin execution, outside `v2/` but on the same protocol).
- `timeoutMs` is an inactivity watchdog that starts at enqueue, covers queue wait and execution, and rearms on valid `PROGRESS`; a timed-out active worker is replaced.

### DuckDB Analytics

- `workers/v2/duckdb.worker.ts` runs DuckDB-WASM off main thread via the shared `duckdb` pool (OPFS persistence → in-memory fallback). `duckdbClient.ts` is an adapter over `ensureDuckDbPool()`/`bus.enqueue()` that auto-reinits on a respawned worker's "not initialized" error.
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
- Source modules: `locales/<lang>/*.json` for **19 locales**: `ar`, `de`, `el`, `en`, `es`, `eu`, `fa`, `fi`, `fr`, `he`, `hu`, `is`, `it`, `ja`, `ko`, `pt`, `ru`, `sv`, `zh`.
- Runtime bundles: `public/locales/<lang>/bundle.json` (rebuilt by `pnpm run i18n:bundle` or automatically via `predev` / `prebuild`).
- Hook: `useTranslation()` returns `t('key.path')`. **No hardcoded text** in UI.
- Key parity is enforced in CI (`pnpm run i18n:check`). Add keys to **all nineteen** locale trees.
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
| `docs/CODEANT-REVIEW-LOOP.md` | Canonical PR review-correction loop procedure (any bot) |
| `docs/DEPENDABOT-TRIAGE.md` | Dependabot PR triage policy — ecosystem/grouping config, why there's no auto-merge, merge sequencing |
| `docs/adr/` | Architecture Decision Records, incl. ADR-0021 (Qt/GPUI native desktop strategy) |
| `docs/native/ROADMAP-QT-GPUI-DESKTOP.md` | Qt-first native desktop roadmap — 22-entry execution plan (Wave 0–20 plus Wave 4.5); GPUI is preserved separately in `docs/native/GPUI-EXPLORATIONS.md`, CEF retired |
| `docs/native/GPUI-EXPLORATIONS.md` | Deferred GPUI feasibility targets and re-entry criteria — exploratory only, not a numbered implementation wave |
| `docs/native/CORE-MIGRATION-LEDGER.md` | Rust Core extraction priority order (what's moved out of TS vs. deferred) |
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
