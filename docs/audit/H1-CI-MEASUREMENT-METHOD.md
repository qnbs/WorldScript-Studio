# H1-A CI measurement method

Status: evidence-only method established; no Node lane, required-status, DAG, build, or advisory
policy change is made by this document.

## Purpose

H1-A measures the current CI system before changing lane ownership or graph structure. The target
sample is approximately 30–50 representative `CI / CD` runs, selected by explicit criteria rather
than by choosing only successful runs. The resulting measurements will support, but do not
pre-judge, the Node 22/24/26 and required/advisory decisions.

## Authority and query method

Workflow definitions and GitHub run/job APIs are the measurement authorities. Repository prose is
used only to explain a result. Run data is read through the authenticated GitHub CLI; credentials
and tokens must never be written to output or files. Before classifying a check as required or
advisory, capture the UTC query time and the protected-base policy from GitHub:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
gh api repos/OWNER/REPO/branches/main/protection
gh api 'repos/OWNER/REPO/rulesets?includes_parents=true'
```

Retain the relevant policy fields and query timestamp in the H1-A report. If either policy query is
unavailable, record `UNKNOWN` with the error; run success is not evidence of required status.

The repeatable run inventory query is:

```bash
gh run list --workflow ci.yml --limit 100 \
  --json databaseId,workflowName,event,status,conclusion,headSha,headBranch,createdAt,updatedAt,url
```

For every included run, capture job-level evidence with:

```bash
gh run view RUN_ID --json databaseId,workflowName,event,status,conclusion,headSha,headBranch,createdAt,updatedAt,jobs,url
```

For each sampled pull request/head, capture independent check and review evidence rather than
inferring it from workflow runs:

```bash
gh pr checks PR_NUMBER
gh api repos/OWNER/REPO/commits/HEAD_SHA/check-runs --paginate
gh api repos/OWNER/REPO/commits/HEAD_SHA/statuses --paginate
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments --paginate
gh api repos/OWNER/REPO/issues/PR_NUMBER/comments --paginate
gh api repos/OWNER/REPO/pulls/PR_NUMBER/reviews --paginate
gh api graphql -F owner=OWNER -F repo=REPO -F number=PR_NUMBER \
  -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated}}}}}'
```

If the API, authentication, or retention window prevents observation, record `UNKNOWN` and the
query failure. Unavailable observation is not a pass, a zero, or a clean run.

## Sample-selection rules

The H1-A report must declare an inclusive UTC `from` and `to` time window *before* selecting runs
or applying exclusions. Every included and excluded run is evaluated against that fixed window.
The report records the query timestamp separately from the sample window.

Include enough variation to represent:

- pull-request and `main` push runs;
- documentation-only, frontend, build-affecting, and Rust-relevant changes where available;
- warm and cold cache behavior where the job data exposes it;
- first-attempt failures, reruns, cancellations, and superseded runs;
- advisory surfaces including Storybook, Deep E2E, VRT, Lighthouse, CodeQL, and external review
  checks when present.

Do not silently exclude a failed or cancelled run. Exclusions require a recorded reason such as
duplicate API pagination, a run outside the declared inclusive UTC window, or an unrelated
workflow. A sample is not representative merely because every included run is green.

## Required fields

The evidence record should retain, where available:

| Group | Fields |
| --- | --- |
| Run identity | run ID, workflow, event, branch, head SHA, URL, created/completed timestamps, conclusion |
| Job timing | job name, job ID, queued/start/completed timestamps, duration, conclusion, skipped/cancelled state |
| Setup | runner label, Node lane, install/setup duration, cache hit/miss indicators |
| Reliability | first attempt, rerun relationship, failure class, cancellation/supersession, API/runner failure |
| Authority | required/advisory classification at capture time, inclusion in `✅ CI Success`, `continue-on-error`, path-skip reason |
| Cost/signal | runner minutes when observable, artifacts, duplicate work, unique defect signal, advisory findings |

When GitHub does not expose a value directly, retain the field as `UNKNOWN` rather than deriving a
false precision from wall-clock timestamps.

## Analysis outputs

The eventual H1-A report must calculate:

- median and P95 wall-clock and critical-path duration;
- queue/setup/install contribution;
- runner minutes and artifact volume where available;
- cache hit/miss behavior;
- first-attempt failure, rerun, cancellation, and flake indicators;
- Node 22 versus Node 24 overlap and unique defect signal;
- advisory job runtime, failure, flake, and unique signal;
- duplicated work and any safe parallelization opportunity.

No lane becomes canonical, compatibility-only, scheduled, or advisory from this method alone. The
decision must be recorded after the sample and H1-B authority review are complete.

## Current baseline boundary

At method creation, the executable CI matrix is Node 22 and Node 24. Node 26 is not present in the
workflow and remains a hypothesis for measurement, not a promised lane. The current protection
authority is exactly `✅ CI Success`; GitHub required status and repository policy/advisory evidence
must remain separate in the analysis.

This document intentionally does not contain copied p50/p95 values. Raw run IDs and derived metrics
belong in the H1-A evidence report, not in agent entrypoints or duplicated instruction files.
