# CodeAnt Correction-Loop Runbook (executable)

> Operational, command-level companion to the policy doc
> [`CODEANT-REVIEW-LOOP.md`](CODEANT-REVIEW-LOOP.md). Use this to **run** the loop across one or
> more open PRs in a single combined pass. Captures the live state of the architecture-refactor PRs
> so a later session can resume without re-deriving context.

Repo: `qnbs/WorldScript-Studio` · default branch: `main`.

---

## 0. When to run

Run **after** all planned feature/refactor work for a batch is shipped as open PRs (this is the
deferred final step). The intent for the current effort: a **second plan** will be authored and
executed the same way (more PRs); then run this loop over **every** open PR — this plan's *and* the
next plan's — together.

## 1. The iron rule

Loop until **quiescent**: a fresh CodeAnt review yields **0 new comments** AND **0 unresolved
threads**. Each push triggers a new review wave that often raises new findings; never stop while
comments are still arriving. **Never add a new `biome-ignore`/eslint-disable** to silence a finding —
the suppression ratchet (`scripts/check-suppressions.mjs`) fails the quality gate; refactor instead.

## 2. Per-PR procedure

For each open PR `<N>` (process one PR fully, then the next):

### 2a. Fetch unresolved threads (thread id + comment db id + anchor + body)

```bash
gh api graphql -f query='query { repository(owner:"qnbs",name:"WorldScript-Studio"){
  pullRequest(number:<N>){ reviewThreads(first:100){ nodes {
    id isResolved isOutdated path line
    comments(first:1){ nodes { databaseId author{login} body } } } } } } }' \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) |
        "\(.id) | \(.comments.nodes[0].databaseId) | \(.path):\(.line) | \(.comments.nodes[0].author.login)"'
```

### 2b. For each thread — validate against the CURRENT code (anchors may be stale)

Then either:
- **Fix the root cause fully** — code **+ tests + i18n + docs** in lockstep. Prefer
  behavior-preserving fixes; if a fix changes behavior, make sure that's intended and tested.
- **Or justify** with evidence why it's a false positive / out-of-scope (e.g. pre-existing behavior
  moved verbatim by a pure refactor → track as a follow-up, don't change behavior in that PR).

### 2c. Reply to the thread (cite the resolving commit or the justification)

```bash
gh api repos/qnbs/WorldScript-Studio/pulls/<N>/comments \
  -f body='Fixed in <commit-sha>: <one-line what changed>.' \
  -F in_reply_to=<comment-databaseId>
```

### 2d. Resolve the thread

```bash
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"<THREAD_ID>"}){ thread { isResolved } } }'
```

### 2e. After addressing the batch: verify locally (low-end hardware → one at a time)

```bash
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete && pnpm run typecheck
pnpm run lint
pnpm exec vitest run <changed test files>
```

### 2f. Commit, push, re-trigger

```bash
git commit -m "fix(<area>): address CodeAnt review — <summary>"
git push
gh pr comment <N> --body "@codeant-ai review"
```

### 2g. Loop

Wait for the new review wave, re-run **2a**. Repeat until **0 unresolved AND 0 new**.

## 3. Merge criteria (per PR)

Only when **both**: full CI green (every job — security/quality/build/e2e/lighthouse/storybook, not
just required checks) **AND** the loop is quiescent. Then squash-merge (admin-squash only after CI is
green + loop quiescent). These refactor PRs are independent (mostly disjoint files); P4 adds
`xstate`/`@xstate/react` deps. Merge order doesn't matter except rebase any that drift.

---

## 4. Live state — architecture-refactor batch (snapshot 2026-06-17)

Six open PRs off `main`, all opened CI-green; CodeAnt reviews arriving. The Tauri SW hotfix already
merged to `main` + released as `v1.23.1` (not part of this loop).

| PR | Branch | Scope | Loop status |
|----|--------|-------|-------------|
| #177 | `refactor/project-slice-reducer-modules` | P1 — projectSlice → 12 reducer modules | **In progress** — see §4a |
| #178 | `refactor/command-palette-hook-virtualization` | P2 — `useCommandPalette` + virtualization | Not started (fetch threads) |
| #179 | `refactor/view-layout-extraction` | P3 — ManuscriptView/WriterViewUI layout extraction | Not started |
| #180 | `refactor/proforge-xstate-machine` | P4 — ProForge XState machine (additive core) | Not started |
| #181 | `docs/xstate-hybrid-adr` | P5 — ADR-0009 + machine catalogue (docs) | Not started |
| #182 | `docs/security-drift-housekeeping` | SEC-6/7/8 drift reconciliation (docs) | Not started |

> Plus the **next plan's** PRs (to be created) — include them in the same combined pass.

### 4a. PR #177 — in-progress detail

CI green. CodeAnt posted **5 inline findings**. Commit **`c7638f15`** (pushed) already fixed **3**:
- `storyObjectReducers.updateStoryObject` — id kept immutable (assign then restore) → referential
  integrity for `objectGroups[*].objectIds`.
- `storyObjectReducers.updateObjectGroup` — same, for `storyObjects[*].groupIds`.
- `binderReducers.deleteBinderNode` — visited guard on the recursive subtree collector (cyclic
  parentId chains no longer recurse forever). Tests added in `projectSlice.objects.test.ts` +
  `projectSlice.test.ts`.

**Still TODO for #177** (re-fetch thread ids via 2a — they rotate on re-trigger; these are the
2026-06-17 ids):

1. **Reply + resolve the 3 fixed threads**, citing `c7638f15`:
   - `PRRT_kwDOQOeAgc6KWFoJ` (comment `3431202507`) — storyObjectReducers updateStoryObject id.
   - `PRRT_kwDOQOeAgc6KWFoU` (comment `3431202520`) — storyObjectReducers updateObjectGroup id.
   - `PRRT_kwDOQOeAgc6KWG9O` (comment `3431209957`) — binderReducers cycle guard.
2. **Justify + resolve the 2 remaining** (pre-existing behavior moved verbatim by a zero-behavior
   -change decomposition; track as follow-ups, do not change behavior in this PR):
   - `PRRT_kwDOQOeAgc6KWFoZ` (comment `3431202527`) — `writingAnalyticsReducers.updateWritingGoal`:
     `WritingGoal.id` is optional in the type but the reducer targets by a required id. Reply:
     *in-app goals always carry an id; the optionality is import/type tolerance. Targeting by
     required id is the intended contract and is unchanged from the pre-split reducer — not a
     regression. Tracked as a type-model nuance.*
   - `PRRT_kwDOQOeAgc6KWG9W` (comment `3431209969`) — `plotReducers.removePlotConnectionsForSection`:
     deleting a section's connections leaves stale `subplot.sectionIds`. Reply: *this action's single
     responsibility is connections; cascading section removal into subplot `sectionIds` belongs in
     `deleteManuscriptSection` (a separate, behavior-changing enhancement), out of scope for this
     pure decomposition. Tracked as follow-up FU.* — **Optional upgrade:** if a real fix is wanted,
     add subplot-membership cleanup in `manuscriptReducers.deleteManuscriptSection` (+ test) and the
     plot action, then mark this a true fix instead of a justification.
3. Then push (if any code changed), **re-trigger** (`gh pr comment 177 --body "@codeant-ai review"`),
   and loop until quiescent.

### 4b. PRs #178–#182 — start fresh

For each: run §2a to fetch threads, then §2b–2g. Expected hotspots:
- **#178**: virtualization ↔ ARIA listbox/`aria-activedescendant`; ensure no a11y regression. Custom
  scorer kept intentionally (no fuse.js) — justify if CodeAnt suggests a library.
- **#179**: pure layout extraction; verify no DOM-order/responsive regressions.
- **#180**: additive XState core (not imported by app yet). Watch for "dead code" flags — answer:
  intentionally additive, wired in P4b behind `enableProForgeXState`.
- **#181 / #182**: docs only; mostly link/markdown nits.

---

## 5. One-shot helpers

Count unresolved threads on a PR:
```bash
gh api graphql -f query='query { repository(owner:"qnbs",name:"WorldScript-Studio"){
  pullRequest(number:<N>){ reviewThreads(first:100){ nodes { isResolved } } } } }' \
  --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false)] | length'
```

Check all CI checks on a PR (look for any non-success):
```bash
gh pr checks <N>
```
