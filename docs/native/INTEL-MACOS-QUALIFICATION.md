# Intel macOS (x86_64) Qualification — Status

**Status:** Runner-availability qualified, not release-matrix qualified.
**Owner lane:** `tauri-intel-qualification.yml` (`workflow_dispatch` only).

## History

- `macos-13` (the last GitHub-hosted Intel runner using that label) was removed from
  `tauri-build.yml`'s production matrix on 2026-07-28 after 3 consecutive tagged-release runs each
  had the job sit in GitHub's queue indefinitely, never reaching `in_progress` — see
  [`docs/TAURI-CI.md`](../TAURI-CI.md) for the full incident detail.
- On 2026-08-26, GitHub's replacement label `macos-15-intel` (introduced 2025-09-18, available
  through August 2027) was empirically probed via a throwaway `workflow_dispatch` workflow: it
  scheduled and completed successfully on this organization's plan.

## Current qualification lane

[`tauri-intel-qualification.yml`](../../.github/workflows/tauri-intel-qualification.yml) runs a real
`pnpm exec tauri build` on `macos-15-intel`, manually triggered only (`workflow_dispatch`). It is
deliberately **not**:

- part of the production release matrix (`tauri-build.yml`'s `bundle` job),
- wired into `latest.json` generation or any `darwin-x86_64` updater key,
- able to mutate a GitHub Release (`permissions: contents: read` only, no signing secrets, no
  release-publication steps of any kind — verified structurally sound by `scripts/workflow-policy-check.mjs`'s
  publishing-boundary check, since this job is not on the `PUBLISHING_ALLOWLIST`).

A single successful qualification build proves the *runner label* works — it does not by itself
prove the build is ready for regular release inclusion.

## What's still open before promoting Intel to the release matrix

1. **Soak/repeat testing.** One successful run isn't enough evidence that `macos-15-intel`
   provisions reliably at release time (the exact failure mode that removed `macos-13` was
   *queue* unavailability, not build failure — that requires repeated real-world observation, not
   a single manual dispatch, to rule out).
2. **Artifact parity check** against the existing `macos-latest` (Apple Silicon) bundle — bundle
   size, `.dmg`/`.app.tar.gz` structure, and updater-signature behavior should be verified
   equivalent before shipping both architectures under one release.
3. **Ongoing maintenance-cost decision.** Adding a second macOS architecture to the release matrix
   roughly doubles macOS CI minutes per release; whether that's worth it for the current Intel-Mac
   user base is a product decision, not a technical one — out of scope for this qualification lane.
4. **Explicit promotion PR.** When (1)–(3) are resolved, promoting means: adding `macos-15-intel` to
   `tauri-build.yml`'s `bundle` matrix, adding a `darwin-x86_64` entry to the `latest.json`
   generator's expected-platform set, and updating `docs/TAURI-CI.md`'s Build matrix table.

## Tracking

Issue: [#507](https://github.com/qnbs/WorldScript-Studio/issues/507).
