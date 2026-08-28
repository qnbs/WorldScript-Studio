# CodeAnt AI PR Review Correction Loop

> **Canonical sub-procedure for review-comment reconciliation mechanics** (thread fetch, validate,
> fix/justify, reply, resolve) — for how *every* agent (Claude Code, Kimi, Cursor, Copilot, Gemini,
> human) handles inline PR review comments on this repository, from CodeAnt AI **and any other
> reviewer or bot**. **Overall PR/CI/merge lifecycle authority — including CodeRabbit trigger
> semantics, reviewer states, merge-readiness classification, and merge mechanics — lives in
> [`PR-CI-MERGE-WORKFLOW.md`](PR-CI-MERGE-WORKFLOW.md); this file is a scoped supplement, not a
> competing canonical source.** All instruction files (`CLAUDE.md`, `AGENTS.md`,
> `docs/history/KIMI-INSTRUCT.md`, `.cursorrules`, `.github/copilot-instructions.md`) point here for
> the reconciliation mechanics. Keep this file current when the workflow or tooling changes.
>
> **See also:** [`DEEPSOURCE-REVIEW-LOOP.md`](DEEPSOURCE-REVIEW-LOOP.md) — the complementary,
> token-free static-analysis loop. A PR is "review-quiescent" only when **both** are satisfied.
>
> **Which bot posts inline comments — observed, not fixed by roster (updated 2026-08-28):** in
> practice, **CodeRabbit** is the reviewer most consistently posting inline actionable/nitpick/
> outside-diff-range comments on PRs in this repository — see `PR-CI-MERGE-WORKFLOW.md` for its
> trigger semantics (automatic incremental review is the normal path; `@coderabbitai review`/
> `@coderabbitai full review` are not interchangeable rituals). `CodeAnt AI` may expose five
> CI **status checks** (`CodeAnt - Quality Gates/SAST/SCA/SCR/Test Coverage`) to verify green, and may
> also post a genuine inline review thread (confirmed on PR #538) — inspect its actual current output
> per PR rather than assuming a fixed channel; when it does post a resolvable thread, that thread gets
> the same reply-cite-commit-then-resolve treatment as any other reviewer's thread (§6). Don't assume
> a bot's channel from this note alone — the loop mechanics below apply to
> whichever bot(s) are actually posting comments on a given PR, on whichever channel(s) they actually
> use; check the full review history (not just the latest status) before concluding there's nothing
> to fix.

## 0. When this runs — proactively, automatically, every PR

This loop is a **standing rule**, not something to wait for the user to request. The moment there
is an open PR with inline review comments, run the loop **without being asked**. It applies to
**every** open PR and **every** reviewer/bot (CodeAnt AI, CodeQL, Socket, GitGuardian, human
reviewers). The goal state is the merge-readiness classification in
[`PR-CI-MERGE-WORKFLOW.md`](PR-CI-MERGE-WORKFLOW.md) — in short, `UNRESOLVED_REVIEW_THREADS = 0`
(the only channel with a resolve mutation) **and** no actionable findings remain in top-level issue
comments or review bodies (inspected/dispositioned, not "resolved" — see that doc's three-channel
definitions), with green CI; "0 new comments on the latest review pass" is
**not** an independent blanket requirement, since a reviewer correctly reporting no new incremental
diff on an already-consumed delta is a legitimate terminal state, not a reason to keep waiting.

## 1. The Iron Rule — loop until quiescent

**The correction loop does not stop after one pass.** A push that fixes comments is normally picked
up by automatic incremental review, which routinely surfaces **new** findings caused by the fixes
themselves (a "wave"). Each wave is handled exactly like the first.

> **Termination condition — see `PR-CI-MERGE-WORKFLOW.md`'s merge-readiness classification for the
> full rule.** In short: **ZERO** review threads unresolved, all three review channels checked, and
> either (a) a review of the current delta produced zero new actionable findings, or (b) the current
> delta qualifies as LOW-RISK per that doc's precise condition list (narrow, reconciles known
> findings only, independently inspected, no new executable/security/tooling behavior) — a reviewer
> reporting `NO_NEW_INCREMENTAL_DIFF` on an already-consumed delta is a legitimate terminal state,
> not something to wait out indefinitely.
>
> Until the termination condition holds, **keep iterating**. Never declare the PR done while new
> actionable comments are still arriving or any thread is open.

```text
        ┌─────────────────────────────────────────────┐
        │ 1. Fetch unresolved threads (GraphQL)        │
        │ 2. Validate each against CURRENT code        │
        │ 3. Fix root cause  OR  justify (false +ve)   │
        │ 4. Update tests + i18n + docs (lockstep)     │
        │ 5. suppressions + targeted vitest green      │
        │    (see §4 — full lint/typecheck are CI-owned)│
        │ 6. Commit + push (one wave = one commit)     │
        │ 7. Reply to every thread (cite commit) +     │
        │    resolve it → 0 unresolved                 │
        │ 8. Push auto-triggers incremental review;    │
        │    manual `@coderabbitai review` only if     │
        │    auto-review is paused/inapplicable         │
        └───────────────┬─────────────────────────────┘
                        │ new actionable findings?
              ┌── yes ──┘         └── no / NO_NEW_INCREMENTAL_DIFF ──┐
              ▼                                                     ▼
        (next wave, go to 1)                        DONE → merge per PR-CI-MERGE-WORKFLOW.md
```

## 1a. Keep every PR under the ~100-file review limit (split when needed)

**CodeAnt does not post inline review comments on a PR that exceeds ~100 changed files** — the
large-diff check hangs/skips, so the whole correction loop above silently never starts. This repo
hits the limit easily: any user-facing string change fans out across **19 locale source files +
19 rebuilt `public/locales/**/bundle.json`** *per module touched*, so a multi-feature branch can
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

Use GraphQL — REST does not expose thread resolution state. **A single `first:N` page is not
exhaustive** — a PR with more review threads than the page size will silently hide unresolved ones
past the cutoff, so paginate with `gh api graphql --paginate` (it follows the `pageInfo.hasNextPage`/
`endCursor` + `$endCursor` cursor convention automatically) rather than just raising `first`:

```bash
gh api graphql --paginate \
  -f owner="qnbs" -f name="WorldScript-Studio" -F number=PR_NUMBER \
  -f query='
    query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $endCursor) {
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              comments(first: 1) { nodes { databaseId author { login } createdAt body } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }' --jq '.data.repository.pullRequest.reviewThreads.nodes[]
  | select(.isResolved==false)
  | "THREAD \(.id) | \(.path):\(.line) | id=\(.comments.nodes[0].databaseId) @\(.comments.nodes[0].author.login)"'
```

This matches the canonical exhaustive query in [`PR-CI-MERGE-WORKFLOW.md`](PR-CI-MERGE-WORKFLOW.md)'s
`UNRESOLVED_REVIEW_THREADS` definition — keep both in sync if either changes. Its `comments(first: 1)`
here is intentional and sufficient **only** for extracting the original comment's `databaseId` to
reply into (step 6) — it is not a completeness check. Before treating a thread as already reconciled,
also inspect its full content (including any later reply saying a fix is incomplete) via the second,
flat REST query in `PR-CI-MERGE-WORKFLOW.md`'s `UNRESOLVED_REVIEW_THREADS` section
(`gh api --paginate -X GET .../pulls/PR_NUMBER/comments`) — a `comments(first: 1)` result alone can
hide exactly that kind of follow-up.

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

This repo's canonical local-validation policy lives in [`docs/CI.md`](CI.md) and
[`PR-CI-MERGE-WORKFLOW.md`](PR-CI-MERGE-WORKFLOW.md): `pnpm run ci:prepush` is the required
constrained-hardware admission gate, and full-repository `lint`/`typecheck`/`i18n:check` are
**CI-owned** — not a mandatory step of every correction-loop wave. Run **one** heavy command per
step; never run vitest/biome/tsgo/vite concurrently (OOM).

```bash
node scripts/check-suppressions.mjs            # [suppressions] OK
pnpm run ci:prepush                            # required constrained-hardware gate before every push
pnpm exec vitest run <affected test files>     # only if the wave touched files with relevant tests
```

Developers on more capable hardware MAY additionally run `pnpm run lint` / `pnpm run typecheck` /
`pnpm run i18n:check` locally before pushing, but the low-end policy does not require it — required
GitHub CI remains the unconditional authority for full lint/typecheck/i18n validation regardless of
what ran locally. Coverage, E2E, Lighthouse, Stryker, Storybook are **CI-only** — do not run locally.

## 5. Commit & push (one wave = one commit)

Conventional Commits; describe each finding fixed. The pre-commit hook runs `lint-staged` + Biome.

```bash
git add -A
git commit -m "refactor(scope): address CodeAnt wave N review feedback"
git push origin <feature-branch>
```

End commit messages with the attribution matching whichever agent/model actually made the change, e.g.:

```text
Co-Authored-By: GitHub Copilot (Claude Sonnet 5) <noreply@github.com>
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

## 7. After the wave is pushed — check for review, don't ritualistically re-trigger

A push normally **auto-triggers** CodeRabbit's incremental review on its own. Check the **full
review history** (not just the latest status — a rate-limited latest status can hide an earlier
real review) to see whether it already ran. Post `gh pr comment PR_NUMBER --body "@coderabbitai
review"` only when that history shows automatic review is paused/inapplicable, or CodeRabbit's own
reply says the manual trigger is what applies — see `PR-CI-MERGE-WORKFLOW.md`'s CodeRabbit trigger
semantics for the full rule. Once a review of the current delta lands, go back to step 2. If the
delta was already incrementally consumed and nothing new is coming, that's `NO_NEW_INCREMENTAL_DIFF`
— a legitimate reason to move to the merge-readiness classification in step 8, not a reason to keep
waiting. Repeat until the **termination condition** in §1 holds.

## 8. Merge

Once the termination condition in §1 holds and CI is fully green, apply
[`PR-CI-MERGE-WORKFLOW.md`](PR-CI-MERGE-WORKFLOW.md)'s merge-readiness classification (HIGH-RISK vs.
LOW-RISK final delta) and merge-mechanics ordering rule in full — summarized:

- Enable protected squash **auto-merge** only after this repo's stricter internal criteria (not just
  GitHub's branch-protection floor) are satisfied — use the exact command in
  `PR-CI-MERGE-WORKFLOW.md`'s merge-mechanics paragraph (`--match-head-commit <SHA>`, and
  `--delete-branch` only after that doc's paginated dependent-PR check confirms nothing depends on
  this branch). Not restated here to avoid a second, independently drifting copy of that command.
- If branch protection presents the PR as `BLOCKED` despite green required checks, stop and
  re-read the live head, checks, reviews, protection, rulesets, and check suites. Use a normal
  GitHub policy-enforced merge endpoint only after the exact head is revalidated; there is no
  standing admin-merge fallback in this repository.
- An admin/protection bypass requires a fresh, explicit maintainer authorization for that specific
  incident and is not part of the normal correction loop.

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
