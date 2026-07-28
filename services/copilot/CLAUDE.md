# Global AI Copilot (v2)

Flag: `enableGlobalCopilot`. Redux slice: `features/copilot/copilotSlice.ts` (ephemeral, NOT persisted, NOT undo-wrapped). Hook: `hooks/useGlobalCopilot.ts`. Mount: `App.tsx` (lazy, `ErrorBoundary` + `Suspense`).

**Services (`services/copilot/`):**
- `copilotContextService.ts` — pure system-prompt builder from current view + project metadata
- `insightGenerator.ts` — debounced heuristic analysis; result LRU-cached per section
- `heuristicEngine.ts` — 8 built-in manuscript rules (tension-drop, underdeveloped-character, open-loop, slow-pacing, high-repetition, plot-hole, missing-world-context, overlength-scene); zero network calls
- `actionApplier.ts` — `applyTextEdit(sectionId, newText)`: offset-safe rewrite dispatched into redux-undo; only runs when block ≥ 70 % of section length

**UI (`components/copilot/`):** `CopilotPanel` (dialog/sidebar toggle, persisted to `localStorage`), `CopilotMessageList` (DOMPurify + micro-markdown renderer — no new runtime dep), `InlineAnnotationLayer` (badge inside `ManuscriptEditor`), `CopilotComposer`. ProForge: each `ReviewItemCard` has an ✦ Ask Copilot chip (pre-fills composer with review-item context).

Docs: `docs/COPILOT.md` (feature guide), `docs/HEURISTIC-RULES.md` (8 rules catalogue).
