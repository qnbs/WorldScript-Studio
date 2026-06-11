# Global AI Copilot

StoryCraft Studio's Global AI Copilot is an always-present ambient-intelligence layer that surfaces proactive manuscript insights and lets you chat with an AI writing assistant — all without leaving the editor.

## Enabling

Settings → Experimental → **Enable Global AI Copilot** (`enableGlobalCopilot`). On by default.

## Opening the panel

Click the **✦ AI Copilot** FAB in the bottom-right corner (or press the registered keyboard shortcut). The panel can run in two modes:

| Mode | Description |
|------|-------------|
| **Dialog** (default) | Floating panel above the page content, bottom-right |
| **Sidebar** | Fixed right edge, full viewport height (desktop ≥ 768 px only) |

Toggle between modes with the dock/float icon in the panel header. The preference is saved in `localStorage` (`copilot.mode`).

## Proactive insights

The Copilot continuously analyses your project with the [Heuristic Engine](./HEURISTIC-RULES.md) and surfaces findings in the **Manuscript Insights** section of the panel (collapsed by default). Findings are colour-coded by severity:

- 🔵 **Info** — suggestions for improvement
- 🟡 **Warning** — patterns that commonly weaken manuscripts
- 🔴 **Error** — structural issues likely to confuse readers

Clicking an insight's **Tell me more** button pre-fills the chat with a context-aware question. Clicking **Open view** navigates directly to the relevant editor view.

Clicking an **inline annotation badge** in the manuscript editor opens the panel *and* auto-expands the Insights section so you immediately see the relevant findings.

## Heuristics-Only mode

Toggle the **Heuristics Only** switch (brain icon in the panel header) to disable all AI calls. In this mode the Copilot replies using only the local heuristic engine — useful when you want to keep data on-device or have no API key configured.

## Chatting with the Copilot

The Copilot is context-aware: it knows the current view, your project title, word count, character and world counts, and outline completeness. The system prompt is rebuilt on every message so suggestions stay relevant as you navigate.

Dynamic suggestion pills adapt to your current view and project state (e.g. Plot Board shows tension-gap suggestions; Manuscript with >500 words shows pacing and opening suggestions).

### ProForge integration

When the **ProForge** flag is also enabled, typing a phrase like *"run a diagnostic"* triggers the ProForge Intake stage and returns a quality score summary. Each review item in the ProForge Review Panel also has an **✦ Ask Copilot** chip that pre-fills the chat with the item's context.

## Apply to chapter

When the last assistant message contains a fenced code block and a manuscript chapter is open, an **Apply to chapter** button appears. Clicking it rewrites the active chapter content with the code-block text — undoable via **Ctrl+Z** (action dispatched into redux-undo). The button is only shown when the block covers ≥ 70 % of the existing chapter length to prevent accidental overwrites from partial snippets.

## Architecture overview

```
CopilotLauncher.tsx          FAB + panel mount
  └── CopilotPanel.tsx       dialog/sidebar shell, focus trap, mode toggle
        ├── InsightSection.tsx      heuristic findings, collapsed by default
        │     └── InsightCard.tsx  per-finding card with Tell me more / Open view
        ├── CopilotMessageList.tsx  conversation transcript, markdown rendering
        └── CopilotComposer.tsx     textarea + send button, draft pre-fill

hooks/useGlobalCopilot.ts    all business logic (insights, streaming, apply)
services/copilot/
  heuristicEngine.ts         8 built-in rules, pure TypeScript
  insightGenerator.ts        400 ms debounce, LRU cache (10 entries)
  copilotContextService.ts   system prompt + CopilotContext builder
  copilotActions.ts          intent detection (chat vs. diagnostic)
  actionApplier.ts           safe manuscript mutation (applyTextEdit)

features/copilot/copilotSlice.ts   ephemeral chat state (Redux)
app/transientUiStore.ts            panel overlay state (Zustand)
```

See [`docs/HEURISTIC-RULES.md`](./HEURISTIC-RULES.md) for the full rule catalogue.
