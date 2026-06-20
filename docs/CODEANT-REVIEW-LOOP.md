# CodeAnt AI PR Review Correction Loop

> **Canonical, agent-agnostic workflow.** This is the single source of truth for how *every*
> agent (Claude Code, Kimi, Cursor, Copilot, Gemini, human) handles inline PR review comments on
> this repository — from CodeAnt AI **and any other reviewer or bot**. All instruction files
> (`CLAUDE.md`, `AGENTS.md`, `KIMI-INSTRUCT.md`, `.cursorrules`, `.github/copilot-instructions.md`)
> point here. Keep this file current when the workflow or tooling changes.

## 0. When this runs — proactively, automatically, every PR

This loop is a **standing rule**, not something to wait for the user to request. The moment there
is an open PR with inline review comments, run the loop **without being asked**. It applies to
**every** open PR and **every** reviewer/bot (CodeAnt AI, CodeQL, Socket, GitGuardian, human
reviewers). The goal state is always the same: **0 unresolved review threads** and **0 new
comments on the latest review pass**, with green CI.

## 1. The Iron Rule — loop until quiescent

**The correction loop does not stop after one pass.** A push that fixes comments triggers a *fresh*
CodeAnt review, which routinely surfaces **new** findings caused by the fixes themselves (a "wave").
Each wave is handled exactly like the first.

> **Termination condition (BOTH must hold):**
> 1. A freshly-triggered CodeAnt review produces **ZERO new inline comments**, **and**
> 2. **ZERO** review threads are unresolved.
>
> Until both are true, **keep iterating**. Never declare the PR done while new comments are still
> arriving or any thread is open.

```
        ┌─────────────────────────────────────────────┐
        │ 1. Fetch unresolved threads (GraphQL)        │
        │ 2. Validate each against CURRENT code        │
        │ 3. Fix root cause  OR  justify (false +ve)   │
        │ 4. Update tests + i18n + docs (lockstep)     │
        │ 5. lint + typecheck + targeted vitest green  │
        │ 6. Commit + push (one wave = one commit)     │
        │ 7. Reply to every thread (cite commit) +     │
        │    resolve it → 0 unresolved                 │
        │ 8. Re-trigger: `@codeant-ai review`          │
        └───────────────┬─────────────────────────────┘
                        │ new comments?
              ┌── yes ──┘         └── no ──┐
              ▼                            ▼
        (next wave, go to 1)        DONE → merge when CI green
```

## 1a. Keep every PR under the ~100-file review limit (split when needed)

**CodeAnt does not post inline review comments on a PR that exceeds ~100 changed files** — the
large-diff check hangs/skips, so the whole correction loop above silently never starts. This repo
hits the limit easily: any user-facing string change fans out across **17 locale source files +
17 rebuilt `public/locales/**/bundle.json`** *per module touched*, so a multi-feature branch can
cross 100 files from i18n alone.

**Procedure (do this BEFORE opening the PR):**

1. Count the footprint: `git diff --name-only <base>...HEAD | wc -l`. Break it down with
   `... | grep -c '^locales/'` and `... | grep -c bundle.json` to see how much is i18n fan-out.
2. If it is **over ~100**, split into the **fewest** stacked PRs that each stay clearly under the
   limit. Group by **which locale module-files each batch touches** (e.g. one batch that only edits
   `writer.json`, another that only edits `common.json`/`dashboard.json`) so the per-PR fan-out is
   minimized. Keep commits **atomic per concern** so the split is a clean branch operation, not a
   re-edit.
3. **Stack** them: PR1 base = `main`; PR2 base = **PR1's branch**. GitHub then shows PR2 only its
   *incremental* diff (what CodeAnt counts), and PR2 auto-retargets to `main` when PR1 merges.
   Run the loop on PR1 to quiescence + merge first, then PR2.
4. **Do not over-split.** If the whole change fits under ~100 in one (or two) PRs, use that — extra
   PRs are extra review loops and CI runs. One or two is the target, never "one PR per file group"
   for its own sake.

Quick split recipe (current branch already has atomic per-concern commits):

```bash
git diff --name-only main...HEAD | wc -l        # >100? split.
git branch <pr1-branch> <sha-of-last-PR1-commit> # PR1 = main..that commit
git branch -m <current> <pr2-branch>             # PR2 continues, base = <pr1-branch>
# push both; gh pr create --base main --head <pr1-branch>
#            gh pr create --base <pr1-branch> --head <pr2-branch>
```

## 2. Fetch unresolved threads

Use GraphQL — REST does not expose thread resolution state. Use a **multi-line** query string
(single-line inline queries can misparse in some shells):

```bash
gh api graphql -f query='
query {
  repository(owner:"qnbs", name:"WorldScript-Studio") {
    pullRequest(number: PR_NUMBER) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { databaseId author { login } createdAt body } }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[]
  | select(.isResolved==false)
  | "THREAD \(.id) | \(.path):\(.line) | id=\(.comments.nodes[0].databaseId) @\(.comments.nodes[0].author.login)"'
```

Keep the **`databaseId`** (REST comment id → for replies) and the thread **`id`** (`PRRT_…` →
for `resolveReviewThread`) paired for each finding.

## 3. Validate, then fix or justify

For **each** finding:

- **Validate against the *current* code** — line anchors are often stale; the issue may already be
  fixed or may have moved.
- **If valid →** implement the **real root-cause fix** (not a suppression, not a band-aid). Fix
  *everything that belongs to it*: code **+ tests + i18n + docs**.
- **If a false positive / by-design →** reply with **evidence** (cite the rule, the established
  pattern, the doc) explaining why no change is made. A reasoned dismissal is a valid resolution.
- **No scope creep** — address the finding, not unrelated features.

### 3a. Suppression ratchet — never add a new `biome-ignore`

CI enforces a **suppression ratchet** (`scripts/check-suppressions.mjs`, baseline count). Adding a
new `// biome-ignore` **raises the count and fails the quality gate**. So:

- **Do not** "fix" a lint finding by suppressing it. Refactor so the rule passes honestly.
- After any change, run `node scripts/check-suppressions.mjs` — must print `[suppressions] OK`.
- If a suppression is genuinely unavoidable, it must be a single-line `// biome-ignore <rule>: <reason>`
  **immediately** above the node (a two-line comment breaks the association → "suppression has no
  effect" warning), and the baseline in the ratchet must be updated in the same PR with justification.

## 4. Local quality gate (low-end hardware — sequential, never parallel)

Run **one** heavy command per step; never run vitest/biome/tsgo/vite concurrently (OOM).

```bash
node scripts/check-suppressions.mjs            # [suppressions] OK
pnpm run lint                                  # biome --error-on-warnings → 0
pnpm run typecheck                             # tsgo → 0
pnpm run i18n:check                            # only if user-facing strings changed
pnpm exec vitest run <affected test files>     # targeted, not the whole suite
```

Coverage, E2E, Lighthouse, Stryker, Storybook are **CI-only** — do not run locally.

## 5. Commit & push (one wave = one commit)

Conventional Commits; describe each finding fixed. The pre-commit hook runs `lint-staged` + Biome.

```bash
git add -A
git commit -m "refactor(scope): address CodeAnt wave N review feedback"
git push origin <feature-branch>
```

End commit messages with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## 6. Reply to every thread, then resolve it → 0 unresolved

Reply via REST (cite the resolving commit SHA), then resolve via GraphQL.

```bash
# Reply (one per handled comment) — use the comment databaseId
gh api -X POST "repos/qnbs/WorldScript-Studio/pulls/PR_NUMBER/comments/COMMENT_DB_ID/replies" \
  -f body="✅ Fixed in <short-sha>. <one-line what+why>."

# Resolve the thread — use the PRRT_… thread id
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_…"}) { thread { isResolved } } }'
```

Leave **0 unresolved**. Every handled thread gets a reply (fix → cite commit; false-positive →
cite evidence) **and** is resolved.

## 7. Re-trigger the review — then loop

After all threads are resolved and the wave is pushed:

```bash
gh pr comment PR_NUMBER --body "@codeant-ai review"
```

A push usually auto-triggers CodeAnt; the explicit comment is belt-and-suspenders. **Wait for the
fresh review**, then go back to step 2. Repeat until the **termination condition** in §1 holds.

## 8. Merge

Once the loop is quiescent (0 new comments + 0 unresolved) **and** CI is fully green:

- Prefer **auto-merge (squash)**: `gh pr merge PR_NUMBER --auto --squash --delete-branch`.
- If branch protection leaves the PR `BLOCKED` despite green required checks and 0 required
  approvals (a known state here), an **admin squash-merge** is acceptable **only after** CI is
  green and the loop is quiescent: `gh pr merge PR_NUMBER --squash --admin --delete-branch`.
- **Never** admin-merge a PR whose CI is still running or red — that defeats the gate.

## 9. Branch housekeeping (after merges)

GitHub auto-deletes head branches on merge here. Periodically prune stale local/remote-tracking
refs and delete redundant branches (e.g. a `release/x` branch already captured by a tag):

```bash
git fetch --prune
git branch -vv                # find branches whose upstream is "[gone]"
```

---

### Quick reference — IDs

| Purpose | Identifier | Source |
|---------|-----------|--------|
| Reply to a comment (REST) | `databaseId` (numeric) | `comments.nodes[0].databaseId` |
| Resolve a thread (GraphQL) | `id` (`PRRT_…`) | `reviewThreads.nodes[].id` |

**Owner/repo:** `qnbs` / `WorldScript-Studio`.
