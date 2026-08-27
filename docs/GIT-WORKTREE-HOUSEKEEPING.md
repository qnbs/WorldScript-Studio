# Git worktree & local branch housekeeping

This repo's development pattern — one `git worktree` per feature/fix/investigation branch,
sometimes dozens deep across a long multi-session program — accumulates local state that
`git fetch`/`git pull` never cleans up on its own. This doc explains the recurring failure mode
it causes, how to diagnose it safely, and the exact commands used to fix it (verified against
this repo's real state on 2026-08-27/28, when this doc was written after a 14→2 worktree and
78→14 local-branch cleanup).

## The recurring symptom

```
$ gh pr merge <N> --squash --delete-branch
failed to run git: fatal: 'main' is already used by worktree at '/path/to/.worktrees/<name>'
```

**Root cause:** `gh pr merge` (like several git plumbing operations) tries to update the local
`refs/heads/main` ref after merging. Git refuses if `main` is *currently checked out* in any
worktree other than the one you're running the command from — and a worktree can be left on
`main` (instead of a feature branch) indefinitely if it was used for one-off release-prep or
inspection work and never switched off before being abandoned.

**This is not a git bug and not something to route around every time.** `gh pr merge`'s own
remote-side merge on GitHub *always succeeds* despite this error — verify with
`gh pr view <N> --json state,mergedAt,mergeCommit` — but leaving the root cause in place means
every future merge attempt from every worktree hits the same wall.

**The durable fix:** find and remove (or repoint) whichever worktree holds `main`.

```bash
git worktree list                      # find the one showing `[main]`
git -C <path-to-that-worktree> status --porcelain=v2 -b   # confirm it's safe (see below)
git worktree remove <path>              # or --force if git complains about a clean-but-flagged tree
```

After removal, the bare repo's own `refs/heads/main` is very likely stale too (nothing was
updating it while a worktree held it hostage) — fast-forward it once no worktree references it:

```bash
git fetch origin main
git merge-base --is-ancestor refs/heads/main refs/remotes/origin/main && \
  git update-ref refs/heads/main refs/remotes/origin/main
```

## Before removing *any* worktree: prove it's safe

Never remove a worktree — or delete the branch it points at — without checking both of these
first. A worktree removal only deletes the *checkout*; the branch ref (and its commits) survive
until you explicitly delete the branch too, so the two checks below matter most before that
second step:

```bash
# 1. Uncommitted changes?
git -C <worktree-path> status --porcelain=v2 -b
# non-empty output (beyond the branch.* lines) = STOP, something is mid-edit

# 2. Unique commits never pushed/merged anywhere?
git -C <worktree-path> rev-list --count origin/main..<branch>
# > 0 means real, potentially unrecoverable-elsewhere work exists on this branch
```

A worktree/branch is safe to remove only when **both** come back clean: no uncommitted diff, and
either zero unique commits *or* every commit is reachable via a real PR (see below).

## Cross-referencing branches against real PR history

Linear `git merge-base --is-ancestor <branch> origin/main` **under-counts** in any repo using
squash-merge (this one does) — a squash-merged PR's original commits are never literal ancestors
of `main`, since squashing creates one new commit with a different SHA. The correct signal is
GitHub's own PR state, not git ancestry:

```bash
gh pr list --state all --limit 1000 --json headRefName,state,number \
  --jq '.[] | "\(.headRefName)\t\(.state)\t#\(.number)"' | sort > /tmp/pr-heads.tsv

for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  match=$(awk -F'\t' -v b="$b" '$1==b {print $2, $3}' /tmp/pr-heads.tsv)
  echo "$b -> ${match:-NO PR FOUND}"
done
```

This sorts every local branch into three buckets:

- **`MERGED #N`** — content is permanently preserved in `main`'s history via the merge commit,
  *regardless* of whether the local branch ref still exists. Safe to delete locally and
  remotely.
- **`CLOSED #N`** (never merged) — the branch was a deliberately abandoned approach (superseded,
  rejected, or replaced by a later PR). The work exists **only** on that branch (+ its remote
  copy, if pushed). Delete the *local* copy freely (git history/reflog covers the 90-day default
  recovery window even after that); leave the **remote** copy alone unless you're certain nobody
  needs to reference it — remote branch deletion is visible to every collaborator and harder to
  casually undo.
- **No PR at all** — this is the dangerous bucket. It means the branch's commits (if any exist
  beyond `origin/main`) were never reviewed or landed anywhere. **Always** run the
  `rev-list --count` check from the previous section before touching these. A branch with zero
  unique commits (e.g. a disposable diagnostic branch created to isolate a bug) is trivially
  safe; a branch with real commits is exactly the kind of undocumented work-in-progress this repo's
  own safety principles say to preserve, not guess about.

## Categories to never touch without explicit instruction

Regardless of merge status, leave these alone during routine housekeeping — they're deliberately
preserved, not forgotten:

- **`archive/*`** — explicit historical preservation (e.g. `archive/pr477-pre-rewrite-<sha>`).
- **`backup/*`** — safety-net snapshots created during past incidents or risky rewrites (e.g.
  `backup/signing-hardening-contaminated-<sha>`, `backup/pr491-recovery-<date>-<sha>`). These
  exist *specifically* to survive housekeeping sweeps.
- **`release/vX.Y.Z`** marker branches — even when their PR is merged and the same point is also
  captured by a git tag, treat these as intentional release-history references, not disposable
  feature work.
- Any branch with real unique commits and no PR (see above) — flag it for human review instead of
  guessing whether it's abandoned or still wanted.

## Remote branch cleanup — a narrower bar than local

Deleting a *remote* branch is visible to every collaborator and (outside a short GitHub recovery
window) harder to undo than a local `git branch -D`. Apply a narrower rule than local cleanup:
only delete remote branches with a **confirmed `MERGED` PR** — their content's permanence doesn't
depend on the branch ref surviving.

**Before deleting, always run `git fetch origin --prune` first.** Local `origin/*`
remote-tracking refs are a cache — if you never run a pruning fetch, branches that GitHub already
auto-deleted (via a PR's own `--delete-branch` flag) still show up locally as phantom entries.
Attempting to delete an already-gone ref just wastes a round-trip; pruning first gives an accurate
picture of what genuinely still needs cleanup:

```bash
git fetch origin --prune
git branch -r --format='%(refname:short)' | grep -v '^origin$\|^origin/main$'
# cross-reference the survivors against pr-heads.tsv exactly as above, then:
git push origin --delete <branch1> <branch2> ...
```

**Multi-ref push caveat, confirmed the hard way:** a single `git push origin --delete a b c`
where some refs are stale (already gone) reports per-ref errors but can silently **fail to apply
even the refs that would have succeeded** — the overall command exits non-zero and at least one
genuinely-deletable branch was left untouched despite not appearing in the error list. Always
verify afterward (`gh api repos/<owner>/<repo>/branches/<name>` returns 404 once truly gone), and
retry any survivor as an individual `git push origin --delete <branch>` call.

## `git gc` — real, but hardware-gated

After a large branch-deletion sweep, loose objects accumulate fast (this repo went from ~5,780
loose objects after deleting 60+ branches). `git gc` (non-`--aggressive`) is the right tool, but
**confirmed to exceed a 3-minute timeout on this project's 2-core/~3.7 GB reference low-end
machine** under normal load (load average ~2.9, ~385 MB free RAM at time of testing). Do not run
it interactively as a "quick cleanup" step when hardware is already under load — it will either
time out or contend with whatever else is running.

**If a `git gc` run gets killed mid-repack**, it leaves a genuinely-safe-to-delete artifact behind:

```bash
git count-objects -v
# a "garbage: N" / "size-garbage: N" line means an incomplete temp pack survived the kill
find .git/objects/pack -name 'tmp_pack_*'
rm -f .git/objects/pack/tmp_pack_*     # git's own count-objects already told you this is garbage
```

This is safe because an interrupted `git gc`'s temp pack was never linked into any real ref — it
is by definition unreferenced, incomplete data, not a partially-written *real* object.

**Recommendation:** run `git gc` (never `--aggressive` on this hardware) during a genuinely idle
period — not mid-session, not while other heavy shells (vitest/tsc/vite/build) might run
concurrently, per this repo's standing low-end-hardware shell-execution discipline. A stale-object
backlog is a disk-efficiency concern, not a correctness one — it's fine to defer.

## Quick reference: full housekeeping sweep

```bash
# 1. Inventory
git worktree list
git branch --format='%(refname:short)' | wc -l
git fetch origin --prune
git branch -r --format='%(refname:short)' | wc -l

# 2. Build the PR-state cross-reference (see above)

# 3. Per worktree holding a to-be-deleted branch: status check, then remove
git -C <path> status --porcelain=v2 -b
git worktree remove <path>              # add --force only if you've confirmed clean + safe

# 4. Local branch deletion (MERGED or deliberately-CLOSED, no active worktree, not in the
#    "never touch" categories above)
git branch -D <branch1> <branch2> ...

# 5. Remote branch deletion (MERGED only)
git push origin --delete <branch1> <branch2> ...
# verify: gh api repos/<owner>/<repo>/branches/<branch> should 404 for each

# 6. Loose-object compaction (only when hardware load is genuinely idle)
git count-objects -v
git gc   # NOT --aggressive on this hardware; expect it to take several minutes
```
