# GitHub Pages deployment-record reconciliation

Owner: [#1028](https://github.com/qnbs/WorldScript-Studio/issues/1028).
This procedure concerns GitHub deployment **records** for `github-pages` only.
Vercel/provider objects and all other environments are outside its authority.

The workflow remains manually disabled. Merging this implementation neither enables it
nor admits a destructive operator run. Manual dispatch has no deletion input and always
runs read-only. A local read-only inventory needs no workflow enablement:

```sh
node scripts/prune-pages-deployments.mjs --dry-run
node --test tests/unit/tooling/prunePagesDeployments.test.mjs
```

## Retention and ownership

Keep the newest three Pages records, ordered by `created_at` descending then numeric ID
descending. Also retain the current and previous successful publication by successful
status completion order, every explicit rollback/evidence hold, unknown ownership and
unsafe status. Current/rollback protection can add at most two records to the normal
floor; unknown metadata and evidence holds need owner disposition rather than expiry.

Positive ownership requires exact environment/ref/task, a full commit SHA, the GitHub
Actions app identity, canonical Pages URL and an own-repository Actions job log URL.
Before candidate mutation, fetch that run and job: exact `CI / CD` workflow path,
successful completed `main` push, own head repository, matching SHA and successful
Pages deployment job/step. A PR, fork, tag, manual CI, cancelled or failed run supplies
no deletion authority. Records without the app identity are preserved even when their
environment happens to be named `github-pages`.

The six IDs in `.github/pages-pruning-holds.json` are the complete observed Pages
inventory on 2026-10-12. They preserve the existing incident evidence pending #723/#1028
owner disposition; they are not an age grace period for future records. Three records
are currently surplus to the normal newest-three floor. No historical non-execution or
hold release is inferred from the terminal cancelled Actions run. Replace the evidence
list with specifically retained IDs only after that disposition; rollback holds are
independent. Such a change is reviewed on main before it acquires writer authority.

## Trigger and mutation boundary

Daily 03:00 UTC reconciliation includes the existing Sunday backlog pass. There is no
`workflow_run` trigger: this avoids privileged follow-up jobs for PR/fork/failed/manual
CI and separates event completion from publication proof. Only main schedule runs can
write; main dispatch is dry-run. The executing workflow/ref/repository are checked
again in the module, checkout uses the immutable event SHA without persisted credentials,
and a changed main SHA invalidates the hold/executable snapshot before each mutation.
Product CI, required statuses, CodeQL, signing and reviewer governance are unchanged.

One concurrency group serializes pruning invocations; at most ten records are attempted.
Every inactivate and delete operation requires a new complete inventory/status read and
unchanged identity, current publication, protection and status evidence. A failed or
ambiguous inactivation never reaches deletion. `auto_inactive: false` avoids affecting
other records. GET retries are bounded at three and two seconds maximum delay; writes
are never blindly retried. API failures stop the batch, fail the job and report confirmed
partial outcomes with sanitized reason codes. A later pass must re-observe uncertain writes.

GitHub does not offer conditional inactivation/deletion tied to a deployment-status
version. Revalidation detects observed promotion/publication races; it cannot provide a
transaction across the final GET and POST. GitHub refuses DELETE of an active record.
An independent exact-delta review must assess this residual API boundary before merge;
external status writers must not be treated as serialized by the pruning concurrency group.

## Owner reactivation sequence

1. Merge only after exact-head full CI/security/signature/governance success and substantive
   independent review; prove resulting-main CI/CodeQL and Production separately.
2. Record a current, zero-write dry-run; reconcile the evidence holds with their owners.
3. Obtain a separate explicit owner decision to enable the workflow. This PR/CLI does not
   perform that action. Observe the first admitted scheduled pass and assert counts,
   protected IDs and unchanged non-Pages inventory.

Until those steps are complete, implementation/review/operational verification remain
separate states. Trigger-count measurements belong to #550/QNB-41; no monetary or CPU
savings are inferred from workflow-start counts alone.
