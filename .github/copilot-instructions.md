# Copilot Instructions — StoryCraft Studio

## Project Overview

StoryCraft Studio is an AI-powered creative writing application built as an offline-first PWA. It combines a React 19 SPA with Google Gemini AI integration, IndexedDB persistence, and optional Tauri desktop packaging.

**Live:** `https://qnbs.github.io/StoryCraft-Studio/`

## Architecture

### Tech Stack

- **Frontend:** React 19 + TypeScript 5 (strict mode), Vite 6
- **State:** Redux Toolkit 2.x + Redux-Undo, feature-sliced design
- **Styling:** Tailwind CSS 4.x with CSS custom properties for theming
- **AI:** Google Gemini API via `@google/genai`, multi-provider abstraction (`aiProviderService.ts`)
- **Storage:** IndexedDB (`dbService.ts`) with LZ-String compression, AES-256-GCM key encryption
- **Collaboration:** Yjs + y-webrtc for P2P real-time editing
- **Desktop:** Tauri 2 (optional)
- **Package manager:** pnpm@10.x
- **Testing:** Vitest + @testing-library/react (unit), Playwright (E2E)

### Directory Structure

```text
app/              → Redux store, hooks (useAppDispatch/useAppSelector), listener middleware, utils
components/       → React view components (one per view)
  ui/             → Reusable design system primitives (Button, Modal, Card, Toast, etc.)
contexts/         → React context providers (one per major view + I18nContext)
features/         → Redux Toolkit slices: project, settings, status, writer, versionControl
hooks/            → Custom hooks with view business logic (one hook per view)
services/         → External adapters: geminiService, dbService, storageService, collaborationService, epubApiService
locales/          → i18n source files (de, en, es, fr, it) × 14 modules
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

4. **Storage:** `dbService.ts` wraps IndexedDB with compression (LZ-String for payloads > 10KB) and encryption (AES-256-GCM for API keys). `storageService.ts` provides a unified interface that auto-detects whether to use IndexedDB or Tauri filesystem.

5. **i18n:** Custom React Context system in `I18nContext.tsx`. Translation keys use dot notation (`common.save`, `dashboard.wordCount`). All user-facing strings MUST be translation keys, never hardcoded text.

6. **Code Splitting:** All views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy dependencies (Konva, Leaflet, react-force-graph) are in separate Vite manual chunks. The export stack also uses dynamic imports for `docx` and `jszip` so large document libraries are only loaded when export actions are executed.

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

### Accessibility (WCAG 2.1 AA)

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

- Unit tests: Vitest + @testing-library/react in `tests/` directory
- E2E tests: Playwright in `tests/` with `.spec.ts` suffix
- Test file naming: `ComponentName.test.tsx` or `serviceName.test.ts`
- Mock external services (Gemini API, IndexedDB) in unit tests
- Verify accessibility: assert `role`, `aria-*` attributes in component tests

### i18n

- All user-facing strings must use `t('key.path')` from `useTranslation()`
- Translation files are in `locales/{lang}/{module}.json`
- 14 modules: common, sidebar, dashboard, writer, characters, worlds, outline, templates, manuscript, export, settings, help, tags, portal
- English is the fallback language
- New keys must be added to ALL 5 language files (de, en, es, fr, it)

### Git & CI

- Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Pre-commit: Husky runs lint-staged (Prettier + ESLint on staged `.ts`/`.tsx` files)
- Before every commit and push, run the full local preflight:
  - `pnpm install --frozen-lockfile`
  - `pnpm run lint -- --max-warnings=0`
  - `pnpm run typecheck`
  - `pnpm run test:run`
  - `pnpm run build`
- CI pipeline: lint → typecheck → security → test → storybook → build → lighthouse → deploy
- The main branch must require `lint`, `typecheck`, and `test` status checks in branch protection rules.
- CI includes dependency-review + `pnpm audit` on dependency file changes, Storybook artifact generation, Lighthouse budgets, and optional Tauri builds on tags/workflow dispatch
- CI installs dependencies with `pnpm install --frozen-lockfile`
- Local CI can be simulated with `act` (requires Docker); use `act pull_request` for PR flows and `act push` for tag/dispatch flows
- Local developers should use `pnpm install` to install dependencies
- All public-facing documentation, markdown files, and GitHub-visible content must be written in English to keep the project accessible to the open-source community

## Known Technical Debt

See `AUDIT.md` for the full list. Key items:

- `services/dbService.ts` — `loadProject`/`listProjects` need full `StorageBackend` implementation
- `services/fileSystemService.ts` — References `StoryProject.author`/`.description` which don't exist in the interface
- `components/AdvancedImportExport.tsx` — DOCX export uses Tauri-only `fileSystemService`
- `app/listenerMiddleware.ts` — Complex TypeScript workarounds for redux-undo's `StateWithHistory`
- Several hooks use `as any` casts that should be replaced with proper generics
- `hooks/useExportView.ts` / `components/ExportView.tsx` — export document libraries are lazy-loaded at runtime and should remain optional to preserve bundle size

## Commands

```bash
pnpm run dev          # Start dev server on port 3000
pnpm run build        # Production build to dist/
pnpm run preview      # Preview production build locally
pnpm run lint         # ESLint check (--max-warnings 0)
pnpm run lint:fix     # ESLint auto-fix
pnpm run typecheck    # TypeScript type checking (tsc --noEmit)
pnpm run test         # Vitest watch mode
pnpm run test:run     # Vitest single run
pnpm run test:coverage # Vitest with V8 coverage
pnpm run test:e2e     # Playwright E2E tests
pnpm run storybook    # Storybook on port 6006
```
