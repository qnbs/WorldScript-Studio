# Git worktree & local branch housekeeping

This repo's development pattern — one `git worktree` per feature/fix/investigation branch,
sometimes dozens deep across a long multi-session program — accumulates local state that
`git fetch`/`git pull` never cleans up on its own. This doc explains the recurring failure mode
it causes, how to diagnose it safely, and the exact commands used to fix it (verified against
this repo's real state on 2026-08-27/28, when this doc was written after a 14→2 worktree and
78→14 local-branch cleanup; re-verified and extended 2026-09-23 during a post-#817 cleanup pass
that removed 5 more worktrees and classified 30 local branches — see Revision history at the
end).

## Reading this repo's git output: locale matters

`git status --short --branch` and `git branch -vv` print their relationship words in whatever
locale the shell is configured for — on this machine that's German, not English. Misreading
these strings looks like a normal typo but produces the opposite conclusion (e.g. mistaking
"behind" for "ahead"), so translate before reasoning about any output you see:

| String you may see | Meaning | English equivalent |
|---|---|---|
| `entfernt` | remote-tracking ref has no corresponding remote branch anymore (GitHub already deleted it, e.g. via a PR's own delete-branch) | `gone` |
| `voraus N` | N commits ahead of the compared ref | `ahead N` |
| `hinterher N` | N commits behind the compared ref | `behind N` |
| `## HEAD (kein Branch)` | detached HEAD state | `## HEAD (no branch)` |
| `Bereite Arbeitsverzeichnis vor` / `Aktualisiere Dateien: N%` | `git worktree add`/`checkout` progress output while materializing files | `Preparing worktree` / `Updating files: N%` |

`voraus N, hinterher M` together (e.g. `[origin/main: 2 voraus, 33 hinterher]`) means the branch
diverged from its comparison ref in both directions — it has its own unpushed commits *and*
missed later upstream commits. That combination on a branch with no open PR is a strong signal of
**active, not-yet-submitted local work** — do not delete it under the "no PR found" heuristic
below without first checking `rev-list --count` in both directions.

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

**Third check, easy to skip: has a past session already left a classification?** Before applying
any of the default heuristics below, look for local `*.md` files inside the worktree — ledger,
inventory, reconciliation, or handoff notes a previous session wrote specifically to record why
that dirty state exists and what's safe to do with it. Two real examples found in this repo
(2026-09-23): `.pr747-orchestration-wip-inventory.md` and `.pr747-split-ledger.md` sat in the
*main* worktree's root (not the worktree they described) and explicitly classified each
uncommitted hunk in a different, still-dirty worktree as `SUPERSEDED_BY_759` (safe to discard) or
`DEFER_TO_ORCHESTRATION_RECONCILIATION` (must be redone fresh against current `main`, never
resurrected from the stale diff) — that made a `--force` removal of the dirty worktree fully
auditable instead of a guess. Conversely, `LOCAL-WIP-RECONCILIATION.md` (found inside the
`takeover-convergence-20260912` worktree) pre-classified three *other* worktrees as
`EVIDENCE_ONLY` / `PARTIALLY_VALID`, each with an explicit "Recovery: Worktree, branch, and
handoff bundle" instruction — meaning those three must stay live regardless of what a fresh
MERGED/CLOSED PR lookup alone would suggest, because a deliberate architectural decision is still
pending. **A ledger's explicit disposition always overrides the default heuristics in this doc,
in both directions** — it can pre-clear a removal the default checks alone wouldn't justify, or
block one the default checks alone would otherwise allow.

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
  - **Same-day sibling retry, a common sub-case worth confirming explicitly:** a `CLOSED`
    (unmerged) PR is often not abandonment but an immediate retry under a renamed branch — check
    for a sibling branch name (typically `-v2`, `-corrected`, `-2`, or a later date stamp) whose
    PR **is** `MERGED`, often within hours of the close. Two real examples from this repo
    (2026-09-20): `feat/553-autosave-canonical-wiring-20260920` (PR closed unmerged) was
    immediately superseded by `feat/553-autosave-canonical-wiring-20260920-corrected` (merged the
    same day); `feat/553-universal-ingress-admission` (closed unmerged, twice, under PR numbers
    from two different weeks) was superseded by `feat/553-universal-ingress-admission-v2`
    (merged). Finding the merged sibling turns "probably safe to delete" into "confirmed safe to
    delete" — the content didn't just fail to land, it landed under a different ref.
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

## Worktrees nested inside other worktrees

This repo's actual convention isn't just "one `.worktrees/` directory under the repo root" — a
worktree can itself contain its own `.worktrees/` subdirectory holding further worktrees one
level deeper (e.g. `<repo>/.worktrees/main/.worktrees/<name>`, confirmed 2026-09-23: four
worktrees lived there simultaneously, nested under the canonical `main` worktree rather than
under the repo root). `git worktree list --porcelain` already reports every registered worktree
regardless of nesting depth — it's one flat registry keyed off the shared `.git` directory, not
a directory-tree walk — so nothing is hidden from that command. The thing that *does* need
extra care is the **orphan-directory check**: run it against **every** directory that currently
holds nested worktrees, not just the repo root's own container.

```bash
# repo-root container
find <repo>/.worktrees -mindepth 1 -maxdepth 1 -type d
# any worktree that itself holds nested worktrees (check each one you find in `git worktree list`)
find <repo>/.worktrees/main/.worktrees -mindepth 1 -maxdepth 1 -type d
# cross-reference both listings against `git worktree list --porcelain` paths
```

A directory present on disk but absent from the porcelain listing at *either* level is an orphan
candidate — inspect it (source changes, untracked files, a stray `.git` file) before deleting.

### Detached-HEAD worktrees — a distinct, easy-to-misjudge shape

A worktree can end up on a detached `HEAD` instead of a branch — usually because someone (or a
previous agent session) ran `git checkout origin/main` directly inside it after that worktree's
own feature branch was already merged, intending to "just look at latest," and then never
switched to a real branch or removed the worktree. `git status --short --branch` shows this as
`## HEAD (kein Branch)` / `## HEAD (no branch)` with no branch name at all — easy to skim past.
Diagnose it explicitly rather than assuming:

```bash
git -C <path> symbolic-ref -q HEAD >/dev/null || echo "DETACHED at $(git -C <path> rev-parse HEAD)"
git -C <path> reflog -5              # usually shows the exact `checkout: moving from <branch> to origin/main`
git -C <path> merge-base --is-ancestor <detached-sha> origin/main && echo "plain ancestor of main"
```

If the working tree is clean *and* the detached commit is a plain ancestor of current
`origin/main`, the worktree holds zero unique content regardless of which branch (if any) it used
to be on — safe to remove outright. Confirmed real example (2026-09-23):
`desktop-startup-safe-open-20260922` was detached at an old `origin/main` point corresponding to
a version-bump release commit; its originating branch's PR had already merged, and the reflog
showed the exact `checkout: moving from fix/desktop-startup-safe-open-i18n-20260922 to
origin/main` transition that produced the detached state.

## Running this playbook inside Claude Code: the harness's own permission gate

Both `git worktree remove` (even clean, even without `--force`) and `git branch -D` (even with a
fully evidence-backed justification written out beforehand) can be denied by Claude Code's
auto-mode classifier as generically "dangerous" or "Irreversible Local Destruction," independent
of how much analysis preceded the command — confirmed 2026-09-23, both denials fired on
commands this doc itself would call safe. This is a per-session permission gate, not a signal
that the plan is wrong. **Do not try to route around it with a different tool or a manual
filesystem delete** — that defeats the point of the gate and loses the safety net it provides for
a genuinely destructive slip. Instead: present the full candidate list (worktree paths / branch
names + the one-line justification for each) to the user in one message, get one explicit
approval covering the whole batch, then re-issue the *exact same command* — it succeeds once a
human has approved it in-session.

**Separately, a `git worktree remove` (or a chain of several) can exceed a foreground command's
timeout on this hardware** and get automatically moved to a background task rather than failing —
confirmed 2026-09-23 on a chain of five removals. This is not an error; wait for the completion
notification (or read the task's output file once notified) instead of re-issuing the command or
concluding it hung.

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
# 0. Inventory every worktree container, not just the repo root (nested worktrees exist here —
#    see above) — and read output assuming it may be in German (entfernt/voraus/hinterher).
find <repo>/.worktrees -mindepth 1 -maxdepth 1 -type d
find <repo>/.worktrees/*/.worktrees -mindepth 1 -maxdepth 1 -type d 2>/dev/null

# 1. Inventory
git worktree list --porcelain
git branch --format='%(refname:short)' | wc -l
git fetch origin --prune
git branch -r --format='%(refname:short)' | wc -l

# 2. Build the PR-state cross-reference (see above), and for each worktree check for a
#    pre-existing ledger/reconciliation *.md before trusting the default heuristics

# 3. Per worktree holding a to-be-deleted branch: status check, detached-HEAD check, then remove
git -C <path> status --porcelain=v2 -b
git -C <path> symbolic-ref -q HEAD >/dev/null || echo DETACHED
git worktree remove <path>              # add --force only if you've confirmed clean + safe
git worktree prune --dry-run --verbose && git worktree prune --verbose

# 4. Local branch deletion (MERGED, deliberately-CLOSED, or CLOSED-superseded-by-a-merged-sibling
#    — see above — no active worktree, not in the "never touch" categories above)
git branch -D <branch1> <branch2> ...

# 5. Remote branch deletion (MERGED only)
git push origin --delete <branch1> <branch2> ...
# verify: gh api repos/<owner>/<repo>/branches/<branch> should 404 for each

# 6. Loose-object compaction (only when hardware load is genuinely idle)
git count-objects -v
git gc   # NOT --aggressive on this hardware; expect it to take several minutes
```

**Running this from inside Claude Code:** expect steps 3 and 4 to each require one explicit
human approval per batch (see the permission-gate section above) — gather the full evidence-backed
list first, present it once, then execute. Do not attempt this sweep with parallel/background
shells on this hardware; it's a `git`-only sweep, but heavy adjacent work (a build, `vitest`,
`git gc`) should still never run concurrently with it — see the low-end-hardware shell-execution
rules this repo's `CLAUDE.md`/`AGENTS.md` already document.

## Revision history

- **2026-08-27/28** — original version, written after a 14→2 worktree and 78→14 local-branch
  cleanup pass.
- **2026-09-23** — extended during a post-#817 cleanup pass (11→6 worktrees removed; 15 of 30
  non-`main` local branches deleted after in-session approval, remote already fully pruned by
  GitHub) with: locale-dependent git-output translation table; the pre-existing-ledger check as a
  third worktree-safety gate;
  the same-day-superseded-sibling PR pattern; nested-worktree containers and the detached-HEAD
  diagnostic; and the Claude Code auto-mode permission gate (including its background-timeout
  behavior) encountered while running this exact playbook interactively. All additions are
  first-hand findings from that pass, not speculative — see the housekeeping session that
  produced this revision for the full worktree/branch/PR evidence trail.
