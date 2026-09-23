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

**If the offending worktree is the *original* checkout (the one with the real `.git` directory,
not a linked one), `git worktree remove` can't touch it at all** — git refuses to remove the main
worktree unconditionally, clean or not. Repoint it instead of trying to remove it:

```bash
git -C <path-to-main-worktree> switch --detach   # or switch to any other real branch
```

That frees `main` without deleting anything, and the fast-forward below then proceeds normally.

After removal (or repointing), the bare repo's own `refs/heads/main` is very likely stale too
(nothing was updating it while a worktree held it hostage) — fast-forward it once no worktree
references it, but not with raw ref plumbing: a manual "check ancestry, then `update-ref`"
sequence is two separate git invocations, and a hand-rolled compare-and-swap around it only
protects the ref's *value* — it does nothing about another session *checking `main` out* in the
gap between your occupancy scan and the write, since a checkout doesn't change what commit the
branch points to. Plain git plumbing has no atomic way to hold both of those together across
processes; a private lock you invent yourself wouldn't be honored by any of git's own commands
either, so it wouldn't actually close the gap.

**Use the git operation that already has this exact safety built in, instead of reimplementing
it:** `git fetch <remote> <src>:<dst>` refuses outright if `<dst>` is checked out in *any*
worktree, and separately refuses a non-fast-forward update without `--force` — both checks happen
as one atomic step inside git itself, not as a separate script-level scan before a later write:

```bash
git fetch origin main:main
```

Confirmed empirically (2026-09-23, git 2.45.1): fetching into a branch checked out in another
worktree fails closed with `fatal: refusing to fetch into branch 'refs/heads/main' checked out at
'<path>'` (exit 128); fetching a non-fast-forward update into an unchecked-out branch fails closed
with `! [rejected] main -> main (non-fast-forward)` (exit 1). Either failure means stop and
re-diagnose (worktree still holds `main`, or `main` diverged from `origin/main` unexpectedly) —
never re-run with `--force` to push past it. This single command replaces the fetch, the ancestry
check, and the ref update above, and — unlike the hand-rolled version — has no window between
"checked" and "written" for another session to land in.

## Before removing *any* worktree: prove it's safe

Never remove a worktree — or delete the branch it points at — without checking all of these
first. A worktree removal only deletes the *checkout*; the branch ref (and its commits) survive
until you explicitly delete the branch too, so the checks below matter most before that second
step.

```bash
# 1. Uncommitted TRACKED changes?
git -C <worktree-path> status --porcelain=v2 -b
# non-empty output (beyond the branch.* lines) = STOP, something is mid-edit

# 2. Unique commits never pushed/merged anywhere?
git -C <worktree-path> rev-list --count origin/main..<branch>
# > 0 means real, potentially unrecoverable-elsewhere work exists on this branch
```

**These two checks are not sufficient by themselves — ignored files are part of the inventory
too.** `git status --porcelain=v2 -b` never reports gitignored paths, but `git worktree remove`
deletes the *entire* directory regardless of `.gitignore` — including a freshly-ignored `.env`
with real local secrets (exactly what this doc's own `.gitignore` change adds), a local database,
a handoff/evidence file, provider/project metadata, or any other irreplaceable local-only content.
A clean `status` result proves nothing about that content; inventory it explicitly:

```bash
git -C <worktree-path> status --porcelain=v2 --untracked-files=all
git -C <worktree-path> ls-files --others --ignored --exclude-standard
```

Classify every ignored path this turns up — "ignored" means "not for git," not "disposable":

| Classification | Meaning | Disposition |
|---|---|---|
| `REGENERABLE` | Build output, caches, lockfile-derived state — reproducible from a clean checkout | Safe to discard |
| `LOCAL_SECRET` | `.env`, keys, tokens, local credentials | Preserve, or discard only with explicit confirmation it's throwaway |
| `EVIDENCE` | Handoff notes, audit logs, review evidence, anything documenting a decision | Preserve |
| `UNIQUE_WORK` | Local-only data, exports, or state with no other copy | Preserve |
| `CACHE` | Tool-local scratch state with no evidentiary or reproducibility value | Safe to discard |
| `UNKNOWN` | Anything you can't confidently place above | **Stop** — do not remove until resolved |

Only remove the worktree once every ignored path found has a disposition other than `UNKNOWN`.

A worktree/branch is safe to remove only when **all** of the above come back clean: no
uncommitted tracked diff, no unresolved ignored content, and either zero unique commits *or*
every commit is reachable via a real PR (see below).

**Next check: has a past session already left a classification — and does it still apply?**
Search for ledger/handoff/reconciliation evidence before applying any default heuristic below.
Two real examples found in this repo (2026-09-23) prove this evidence is **not** reliably
co-located with the worktree it describes: `.pr747-orchestration-wip-inventory.md` and
`.pr747-split-ledger.md` sat in the *main* worktree's root while classifying dirty state in a
*different*, still-dirty worktree; `LOCAL-WIP-RECONCILIATION.md` sat inside the
`takeover-convergence-20260912` worktree while pre-classifying *three other* worktrees as
`EVIDENCE_ONLY` / `PARTIALLY_VALID`, each with an explicit "Recovery: Worktree, branch, and
handoff bundle" instruction. **Search every registered worktree's root, not just the candidate's
own directory:**

```bash
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' |
while IFS= read -r path; do
  find "$path" -maxdepth 1 -iname '*ledger*' -o -iname '*handoff*' -o -iname '*reconciliation*' \
    -o -iname '*inventory*' -o -iname '*wip*' -o -iname '*recovery*' 2>/dev/null
done
```

(`for path in $(... print $2 ...)` here would word-split on the first space in the path and
silently miss ledgers inside any worktree whose path contains one — `substr($0,10)` takes the
whole rest of the `worktree ` line intact instead of just its first field, and piping into a
`read` loop instead of a `for ... in $(...)` avoids splitting it again on the way out.)

Don't blindly trust every markdown file this turns up as authoritative — read each candidate and
correlate it against the specific branch/worktree/PR you're evaluating before it changes any
decision.

**A ledger's disposition is only as current as the state it actually describes — bind it to that
state before trusting it, every time:**

1. Note the ledger's own date/anchor (commit SHA, branch, worktree path) as written.
2. Re-capture the worktree's *current* state (tracked, untracked, **and ignored** — see above).
3. Check whether anything — a new commit, a new uncommitted hunk, a new ignored file — has
   appeared since the ledger was written.
4. Only the specific work the ledger actually enumerated inherits its disposition. Material the
   ledger never saw gets no free pass from it, however authoritative the ledger otherwise reads.
5. On any divergence, reclassify the new material from scratch using the checks in this doc —
   never extend the old disposition to cover it by assumption.

Where practical, bind the ledger's own evidence to something independently checkable (a SHA, a
diff, a branch tip) rather than trusting its prose alone — that's what let the two real examples
above support a `--force` removal safely instead of on faith. **A ledger's explicit, still-current
disposition overrides the default heuristics in this doc, in both directions** — it can pre-clear
a removal the default checks alone wouldn't justify, or block one the default checks alone would
otherwise allow. A *stale* ledger overrides nothing beyond what it actually still covers.

## Cross-referencing branches against real PR history

Linear `git merge-base --is-ancestor <branch> origin/main` **under-counts** in any repo using
squash-merge (this one does) — a squash-merged PR's original commits are never literal ancestors
of `main`, since squashing creates one new commit with a different SHA. The correct signal is
GitHub's own PR state, not git ancestry — but `headRefName` alone is not a safe join key: a
fork's PR can use the exact same branch name as a local branch that has nothing to do with it, and
matching on name only would classify that unrelated local branch as `MERGED`/`CLOSED` and clear it
for deletion. Include the PR's head repository in the match so only a PR that actually belongs to
*this* repository can classify a local branch:

```bash
repo=$(gh repo view --json nameWithOwner --jq '.nameWithOwner | ascii_downcase')
gh pr list --state all --limit 1000 --json headRefName,state,number,headRepository \
  --jq '.[] | "\(.headRefName)\t\((.headRepository.nameWithOwner // "") | ascii_downcase)\t\(.state)\t#\(.number)"' \
  | sort > /tmp/pr-heads.tsv

for b in $(git branch --format='%(refname:short)' | grep -v '^main$'); do
  match=$(awk -F'\t' -v b="$b" -v repo="$repo" '$1==b && $2==repo {print $3, $4}' /tmp/pr-heads.tsv)
  echo "$b -> ${match:-NO PR FOUND}"
done
```

A branch name present in `pr-heads.tsv` under a *different* `headRepository` is not a match at
all — treat it exactly like `NO PR FOUND` for that local branch.

This sorts every local branch into three buckets — but the label alone is historical metadata,
not present-tense proof, in every one of the three:

- **`MERGED #N`** — content is permanently preserved in `main`'s history via the squashed commit
  (this repo squash-merges — see above; there is no separate two-parent merge commit to look for).
  **This record is historical, not current — verify the tip you're about to delete is actually
  what merged before deleting it.** A branch can gain new commits after its PR merged, get reused
  for unrelated work, diverge locally, or be recreated remotely under the same name; none of that
  changes what `gh pr list` reports, since it only ever recorded the head at merge time. The
  ordinary ancestry check gives a **false negative** here too — a squash-merged branch's own
  commits are never literal ancestors of `main`, so `git merge-base --is-ancestor <branch> main`
  is not a substitute for this verification. Use whichever of these actually fits the branch in
  front of you:
  - fetch the PR's real merge/squash commit (`gh pr view <N> --json mergeCommit --jq
    '.mergeCommit.oid'`) and confirm `git diff <branch-tip> <that-sha>` is empty, or that every
    hunk it does show is something you've separately confirmed safe to lose;
  - `git cherry <base> <branch>` for patch-equivalence when the history is more than one clean
    squash-shaped diff;
  - a direct content/patch comparison against `main`'s current tree for the affected paths;
  - a ledger that dispositions exactly *this* branch's *current* tip (bound per the staleness
    check above) — not an older or unrelated commit on the same branch.

  Only once the current tip itself is accounted for — not just the branch name and a historical
  PR record — is it safe to delete locally and remotely.
- **`CLOSED #N`** (never merged) — this means exactly one thing: **not merged.** It does **not**
  by itself mean abandoned, superseded, or safe to delete. A PR gets closed for rework-and-reopen,
  for a scope split, or for reasons that leave its branch's current tip as the only copy of real
  work anywhere — the state this doc's own safety principles exist to protect. Treat a `CLOSED`
  branch as **no safer than the "No PR at all" bucket below** unless you can additionally show one
  of:
  - explicit, current evidence that it was abandoned or superseded — not inferred from the close
    event alone;
  - the current tip carries no unique work beyond what's already reachable elsewhere, verified
    the same way as the `MERGED` case above (diff/cherry/content comparison — not name or timing);
  - the content demonstrably exists under another solid authority — a merged sibling PR, but only
    once *content* evidence confirms it (see the same-day-sibling case just below), never a
    similar name alone;
  - a ledger that dispositions exactly this branch's *current* tip (bound per the staleness check
    above).

  Absent one of those, flag it for human review instead of deleting. **Reflog is not a
  preservation contract.** It's a local, tool-internal, time-bounded safety net, and the default
  window is shorter than it looks: `gc.reflogExpire` (90 days) applies only to entries still
  *reachable* from some ref; the moment you delete the branch, its entries become *unreachable*
  and fall under `gc.reflogExpireUnreachable` — 30 days by default, not 90 — and either can be
  configured shorter. Never cite "reflog covers it" as the reason a deletion is fine; it covers
  accidental *git* mistakes within that window, not a considered decision to discard someone's
  only copy of real work.
  - **Same-day sibling retry, a common sub-case of the "another solid authority" proof above — but
    branch-name similarity is a lead, never proof on its own:** a `CLOSED` (unmerged) PR is often
    an immediate retry under a renamed branch — check for a sibling branch name (typically `-v2`,
    `-corrected`, `-2`, or a later date stamp) whose PR **is** `MERGED`, often within hours of the
    close. That similarity only tells you where to *look*; it does not by itself establish that
    the merged sibling's diff actually contains the closed PR's changes — a similarly-named PR can
    be a narrower rewrite, a different-scope redo, or only a partial overlap, and deleting on
    name/timing alone can destroy the only copy of work the sibling never actually carried. Get
    the same explicit content evidence required above: diff the closed branch against the merged
    sibling (`git diff <closed-branch> <merged-sibling-tip>` — or against the sibling's own
    pre-squash branch tip if it still exists — should show no meaningful unique hunks left in the
    closed branch), or find a ledger/reconciliation note (see the check above) that already
    recorded the supersession from an actual review. Two real examples from this repo
    (2026-09-20) where the name/timing lead turned out to hold up under that stronger check:
    `feat/553-autosave-canonical-wiring-20260920` (PR closed unmerged) was superseded by
    `feat/553-autosave-canonical-wiring-20260920-corrected` (merged the same day);
    `feat/553-universal-ingress-admission` (closed unmerged, twice, under PR numbers from two
    different weeks) was superseded by `feat/553-universal-ingress-admission-v2` (merged). Treat
    the lead as a starting point for verification, not as the verification itself.
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

**Removal order matters here too: leaves before parents.** If a candidate path is itself a
worktree that *contains* other registered worktrees (i.e. it's a prefix of another entry in
`git worktree list --porcelain`), removing it — especially with `--force` — doesn't just delete
the outer checkout; a real filesystem `rm` of that directory takes the nested checkout down with
it, while only the outer worktree gets properly deregistered (the inner one is left merely
prunable, not actually reviewed). Checking the outer branch's own safety says nothing about the
inner one's uncommitted or unique-commit state. Before removing any worktree, confirm no other
registered worktree path starts with it:

```bash
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | grep -v "^<path>$" | grep "^<path>/"
# any output here means <path> has a nested worktree inside it — classify and remove that one
# first (recursing into this same check), never the outer path while an inner one is unreviewed
```

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

The current `HEAD` being a clean ancestor of `origin/main` only proves that *specific commit* has
no unique content — it says nothing about the rest of this worktree's reflog. A detached worktree
can have been used to create real commits earlier in the session that were then themselves
abandoned by checking out an ancestor on top of them (e.g. an aborted experiment); those commits
are unreachable from any branch and exist *only* in this worktree's own `HEAD` reflog
(`.git/worktrees/<name>/logs/HEAD` for a linked worktree) — removing the worktree deletes that
reflog outright, not just after its normal expiry window. Check the **full** reflog, not just the
last few entries, before trusting "clean + ancestor" as sufficient:

```bash
git -C <path> reflog show --all              # full history, not just -5
```

For each distinct commit SHA that turns up, check whether it's reachable from anything durable:

```bash
git -C <path> merge-base --is-ancestor <sha> origin/main || \
  git -C <path> branch --all --contains <sha>
```

If neither finds it, the commit exists *only* in this worktree's reflog — preserve it with an
explicit ref before removing the worktree — `git update-ref refs/rescue/<short-sha> <sha>` in the
main repository — rather than relying on the reflog's own time-bounded retention (see the
`CLOSED` bucket above: reflog is not a preservation contract). Only once every reflog entry is
accounted for this way is "clean and a plain ancestor" actually sufficient — and this isn't a
license to rescue-ref every routine checkout/rebase entry forever: the contract is to protect
unique, otherwise-unreachable work, not to accumulate permanent refs for ordinary history. Confirmed real example
(2026-09-23): `desktop-startup-safe-open-20260922` was detached at an old `origin/main` point
corresponding to a version-bump release commit; its originating branch's PR had already merged,
and the reflog showed the exact `checkout: moving from fix/desktop-startup-safe-open-i18n-20260922
to origin/main` transition that produced the detached state, with no other commits in the reflog
to account for.

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
depend on the branch ref surviving. That confirmation is the *same* current-tip verification as
the local `MERGED` bucket above, not just the historical PR record — a remote ref can just as
easily have gained commits, been reused, or been recreated since the PR merged, and remote
deletion is the higher-stakes side of that mistake. Never delete a remote branch on the historical
PR-state record alone.

**Before deleting, always run `git fetch origin --prune` first.** Local `origin/*`
remote-tracking refs are a cache — if you never run a pruning fetch, branches that GitHub already
auto-deleted (via a PR's own `--delete-branch` flag) still show up locally as phantom entries.
Attempting to delete an already-gone ref just wastes a round-trip; pruning first gives an accurate
picture of what genuinely still needs cleanup:

```bash
git fetch origin --prune
git branch -r --format='%(refname:short)' | grep -v '^origin$\|^origin/main$'
# cross-reference the survivors against pr-heads.tsv exactly as above, verify each one's CURRENT
# tip the same way as the MERGED bucket above, then delete bound to exactly that verified SHA —
# never a bare --delete with no lease, which deletes whatever is there regardless of whether it
# still matches what you verified:
verified_sha=$(git rev-parse "origin/<branch>")
git push --force-with-lease="<branch>:$verified_sha" origin --delete <branch>
```

A bare `git push origin --delete <branch>` has no lease at all — if a collaborator pushes new
commits to that branch between your verification and this command, it deletes their new work
along with everything else, silently. `--force-with-lease=<refname>:<expect>` makes the deletion
itself conditional on the remote ref still being exactly what you verified.

**Multi-ref push caveat, confirmed the hard way:** a single `git push origin --delete a b c`
where some refs are stale (already gone) reports per-ref errors but can silently **fail to apply
even the refs that would have succeeded** — the overall command exits non-zero and at least one
genuinely-deletable branch was left untouched despite not appearing in the error list. This is a
reason to push each lease-bound deletion individually anyway, not batched. Verify afterward with a
ref-safe check rather than building a URL by hand — a branch name can contain `/`
(`feature/foo`), and interpolating that directly into `gh api repos/<owner>/<repo>/branches/<name>`
addresses the wrong route and can report a false "still exists":

```bash
git ls-remote --exit-code --refs origin "refs/heads/<branch>"
# exit code 2 (no matching refs) = confirmed gone; exit code 0 = still there, retry
```

## `git gc` — real, but hardware-gated

After a large branch-deletion sweep, loose objects accumulate fast (this repo went from ~5,780
loose objects after deleting 60+ branches). `git gc` (non-`--aggressive`) is the right tool, but
**confirmed to exceed a 3-minute timeout on this project's 2-core/~3.7 GB reference low-end
machine** under normal load (load average ~2.9, ~385 MB free RAM at time of testing). Do not run
it interactively as a "quick cleanup" step when hardware is already under load — it will either
time out or contend with whatever else is running.

**If a `git gc` run gets killed mid-repack**, it leaves a genuinely-safe-to-delete artifact behind
— but never assume `.git` is the real git directory to clean up. In any *linked* worktree (every
one this doc targets except the original clone), `.git` is a one-line text file pointing at the
shared directory, not a directory itself — `find .git/objects/pack ...` there just fails with
"not a directory" and the actual leftover temp pack goes untouched. Resolve the real, shared
location first:

```bash
common_git_dir=$(git rev-parse --git-common-dir)
git count-objects -v
# a "garbage: N" / "size-garbage: N" line means an incomplete temp pack survived the kill
find "$common_git_dir/objects/pack" -name 'tmp_pack_*'
rm -f "$common_git_dir"/objects/pack/tmp_pack_*   # git's own count-objects already told you this is garbage
```

This is safe because an interrupted `git gc`'s temp pack was never linked into any real ref — it
is by definition unreferenced, incomplete data, not a partially-written *real* object. It's the
same shared object store regardless of which worktree you resolve it from, which is exactly why
guessing a path relative to the wrong `.git` silently misses it.

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

# 2. Build the fork-safe PR-state cross-reference (see above — headRefName + headRepository,
#    never headRefName alone), and search EVERY registered worktree's root (not just the
#    candidate's) for ledger/handoff/reconciliation/inventory/wip/recovery evidence before
#    trusting any default heuristic below

# 3. Per worktree holding a to-be-deleted branch, IN THIS ORDER:
#    a. topology: refuse if any OTHER registered worktree path nests under this one — classify
#       and remove that leaf first (see "Worktrees nested inside other worktrees" above)
git worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | grep -v "^<path>$" | grep "^<path>/"
#    b. tracked-status + ignored-files inventory (classify every hit — UNKNOWN means stop)
git -C <path> status --porcelain=v2 --untracked-files=all
git -C <path> ls-files --others --ignored --exclude-standard
#    c. detached-HEAD check — if detached, inspect the FULL reflog (not just recent entries) and
#       preserve any unique unreachable commit with an explicit ref before proceeding (see above)
git -C <path> symbolic-ref -q HEAD >/dev/null || echo DETACHED
git -C <path> reflog show --all
#    d. only once a–c all pass, remove — main/root worktree can't be removed this way, repoint it
#       instead (see "The recurring symptom" above)
git worktree remove <path>              # add --force only if you've confirmed clean + safe
#    e. dry-run and real prune are two separate steps, not one chained command — inspect every
#       reported candidate before the second command runs, in a later turn/message, not `&&`-joined
git worktree prune --dry-run --verbose
# ...review the output above; only once every candidate is confirmed safe...
git worktree prune --verbose

# 4. Local branch deletion — MERGED and CLOSED both require the SAME current-tip verification
#    (diff against the PR's real merge/squash SHA, git cherry, content comparison, or a ledger
#    bound to this exact tip) before deleting; a historical PR-state record or a similarly-named
#    merged sibling is a lead, never proof by itself — see above. No active worktree, not in the
#    "never touch" categories above.
git branch -D <branch1> <branch2> ...

# 5. Remote branch deletion — same current-tip verification as step 4, MERGED only, never on the
#    historical PR-state record alone, and bound to the verified SHA via a lease (a bare
#    `--delete` has no lease and can drop a collaborator's new commits) — see above
verified_sha=$(git rev-parse "origin/<branch>")
git push --force-with-lease="<branch>:$verified_sha" origin --delete <branch>
# verify each is actually gone (path-safe — a raw branch name in a REST URL breaks on `/`):
git ls-remote --exit-code --refs origin "refs/heads/<branch>"   # exit 2 = confirmed gone

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
  third worktree-safety gate; the same-day-superseded-sibling PR pattern; nested-worktree
  containers and the detached-HEAD diagnostic; and the Claude Code auto-mode permission gate
  (including its background-timeout behavior) encountered while running this exact playbook
  interactively. All additions are first-hand findings from that pass, not speculative — see the
  housekeeping session that produced this revision for the full worktree/branch/PR evidence trail.
- **2026-09-23 (PR #820 review correction wave)** — the revision above shipped with ten review
  findings across four reviewers (CodeAnt: 1 `Critical` race condition; Sourcery: 3; chatgpt-
  codex-connector: 6), all confirmed real against one shared root cause and fixed together rather
  than argued down or patched one comment at a time: **historical metadata (a branch name, a PR
  state, an older ledger) was allowed to stand in for a current-state proof before authorizing a
  deletion.** Specifically: (1) the `main` fast-forward's ancestry-check-then-`update-ref`
  sequence was a TOCTOU race — rewritten as an explicit compare-and-swap via `update-ref`'s
  three-argument form, still gated on no worktree holding `main`; (2) the PR/branch cross-
  reference matched on `headRefName` alone, so a fork's PR with a colliding branch name could get
  an unrelated local branch classified `MERGED`/`CLOSED` — added the PR's `headRepository` to the
  join key; (3) a correctly-matched historical `MERGED`/`CLOSED` record was treated as proof about
  the branch's *current* tip — added explicit current-tip verification (PR merge/squash SHA diff,
  `git cherry`, content comparison, or a ledger bound to the current tip) before either bucket
  authorizes deletion, and the same requirement was added to remote-branch deletion; (4) `CLOSED`
  was described as automatically safe to delete with reflog as the safety net — rewritten so
  `CLOSED` means only "not merged," is treated as no safer than the "no PR" bucket without one of
  four explicit current-state proofs, and reflog is named as what it is (a time-bounded local
  safety net, not a preservation contract); (5) the same-day-sibling heuristic stated branch-name/
  timing similarity as sufficient deletion proof — downgraded to an investigative lead that still
  requires explicit content evidence; (6) the ledger-override rule didn't check whether the ledger
  predated later changes — added a five-step staleness-binding procedure so only the work a ledger
  actually enumerated inherits its disposition; (7) the ledger search only looked inside the
  candidate worktree, even though this doc's own two real examples show the relevant ledger can
  live in a *different* worktree — search now covers every registered worktree's root; (8) the
  worktree-safety checks never inventoried gitignored content, so `git worktree remove` could
  silently destroy a local secret, evidence file, or other irreplaceable ignored data that a clean
  `git status` never revealed — added an explicit ignored-files inventory with a mandatory
  classification (`UNKNOWN` blocks removal); (9) the `git gc` recovery commands assumed `.git` was
  a real directory, which is false in every linked worktree (it's a text file pointing at the
  shared common dir) — resolved via `git rev-parse --git-common-dir` first; (10) "via the merge
  commit" corrected to "via the squashed commit" to match this repo's actual squash-merge history.
  None of these fixes loosen the preserve-first stance elsewhere in this doc — every one of them
  closes a way the previous wording could have authorized deleting real, unrecoverable work.
- **2026-09-23 (PR #820 review correction wave 2)** — the wave above still shipped with 11 further
  findings on the exact-head diff (chatgpt-codex-connector: 6; CodeRabbit: 5), fixed together as a
  second bundled root-cause pass rather than one push per comment: (1) `git worktree remove
  --force` on an outer worktree could cascade-delete a nested worktree it contains without that
  inner checkout ever being reviewed — added a topology check that refuses removal while any
  registered worktree path nests under the candidate, leaves-first; (2) `git push origin --delete`
  had no lease at all, so a collaborator's new commits landing between verification and deletion
  were silently dropped — bound to `--force-with-lease=<branch>:<verified-sha>`; (3) the
  ledger-search loop's `for path in $(... print $2 ...)` word-split any worktree path containing a
  space, silently skipping its ledgers — fixed via `substr($0,10)` and a `read` loop that never
  re-splits the path; (4) **the `update-ref` compare-and-swap itself was reconsidered, not just
  patched with a caveat** — it protected the ref's *value* but not the checked-out state, so
  another session checking out `main` between the occupancy scan and the write was still possible;
  replaced entirely with `git fetch <remote> <src>:<dst>`, which git itself refuses atomically for
  *both* "checked out elsewhere" and "non-fast-forward," confirmed empirically against a real
  worktree and a real diverged branch (see above) rather than assumed; (5) a detached-worktree's
  current `HEAD` being a clean ancestor said nothing about *other* commits stranded only in that
  worktree's own reflog — added full-reflog inspection with reachability checks and a rescue ref
  for anything found unreachable, bounded so it protects real unique work rather than accumulating
  permanent refs for routine history; (6) `git worktree prune --dry-run --verbose && git worktree
  prune --verbose` executed the real prune immediately after the dry-run with no actual review
  step in between, defeating the point of a dry-run — split into two separate, individually
  reviewed steps; (7) `docs/DEPENDABOT-TRIAGE.md`'s "wait for the fixing PR to land" allowed
  resuming the dependency train on the merge event alone, without confirming that PR's own
  push-triggered CI actually succeeded — tightened to require both; (8) the runbook told readers
  to `git worktree remove` a worktree holding `main`, which git refuses unconditionally for the
  original checkout — added the safe repoint (`switch --detach`) as the documented alternative;
  (9) "~90 days by default" for reflog retention overstated the real window — git's default is 90
  days for *reachable* entries but only 30 for *unreachable* ones (exactly the case right after a
  branch deletion), now stated precisely; (10) the remote-branch-gone verification interpolated a
  raw branch name into a GitHub REST URL, which breaks (and can falsely report "gone") for any
  name containing `/` — replaced with `git ls-remote --exit-code --refs`. Same operating principle
  as wave 1: every fix closes a way the previous wording could authorize losing real work: none of
  them loosen it.
