# H1-A CI failure, cancellation, and unique-signal report

Status: evidence slice in progress. This report classifies the 9 failed and 15 cancelled runs
from the 50-run H1-A sample. It proposes no Node-lane, required-status, DAG, build, or advisory
policy change.

## Evidence method

The source sample is the reconciled 50-run selection recorded in
[`H1-CI-MEASUREMENT-REPORT.md`](H1-CI-MEASUREMENT-REPORT.md). For each failed or cancelled run,
the classification used the GitHub Actions run and job APIs, including `run_attempt`, event,
branch, head SHA, timestamps, job conclusions, failed step names, and the available Vitest JSON
artifacts. The workflow's PR concurrency policy was read from `.github/workflows/ci.yml`:

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

| Cancelled run | Branch | Newer same-branch run that superseded it |
| ---: | --- | ---: |
| `32613259393` | `release/v1.28.1` | `32613719445` |
| `32607921231` | `chore/verified-signing-hardening-v1.28.1` | `32608499439` |
| `32595079664` | `feat/scenario-workspace-mvp` | `32595925936` |
| `32593021757` | `feat/scenario-workspace-mvp` | `32593093074` |
| `32593016825` | `feat/scenario-workspace-mvp` | `32593021757` |
| `32593014591` | `feat/scenario-workspace-mvp` | `32593016825` |
| `32593011287` | `feat/scenario-workspace-mvp` | `32593014591` |
| `32593009191` | `feat/scenario-workspace-mvp` | `32593011287` |
| `32593002260` | `feat/scenario-workspace-mvp` | `32593009191` |
| `32592756224` | `feat/scenario-workspace-mvp` | `32593002260` |
| `32589061759` | `fix/332-persistence-coordination` | `32589107539` |
| `32588853161` | `fix/332-persistence-coordination` | `32588885980` |
| `32588821869` | `fix/332-persistence-coordination` | `32588853161` |
| `32586591497` | `incident/332-qt-lifecycle-gates` | `32586837622` |
| `32585988531` | `fix/332-overlay-focus-feedback` | `32586260186` |

The API data does not expose a cancellation actor or a separate causal enum. Accordingly, the
classification is `CONCURRENCY_SUPERSESSION` based on the workflow rule and timestamp ordering;
manual cancellation, infrastructure cancellation, and intentional cancellation are not claimed
independently. There is no evidence in this sample requiring an `UNKNOWN` cancellation bucket.

## Node-lane comparison

The 43 runs containing both Node jobs reconcile as follows:

| Pair outcome | Runs |
| --- | ---: |
| Both lanes success | 28 |
| Both lanes failure | 9 |
| Both lanes cancelled | 6 |
| Node-22-only failure | 0 |
| Node-24-only failure | 0 |
| Mixed result pair | 0 |
| Missing paired lane | 0 |

The 9 paired failures map to the four root-cause classes above. This establishes overlap in the
sample, not a Node authority decision. Node 24 is not promoted, Node 22 is not demoted, and Node
26 is not introduced.

## Advisory and downstream unique signal

The aggregate job data contains no advisory job failures in the sample. Explicit outcome
arithmetic is:

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

Thus the observed advisory failure signal is zero. The unique-defect signal remains `UNKNOWN`,
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
- Advisory unique-defect signal remains `UNKNOWN`; required-versus-advisory policy remains pending.
- No workflow, lane, status, build, product, release, H2, native, or issue-remediation change is
  authorized by this report.

The next H1-A evidence task is to broaden causal failure review where logs/artifacts provide new
information and to preserve the distinction between observed overlap and unique defect signal.
