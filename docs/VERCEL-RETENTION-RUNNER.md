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

Both print one `RETENTION_SUMMARY {…}` line (anchor SHA, Production ID, counts, deleted IDs,
`writeAttempts`, post-proof) and exit non-zero with `RETENTION_STOP: <reason>` on any stop. They
print no tokens, e-mail addresses or provider error text.

## What a pass does

1. **Authority.** Reads `origin/main` and requires every push-triggered `CI / CD` and
   `CodeQL SAST` run on `main` for that exact SHA to be a completed success; a manual or tag run
   never stands in for it, and a run list as long as the request limit counts as possibly
   truncated. Requires Vercel Production `READY` on that SHA, the three canonical aliases bound to
   it, and the canonical host to answer HTTP 200. The project identity (ID, name, team, linked
   repository) must match the constants in `scope.mjs`.
2. **Inventory.** Reads every page of deployments and aliases, the open PRs, the remote branches
   and the hold file. A provider page without pagination metadata is malformed, not final; an
   incomplete or unreadable inventory stops the run.
3. **Classification** (pure, in `classify.mjs`). Anything that is, is moving to (`ROLLING`), was
   promoted as, or can roll back to Production never enters the preview classification. A preview
   is `PROTECTED` when it carries a canonical alias, an alias of a branch that still exists, is
   among the newest `min(3, available)` dated previews of an open PR, builds `main` or an open PR
   head, or is named in `.github/vercel-retention-holds.json` as review or retest evidence. It is
   `UNKNOWN` when its identity, state, rollback flag, branch, commit SHA or creation time is missing
   or contradictory, or when it has no PR but a live branch or an orphan alias. Only the rest is
   `SAFE`. Both modes print one `RETENTION_MANIFEST` line per preview (ID, verdict, branch, PR,
   commit, alias count, lifecycle, reasons) before the summary, so the SAFE set can be reviewed.
4. **Deletion** (`reconcile` only), at most 25 per pass, newest first. For every ID the run re-reads
   `main`, the gates and the whole provider state and re-classifies it. A changed verdict only defers
   that ID. A branch alias of a gone branch is removed first, after it is shown to bind to that
   deployment and not to be canonical; then `vercel remove <dpl_id> --safe --yes`. Each call names
   one validated deployment ID or alias host, so a project name can never reach the project-wide
   form of `remove`. A write is never retried: a failed or unconfirmed one stops the pass, and a
   write of unclear outcome is settled by re-reading the inventory.
5. **Post-proof.** Re-reads everything: the anchored gates again, the same Production deployment
   still `READY`, every protected ID still present, every deleted ID absent, the canonical aliases
   still bound to it, HTTP 200. Anything else stops the run as `postproof-failed`.

A pass with no `SAFE` candidate is complete when the inventory was complete. Only one `reconcile`
runs per machine at a time; a second one stops with `retention-already-running` before it reads
anything, and a lock left by a dead process is recovered.

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
| `retention-already-running`, `lock-unavailable` | Another `reconcile` holds the lock, or the lock could not be taken. |
| `production-not-ready-on-main`, `canonical-aliases-not-bound`, `canonical-http-failed` | Production is not proven on this SHA. |
| `main-moved`, `main-moved-during-read` | `main` advanced; start a new pass for the new SHA. |
| `provider-read-failed`, `provider-pagination-limit`, `invalid-provider-response` | The inventory could not be read completely. |
| `project-mismatch`, `repository-unconfirmed` | The provider project is not the expected one. |
| `alias-remove-failed`, `delete-failed`, `delete-not-confirmed` | A write failed or could not be confirmed; nothing is retried. |
| `postproof-failed` | A protected deployment is missing, a deleted one is back, an alias moved or HTTP failed. |
| `runner-source-modified`, `runner-source-differs-from-main`, `package-script-differs-from-main` | `reconcile` was started from a source that is not the reviewed `main`. |
| `invalid-arguments` | Anything other than exactly `dry-run` or `reconcile`. |

## Not covered

Orphan aliases whose deployment no longer exists are reported by the provider but not removed:
their removal needs its own provenance check. Production, rollback and promoted deployments,
environment variables, domains and GitHub Pages records are never touched. The Vercel API offers no
atomic compare-and-delete, so the per-ID re-read narrows the race window but cannot close it.
