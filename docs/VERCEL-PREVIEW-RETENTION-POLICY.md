# Vercel Preview Retention Policy

This policy is the repository's source of truth for cleaning up Vercel Preview
deployment artifacts. It deliberately distinguishes Vercel deployments from
GitHub Deployment records: `.github/workflows/prune-deployments.yml` only
prunes the latter. The real Vercel cleanup is tracked by
[#627](https://github.com/qnbs/WorldScript-Studio/issues/627).

## Mandatory lifecycle

After every successful merge to `main`:

1. record the exact resulting `main` SHA;
2. wait for the push-triggered `CI / CD` and CodeQL runs for that exact SHA to
   finish successfully;
3. enumerate Vercel deployments through the authenticated Vercel CLI/API;
4. perform the dry-run classification and bounded cleanup below; and
5. re-enumerate and verify Production and active-PR Previews before beginning
   dependent repository mutation.

The same reconciliation may run on the scheduled/manual maintenance path. A
still-running or failed post-merge gate is a read-only hard stop for dependent
engineering work; it does not authorize cleanup of protected deployments.

Every run must anchor itself to one concrete current-`main` SHA and its
truthful-green CI/CD and CodeQL evidence. Re-read that SHA immediately before
the deletion phase and again before any dependent repository mutation. If it
has advanced, stop the retention wave and establish the new exact-main gate
before continuing.

This lifecycle is **NORMAL MODE**. Dependent repository mutation waits for the
full reconciliation above. Opt-in exceptions are limited to the bounded
dependency/toolchain maintenance train in the next section and the separately
reviewed Pages incident mode below. The historical release-batched Preview
mode remains superseded from 2026-10-13. Silence, a green head, or a READY
Production deployment is neither exception. Until a named exception is on
`main`, this normal lifecycle still applies.

## Bounded dependency/toolchain maintenance train

An explicitly declared train may defer Preview artifact housekeeping. It does
not relax Production correctness, and it is fail-closed. Silence, a green PR
head, or a READY Production deployment is not a train declaration.

A train that begins after this exception is already on `main` is valid only
when every field below is recorded before its first merge. That first merge is
a later pull request. It cannot be the pull request that introduced the
exception, and it cannot invoke the introducing transition.

```text
TRAIN_KIND = dependency/toolchain maintenance
TRAIN_OWNER = one named writer
TRAIN_START_MAIN = exact SHA
START_BASELINE_RETENTION = terminal
MAX_MERGES = 12
MAX_DURATION = 24h
TRAIN_CLOCK_ORIGIN = UTC instant MERGE_1 is recorded
UNRELATED_FEATURE_MERGES = forbidden
RELEASE/TAG/PROMOTION/ROLLBACK = forbidden
PRODUCTION_AUTHORITY_SWITCH = forbidden
```

`MAX_DURATION` is 24 hours measured from `TRAIN_CLOCK_ORIGIN`. That origin is
the UTC instant `MERGE_1` is recorded after the first merge's resulting-main
gates pass. It is not the pull-request open time and not the declaration
commit time. A record that omits `TRAIN_CLOCK_ORIGIN`, or that starts the 24
hours before `MERGE_1` is recorded, is ordinary mode.

### Introducing transition

The single pull request that first admits this exception may itself be
`TRAIN_MERGE_1` when, before merge, the durable record contains every field
below and no ancestor of its base already contains this exception. Silence or
a green head does not create the record. This is the current train:

```text
TRAIN_KIND = dependency/toolchain maintenance
TRAIN_OWNER = Cursor
TRAIN_START_MAIN = 2ec90a00a7f26895d6badb38bc1885430c0a4d3c
START_BASELINE_RETENTION = TERMINAL
FIRST_TRAIN_PR = #963
MAX_MERGES = 12
MAX_DURATION = 24h
TRAIN_CLOCK_ORIGIN = UTC instant MERGE_1 is recorded
UNRELATED_FEATURE_MERGES = forbidden
RELEASE/TAG/PROMOTION/ROLLBACK = forbidden
PRODUCTION_AUTHORITY_SWITCH = forbidden
```

`TRAIN_START_MAIN` is that pull request's exact base SHA.
`START_BASELINE_RETENTION` is already terminal on that SHA. `FIRST_TRAIN_PR`
is the introducing pull request. #963 consumes this record.

After that pull request merges, it becomes `MERGE_1` only when exact
resulting-main CI/CD succeeds, CodeQL succeeds, Vercel Production is `READY`
on that exact SHA, canonical Production HTTP succeeds, and
alias/promotion/rollback sanity passes. Then append #963 to the
deferred-retention ledger and continue to the next train candidate without
destructive Preview retention.

If any of those gates fails, `TRAIN_CONTINUATION_ALLOWED = NO`. Abort the
train and complete ordinary reconciliation before further repository mutation.

This introducing transition is one-time and fail-closed:

- a later pull request cannot label itself the introducing transition;
- a missing field, a start SHA other than the introducing pull request's exact
  base, or a baseline that is not terminal on that SHA makes that pull request
  ordinary mode;
- the introducing merge counts toward `MAX_MERGES`;
- the transition does not waive the per-merge Production-correctness gates;
- the transition does not authorize destructive Preview retention;
- once this exception is on `main`, every later train uses the declaration
  above and cannot reuse this bootstrap.

After every train merge, and before the next train mutation, these gates stay
mandatory:

1. capture the exact resulting `main` SHA;
2. the push-triggered `CI / CD` run for that SHA succeeds;
3. CodeQL for that SHA succeeds;
4. Vercel Production is `READY` on that exact SHA;
5. canonical Production HTTP succeeds;
6. Production and `main` aliases show no contradictory drift;
7. no unexpected promotion or rollback mutation is observed;
8. append that merge to the deferred-retention ledger.

If any item fails, `TRAIN_CONTINUATION_ALLOWED = NO`. Stop the train and
complete ordinary reconciliation before further repository mutation.

During a valid train, do not perform destructive Vercel retention mutation.
The only deferred work is this artifact housekeeping:

- full authenticated Vercel deployment inventory;
- dry-run SAFE/PROTECTED/UNKNOWN classification;
- stale Preview deletion;
- retired Preview branch-alias cleanup;
- the newest-three-per-open-PR Preview snapshot;
- retention-specific rollback-history re-enumeration.

The train ends immediately when any forced-close condition is met: 12 merges,
24 hours from `TRAIN_CLOCK_ORIGIN`, exact-main CI/CD or CodeQL failure, Production not `READY`, canonical
Production HTTP failure, alias/promotion/rollback contradiction, provider
resource pressure or unsafe state, an unrelated feature or security change
that must merge, a release/tag/promotion/rollback as the next action, ambiguous
operator ownership, or a repository policy change that invalidates the train.
A new dependency or toolchain pull request joins only when it is added to the
live ledger, remains inside the count and time bounds, and stays inside
dependency/toolchain scope.

After the final train merge, prove exact-main CI/CD, CodeQL, Production
`READY`, and canonical Production HTTP, then run exactly one ordinary full
reconciliation. Non-train mutation, including later feature work, resumes only
after `TRAIN_FINAL_RETENTION_COMPLETE = YES`.

## Release-batched Preview retention

A second fail-closed exception may defer destructive Preview housekeeping
until the next sanctioned `v*` release reconciliation. It does not relax
per-merge Production correctness, Gate 7, or the production
storage-authority switch. Silence is not a declaration.

The mode is valid only when every field below is recorded before the
introducing pull request merges, and no ancestor of its base already contains
this exception. That pull request may be the first merge under the mode. A
later pull request cannot reuse this bootstrap. A missing field, or a baseline
SHA other than the introducing pull request's exact base, leaves that pull
request in normal mode.

```text
RETENTION_MODE = release-batched preview retention
DESTRUCTIVE_WRITER = Codex CLI, local VS Code / Ubuntu
CURSOR_CLOUD_DESTRUCTIVE_ACCESS = NO
RETENTION_DEFERRED_UNTIL = the next sanctioned v* release reconciliation
BASELINE_MAIN = 8424a7c640074dedac8de24a98fd6932c80c8230
BASELINE_RETENTION = TERMINAL
FIRST_BATCH_PR = #1020
BATCH_CLOCK_ORIGIN = UTC instant FIRST_BATCH_PR merges
MAX_BATCH_AGE = 14d
MAX_STALE_PREVIEWS = 24
EXCEPTIONAL_HANDOFF = one local Codex CLI pass, then this batch continues
BATCH_COMPLETE = recorded only after the sanctioned release pass
GATE_7 = maintainer only
PRODUCTION_AUTHORITY_SWITCH = forbidden
TAG_AND_PUBLISH = Codex CLI local only, after GH #911 and this reconciliation
```

`BASELINE_MAIN` is that pull request's exact base SHA. `BASELINE_RETENTION`
is already terminal on that SHA: Production `dpl_BXtcjwQKG8XC8uS8kZziTyNb2SZz`
is `READY` on that SHA, with the three canonical aliases bound and rollback
candidate `dpl_9T9o3RvF7LkaFmToPnaUX5VqMMgb` protected. This introducing
record does not authorize a deletion.

After every merge under the mode, and before the next dependent repository
mutation, including documentation, configuration, and workflow changes, these
gates stay mandatory:

1. capture the exact resulting `main` SHA;
2. the push-triggered `CI / CD` run for that SHA succeeds;
3. CodeQL for that SHA succeeds;
4. Vercel Production is `READY` on that exact SHA;
5. canonical Production HTTP succeeds;
6. Production and `main` aliases show no contradictory drift;
7. no unexpected promotion or rollback mutation is observed;
8. a read-only count of non-protected Preview deployments is recorded for this
   project. An unavailable or contradictory count stops dependent repository
   mutation. It is not evidence that the count is zero, and it is not the
   destructive reconciliation.

If any of items 1–7 fails, stop and complete ordinary reconciliation before
further repository mutation. If the read-only count is unavailable or
contradictory, stop dependent repository mutation and do not invent a zero
count. Cursor Cloud must not delete a deployment or alias to satisfy this
mode.

The only deferred work is the same Preview artifact housekeeping listed for a
train: full authenticated inventory, dry-run `SAFE`/`PROTECTED`/`UNKNOWN`
classification, stale Preview deletion, retired Preview branch-alias cleanup,
the newest-three-per-open-PR snapshot, and retention-specific rollback-history
re-enumeration. Production deployments, Production and `main` aliases,
rollback-eligible history, active-PR previews, and every `UNKNOWN` stay
protected. The read-only count in gate 8 is mandatory before the next
dependent repository mutation. It is not the reconciliation.

The release pass runs once per cycle, immediately before the next sanctioned
`v*` tag, and only by Codex CLI in the local VS Code/Ubuntu environment. That
pass uses the ordinary protected-state rules in this document, on the exact
release SHA, after [GH #911](https://github.com/qnbs/WorldScript-Studio/issues/911)
is terminal for that SHA. Cursor Cloud does not tag, publish, or receive
release secrets. The mode does not authorize Gate 7 or the production
storage-authority switch. After that pass, record `BATCH_COMPLETE = YES` and
`BATCH_COMPLETE_SHA` as that exact release SHA. The cycle then ends. Later
merges use ordinary reconciliation until a new cycle is declared. A later
pull request cannot reuse this bootstrap.

`MAX_BATCH_AGE` is 14 days of 24 hours, measured from `BATCH_CLOCK_ORIGIN`,
or from the UTC instant of the latest recorded exceptional pass when one
exists. The age reaches its cap at exactly 14 days. `MAX_STALE_PREVIEWS` counts
every Preview deployment whose target is not production, that is outside the
protected Production and rollback ID set, and that is not held by a
Production, `main`, or active-branch alias or by the newest-three open-PR
set. An unclassified Preview deployment counts. Protected Production and
rollback deployments do not. A count of 24 or more reaches the cap.

Reaching either cap, or a provider report of resource pressure or unsafe
provider state, stops dependent repository mutation and requires one
exceptional handoff. That handoff is a single retention pass by Codex CLI in
the local VS Code/Ubuntu environment, under the same protected-state rules.
Cursor Cloud must not delete a deployment or alias to perform it. The handoff
does not restore per-merge destructive cleanup, does not complete the cycle,
and does not authorize a tag or publish. Resume dependent repository mutation
only after the pass records `EXCEPTIONAL_PASS_SHA`, `EXCEPTIONAL_PASS_AT`, a
post-pass stale-preview count below 24, and resource pressure cleared.
If that record is missing, the count is 24 or more, or pressure remains,
dependent repository mutation stays stopped.

Abort into ordinary reconciliation before further mutation or any tag when
exact-main CI/CD or CodeQL fails, Production is not `READY` on the exact SHA,
canonical Production HTTP fails, alias/promotion/rollback state contradicts
the proof, the destructive writer is not the named local Codex CLI operator,
or a maintainer revokes the mode. Resource pressure uses the exceptional
handoff above. It does not by itself restore per-merge destructive cleanup.

## Active mode from 2026-10-13: ordinary per-merge retention

This dated successor section supersedes the release-batched record above. The
record above stays unchanged as history. The maintainer revoked that mode, which
its own abort clause treats as an abort into ordinary reconciliation, and named
the executing writer. The decision is recorded in
[GH #627](https://github.com/qnbs/WorldScript-Studio/issues/627#issuecomment-6134785538)
and QNB-67. It does not reuse the #1020 bootstrap, does not declare another
exception, and does not waive any post-merge safety requirement.

```text
ACTIVE_MODE = ordinary per-merge preview retention
HISTORICAL_DESTRUCTIVE_WRITER_AT_2026-10-13 = Claude Code CLI, local VS Code / Ubuntu
SUPERSEDES = release-batched preview retention record, FIRST_BATCH_PR #1020
SUPERSESSION_AUTHORITY = maintainer decision, GH #627 comment 6134785538
HISTORICAL_CURSOR_CLOUD_DESTRUCTIVE_ACCESS_AT_2026-10-13 = NO
CURRENT_OPERATOR_POLICY = dated operator-eligibility section below
TAG_AND_PUBLISH = not granted by this record
GATE_7 = maintainer only
PRODUCTION_AUTHORITY_SWITCH = forbidden
```

This section preserves the operator assignment as it stood on 2026-10-13. Its
operator-only fields are superseded by the dated 2026-11-06 eligibility section
below; the ordinary-mode lifecycle, safety predicates, and release restrictions
remain in force.

After every merge to `main`, the mandatory lifecycle at the top of this policy
runs in full before dependent repository mutation. The writer must also hold
these predicates:

1. every deletion names one exact `dpl_` deployment ID; a project name is never
   passed to `vercel remove`, because it addresses every deployment of that
   project;
2. the full paginated deployment and alias inventory is read for the exact
   project identity below, and an incomplete or contradictory inventory stops
   the run;
3. before the first write for each ID, that ID is revalidated against a fresh
   read of live data: `main` SHA, `CI / CD` and CodeQL, Production `READY` on
   that SHA, the three canonical aliases, project identity, target, terminal
   state, aliases, rollback eligibility, open-PR heads, and the exact protected
   sets. The writes for that one ID (its branch aliases, then the deployment)
   follow that read without another full read; an alias removal that fails is
   settled by re-reading its binding, and the deployment is removed with
   `--safe`, which makes the provider re-check its aliases at removal time. The
   window that remains between a read and a write is stated under "Not covered"
   in the [runner reference](VERCEL-RETENTION-RUNNER.md);
4. a branch alias is removed only after it is shown to bind to that deployment,
   to be neither Production nor `main`, and to name a branch that is gone; the
   alias of a branch that still exists stays whatever the state of its PR;
5. a read that fails (403, 429, 5xx) is retried once and a second failure
   stops the run; a write that fails is never retried and stops the run unless
   a re-read of the alias binding or of the deployment inventory shows that the
   removal landed; a contradictory provider state, pending or failed gates, or
   a moved `main` stops the run;
6. a pass with no `SAFE_TO_DELETE` candidate is complete when the inventory was
   complete, and candidates are never created to reach a number.

The run ends with the post-cleanup proof below, and records the exact `main`
SHA, run IDs, Production and alias state, the SAFE/PROTECTED/UNKNOWN counts, the
deleted IDs and the verification in GH #627 and QNB-67. A later batched or
train exception needs its own newly declared record in a later pull request.

## Operator eligibility from 2026-11-06: one exclusive operator lease

This dated successor changes only who may hold the ordinary-mode destructive
writer role. The 2026-10-13 assignment remains as historical evidence. One
maintainer-designated local Claude Code CLI or Codex CLI session may hold the
current destructive lease. Cursor Cloud may write source and PRs under normal
repository rules, but its destructive retention access is **not admitted** by
this policy. It may become eligible only after the separate, explicit
maintainer-approved capability admission tracked in
[#1174](https://github.com/qnbs/WorldScript-Studio/issues/1174). A Vercel token
or a source-writer lease alone never grants deletion authority. After #1174 is
accepted, this policy supports an ordinary handoff to Cursor Cloud without
binding eligibility to one model or provider. Until then, per-merge retention
must be handed to a qualified local operator.

```text
ACTIVE_MODE = ordinary per-merge Preview retention
OPERATOR_ELIGIBILITY = local Claude Code CLI | local Codex CLI | Cursor Cloud after GH #1174 capability admission
OPERATOR_LEASE = exactly one active operator/session at a time
OPERATOR_SELECTION = current maintainer-directed session
EXECUTION_ENVIRONMENT = operator environment with verified repository access
RETENTION_RUNTIME = Node 22.19+ with major 22, enforced by the unchanged runner
CURSOR_CLOUD_DESTRUCTIVE_ACCESS = NOT_ADMITTED until explicit maintainer approval in GH #1174
CURSOR_CLOUD_SOURCE_WRITES = allowed under ordinary signed-PR governance
CURSOR_CLOUD_RETENTION_HANDOFF = qualified local operator until capability admission
SAFE_ONLY = YES
PER_MERGE_FULL_RECONCILIATION = REQUIRED
TAG_AND_PUBLISH = not granted
GATE_7 = maintainer only
PRODUCTION_AUTHORITY_SWITCH = forbidden
```

The active operator must first confirm that no other agent or process is writing
the same branch, worktree, lockfile, or retention pass. Cursor Cloud remains
source-writer-only for retention until #1174 is explicitly accepted by the
maintainer. That separate admission requires its own least-privilege
team/project-scoped Vercel credential, a clean source-equal current-main
worktree, Node 22.19+ on the canonical unchanged runner, read-only qualification,
and explicit first-deletion approval; local tokens or `.vercel` state must never
be copied. Until then, the selected local operator completes each required
retention pass with an explicit handoff and no overlapping writes. After a
future admission, an exclusive lease may pass to Cursor Cloud without another
operator-name policy change. No handoff waives any state, CI, security, HTTP,
alias, rollback, or post-proof predicate above. This record becomes active only
after this policy change merges and its resulting-main gates pass.

## Bounded GitHub Pages delivery incident mode — GH #1176 (2026-11-06)

This dated exception addresses only the repeated GitHub Pages `syncing_files`
stall recorded in [GH #1176](https://github.com/qnbs/WorldScript-Studio/issues/1176).
It is separate from the bounded maintenance train and the superseded
release-batched mode; it cannot reuse or extend either record.
On `db85ce826623165eb5f63ed86abae436917e956c`, push run `42198434875` created
Pages deployments in jobs `127838137432` and `127843540538`; both remained in
`syncing_files` and were cancelled at the job timeout. The uploaded artifact
`13493474778` was present. Byte-level comparison to the earlier successful
Pages artifact found identical paths and file hashes. This evidence is the
incident's starting record, not proof that Pages is currently healthy.

This exception can become active only after this policy change has passed the
trusted-base workflow-policy admission, independent maintainer review, all
existing protected PR checks, and the normal signed protected merge. The
introducing PR does not certify its own exception: after merge, evaluate its
resulting protected-main push and CodeQL on their exact SHA. No dependency
successor may be mutated or merged until that resulting-main admission is
verified and recorded in GH #1176. If the base has advanced from the recorded
incident SHA before this policy merges, requalify the incident on the current
main; do not carry stale evidence forward.

```text
INCIDENT = GitHub Pages server-side syncing_files stall, GH #1176
INCIDENT_STARTING_MAIN = db85ce826623165eb5f63ed86abae436917e956c
INCIDENT_PUSH_RUN = 42198434875
INCIDENT_PAGES_JOBS = 127838137432, 127843540538
INCIDENT_ARTIFACT = 13493474778
INCIDENT_MODE = dependency-successor-only; Pages publication DEGRADED
INCIDENT_CLOCK_ORIGIN = UTC merge time of this approved policy PR, recorded in GH #1176
MAX_SUCCESSOR_MERGES = 5
MAX_DURATION = 24h from INCIDENT_CLOCK_ORIGIN
ALLOWED_SOURCE_SET = #1160, #1169, #1170, #1171, #1172, only bounded safe slices
ACTIVE_WRITER = one maintainer-designated operator lease, recorded in GH #1162
OVERALL_CI_CD = report the actual run conclusion; never label a cancelled run successful
VERCEL_RETENTION = HOLD until normal full CI / CD and CodeQL succeed on current main
PRODUCTION_MUTATION = forbidden
TAG_AND_RELEASE = forbidden
GATE_7 = maintainer only
```

Before creating a successor branch, pushing a branch, or performing another
dependent source mutation, the sole writer verifies predicates 1–3 against the
current exact protected-main SHA using GitHub's live run and job records, not
PR-provided evidence. These current-main admission predicates do not require the
successor PR to exist. Recheck them before each branch mutation or push. Before
merging, also require predicate 4 on the exact successor PR head; CI and
independent review are merge-boundary evidence, not prerequisites for creating
or correcting that PR.

1. The push-triggered `CI / CD` run is terminal. The workflow's `build` job
   (`🏗️ Build`) `Upload Pages artifact` step succeeded; the separate
   `🚀 Deploy to GitHub Pages` job created the deployment, reached
   `syncing_files`, and was cancelled by its bounded job timeout. Pages must be
   the only failed or cancelled job.
   Every other job must succeed or be skipped only as the protected workflow
   explicitly defines for that event and changed paths. In particular, the
   push-only skip of `📏 PR Size Governance` is admissible because that job runs
   only for `pull_request` events and the trusted `✅ CI Success` aggregator
   accepts that defined skip. The overall `CI / CD` result remains truthfully
   `cancelled`; no other failure, cancellation, pending job, missing run, or
   workflow-dispatch result is admissible.
2. `✅ CI Success`, Workflow Policy, Security Audit/OSV, Verified Signatures,
   both Node 22 and Node 24 Quality Gates, Build, E2E, Browser Quality (VRT and
   Lighthouse), CodeQL, and every applicable path-scoped Rust/security gate
   are terminal `success`. Any skipped path-scoped gate must be the workflow's
   legitimate skip for untouched paths. Advisory Storybook and Deep E2E jobs
   must also finish successfully. Check identities and workflow definitions
   must match the protected base; the exception never changes branch-protection
   settings, required check names, or CI aggregation.
3. Vercel Production is independently `READY` on that same SHA; the canonical
   Production/Main aliases remain bound, the canonical public HTTP check passes,
   and the prior rollback-capable Production remains present and unchanged.
4. The exact source PR is one signed successor for an admitted safe subset of
   the five listed Dependabot sources, based on current main. Its entire normal
   required and advisory CI, CodeQL, security, review, signature, budget, and
   changelog evidence passes. The source bot PR itself is never merged.

Fail closed before mutation or merge if any of these is true: the incident
record, activation time, or sole writer lease is missing; the current main SHA
does not match the push and CodeQL evidence; the event is not a protected-main
push; the `CI Success` identity or any required job is absent, pending, skipped,
failed, or cancelled; any other job has a non-success result without an exact
workflow-defined event- or path-based skip reason; the Pages job did not
unambiguously reach `syncing_files` after the successful build-job artifact
upload and deployment creation; Production, a canonical alias, the public HTTP
check, or rollback protection does not match; the source is outside the five
listed PRs; or, at the merge boundary, the successor is unsigned, lacks its
independent reviews, or has incomplete exact-head checks. Another writer being
active, the merge count or 24-hour clock expiring, or any provider/check result
being unknown or contradictory also stops the lane. A `workflow_dispatch` run,
a similarly named status from an untrusted workflow, or a green PR-head check
cannot substitute for trusted exact-main push and CodeQL evidence.

During this mode, Pages remains **DEGRADED** until a real successful Pages
deployment and public-site verification exist. Never call the whole `CI / CD`
workflow green because `✅ CI Success` passed. The canonical retention runner
and its `CI / CD` success requirement are unchanged. Do not run retention
`dry-run` or `reconcile`, delete any deployment or alias, or claim a retention
receipt while the whole push workflow is not successful. Preview cleanup is
deferred; Production, rollback, active PR previews, aliases, and unknown
resources remain untouched. The seven SAFE deletions on `b501fa59` are not
reusable evidence for this incident.

The exception ends at the first of: a Pages delivery recovery, five successor
merges, 24 hours from the recorded clock origin, any unrelated failed or
incomplete gate, any change in the Pages failure signature, loss of the sole
writer lease, or any doubt about Production/alias/rollback state. A genuine
successful Pages deployment does not by itself permit another source mutation:
first verify full push `CI / CD` and CodeQL on the current main, then complete
the unchanged canonical Node 22 retention lifecycle and its post-proof. A limit
breach or missing evidence sets `INCIDENT_MODE = INACTIVE` and returns the lane
to the normal full-reconciliation requirement. No automatic extension or
historical train/release exception may be used to continue.

## Expected provider scope and identity

Enumeration and deletion are scoped to this exact non-secret identity:

```text
provider: Vercel
team scope: qnbs-projects
project name: worldscript-studio
project id: prj_XJDiKIlKNg5sbmw6xMHIlf6glXHy
repository: qnbs/WorldScript-Studio
```

The provider response must confirm the expected project/team scope, and must
confirm the repository identity when that metadata is exposed. A deployment
outside this scope, or any missing or contradictory identity metadata, is
`UNKNOWN_REVIEW_REQUIRED` and is never eligible for deletion. Do not enumerate
or delete across all projects reachable by a broad credential.

## Preview build scope

`vercel.json` `git.deploymentEnabled` turns off Git-triggered deployments for
branches matching `dependabot/**` and `deptrain/**` (minimatch; `**` spans the
nested Dependabot branch names). No deployment is created for them at all.
An `ignoreCommand` would not be enough: a build canceled by the ignore step
still counts as a deployment. In the 24 hours before 2026-10-20 10:55 UTC the
project created 47 deployments; 38 of them came from these branches (30
`dependabot/*`, 8 `deptrain/*`). Dependabot rebases every open bot PR after each
merge to `main`, and each rebase built a new Preview. Dependency PRs are
qualified by the required GitHub Actions checks: `CI Success`, which requires
workflow policy, PR size, security, signatures, quality, build, E2E, browser
quality and the path-scoped Rust gates, plus CodeQL. Storybook and the deep
E2E matrix run as advisory jobs. No required check depends on a Vercel Preview.
Production builds of `main` are unchanged.
A PR without a Preview simply has an empty protected set (`min(3, available)`).

### Previews on demand (from 2026-10-21)

On 2026-10-21 the project ran about 75 builds in one day. The causes were correction waves (one
push per finding) and the strict merge cascade (each merge updates every open PR). The owner chose
on-demand Previews. `vercel.json` `ignoreCommand` runs `scripts/vercel-ignore-build.mjs` (exit 1
builds, exit 0 skips).

- **Production** always builds.
- **A Preview builds** in three cases:
  - on the branch's first deployment (no `VERCEL_GIT_PREVIOUS_SHA`);
  - when the commit message contains `[preview]`;
  - when a deployment input changed since the branch's last successful deployment: `vercel.json`,
    `vite.config.*`, `package.json`, `packages/*/package.json`, `patches/**`, `pnpm-lock.yaml`,
    `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, the edge
    build scripts (`build-edge`, `runtime-asset-steps`, `sync-deploy-base`, `resolve-deploy-base`,
    `dependency-state`, `copy-*`), `config/resolveViteBase.ts`, the ignore step `vercel-ignore-build.mjs` itself, or `api/**`. Renames count under
    both paths (`git diff --no-renames`).
- **Unknown state builds (fail-open):** a missing or non-SHA previous commit, or a previous commit
  outside Vercel's shallow clone, builds the Preview.
- **What it saves:** a skipped build still creates a canceled deployment, so this saves build
  minutes, not the deployment count. Only `git.deploymentEnabled` above prevents deployments.
- **Verifying a Preview** (e.g. a runtime-asset fix): push a commit whose message contains
  `[preview]`.

The nightly record pruner keeps the newest three Vercel records per environment (ten until
2026-10-21), plus `main` and every open PR head; see `docs/PAGES-DEPLOYMENT-RECORD-PRUNING.md`.

## Protected state

The cleanup must never delete or modify:

- a deployment with `target=production`;
- a deployment carrying a Production, `main`, or currently active branch alias;
- every deployment in the pre-cleanup protected Production/rollback snapshot;
- a deployment that the provider identifies as previously promoted to
  Production or eligible for rollback, including `readySubstate=PROMOTED` or
  an equivalent provider-supported promotion/rollback-history signal;
- Production domains, environment-variable values, project settings, rollback
  history, or promotion state; or
- a deployment that is not in a recognized terminal state. The currently
  recognized terminal states are `READY`, `ERROR`, and `CANCELED`; `BUILDING`,
  `INITIALIZING`, `QUEUED`, and any unknown or contradictory state are
  protected or deferred as `UNKNOWN_REVIEW_REQUIRED`.

Never invoke project-wide `vercel remove`, `vercel deploy`, promotion, or
rollback as part of retention maintenance.

For every open PR, retain the newest three Preview deployments by creation
time, including the active branch alias. Retain a Preview outside that set when
it is explicitly needed as current review/retest evidence or carries a separate
active alias. The open-PR head and current `main` commit are always protected
from stale-preview classification.

The protected set is an exact per-PR snapshot: retain the newest
`min(3, available)` Preview IDs for every open PR, plus every separately
protected alias or review/retest-evidence deployment. A PR with one or two
available Previews therefore protects exactly those available IDs; the policy
does not require an impossible count of three.

Before the dry run, snapshot these exact non-secret protections:

- every current Production deployment ID and every provider-supported
  rollback-eligible/previously-promoted deployment ID;
- Production and `main` alias-to-deployment bindings;
- every active Preview branch-alias-to-deployment binding;
- the exact open-PR Preview ID sets, review/retest IDs, and baseline states.

Rollback/promotion eligibility is a provider-backed predicate, not a single
best-effort field assumption. If the provider exposes additional membership or
state evidence, include it; if that evidence is unavailable or contradictory,
protect the deployment as `UNKNOWN_REVIEW_REQUIRED`.

## Safe deletion classification

A non-Production deployment is `SAFE_TO_DELETE` only when all applicable live
evidence supports the decision:

```text
COMMON_PROTECTION_GATES:
provider/project/team/repository identity matches expected scope
AND current-main gate is anchored to the live current main SHA
target != production
AND state is a recognized terminal state
AND no Production/main/active-branch alias
AND rollback/promotion eligibility is definitively false
AND not in the exact protected Production/rollback ID set
AND not in the exact protected open-PR ID set
AND not separately protected as review/retest evidence
AND commit != current main
AND commit != the head of an open PR

SAFE_TO_DELETE:
COMMON_PROTECTION_GATES
AND (
  (PR is closed/merged OR its branch no longer exists)
  OR
  (an open PR and existing branch have this deployment as an older
   generation outside the exact protected set)
)
```

Additional rules:

- Closed or merged status is only a lifecycle eligibility branch. It never
  bypasses the common protection gates above; a current-main commit, protected
  alias, protected review evidence, nonterminal state, or unknown metadata still
  prevents deletion.
- For an existing active PR or branch, only generations older than the exact
  retained set may be deleted, and only when they carry no separate active
  alias or review evidence. This is the only open-PR deletion path.
- Failed or canceled Previews may be deleted only when no open PR, existing
  branch, alias, or review evidence still needs them.
- A deployment without `githubPrId` is a `STALE_ORPHAN_PREVIEW` only when its
  branch is gone, its commit is neither current `main` nor an open-PR head, and
  it has no alias. An orphan alias must be verified as non-Production,
  non-`main`, and unrelated to every open PR before it is removed; delete the
  deployment only after that alias removal succeeds.
- Age is supporting evidence, never the sole deletion criterion.
- Missing or contradictory metadata is `UNKNOWN_REVIEW_REQUIRED`, not an
  implicit delete.

## Dry-run and deletion procedure

Before the first deletion, print only non-secret metadata and an exact,
reviewable manifest:

```text
PROTECTED PRODUCTION: <count>
PROTECTED ROLLBACK HISTORY: <count>
PROTECTED OPEN-PR PREVIEWS: <count>
SAFE TO DELETE: <count>
UNKNOWN/DEFERRED: <count>
<deployment-id> | <project/team/repository> | <branch> | <PR> | <commit> | <target> | <aliases> | <promotion/rollback> | <age> | <state> | <lifecycle> | <protection-evidence>
```

Every candidate row must expose `target`, aliases, state, and enough explicit
boolean/evidence fields to review every common protection gate: terminal state,
expected project/team/repository identity, definitive non-rollback eligibility,
absence of protected aliases, absence from the exact Production/rollback and
open-PR ID sets, absence of review/retest evidence,
non-current-main/non-open-head commit, and the lifecycle branch that makes the
candidate eligible. Never include secrets or email fields.

The run records these disjoint sets explicitly:

```text
DRY_RUN_CANDIDATE
REVALIDATED_DELETE
RECLASSIFIED_UNKNOWN/DEFERRED
DELETE_ATTEMPTED
DELETE_CONFIRMED
```

Serialize each maintenance run so two retention waves cannot intentionally
overlap. Immediately before deleting each explicit deployment ID, re-fetch and
revalidate the current `main` gate anchor, project/team/repository identity,
target, terminal state, aliases, promotion/rollback eligibility, open-PR
heads, branch/PR lifecycle, exact protected ID sets, and review/retest
evidence. If `main` changed, restart the exact-main gate and stop the retention
wave. If any other predicate changed, metadata is missing or contradictory, or
eligibility is no longer provable, move that ID from `DRY_RUN_CANDIDATE` to
`RECLASSIFIED_UNKNOWN/DEFERRED` and preserve it. Only then move an ID to
`REVALIDATED_DELETE` and attempt its individual deletion through the
authenticated Vercel CLI/API, with a pause between deletions. A read may retry
once and a second failure stops the wave; a write is never retried, and a
throttled or failed write stops the wave unless a re-read shows that the
removal landed. Record `DELETE_CONFIRMED` only after absence is verified.
Never fall back to a broad deletion.

The cleanup report may identify the creator as `qnbs`, but must render
`creator.email` as `[REDACTED]` and must never include Vercel tokens, cookies,
environment-variable values, or private account identifiers that are not
needed to prove the result. The same redaction applies to local logs.

## Post-cleanup proof

Re-enumerate all deployments and verify:

- Production still exists, is healthy/READY, and retains the same Production
  and `main` aliases;
- every snapshotted protected Production and rollback-history deployment ID
  still exists with its protected promotion/rollback evidence;
- every snapshotted Production and `main` alias binding remains unchanged;
- every exact protected Preview ID snapshotted for every open PR still exists;
- every snapshotted active Preview branch alias still resolves to its exact
  protected deployment ID, or to an explicitly provider-approved equivalent;
- a protected Preview that was `READY` before cleanup remains `READY` (or has
  an explicitly observed provider transition); a protected Preview that was
  already `ERROR`, `CANCELED`, or otherwise non-READY is preserved and is not
  required to become `READY`;
- every `DELETE_CONFIRMED` deployment ID is absent;
- every `RECLASSIFIED_UNKNOWN/DEFERRED` deployment remains present and is
  reported as preserved; it is not included in the deletion absence proof;
- every snapshotted protected ID remains in the retained set; any newly
  observed deployment is independently classified under the same gates, and
  aggregate counts are informational only;
- no project, domain, environment-variable, promotion, or rollback setting
  changed; and
- Production and an active Preview return a successful HTTP response where
  practical.

In ordinary mode, before dependent repository mutation, re-read current `main`
and compare it with the gate anchor. A changed SHA requires a new
truthful-green CI/CD and CodeQL gate; the previous result is not reusable.
Inside a valid bounded dependency/toolchain maintenance train, including the
one-time introducing transition after its resulting-main gates pass, the
per-merge Production-correctness gates above replace this full reconciliation
until the mandatory final pass. A failed introducing-merge gate aborts that
train into ordinary reconciliation. Inside a valid release-batched Preview
retention mode, including its one-time introducing transition after its
resulting-main gates pass, those same per-merge Production-correctness gates
replace destructive Preview reconciliation until the release-time pass or an
exceptional handoff required by the age, preview-count, or resource-pressure
bound. A failed introducing-merge gate aborts that mode into ordinary
reconciliation.

Any unexpected loss of protected state is an immediate hard stop. Do not
auto-promote or rollback to compensate.

## Current automation boundary

The existing GitHub workflow may continue pruning stale GitHub Deployment
records. It is not evidence that Vercel deployment artifacts were removed.
Until #627 supplies and passes a least-privilege, dry-run-first automation
path with the protections above, the Vercel artifact pass remains an explicit
authenticated maintenance step after the post-main gate.
