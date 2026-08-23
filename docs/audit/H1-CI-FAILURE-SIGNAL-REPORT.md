# H1-A CI failure, cancellation, and unique-signal report

Status: evidence slice complete for the currently observable sample. This report classifies the 9 failed and 15 cancelled runs
from the 50-run H1-A sample. It proposes no Node-lane, required-status, DAG, build, or advisory
policy change.

## Evidence method

The source sample is the reconciled 50-run selection recorded in
[`H1-CI-MEASUREMENT-REPORT.md`](H1-CI-MEASUREMENT-REPORT.md). For each failed or cancelled run,
the classification used the GitHub Actions run and job APIs, including `run_attempt`, event,
branch, head SHA, timestamps, job conclusions, failed step names, and the available Vitest JSON
artifacts. The workflow's PR concurrency policy was read from `.github/workflows/ci.yml`:

The original H1-A capture window was inclusive UTC `from=2026-08-22T16:00:00Z` through
`to=2026-08-23T12:00:00Z`. The original `gh run list` query was recorded at
`2026-08-23T12:14:57Z`; the historical replay used the window and retained run IDs rather than
replacing the sample with today's latest 50 runs.

```yaml
group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.head_ref || github.ref_name }}
cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

All 24 investigated runs have `run_attempt=1`. No run in this slice is represented as a rerun or
as a first-attempt success after a rerun.

## Failure classification

All 9 failure runs failed in both Node lanes. The `✅ CI Success` failures are derivative
aggregator failures and are not counted as additional root causes.

| Classification | Runs | Node 22 / Node 24 evidence | Root-cause evidence |
| --- | --- | --- | --- |
| Documentation-metric drift | `32591793311`, `32591497382`, `32588885980`, `32588633655`, `32588474435`, `32588312445` | Both lanes failed at `Doc metrics drift gate` | The hosted log reported `README.md` claiming `6928 tests / 570 files` while the source set expected `6928 tests / 571 files`. This is a stale synchronized metric at the historical heads, not a runner failure. |
| Biome lint defect | `32591335624` | Both lanes failed at `Lint (Biome)` | The log reported one blocking A11y error for `aria-label` on a `span` in `components/ScenarioWorkspaceView.tsx`; it also reported fixable `useTemplate` diagnostics in `tests/unit/tooling/strykerWorkflowPolicy.test.ts`. |
| Workflow-policy test defect | `32606757492` | Both lanes failed at `Unit tests (Vitest, no retry)` | The Vitest artifact identified `tests/unit/workflowPolicy.test.ts`: the required/advisory job list assertion differed between the historical test expectation and the workflow. The failure is a repository policy-oracle mismatch, not a signing or runner failure. |
| Scenario projection test defect | `32591940113` | Both lanes failed at `Unit tests (Vitest, no retry)` | The Vitest artifact identified `tests/unit/scenarioWorkspaceProjection.test.ts:18`, where the projection object differed from the expected fixture. The current merged projection function produces the documented fixture when invoked directly; this report does not claim the historical branch was green. |

The 9 failures therefore contain 9 correlated Node-lane observations and zero Node-22-only or
Node-24-only failures. Correlation across lanes is not evidence that the lanes have identical
unique defect-detection power.

## Cancellation classification

Every cancelled run was a pull-request run with `run_attempt=1`. Each had a newer run on the same
PR head branch created before the cancelled run's `updated_at`. Under the workflow's branch-based
PR concurrency group and `cancel-in-progress: true`, this is strong reproducible evidence of
concurrency supersession.

| Cancelled run | Cancelled branch | Cancelled head | Cancelled created_at | Cancelled updated_at | Cancelled URL | Superseding run | Superseding branch | Superseding head | Superseding created_at | Superseding updated_at | Superseding URL |
| ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `32613259393` | `release/v1.28.1` | `be105c48cee4ea9b7266ca96eed5ac080286dfdb` | `2026-08-23T02:35:58Z` | `2026-08-23T02:47:47Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32613259393> | `32613719445` | `release/v1.28.1` | `9af3fa5b46ff129c2b3e9abfbe6552fac816621c` | `2026-08-23T02:47:19Z` | `2026-08-23T03:05:56Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32613719445> |
| `32607921231` | `chore/verified-signing-hardening-v1.28.1` | `5b77930be41d65e03f88fa17a2a190f99f15cad2` | `2026-08-23T00:27:50Z` | `2026-08-23T00:41:47Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32607921231> | `32608499439` | `chore/verified-signing-hardening-v1.28.1` | `c9eb3ad5891ba00e7bde49f95c1f992027413e12` | `2026-08-23T00:41:23Z` | `2026-08-23T01:02:02Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32608499439> |
| `32595079664` | `feat/scenario-workspace-mvp` | `5d0f8a10834d66ddc57c18051fea2278a5e1d0bf` | `2026-08-22T19:54:03Z` | `2026-08-22T20:11:17Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32595079664> | `32595925936` | `feat/scenario-workspace-mvp` | `891d539e8291a8d6e3ebd392bd8d65ca70974afa` | `2026-08-22T20:10:54Z` | `2026-08-22T20:34:37Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32595925936> |
| `32593021757` | `feat/scenario-workspace-mvp` | `40305da5ae1a037a54b8f5daa87095c77cdf0da7` | `2026-08-22T19:12:21Z` | `2026-08-22T19:14:00Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593021757> | `32593093074` | `feat/scenario-workspace-mvp` | `b0523f689c79c5eafda304f81df6aa6e95d193c8` | `2026-08-22T19:13:48Z` | `2026-08-22T19:35:38Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593093074> |
| `32593016825` | `feat/scenario-workspace-mvp` | `7d3a96550dd3501c38fb951f660cea7e9fc3fe74` | `2026-08-22T19:12:14Z` | `2026-08-22T19:12:22Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593016825> | `32593021757` | `feat/scenario-workspace-mvp` | `40305da5ae1a037a54b8f5daa87095c77cdf0da7` | `2026-08-22T19:12:21Z` | `2026-08-22T19:14:00Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593021757> |
| `32593014591` | `feat/scenario-workspace-mvp` | `9dd98c1109ec5b83ee273be4e1b5b7af99cbde5c` | `2026-08-22T19:12:12Z` | `2026-08-22T19:12:16Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593014591> | `32593016825` | `feat/scenario-workspace-mvp` | `7d3a96550dd3501c38fb951f660cea7e9fc3fe74` | `2026-08-22T19:12:14Z` | `2026-08-22T19:12:22Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593016825> |
| `32593011287` | `feat/scenario-workspace-mvp` | `2ea418368ee5185f9ce12451fda04802ab543cbd` | `2026-08-22T19:12:07Z` | `2026-08-22T19:12:13Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593011287> | `32593014591` | `feat/scenario-workspace-mvp` | `9dd98c1109ec5b83ee273be4e1b5b7af99cbde5c` | `2026-08-22T19:12:12Z` | `2026-08-22T19:12:16Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593014591> |
| `32593009191` | `feat/scenario-workspace-mvp` | `7ee1fa930398a29fee3f730de87d5fc16730b35b` | `2026-08-22T19:12:05Z` | `2026-08-22T19:12:09Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593009191> | `32593011287` | `feat/scenario-workspace-mvp` | `2ea418368ee5185f9ce12451fda04802ab543cbd` | `2026-08-22T19:12:07Z` | `2026-08-22T19:12:13Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593011287> |
| `32593002260` | `feat/scenario-workspace-mvp` | `6bb03699be7b146de5d72409f4a4ff1da0dc4210` | `2026-08-22T19:11:57Z` | `2026-08-22T19:12:06Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593002260> | `32593009191` | `feat/scenario-workspace-mvp` | `7ee1fa930398a29fee3f730de87d5fc16730b35b` | `2026-08-22T19:12:05Z` | `2026-08-22T19:12:09Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593009191> |
| `32592756224` | `feat/scenario-workspace-mvp` | `2a1b09b324313f15c96a3e862142c8487db657ea` | `2026-08-22T19:06:59Z` | `2026-08-22T19:12:24Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32592756224> | `32593002260` | `feat/scenario-workspace-mvp` | `6bb03699be7b146de5d72409f4a4ff1da0dc4210` | `2026-08-22T19:11:57Z` | `2026-08-22T19:12:06Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32593002260> |
| `32589061759` | `fix/332-persistence-coordination` | `8f506e1229b5a3764c52ba112b5348d33962bad9` | `2026-08-22T17:52:45Z` | `2026-08-22T17:53:47Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32589061759> | `32589107539` | `fix/332-persistence-coordination` | `593587a9d02e04f3494967df2dd209f12d0450ef` | `2026-08-22T17:53:40Z` | `2026-08-22T18:16:48Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32589107539> |
| `32588853161` | `fix/332-persistence-coordination` | `7419991e3ab9485c75f9c33a68bcda34c30ccb5b` | `2026-08-22T17:48:38Z` | `2026-08-22T17:49:25Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32588853161> | `32588885980` | `fix/332-persistence-coordination` | `6b8c66086a582657a5b762a37b6b3611a2dcb3aa` | `2026-08-22T17:49:17Z` | `2026-08-22T17:51:28Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32588885980> |
| `32588821869` | `fix/332-persistence-coordination` | `4468c387cc701304499ffd54aad7b72334a212b4` | `2026-08-22T17:47:58Z` | `2026-08-22T17:48:54Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32588821869> | `32588853161` | `fix/332-persistence-coordination` | `7419991e3ab9485c75f9c33a68bcda34c30ccb5b` | `2026-08-22T17:48:38Z` | `2026-08-22T17:49:25Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32588853161> |
| `32586591497` | `incident/332-qt-lifecycle-gates` | `c728fbd17fef0b807a6398e6121fe65de3da8a7e` | `2026-08-22T17:03:38Z` | `2026-08-22T17:09:08Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32586591497> | `32586837622` | `incident/332-qt-lifecycle-gates` | `c91a33332d9f565cb4d9308011278d2287d5f972` | `2026-08-22T17:08:39Z` | `2026-08-22T17:33:47Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32586837622> |
| `32585988531` | `fix/332-overlay-focus-feedback` | `9cfe0c98c4e191307521f63c83f3745f5997a39e` | `2026-08-22T16:51:50Z` | `2026-08-22T16:57:41Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32585988531> | `32586260186` | `fix/332-overlay-focus-feedback` | `0da864cb7676124d7d442ccca84e27892081ff28` | `2026-08-22T16:57:11Z` | `2026-08-22T17:20:23Z` | <https://github.com/qnbs/WorldScript-Studio/actions/runs/32586260186> |

The API data does not expose a cancellation actor or a separate causal enum. Accordingly, the
classification is `CONCURRENCY_SUPERSESSION` based on the workflow rule and timestamp ordering;
manual cancellation, infrastructure cancellation, and intentional cancellation are not claimed
independently. There is no evidence in this sample requiring an `UNKNOWN` cancellation bucket.

## Node-lane comparison

The 43 runs with two separately identifiable Node jobs reconcile as follows. The `both lanes
success` category includes two runs whose Node jobs succeeded before the overall workflow was
cancelled in downstream jobs; it is a job-outcome category, not a workflow-run conclusion.

| Pair outcome | Runs |
| --- | ---: |
| Both lanes success | 28 |
| Both lanes failure | 9 |
| Both lanes cancelled | 6 |
| Node-22-only failure | 0 |
| Node-24-only failure | 0 |
| Mixed result pair | 0 |
| Not separately identifiable as a pair | 7 |

All 43 paired runs had both lanes. The seven remaining runs are all cancelled: five emitted no
Node job record before supersession, and two exposed only an unresolved
`Node ${{ matrix.node-version }}` job name, so their lane cannot be assigned to Node 22 or Node 24.
Thus `43 paired + 7 not separately identifiable = 50 sampled runs`, and no sampled run is
unaccounted for. The 9 paired failures map to the four root-cause classes above. This establishes
overlap in the sample, not a Node authority decision. Node 24 is not promoted, Node 22 is not
demoted, and Node 26 is not introduced.

## Downstream job evidence and unique signal

The aggregate job data contains no downstream job failures in the sample. These jobs participate
in the workflow's downstream/aggregator evidence with different required or advisory semantics;
this report does not decide that policy. Explicit outcome arithmetic is:

| Job | Observed | Success | Failure | Cancelled | Skipped | Other/Unknown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Storybook | 45 | 27 | 0 | 9 | 9 | 0 |
| E2E Deep Coverage | 45 | 27 | 0 | 9 | 9 | 0 |
| Visual Regression | 45 | 26 | 0 | 10 | 9 | 0 |
| Lighthouse CI | 45 | 26 | 0 | 10 | 9 | 0 |
| E2E Tests | 45 | 26 | 0 | 10 | 9 | 0 |

The remaining five runs emitted no job record for each listed downstream job; absence is distinct
from `conclusion=skipped`. The `✅ CI Success` aggregator was observed in 45 runs as 26 success
and 19 failure, with no cancelled, skipped, or other conclusion.

Thus the observed downstream failure signal is zero. The unique-defect signal remains `UNKNOWN`,
because aggregate success/cancellation/skipping cannot prove that an advisory lane would or would
not detect a defect missed by another lane. No Storybook, Deep E2E, VRT, Lighthouse, or E2E job
failure is available in this sample to support promotion or demotion.

## Decision boundary and residual limits

- The sample's 9 failures are classified as historical repository defects or policy-oracle drift,
  not as Node-specific or runner-specific failures.
- All 15 cancellations are strongly evidenced as PR concurrency supersession; GitHub does not
  expose an actor-level cancellation reason in the captured run records.
- All investigated runs are first attempts; rerun behavior remains unmeasured by this slice.
- The local targeted Vitest invocation could not start a worker in the constrained environment and
  timed out. That is local-environment evidence, not a replacement for the hosted artifacts.
- Downstream unique-defect signal remains `UNKNOWN`; required-versus-advisory policy remains pending.
- No workflow, lane, status, build, product, release, H2, native, or issue-remediation change is
  authorized by this report.

The next H1-A evidence task is to broaden causal failure review where logs/artifacts provide new
information and to preserve the distinction between observed overlap and unique defect signal.

## Post-#473 checkpoint boundary

Main push run `32648286172` on `a536aeebc09f97b45a3094e05c51dfa8e32922df` completed successfully
on `run_attempt=1` in approximately 22m37s. Node 22, Node 24, Build, E2E, Deep E2E, Storybook,
Visual Regression, Lighthouse, Security, Verified Signatures, and `✅ CI Success` all completed
successfully. Its job timings and explicit cache observations are recorded separately in
[`H1-CI-MEASUREMENT-REPORT.md`](H1-CI-MEASUREMENT-REPORT.md) as `POST_MERGE_CHECKPOINT` evidence.

This checkpoint does not alter the original 50-run outcome distribution, the 43 paired-run result,
or the `UNKNOWN` unique-defect signal. It also does not provide historical cache hit/miss
distribution or a unique-defect comparison, so no H1-B decision is made.

## Post-#474 checkpoint boundary

Main push run `32654048692` on
`8223d04e0b51443c6490695b0d08a4189bffe3ee` completed successfully on `run_attempt=1` in
approximately 22m17s. Node 22, Node 24, Build, E2E, Deep E2E, Storybook, Visual Regression,
Lighthouse, Security, Verified Signatures, and `✅ CI Success` all completed successfully. The
checkpoint restored the pnpm/Node cache in both quality lanes and restored the pnpm/Node,
Playwright-browser, and Playwright-APT caches in E2E and Deep E2E. The immutable job timings and
cache observations are recorded in
[`H1-CI-MEASUREMENT-REPORT.md`](H1-CI-MEASUREMENT-REPORT.md) as a separate
`POST_MERGE_CHECKPOINT` evidence class; CodeQL run `32654048709` also succeeded on the same head.

This checkpoint does not alter the original 50-run outcome distribution, the 43 paired-run result,
or the `UNKNOWN` unique-defect signal. It adds no failure/cancellation or lane-exclusive signal,
and no H1-B decision is made.
