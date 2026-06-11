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
- **Storage:** Dual IndexedDB via `services/storage/` (decomposed from `dbService.ts` in Phase 1); LZ-String compression + AES-256-GCM key encryption; `storageEncryptionService.ts` for at-rest IDB encryption (B-1, v1.19.0); `storageService.ts` switches browser vs Tauri filesystem
- **Collaboration:** Yjs + `packages/collab-transport` (vendor fork of y-webrtc 10.3.0, RTCDataChannel E2E AES-256-GCM) for P2P real-time editing
- **Desktop:** Tauri 2 (optional)
- **Package manager:** pnpm@11.x
- **Testing:** Vitest + @testing-library/react (unit), Playwright (E2E)

### Directory Structure

```text
app/              → Redux store, hooks (useAppDispatch/useAppSelector), listener middleware, utils
components/       → React view components (one per view)
  ui/             → Reusable design system primitives (Button, Modal, Card, Toast, etc.)
contexts/         → React context providers (one per major view + I18nContext + CommandExecutorContext)
features/         → Redux Toolkit slices: project, settings, status, writer, versionControl, featureFlags
hooks/            → Custom hooks with view business logic (one hook per view)
services/         → External adapters: geminiService, aiProviderService, dbService (dual IndexedDB + migration), storageService, collaborationService; **ai/** (aiModeService — execution modes, aiPolicy, aiRetry; **providers/** — openrouterProvider with circuit breaker); **copilot/** (heuristicEngine 8 rules, insightGenerator, copilotContextService, actionApplier); **commands/** (palette registry); **keyboard/** (shortcut matching); **help/** (doc retrieval for AI); **settingsExchange** (settings JSON)
locales/          → i18n source files — de/en/es/fr/it (core) + ar/he (RTL Beta) + el/ja/pt/zh (Beta) × 15-20 JSON modules (2 594 keys × 11 locales)
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

3. **AI Service:** `services/ai/index.ts` is the canonical entry (Vercel AI SDK layer). `geminiService.ts` is the primary legacy adapter. `aiProviderService.ts` provides the multi-provider abstraction (Gemini, OpenAI, OpenRouter, Claude, Grok, Ollama, WebLLM, ONNX, Transformers.js). **AI Execution Modes** (`aiModeService.ts`): `hybrid` | `cloud` | `local` | `eco` — control routing strategy, persisted to `settings.aiMode`. **OpenRouter** (`services/ai/providers/openrouterProvider.ts`): Cloud 5 in the routing chain, circuit breaker (4×429 → 5 min pause), free-tier catalog (`:free` suffix models). All cloud AI calls gated by `assertCloudAiAllowed` from `aiPolicy.ts`; retries via `withTransientRetry` in `aiRetry.ts`.

4. **Storage:** `dbService.ts` wraps **dual** IndexedDB (state vs data stores, legacy migration) with compression (LZ-String for payloads > 10KB) and encryption (AES-256-GCM for API keys). `storageService.ts` provides a unified interface that auto-detects IndexedDB vs Tauri filesystem.

5. **i18n:** Custom React Context system in `I18nContext.tsx`. Translation keys use dot notation (`common.save`, `dashboard.wordCount`). All user-facing strings MUST be translation keys, never hardcoded text.

6. **Code Splitting:** All views are lazy-loaded in `App.tsx` via `React.lazy()`. Heavy dependencies (Konva, Leaflet, react-force-graph) are in separate Vite manual chunks. The export stack also uses dynamic imports for `docx` and `jszip` so large document libraries are only loaded when export actions are executed.

7. **Command Center:** Palette commands live in **`services/commands/`** (i18n keys, fuzzy search, recent/pinned). **`CommandExecutorProvider`** exposes execution for Help „Try it” (`tryActionId`) and toasts with **`commandId`**. **`useGlobalKeyboardShortcuts`** reads Redux shortcut bindings; **`app/transientUiStore`** toggles palette visibility.

8. **ProForge Pipeline:** 8-stage agentic manuscript editing pipeline gated behind `featureFlags.enableProForge` (off by default). Stage sequence: `intake` → `structural` → `lineProse` → `copyEdit` → `proof` → `production` → `publishing` → `analytics`. Manuscripts are **never auto-modified** — each stage pauses at `awaitingReview`. Orchestrator: `services/proForge/proForgeOrchestrator.ts`; Redux slice: `features/proForge/proForgeSlice.ts`; UI: `components/proForge/` (ProForgeDashboard, PipelineProgressPanel, PipelineReviewPanel); docs: `docs/PROFORGE-PIPELINE.md`.

9. **Voice Full Support:** Gated behind `featureFlags.enableVoiceSupport` + `settings.voice.enabled`. Abstract engine pattern in `services/voice/voiceTypes.ts` (SttEngine, TtsEngine, VadEngine, WakeWordEngine, IntentEngine). `VoiceCommandService` singleton manages state machine (idle → listening → processing → speaking). Web Speech API fallbacks require zero downloads. Hooks: `useVoice`, `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation`.

10. **Feature Flags:** 21 flags in `features/featureFlags/featureFlagsSlice.ts`. Default **on**: `enableCodexAutoTracking`, `enableCrossProjectSearch`, `enablePlotBoardV2` (deprecated UI, retained for localStorage compat). All others default off. Key flags: `enableProForge`, `enableGlobalCopilot`, `enableVoiceSupport`, `enableDuckDbAnalytics`, `enableWorkerBusV2`. Do not use scattered `if (true)` hacks — all experimental features must go through a flag.

11. **Global AI Copilot (v2):** `enableGlobalCopilot` flag. `CopilotPanel` (dialog/sidebar mode), `CopilotMessageList` (markdown rendering via DOMPurify), `InlineAnnotationLayer` (badge in ManuscriptEditor). Heuristic rules: `services/copilot/heuristicEngine.ts` (8 rules). Apply-to-chapter: `services/copilot/actionApplier.ts` (offset-safe edit, redux-undo, ≥70% length gate). ProForge integration: Ask-Copilot chip on each `ReviewItemCard`. Docs: `docs/COPILOT.md`, `docs/HEURISTIC-RULES.md`.

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

#### CI/CD Security Hardening (QNBS-v3)

- **Token-Permissions**: All workflow files MUST have `permissions: contents: read` at top-level. Write permissions belong at job-level only.
- **Pinned-Dependencies**: All GitHub Actions MUST be pinned to SHA hashes (e.g., `actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10`). Branch/tags are only acceptable when upstream does not provide SHA tags.
- **Proactive Security Remediation**: On every PR and commit, treat ALL security alerts (OpenSSF Scorecard, CodeQL, Dependabot, Renovate, CodeAnt AI) as actionable work to be addressed immediately — never defer. Validate against current code, implement root-cause fixes, and verify via CI.

### Pull Request Workflow (QNBS-v3)

- **Branch-based development**: All changes MUST be made on feature branches (e.g., `fix/security-vulnerabilities-2026-06-06`). Never commit directly to `main`.
- **CI verification**: Push to branch and wait for ALL CI jobs (security, quality, build, e2e, lighthouse) to pass before merging.
- **PR merge**: Only merge to `main` when CI is fully green. Use "Squash and merge" for clean history.
- **Inline comment handling**: Proactively address ALL inline PR review comments (CodeAnt AI, human reviewers) immediately:
  1. Validate the finding against current code (comments may be stale)
  2. Implement the real fix (root cause, fully worked out)
  3. If already fixed or false positive, reply with evidence
  4. Resolve the thread after fixing
  5. Push and verify CI passes

### Test Stability Guidelines (QNBS-v3)

- **ICU-dependent APIs**: Tests using `Intl.Segmenter`, `Intl.PluralRules`, or other ICU-dependent APIs MUST use relaxed assertions (non-zero counts, monotonic behavior, locale invariants) instead of exact counts to ensure cross-environment stability.
- **Environment variance**: Node.js ICU versions and browser implementations can differ; tests should verify behavior, not exact output.

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
- `workers/inference.worker.ts:50` — `@ts-expect-error` on `@xenova/transformers` dynamic import (Vite resolves at build, `tsc` cannot)
- **DS-5:** Delete legacy bridge block from `index.css` — deferred until DS-1 token migration verified in production
- **v2.0 stubs behind feature flags:** RTL layout (`enableRtlLayout`), Cloud-Sync R2 adapter (`enableCloudSync`), LoRA adapter inference (`enableLoraAdapters`), Plugin system loader (`enablePluginSystem`)
- RTCDataChannel in-flight E2E encryption is **shipped** (y-webrtc patch v1.17.0) — no longer open

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

## Storage Health

`services/dbInitialization.ts` exports `checkStorageHealth()` — proactive low-storage warning that runs on app init and surfaces a toast. Returns `StorageHealth`; does not block writes.

## Collaboration

Real-time P2P via Yjs + y-webrtc (`services/collaborationService.ts`). **RTCDataChannel in-flight E2E encryption** is shipped via `patches/y-webrtc@10.3.0.patch` (v1.17.0). Signaling-channel encryption: AES-256-GCM / PBKDF2 (600 000 iterations, SHA-256), deterministic salt from `projectId`.

## graphify

Before answering architecture or codebase questions, read `graphify-out/GRAPH_REPORT.md` if it exists.
If `graphify-out/wiki/index.md` exists, navigate it for deep questions.
Type `/graphify` in Copilot Chat to build or update the knowledge graph (semantic / LLM-backed).

From the repo shell, **`pnpm run graphify:update`** refreshes the AST-only graph (works even when `graphify` is not on `PATH`, e.g. after `pip install graphifyy` on Windows); see `docs/graphify.md` and `scripts/graphify-cli.mjs`.

## codegraph

This project uses CodeGraph (`.codegraph/`) for semantic code intelligence via MCP. Read `.codegraph/CODEGRAPH_REPORT.md` for index status before deep code navigation.

Rules:
- For code-structure, caller/callee, or impact questions, prefer CodeGraph MCP tools (`codegraph_context`, `codegraph_impact`, `codegraph_trace`)
- If `.codegraph/` exists, answer directly with CodeGraph — don't delegate exploration to a file-reading sub-agent
- For "how does X reach Y", use `codegraph_trace` instead of manual Grep + Read chains
- After modifying code, the graph auto-syncs (2s debounce). For large refactors, run `pnpm run codegraph:update`
- To find affected tests: `pnpm run codegraph:affected`

### Dual-Graph workflow
1. Architecture / high-level questions: Read `graphify-out/GRAPH_REPORT.md` first
2. Code navigation / symbols / impact: Use CodeGraph MCP tools
3. Cross-module relationships: Use Graphify `query`/`path` or CodeGraph `context`
