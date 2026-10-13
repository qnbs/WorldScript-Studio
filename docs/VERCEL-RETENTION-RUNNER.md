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

1. **Authority.** Reads `origin/main` and requires every `CI / CD` and `CodeQL SAST` run of that
   exact SHA to be a completed success. Requires Vercel Production `READY` on that SHA, the three
   canonical aliases bound to it, and the canonical host to answer HTTP 200. The project identity
   (ID, name, team, linked repository) must match the constants in `scope.mjs`.
2. **Inventory.** Reads every page of deployments and aliases, the open PRs and the remote
   branches. An incomplete or unreadable inventory stops the run.
3. **Classification** (pure, in `classify.mjs`). Anything that is, was promoted as, or can roll
   back to Production never enters the preview classification. A preview is `PROTECTED` when it
   carries a canonical alias, an alias of a branch that still exists, is among the newest
   `min(3, available)` previews of an open PR, or builds `main` or an open PR head. It is `UNKNOWN`
   when its identity, state, rollback flag, branch or creation time is missing or contradictory, or
   when it has no PR but a live branch or an orphan alias. Only the rest is `SAFE`.
4. **Deletion** (`reconcile` only), at most 25 per pass, newest first. For every ID the run re-reads
   `main`, the gates and the whole provider state and re-classifies it. A changed verdict only defers
   that ID. A branch alias of a gone branch is removed first, after it is shown to bind to that
   deployment and not to be canonical; then `vercel remove <dpl_id> --safe --yes`. Each call names
   one validated deployment ID or alias host, so a project name can never reach the project-wide
   form of `remove`. A write is never retried: a failed or unconfirmed one stops the pass, and a
   write of unclear outcome is settled by re-reading the inventory.
5. **Post-proof.** Re-reads everything: every protected ID still present, every deleted ID absent,
   the canonical aliases still bound to the same Production deployment, HTTP 200. Anything else
   stops the run as `postproof-failed`.

A pass with no `SAFE` candidate is complete when the inventory was complete.

## Trusted source

`reconcile` runs only when `scripts/vercel-retention/` and the two `package.json` script entries equal
`origin/main` and the working tree there is clean. An edited, unmerged or divergent checkout is
refused before any provider call. `dry-run` is read-only and has no such requirement.

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
| `gate-not-green:<workflow>` | A required run on the exact `main` SHA is missing, in flight or not a success. |
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
