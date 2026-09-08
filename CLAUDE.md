# Claude Code project adapter

Claude Code auto-discovers this file. `AGENTS.md` is the canonical repository instruction
source; read it before making changes. This adapter intentionally contains no second project
encyclopedia.

When the task enters PR, CI, review, merge, or Vercel work, load the procedure named by
`AGENTS.md`. For a path-specific task, load the nearest nested `CLAUDE.md` and the matching
`.cursor/rules/*.mdc` rule only when relevant. Cross-directory callers also follow these
verified specialist mappings:

- `hooks/useVoice.ts` → `services/voice/CLAUDE.md`
- `hooks/useGlobalCopilot.ts` → `services/copilot/CLAUDE.md`
- `features/project/thunks/plotBoardAiThunks.ts` → `features/plotBoard/CLAUDE.md`
- Plot Board external callers: `services/plotBoardService.ts`, `hooks/usePlotBoardAi.ts`,
  `components/scene-board/PlotMinimap.tsx` → `features/plotBoard/CLAUDE.md`
- Voice external callers: `hooks/usePushToTalk.ts`, `hooks/useVoiceDictation.ts`,
  `hooks/useVoiceAccessibility.ts`, `components/voice/**/*`,
  `components/settings/VoiceSettingsSection.tsx`, `tests/e2e/mocks/voiceMockEngines.ts`
  → `services/voice/CLAUDE.md`
- Copilot external callers: `features/copilot/copilotSlice.ts`, `components/copilot/**/*`,
  `components/proForge/PipelineReviewPanel.tsx`, `components/manuscript/ManuscriptEditor.tsx`,
  `App.tsx` → `services/copilot/CLAUDE.md`
- ProForge guide applies to `features/proForge/**/*`; external callers:
  `features/proForge/proForgeSlice.ts`, `features/proForge/types.ts`,
  `hooks/useProForgeOrchestrator.ts`, `contexts/ProForgeViewContext.ts`, `components/proForge/**/*`,
  `components/WriterView.tsx`, `components/writing/WriterViewUI.tsx`, `app/storeRef.ts`
  → `services/proForge/CLAUDE.md`
- LoRA external callers: `services/aiProviderService.ts`, `components/settings/LoraAdapterSection.tsx`,
  `components/settings/ProjectAiPresetSection.tsx`, `hooks/useWorldScriptAI.ts`,
  `services/ai/worldScriptCompletionFetch.ts`, `components/lora/**/*`, `hooks/useLoraView.ts`,
  `contexts/LoraViewContext.ts`, `services/lora/**/*` → `features/lora/CLAUDE.md`
- Service integration callers: `features/sceneComments/sceneCommentsSlice.ts`,
  `features/progressTracker/progressTrackerSlice.ts`, `hooks/useLanguageToolCheck.ts`,
  `config/csp-connect-src.json` → `services/CLAUDE.md`
