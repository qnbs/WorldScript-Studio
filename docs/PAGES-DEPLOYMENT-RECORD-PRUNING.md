# GitHub Pages deployment-record reconciliation

Owner: [#1028](https://github.com/qnbs/WorldScript-Studio/issues/1028).
This procedure concerns GitHub deployment **records** for `github-pages` only.
Vercel/provider objects and all other environments are outside its authority.

**Status: admitted by this reviewed change, switched on separately.** The destructive path is
open exactly where all of these hold together: `DESTRUCTIVE_WRITES_ADMITTED` in
`scripts/pages-pruning/policy.mjs` is `true`, the job token holds `deployments: write` (a test pins
that the permission and the constant move together), the trigger is the `schedule` of `main`, and
the workflow is enabled in the Actions UI, which is a separate operator step after the
resulting-`main` proof (owner sequence below). Manual dispatch has no deletion input and always
runs read-only, as does `--dry-run`. If the constant is set back to `false` the same code runs the
full read-only reconciliation and reports `destructive-gate-closed`. A local read-only inventory
needs no workflow enablement:

```sh
node scripts/prune-pages-deployments.mjs --dry-run
node --test tests/unit/tooling/prunePagesDeployments.test.mjs
```

The local command asks `gh` for the `github.com` token explicitly (`gh auth token --hostname
github.com`), so `GH_HOST` or an enterprise default can never hand a credential for another host
to `api.github.com`; it only issues GET requests.

## Retention and ownership

Keep the newest three Pages records, ordered by `created_at` descending then numeric ID
descending. Also retain the current and previous **proven** successful publication by successful
status completion order, every explicit rollback/evidence hold, unknown ownership, unproved
publications and unsafe status. Current/rollback protection can add at most two records to the
normal floor; unknown metadata and evidence holds need owner disposition rather than expiry.

The six IDs in `.github/pages-pruning-holds.json` are the complete observed Pages inventory on
2026-10-12. They preserve the existing incident evidence pending #723/#1028 owner disposition; they
are not an age grace period for future records. No historical non-execution or hold release is
inferred from the terminal cancelled Actions run. Replace the evidence list with specifically
retained IDs only after that disposition; rollback holds are independent. Such a change is reviewed
on main before it acquires writer authority.

## Publication proof

`deployment_status.log_url` is written by the status author, so a matching job URL proves nothing
on its own. A record is deletable only after all of these hold, read fresh from the API:

- deployment shape: `github-pages`, `main`, task `deploy`, full SHA, non-transient, non-production,
  no GitHub App other than Actions, an identified author, and a newest success status for the
  Pages site (the same shape the classifier requires, so a record it would call unknown ownership
  can neither occupy the current or rollback slot nor be proven);
- the referenced run is the own-repository `CI / CD` run on `main` for the same SHA, started by a
  `push` or a `workflow_dispatch` (the only non-pull-request events `ci.yml` can publish from; a
  test binds this set to the workflow file), completed successfully, and its job
  `🚀 Deploy to GitHub Pages` (same run, same head SHA) and step `Deploy to GitHub Pages`
  succeeded. The workflow path is `.github/workflows/ci.yml`, with or without GitHub's documented
  `@main` / `@refs/heads/main` suffix (live runs report it without one); any other file or ref
  does not prove;
- **causal link:** the deployment record and its newest success status were authored by the actor
  or triggering actor of that run, matched by numeric account id and login together (an author
  without a valid id never matches), and neither author is `github-actions[bot]`.

The causal link is what a `GITHUB_TOKEN` writer cannot imitate: any other workflow writes as
`github-actions[bot]`, while the Pages publisher records the principal that triggered the run.
Observed on all six live records on 2026-10-13: deployment author, status author and run actor
agree in 6/6 (`qnbs` and `cursor[bot]`); the bot-triggered records carry no GitHub App,
which is why the App identity is accepted as absent rather than required. Time-window matching was
rejected: the success status falls outside the job's `started_at..completed_at` in 3 of 6 records.

Residual: a principal holding the run actor's own credentials can still write matching records.
That principal can delete records directly, so this adds no new authority. If the proof cannot be
established for a record (run deleted, fields missing, mismatch), the record is protected as
`unproved-publication`; it is never deleted and never blocks the rest of the batch.

Proof costs two requests per record. Eligible records are examined newest first until 20 of them
are proven, even though only ten can be deleted. A record that cannot be proven is protected and
does not count against those 20, so unprovable newest records cannot hide older provable ones;
the scan ends early only when the budget left would no longer fund one more proof plus the cost of
one candidate, which is kept for the mutation phase. Eligible records not examined are reported as
`unexamined`: they are not counted or listed as candidates and are never deleted until a later pass
examines them.

## Current and rollback slots

Both publication slots are proven by API before any candidate is classified. The newest success
must prove or the run stops (`unproved-current`). Up to four older successes are walked in order;
an unproved one is protected and does not consume the rollback slot, and the first proven one is
the rollback. If none proves, the run stops (`no-proven-rollback`). Shape-only classification
exists for the pure plan and never authorizes a write. When no record is eligible for deletion the
slots are not proven at all: they can only retain, so an empty plan needs no evidence. When a proof
stops the run, the manifest still lists every record as protected or unexamined.

## Trigger and mutation boundary

Daily 03:00 UTC reconciliation includes the existing Sunday backlog pass. There is no
`workflow_run` trigger: this avoids privileged follow-up jobs for PR/fork/failed/manual CI and
separates event completion from publication proof. Only main schedule runs can write (once the gate
is open); main dispatch is dry-run. The executing workflow/ref/repository are checked again in the
module, checkout uses the immutable event SHA without persisted credentials, and a changed main SHA
invalidates the hold/executable snapshot before each mutation.

At most ten records are attempted per invocation. Every inactivate and delete operation requires a
fresh read of the deployment list plus the full status history of the candidate and of both
publication slots, an unchanged publication-order prefix, an unchanged candidate fingerprint and
the trusted-main SHA. The run and job evidence of the candidate and of both slots is read again
at each of those two boundaries, bypassing the proof cache, so evidence that was deleted or became
unreadable since classification stops the run before the write (`unknown-publication`). Other
records are re-read only when their list entry (including `updated_at`)
changed; GitHub bumped `updated_at` past the newest status on all six live records, but that is an
optimization, not the authority for the candidate or the slots. At most three such unfocused
records may need a reload in one refresh; more churn than that stops the run
(`inventory-churn`) before any history is read, so the cost ceilings below always hold. The
inactive-status POST is skipped only when the latest status is already an inactive Pages status
(environment `github-pages`, the Pages site URL) with an identified author; any other latest
status, including an inactive one of unknown origin, gets this run's own inactive status first, so
deletion authority never rests on unvalidated status metadata. The status this run creates must
come back from the API as a recognised inactive Pages status before the DELETE
(`inactive-status-unrecognized` otherwise). A failed or ambiguous inactivation never reaches
deletion. `auto_inactive: false` avoids affecting other records. GET retries are
bounded at three attempts and two seconds maximum delay; writes are never retried. API failures
stop the batch, fail the job and report confirmed partial outcomes with sanitized reason codes. A
later pass must re-observe uncertain writes.

### Pagination

GitHub returns `rel="next"` links under `/repositories/{id}/…` rather than `/repos/{owner}/{repo}/…`.
Both forms are accepted only for the verified repository ID (one extra read of the repository),
the API origin, the exact next page and the original query. Any other origin, path, extra,
changed or duplicated parameter, or malformed link fails closed.

### Request budget

A run spends at most 450 requests (45% of GitHub's documented 1,000 requests per hour and
repository for `GITHUB_TOKEN`, shared with CI); the live `x-ratelimit-remaining` header can only
lower that. Before each candidate the run reserves its full cost: two complete refreshes (the
deployment list pages, the three focused histories and up to three more reloads, each allowed one
more page, the main read), the POST and DELETE, and a worst-case re-proof of both slots and the
candidate (twice, once per write boundary). The reservation is computed from the page depths
observed in this run, from 42 requests for a small inventory to 96 for a 400-record list with
five-page histories, and the run stops gracefully with `budget-limit`
instead of leaving a half-finished candidate. Reads are retried up to twice, so immediately before
the first write of a candidate the run also reserves everything after the inactive-status POST at
three attempts per read plus the DELETE (70 requests for a small inventory, 151 for the
400-record case) and otherwise stops without writing. Both reservations are also checked against
the live `x-ratelimit-remaining` value last reported by GitHub, with a reserve of 100 requests kept
for CI. The same check gates the proof scan, the POST and a DELETE that needs no POST; none of them
is issued when the last reported allowance cannot cover it (other consumers of the same token can
still lower it afterwards). Every read, retries and the whole inventory included, is also gated
by the live allowance before it is sent: a read that would leave fewer than 100 requests stops the
run with `rate-reserve`, and once a response has succeeded any later successful response without
a usable rate header stops it with `rate-unknown` (the allowance is replaced, never kept stale), so
the local 450 counter is never the only brake. The rate headers of failed reads
and writes count too, so a run of 404 responses cannot spend the reserve unnoticed. A budget refusal before a candidate's first
write (a retry storm in its first revalidation) is the same graceful `budget-limit` stop; after the
POST it stays a failure. An inventory that alone exceeds the budget fails
closed with `request-budget` before any write. Measured by the test fixture (GET + POST + DELETE,
ten candidates):

| Records | Previous design (full re-inventory per write) | This design |
| ---: | ---: | ---: |
| 6 | – | 90 |
| 50 | ≈1,214 | 336 |
| 100 | ≈2,264 | 389 |
| 200 | ≈4,364 | 392 (stops after 5 deletions) |
| 300 | ≈6,464 | 392 (stops after 1 deletion) |

A read-only dry-run costs 18, 96, 147 and 349 requests for 6, 50, 100 and 300 records.

## Writer fence

GitHub offers no compare-and-delete tied to a status version, so no check can make the final read
and the write atomic. The fence is therefore a bounded one, and this is exactly what it covers:

1. **What a DELETE can reach.** Only a record that, at the last read, is not among the newest
   three, not the current or rollback publication, not held, has proven provenance, and whose
   latest status is an inactive Pages status that this run recognised. The record is deployment
   metadata: deleting it does not remove the published site, and the current and rollback records
   are never candidates.
2. **Two write boundaries.** Before the inactive-status POST and again before the DELETE, the run
   re-reads the list, the candidate and both slot histories, re-proves their runs and jobs and
   re-reads `main`; the last of those reads ends the check, and nothing but a budget decision
   (no request) stands between it and the DELETE. The exposure is that one round trip.
3. **Failure is closed.** Any mid-run change in the publication order, the candidate, the slots,
   the inventory or `main` stops the run before the write; a failed or ambiguous POST never reaches
   the DELETE; writes are never retried; an unknown or spent rate allowance stops the run after the
   POST with the record left inactive (`rate-unknown`, `rate-reserve`).

| Writer | Effect on a chosen candidate | Handling |
| --- | --- | --- |
| Pages publisher (`ci.yml` `deploy`) | A publication creates a **new** record; it cannot give an old record a success status. A stale snapshot is therefore never less protective than the fresh state (a test checks this for successful, failed and in-flight arrivals). | Structurally safe; a publication that lands anywhere before the last read stops the run (`current-moved`), also between the two boundaries (tested). One landing inside the final round trip cannot make a candidate protected, only add a newer record. |
| In-repository status writers | None other than the publisher and this workflow exist; a test pins the set of workflows that can write deployment records. | Mechanical. |
| Changes to the hold list on main | A hold landing between the final trusted-main check and the DELETE would not stop that delete. | **Bounded residual:** one round trip. The hold file is read at the executing SHA and `main` is re-read before each write, so a hold merged earlier always stops the run. A hold that must survive a run in progress is protected by disabling the workflow first (`gh workflow disable`), which is the documented procedure for a new hold. |
| External status writers (PAT holders, third-party Apps) | Could add a success status to an old record. | **Bounded residual:** a write inside the same round trip. The principal holds credentials that can delete the record directly, so this adds no authority (see the publication-proof residual); any earlier write changes the candidate fingerprint or the order and stops the run. |

The pruning concurrency group serializes pruning invocations only. It does not serialize the
publisher, hold changes or external writers, and must not be read as a fence. The publisher is
deliberately not put into a shared group: a queued deploy can be replaced by a newer pending run.

## Capacity

Verified from the Actions API: 44 successful `CI / CD` runs on `main` in the 7 days to 2026-10-13
(mean ≈6.3 per day, one day with 15, then 8, 10, 8, 2, 1). Each success publishes one record. One
pass retires at most ten, so the mean leaves ≈3.7 per day of headroom and a 15-run day leaves a
backlog of five that the following days absorb. The run reports `batch-limit` or `budget-limit`
and raises an Actions warning when a backlog remains. If that warning persists over three
consecutive scheduled runs, raising the cadence (for example `0 3,15 * * *`) is an owner decision;
`workflow_run` triggers on PR CI are not an option. Trigger-count and runner-minute measurements
belong to #550/QNB-41; no monetary or CPU savings are inferred from workflow-start counts alone.

## Owner enablement sequence

1. The reviewed change that sets `DESTRUCTIVE_WRITES_ADMITTED` to `true` and grants
   `deployments: write` to the job merges only after exact-head full CI/security/signature/
   governance success and substantive independent review; resulting-`main` CI/CodeQL and the
   Pages deployment are proven separately. Merging it enables nothing: the workflow stays
   disabled in the Actions UI.
2. Record a current, zero-write dry-run on the new `main` (`node scripts/prune-pages-deployments.mjs
   --dry-run`) with `UNKNOWN = 0`, the current and rollback publication, the six evidence holds and
   the newest three; check the site over HTTPS.
3. Enable the workflow (`gh workflow enable prune-deployments.yml`) as a separate operator action
   and observe the first scheduled or dispatched-with-writes-admitted pass: at most ten records
   deleted, every protected ID and every other environment unchanged, site still healthy.
4. Any `UNKNOWN`, 404/409/429, header-less allowance, protected-object change or fence doubt stops
   the run; the response is `gh workflow disable prune-deployments.yml` until the cause is
   repaired.

Implementation, review and operational verification remain separate states.
