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
