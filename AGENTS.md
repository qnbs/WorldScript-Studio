# WorldScript Studio — Agent Rules

`AGENTS.md` is the compact repository-wide operational source for coding agents. Keep
non-obvious safety and workflow rules here; load the linked documents only when the task
needs their detail. Dynamic facts belong in `package.json`, `.nvmrc`, scripts, or source.

## Local execution on constrained hardware

- Execute shell work sequentially: one Bash/tool shell call per turn; never start parallel
  heavy processes or background Vitest, Biome, tsgo, Vite, Cargo, Storybook, or build jobs.
- Use Node and pnpm declared by `package.json`/`.nvmrc`; pnpm only. Never use npm or yarn for
  repository dependency operations.
- Before every push, run `pnpm run ci:prepush`. On a new worktree or after dependency/lock
  changes, use `node scripts/dependency-state.mjs reconcile` (or `pnpm run deps:reconcile`),
  never a bare install.
- Local default is the quick gate plus focused `pnpm exec vitest run <path>` when a changed
  behavior has a relevant test. Never run `pnpm test`, an untargeted Vitest wrapper, full
  coverage, Playwright E2E, Stryker, Lighthouse, or Storybook test-runner locally; cloud CI is
  authoritative for those heavy checks.
- The authoritative repository typecheck is `pnpm run typecheck`; a lighter helper is not an
  equivalent gate. Do not launch multiple heavyweight checks concurrently.

## Preserve-first safety and security

- Unknown, malformed, incompatible, or unsupported data is preserved and refused: never
  delete, quarantine, silently normalize, or grant write authority when safety is unproven.
- Treat readable and writable as separate capabilities. Storage, autosave, snapshots,
  backups, auxiliary project files, and migration paths must honor the current authority
  boundary and serialization contract.
- Never commit or expose secrets. Never log keys, IVs, decrypted material, or full manuscript
  payloads; use `services/logger.ts` with sanitized context.
- Do not weaken encryption, CSP, storage boundaries, or privacy gates. AI responses are not
  cached by the service worker; delete only caches proven to be WorldScript-owned under the
  canonical naming scheme.
- Community content remains schema-validated and guarded by `pnpm run content:guard`; new
  network endpoints require the canonical CSP source and runtime privacy gate.

## Codebase traps worth loading early

- `exactOptionalPropertyTypes` is enabled: omit optional properties rather than assigning
  `undefined` unless the type explicitly permits it. Avoid `any` and honor strict checks.
- User-visible copy uses the i18n system. Add keys to canonical `locales/*` sources and run
  the repository i18n generator/check; do not hardcode UI strings or stale locale counts.
- Do not use Tailwind `dark:` classes. Themes are body-class and semantic CSS-token driven.
- `components/ui/**` must remain platform-neutral: do not import `@tauri-apps/api` there;
  use the existing service/platform abstractions.
- New feature flags need the repository’s relevant E2E coverage, but heavy E2E execution is
  CI-only on this machine. Do not invent scattered `if (true)` feature gates.
- For non-trivial TypeScript/TSX/CSS changes, add one short physical-line `QNBS-v3:` rationale
  comment only when the reason is genuinely non-obvious (security, persistence, concurrency,
  native boundary, or compatibility). No QNBS comment is needed for obvious tests, fixtures,
  generated files, locale JSON, or mechanical renames. Config JSON/YAML has no inline comment.
- Do not mutate `ref.current` during render; use an effect. Prefer `user-event` for modeled
  interactions and descriptive names such as `anchor` for download elements.

## Native and storage direction

React/PWA remains the first-class web product. Tauri 2 is transitional; the authoritative
native direction is Rust Core plus Qt 6/Qt Quick. GPUI remains separately gated and CEF is not
a future target. Before native work, read `docs/native/CORE-MIGRATION-LEDGER.md` and the
binding roadmap/ADR; do not copy roadmap prose into agent context.

For persistence, AI, filesystem, or encryption work, inspect the relevant source and the
path-scoped Cursor/nested Claude rule first. Deep references include `docs/CI.md`,
`docs/BEST-PRACTICES.md`, `docs/IDB-ENCRYPTION.md`, and the native ledger.

## PR, review, signing, and merge work

When a task enters commit/push/PR/CI/review/merge work, read and follow
`docs/PR-CI-MERGE-WORKFLOW.md`; do not load that procedure for an unrelated tiny edit.

- Use a feature branch and conventional commits. Never commit directly to `main`.
- Before new history, run `pnpm run signing:doctor` and install hooks with
  `pnpm run hooks:install`. Commits and tags must be normally signed and Git-verified; never
  use `--no-gpg-sign`, `--no-verify`, unsigned temporary history, or force-push.
- Inspect all three review channels: paginated inline threads, top-level issue comments, and
  full review bodies. Validate each finding against current code; fix real correctness,
  security, persistence, or data-integrity issues, or reply with evidence. Resolve inline
  threads and leave no actionable finding. Never add a suppression to silence review.
- Keep PRs comfortably below the repository’s absolute governance tier. Do not self-authorize
  exceptions, weaken the checker, bypass protection, or use an admin merge.
- After a merge, wait for exact resulting-main CI and CodeQL success, then follow
  `docs/VERCEL-PREVIEW-RETENTION-POLICY.md`. Use a dry-run manifest, protect Production/main,
  rollback history, active-PR previews, and uncertain metadata; redact provider secrets and
  creator emails. Do not use project-wide Vercel removal.

## On-demand references

- Product and setup overview: `README.md` and `CONTRIBUTING.md`.
- CI and workflow mechanics: `docs/CI.md` and `docs/PR-CI-MERGE-WORKFLOW.md`.
- Native architecture: `docs/native/CORE-MIGRATION-LEDGER.md` and `docs/adr/0021-qt-gpui-native-desktop-strategy.md`.
- i18n: `scripts/build-i18n.mjs`, `scripts/check-i18n-keys.mjs`, and `.cursor/rules/150-i18n-and-content.mdc`.
- Architecture/dependency investigation: `docs/graphify.md` and `docs/codegraph.md`; use tools on demand.
- Specialist path knowledge lives in `.cursor/rules/*.mdc` and nested `CLAUDE.md` files; do not
  duplicate it here.
