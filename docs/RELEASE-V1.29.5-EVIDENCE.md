# v1.29.5 release evidence

**Status: VERIFIED — desktop and container image published on 2026-11-11.** The signed annotated
tag `v1.29.5` (tag object `ec58be6e4ad5495308942a7a81b17fbd4579cbf4` →
`44e149d334e3142cb11a7843daa6ae0d1a3a2056`) was pushed once on 2026-11-11T06:25:43Z. All three
tag workflows succeeded. The [GitHub Release](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.5)
is `Latest` with 20 assets. GHCR `1.29.5`, `1.29` and `latest` point to
`sha256:b13d038581d89d9ca233082e774f5d0b4b1db77ad0172c468dfccd8845b7978f`. The web bundle of that
published image contains DOMPurify 3.4.17. Readback record: #1201.

## Why 1.29.5

- `v1.29.4` did not publish a container image: the image build failed on the stale
  `COPY patches/` line (#1223). Until this release, GHCR `latest`, `1.29` and `1.29.2` pointed to
  `sha256:a04d387ececcc84081051c3b1b2c306c13326e85befda618129cb8954235a13f` (1.29.2).
- This was measured in the published image, not inferred from a lockfile. The #1225 bundle check
  on the GHCR 1.29.2 image reported `DOMPurify 3.4.16 is older than the required 3.4.17`:
  - amd64 manifest `sha256:a769aa78…`;
  - web layer `sha256:4632d078…`;
  - pulled anonymously.
- DOMPurify 3.4.17 fixes GHSA-cg2g-xh64-v4q7 (critical), GHSA-mrv2-3pqr-j5jr and
  GHSA-c6gr-qvv4-5v3f. The maintainer treated this deviation as a release blocker and decided to fix
  forward with a regular, fully gated release (#1201).

## Scope

- **Container:**
  - the Dockerfile fix (#1224);
  - the container build gate (#1225): a no-push build on every pull request and every push to
    `main`;
  - the in-image DOMPurify check, both in that build and in the publishing job directly before its
    push;
  - the parity test, the pre-tag precheck and the in-build pnpm assertion.
- **Desktop:** the application sources are unchanged from 1.29.4; only the version number changes.
- **Storage:** no storage format change and no R-15 (v1.30) storage-authority change.

## State ladder

| State       | Required evidence                                                                                          | Status                     |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete         | REACHED 2026-11-11 03:03Z  |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention     | REACHED 2026-11-11 ~03:20Z |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 3-OS packaging, asset inventory, updater and upgrade checks | REACHED 2026-11-11 03:31Z  |
| `TAGGED`    | Signed annotated `v1.29.5` tag verified against the qualified SHA                                          | REACHED 2026-11-11 06:25Z  |
| `PUBLISHED` | All three tag workflows succeed: Tauri (desktop assets), Docker (GHCR image) and tag CI/CD                 | REACHED 2026-11-11 06:52Z  |
| `VERIFIED`  | Release, updater manifest and signatures, checksums, and the published GHCR digest's bundle check          | REACHED 2026-11-11 06:55Z  |

## Candidate and release gates

All results below are for the candidate `44e149d334e3142cb11a7843daa6ae0d1a3a2056` or for the tag
`v1.29.5` that points to it.

| Gate                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                      | Status |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Resulting-main CI/CD and CodeQL      | Push CI/CD [42950151859](https://github.com/qnbs/WorldScript-Studio/actions/runs/42950151859) and CodeQL [42950151812](https://github.com/qnbs/WorldScript-Studio/actions/runs/42950151812)                                                                                                                                                                                                                                   | PASS   |
| Vercel Production and retention      | Production deployment 7700518339 and Pages deployment 7700880911 succeeded; HTTP 200 on both sites. Exact-main retention: `SAFE=0`, 0 writes, postproof 10/10 (#627)                                                                                                                                                                                                                                                          | PASS   |
| No-push image build of the candidate | `docker-build-check.yml` push run [42950151815](https://github.com/qnbs/WorldScript-Studio/actions/runs/42950151815): pnpm 12.13.0 (in-build assertion), DOMPurify 3.4.17 in the image, image `sha256:1157fc47…`                                                                                                                                                                                                              | PASS   |
| Container precheck                   | `node scripts/release-container-precheck.mjs 44e149d3…` PASS on a complete run list (1 of 1), after requalification and again at 06:19Z directly before the tag                                                                                                                                                                                                                                                               | PASS   |
| Exact-ref OSV                        | Scheduled-scan dispatch [42950272022](https://github.com/qnbs/WorldScript-Studio/actions/runs/42950272022) over `pnpm-lock.yaml`, `src-tauri/Cargo.lock` and `crates/Cargo.lock`; earliest waiver expiry 2026-11-30                                                                                                                                                                                                           | PASS   |
| 3-OS candidate builds                | Non-publishing Tauri dispatch [42950263925](https://github.com/qnbs/WorldScript-Studio/actions/runs/42950263925): Linux, Windows and macOS Apple Silicon bundles; stored updater signing key verified                                                                                                                                                                                                                         | PASS   |
| Upgrade paths                        | 1.29.2 → 1.29.5 [42951664293](https://github.com/qnbs/WorldScript-Studio/actions/runs/42951664293) and 1.29.4 → 1.29.5 [42951829780](https://github.com/qnbs/WorldScript-Studio/actions/runs/42951829780): Linux deb, Windows NSIS and MSI, macOS dmg; identity and user data kept                                                                                                                                            | PASS   |
| Read-only release preflight          | 61 PASS / 0 FAIL after requalification and again at 06:19Z: main SHA, tag rulesets, release identity and signing key, versions, verifier pins, OSV, GHCR baseline, updater endpoint, container gate                                                                                                                                                                                                                           | PASS   |
| Signed annotated tag                 | Tag object `ec58be6e4ad5495308942a7a81b17fbd4579cbf4` → `44e149d3…`; `git tag -v` reports a good ED25519 signature; pushed 2026-11-11T06:25:43Z under the tag-creation ruleset's maintainer bypass                                                                                                                                                                                                                            | PASS   |
| Tauri publication                    | Run [42972355391](https://github.com/qnbs/WorldScript-Studio/actions/runs/42972355391). Release published 06:40:11Z, `Latest`, 20 assets. `latest.json` is 1.29.5 for `linux-x86_64`, `windows-x86_64` and `darwin-aarch64`, with URLs under the tag. 6 of 6 updater signatures verify (file and trusted comment) against the shipped key, with trusted comment `version:1.29.5`; their SHA-256 equals GitHub's asset digests | PASS   |
| GHCR publication                     | Run [42972355417](https://github.com/qnbs/WorldScript-Studio/actions/runs/42972355417). The in-job check reported `DOMPurify 3.4.17 (>= 3.4.17)` before the push. `1.29.5`, `1.29` and `latest` = `sha256:b13d0385…`; labels `revision=44e149d3…` and `version=1.29.5`                                                                                                                                                        | PASS   |
| Tag CI                               | CI / CD [42972355431](https://github.com/qnbs/WorldScript-Studio/actions/runs/42972355431)                                                                                                                                                                                                                                                                                                                                    | PASS   |
| Published image check                | Anonymous pull of the linux/amd64 manifest `sha256:2b588390…`. Web layer `sha256:1d908ea7…`, digest verified, 189 JavaScript files. `DOMPurify 3.4.17 (>= 3.4.17) in assets/purify.es-Ccsbm8NY.js`                                                                                                                                                                                                                            | PASS   |

## Scope and known limitations

- **Desktop targets:** Linux x86_64, Windows x64 and macOS Apple Silicon. Intel macOS is not
  claimed. Apple Developer ID/notarization and Windows Authenticode are not implemented (#574). The
  `.dmg` is unsigned.
- **Updater:**
  - The secondary updater endpoint returns 404; the GitHub `releases/latest` endpoint is the only
    working update source (#1214).
  - The signed version is not bound by the updater client configuration (#1215).
  - `Verify stored updater signing key` runs only on dispatch, so it was skipped in the tag run.
    It passed in the candidate dispatch, and the published signatures were verified independently.
- **GHCR:** a tag push moves three image tags (`X.Y.Z`, `X.Y` and `latest`). The GHCR recovery
  path is tracked in #1216.
- **Upgrade testing:** the packaged-UI upgrade round trip is not covered (#1217).
- **Pre-tag precheck:** it is an operator gate, and a tag push does not run it (#1219). Follow-ups
  of the build gate are tracked in #1223.
- **Accepted advisories:** four npm and ten Rust advisories remain accepted risks tracked by #1163
  and #1164, with waiver expiry 2026-11-30. A successful scan with those waivers is not evidence
  that they are fixed.
- **RTK:** 2.13.0 and later remain held (#1183, #1222).
