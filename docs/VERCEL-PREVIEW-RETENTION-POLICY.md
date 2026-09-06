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

## Protected state

The cleanup must never delete or modify:

- a deployment with `target=production`;
- a deployment carrying a Production, `main`, or currently active branch alias;
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

## Safe deletion classification

A non-Production deployment is `SAFE_TO_DELETE` only when all applicable live
evidence supports the decision:

```text
COMMON_PROTECTION_GATES:
target != production
AND state is a recognized terminal state
AND no Production/main/active-branch alias
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
PROTECTED OPEN-PR PREVIEWS: <count>
SAFE TO DELETE: <count>
UNKNOWN/DEFERRED: <count>
<deployment-id> | <branch> | <PR> | <commit> | <target> | <aliases> | <age> | <state> | <lifecycle> | <protection-evidence>
```

Every candidate row must expose `target`, aliases, state, and enough explicit
boolean/evidence fields to review every common protection gate: terminal state,
absence of protected aliases, absence from the exact protected ID set, absence
of review/retest evidence, non-current-main/non-open-head commit, and the
lifecycle branch that makes the candidate eligible. Never include secrets or
email fields.

Serialize each maintenance run so two retention waves cannot intentionally
overlap. Immediately before deleting each explicit deployment ID, re-fetch and
revalidate its target, terminal state, aliases, current `main`, open-PR heads,
branch/PR lifecycle, exact protected-ID set, and review/retest evidence. If any
predicate changed, metadata is missing or contradictory, or eligibility is no
longer provable, do not delete that ID; move it to `UNKNOWN_REVIEW_REQUIRED`
and continue only with separately revalidated IDs. Delete IDs one at a time
through the authenticated Vercel CLI/API, with rate limiting and bounded
retry/backoff for provider throttling. Never fall back to a broad deletion.

The cleanup report may identify the creator as `qnbs`, but must render
`creator.email` as `[REDACTED]` and must never include Vercel tokens, cookies,
environment-variable values, or private account identifiers that are not
needed to prove the result. The same redaction applies to local logs.

## Post-cleanup proof

Re-enumerate all deployments and verify:

- Production still exists, is healthy/READY, and retains the same Production
  and `main` aliases;
- every exact protected Preview ID snapshotted for every open PR still exists;
- a protected Preview that was `READY` before cleanup remains `READY` (or has
  an explicitly observed provider transition); a protected Preview that was
  already `ERROR`, `CANCELED`, or otherwise non-READY is preserved and is not
  required to become `READY`;
- every targeted deployment ID is absent;
- every snapshotted protected ID remains in the retained set; any newly
  observed deployment is independently classified under the same gates, and
  aggregate counts are informational only;
- no project, domain, environment-variable, promotion, or rollback setting
  changed; and
- Production and an active Preview return a successful HTTP response where
  practical.

Any unexpected loss of protected state is an immediate hard stop. Do not
auto-promote or rollback to compensate.

## Current automation boundary

The existing GitHub workflow may continue pruning stale GitHub Deployment
records. It is not evidence that Vercel deployment artifacts were removed.
Until #627 supplies and passes a least-privilege, dry-run-first automation
path with the protections above, the Vercel artifact pass remains an explicit
authenticated maintenance step after the post-main gate.
