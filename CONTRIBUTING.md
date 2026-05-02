# Contributing to StoryCraft Studio

Thank you for your interest in contributing to StoryCraft Studio — an AI-powered creative writing studio built with React, Redux Toolkit, and the Gemini API.

## Table of Contents

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

## Development Setup

### Prerequisites

- **Node.js** ≥ 22 (see [`.nvmrc`](.nvmrc); matches `engines` in [`package.json`](package.json))
- **pnpm** ≥ 10 (see `packageManager` in `package.json`; Corepack: `corepack enable`)
- A **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/app/apikey) (optional if using **Ollama** in the desktop app only)

### Installation

```bash
git clone https://github.com/qnbs/StoryCraft-Studio.git
cd StoryCraft-Studio
pnpm install
```

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
| AI        | Gemini (`@google/genai`), OpenAI, Ollama via `aiProviderService.ts` |
| Storage   | IndexedDB (`dbService`) / Tauri filesystem (`fileSystemService`)   |
| Build     | Vite 8 + vite-plugin-pwa                                     |
| Lint      | Biome (`pnpm run lint` / `lint:fix`)                         |
| Tests     | Vitest + Testing Library + Playwright                        |
| Desktop   | Tauri 2 (optional)                                           |
| Storybook | Storybook 10 with `@storybook/react-vite`                    |

---

## Project Structure

```
StoryCraft-Studio/
├── app/              # Redux store, hooks, listenerMiddleware
├── components/       # React UI components
│   └── ui/           # Primitive design-system components (Button, Card, Modal…)
├── contexts/         # React contexts for each view
├── features/         # Redux slices (project, settings, writer, status)
├── hooks/            # Custom React hooks per view + shared hooks
├── locales/          # i18n source JSON (de, en; fr/es/it files reserved)
├── services/         # Adapters: Gemini, Ollama, DB, storage, collaboration, EPUB…
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

### Unit Tests (Vitest)

```bash
pnpm run test         # Run in watch mode
pnpm run test:run     # Run once (CI mode)
pnpm run test:coverage  # With coverage report
```

### Local CI Simulation

You can simulate the GitHub Actions pipeline locally using [Act](https://github.com/nektos/act). This is especially useful for testing workflow logic and environment-specific behavior before opening a PR.

```bash
npm install -g act
act pull_request --job security --job quality
```

Build, E2E, Storybook, and Lighthouse (artifact-dependent steps) may need extra Act configuration:

```bash
act push --job build --job e2e --job storybook --job lighthouse
```

If you need Codecov support locally, export the token first:

```bash
export CODECOV_TOKEN="your_token_here"
act pull_request -s CODECOV_TOKEN=${CODECOV_TOKEN}
```

Tests live in `tests/unit/`. Each UI component and core hook should have a test file.

### E2E Tests (Playwright)

CI sets `CI=true` (required by `package.json` scripts). Locally:

```bash
pnpm run dev          # Optional: dev server for manual exploration
$env:CI='true'; pnpm run test:e2e    # PowerShell
# CI=true pnpm run test:e2e         # bash
$env:CI='true'; pnpm run test:e2e:ui
```

Tests live in `tests/e2e/`. Playwright tests verify core user flows:

- Navigation between views
- Export functionality
- Keyboard accessibility
- Mobile viewport behavior

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

The project follows WCAG 2.1 AA guidelines:

- All interactive elements have `aria-label` or accessible text
- Dialog/Modal components use `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- AI responses use `aria-live="polite"` regions for screen-reader announcements
- Scene Board drag-and-drop uses `role="list"` with accessible instructions
- Keyboard navigation works throughout (Tab, Enter, Escape, Arrow keys)

When adding new components:

- Use semantic HTML elements where possible
- Provide `aria-label` for icon-only buttons
- Test with a screen reader (NVDA/VoiceOver) before submitting

---

## Security Guidelines

- **CSP**: `index.html` contains a `Content-Security-Policy` meta tag restricting resource origins
- **API keys**: Never hardcode API keys; always use the encrypted IndexedDB storage
- **AbortController**: All Gemini API calls support cancellation via `AbortSignal`
- **Rate limiting**: `geminiService.ts` handles 429 errors with exponential backoff
- **Input sanitization**: User input displayed in HTML contexts uses `esc()` helpers

---

## Known Technical Debt

Authoritative list: [`AUDIT.md`](AUDIT.md) and [`TODO.md`](TODO.md). Short pointers:

1. **`StorageBackend` contract** — implement `services/storageBackend.ts` on both backends; use `storageService` in UI (not `dbService` directly) so Tauri and browser stay consistent.
2. **`app/listenerMiddleware.ts`** — occasional TypeScript friction with `redux-undo`'s `StateWithHistory` (typed carefully at boundaries).
3. **Collaboration** — optional configurable signaling URL; E2E encryption deferred (roadmap).
4. **i18n** — All five locale trees must share the same keys as English (`pnpm run i18n:check`). The in-app selector currently exposes **de** and **en** (see README); FR/ES/IT strings may still mirror EN until translated.

Open a **focused PR per theme** (storage vs. i18n vs. collaboration) to keep review manageable.

---

## Pull Request Process

1. Fork the repository and create a feature branch
2. Write or update tests for your changes
3. Run the full test suite: `pnpm run test:run`
4. Ensure Biome passes: `pnpm run lint`
5. Ensure i18n parity: `pnpm run i18n:check`
6. Ensure types compile: `pnpm run typecheck`
7. Ensure the build succeeds: `pnpm run build`
8. Submit a PR against `main` with a clear description
9. Request review from at least one maintainer

The CI pipeline will automatically run lint, i18n check, typecheck, tests, and build on every PR.

---

## How to Add a New AI Provider

StoryCraft Studio uses a multi-provider AI architecture. To add a new provider (e.g., Ollama, OpenAI):

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

Add translation keys at least to **`locales/de/`** and **`locales/en/`** (and mirror to `fr`/`es`/`it` when those locales are re-enabled in the selector):

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
