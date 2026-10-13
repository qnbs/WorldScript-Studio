# Vercel Preview retention runner

Owner: [#627](https://github.com/qnbs/WorldScript-Studio/issues/627). This is the versioned,
reviewed implementation of the post-merge reconciliation in
[`VERCEL-PREVIEW-RETENTION-POLICY.md`](VERCEL-PREVIEW-RETENTION-POLICY.md). It concerns Vercel
deployment artifacts only. GitHub Deployment records are a different surface, handled by the Pages
record reconciler ([`PAGES-DEPLOYMENT-RECORD-PRUNING.md`](PAGES-DEPLOYMENT-RECORD-PRUNING.md)).

## Commands

Two fixed commands, no arguments. Any other argument is refused, so a command-line allow rule for
them cannot be widened by appending text.

```sh
pnpm run vercel:retention:dry-run     # read-only: gates, inventory, SAFE/PROTECTED/UNKNOWN manifest
pnpm run vercel:retention:reconcile   # the full pass: dry-run, then bounded deletion, then post-proof
```

Both print one `RETENTION_MANIFEST …` line per preview, **before the first write**, and one
`RETENTION_SUMMARY {…}` line (anchor SHA, Production ID, counts, deleted IDs, `writeAttempts`,
post-proof) after the pass, and exit non-zero with `RETENTION_STOP: <reason>` on any stop. They
print no tokens, e-mail addresses or provider error text.

## What a pass does

1. **Authority.** Reads `origin/main` and requires every push-triggered `CI / CD` and
   `CodeQL SAST` run on `main` for that exact SHA to be a completed success; a manual or tag run
   never stands in for it, and a run list as long as the request limit counts as possibly
   truncated. Requires Vercel Production `READY` on that SHA with the project's identity (project ID,
   GitHub organisation and repository) confirmed on the deployment itself, the three canonical
   aliases bound to it, and the canonical host to answer HTTP 200. The project identity (ID, name,
   team, linked repository) must match the constants in `scope.mjs`, and the checkout's `origin`
   must be this repository (`origin-unexpected` otherwise), because main and the branch list are
   read through it while the provider and PR reads are pinned to the project.
2. **Inventory.** Reads every page of deployments and aliases, the open PRs, the remote branches
   and the hold file. A provider page without pagination metadata is malformed, not final; an
   incomplete or unreadable inventory stops the run. Every record must carry what classification
   relies on: a deployment an ID, an alias its host and an explicit deployment link (`null` for a
   redirect), an open PR a number, head branch and head commit; one malformed record refuses the
   whole snapshot. The page cursor is a creation timestamp (`created` for deployments, `createdAt`
   for aliases): it must be a positive integer that does not lie below the oldest record of its own
   page, otherwise the inventory is refused instead of followed. The next page starts one
   millisecond above the cursor and the overlap is removed by key; a record that differs between two reads means the
   inventory moved while it was read (`provider-inventory-inconsistent`), and a page that adds
   nothing new stops as `provider-pagination-stalled` instead of passing as complete.
3. **Classification** (pure, in `classify.mjs`). Anything that is, is moving to (`ROLLING`), was
   promoted as, or can roll back to Production never enters the preview classification. A preview
   is `PROTECTED` when it carries a canonical alias, an alias of a branch that still exists (a
   branch of an open PR counts even when it lives in a fork), is among the newest `min(3, available)`
   dated previews of an open PR, builds `main` or an open PR head, is named in
   `.github/vercel-retention-holds.json` as review or retest evidence, or has failed or been canceled
   while its branch or an open PR still exists. It is `UNKNOWN` when its identity, state, rollback
   flag, branch (it must be a non-empty string), commit SHA or creation time is missing or
   contradictory, when one of its aliases is a host the removal command would refuse (a custom
   domain, a nested label), when its PR identifier is
   present but not a plain decimal string, when its target is not the
   plain Preview (a custom environment such as `staging`), or when it has no PR but a live branch or
   an orphan alias. Only the rest is `SAFE`. The manifest line shows ID, verdict, branch, PR, commit,
   state/target, creation time, alias hosts, lifecycle and reasons: a gate that passed adds no
   reason, every protecting or failing gate is named, so the SAFE set can be reviewed and the plan
   is printed before any deletion starts.
4. **Deletion** (`reconcile` only), at most 25 per pass, newest first. For every ID the run re-reads
   `main`, the gates and the whole provider state and re-classifies it. A changed verdict only defers
   that ID. A branch alias of a gone branch is removed first, after it is shown to bind to that
   deployment and not to be canonical (an alias removal that fails is settled by re-reading the
   binding: gone means it landed and the pass goes on without a retry, still bound stops the pass);
   then `vercel remove <dpl_id> --safe --yes`. Each call names
   one validated deployment ID or alias host, so a project name can never reach the project-wide
   form of `remove`. A write is never retried: a failed or unconfirmed one stops the pass, and a
   write of unclear outcome is settled by re-reading the inventory.
5. **Post-proof.** Re-reads everything. `main` must still be the anchor (`main-moved` otherwise);
   then the anchored gates again, the same Production deployment still `READY`, every protected ID
   and every ID that was deferred after its verdict changed still present, every deleted ID absent,
   the canonical aliases still bound to Production, every branch alias of a kept preview still bound
   to the same deployment, every kept preview that had settled (`READY`, `ERROR`, `CANCELED`) still in
   that state, the Production-class set exactly as planned (no promotion or rollback started during
   the wave, no rollback flag lost), every deleted record classified again against the final PR and
   branch snapshot and still `SAFE` (a PR that reopened after its preview was deleted fails the
   proof; the deletion itself cannot be undone), HTTP 200. A deferred ID is held to the same alias
   and state checks as a planned one. Previews that appear during the wave (every push to a PR
   branch creates one) are not classified by the proof: the pass cannot have touched them, and the
   next pass classifies them. Anything else stops the run as `postproof-failed`. A legitimate
   push to a kept PR branch during the pass rebinds its alias and fails this check; nothing was
   deleted because of it and a new pass re-proves.

A pass with no `SAFE` candidate is complete when the inventory was complete.

**Lock.** Only one `reconcile` runs per machine at a time (the lock file lives in the machine's
temporary directory, so it does not coordinate two machines; the retention pass is run from one
maintainer machine). The holder's process ID is written to a private file and linked into place
atomically, so no process ever sees a lock without its holder. A second run stops with
`retention-already-running` before it reads anything. A lock whose holder is dead is reclaimed by
renaming it away and checking that what was moved is the dead holder that was seen; if another
process replaced it in between, the moved lock is put back. A lock file that does not hold a process
ID stops the run as `retention-lock-unreadable` and is never taken over. If the put-back itself
loses to a third process, the displaced lock is kept (as `<lock>.stale.<pid>.<random>`) and the run
stops; Node has no OS advisory lock, so three processes racing within the same instant cannot be
excluded, and the safety of a pass does not depend on the lock (every deletion is re-validated and
a concurrent delete of the same ID fails as `delete-failed`). A release removes the
file only while it still names the releasing process. A process ID that was reused by an unrelated
live process reads as a live holder, and the file is then removed by hand.

## Trusted source

`reconcile` runs only when `scripts/vercel-retention/`, the hold file and the two `package.json`
script entries equal `origin/main` and are clean. An edited, unmerged or divergent checkout is
refused before any provider call, and `cli.mjs` loads only Node built-ins and the lock before this
check, so the runner modules that read or delete anything are not loaded from an untrusted source.
`dry-run` is read-only and has no such requirement.

This is a guard against accidental or stale checkouts, not a defense against a hostile one: an edited
checkout can edit the check, and `pnpm run` reads the script text from its own `package.json`. The
boundary is operational: run `reconcile` from a clean worktree on `main`, never from a feature
branch, and keep the permission rule to the exact command.

## Holds

`.github/vercel-retention-holds.json` lists previews kept as current review or retest evidence
(`{"review": ["dpl_…"]}`). The file is reviewed like any change on `main`; a malformed file stops the
run, and a preview not listed gets no such protection.

## Permissions

The runner's safety comes from its own gates, not from a shell allow rule. If the maintainer wants
no per-merge prompt, the one narrow rule worth considering is the exact literal command, set by the
maintainer through `/permissions`:

```text
Bash(pnpm run vercel:retention:reconcile)
```

Not `Bash(node *)`, not a wildcard, not a path under `/tmp`, and never a bypass mode: those would
allow any script. The agent does not add the rule itself. An expired Vercel login or a 403 is an
authentication stop, not something an allow rule fixes.

## Stop reasons

| Reason | Meaning |
| --- | --- |
| `gate-not-green:<workflow>` | A required push run on `main` for the exact SHA is missing, in flight or not a success. |
| `runs-unreadable`, `runs-incomplete` | The run list could not be read, or was as long as the request limit and may be truncated. |
| `invalid-holds` | The hold file is missing, malformed or lists something other than deployment IDs. |
| `retention-already-running`, `retention-lock-unreadable`, `lock-unavailable` | Another `reconcile` holds the lock, the lock file is not a process ID, or the lock could not be taken. |
| `production-not-ready-on-main`, `canonical-aliases-not-bound`, `canonical-http-failed` | Production is not proven on this SHA. |
| `main-moved`, `main-moved-during-read` | `main` advanced (also checked again at the post-proof); start a new pass for the new SHA. |
| `provider-read-failed`, `provider-pagination-limit`, `provider-pagination-stalled`, `provider-inventory-inconsistent`, `invalid-provider-response` | The inventory could not be read completely or consistently, or a record is malformed. |
| `open-prs-incomplete`, `open-prs-malformed` | The open-PR snapshot is unreadable, possibly truncated, or has an incomplete record. |
| `project-mismatch`, `repository-unconfirmed`, `origin-unexpected` | The provider project, or the checkout's `origin`, is not the expected one. |
| `alias-remove-failed`, `delete-failed`, `delete-not-confirmed` | A write failed or could not be confirmed; nothing is retried. |
| `postproof-failed` | A protected or deferred deployment is missing, a deleted one is back, a canonical or kept branch alias moved, Production is not `READY` or HTTP failed. |
| `runner-source-modified`, `runner-source-differs-from-main`, `package-script-differs-from-main` | `reconcile` was started from a source that is not the reviewed `main`. |
| `invalid-arguments` | Anything other than exactly `dry-run` or `reconcile`. |

## Not covered

Orphan aliases whose deployment no longer exists are reported by the provider but not removed:
their removal needs its own provenance check. Production, rollback and promoted deployments,
environment variables, domains and GitHub Pages records are never touched. The Vercel API offers no
atomic compare-and-delete, so the per-ID re-read narrows the race window but cannot close it. The
last guard is `vercel remove --safe`: for every deployment ID it is given, the CLI (checked in the
bundled source of 59.23.2) reads that deployment's aliases at removal time and drops an aliased
deployment from the removal set. What remains is the interval between that read and the delete, and
a manual alias assignment or promotion of an old preview inside it; do not assign aliases or promote
while a pass runs. The post-proof reports anything that moved.
