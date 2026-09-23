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
updating it while a worktree held it hostage) — fast-forward it once no worktree references it.
**Do this as a compare-and-swap, not a plain read-then-write:** the ancestry check and the ref
update are two separate git invocations, so anything else that advances `main` in between (a
concurrent `gh pr merge`, another session, a hook) would otherwise get silently overwritten by a
now-stale value. Freeze both endpoints first, then let `git update-ref`'s own three-argument form
refuse the write unless the ref still holds exactly the value you checked:

```bash
git fetch origin main
git worktree list --porcelain | grep -q '^branch refs/heads/main$' && \
  { echo 'refs/heads/main is still checked out in a worktree — resolve that first, per above' >&2; exit 1; }
old=$(git rev-parse refs/heads/main)
new=$(git rev-parse refs/remotes/origin/main)
git merge-base --is-ancestor "$old" "$new" && \
  git update-ref refs/heads/main "$new" "$old"
```

`git update-ref <ref> <new> <old>` only writes if `<ref>` currently resolves to exactly `<old>` —
if it doesn't (because something else moved it after you captured `$old`), the command fails
closed with a lock/mismatch error instead of clobbering whatever that other write introduced.

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
for path in $(git worktree list --porcelain | awk '/^worktree /{print $2}'); do
  find "$path" -maxdepth 1 -iname '*ledger*' -o -iname '*handoff*' -o -iname '*reconciliation*' \
    -o -iname '*inventory*' -o -iname '*wip*' -o -iname '*recovery*' 2>/dev/null
done
```

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
  preservation contract.** It's a local, tool-internal, time-bounded safety net (~90 days by
  default, and `git gc`/expiry settings can shorten that) — never cite "reflog covers it" as the
  reason a deletion is fine; it covers accidental *git* mistakes, not a considered decision to
  discard someone's only copy of real work.
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

# 3. Per worktree holding a to-be-deleted branch: tracked-status, ignored-files inventory
#    (classify every hit — UNKNOWN means stop), detached-HEAD check, then remove
git -C <path> status --porcelain=v2 --untracked-files=all
git -C <path> ls-files --others --ignored --exclude-standard
git -C <path> symbolic-ref -q HEAD >/dev/null || echo DETACHED
git worktree remove <path>              # add --force only if you've confirmed clean + safe
git worktree prune --dry-run --verbose && git worktree prune --verbose

# 4. Local branch deletion — MERGED and CLOSED both require the SAME current-tip verification
#    (diff against the PR's real merge/squash SHA, git cherry, content comparison, or a ledger
#    bound to this exact tip) before deleting; a historical PR-state record or a similarly-named
#    merged sibling is a lead, never proof by itself — see above. No active worktree, not in the
#    "never touch" categories above.
git branch -D <branch1> <branch2> ...

# 5. Remote branch deletion — same current-tip verification as step 4, MERGED only, never on the
#    historical PR-state record alone
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
