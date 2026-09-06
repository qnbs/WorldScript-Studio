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
authenticated Vercel CLI/API, with rate limiting and bounded retry/backoff for
provider throttling. Record `DELETE_CONFIRMED` only after absence is verified.
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

Before dependent repository mutation, re-read current `main` and compare it
with the gate anchor. A changed SHA requires a new truthful-green CI/CD and
CodeQL gate; the previous result is not reusable.

Any unexpected loss of protected state is an immediate hard stop. Do not
auto-promote or rollback to compensate.

## Current automation boundary

The existing GitHub workflow may continue pruning stale GitHub Deployment
records. It is not evidence that Vercel deployment artifacts were removed.
Until #627 supplies and passes a least-privilege, dry-run-first automation
path with the protections above, the Vercel artifact pass remains an explicit
authenticated maintenance step after the post-main gate.
