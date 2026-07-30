# WS Run Log — 2026-07-29 Worker-Generation Consolidation Sprint

Tracks execution of the deferred [ADR-0014](../adr/0014-worker-generation-duplication.md) migration
(F-14 from the CSP/crypto/doc-truth sprint's finding table), completed the same day as `v1.24.2`'s
release. Decision record: [ADR-0015](../adr/0015-worker-generation-consolidation.md).

## Baseline

- **HEAD at start:** `dc14bc09` (`chore: reconcile stale TODO.md entry + add Renovate storybook
  grouping (#285)`), tag `v1.24.2` already published at this point.
- **Plan file:** `.claude/plans/worker-generation-v1-vs-enumerated-fox.md`.
- **Scope handed off from ADR-0014:** target generation v2 (per the repo's own architecture
  framing); 3 named v1 call sites (`services/duckdb/duckdbClient.ts`,
  `services/ai/localNlpService.ts`, `services/ai/localEmbeddingService.ts`); no migration plan or
  timeline beyond "a dedicated migration sprint."

## Execution — 4 stacked PRs

| PR | Branch | Scope | Status at log time |
|---|---|---|---|
| #286 | `feat/worker-v2-parity-gate` | Export v2 `duckdb`/`inference` worker handlers, add handler-level tests exercising real logic (previously untested — zero production callers before this sprint), fix a real OPFS-fallback-signal gap found in the process | **Merged** (squash, `ea879e41`) |
| #287 | `feat/worker-v2-duckdb-migration` | Migrate `duckdbClient.ts` onto WorkerBus v2; delete `workers/duckdbWorker.ts`; add `WorkerBus.terminatePool()`/`hasPool()` | Open, CI green, correction loop quiescent |
| #288 | `feat/worker-v2-embedding-migration` | Migrate `localEmbeddingService.ts`; cap `inference` pool `maxWorkers` at 2 | Open, CI green (after the missing-export incident below) |
| #290 | `feat/worker-v2-nlp-migration` | Migrate `localNlpService.ts`; delete `workers/inference.worker.ts` (v1 fully retired); consolidate a duplicate test file | Open, CI green |

Each PR kept the migrated service's public API stable (adapter pattern) — no consumer call site
outside the 3 named services needed changes across the whole sprint.

## Correction-loop findings (CodeRabbit), all confirmed real and fixed before merge

**PR #286** (2 waves):
1. QNBS-v3 comment-format nitpicks (multi-line → required single bracketed line) — 3 files.
2. **Major:** `initDuckDb()`'s OPFS-unavailable catch block silently swallowed the failure instead
   of surfacing it (v1 had an out-of-band `OPFS_FALLBACK` message; v2 had none). Fixed via the
   existing progress channel.
3. **Major** (second wave, outside-diff-range comment on the PR#286 fix itself): the new
   `opfsConnection?.close()` cleanup could itself reject and abort the fallback path, undoing the
   fix it was part of. Fixed by making cleanup best-effort (its own try/catch).

**PR #287** (1 wave, 4 findings):
1. **Critical:** `handleQuery`/`handleExec` silently dropped `params` — an already-live bug
   breaking `services/ai/telemetryService.ts`'s parameterized `INSERT`. Fixed via DuckDB-WASM
   prepared statements.
2. **Major:** a respawned `duckdb` pool worker had no `connection` (fresh module state after
   `minWorkers:0` idle-termination), failing every query with "DuckDB not initialized." Fixed via
   transparent re-init-and-retry.
3. **Major:** `WorkerBus.terminatePool()` didn't settle tasks already routed to the removed pool —
   their result promises would await forever. Fixed via task→pool tracking + cancellation.
4. **Major:** `ensureDuckDbPool()` assumed a non-null bus always has every pool, so any call after
   `terminatePool('duckdb')` would fail `NO_POOL` permanently. Fixed via `hasPool()` +
   re-registration.

**PR #288 → production incident (not a review-bot finding — a real deployment failure):**
`services/ai/localEmbeddingService.ts` imported `ensureInferencePool` from `workerBusManager.ts`,
which was never actually defined there. Invisible to Vitest (the consumer test mocks the whole
module) and to local `tsgo` typecheck (root cause not fully understood — flagged as a follow-up).
Two consecutive Vercel deployments failed with only a generic error; the first local repro attempt
(`pnpm run build`) misleadingly succeeded because **it is not the command Vercel actually runs**
(`vercel.json`'s `buildCommand` is `pnpm run build:edge`, which sets `DEPLOY_TARGET=edge` and runs
`scripts/sync-deploy-base.mjs` first). Reproducing the *exact* command
(`NODE_OPTIONS=--max-old-space-size=3072 pnpm run build:edge`) immediately surfaced rolldown's
`[MISSING_EXPORT]` error. Fixed by adding `ensureInferencePool()`; verified via a second clean
`build:edge` run before closing out. `vercel.json`'s `git.deploymentEnabled` was briefly set to
`false` mid-investigation (PR #289) and reverted once root-caused — net diff of that PR is a
`TODO.md` incident write-up, no functional change.

## Final verification (this doc's own sprint, PR #291 — docs cleanup)

```bash
$ pnpm exec tsx scripts/audit-feature-parity.ts
=== Summary ===
Total flags: 22
Critical errors: 0
Warnings: 0
✓ Audit passed — all flags consistent
```

- `docs/adr/0015-worker-generation-consolidation.md` — new ADR, supersedes 0014.
- `docs/adr/0014-worker-generation-duplication.md` — status line changed to `Superseded by 0015`
  (body left untouched, per this repo's own "supersede, don't edit history" convention).
- `docs/adr/README.md` — index gained rows 0010–0015 (0010–0014 were pre-existing files missing
  from the index before this sprint; unrelated drift, fixed opportunistically).
- `CLAUDE.md`/`AGENTS.md` — directory map, WorkerBus v2 section, DuckDB section, Known Technical
  Debt all updated; fixed 2 pre-existing doc-truth bugs found while reading the WorkerBus v2 source
  (`WorkerHandlerContext.emitProgress` is a flat function, not `context.progress.emit(...)`; no
  `background` priority tier exists, only `critical > high > normal > low`).
- `TODO.md` — F-14 entry marked done with the PR chain; a genuinely stale "Tag v1.24.2" entry
  (already tagged/released, unrelated to this sprint) also caught and fixed while in the file.
- `AUDIT.md` — F-14 and F-11 (same stale-tag issue) findings updated to resolved.
- `CHANGELOG.md` — `[Unreleased]` section added (Changed/Fixed/Removed) covering the full sprint.

## Known, deliberately unresolved

- **`WorkerBus.runTask()` doesn't enforce `timeoutMs`** — confirmed via inspection (no timer on
  either the bus or worker-side bootstrap rejects a hung task). Pre-existing, not introduced by
  this sprint; scoped out to keep this migration bounded to what ADR-0014 named. Tracked in
  ADR-0015 and `TODO.md`.
- **Why local `tsgo` typecheck didn't catch the missing-export bug** — genuinely unresolved; worth
  a follow-up look at whether a project-reference or cache-behavior gap exists, since it's the kind
  of thing that could mask a real error again.
