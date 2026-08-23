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
32617412680 32616003387 32614783075 32609989706 32608499439
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
```

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

The following jobs were observable in 45 of the 50 runs. Missing jobs are retained as missing or
path/concurrency effects, not treated as successful results.

| Job | Observed | Success | Failure | Cancelled | Median | P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Storybook | 45 | 27 | 0 | 9 | 1.63 min | 1.92 min |
| E2E Deep Coverage | 45 | 27 | 0 | 9 | 2.27 min | 2.72 min |
| Visual Regression | 45 | 26 | 0 | 10 | 1.22 min | 1.58 min |
| Lighthouse CI | 45 | 26 | 0 | 10 | 2.19 min | 2.47 min |
| E2E Tests | 45 | 26 | 0 | 10 | 8.75 min | 9.32 min |

The `✅ CI Success` job was observed in 45 runs: 26 success and 19 failure conclusions. That
aggregator result reflects the workflow's handling of failed/cancelled upstream evidence; it is not
used to erase the underlying run outcome distribution.

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
