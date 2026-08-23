# H1-A CI measurement report

Status: measurement evidence captured; no Node-lane, required-status, DAG, build, or advisory
policy change is proposed by this report.

## Capture boundary

The sample was declared and then filtered with this inclusive UTC window before applying sample
rules:

```text
from = 2026-08-22T16:00:00Z
to   = 2026-08-23T12:00:00Z
```

The live query was made at `2026-08-23T12:14:57Z`. The authoritative base checkpoint for this
measurement branch was main `391dc506fb654d0ea289edb426c633782d141efe`, tree
`a9ee707c6ac497e22509efae8c822a2f6a257503`.

The selection used the latest 50 runs returned by:

```bash
gh run list --workflow ci.yml --limit 50 \
  --json databaseId,workflowName,event,status,conclusion,headSha,headBranch,createdAt,updatedAt,url
```

The declared-window filter returned 50 runs, with first creation time
`2026-08-22T16:51:50Z`, last creation time `2026-08-23T11:44:35Z`, and zero runs outside the
window. Job and step data came from one sequential `gh run view RUN_ID --json ... jobs` query per
run. The report retains run IDs below as immutable external anchors; the method document contains
the complete replay commands.

## Governance snapshot at capture

Read-only GitHub API observation at the capture boundary reported:

| Policy field | Observed value |
| --- | --- |
| Required signatures | enabled |
| Required protected status | exactly `✅ CI Success` |
| Required-check strictness | false |
| Conversation resolution | enabled |
| Force pushes | disabled |
| Branch deletions | disabled |
| Repository rulesets | none returned by `includes_parents=true` |

This is a timestamped observation, not a substitute for re-querying live policy before a future
merge or lane decision. API unavailability must be recorded as `UNKNOWN`, never as compliant.

## Run outcome summary

| Outcome | Runs |
| --- | ---: |
| Success | 26 |
| Failure | 9 |
| Cancelled | 15 |
| Total | 50 |

The sample deliberately includes failed and cancelled runs. A cancelled run is not a pass and is
not silently converted into a flake or a successful rerun.

### Raw run IDs

Success:

```text
32637402322 32636290349 32634953308 32633166716 32632186268
32630810142 32629355521 32628238890 32619581413 32618585506
32617412680 32616003387 32614783075 32613719445 32609989706 32608499439
32603228681 32597183439 32595925936 32593093074 32590481499
32589107539 32588393183 32587547255 32586837622 32586260186
```

Failure:

```text
32606757492 32591940113 32591793311 32591497382 32591335624
32588885980 32588633655 32588474435 32588312445
```

Cancelled:

```text
32613259393 32607921231 32595079664 32593021757 32593016825
32593014591 32593011287 32593009191 32593002260 32592756224
32589061759 32588853161 32588821869 32586591497 32585988531
```

The historical replay found one omitted successful run in the retained list: `32613719445`.
It is part of the original 50-run selection, not a newly substituted run. The authoritative run
record is:

| Field | Value |
| --- | --- |
| Database ID | `32613719445` |
| Workflow | `CI / CD` (`.github/workflows/ci.yml`) |
| Event | `pull_request` |
| Status / conclusion | `completed` / `success` |
| Head SHA | `9af3fa5b46ff129c2b3e9abfbe6552fac816621c` |
| Head branch | `release/v1.28.1` |
| Created / updated | `2026-08-23T02:47:19Z` / `2026-08-23T03:05:56Z` |
| URL | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32613719445> |

The historical replay used the declared window and an expanded run inventory to recover the
original selection; it did not replace the sample with today's latest 50 runs. The restored
outcome groups now contain 26 success IDs, 9 failure IDs, and 15 cancelled IDs: 50 unique IDs with
disjoint groups.

The complete run identity, head SHA, branch, event, URL, and timestamps remain reproducible from
the query in the method document using these IDs. The most relevant current transition runs are:

| Run | Event | Ref | Head | Result |
| ---: | --- | --- | --- | --- |
| 32637402322 | push | `main` | `391dc506…` | success |
| 32636290349 | pull request | `h1-a-f0-evidence` | `6cf9780a…` | success |
| 32634953308 | pull request | `h1-a-f0-evidence` | `0994255d…` | success |
| 32633166716 | push | `main` | `c91e3769…` | success |
| 32632186268 | pull request | `h0-post-merge-ledger` | `b3d944a7…` | success |
| 32630810142 | push | `main` | `476c0ce5…` | success |
| 32629355521 | pull request | H0 correction | `3a140cb3…` | success |
| 32619581413 | push | `main` | `2d63a91d…` | success |
| 32616003387 | push | `v1.28.1` | `b6c40aa3…` | success |
| 32613259393 | pull request | `release/v1.28.1` | `be105c48…` | cancelled |
| 32606757492 | pull request | signing hardening | `2f1567d3…` | failure |
| 32591940113 | pull request | Scenario MVP | `907957c4…` | failure |
| 32588393183 | push | `main` | `40860803…` | success |
| 32585988531 | pull request | #332 overlay | `9cfe0c98…` | cancelled |

## Post-#473 main checkpoint

This is a separate `POST_MERGE_CHECKPOINT` evidence class. It is not appended to, substituted
for, or used to recalculate the original 50-run sample.

| Field | Value |
| --- | --- |
| Workflow run | `32648286172` (`CI / CD`) |
| Event | `push` |
| Head SHA | `a536aeebc09f97b45a3094e05c51dfa8e32922df` |
| Run attempt | `1` |
| Created / started | `2026-08-23T15:21:18Z` / `2026-08-23T15:21:18Z` |
| Completed | `2026-08-23T15:43:55Z` |
| Conclusion | `success` |
| CodeQL | Run `32648286205`, push on the same head, attempt `1`, success |

The checkpoint wall-clock was approximately 22m37s. Job timing from the immutable job records was:

| Job | Started | Completed | Duration |
| --- | --- | --- | ---: |
| Security Audit | 15:21:20Z | 15:22:28Z | 1m08s |
| Verified Signatures | 15:22:31Z | 15:22:41Z | 0m10s |
| Quality Gate (Node 22) | 15:22:30Z | 15:35:04Z | 12m34s |
| Quality Gate (Node 24) | 15:22:30Z | 15:31:14Z | 8m44s |
| Build | 15:35:06Z | 15:37:17Z | 2m11s |
| E2E Deep Coverage | 15:35:06Z | 15:37:29Z | 2m23s |
| Storybook | 15:35:06Z | 15:37:07Z | 2m01s |
| Visual Regression | 15:37:19Z | 15:38:29Z | 1m10s |
| Lighthouse CI | 15:37:19Z | 15:39:44Z | 2m25s |
| E2E Tests | 15:35:06Z | 15:43:51Z | 8m45s |
| `✅ CI Success` | 15:43:53Z | 15:43:55Z | 0m02s |

The checkpoint is within the original workflow-wall-clock P95 and does not by itself justify a
Node-lane, required-status, or DAG decision.

### Attempt and rerun evidence

The GitHub run API reported `run_attempt=1` for all 50 original sample runs and for this checkpoint.
No rerun attempt is represented in the retained sample. This proves that the selected records are
first attempts; it does not prove that a later run for the same branch or change did not succeed.

### Cache evidence

The checkpoint log explicitly reported successful cache restoration for the pnpm/Node cache in the
setup action and for the relevant Playwright browser and APT caches. The log also reported no cache
miss for the inspected checkpoint path. The historical 50-run report did not retain per-job cache
log output, so historical cache hit/miss distribution remains `UNKNOWN`; the setup/cache/install
proxy remains the only comparable historical measure.

### Signal interpretation

The checkpoint passed all applicable jobs, including both Node lanes, browser jobs, and `✅ CI
Success`. It contributes no new failure or lane-exclusive defect signal. The original sample's
unique Node/advisory defect signal therefore remains `UNKNOWN`, and H1-B authority decisions remain
pending.

## Post-#474 main checkpoint

This is a second separate `POST_MERGE_CHECKPOINT` evidence class. It follows the merge of PR #474
and is not appended to, substituted for, or used to recalculate either the original 50-run sample
or the post-#473 checkpoint.

| Field | Value |
| --- | --- |
| Workflow run | `32654048692` (`CI / CD`) |
| Event | `push` |
| Head SHA | `8223d04e0b51443c6490695b0d08a4189bffe3ee` |
| Run attempt | `1` |
| Created / started | `2026-08-23T17:11:44Z` / `2026-08-23T17:11:44Z` |
| Completed | `2026-08-23T17:34:01Z` |
| Conclusion | `success` |
| CodeQL | Run `32654048709`, push on the same head, attempt `1`, success |

The checkpoint wall-clock was approximately 22m17s. Job timing from the immutable job records was:

| Job | Started | Completed | Duration |
| --- | --- | --- | ---: |
| Security Audit | 17:11:46Z | 17:12:40Z | 0m54s |
| Verified Signatures | 17:12:42Z | 17:12:56Z | 0m14s |
| Quality Gate (Node 24) | 17:12:42Z | 17:21:16Z | 8m34s |
| Quality Gate (Node 22) | 17:12:42Z | 17:25:07Z | 12m25s |
| Build | 17:25:10Z | 17:27:09Z | 1m59s |
| E2E Deep Coverage | 17:25:10Z | 17:27:38Z | 2m28s |
| Storybook | 17:25:10Z | 17:26:50Z | 1m40s |
| Visual Regression | 17:27:11Z | 17:28:32Z | 1m21s |
| Lighthouse CI | 17:27:11Z | 17:29:36Z | 2m25s |
| E2E Tests | 17:25:10Z | 17:33:53Z | 8m43s |
| `✅ CI Success` | 17:33:57Z | 17:34:01Z | 0m04s |

The 22m17s checkpoint is within the original workflow-wall-clock P95 and is close to the earlier
22m37s post-#473 checkpoint. It is useful timing evidence, but it does not by itself justify a
Node-lane, required-status, or DAG decision.

### Attempt, rerun, and cache evidence

The GitHub run API reported `run_attempt=1` for this checkpoint. No rerun attempt is represented in
the checkpoint record; this does not prove that no later run for the same branch or change succeeded.

The checkpoint logs explicitly reported successful restoration of the pnpm/Node cache in both Node
quality lanes. The E2E and Deep E2E jobs also restored the pnpm/Node cache, Playwright browser cache,
and Playwright APT dependency cache. Their post-job logs reported cache hits on the primary keys,
not cache saves. The original 50-run sample still has `UNKNOWN` historical cache hit/miss
distribution because its per-job logs were not retained.

### Signal interpretation

The checkpoint passed all applicable jobs, including both Node lanes, browser jobs, security,
signatures, and `✅ CI Success`. It contributes no new failure, cancellation, rerun, or
lane-exclusive defect signal. The original sample's unique Node/advisory defect signal therefore
remains `UNKNOWN`, and H1-B authority decisions remain pending.

## Timing measurements

Durations are calculated from GitHub-created timestamps and job start/completion timestamps. Runner
minutes are the sum of observed job durations, not billed-minute invoices. Queue is the interval
from run creation to the first observed job start. Setup is a timing proxy summing steps whose names
match setup, cache, install, or the repository setup action; it is not a claim that every such step
is pure installation time.

| Measurement | Median (minutes) | P95 (minutes) |
| --- | ---: | ---: |
| Workflow wall-clock | 19.13 | 23.72 |
| Critical path (earliest job start to latest job completion) | 20.22 | 23.38 |
| Observed runner minutes | 38.64 | 45.07 |
| Queue approximation | 0.03 | 0.50 |
| Setup/cache/install proxy | 6.20 | 7.75 |

Runs with no started job have `UNKNOWN` critical path and queue values and are excluded from the
corresponding percentile calculation. This preserves cancelled-before-start evidence without
inventing duration.

## Node-lane evidence

Both Node lanes were present in 43 of the 50 sampled workflow runs. Their observed job results were:

| Lane | Observed jobs | Success | Failure | Cancelled | Median | P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node 22 | 43 | 28 | 9 | 6 | 10.60 min | 13.42 min |
| Node 24 | 43 | 28 | 9 | 6 | 10.52 min | 11.68 min |

All 43 runs had both lanes. There were 28 runs where both lanes succeeded, 9 where both failed,
and 6 where both were cancelled. No Node-22-only or Node-24-only failure occurred in this sample.
That is an overlap observation, not proof that the lanes detect identical defects: unique defect
signal is not labelled by the GitHub run API and remains `UNKNOWN` until failure causes and test
results are classified.

Node 26 is absent from the executable workflow and remains a measurement hypothesis only. No lane
authority change is made here.

## Advisory and downstream job evidence

The following jobs emitted a job record in 45 of the 50 runs. `Observed` counts emitted job
records, and the outcome columns are mutually exclusive and exhaustive for those records. The
remaining 5 runs emitted no record for each listed job; absence is not treated as success. Timing
percentiles use the 36 non-skipped records with a usable positive duration. Skipped records are
reported explicitly and are not included in timing percentiles.

| Job | Observed | Success | Failure | Cancelled | Skipped | Other/Unknown | Timed | Median | P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Storybook | 45 | 27 | 0 | 9 | 9 | 0 | 36 | 1.63 min | 1.92 min |
| E2E Deep Coverage | 45 | 27 | 0 | 9 | 9 | 0 | 36 | 2.27 min | 2.72 min |
| Visual Regression | 45 | 26 | 0 | 10 | 9 | 0 | 36 | 1.22 min | 1.58 min |
| Lighthouse CI | 45 | 26 | 0 | 10 | 9 | 0 | 36 | 2.19 min | 2.47 min |
| E2E Tests | 45 | 26 | 0 | 10 | 9 | 0 | 36 | 8.75 min | 9.32 min |

The `✅ CI Success` job was observed in 45 runs: 26 success, 19 failure, 0 cancelled, 0 skipped,
and 0 other/unknown conclusions. Its timing sample was 45 jobs, with a median of 0.05 minutes and
P95 of 0.07 minutes. That aggregator result reflects the workflow's handling of failed/cancelled
upstream evidence; it is not used to erase the underlying run outcome distribution.

No unique-defect labels, reviewer findings, cache hit/miss facts, or billed runner-minute values are
available from this aggregate query. Those fields remain `UNKNOWN` until the relevant job logs,
artifacts, check-runs, review threads, or billing data are independently classified.

## Reliability and review limitations

- First-attempt versus rerun status was not exposed in the retained run-list fields: `UNKNOWN`.
- Cancellation and supersession are observed through cancelled conclusions and close timestamps;
  exact concurrency-cancellation causality is `UNKNOWN` without per-run event correlation.
- External reviewer silence, rate limits, skipped integrations, and billing/quota failures are not
  clean-review evidence. Per-head check-runs, statuses, comments, submitted reviews, and GraphQL
  review threads remain separate evidence surfaces.
- Rust-relevant changes are represented only when the web workflow records a path-scoped Rust gate;
  this sample does not qualify desktop packaging or Intel runners.
- Artifact volume and billed runner cost are `UNKNOWN` from the ordinary run/job API query.

## Decision boundary

This report establishes the H1-A evidence baseline. It does not select Node 24 as canonical, demote
Node 22, add Node 26, promote Storybook or Deep E2E, or restructure the DAG. Those decisions require
failure-cause classification, advisory unique-signal review, workflow-authority reconciliation, and
the H1-B/H1-C evidence gates. The next task is to classify the sampled failures/cancellations and
compare the measured overlap against the final required-versus-advisory policy before proposing any
workflow change.
