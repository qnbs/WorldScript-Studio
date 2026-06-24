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
once led an external analysis astray. The reality, documented correctly in the canonical runbook:

- CodeAnt's GitHub App **auto-reviews on PR open**, but **re-reviews after a push are NOT reliably
  automatic** — you **manually re-trigger** with a PR comment: `@codeant-ai review`.
- A PR is review-quiescent only when a fresh review yields **0 new comments** AND **0 unresolved
  threads**, with green CI.

## Current operational context (2026-06-24)

- **CodeAnt was unresponsive** (no check-run / status / comment on PRs even after manual triggers) —
  an **outage / exhausted free-tier quota**, not a trigger-name problem. The free-tier **CI Action**
  token cannot be issued. Procedure while it is down: proceed under the standing
  hung/unresponsive-check rule (all required CI green + 0 unresolved → admin squash-merge), exactly as
  the canonical runbook §8 describes.
- A **token-free second review layer** was added — DeepSource — with its own living runbook:
  **[`DEEPSOURCE-REVIEW-LOOP.md`](DEEPSOURCE-REVIEW-LOOP.md)**. When both tools are live, a PR is
  review-quiescent only when **both** loops are satisfied.

_(File kept at this path so existing links resolve; do not add new content here — update the canonical
runbook instead.)_
