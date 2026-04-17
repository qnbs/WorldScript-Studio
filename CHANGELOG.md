# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-04-17

### Security

- Resolved all npm audit vulnerabilities: 0 high, 0 critical (was 4 high + 1 critical).
- Fixed `protobufjs` critical arbitrary code execution vulnerability (upgraded to ≥7.5.5).
- Resolved `serialize-javascript` RCE + DoS vulnerabilities via npm overrides for the `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser` chain.
- Guarded all unprotected `localStorage` accesses in `useApp.ts` with try/catch.
- Guarded all unprotected `sessionStorage` accesses in `usePWA.ts` and `CollaborationPanel.tsx`.
- Added missing Tauri capabilities: `fs:allow-read-dir`, `fs:allow-remove` (fixes runtime failures for `listProjects`, `deleteProject`, `deleteSnapshot`, `clearApiKey`).
- Removed type-unsafe references to non-existent `StoryProject.author`/`.description` in `fileSystemService.ts`.

### Added

- CI security audit job: `npm audit --audit-level=high` + `dependency-review-action` on PRs.
- CI Lighthouse job: performance budget assertions from `.lighthouserc.js` with artifact upload.
- CI Storybook job: automated build + artifact upload.
- Bundle analyzer: `rollup-plugin-visualizer` as opt-in devDep (`npm run analyze`).
- Shared AI utility module `services/aiUtils.ts`: `stripControlChars`, `sanitizePromptValue`, `sanitizePromptBlock`, `cleanPrompt`, `attachCause`, `stripJsonFences`.

### Changed

- CI pipeline order: security → quality → build → lighthouse/storybook → deploy.
- Reduced Vite `chunkSizeWarningLimit` from 900 KB to 600 KB for more informative dev warnings.

### Fixed

- Deduplicated 4 utility functions between `geminiService.ts` and `aiProviderService.ts`.
- Documented Tauri feature parity gaps as tracked tech debt in AUDIT.md.

## [1.1.0] - 2026-04-16

### Security

- Set restrictive Content Security Policy for Tauri desktop app (`src-tauri/tauri.conf.json`)
- Narrowed Tauri capabilities to granular permissions (fs read/write, dialog open/save, shell open)
- Fixed Tauri identifier from `com.tauri.dev` to `com.storycraft.studio`
- Synced Tauri version to `1.0.0` (was `0.1.0`)
- Added AbortController support to all 14 AI-calling async thunks in projectSlice
- Added signal parameter to `checkConsistency`, `analyzeAsCritic`, `detectPlotHoles` service functions
- Activated retry logic in geminiService (was defined but never called)
- Added PSK-based room isolation for P2P collaboration (SHA-256 room ID derivation)
- API key decrypt failures now return explicit `DECRYPT_FAILED` status with UI recovery flow

### Fixed

- Hardcoded `'en'` language in `useConsistencyCheckerView` and `useCriticView` hooks now dynamically reads from user settings
- Missing `src-tauri/target/` entry in `.gitignore`
- Removed duplicate empty `.prettierrc` file (`.prettierrc.json` is authoritative)
- Fixed 50+ Markdown lint errors in `README.md` (MD022, MD031, MD032, MD040, MD060)
- Removed `as any` type casts in `app/hooks.ts` (shallowEqual) and `app/store.ts` (preloadedState)
- Auto-save now validates state before writing to IndexedDB (null-check, 5MB size warning)

### Added

- Per-view error boundaries with `key={currentView}` auto-reset and "Reset View" button
- AbortController + cleanup in useConsistencyCheckerView and useCriticView hooks
- Generation history capped at 50 entries (FIFO) in writerSlice
- Room password input field in CollaborationPanel for PSK-based collaboration
- Decrypt failure warning banner in ApiKeySection with re-entry prompt
- `ROADMAP.md` with Ollama/Local-AI strategy, model comparison table, and feature roadmap
- `TODO.md` with prioritized task tracker
- Unit tests: geminiService, projectSlice, writerSlice, settingsSlice, dbService, listenerMiddleware, collaborationService (80 tests total)
- Coverage thresholds (50%) in vitest.config.ts
- Manual chunks for leaflet, konva, recharts in Vite build config

### Changed

- Redux logger middleware now opt-in via `localStorage.getItem('debugRedux')`
- CI pipeline: ESLint and typecheck switched from soft-fail to hard-fail mode
- ErrorBoundary component now accepts `onReset` callback prop
- `AUDIT.md` updated with resolution status for addressed findings
- Lazy-loaded `docx`/`jszip` export libraries and improved Vite manual chunk splitting with a higher `chunkSizeWarningLimit` for optimized production builds

## [1.0.0] - 2025-01-01

### Added

#### Core Application

- React 19 + TypeScript 5 (strict mode) single-page application
- Vite 6 build tooling with ES2022 target and manual chunk splitting
- Redux Toolkit 2.x state management with Redux-Undo (100-step history)
- Feature-sliced architecture (`project`, `settings`, `status`, `writer`, `versionControl`)
- Listener middleware for debounced auto-save to IndexedDB (1000ms)

#### Writing & Editing

- Three-panel manuscript editor with chapter navigator and project inspector
- Real-time `@character` and `#world` mention overlay with linking
- Scene board — kanban-style drag-and-drop visual story planning (DnD Kit)
- Voice dictation via Web Speech API with multi-language support
- Command palette (Ctrl+K / ⌘K) for keyboard-first navigation

#### AI Integration (Google Gemini API)

- 10 specialized AI writing tools: Continue, Improve, Change Tone, Dialogue, Brainstorm, Synopsis, Grammar & Style, Critic, Plot-Hole Detector, Consistency Checker
- AI outline generator with genre, pacing, and plot twist controls
- AI character profile generator with backstory, motivations, and personality traits
- AI character portrait generation in multiple styles (realistic, anime, cartoon, comic)
- AI world-building content generation with atmospheric ambiance images
- AI logline suggestions for project dashboard
- RAG-based consistency checker cross-referencing manuscript against character/world data
- Streaming AI responses with chunk-by-chunk rendering
- Multi-provider architecture (Gemini primary, OpenAI and Ollama support)

#### Story Structure & Planning

- Intelligent story template library (Three-Act, Hero's Journey, Save the Cat!, Fichtean Curve)
- Genre templates (Fantasy, Thriller, Horror, Romance, Space Opera, Dystopian)
- Community template system with GitHub-hosted template repository
- Interactive character relationship graph (force-directed visualization)

#### Data Management

- IndexedDB storage with LZ-String compression for payloads > 10KB
- AES-256-GCM encryption for API keys via Web Crypto API
- Version control with branch management and snapshot system
- Project import/export as JSON with image handling
- Auto-save with configurable debounce interval

#### Export Suite

- Markdown (`.md`) export
- Plain text (`.txt`) export
- PDF export with title page, configurable font and spacing (jsPDF)
- DOCX export (docx + jszip)
- EPUB 3.0 client-side generation (epubApiService)
- AI-generated synopsis for export

#### Collaboration

- P2P real-time editing via Yjs + WebRTC (no backend required)
- Awareness system for presence tracking
- Shared Y.Text documents for concurrent editing

#### Progressive Web App (PWA) v3.0

- Service Worker with versioned caches and smart caching strategies
- Cache-First for static assets, Stale-While-Revalidate for dynamic content
- NetworkOnly for AI API calls (never cached)
- Offline fallback page with branded UI
- Installable on desktop and mobile (iOS & Android)
- App shortcuts for quick access from home screen
- Background sync and periodic update support
- Web App Manifest v3 with share target and protocol handlers

#### Internationalization (i18n)

- 5 languages: German (complete), English (complete), French, Spanish, Italian (in progress)
- 14 modular translation files per language
- Custom React Context-based i18n system
- Language persistence via localStorage
- Document `lang` attribute synchronization

#### Accessibility

- WCAG 2.1 AA compliance
- Semantic HTML with comprehensive ARIA attributes
- Focus trapping in modals and drawers
- Keyboard navigation throughout
- Screen reader support with sr-only labels
- High contrast, reduced motion, and color-blind mode settings

#### Desktop Application

- Tauri 2 wrapper for native desktop distribution
- File system access via Tauri plugins
- Dialog and shell integration

#### Developer Experience

- ESLint 9 flat config with TypeScript, React, React Hooks, and jsx-a11y plugins
- Prettier formatting with pre-commit hooks (Husky + lint-staged)
- Vitest unit testing with jsdom environment
- Playwright E2E testing (Chromium + Firefox)
- Storybook component development environment
- GitHub Actions CI/CD pipeline (lint → typecheck → test → build → deploy)
- Automatic GitHub Pages deployment on push to main

### Security

- No hardcoded API keys — all keys encrypted at rest in IndexedDB
- Content Security Policy in index.html
- Local-first architecture — no data leaves the browser
- HTTPS-only external API communication
- Device-scoped encryption key derivation

[Unreleased]: https://github.com/qnbs/StoryCraft-Studio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/qnbs/StoryCraft-Studio/releases/tag/v1.0.0
