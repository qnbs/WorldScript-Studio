# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev           # Vite dev server on http://localhost:3000
pnpm run build         # Production build to dist/
pnpm run preview       # Preview production build locally
pnpm run lint          # Biome lint (--error-on-warnings — warnings fail like CI)
pnpm run lint:fix      # Biome auto-fix (lint + format)
pnpm run typecheck     # TypeScript type check (tsc --noEmit)
pnpm run test          # Vitest watch mode
pnpm run test:run      # Vitest single run (CI mode)
pnpm run test:coverage # Vitest with V8 coverage (see thresholds in vitest.config.ts)
pnpm run i18n:check    # Locale key parity + bundle rebuild (runs in CI quality job)
pnpm run mutation      # Stryker mutation report (see stryker.conf.json)
pnpm run test:e2e      # Playwright E2E tests (CI=true required; E2E are CI-only)
pnpm run analyze       # Bundle analysis (ANALYZE=true vite build)
pnpm run bundle:budget # Check vendor chunk sizes (max 7000 KB)
pnpm run storybook     # Storybook on port 6006
pnpm run tauri:dev     # Tauri desktop app (requires Rust)
```

**Run a single test file:** `pnpm exec vitest run tests/unit/serviceName.test.ts`
**Run tests matching a name pattern:** `pnpm exec vitest run -t "pattern"`

**Quality gate (matches CI `quality` job):** `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage`. Full pipeline graph: [`docs/CI.md`](docs/CI.md).

**CI pipeline order:** `security` → `quality` (Biome + tsc + Vitest matrix) → `build` / `e2e` / `storybook` (parallel) → `lighthouse` (after build) → `deploy` on `main`.

**Local vs CI:** On low-end hardware run only `lint`, `typecheck`, `i18n:check` locally; delegate Playwright, LHCI, and coverage-gate runs to CI (or debug via CI artifacts). The merge bar is a green workflow, not a full local run.

**E2E notes:** Do NOT use `networkidle` waits against the Vite dev server (HMR keeps WebSocket connections open). Scope sidebar navigation via `#sidebar` when both mobile and desktop nav exist. Shared bootstrap helpers live in `tests/e2e/helpers.ts`.

Pre-commit hook runs Biome check via `simple-git-hooks` + `lint-staged` on staged files.

Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Architecture

StoryCraft Studio is an offline-first PWA — a React 19 SPA with Google Gemini AI, IndexedDB persistence, and optional Tauri desktop packaging. No backend; API keys are entered in the UI and encrypted at rest.

**Stack:** React 19, TypeScript (strict), Vite 8, Tailwind CSS 4.x, Redux Toolkit 2.x, pnpm 10, Node ≥ 22. Two internal workspace packages (`@domain/ai-core`, `@domain/ui` in `packages/`) are consumed as `workspace:*` deps.

**Live:** `https://qnbs.github.io/StoryCraft-Studio/`

### Directory map

```
app/              → Redux store, typed hooks, listener middleware, transientUiStore (Zustand)
components/       → View components; components/ui/ = design-system atoms (Button, Modal, Toast…)
contexts/         → React context providers — one per major view + I18nContext + CommandExecutorContext
features/         → Redux slices: project, settings, status, writer, versionControl, featureFlags
hooks/            → View business logic (use*View.ts naming); useGlobalKeyboardShortcuts here too
services/         → External adapters: geminiService, aiProviderService, dbService, storageService,
                     collaborationService; sub-dirs: commands/, keyboard/, help/, settingsExchange/
packages/         → Internal workspace packages: ai-core, ui
locales/          → i18n source JSON (de/en/es/fr/it × 15 modules); runtime bundles → public/locales/
tests/            → unit/ (Vitest) + e2e/ (Playwright); shared E2E helpers in tests/e2e/helpers.ts
types.ts          → Core shared interfaces and types (root level)
```

### State Management

Redux Toolkit with feature-sliced slices: `features/project/`, `features/settings/`, `features/status/`, `features/writer/`, `features/versionControl/`, `features/featureFlags/`. The `project` slice is wrapped with `redux-undo` (100-step history). Side effects (auto-save, Codex extraction) run in `app/listenerMiddleware.ts`, not in components or hooks.

Use typed hooks everywhere: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`.

### View Pattern

Every major view follows this three-file structure:
- `components/Xyz.tsx` — pure rendering only
- `hooks/useXyzView.ts` — business logic, Redux selectors, thunk dispatches
- `contexts/XyzContext.ts` — React context that passes the hook return to child components

React conventions: `React.memo()` for expensive renders; `React.forwardRef()` for `components/ui/` primitives; always clean up event listeners, timeouts, and subscriptions in `useEffect` return.

### AI Services

`geminiService.ts` is the primary adapter (Gemini API, retry logic, prompt construction). `aiProviderService.ts` provides a multi-provider abstraction (Gemini, OpenAI, Ollama). All AI calls go through one of these. `features/project/aiThunkUtils.ts` provides a deduplicated async-thunk wrapper to prevent duplicate in-flight requests.

### Storage

`dbService.ts` wraps **dual** IndexedDB databases (`storycraft-state-db` for Redux state, `storycraft-data-db` for assets/blobs) with LZ-String compression (payloads > 10 KB), AES-256-GCM encryption (API keys), and legacy migration via `services/dbMigration.ts`. `storageService.ts` is the unified interface that auto-detects IndexedDB vs. Tauri filesystem. Data access must go through `dbService` or thunks — never raw IndexedDB calls. Never use `localStorage` for sensitive data.

### Collaboration

Real-time P2P editing via Yjs + y-webrtc (`services/collaborationService.ts`). Signaling URLs come from Redux `settings.collaboration.webrtcSignalingUrls`. Do not introduce a second CRDT layer.

### Code Splitting

All 14 views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy libraries (export: `docx`, `jszip`, `jsPDF`; collaboration: Yjs; graphs) live in separate Vite manual chunks and are dynamically imported only when used. Keep export/collaboration dependencies lazy.

### Command Center & shortcuts

- **`services/commands/`** — single registry for palette entries: definitions, fuzzy rank/score, recent/pinned prefs, lightweight AI suggestions. **`components/CommandPalette.tsx`** renders from this registry (ARIA combobox/listbox patterns).
- **`contexts/CommandExecutorContext.tsx`** + **`CommandExecutorProvider` in `App.tsx`** — expose `executeCommand` / `runCommandById` to deep UI (Help „Try it“, toasts with `commandId`).
- **`app/transientUiStore.ts`** — Zustand store includes **`isCommandPaletteOpen`** (palette wired here; avoid duplicate local-only state).
- **`hooks/useGlobalKeyboardShortcuts.ts`** + **`services/keyboard/`** — normalize OS modifiers, match bindings from settings, optional conflict listing for the Shortcuts UI.
- **Help AI:** `services/help/helpDocRetrieval.ts` builds static retrieval context passed into **`streamAiHelpResponse`** / Gemini adapter paths.

### i18n

Custom React Context in `I18nContext.tsx` — not i18next. Locale files exist for de, en, es, fr, it (15 modules merged into one **`public/locales/<lang>/bundle.json`** per language — rebuilt by **`pnpm run i18n:bundle`** or automatically via **`pnpm run i18n:check`** / **`prebuild`** / **`predev`**); the **in-app selector** exposes **de**, **en**, **fr**, **es**, and **it** (Settings, Welcome Portal, Command Palette). All user-facing strings must use `t('key.path')` from `useTranslation()` — no hardcoded text. New keys: add to **all five** locale trees (`node scripts/check-i18n-keys.mjs --fix` for parity), then ensure **`pnpm run i18n:bundle`** runs (included in **`pnpm run i18n:check`**, **`prebuild`**, and **`predev`**). English is the fallback.

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

All repository `.md` guides are listed in **[`README.md`](README.md#-documentation-hub) § Documentation Hub**; **[`AUDIT.md`](AUDIT.md)** § *Markdown corpus* duplicates the **19-file** maintainer inventory (see table there). Accessibility architecture: **[`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)**.

## Key Constraints

- `strict: true` + `exactOptionalPropertyTypes: true` — no `any` types; use `undefined` explicitly for optional props
- Never log or expose API keys; never `eval()` AI responses
- All interactive elements require proper `role`, `aria-label`, `aria-expanded` attributes (WCAG **2.2** AA-oriented; Biome `a11y` warnings fail CI)
- Modals must trap focus and restore on close; decorative icons need `aria-hidden="true"`
- Gemini API calls must use `NetworkOnly` caching (never cache AI responses in the Service Worker)
- Use `focus-visible:ring-2` for keyboard focus styles
- `dangerouslySetInnerHTML` only with DOMPurify-sanitized content — never raw
- No direct `@tauri-apps/api` imports in `components/ui/` atoms; abstract through services or hooks so the web build stays unaffected
- File size target: **200–700 lines**. Over 700 → split into submodules, hooks, or selectors
- Never comment out or skip failing tests to green CI — fix the root cause. `it.skip` requires a file-level comment with a reason and a ticket/TODO reference
- **Modus operandi — tests:** Whenever you modify, add, or delete a code file, always check whether a corresponding test file exists (in `tests/unit/` for components/hooks/services, or `tests/e2e/` for flows). If it does, update or extend it to cover the change. If it doesn't exist yet and the change is non-trivial, create one. Run the relevant test file with `pnpm exec vitest run <path>` to verify before committing.

## Known Technical Debt

See `AUDIT.md` and `TODO.md`. Key items:

- **`StorageBackend` + `SaveProjectInput`** — contract in `services/storageBackend.ts`; use `storageService` in app code; backends implement the same `saveProject` union (Redux envelope or flat `StoryProject`).
- `components/AdvancedImportExport.tsx` — keep browser vs Tauri export paths explicit
- `app/listenerMiddleware.ts` — redux-undo `StateWithHistory` typing at boundaries
- Several hooks still need removal of `as any` casts

## graphify

This project has an optional [graphify](https://github.com/safishamsi/graphify) knowledge graph at `graphify-out/`. See [`docs/graphify.md`](docs/graphify.md) for setup. Full doc index: [`README.md` § Documentation Hub](README.md#-documentation-hub).

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `pnpm run graphify:update` (or `graphify update .` if the CLI is on `PATH`) to keep the graph current (AST-only, no API cost); see [`scripts/graphify-cli.mjs`](scripts/graphify-cli.mjs). First-time Python setup: `pnpm run graphify:bootstrap` (PyPI package **`graphifyy`**).
