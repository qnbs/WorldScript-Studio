# Cursor Cloud Agent — WorldScript Studio

Operational guide for **Cursor Cloud Agents** working on this repository. Canonical merge,
review, signing, and security policy remain in `AGENTS.md`, `docs/CI.md`, and
`docs/PR-CI-MERGE-WORKFLOW.md`. This document adds Cloud-specific execution truth only.

## Scope

- Linux/Ubuntu Cloud Agent VM (not macOS/Windows packaged runtime proof).
- Git transport via Cursor GitHub integration may work when `gh` API auth does not.
- Cloud Agent commits use Cursor HSM-backed signing; maintainers use repository signing
  hooks — both must pass `pnpm run signing:doctor` in their respective modes.

## Bootstrap (every session)

1. `git fetch origin --prune` and confirm `HEAD` / base for the task.
2. Dependencies: on every **new worktree** (even when `node_modules` already exists from a warm
   snapshot), run `node scripts/dependency-state.mjs reconcile` and `pnpm run deps:verify` when
   lock/workspace changed — **never** bare `pnpm install` as policy bypass.
3. `pnpm run hooks:install` on a fresh worktree before first commit.
4. Session snapshot: `pnpm run cursor:cloud-doctor` when dependencies are installed; if
   `node_modules` is missing, run `node scripts/cursor-cloud-doctor.mjs --json` first (does not
   require pnpm) for Git vs `gh` and deps hints.
5. `pnpm run signing:doctor` before creating signed history.

## PR lifecycle (Cloud)

Matches repository policy; do not wait for CI while the PR stays in **Draft**.

```text
coherent local implementation
→ Draft only if a PR number is required for CHANGELOG/governance
→ Ready for Review immediately
→ CI + semantic review in parallel
→ classify entire review wave (three channels)
→ one correction wave
→ exact-head revalidation + quiescence
→ protected squash merge with match-head-commit
→ resulting-main CI + CodeQL + Vercel Production exact SHA
```

CodeRabbit is configured with `drafts: false` — staying in Draft suppresses automatic review.

## Review semantics

LLM reviewers (CodeRabbit, Codex, CodeAnt semantic, Sourcery, Cubic, …) are **not** merge
authority. States such as `QUOTA_EXHAUSTED`, `RATE_LIMITED`, `NO_SIGNAL`, and `PENDING` are never
“clean”. Deterministic CI/security gates and branch protection are authoritative.

Inspect all three channels before merge: inline threads, top-level issue comments, submitted
review bodies.

## Post-merge (main)

After merging to `main`:

1. Record resulting-main SHA (squash merge commit on `main`, not the PR branch head).
2. Wait for push-triggered **CI / CD** and **CodeQL** on that exact SHA — do not infer from PR-head green.
3. Confirm Vercel **Production** READY on the same SHA (`target=production`, `readyState=READY`).
4. Verify canonical HTTP (`https://worldscript-studio.vercel.app/` — see `constants/brand.ts`).
5. Ordinary mode runs the Vercel preview retention dry-run per
   `docs/VERCEL-PREVIEW-RETENTION-POLICY.md` before dependent engineering waves.
   A declared bounded dependency/toolchain maintenance train defers only that
   Preview housekeeping. Still prove Production READY, canonical HTTP, and
   alias/promotion/rollback sanity, and append the deferred-retention ledger
   entry. The introducing transition may make the pull request that first admits
   the exception the train's first merge when its record is complete before
   merge. A later pull request cannot reuse that transition. A failed
   resulting-main gate aborts the train into ordinary reconciliation. One full
   reconciliation is required before non-train mutation resumes. A separately
   declared release-batched Preview retention mode in that policy may defer
   the same Preview housekeeping until the next sanctioned `v*` release
   reconciliation. Its destructive writer is Codex CLI in the local VS
   Code/Ubuntu environment. Cursor Cloud does not delete Vercel deployments,
   publish a release, or receive release secrets. Per-merge CI/CD, CodeQL,
   Production READY, canonical HTTP, and alias/promotion/rollback checks stay
   mandatory. Gate 7 and the production storage-authority switch stay
   maintainer-gated. The introducing transition is one-time; a later pull
   request cannot reuse that transition. Reaching 14 days or 24 non-protected
   Preview deployments, or provider resource pressure, requires one exceptional
   Codex CLI pass and stops dependent repository mutation until that pass is
   recorded. That pass does not restore per-merge destructive cleanup. Until
   that mode is on `main`,
   ordinary mode still requires the full reconciliation.

## Environment configuration (D1)

| Surface | Baseline decision |
|---------|-------------------|
| `.cursor/environment.json` | **DEFER / DASHBOARD_ONLY** — team uses a saved Personal Cloud environment; repo file absent until a fresh Build proves idempotent install via `dependency-state.mjs reconcile`. |
| `.cursor/hooks.json` | **DO_NOT_ADOPT (yet)** — Git hooks + `ci:prepush` remain merge authority; per-edit hooks must not run heavy gates. |
| `.cursor/mcp.json` | **DO_NOT_ADOPT (yet)** — MCP credentials stay dashboard/team scoped unless a project-safe HTTP MCP is proven. |
| `.cursorignore` | **MISSING_OPTIONAL** — add only with evidence of context-toxic paths; never hide policy or security sources. |

Re-verify official Cursor Cloud docs before committing any `.cursor/*` configuration.

## Secrets and network

- Never log secret values, tokens, or manuscript payloads.
- Do not inject maintainer SSH signing keys into Cloud Agents.
- Prefer Runtime Secrets / OIDC for sensitive integrations; see Cursor security docs.
- Egress: default allow-all on this run — tighten only with an evidence-backed domain matrix.

## Diagnostics

| Command | Purpose |
|---------|---------|
| `pnpm run cursor:cloud-doctor` | Session snapshot (this doc) |
| `node scripts/cursor-cloud-doctor.mjs [--json]` | Same doctor before `node_modules` / pnpm |
| `pnpm run signing:doctor` | Signing + hook policy |
| `pnpm run ci:prepush` | Pre-push admission |
| `pnpm run pr:budget -- --base origin/main` | PR size governance |
| Cursor Cloud MCP `run-info` / `environment-info` | Run/build/egress metadata (no secrets) |

## Platform proof limits

Cloud Agent Linux proof does **not** satisfy macOS/Windows secure-store or packaged desktop
qualification — those remain GitHub platform matrix jobs and Gate 6 artifacts.

## Related Linear owner

Meta/platform modernization: **QNB-193**. Release-critical R-15 work continues under **QNB-168**
and successors; do not cross **Gate 7** (`#925` / QNB-171) without explicit maintainer authorization.

```text
PRODUCTION_AUTHORITY_SWITCH_ALLOWED = NO
```
