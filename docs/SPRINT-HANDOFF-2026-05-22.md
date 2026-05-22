# Sprint Handoff — 2026-05-22

**Branch:** `main` | **Commit:** `e68cb5f` | **Session:** v2.0 Phase 0 Hardening

## Master plan
`/home/pc/.claude/plans/du-bist-claude-4-indexed-chipmunk.md` — full architecture + backlog.

## What was completed today

| Ticket | Description | Status |
|--------|-------------|--------|
| E2E-1 | Collaboration awareness AES-256-GCM encryption in `collaborationService.ts` | ✅ Done |
| DS-5 | Legacy bridge CSS vars removed from `index.css` + consumers migrated | ✅ Done |
| COV-1 | 7 new `plotBoardAiThunks` tests + 3 new `ragPromptAssembly` branch tests | ✅ Done (partial) |
| PERF-0 | `listenerMiddleware.ts` AbortSignal audit — all listeners clean | ✅ Done |

## Next immediate task: DB-1

Add a `verifyEmbeddingColumn()` smoke-test export to `services/duckdb/ragVectorMigration.ts` and a corresponding test in `tests/unit/ragVectorMigration.test.ts` that asserts the `rag_chunks.embedding` column is `FLOAT[384]`.

Pattern to follow:
- `services/duckdb/duckdbClient.ts` — use `duckdbClient.queryAsync()` to check column type
- Mock `duckdbClient` in tests with `{ execAsync: vi.fn(), queryAsync: vi.fn() }` (never real DuckDB-WASM in unit tests)
- Export `verifyEmbeddingColumn(projectId: string): Promise<boolean>` — returns `true` if column exists and is correct type

## Phase 1 backlog (after DB-1)

| Ticket | Description | Effort |
|--------|-------------|--------|
| PRESET-1 | Per-Project AI Creativity Presets — `AiPreset` in `types.ts`, slice actions, UI section, AI service injection | M |
| SYNC-1 | Cloud-Sync stub — `StorageBackend` interface + Cloudflare R2 adapter stub | XL |
| RTL-1 | RTL support foundation — CSS Logical Properties + BiDi context + feature flag | L |
| TOUR-1 | Guided Onboarding Tour — `SpotlightOverlay.tsx` + `useOnboardingTour` hook | M |
| VRT-1 | Visual Regression Testing — Playwright + Argos integration | M |

## Quality gate reminder
Low-end hardware — run serially: `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`
Full coverage is a CI-only job per project policy. Push to trigger CI for coverage metrics.

## Key architectural facts for next session

- **Collaboration E2E:** encrypted awareness format is `{ __enc: base64(IV+ciphertext) }` in y-webrtc awareness state; `_decryptedUsers` cache in `collaborationService.ts` bridges async decryption with sync `getConnectedUsers()`. See commit e68cb5f.
- **DS-5 done:** Only intentional aliases remain in bridge block: `--border-interactive`, `--ring-focus`, `--nav-*`, `--glass-*`, `--background-gradient-overlay-start`, `--card-gradient-overlay`. Do not remove these.
- **Token system:** All UI uses `--sc-*` semantic tokens. NEVER use `dark:` Tailwind prefix. NEVER add new bridge vars.
- **Feature flags:** All new experimental features start behind a flag in `featureFlagsSlice.ts`.
- **i18n:** Every new user-facing string needs all 5 locales (de/en/es/fr/it). Run `pnpm run i18n:check` after adding keys.
