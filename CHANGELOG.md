# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Refactored

- **SettingsView Decomposition**: Split 2112-LOC monolith `components/SettingsView.tsx` into 8 focused section files under `components/settings/` (SettingsShared, AiProviderCard, SettingsModals, GeneralSections, EditorSections, AiSections, SystemSections, DataSection). Main component reduced to ~234 LOC.
- **Constants Split**: Split 506-LOC `constants.tsx` into `constants/icons.tsx` (SVG paths), `constants/defaults.ts` (STORY_TEMPLATES), and `constants/index.ts` (barrel). All 18 existing imports resolve via barrel.
- **Listener Separation**: Split combined auto-save listener in `listenerMiddleware.ts` into separate project and settings listeners to prevent full project serialization on theme toggle.
- **StorageBackend Interface**: Unified `StorageManager` backend typing — removed `typeof dbService` union, typed as `StorageBackend` with `as unknown as StorageBackend` casts. Fixed `listSnapshots()` return type from `string[]` to `ProjectSnapshot[]`.

### Fixed

- **HelpView Array Keys**: Replaced bare array index keys with prefixed keys (`code-${index}`, `t-${index}`, `b-${index}-${subIndex}`) and added biome-ignore comments for deterministic regex-split patterns.
- **Collaboration Awareness Validation**: Added runtime validation for remote peer awareness state (type checks for id/name/color, length limits) to prevent malicious data injection.
- **Lighthouse CI**: Changed `continue-on-error` from `true` to `false` for Lighthouse job in CI.
- **codexService Infinite Loop**: Replaced `while` + `exec()` loop with `for...of matchAll()` to prevent browser freeze on English manuscripts.
- **Modal Focus-Trap**: Consolidated cleanup into single function with early return for `!isOpen`.
- **FOUC Theme Init**: Added inline theme script in `<head>` reading from localStorage.
- **dbService Decrypt**: Added missing `await` before `decryptWithMigration()` in try/catch blocks.

### Security

- **CryptoKey**: Replaced reconstructible key derivation with `crypto.subtle.generateKey()` non-extractable CryptoKey.
- **CSP img-src**: Tightened from `https:` wildcard to `'self' data: blob:` only. Added `frame-ancestors 'none'` and `upgrade-insecure-requests`.
- **Import Validation**: Added Valibot schema validation for imported project JSON.

### Changed

- **AI Provider**: `testAIConnection('gemini')` now makes real API validation call. OpenAI non-gpt models throw descriptive error instead of silent downgrade. OpenAI stream loop checks `signal.aborted`.
- **Coverage Config**: Replaced curated file list with glob patterns for honest all-up coverage.
- **Community Templates**: Updated error messages to reflect local static asset source instead of GitHub API references.

### Maintenance (2026-04-18 Hardening Batch)

- **CI / Codecov**: Replaced deprecated `pnpm dlx codecov` upload flow with `codecov/codecov-action@v5` in `.github/workflows/ci.yml`.
- **CI / Failure Visibility**: Removed `continue-on-error` from the Storybook job so broken Storybook builds fail CI as expected.
- **CI / Lighthouse Behavior**: Kept Lighthouse job soft-fail semantics for budget misses while using `lhci autorun --assert.exitCode=0` to avoid false-red budget exits and still surface runtime crashes.
- **Security Process**: Added `.github/SECURITY.md` with supported versions table, private disclosure channels, and a default 90-day coordinated disclosure policy.
- **PWA Update UX**: Switched Service Worker update activation to explicit user consent. `SKIP_WAITING` is now sent only from the update toast action instead of auto-activation paths.
- **Service Worker Lifecycle**: Removed install-time `self.skipWaiting()` from `public/sw.js` to prevent forced activation during active writing sessions.
- **Collaboration Resilience**: Added `wss://signaling.yjs.dev` as a signaling fallback in `services/collaborationService.ts` to reduce single-point-of-failure risk.
- **CSP Alignment**: Extended `connect-src` in `index.html` for additional collaboration signaling endpoints (`wss://signaling.yjs.dev`, `wss://*.workers.dev`).
- **Owner Documentation**: Added collaboration failover and self-hosted signaling guidance (Cloudflare Worker path) to `README.md`.
- **Test Hardening**: Replaced the stub `settingsSlice` unit test with a comprehensive suite (29 tests, 331 LOC) covering all reducer actions and edge cases.
- **Theme Roundtrip Testability**: Exported `applyInitialTheme` from `features/settings/settingsSlice.ts` and added persisted-state roundtrip tests for `localStorage` + system-theme resolution.

### Fixed

- **Render-Blocking Fonts**: Replaced 3 render-blocking `@import url("https://fonts.googleapis.com/...")` in `index.css` with self-hosted `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/merriweather` (woff2). Fonts are now bundled by Vite, eliminating external network requests and improving First Contentful Paint.

### Security

- **CSP Tightening (Fonts)**: Removed `https://fonts.googleapis.com` from `style-src` and `connect-src`, removed `https://fonts.gstatic.com` from `font-src` and `connect-src` in both `index.html` and `src-tauri/tauri.conf.json`. Fonts are now served from `'self'` only.

### Changed

- **Service Worker**: Removed Google Fonts Cache-First fetch handler and `CACHE_FONTS` cache bucket from `public/sw.js` (no longer needed with self-hosted fonts).
- **Documentation Consolidation**: Merged `audit15april2026.md` into `AUDIT.md` as a collapsible baseline section. Moved completed tasks from `TODO.md` to `docs/history/completed-v1.1.md`. Cleaned up `TODO.md` (current sprint only) and `ROADMAP.md` (quarterly+) with cross-references.

### Removed

- `audit15april2026.md` (consolidated into `AUDIT.md`).
- Preconnect links to `fonts.googleapis.com` and `fonts.gstatic.com` from `index.html`.

### Added

- `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/merriweather` as dependencies for self-hosted font loading.
- `docs/history/completed-v1.1.md` archive for completed v1.1 sprint tasks.

### Fixed

- **Logger No-ops**: Fixed empty `debug()` and `info()` method bodies in `logger.ts` that silently discarded all debug/info log messages.
- **Community Templates CSP**: Replaced GitHub raw URL fetch in `communityTemplateService.ts` with local static asset (`public/community-templates/index.json`), eliminating CSP `connect-src` violations and enabling offline support.
- **Ollama Browser Guard**: Added `window.__TAURI__` check in `aiProviderService.ts` to prevent Ollama connection attempts in the browser (CSP blocks `localhost` in the deployed PWA). Added amber warning banner in SettingsView for non-desktop environments.
- **Tauri Ollama CSP**: Changed Tauri CSP `connect-src` from broad `http://localhost` to explicit `http://localhost:11434 http://127.0.0.1:11434` for Ollama API access.
- **Service Worker Double-Track**: Switched VitePWA from `generateSW` to `injectManifest` strategy, preventing conflicts with the custom `public/sw.js` service worker. Added `self.__WB_MANIFEST` injection point for precache manifest.
- **i18n Eager Loading**: Replaced 70 parallel fetch calls (14 modules × 5 languages) at boot with lazy single-bundle loading (2 fetches max: active language + EN fallback). Added `scripts/build-i18n.mjs` prebuild step to merge per-module JSON files into `public/locales/<lang>/bundle.json`.
- **modulePreload Optimization**: Converted all 14 AI thunks in `projectSlice.ts` from static imports to dynamic `import()` calls for `aiProviderService` and `geminiService`, keeping `@google/genai` out of the eager chunk graph. Added Vite `modulePreload.resolveDependencies` filter to skip preloading vendor chunks (`ai-vendor`, `export-vendor`, `data-vendor`, `collaboration-vendor`, `canvas-vendor`).

### Security

- **Tauri FS Scope**: Replaced unscoped `fs:allow-*` permissions in `src-tauri/capabilities/default.json` with `$APPDATA/**`-scoped entries, preventing filesystem access outside the application data directory.

### Added

- `settings.ai.ollamaBrowserNote` translation key in all 5 locale files (de, en, es, fr, it).
- `public/community-templates/index.json` static asset for offline community template loading.
- `scripts/build-i18n.mjs` build script for i18n bundle generation.
- `prebuild` npm script hook to auto-generate i18n bundles before production builds.

### Fixed

- **Critical**: Configured Tailwind CDN dark mode to use `selector` strategy with `.dark-theme` class. Previously, all `dark:` prefixed Tailwind classes responded to OS system preference instead of the in-app theme toggle, causing broken styling when OS and app theme diverged.
- **Light Mode Overlays**: Replaced all hardcoded `bg-black/40`, `bg-black/60`, `bg-gray-900/50` modal/drawer/panel backdrops with theme-aware `--overlay-backdrop` CSS custom property across Modal, Drawer, CommandPalette, Sidebar, CollaborationPanel, and VersionControlPanel.
- **Light Mode Card Overlays**: Fixed CharacterView and WorldView card gradient overlays (`via-black/40`) and hardcoded `text-white`/`text-gray-300` text to use theme-aware CSS custom properties.
- **Light Mode Glass Effects**: Replaced all `bg-white/5`, `bg-white/10`, `border-white/5`, `via-white/15` dark-mode-only glass morphism classes with theme-aware CSS custom properties (`--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight`) across Input, Textarea, Select, Checkbox, Card, AddNewCard, Skeleton, Button, Header, Dashboard, WriterView, ExportView, SettingsView, HelpView, TemplateView, WorldView, ManuscriptView, and CommandPalette.
- **Light Mode Aurora**: Reduced aurora blob opacity from 0.25 to 0.08 in light mode to prevent visual noise on white backgrounds.
- **Light Mode Prose Links**: Fixed HelpView prose link color (`prose-a:text-indigo-400`) to use `prose-a:text-indigo-600 dark:prose-a:text-indigo-400` for proper contrast in both themes.
- **Light Mode Ring/Focus Indicators**: Replaced `ring-white/10`, `ring-black/5 dark:ring-white/5` with theme-aware `--glass-border` for consistent visibility in both themes.
- **Tauri Version Mismatch**: Aligned `src-tauri/tauri.conf.json` version from `1.0.0` to `1.1.1` (matching `package.json`).
- **Tauri Build Path**: Fixed `frontendDist` from `../build` to `../dist` to match Vite's default output directory (was breaking `tauri build`).
- **Hardcoded German String**: Replaced hardcoded `'EPUB-Export fehlgeschlagen: '` in ExportView with i18n key `export.error.epubFailed`.
- **Hardcoded EPUB Language**: Replaced hardcoded `lang: 'de'` in EPUB export with dynamic `language` from user settings.

### Security

- **CSP Tightening**: Removed overly broad `https://*.googleapis.com` wildcard from Tauri CSP `connect-src`, retaining only the specific `https://generativelanguage.googleapis.com` domain needed for Gemini API.

### Changed

- **Tauri Window Defaults**: Improved window configuration from 800×600 to 1280×800 with `minWidth: 800`, `minHeight: 600`, and `center: true` for better desktop UX.
- **Tauri Product Name**: Changed from `storycraft-studio` to `StoryCraft Studio` for proper branding in window title and system tray.

### Added

- New CSS custom properties for theme-aware glass/overlay effects: `--overlay-backdrop`, `--glass-bg`, `--glass-bg-hover`, `--glass-border`, `--glass-highlight`, `--card-gradient-overlay` with appropriate values for both dark and light themes.
- Added `export.error.epubFailed` translation key to all 5 locale files (de, en, es, fr, it).

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
