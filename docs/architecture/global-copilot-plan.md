# Global AI Copilot — Implementation Plan

Status: **implemented** (v1.21 cycle). Feature flag: `enableGlobalCopilot` (default on).

A beginner-friendly, context-aware, **local-first** in-app live assistant. It is the first in-process
consumer of the ProForge **Core Capability Layer** (`services/proForge/proForgeCapabilityLayer.ts`),
so chat help and real ProForge actions share one code path.

## Architecture

```
CopilotLauncher (FAB, App.tsx, flag-gated)
   └─ useGlobalCopilot(currentView)
        ├─ copilotContextService  → context-aware system prompt (current view + project)
        ├─ useStoryCraftAI        → streaming chat (honours assertCloudAiAllowed → privacy)
        ├─ copilotActions         → ProForge bridge (runStage 'intake') + command executor
        └─ copilotSlice           → ephemeral chat state (root key `copilot`, not persisted)
```

## Tasks

- [x] **Discovery** — searched for existing assistant/chat traces (none found; reused
      `useStoryCraftAI`, `CommandExecutorContext`, `transientUiStore` patterns).
- [x] **Feature flag** `enableGlobalCopilot` — slice field + default + setter + selector
      (`features/featureFlags/featureFlagsSlice.ts`); UI toggle (`FeatureFlagsSection.tsx`);
      `handleSettingChange` case (`useSettingsView.ts`); i18n label (all 11 locales);
      parity audit → 0 drifts; E2E matrix entry + all `FeatureFlagsState` test mocks updated.
- [x] **State** `features/copilot/copilotSlice.ts` (ephemeral, NOT undo-wrapped); registered in
      `app/store.ts` under root key `copilot`.
- [x] **Context-awareness** `services/copilot/copilotContextService.ts` — pure system-prompt builder
      from `currentView` (+ `viewNavigationLabels`), project title/word-count, UI language.
- [x] **ProForge bridge** `services/copilot/copilotActions.ts` — intent detection + `runCopilotDiagnostic`
      via the Core Capability Layer (`createBrowserProForgeCapability` → `runStage('intake')`).
- [x] **Hook** `hooks/useGlobalCopilot.ts` — streams replies, appends messages, diagnostic shortcut,
      open/close/clear; gated on `enableGlobalCopilot` at the mount site.
- [x] **UI** `components/copilot/` — `CopilotLauncher` (FAB, WCAG: aria-label/expanded/focus-ring),
      `CopilotPanel` (focus-trapped dialog, Escape-to-close, live-region announce, `--sc-*` tokens),
      `CopilotMessageList`, `CopilotComposer` (Enter sends, Shift+Enter newline).
- [x] **Mount** in `App.tsx` (lazy, inside main shell, `ErrorBoundary` + `Suspense`, flag-gated,
      `currentView` passed for context-awareness).
- [x] **i18n** — `locales/<lang>/copilot.json` (en + de translated; others English fallback via
      `check-i18n-keys --fix`); registered `copilot` module in build/check scripts; bundles rebuilt.
- [x] **Tests** — `tests/unit/copilot/{copilotSlice,copilotContextService,copilotActions}.test.ts`
      (16 tests) + `tests/e2e/copilot-flags.spec.ts` (launcher visible/opens; hidden when off).

## Privacy & safety

- No new persistence: chat lives in memory only (`copilot` slice is ephemeral, not in localStorage/IDB).
- Cloud AI flows through `useStoryCraftAI` → `storyCraftCompletionFetch`, which enforces
  `assertCloudAiAllowed` (respects `settings.privacy.localStorageOnly`).
- The whole feature is behind `enableGlobalCopilot`; disabling it removes the launcher entirely.
