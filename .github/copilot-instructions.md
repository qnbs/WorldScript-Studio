# Copilot Instructions — StoryCraft Studio

## Project Overview

StoryCraft Studio is an AI-powered creative writing application built as an offline-first PWA. It combines a React 19 SPA with Google Gemini AI integration, IndexedDB persistence, and optional Tauri desktop packaging.

**Live:** `https://qnbs.github.io/StoryCraft-Studio/`

**Documentation map:** [`README.md`](../README.md#-documentation-hub) § Documentation Hub lists every maintainer `.md` guide (see also [`AUDIT.md`](../AUDIT.md)).

## Architecture

### Tech Stack

- **Frontend:** React 19 + TypeScript (strict mode), Vite 8
- **State:** Redux Toolkit 2.x + Redux-Undo, feature-sliced design
- **Styling:** Tailwind CSS 4.x with CSS custom properties for theming
- **AI:** Google Gemini API via `@google/genai`, multi-provider abstraction (`aiProviderService.ts`)
- **Storage:** Dual IndexedDB (`storycraft-state-db`, `storycraft-data-db`) via `dbService.ts` (LZ-String compression, AES-256-GCM key encryption); `storageService.ts` switches browser vs Tauri filesystem
- **Collaboration:** Yjs + y-webrtc for P2P real-time editing
- **Desktop:** Tauri 2 (optional)
- **Package manager:** pnpm@10.x
- **Testing:** Vitest + @testing-library/react (unit), Playwright (E2E)

### Directory Structure

```text
app/              → Redux store, hooks (useAppDispatch/useAppSelector), listener middleware, utils
components/       → React view components (one per view)
  ui/             → Reusable design system primitives (Button, Modal, Card, Toast, etc.)
contexts/         → React context providers (one per major view + I18nContext + CommandExecutorContext)
features/         → Redux Toolkit slices: project, settings, status, writer, versionControl, featureFlags
hooks/            → Custom hooks with view business logic (one hook per view)
services/         → External adapters: geminiService, aiProviderService, dbService (dual IndexedDB + migration), storageService, collaborationService, epubApiService; **commands/** (palette registry), **keyboard/** (shortcut matching), **help/** (doc retrieval for AI), **settingsExchange** (settings JSON)
locales/          → i18n source files (de, en, es, fr, it) × 15 JSON modules
public/locales/   → i18n runtime files served at BASE_URL
tests/            → Unit + E2E tests (Vitest + Playwright)
types/            → Additional TypeScript type definitions
types.ts          → Core shared interfaces and types
```

### Key Patterns

1. **View = Component + Hook + Context:** Each major view (e.g., Dashboard) has:
   - `components/Dashboard.tsx` — Pure rendering
   - `hooks/useDashboard.ts` — Business logic, Redux selectors, thunk dispatches
   - `contexts/DashboardContext.ts` — React context to pass hook return to child components

2. **Redux:** All state mutations go through Redux slices. Async operations use `createAsyncThunk`. Side effects (auto-save) run in the listener middleware. The `project` slice is wrapped with `redux-undo` for undo/redo.
   - `features/project/aiThunkUtils.ts` provides a reusable deduplicated async-thunk wrapper for AI requests.

3. **AI Service:** `geminiService.ts` is the primary AI adapter. It handles API key loading/caching, retry logic (2 retries, exponential backoff for 429s), and prompt construction. All AI calls should go through this service or `aiProviderService.ts`.

4. **Storage:** `dbService.ts` wraps **dual** IndexedDB (state vs data stores, legacy migration) with compression (LZ-String for payloads > 10KB) and encryption (AES-256-GCM for API keys). `storageService.ts` provides a unified interface that auto-detects IndexedDB vs Tauri filesystem.

5. **i18n:** Custom React Context system in `I18nContext.tsx`. Translation keys use dot notation (`common.save`, `dashboard.wordCount`). All user-facing strings MUST be translation keys, never hardcoded text.

6. **Code Splitting:** All views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy dependencies (Konva, Leaflet, react-force-graph) are in separate Vite manual chunks. The export stack also uses dynamic imports for `docx` and `jszip` so large document libraries are only loaded when export actions are executed.

7. **Command Center:** Palette commands live in **`services/commands/`** (i18n keys, fuzzy search, recent/pinned). **`CommandExecutorProvider`** exposes execution for Help „Try it“ (`tryActionId`) and toasts with **`commandId`**. **`useGlobalKeyboardShortcuts`** reads Redux shortcut bindings; **`app/transientUiStore`** toggles palette visibility.

## Coding Standards

### TypeScript

- `strict: true` is enforced globally — do NOT add `any` types
- `exactOptionalPropertyTypes: true` — use `undefined` explicitly for optional props
- Use typed Redux hooks: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`
- Prefer `interface` for component props, `type` for unions and utility types

### React

- Functional components only, use `React.memo()` for expensive renders
- Props forwarding with `React.forwardRef()` for UI primitives
- Hooks must follow the `use*View` naming convention for view logic hooks
- Always clean up event listeners, timeouts, and subscriptions in `useEffect` return

### Accessibility (WCAG 2.2 AA-oriented)

- See [`docs/ACCESSIBILITY.md`](../docs/ACCESSIBILITY.md) for architecture (`LiveRegionProvider`, focus traps, CI gates).
- All interactive elements need proper `role`, `aria-label`, `aria-expanded`, etc.
- Modals must trap focus and restore focus on close
- Icons must have `aria-hidden="true"` when decorative
- Use `focus-visible:ring-2` for keyboard focus styles
- Dynamic content updates need `aria-live` regions

### Security

- NEVER log, console.log, or expose API keys
- API keys are encrypted with AES-256-GCM before IndexedDB storage
- Never store sensitive data in localStorage (use IndexedDB with encryption)
- Sanitize any user input before rendering (XSS prevention)
- AI API responses are text-only — never execute or `eval()` them
- Gemini API calls must use `NetworkOnly` caching strategy (never cache AI responses)

### Testing

- Unit tests: Vitest + @testing-library/react in `tests/unit/` (see `tests/setup.ts`)
- E2E tests: Playwright in **`tests/e2e/*.spec.ts`** — **`CI=true`** is required (`pnpm run test:e2e`). Shared waits/bootstrap live in **`tests/e2e/helpers.ts`**; do **not** use `networkidle` against the Vite dev server (HMR keeps sockets open). Scope sidebar navigation via **`#sidebar`** when both mobile and desktop nav exist.
- Test file naming: `ComponentName.test.tsx` or `serviceName.test.ts`
- Mock external services (Gemini API, IndexedDB) in unit tests
- Verify accessibility: assert `role`, `aria-*` attributes in component tests

### i18n

- All user-facing strings must use `t('key.path')` from `useTranslation()`
- Source files: `locales/{lang}/{module}.json` (15 modules). Runtime: **one** merged **`public/locales/{lang}/bundle.json`** per language — regenerate with **`pnpm run i18n:bundle`** or **`pnpm run i18n:check`** (parity check **and** bundle build); **`predev`** / **`prebuild`** also rebuild bundles so the UI never shows raw keys after editing locale JSON.
- **the in-app selector exposes five locales:** **de**, **en**, **fr**, **es**, **it** — keep key parity with English (`pnpm run i18n:check` in CI)
- English is the fallback language
- New keys: add to **`locales/en/`** first, then **de**, **fr**, **es**, **it** (or run `node scripts/check-i18n-keys.mjs --fix` and translate), then commit updated **`bundle.json`** files

### Git & CI

- Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Pre-commit: `simple-git-hooks` runs Biome check on staged files
- Before every commit and push, run the full local preflight:
  - `pnpm install --frozen-lockfile`
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm run test:run`
  - `pnpm run build`
- CI pipeline (see [`docs/CI.md`](../docs/CI.md)): **`security` → `quality`** (Biome + `tsc` + Vitest matrix) **→ `build` / `e2e` / `storybook` in parallel** → **`lighthouse`** after build → **`deploy`** on `main` after build+e2e
- Branch protection should require the **`quality`** job (and other checks your team enables); job ids match `.github/workflows/ci.yml`
- CI runs **`pnpm audit`** every workflow; **dependency-review** on pull requests
- CI installs dependencies with `pnpm install --frozen-lockfile`
- Local CI can be simulated with `act` (requires Docker), e.g. `act pull_request --job security --job quality`
- Local developers should use `pnpm install` to install dependencies
- Most repo-facing markdown is English for accessibility; user-facing app strings remain fully i18n-driven

## Known Technical Debt

See `AUDIT.md` and `TODO.md`. Key items:

- **`StorageBackend` parity** — tighten typings across `dbService` / `fileSystemService` / `storageService`
- `components/AdvancedImportExport.tsx` — some export paths remain Tauri-centric; keep browser fallbacks explicit
- `app/listenerMiddleware.ts` — occasional TypeScript friction with redux-undo `StateWithHistory`
- Several hooks still use `as any` casts that should be replaced with proper generics
- `hooks/useExportView.ts` / `components/ExportView.tsx` — keep `docx` / `jszip` lazy for bundle size

## Commands

```bash
pnpm run dev          # Start dev server on port 3000
pnpm run build        # Production build to dist/
pnpm run preview      # Preview production build locally
pnpm run lint         # Biome lint check
pnpm run lint:fix     # Biome auto-fix (lint + format)
pnpm run format       # Biome format
pnpm run typecheck    # TypeScript type checking (tsc --noEmit)
pnpm run test         # Vitest watch mode
pnpm run test:run     # Vitest single run
pnpm run test:coverage # Vitest with V8 coverage
pnpm run test:e2e     # Playwright E2E (requires CI=true per package.json scripts)
pnpm run storybook    # Storybook on port 6006
```

## graphify

Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` if it exists.
If `graphify-out/wiki/index.md` exists, navigate it for deep questions.
Type `/graphify` in Copilot Chat to build or update the knowledge graph (semantic / LLM-backed).

From the repo shell, **`pnpm run graphify:update`** refreshes the AST-only graph (works even when `graphify` is not on `PATH`, e.g. after `pip install graphifyy` on Windows); see `docs/graphify.md` and `scripts/graphify-cli.mjs`.
