# GitHub Copilot repository adapter

Use `AGENTS.md` as the canonical WorldScript Studio guidance. Load the nearest nested
`CLAUDE.md` or matching `.cursor/rules/*.mdc` only for the paths being changed.

For PR, CI, review, merge, signing, or Vercel work, follow the procedures linked by
`AGENTS.md`: `docs/PR-CI-MERGE-WORKFLOW.md` and
`docs/VERCEL-PREVIEW-RETENTION-POLICY.md`.

Preserve-first storage/security, pnpm-only sequential local execution, i18n parity, semantic
theme tokens, and the UI/Tauri platform boundary remain non-negotiable. Do not duplicate their
implementation details here.
