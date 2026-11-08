# v1.29.3 release evidence

**Status: PREPARATION IN PROGRESS — NOT RELEASED.** This record starts with every release
state pending. The latest published release remains [v1.29.2](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.2).
No v1.29.3 tag, GitHub Release, or GHCR publication has been created.

## State ladder

| State       | Required evidence                                                                                         | Status  |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------- |
| `PREPARED`  | Signed release-preparation PR merged; version metadata synchronized; resulting-main gates complete        | PENDING |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, and retention proof          | PENDING |
| `QUALIFIED` | Fresh exact-candidate OSV, 3-OS packaging, asset inventory, updater and data-preservation checks terminal | PENDING |
| `TAGGED`    | Signed annotated `v1.29.3` tag verified against the qualified SHA                                         | PENDING |
| `PUBLISHED` | Exact-tag Tauri and GHCR workflows publish the complete signed asset set                                  | PENDING |
| `VERIFIED`  | Release, updater manifest/signatures, checksums, GHCR, and post-release truth sync read back              | PENDING |

## Baseline checks already completed

These checks apply only to the pre-preparation main commit below. They do not qualify the
versioned release candidate.

- Protected main before the preparation PR: `5295b163864f75af3576fe1b884ba1b5437e4114`.
- Push CI/CD [run 42492667174](https://github.com/qnbs/WorldScript-Studio/actions/runs/42492667174) and CodeQL [run 42492667095](https://github.com/qnbs/WorldScript-Studio/actions/runs/42492667095): SUCCESS on that exact SHA.
- GitHub Pages job 128774564802 succeeded for that SHA. Artifact 13623275352 has digest `sha256:15a251c42090226a274cb7f24bdad39bc56c5d864591a67154c5966ac8b6ea34`; public URL returned HTTP 200, which alone does not prove byte-for-byte freshness.
- Vercel Production `dpl_F5YZ8gT3qD2T2pgEXU4XVEUGNywC` was READY on that SHA with the three canonical aliases. SAFE-only retention receipt: [#627](https://github.com/qnbs/WorldScript-Studio/issues/627#issuecomment-6723593626), one obsolete preview removed, `SAFE=1`, `UNKNOWN=0`, all 54 protected records preserved, terminal postproof passed.
- Stored updater key preflight on protected main: [Tauri workflow run 42496866632](https://github.com/qnbs/WorldScript-Studio/actions/runs/42496866632), job 128780977915 SUCCESS. It signed a throwaway payload and verified it against the current embedded public key; tampered data and a wrong key were rejected. This is key-availability evidence on the pre-preparation SHA, not candidate build evidence.
- The current `src-tauri/tauri.conf.json` updater public key matches the configuration at tag `v1.29.2`. The published v1.29.2 `latest.json` contains `linux-x86_64`, `windows-x86_64`, and `darwin-aarch64`, each with a signature. The v1.29.2 cryptographic readback remains documented in [its evidence record](RELEASE-V1.29.2-EVIDENCE.md).
- The same workflow dispatch also runs unpublishing Linux, Windows, and macOS ARM bundle qualification on the pre-preparation SHA; those three jobs were still running when this record was drafted. Their eventual result does not replace the exact-candidate dispatch required after preparation.

## Candidate and release gates

For each gate, append the exact SHA, workflow/job URL, artifact name and digest, result, and any
limitation only after a terminal result exists. A result from another SHA does not qualify the
candidate.

| Gate                                   | Evidence to record                                                                                         | Status  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| Resulting-main CI/CD and CodeQL        | Exact push run IDs and SHA                                                                                 | PENDING |
| Pages publication and public freshness | Deploy job, artifact/build SHA, independent site content check                                             | PENDING |
| Vercel Production and retention        | READY deployment, three aliases, authenticated HTTP probe, exact-main SAFE/PROTECTED/UNKNOWN and postproof | PENDING |
| Exact-ref OSV                          | Fresh scan of `pnpm-lock.yaml`, `src-tauri/Cargo.lock`, and `crates/Cargo.lock`                            | PENDING |
| 3-OS candidate builds                  | Exact-SHA workflow dispatch; Linux, Windows, and macOS Apple Silicon                                       | PENDING |
| Packaged runtime and data preservation | Document each executed packaged-state protocol and platform limitation                                     | PENDING |
| Complete release assets                | All expected installers, signatures, three SBOMs, three notices, and `latest.json`                         | PENDING |
| Signed annotated tag                   | Tag-object and target-commit verification                                                                  | PENDING |
| Tauri/GHCR publication                 | Exact-tag runs, complete assets, manifest and immutable image digest                                       | PENDING |

## Scope and known limitations

- Proposed version: `1.29.3`, pending completion of all release gates. No v1.30/R-15 storage-authority change is included.
- Supported desktop targets: Linux x86_64, Windows x64, and macOS Apple Silicon. Intel macOS is not claimed.
- Apple Developer ID/notarization and Windows Authenticode are not implemented in this release lane.
- RTK 2.13.0 remains held; the shipped dependency graph must retain the reviewed 2.12.0 resolution.
- Four npm and ten Rust advisories remain accepted risks tracked by #1163 and #1164, with current waiver expiry 2026-11-30. A successful scan with those waivers is not evidence that the vulnerabilities are fixed.
- Legacy, WebLLM, vendor-global, and unowned browser caches remain preserved unless positively proven to be WorldScript-owned.
