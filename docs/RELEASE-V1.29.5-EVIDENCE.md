# v1.29.5 release evidence

**Status: PREPARATION IN PROGRESS — NOT RELEASED.** The latest published release is
[v1.29.4](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.4), which published the
desktop installers and the updater only (`docs/RELEASE-V1.29.4-EVIDENCE.md`). No `v1.29.5` tag,
GitHub Release or GHCR publication exists. Only the maintainer creates the tag.

## Why 1.29.5

- `v1.29.4` did not publish a container image: the image build failed on the stale
  `COPY patches/` line (#1223). GHCR `latest`, `1.29` and `1.29.2` still point to
  `sha256:a04d387ececcc84081051c3b1b2c306c13326e85befda618129cb8954235a13f` (1.29.2).
- Measured in the published image, not inferred from a lockfile: the bundle check from #1225 on
  the GHCR 1.29.2 image (amd64 manifest `sha256:a769aa78…`, web layer `sha256:4632d078…`, pulled
  anonymously) reports `DOMPurify 3.4.16 is older than the required 3.4.17`. DOMPurify 3.4.17
  fixes GHSA-cg2g-xh64-v4q7 (critical), GHSA-mrv2-3pqr-j5jr and GHSA-c6gr-qvv4-5v3f. The
  maintainer treats this deviation as a release blocker and decided to fix forward with a regular,
  fully gated release (#1201).

## Scope

- Container: the Dockerfile fix (#1224) and the container build gate (#1225): a no-push build on
  every pull request and every push to `main`, the in-image DOMPurify check in that build and in the
  publishing job directly before its push, the parity test, the pre-tag precheck, and the in-build
  pnpm assertion.
- Desktop: the application sources are unchanged from 1.29.4; only the version number changes.
- No storage format change and no R-15 (v1.30) storage-authority change.

## State ladder

| State       | Required evidence                                                                                          | Status  |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete         | PENDING |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention     | PENDING |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 3-OS packaging, asset inventory, updater and upgrade checks | PENDING |
| `TAGGED`    | Signed annotated `v1.29.5` tag created by the maintainer and verified against the qualified SHA            | PENDING |
| `PUBLISHED` | Exact-tag Tauri and Docker workflows both succeed (desktop assets and GHCR image)                          | PENDING |
| `VERIFIED`  | Release, updater manifest and signatures, checksums, and the published GHCR digest's bundle check          | PENDING |

## Candidate and release gates

Record the exact SHA, run URL, artifact or image digest, result and any limitation only after a
terminal result exists. A result from another SHA does not qualify the candidate.

| Gate                                 | Evidence to record                                                                                                                                   | Status  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Resulting-main CI/CD and CodeQL      | Exact push run IDs and SHA                                                                                                                           | PENDING |
| Vercel Production and retention      | READY deployment, canonical HTTP, exact-main SAFE/PROTECTED/UNKNOWN and postproof                                                                    | PENDING |
| No-push image build of the candidate | `docker-build-check.yml` push run on the candidate: pnpm version, DOMPurify version in the image, image id                                           | PENDING |
| Container precheck                   | `node scripts/release-container-precheck.mjs <sha>` PASS on a complete run list: `total_count` equals the fetched runs (at most 100), otherwise FAIL | PENDING |
| Exact-ref OSV                        | Fresh scan of `pnpm-lock.yaml`, `src-tauri/Cargo.lock` and `crates/Cargo.lock`; waiver horizon                                                       | PENDING |
| 3-OS candidate builds                | Exact-SHA non-publishing Tauri dispatch; Linux, Windows and macOS Apple Silicon                                                                      | PENDING |
| Upgrade paths                        | 1.29.2 → 1.29.5 and 1.29.4 → 1.29.5 on Linux, Windows and macOS                                                                                      | PENDING |
| Read-only release preflight          | Main SHA, tag rulesets, release identity and signing key, versions, verifier pins, GHCR baseline                                                     | PENDING |
| Signed annotated tag                 | Tag-object and target-commit verification                                                                                                            | PENDING |
| Tauri publication                    | Exact-tag run, 20 assets, `latest.json`, updater signatures with `version:1.29.5`                                                                    | PENDING |
| GHCR publication                     | Exact-tag run, in-job pre-push check, `1.29.5`/`1.29`/`latest` digest, revision label                                                                | PENDING |
| Published image check                | Anonymous pull of the published digest; bundle check reports DOMPurify ≥ 3.4.17                                                                      | PENDING |

## Scope and known limitations

- Supported desktop targets: Linux x86_64, Windows x64 and macOS Apple Silicon. Intel macOS is not
  claimed. Apple Developer ID/notarization and Windows Authenticode are not implemented (#574).
- The secondary updater endpoint returns 404; the GitHub `releases/latest` endpoint is the only
  working update source (#1214). The signed version is not bound by the updater client
  configuration (#1215).
- A tag push moves three image tags (`X.Y.Z`, `X.Y` and `latest`); the GHCR recovery path is tracked
  in #1216. The packaged-UI upgrade round trip is not covered (#1217).
- The pre-tag precheck is an operator gate; a tag push does not run it (#1219). Follow-ups of the
  build gate are tracked in #1223.
- Four npm and ten Rust advisories remain accepted risks tracked by #1163 and #1164, with waiver
  expiry 2026-11-30. A successful scan with those waivers is not evidence that they are fixed.
- RTK 2.13.0 and later remain held (#1183, #1222).
