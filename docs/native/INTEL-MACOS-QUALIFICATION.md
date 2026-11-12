# Intel macOS (x86_64) Qualification — Status

**Status:** Qualified on `macos-26-intel` (2026-11-11) and part of the release `bundle` matrix from v1.29.6 (#507). Updater signing is first exercised on the v1.29.6 tag.
**Owner lane:** `tauri-intel-qualification.yml` (`workflow_dispatch` only).

## History

- **2026-07-28: `macos-13` removed.** `macos-13`, the last GitHub-hosted Intel runner under that label, was taken out of `tauri-build.yml`'s production matrix. In 3 consecutive tagged-release runs its job sat in GitHub's queue and never reached `in_progress`. See [`docs/TAURI-CI.md`](../TAURI-CI.md) for the incident detail.
- **2026-08-26: `macos-15-intel` probe.** A throwaway `workflow_dispatch` workflow probed GitHub's replacement label `macos-15-intel` (introduced 2025-09-18). It scheduled and completed on this organization's plan.
- **2026-09-29: toolchain blocker.** `macos-15-intel` provisioned, but the build stopped earlier because pnpm 11 had no darwin-x64 standalone binary (run 36553360612).
- **2026-11-11: native x86_64 bundle built.** GitHub offers `macos-26-intel` as its standard x64 macOS 26 label, and pnpm 12.13.0 ships `@pnpm/exe.darwin-x64`. A non-publishing `tauri-build.yml` dispatch on a test branch ([43107697907](https://github.com/qnbs/WorldScript-Studio/actions/runs/43107697907)):
  - provisioned the runner within seconds and ran the frozen install;
  - generated the `x86_64-apple-darwin` notices and SBOM (0 components without any license text);
  - built a native x86_64 bundle (`lipo -archs` → `x86_64`);
  - produced `WorldScript Studio_<version>_x64.dmg`, which verifies, mounts and contains that app.

## Current qualification lane

[`tauri-intel-qualification.yml`](../../.github/workflows/tauri-intel-qualification.yml) runs on `macos-26-intel` and is manually triggered only (`workflow_dispatch`). It runs, in order:

1. the frozen install;
2. the third-party notices and SBOM;
3. `pnpm exec tauri build` without updater artifacts;
4. the same architecture and DMG check as the release's macOS leg.

It is deliberately **not**:

- part of the production release matrix (`tauri-build.yml`'s `bundle` job);
- wired into `latest.json` generation or any `darwin-x86_64` updater key;
- able to mutate a GitHub Release. It has `permissions: contents: read` only, no signing secrets and no release-publication steps. `scripts/workflow-policy-check.mjs`'s publishing-boundary check confirms this, because the job is not on the `PUBLISHING_ALLOWLIST`.

## Release integration (v1.29.6)

- **Matrix:** `tauri-build.yml`'s `bundle` matrix has a `macos-26-intel` leg with `arch: x86_64`, next to `macos-latest` with `arch: arm64`. Both are checked with `lipo` and with a DMG verify and mount before upload.
- **Asset names:** the Intel updater payload and its `.sig` are renamed to `WorldScript Studio_x64.app.tar.gz`, so they cannot collide with the Apple Silicon payload.
- **Release guard:** `scripts/release-assets-guard.mjs` requires `WorldScript Studio_<version>_x64.dmg`, the Intel payload and its signature, and the `x86_64-apple-darwin` notices and SBOM. It writes and validates a `darwin-x86_64` `latest.json` entry, including the signed-version binding (#1215).
- **Still to be proven on the first tag:** updater signing on Intel (dispatch builds never sign), and the published `darwin-x86_64` entry. Both macOS architectures must be verified before v1.29.6 is published.
- **Not done:** Apple Developer ID signing and notarization, deferred by maintainer decision (#574).

## Tracking

Issue: [#507](https://github.com/qnbs/WorldScript-Studio/issues/507).
