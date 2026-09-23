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

**The durable fix does not update `refs/heads/main` from outside at all.** Every raw-ref approach
to that — a hand-rolled ancestry-check-then-`update-ref` compare-and-swap, or even `git fetch
<remote> <src>:<dst>` — turned out to only protect the ref's *value*, not the moment-to-moment
state of whichever worktree ends up holding it. **Confirmed empirically (2026-09-23, git 2.45.1)
with a `reference-transaction` hook that pauses `git fetch origin main:main` mid-transaction:** a
second worktree can still check out `main` in the gap between the fetch's own occupancy check and
its reference-transaction commit, leaving that worktree's files/index at the old commit under a
branch ref that has already moved — the exact race the fetch-based approach was supposed to close,
just moved one layer down. No script-level check-then-write sequence, and no fetch-based shortcut,
can fully close this from *outside* the worktree that holds the branch — only git's own
worktree/index machinery, running *inside* that worktree, actually keeps the ref and the checkout
coherent as one operation.

**So update `main` from inside whichever worktree holds it, using normal porcelain — never from
outside, and never with ref plumbing:**

```bash
git worktree list --porcelain | grep -B2 '^branch refs/heads/main$'   # find the one holding main
```

- **If that's your designated canonical main worktree** (this repo's convention: `.worktrees/main`
  — the one this playbook otherwise assumes throughout), go there and update it in place:

  ```bash
  cd <canonical-main-worktree>
  git fetch --no-prune origin   # a plain `fetch origin` still prunes under
                                 # fetch.prune/remote.origin.prune config — be explicit here too
  git merge --ff-only origin/main
  git rev-parse HEAD origin/main   # confirm both now match
  ```

  `merge --ff-only` refuses to do anything if the merge wouldn't be a clean fast-forward — the
  same non-destructive guarantee the old CAS/fetch approaches were reaching for — but it runs as
  an ordinary checkout-aware git operation *on the worktree that already holds the branch*, so
  there is no separate ref to move out from under anyone: this worktree's own index and files are
  what's being advanced, by the one process actually doing it.

- **If some *other* worktree holds `main` instead** (the actual "recurring symptom" case above —
  a rogue worktree left on `main` after one-off work), repoint that one away first — it's not
  supposed to be there:

  ```bash
  git -C <rogue-worktree-path> switch --detach   # or switch to its own real branch
  ```

  Git will not let you check `main` out anywhere *else* while that worktree still holds it (this
  is the same protection that produced the original `gh pr merge` error, and it's confirmed to
  hold even across worktrees: attempting to check the same branch out in a second worktree while
  the first still has it fails closed with `fatal: 'main' is already used by worktree at
  '<path>'`). Once it's repointed, check `main` out in your canonical main worktree if it isn't
  already, then proceed with the `fetch` + `merge --ff-only` above.

This isn't a narrower patch on the previous mechanism — it replaces it, because the previous one's
core claim (that `fetch <src>:<dst>` gives an atomic checked-out-branch guarantee) turned out to be
false under a slow/paused transaction, not just theoretically incomplete.

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
# NUL-safe worktree-path extraction, reused by every check in this doc that needs to iterate
# registered worktree paths: a legal path can contain a space (breaks `for x in $(...)` word
# splitting) or even a literal newline (breaks a line-oriented `awk`/`read` pipeline, which
# truncates at the embedded newline as if it were a real record boundary) — `-z` plus a
# NUL-delimited `read` loop is the only parse that survives either:
list_worktree_paths() {
  git worktree list --porcelain -z | while IFS= read -r -d '' line; do
    case "$line" in "worktree "*) printf '%s\0' "${line#worktree }" ;; esac
  done
}

list_worktree_paths | while IFS= read -r -d '' path; do
  find "$path" -maxdepth 1 -iname '*ledger*' -o -iname '*handoff*' -o -iname '*reconciliation*' \
    -o -iname '*inventory*' -o -iname '*wip*' -o -iname '*recovery*' 2>/dev/null
done
```

Confirmed empirically: a worktree path containing a literal embedded newline (`$'tree\npath'`,
via `git worktree add`) is preserved intact through `list_worktree_paths` above, where the
earlier `awk substr($0,10)` version — correct for spaces, but still line-oriented — silently
truncated it at the newline.

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

### Before the actual `git branch -D`: the branch's own reflog, and binding to the verified tip

Everything above verifies the branch's *current tip*. That doesn't account for commits the branch
**used to** point at — if it was ever `reset` or force-rebased after creating a real commit, that
discarded commit can pass every content/PR check here cleanly (the current tip looks fine) while
surviving *only* in `refs/heads/<branch>`'s own reflog. `git branch -D` deletes that reflog along
with the ref, in the same action, with no separate warning — this is the exact detached-worktree
reflog risk from above, just for an ordinary named branch instead of a detached checkout, and it
has never been covered by the worktree-removal reflog check because a to-be-deleted branch often
has no worktree at all. Inspect it the same way before deleting — **without** a `--` before the
ref, which turns it into a pathspec filter instead of the ref argument and silently produces no
output at all (confirmed empirically: `git reflog show --all -- refs/heads/other` printed
nothing for a branch with real reset-away commits in its reflog; `git reflog show refs/heads/other`
— no `--` — correctly showed them):

```bash
git reflog show refs/heads/<branch>
```

For anything that turns up beyond the current tip, apply the same reachable-elsewhere check as
the detached-worktree case above (output-inspected, not exit-code-chained) and rescue-ref anything
found unreachable, before proceeding.

**Then bind the actual deletion to the exact tip you verified — a bare `git branch -D <branch>`
has no such binding, and this doc's own remote-side fix for that exact gap (the `--force-with-lease`
change) never covered the local case.** If another process renames a different branch onto this
name, or fast-forwards it, between your verification and the delete, a name-only `git branch -D`
removes whatever is there *now*, not what you checked. Git's plumbing delete supports exactly this
as a first-class case:

```bash
git worktree list --porcelain | grep -q "^branch refs/heads/<branch>\$" && { echo "<branch> is checked out in a worktree — resolve that first" >&2; exit 1; }
git update-ref -d refs/heads/<branch> "$verified_sha"
```

(`git worktree list --porcelain` already covers every worktree, including whichever one you're
running this from — no separate "am I on it right now" check is needed on top of it.)

**Read this precisely, because it does not give the same guarantee as `git branch -D` on its
own:** confirmed empirically that `git update-ref -d <ref> <old>` *does* fail closed if `<ref>`
no longer equals `<old>` (a real compare-and-swap on the value) — but *not* if `<ref>` is
currently checked out in a worktree; unlike `git branch -D`, it deletes an actively-checked-out
branch without complaint, corrupting that worktree's index/files-vs-HEAD relationship exactly like
the earlier `main`-ref races. That is why the explicit occupancy check above is not optional
decoration — it restores the protection `git branch -D` would have given for free, at the cost of
a narrow (not fully atomic) gap between the check and the delete. For a branch that's already
been classified as safe to delete by everything above, that gap is far narrower than the
active-and-constantly-advancing `main` case; it is a real, accepted residual, not a closed one. If
that residual isn't acceptable for a given branch, use plain `git branch -D <branch>` instead —
it keeps the checked-out-branch guarantee natively and simply skips the SHA-binding refinement.

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
registered worktree path starts with it — **as a literal path prefix, not a regex**: a candidate
path containing a character that's meaningful to `grep` (`[`, `]`, `.`, `*`, `+`, `?`, `(`, `)` —
none of which are exotic in a real branch-derived directory name) would otherwise make the check
silently pass when it should have found a nested worktree, e.g. `/tmp/tree[1]` failing to match
its own child `/tmp/tree[1]/child` because `[1]` gets read as a character class instead of literal
text:

```bash
list_worktree_paths | while IFS= read -r -d '' other; do   # see list_worktree_paths above
  [ "$other" = "<path>" ] && continue
  case "$other" in
    "<path>"/*) echo "$other" ;;   # literal prefix match — no regex, no word-splitting
  esac
done
```

(`case`'s pattern matching is a shell glob, not a regex — `[`, `.`, `*`, etc. inside the quoted
`"<path>"` portion are matched literally; only the trailing unquoted `/*` acts as a wildcard.
Confirmed empirically against `/tmp/tree[1]` vs. `/tmp/tree[1]/child` — correctly matched — and
against `/tmp/tree[12]/child` — correctly *not* matched, unlike a naive `grep "^<path>/"`.) Any
output here means `<path>` has a nested worktree inside it — classify and remove that one first
(recursing into this same check), never the outer path while an inner one is unreviewed.

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

For each distinct commit SHA that turns up, check whether it's reachable from anything durable —
**by inspecting actual output, not by chaining on exit codes:** `git branch --contains` and
`git tag --contains` both exit `0` even when they find *nothing* (confirmed empirically), so an
`A || B` chain built on either of them never reports "not found" — it silently treats an empty
result as success and moves on:

```bash
sha=<sha>
if git -C <path> merge-base --is-ancestor "$sha" origin/main; then
  echo "reachable via origin/main ancestry"
else
  branches=$(git -C <path> branch --all --no-color --contains "$sha")
  tags=$(git -C <path> tag --contains "$sha")
  if [ -n "$branches" ] || [ -n "$tags" ]; then
    printf 'reachable via:\n%s\n%s\n' "$branches" "$tags"
  else
    echo "UNREACHABLE elsewhere — preserve before removing the worktree"
  fi
fi
```

If the last branch runs, the commit exists *only* in this worktree's reflog — preserve it with an
explicit ref before removing the worktree — `git update-ref refs/rescue/<short-sha> "$sha"` in the
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

### `git worktree prune` deletes administrative reflog data even when the checkout is already gone

The reflog check above assumes the worktree's checkout directory still exists (`git -C <path>
reflog show --all` needs a real path to run against). A `git worktree prune` *candidate* is, by
definition, the opposite case: its administrative entry survives in the shared `.git` even though
the actual checkout directory is already missing or inaccessible — that mismatch is exactly what
makes it prunable. The administrative data for that entry, including its `HEAD` reflog, lives
independently under the shared git directory and is fully readable *without* the checkout
directory — until the real prune runs, which deletes that administrative directory outright, with
no separate warning about what was in it:

```bash
common_git_dir=$(git rev-parse --git-common-dir)
git worktree prune --dry-run --verbose
# each line names the administrative directory being removed, e.g.
# "Removing worktrees/<name>: gitdir file points to non-existent location" — extract <name>:
git worktree prune --dry-run --verbose 2>&1 | grep -o 'worktrees/[^:]*' | while IFS= read -r rel; do
  echo "=== $rel ==="
  GIT_DIR="$common_git_dir/$rel" git reflog show HEAD
done
```

Confirmed empirically (2026-09-23): `GIT_DIR=<admin-dir> git reflog show HEAD` correctly returns
the full reflog — including a commit created and then abandoned by a later `reset`/checkout —
*after* the worktree's own checkout directory has already been deleted; running the real
`git worktree prune --verbose` afterward removes that entire administrative directory, and the
same command then returns nothing at all. Classify every entry the same way as the live-worktree
detached-HEAD case above, rescue anything unreachable with `refs/rescue/<sha>`, and only then run
the real prune.

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

**Before deleting, get an accurate picture of what's actually gone — but don't prune blindly to
get it.** Local `origin/*` remote-tracking refs are a cache; if you never refresh it, branches
GitHub already auto-deleted (via a PR's own `--delete-branch` flag) still show up locally as
phantom entries. The reflex fix — `git fetch origin --prune` — mutates before anything has been
classified, which is exactly the same preserve-first violation this doc calls out for worktree
pruning: if a collaborator deleted an *unmerged* remote branch outside any process this doc
tracks, and no local branch or tag references its tip either, that stale `origin/<branch>`
remote-tracking ref can be the **last reachable pointer** to real commits — pruning it first and
asking questions later means a later `git gc` can make that work permanently unrecoverable, not
just relocate it. Fetch without pruning, get a dry-run inventory, classify every candidate, then
prune:

```bash
git fetch --no-prune origin            # refresh without pruning — a plain `git fetch origin` can
                                        # still prune if fetch.prune/remote.origin.prune is set
                                        # repo-wide, confirmed by `git fetch -h`; be explicit
git remote prune origin --dry-run      # confirmed non-mutating: reports candidates, changes nothing
```

For every candidate the dry-run reports, capture its tip *before* it can disappear, and check
whether it's reachable from anywhere durable — **excluding the candidate ref itself**, and by
inspecting actual output rather than chaining on exit codes (same defect as the detached-worktree
check above: `git branch --contains "$sha"` would trivially "find" the very
`origin/<candidate-branch>` ref it's about to prune, since a ref always contains its own tip,
making the check pass even when nothing *else* references that commit). **Also pass `--no-color`
explicitly** — with `color.branch=always` configured, git appends an ANSI reset sequence after
each branch name, so the anchored `grep -v ".../<candidate-branch>$"` exclusion no longer matches
the end of the line and silently stops excluding the candidate at all (confirmed empirically:
reproduced with `color.branch=always` set, the candidate ref survived the filter as non-empty
output and was misclassified as "reachable elsewhere"):

```bash
sha=$(git rev-parse "origin/<candidate-branch>")
if git merge-base --is-ancestor "$sha" origin/main; then
  echo "reachable via origin/main ancestry"
else
  branches=$(git branch --all --no-color --contains "$sha" | grep -v "/<candidate-branch>\$")
  tags=$(git tag --contains "$sha")
  if [ -n "$branches" ] || [ -n "$tags" ]; then
    printf 'reachable via:\n%s\n%s\n' "$branches" "$tags"
  else
    echo "UNREACHABLE elsewhere — preserve before pruning"
  fi
fi
```

If the last branch runs, the remote-tracking ref really is the last reachable pointer — preserve
it explicitly before pruning, the same way as an unreachable detached-worktree reflog entry above:

```bash
git update-ref "refs/rescue/$sha" "$sha"
```

Only once every candidate is either confirmed reachable elsewhere or explicitly preserved does the
real removal run — **and it should not be a second, broader `git remote prune origin` call.**
That command re-scans the *current* remote state at the moment you run it, not the specific
candidate set the dry-run actually showed you — if another branch was deleted upstream in the
gap between the dry-run and this step, an unscoped `git remote prune origin` prunes that ref too,
even though it was never inventoried or classified. Delete only the exact refs you reviewed,
each bound to the tip you actually checked:

```bash
git update-ref -d "refs/remotes/origin/<candidate-branch>" "$sha"   # once per reviewed candidate
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

# 1. Inventory — fetch WITHOUT --prune here; pruning is a classified decision in step 5, not a
#    side effect of taking inventory
git worktree list --porcelain
git branch --format='%(refname:short)' | wc -l
git fetch --no-prune origin          # plain `fetch origin` can still prune under
                                      # fetch.prune/remote.origin.prune config — be explicit
git remote prune origin --dry-run   # non-mutating candidate count; real prune happens in step 5
git branch -r --format='%(refname:short)' | wc -l

# 2. Build the fork-safe PR-state cross-reference (see above — headRefName + headRepository,
#    never headRefName alone), and search EVERY registered worktree's root (not just the
#    candidate's) for ledger/handoff/reconciliation/inventory/wip/recovery evidence before
#    trusting any default heuristic below

# 3. Per worktree holding a to-be-deleted branch, IN THIS ORDER:
#    a. topology: refuse if any OTHER registered worktree path nests under this one — literal
#       prefix match (a `case` glob, not `grep`/regex — a path with `[`, `.`, `*` etc. otherwise
#       silently defeats the check), classify and remove that leaf first (see above)
list_worktree_paths | while IFS= read -r -d '' other; do [ "$other" = "<path>" ] && continue; case "$other" in "<path>"/*) echo "$other";; esac; done
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
#    e. dry-run and real prune are two separate steps, not one chained command; each dry-run
#       candidate's administrative reflog must be rescued before the real prune destroys it,
#       since its checkout is already gone by definition — see the dedicated section above
git worktree prune --dry-run --verbose
# ...for each candidate, GIT_DIR=<admin-dir> git reflog show HEAD, classify, rescue if unique...
git worktree prune --verbose

# 4. Local branch deletion — MERGED and CLOSED both require the SAME current-tip verification
#    (diff against the PR's real merge/squash SHA, git cherry, content comparison, or a ledger
#    bound to this exact tip) before deleting; a historical PR-state record or a similarly-named
#    merged sibling is a lead, never proof by itself. Also inspect the BRANCH'S OWN reflog (not
#    just its current tip) for anything unreachable, same as a detached worktree — see above.
#    No active worktree, not in the "never touch" categories above.
git reflog show refs/heads/<branch>   # NO `--` before the ref — that turns it into a pathspec
                                       # filter and silently returns nothing (see above)
# ...classify any entry beyond the current tip, rescue-ref anything unreachable...
verified_sha=$(git rev-parse <branch>)
git worktree list --porcelain | grep -q "^branch refs/heads/<branch>\$" && { echo "checked out — resolve first" >&2; exit 1; }
git update-ref -d refs/heads/<branch> "$verified_sha"
# (accepts a narrow, non-atomic gap between the occupancy check and the delete — see above; use
# plain `git branch -D <branch>` instead if that residual isn't acceptable for this branch)

# 5a. Remote-tracking cache cleanup — classify EVERY dry-run candidate's reachability before
#     pruning, not after (see "Remote branch cleanup" above); preserve any unreachable tip first.
#     Delete only the exact reviewed refs — a second `git remote prune origin` call re-scans
#     current state and can prune something new that was never classified.
git remote prune origin --dry-run
# ...for each reported candidate: capture its SHA, check reachability, rescue-ref if unique...
git update-ref -d "refs/remotes/origin/<candidate-branch>" "$sha"   # once per reviewed candidate

# 5b. Actual remote branch deletion — same current-tip verification as step 4, MERGED only, never
#     on the historical PR-state record alone, and bound to the verified SHA via a lease (a bare
#     `--delete` has no lease and can drop a collaborator's new commits) — see above
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
- **2026-09-23 (PR #820 review correction wave 3)** — chatgpt-codex-connector reviewed wave 2's own
  diff and found 3 further `CURRENT_REAL` findings, the first of which disproved wave 2's own
  central claim rather than just narrowing it: (1) **`git fetch <remote> <src>:<dst>` does not
  give an atomic checked-out-branch guarantee either** — reproduced with a `reference-transaction`
  hook that pauses the fetch mid-transaction, during which a second worktree successfully checked
  out `main`, leaving it with old files under a moved ref once the fetch completed. Rather than
  patch this with a third variant of ref plumbing, the mechanism was replaced with a fundamentally
  different approach: update `main` only from *inside* whichever worktree already holds it (via
  ordinary `git fetch` + `git merge --ff-only`), repointing away any worktree that holds `main`
  incorrectly first — this relies on git's own worktree-exclusivity guarantee (confirmed
  empirically: checking the same branch out in a second worktree while a first still holds it
  fails closed) rather than trying to update a ref from outside the worktree that has it checked
  out, which is the actual source of every version of this race so far; (2) `git fetch origin
  --prune` (used both as a "just get an accurate count" inventory step and before remote-branch
  deletion) mutates before any candidate is classified — if an unmerged remote branch was already
  deleted upstream by someone else and no local branch or tag reaches its tip, that remote-tracking
  ref can be the last reachable pointer, and pruning it first makes a later `git gc` capable of
  destroying the work outright; reordered to fetch-without-prune, dry-run inventory, per-candidate
  reachability check, rescue-ref anything unreachable, *then* prune, matching this doc's own
  worktree-prune discipline instead of contradicting it two sections later; (3) the nested-worktree
  topology check used `grep "^<path>/"`, which reads `<path>` as a *regex*, not a literal string —
  a real path containing `[`, `.`, `*`, or similar would silently fail to match its own child (e.g.
  `/tmp/tree[1]` vs. `/tmp/tree[1]/child`), letting a `--force` removal cascade into an unreviewed
  nested checkout exactly the way the topology check exists to prevent; replaced with a `case`-glob
  literal-prefix match, confirmed empirically against exactly that path shape plus a
  whitespace-containing one. The pattern across all three waves holds: each new finding disproved
  or narrowed a *specific* prior safety claim through concrete evidence, and each fix is a
  structural correction validated against real git behavior, not a rewording.
- **2026-09-23 (PR #820 review correction wave 4)** — 6 further findings on wave 3's own diff
  (chatgpt-codex-connector: 5; CodeRabbit: 1), two of which exposed the same underlying defect
  from two independent angles: (1) a plain `git fetch origin` used for "just inventory, don't
  prune" purposes still honors a repo-configured `fetch.prune`/`remote.origin.prune=true` and
  prunes anyway — made explicit everywhere with `git fetch --no-prune origin`; (2) **the
  remote-tracking reachability check was logically broken in two compounding ways, found
  independently by Codex and CodeRabbit**: `git branch --contains`/`git tag --contains` both exit
  `0` even when they find *nothing*, so the `A || B || C` chain never actually detected "not
  found" — an empty result silently counted as success; and separately, checking containment
  against `--all` (which includes remote-tracking refs) trivially "found" the very
  `origin/<candidate-branch>` ref about to be pruned, since a ref always contains its own tip.
  Rewritten to inspect actual command *output*, not exit codes, and to exclude the candidate's
  own ref from the containment check — applied to both the remote-tracking check and the
  structurally identical detached-worktree reflog check from wave 1, which had the same
  exit-code defect (found independently while fixing the reported one); (3) the NUL-safe rewrite
  in wave 3 fixed spaces but not a worktree path containing a literal embedded newline, which a
  line-oriented `awk`/`read` pipeline still truncates — replaced with a genuinely NUL-delimited
  `list_worktree_paths` helper (`git worktree list --porcelain -z` plus a `read -r -d ''` loop),
  confirmed empirically against a real newline-containing path, and reused everywhere a worktree
  path list was needed; (4) named-branch deletion (`git branch -D`) was never covered by the
  reflog-inspection discipline wave 1 added for detached worktrees, even though the identical risk
  applies — a branch that was reset or rebased can have discarded commits reachable only through
  its own reflog, deleted in the same action as the branch itself; added the same inspect-and-
  rescue step before deletion; (5) local branch deletion had no equivalent of the remote lease —
  bound it to the verified SHA via `git update-ref -d`, but only after discovering empirically
  that this command, unlike `git branch -D`, does **not** refuse to delete a branch checked out in
  a worktree; documented that gap honestly (a narrow, non-atomic residual between an explicit
  occupancy check and the delete) rather than presenting the SHA-binding as a strictly-safer
  drop-in replacement, and kept plain `git branch -D` as the explicitly-offered alternative when
  that residual isn't acceptable. Four waves in, the operating pattern hasn't changed: every fix
  is validated against real git behavior before being written down, and no fix is allowed to quietly
  regress a safety property an earlier wave already established.
- **2026-09-23 (PR #820 review correction wave 5)** — 5 further findings from
  chatgpt-codex-connector on wave 4's own diff, all confirmed empirically before being fixed:
  (1) the canonical-main-worktree update flow's own `git fetch origin` was missed when
  `--no-prune` was added everywhere else in wave 4 — made consistent; (2) the named-branch reflog
  check used `git reflog show --all -- refs/heads/<branch>` — the `--` turns the ref into a
  pathspec filter instead of the reflog argument, and the command silently returns nothing;
  confirmed empirically (a branch with real reset-away commits produced zero output with `--`,
  and the correct output without it) and fixed by dropping the `--`; (3) the "real prune" step
  for remote-tracking refs was a second, broader `git remote prune origin` call, which re-scans
  current remote state rather than acting only on the specific candidates the dry-run reviewed —
  replaced with per-ref `git update-ref -d refs/remotes/origin/<branch> "$sha"`, bound to exactly
  what was classified; (4) `git worktree prune`'s real run destroys a prunable candidate's
  administrative directory — including its `HEAD` reflog — even though that data is independently
  readable via `GIT_DIR=<admin-dir> git reflog show HEAD` right up until the prune runs; confirmed
  empirically (a detached commit's reflog entry was readable after its checkout directory was
  already deleted, then permanently gone once the real prune ran) and added as a dedicated rescue
  step, parsing the dry-run's own output for each candidate's administrative directory name;
  (5) the candidate-exclusion filter on `git branch --all --contains` used an anchored `grep -v`
  that silently stopped matching under `color.branch=always`, since git appends an ANSI reset
  sequence after the branch name; confirmed empirically (the candidate ref survived the filter as
  non-empty output with color enabled, correctly excluded with `--no-color`) and fixed by adding
  `--no-color` to both branch-containment checks in the doc. Five waves in: this round's findings
  were almost entirely git-syntax and environment-configuration edge cases rather than architectural
  gaps — a sign the underlying design (current-state proof, native git safety over raw plumbing,
  preserve-before-mutate ordering) is holding, even as increasingly specific execution details keep
  getting tightened under it.
