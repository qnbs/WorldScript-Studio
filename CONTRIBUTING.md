# Contributing to WorldScript Studio

Thank you for your interest in contributing to WorldScript Studio — an AI-powered creative writing studio built with React, Redux Toolkit, and the Gemini API.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Accessibility](#accessibility)
- [Security Guidelines](#security-guidelines)
- [Known Technical Debt](#known-technical-debt)
- [Pull Request Process](#pull-request-process)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](.github/CODE_OF_CONDUCT.md). By participating, you are expected to uphold it — report unacceptable behavior via [GitHub Private Vulnerability Reporting](https://github.com/qnbs/WorldScript-Studio/security/advisories/new), the same private channel documented in [`.github/SECURITY.md`](.github/SECURITY.md).

## Development Setup

### Prerequisites

- **Node.js** ≥ 22 (see [`.nvmrc`](.nvmrc); matches `engines` in [`package.json`](package.json))
- **pnpm** ≥ 11 (see `packageManager` in `package.json`; recommended via **Corepack**, ships with Node)
- A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey) (optional if using **Ollama** in the desktop app only)

### Windows: Node, Corepack, and pnpm

1. Install **Node.js 22+** LTS from [nodejs.org](https://nodejs.org/) (includes Corepack) or use **nvm-windows** and install `22` from [`.nvmrc`](.nvmrc).
2. Open **PowerShell or CMD as Administrator** once and run: `corepack enable`
3. In the repo folder: `corepack prepare pnpm@11.22.0 --activate` (version matches `packageManager` in [`package.json`](package.json); adjust if that field changes).
4. Confirm: `pnpm -v` — then `pnpm install` and use `pnpm run …` for all scripts (hooks expect `pnpm` on `PATH`).

If `corepack` is not recognized, reinstall Node or enable the “Tools for Native Modules” / standard installation so `corepack.cmd` is on `PATH`.

### Graphify (optional, Python)

Graphify is the **`graphifyy`** package on PyPI (CLI command `graphify`), not an npm package — see [`docs/graphify.md`](docs/graphify.md).

**Recommended install (matches many setups):**

```bash
pnpm run graphify:bootstrap  # pip install/upgrade graphifyy (needs Python 3.11+ with pip)
pnpm run graphify:install    # registers IDE/git integrations (run once per machine)
pnpm run graphify:hooks      # optional: auto `graphify update .` on commit/checkout
pnpm run graphify:update     # refresh graphify-out/ (AST-only)
```

If `graphify` is not on your `PATH` (common on Windows after plain `pip`), use **`pnpm run graphify:*`** — they call [`scripts/graphify-cli.mjs`](scripts/graphify-cli.mjs). On **Windows** the launcher prefers **`python -m graphify`** (then `python3`, then `py`) so it works when `graphify.exe` lives under the pip user `Scripts` folder but that folder is not on `PATH`.

**Alternatives:** `pipx install graphifyy` or `uv tool install graphifyy` (often put `graphify` on `PATH` automatically). On Windows, pip user scripts often live under `%APPDATA%\Python\Python3xx\Scripts` — add that directory to your user `PATH` if you want the bare `graphify` command everywhere.

### CodeGraph (optional, Node/npm)

CodeGraph provides **semantic code intelligence** via MCP — symbol-level caller/callee/impact analysis with auto-sync. See [`docs/codegraph.md`](docs/codegraph.md) and [`docs/dual-graph-setup.md`](docs/dual-graph-setup.md).

**Install:**

```bash
npm install -g @colbymchenry/codegraph   # or pnpm add -g
codegraph init -i                        # in repo root
```

**Agent setup (Kimi Code CLI):** add the MCP server to `~/.kimi/settings.json` (see `docs/codegraph.md` § MCP Integration).

**Daily commands:**

```bash
pnpm run codegraph:status     # index stats
pnpm run codegraph:update     # full re-index
pnpm run codegraph:affected   # tests affected by uncommitted changes
pnpm run graphs:update        # update both Graphify + CodeGraph
```

### Installation

```bash
git clone https://github.com/qnbs/WorldScript-Studio.git
cd WorldScript-Studio
pnpm install
pnpm run hooks:install  # configures the pre-commit lint-staged hook
```

`hooks:install` is a separate, explicit step rather than an automatic `prepare` script: pnpm v11's `allowBuilds` policy denies `simple-git-hooks`' own install-time script by default (supply-chain hardening — see `pnpm-workspace.yaml`), so a `prepare` script that shelled out to it would silently do nothing anyway. Skipping this step means commits bypass the `lint-staged` pre-commit check.

### Environment

The app uses **no build-time secrets**. The Gemini API key is entered via the Settings UI and stored encrypted in IndexedDB.  
See [`.env.example`](.env.example) for details.

### Running the dev server

```bash
pnpm run dev          # Vite dev server on http://localhost:3000
pnpm run dev:tauri    # Tauri desktop app (requires Rust)
```

---

## Tech Stack

| Layer     | Technology                                                 |
| --------- | ---------------------------------------------------------- |
| Frontend  | React 19, TypeScript (strict + exactOptionalPropertyTypes)   |
| State     | Redux Toolkit 2.x + redux-undo                             |
| Styling   | Tailwind CSS 4 via `@tailwindcss/vite` + CSS custom props    |
| AI        | Gemini (`@google/genai`), OpenAI, Ollama, WebLLM, ONNX, Transformers.js via `aiProviderService.ts` |
| Storage   | IndexedDB (`dbService`) / Tauri filesystem (`fileSystemService`)   |
| Build     | Vite 8 + vite-plugin-pwa                                     |
| Lint      | Biome (`pnpm run lint` / `lint:fix`)                         |
| Tests     | Vitest + Testing Library + Playwright                        |
| Desktop   | Tauri 2 (optional)                                           |
| Storybook | Storybook 10 with `@storybook/react-vite`                    |

---

## Project Structure

```
WorldScript-Studio/
├── app/              # Redux store, hooks, listenerMiddleware
├── components/       # React UI components
│   └── ui/           # Primitive design-system components (Button, Card, Modal…)
├── contexts/         # React contexts per view + I18n + CommandExecutor
├── features/         # Redux slices (project, settings, writer, status, featureFlags, plotBoard, progressTracker, sceneComments)
├── hooks/            # Custom React hooks per view + shared hooks (e.g. useGlobalKeyboardShortcuts)
├── locales/          # i18n source JSON — 19 locales: de/en/es/fr/it core + ar/he/fa RTL + el/ja/pt/zh/fi/sv/hu/is/eu/ru/ko Beta (key parity vs en)
├── services/         # Adapters: AI, DB, storage, collaboration, EPUB; commands/, keyboard/, help/, settingsExchange
├── stories/          # Storybook stories for UI components
├── docs/             # Deep-dive docs (CI reference, history, graphify)
├── tests/
│   ├── unit/         # Vitest unit tests
│   ├── e2e/          # Playwright end-to-end tests
│   └── setup.ts      # Test setup (jsdom, mocks)
├── types.ts          # Core shared TypeScript types (plus collocated types in features)
└── .github/
    └── workflows/
        └── ci.yml    # security → quality → build / e2e / storybook → lighthouse → deploy (main)
```

**Documentation index:** [`README.md`](README.md) § **Documentation Hub** lists every maintainer-facing `.md`; [`AUDIT.md`](AUDIT.md) § *Markdown corpus* lists the **22** curated sources; canonical CI details → [`docs/CI.md`](docs/CI.md) (including **Cloud CI-first** — heavy E2E, coverage, Lighthouse run on GitHub Actions).

---

## Development Workflow

### Git Branching

- `main` — protected, deploys automatically to GitHub Pages
- Feature branches: `feat/feature-name`
- Bug fixes: `fix/issue-description`

### Pre-commit Hooks

[`simple-git-hooks`](https://github.com/toplenboren/simple-git-hooks) + [`lint-staged`](https://github.com/lint-staged/lint-staged) run on commit:

- **Biome** `check --write` on staged files (`biome.json` policy)

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add X feature
fix: resolve Y bug
docs: update README
refactor: restructure Z module
test: add unit tests for W
chore: update dependencies
```

---

## Testing

> ### ⚠️ Do NOT run the heavy suites locally
>
> This repo is developed on constrained hardware (~3–4 GB RAM). **Never** run the full Vitest **coverage** suite, **Playwright E2E**, **Stryker mutation**, **Lighthouse CI**, or the **Storybook test-runner** locally — they OOM weak machines and are **CI-only by design**. Push to a branch and let GitHub Actions run the heavy tier; a green CI run is the merge bar.

### Minimal Change Checklist (what to actually run locally)

Run the smallest gate that matches your change — sequentially, one heavy command at a time:

| Your change… | Run locally before pushing |
|---|---|
| **Always** | `pnpm run ci:prepush` |
| **Touched any locale JSON** | `pnpm run i18n:check` (parity + bundle rebuild) |
| **Added/removed a feature flag** | `pnpm exec tsx scripts/audit-feature-parity.ts` (must report 0 drifts) |
| **Touched `packages/ai-core`, `workers/`, or `vite.config.ts`** | `pnpm run build && pnpm run smoke:prod` (prod-only crash guard) |
| **Added a `components/ui/` primitive** | add a `.stories.tsx`; the Storybook test-runner verifies it in CI |
| **Added a dependency** | `pnpm audit --audit-level=high` (override + document in `AUDIT.md` if needed) |

Coverage, E2E, Lighthouse, Stryker, and Storybook test-runner are **CI gate jobs** — do not attempt them locally.

### Local vs CI (low-end friendly)

- **Before every push:** `pnpm run ci:prepush` (sequential single-checker typecheck, i18n parity/quality, release/doc truth, and lightweight guardrails); the pre-commit hook runs staged Biome checks. Optional: targeted `pnpm exec vitest run <path>` for a quick smoke.
- **Full local gate (manual):** `pnpm run ci:local:full`; full tests, coverage, E2E, Storybook, Lighthouse, and mutation testing remain CI-owned on low-end hardware.
- **Dependency recovery:** run `node scripts/dependency-state.mjs reconcile` when pnpm reports stale dependency state. It performs the frozen install and records the content fingerprint atomically; `pnpm run deps:reconcile` is the convenience wrapper when pnpm can launch.
- **Vitest hard rule:** Never invoke `pnpm test`, `npm run test`, or a bare Vitest wrapper; watch mode hangs constrained hardware. Use an explicit targeted `pnpm exec vitest run <path>` command.
- **Full gate:** GitHub Actions runs Vitest **with** coverage thresholds, Playwright (desktop + mobile emulation in CI), Lighthouse, etc. A **green CI run** is the merge bar — you are **not** required to pass full E2E or LHCI on a weak laptop.
- **Optional local E2E:** `CI=true pnpm run test:e2e` when debugging; optional mobile project: `RUN_MOBILE_E2E=1` (see [`docs/CI.md`](docs/CI.md)).
- **CI artifacts:** When Playwright, coverage, or Lighthouse fails remotely, open **GitHub Actions → the workflow run → Artifacts** and inspect the uploaded reports locally — faster than reproducing the full heavy stack on low-end hardware.

### Unit Tests (Vitest)

```bash
pnpm exec vitest run <path>             # Targeted single-file run
pnpm exec vitest run <path> --coverage \
  --coverage.thresholds.lines=0 --coverage.thresholds.functions=0 \
  --coverage.thresholds.branches=0 --coverage.thresholds.statements=0  # Targeted coverage debugging
```

### Bundle size (matches CI `build` job)

After a production build:

```bash
pnpm run bundle:budget   # fails if any dist/assets/*.js chunk exceeds default cap (see script)
pnpm run analyze         # writes dist/bundle-analysis.html (visualizer does not auto-open when CI=true)
```

### Low-end laptop: local CI instead of cloud

On **2–4 GB RAM** (e.g. Ubuntu 20.04), use the bundled **act + Eco-Forgejo** stack — GitHub can stay an optional backup remote only:

- **Install:** [`infra/low-end-ci/INSTALL.md`](infra/low-end-ci/INSTALL.md)
- **Daily workflow:** [`infra/low-end-ci/DAILY-DRIVER.md`](infra/low-end-ci/DAILY-DRIVER.md)
- **Quick gate (no Docker):** `pnpm run ci:quick`; for one targeted unit file use `VITEST_PATH=tests/unit/example.test.ts pnpm run ci:quick:unit`
- **Full `ci.yml` locally:** `pnpm run ci:act` (sequential act jobs)

Manual [Act](https://github.com/nektos/act) example:

```bash
act pull_request --sequential -j security -j quality --matrix node-version:lts/* -W .github/workflows/ci.yml
```

If you need Codecov support locally:

```bash
export CODECOV_TOKEN="your_token_here"
act pull_request -j quality -s CODECOV_TOKEN=${CODECOV_TOKEN} -W .github/workflows/ci.yml
```

Tests live in `tests/unit/`. Each UI component and core hook should have a test file.

### E2E Tests (Playwright)

CI sets `CI=true` (required by `package.json` scripts). **GitHub Actions installs Chromium** and runs **desktop + mobile-emulated** projects (still Chromium). Locally, **Firefox** is included when `CI` is not `true`; mobile emulation locally only if `RUN_MOBILE_E2E=1`.

Locally:

```bash
pnpm run dev          # Optional: dev server for manual exploration
$env:CI='true'; pnpm run test:e2e    # PowerShell
# CI=true pnpm run test:e2e         # bash
$env:CI='true'; pnpm run test:e2e:ui
```

**Visual regression** (`tests/e2e/visual-regression.spec.ts`) stores baselines under `tests/e2e/*-snapshots/`. The config uses a shared `snapshotPathTemplate` (no per-OS suffix) so one committed PNG can match Linux CI and local dev. After intentional UI changes:

```bash
$env:CI='true'; pnpm exec playwright test tests/e2e/visual-regression.spec.ts --update-snapshots --project=chromium
```

#### Shared helpers (`tests/e2e/helpers.ts`)

- **Never** `waitForLoadState('networkidle')` against the Vite dev server — HMR/WebSocket traffic prevents a stable idle state. Use `waitForSpaReady()` / DOM anchors instead.
- **`selectEnglish()`** — welcome-portal language toggle so assertions match English copy.
- **`ensureBlankProject()`** — exits the Welcome Portal with a blank manuscript so the main shell (`#sidebar` or mobile tab bar) exists (fresh CI contexts start as “new users” with no IndexedDB).
- **`sidebar(page)`** — scopes clicks to `#sidebar` to avoid matching duplicate nav controls (desktop vs mobile).
- **Version History panel** — when open, a full-screen backdrop intercepts pointer events; press **Escape** (panel closes when no inner modal is open) or use the close control before navigating elsewhere.

Tests live in `tests/e2e/`. Playwright tests verify core user flows:

- Navigation between views
- Export functionality
- Keyboard accessibility
- Mobile viewport behavior

### Mutation testing (Stryker)

Targets are defined once in [`stryker-scope.json`](stryker-scope.json) and consumed by
[`stryker.config.mjs`](stryker.config.mjs): 25 production files across 8 risk-tiered modules.
The manual workflow can run `all`, `tier-a`, or one module. Related-test selection avoids rerunning
the full Vitest suite for every mutant. Reports are kept under `reports/mutation/` and uploaded
with module identity; the aggregate derives metrics from mutant statuses and fails on missing or
invalid shards while showing killed, survived, timeout, no-coverage, ignored, pending, and error counts. Current operational
thresholds are `break: 75`, `low: 70`, and `high: 85`; they are not a measured baseline until a
trusted force run establishes one.

```bash
pnpm run mutation        # incremental; CI-only
pnpm run mutation:force  # no-cache force audit; CI-only
pnpm run mutation:report # aggregate downloaded reports
```

Do not run broad Stryker locally on constrained hardware. Use targeted tests locally and dispatch
the workflow for PR-related Tier-A/module diagnostics, recurring incremental checks, or release /
security force audits. Treat equivalent mutants as a documented survivor class; never hide
NoCoverage or timeout results and never change thresholds merely to make CI green.

### Storybook

```bash
pnpm run storybook          # Start Storybook dev server on :6006
pnpm run build-storybook    # Build static Storybook
```

Stories live in `stories/`. All primitive UI components (`components/ui/`) should have a story.

---

## Code Quality

### TypeScript

- `strict: true` is enforced
- `exactOptionalPropertyTypes: true` is enforced — do not assign `undefined` to optional properties explicitly; omit the property instead
- When adding new code, avoid `any` — use proper types or `unknown`
- Run: `pnpm run typecheck`

### Biome

Single toolchain for **lint** and **format** ([`biome.json`](biome.json)):

```bash
pnpm run lint       # check (CI-hard-fail)
pnpm run i18n:check # locale JSON key parity vs English (CI-hard-fail)
pnpm run lint:fix   # check --write (lint + format)
pnpm run format     # format only
```

Missing keys (e.g. after adding strings to `locales/en/*.json`): run `node scripts/check-i18n-keys.mjs --fix` to copy English placeholders into other languages, then translate in a follow-up.

### Rule: No API Keys in Logs

**Never** log the Gemini API key or any secrets to the console. The `geminiService.ts` handles key storage securely via IndexedDB with crypto.subtle encryption.

---

## Accessibility

We target **WCAG 2.2 AA** patterns where practical (Biome `a11y` rules are strict — warnings fail CI).

**Architecture (don’t bypass):**

- **Live announcements:** `LiveRegionProvider` / `useAnnounce()` in [`contexts/LiveRegionContext.tsx`](contexts/LiveRegionContext.tsx) — use for meaningful status changes; respect `settings.accessibility.liveRegionVerbosity`.
- **Focus management:** Modals and the **Command Palette** use [`hooks/useFocusTrap.ts`](hooks/useFocusTrap.ts); restore focus when closing overlays.
- **Settings:** Accessibility presets + Zod-normalized persistence — [`features/settings/accessibilitySchema.ts`](features/settings/accessibilitySchema.ts), UI in [`components/settings/SystemSections.tsx`](components/settings/SystemSections.tsx).

**Patterns:**

- Interactive controls expose accessible names (`aria-label`, visible text, or `aria-labelledby`).
- Dialog surfaces use `role="dialog"`, `aria-modal`, and labelled titles (see [`components/ui/Modal.tsx`](components/ui/Modal.tsx)).
- Long-running or AI-heavy regions may use `aria-busy` and short `aria-live="polite"` copy (e.g. Writer, Manuscript inspector).
- Lists and boards: semantic roles (`list`, `tablist`, grouped command palette options); prefer keyboard alternatives where interaction is mouse-first (e.g. Scene Board reorder controls).

**When adding UI:**

- Prefer semantic HTML; avoid redundant roles on native elements unless fixing SR gaps.
- Icon-only buttons require `aria-label` (or tooltip + focus pattern that meets WCAG).
- New copy is authored in the **5 core** locale trees (de/en/es/fr/it); `i18n:check` enforces key parity across all 17 — [`pnpm run i18n:check`](package.json).

**Further reading:** [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md); automated smoke — [`tests/e2e/a11y.spec.ts`](tests/e2e/a11y.spec.ts).

---

## Security Guidelines

For the full security policy, threat model, and active security work items, see [**`SECURITY.md`**](../.github/SECURITY.md).

- **CSP**: `index.html` contains a `Content-Security-Policy` meta tag restricting resource origins
- **API keys**: Never hardcode API keys; always use the encrypted IndexedDB storage (`dbService.ts`, AES-256-GCM)
- **AbortController**: All AI API calls support cancellation via `AbortSignal`
- **Rate limiting**: `geminiService.ts` handles 429 errors with exponential backoff
- **Input sanitization**: User input displayed in HTML contexts must go through `DOMPurify.sanitize()` before `dangerouslySetInnerHTML`
- **AI responses**: Never pass AI output through `eval()`, `new Function()`, or dynamic `<script>` injection
- **Collaboration**: Always provide a password when calling `collaborationService.connect()` in production — passwordless connections throw `CollabEncryptionRequiredError`

---

## Known Technical Debt

Authoritative list: [`AUDIT.md`](AUDIT.md) and [`TODO.md`](TODO.md). Short pointers:

1. **`StorageBackend` contract** — implement `services/storageBackend.ts` on both backends; use `storageService` in UI (not `dbService` directly) so Tauri and browser stay consistent.
2. **`app/listenerMiddleware.ts`** — occasional TypeScript friction with `redux-undo`'s `StateWithHistory` (typed carefully at boundaries).
3. **Collaboration** — optional configurable signaling URL; E2E encryption deferred (roadmap).
4. **i18n** — All **17** locale trees must share the same keys as English (`pnpm run i18n:check`). The in-app selector exposes all 17 (5 core + 12 Beta). You author new copy in the 5 core trees (de/en/es/fr/it); `check-i18n-keys.mjs --fix` backfills the Beta locales with English placeholders, which the machine-translation pass then fills. Locale metadata lives in the SSOT registry `i18n/locales.ts`. To add a whole new language, follow [`docs/i18n/ADDING_A_NEW_LANGUAGE.md`](docs/i18n/ADDING_A_NEW_LANGUAGE.md).

Open a **focused PR per theme** (storage vs. i18n vs. collaboration) to keep review manageable.

---

## Pull Request Process

1. Fork the repository and create a feature branch
2. Write or update tests for your changes
3. Run the sequential local gate: `pnpm run ci:prepush` (and the optional targeted `pnpm exec vitest run <path>` when useful).
4. Let CI run the full lint and test suite; it is authoritative for the heavy tier.
5. Ensure the build succeeds when build-affecting files changed; GitHub Actions runs the canonical build gate for every PR.
6. Submit a PR against `main` with a clear description
7. Request review from at least one maintainer

The CI pipeline will automatically run lint, i18n check, typecheck, tests, and build on every PR.

---

## How to Add a New AI Provider

WorldScript Studio uses a multi-provider AI architecture. To add a new provider (e.g., Ollama, OpenAI):

### 1. Create the Service

Create `services/yourProviderService.ts` following the pattern in `geminiService.ts`:

```typescript
// services/ollamaService.ts
export const generateText = async (
  prompt: string,
  creativity: AiCreativity,
  signal?: AbortSignal
): Promise<string> => {
  // Your provider's API call here
};

export const generateJson = async <T>(
  prompt: string,
  creativity: AiCreativity,
  schema: GeminiSchema,
  signal?: AbortSignal
): Promise<T> => {
  // Your provider's structured output call
};
```

### 2. Register in aiProviderService

Update `services/aiProviderService.ts` to include your provider in the registry:

```typescript
import * as ollamaService from './ollamaService';

const providers = {
  gemini: geminiService,
  ollama: ollamaService,
  // Add your provider here
};
```

### 3. Add Settings

Extend `features/settings/settingsSlice.ts` with provider-specific settings, and update `components/SettingsView.tsx` with the UI controls.

### 4. Add Tests

Create `tests/unit/yourProviderService.test.ts` with mocked API calls.

---

## How to Add a New AI Writing Tool

Writing tools appear in the Writer view dropdown. To add a new tool:

### 1. Add the Tool Type

In `types.ts`, add to the `WritingToolType` union (or equivalent):

```typescript
export type WritingToolType = 'continue' | 'improve' | ... | 'yourNewTool';
```

### 2. Add the Prompt

In `services/geminiService.ts`, add a case in `getPrompts()`:

```typescript
case 'yourNewTool':
  return {
    prompt: `Your prompt template with ${params.text}`,
    schema: yourOutputSchema,
  };
```

### 3. Add i18n Keys

Add translation keys to **`locales/en/`** first (reference), then **`locales/de/`** and **`locales/fr/`**, **`locales/es/`**, **`locales/it/`** (or run `node scripts/check-i18n-keys.mjs --fix` and translate):

```json
{
  "tools": {
    "yourNewTool": "Your Tool Name",
    "yourNewToolDescription": "Description of what it does"
  }
}
```

### 4. Wire Up the UI

The tool will automatically appear in `WriterView` if added to the tool list in `hooks/useWriterView.ts`.

---

## License

[MIT](LICENSE)
