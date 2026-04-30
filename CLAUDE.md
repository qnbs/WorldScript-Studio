# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev           # Vite dev server on http://localhost:3000
pnpm run build         # Production build to dist/
pnpm run lint          # Biome lint check
pnpm run lint:fix      # Biome auto-fix (lint + format)
pnpm run typecheck     # TypeScript type check (tsc --noEmit)
pnpm run test          # Vitest watch mode
pnpm run test:run      # Vitest single run (CI mode)
pnpm run test:coverage # Vitest with V8 coverage (15% minimum threshold)
pnpm run test:e2e      # Playwright E2E tests (requires CI=true)
pnpm run storybook     # Storybook on port 6006
pnpm run tauri:dev     # Tauri desktop app (requires Rust)
```

Pre-commit hook runs Biome check via `simple-git-hooks` + `lint-staged` on staged files.

Conventional Commits format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Architecture

StoryCraft Studio is an offline-first PWA — a React 19 SPA with Google Gemini AI, IndexedDB persistence, and optional Tauri desktop packaging. No backend; API keys are entered in the UI and encrypted at rest.

**Live:** `https://qnbs.github.io/StoryCraft-Studio/`

### State Management

Redux Toolkit with feature-sliced slices: `features/project/`, `features/settings/`, `features/status/`, `features/writer/`, `features/versionControl/`, `features/featureFlags/`. The `project` slice is wrapped with `redux-undo` (100-step history). Side effects (auto-save, Codex extraction) run in `app/listenerMiddleware.ts`, not in components or hooks.

Use typed hooks everywhere: `useAppDispatch()`, `useAppSelector()`, `useAppSelectorShallow()`.

### View Pattern

Every major view follows this three-file structure:
- `components/Xyz.tsx` — pure rendering only
- `hooks/useXyzView.ts` — business logic, Redux selectors, thunk dispatches
- `contexts/XyzContext.ts` — React context that passes the hook return to child components

### AI Services

`geminiService.ts` is the primary adapter (Gemini API, retry logic, prompt construction). `aiProviderService.ts` provides a multi-provider abstraction (Gemini, OpenAI, Ollama). All AI calls go through one of these. `features/project/aiThunkUtils.ts` provides a deduplicated async-thunk wrapper to prevent duplicate in-flight requests.

### Storage

`dbService.ts` wraps IndexedDB with LZ-String compression (payloads > 10 KB) and AES-256-GCM encryption (API keys). `storageService.ts` is the unified interface that auto-detects IndexedDB vs. Tauri filesystem. Never use `localStorage` for sensitive data.

### Code Splitting

All 14 views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy libraries (export: `docx`, `jszip`, `jsPDF`; collaboration: Yjs; graphs) live in separate Vite manual chunks and are dynamically imported only when used. Keep export/collaboration dependencies lazy.

### i18n

Custom React Context in `I18nContext.tsx` — not i18next. 5 languages (de, en, es, fr, it), 14 modules. All user-facing strings must use `t('key.path')` from `useTranslation()` — no hardcoded text. New translation keys must be added to all 5 language files. English is the fallback.

## Key Constraints

- `strict: true` + `exactOptionalPropertyTypes: true` — no `any` types; use `undefined` explicitly for optional props
- Never log or expose API keys; never `eval()` AI responses
- All interactive elements require proper `role`, `aria-label`, `aria-expanded` attributes (WCAG 2.1 AA)
- Modals must trap focus and restore on close; decorative icons need `aria-hidden="true"`
- Gemini API calls must use `NetworkOnly` caching (never cache AI responses in the Service Worker)
- Use `focus-visible:ring-2` for keyboard focus styles

## Known Technical Debt

See `AUDIT.md` for the full list. Key items to be aware of:

- `services/dbService.ts` — `loadProject`/`listProjects` need full `StorageBackend` interface implementation
- `services/fileSystemService.ts` — references `StoryProject.author`/`.description` which don't exist on the interface
- `components/AdvancedImportExport.tsx` — DOCX export is Tauri-only (browser path not yet implemented)
- `app/listenerMiddleware.ts` — TypeScript workarounds for redux-undo's `StateWithHistory` type
- Several hooks use `as any` casts that need proper generics

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
