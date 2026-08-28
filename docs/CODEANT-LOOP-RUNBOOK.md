# CodeAnt Correction-Loop Runbook — SUPERSEDED (tombstone)

> **This file is a tombstone.** Its content (an "executable companion" that also captured the live
> state of long-merged architecture-refactor PRs) is **superseded** by the single canonical runbook:
>
> ### → [`CODEANT-REVIEW-LOOP.md`](CODEANT-REVIEW-LOOP.md)
>
> The canonical doc carries the full command-level recipes (GraphQL thread fetch, REST reply, resolve,
> re-trigger, merge) **and** the policy. Use it for every PR.

## Why this was retired (read if you arrived here from an old link)

This file contained the line **"Each push triggers a new review wave"**, which is **misleading** and
once led an external analysis astray. The two claims below are this file's **original, now-obsolete**
content — kept only so a reader arriving from an old link can see exactly what was superseded. **Do
not act on either claim.** Current guidance lives entirely in the canonical runbook:

- ~~CodeAnt's GitHub App auto-reviews on PR open, but re-reviews after a push are NOT reliably
  automatic — you manually re-trigger with a PR comment: `@codeant-ai review`.~~ **Non-actionable,
  historical only.** The `@codeant-ai review` retrigger command is obsolete terminology regardless.
  Do **not** replace it with a fixed "CodeAnt never posts inline comments" assumption either — that
  has since been directly disproven (CodeAnt posted a genuine inline thread on PR #538, 2026-08-28).
  Current reviewer channel usage must be observed live, per PR (see `PR-CI-MERGE-WORKFLOW.md`'s
  roster and three-channel check), never assumed from any static rule written here or anywhere else.
- ~~A PR is review-quiescent only when a fresh review yields 0 new comments AND 0 unresolved
  threads.~~ **Non-actionable, historical only.** See `PR-CI-MERGE-WORKFLOW.md`'s merge-readiness
  classification for the current evidence-based termination rule.

## Current operational context (2026-06-24)

- **CodeAnt was unresponsive** (no check-run / status / comment on PRs even after manual triggers) —
  an **outage / exhausted free-tier quota**, not a trigger-name problem. The free-tier **CI Action**
  token cannot be issued. This historical note does not authorize an admin merge: diagnose the
  outage and use the normal protected path; any protection bypass requires fresh, incident-specific
  maintainer authorization.
- A **token-free second review layer** was added — DeepSource — with its own living runbook:
  **[`DEEPSOURCE-REVIEW-LOOP.md`](DEEPSOURCE-REVIEW-LOOP.md)**. When both tools are live, a PR is
  review-quiescent only when **both** loops are satisfied. The historical admin-bypass text above
  is superseded: current policy is normal protected merge, with any bypass requiring fresh,
  incident-specific maintainer authorization.

_(File kept at this path so existing links resolve; do not add new content here — update the canonical
runbook instead.)_
