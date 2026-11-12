# Intel macOS (x86_64) Qualification — Status

**Status:** Runner and native build qualified on `macos-26-intel` (2026-11-11). Not part of the release matrix.
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

## What's still open before promoting Intel to the release matrix

1. **Soak/repeat testing.** `macos-13` was removed for _queue_ unavailability, not build failure. Repeated qualification runs must show that `macos-26-intel` also provisions reliably at release time.
2. **A unique updater asset name.** Both macOS legs produce `WorldScript Studio.app.tar.gz` (+ `.sig`), and the release job refuses duplicate asset names. The Intel payload needs its own name before both can ship.
3. **Guard and manifest.** `scripts/release-assets-guard.mjs` and `latest.json` know exactly `linux-x86_64`, `windows-x86_64` and `darwin-aarch64`. Promotion adds:
   - a `darwin-x86_64` entry, including the signed-version check;
   - the x64 DMG and the `x86_64-apple-darwin` notices and SBOM in the expected asset set.
4. **Signing.** Dispatch builds never sign, so Intel updater signing is first exercised on a tag. That requires (2) first.
5. **Product decision.** A second macOS runner type would gate every release and costs extra CI minutes. Whether that is worth it for the Intel-Mac user base is a product decision.

## Tracking

Issue: [#507](https://github.com/qnbs/WorldScript-Studio/issues/507).
