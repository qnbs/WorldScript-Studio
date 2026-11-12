# v1.29.6 release evidence

**Status: PREPARED — version-preparation PR #1254.** Nothing is tagged or published. The tag
`v1.29.6` is created only after a GO/NO-GO report and separate maintainer authorization (#1250).

## Why 1.29.6

- **Node.js security releases (#1245):** the Docker build stage ran Node 22.22.3, and CI and the
  desktop builds used the runner toolcache. All of them missed the July, October and November 2026
  security releases. The Docker builder is now `node:22.23.5-alpine3.24`, pinned by digest and
  asserted at build time. CI and the bundles ask `actions/setup-node` for the newest patch, and a
  `v*` tag build stops below 22.23.5 / 24.22.3 (#1247, #1252).
- **Updater trust (#1215, #1214, #1248):**
  - an update installs only if its signature binds the announced version (`requireSignedVersion`);
  - the app checks only `releases/latest/download/latest.json`;
  - `latest.json` gets `linux-x86_64-deb`, `linux-x86_64-rpm` and `windows-x86_64-msi` entries.
    Without them, `.deb`/`.rpm` installs were offered the AppImage and MSI installs the NSIS
    installer.
- **macOS Intel (#507):** by maintainer decision a required target of this release. There is a
  native `macos-26-intel` leg in the release matrix, an `_x64.dmg`, a separately named updater
  payload, a `darwin-x86_64` manifest entry, notices and SBOM. No publication happens before both
  macOS architectures are verified. Notarization is not required.

## Scope

- **Desktop:**
  - the updater configuration (`requireSignedVersion`, a single endpoint);
  - the release matrix, now four legs: Linux, Windows, macOS arm64, macOS x86_64;
  - the release guard: seven signed manifest entries;
  - third-party notices with SPDX license texts (#1236).
- **Container:** rebuilt from the same commit; no functional change intended. The build gate, the
  in-image DOMPurify check and the tag-time container precheck from 1.29.5 apply unchanged.
- **Storage:** no storage format change.
- **Not included (documented deferrals):**
  - Dependabot #1240 (Biome/Vitest), #1241 (npm minor/patch group), #1242 (transformers 4.3.2;
    qualification is blocked by the pre-existing ONNX Runtime/CSP failure, #556) and #1238 (Rust
    `log`) wait until after the release;
  - the RTK hold stays.

## State ladder

| State       | Required evidence                                                                                                   | Status  |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete                  | PENDING |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention              | PENDING |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 4-leg packaging, arch checks, release rehearsal, upgrade checks      | PENDING |
| `TAGGED`    | Signed annotated `v1.29.6` tag verified against the qualified SHA (maintainer action after authorization)           | PENDING |
| `PUBLISHED` | All three tag workflows succeed: Tauri (desktop assets), Docker (GHCR image) and tag CI/CD                          | PENDING |
| `VERIFIED`  | Release inventory, `latest.json` (7 entries) and signatures, checksums, both macOS architectures, GHCR bundle check | PENDING |

## Candidate and release gates

Results are recorded here for the exact candidate (the merge commit of #1254) once they exist.

| Gate                                 | Required evidence                                                                                                                        | Status  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Resulting-main CI/CD and CodeQL      | Push runs on the candidate                                                                                                               | PENDING |
| Vercel Production and retention      | Production and Pages deployments, HTTP 200, exact-main retention receipt (#627)                                                          | PENDING |
| No-push image build of the candidate | `docker-build-check.yml` push run: pnpm assertion, DOMPurify ≥ 3.4.17 in the image                                                       | PENDING |
| Container precheck                   | `node scripts/release-container-precheck.mjs <candidate>` on a complete run list                                                         | PENDING |
| Exact-ref OSV                        | Fresh `security-scheduled.yml` dispatch; waivers expire 2027-01-31                                                                       | PENDING |
| 4-leg candidate builds               | Non-publishing Tauri dispatch: Linux, Windows, macOS arm64 and macOS x86_64 bundles; `lipo`/DMG checks per arch; Node 22.23.5 in the log | PENDING |
| Release rehearsal (#1219)            | Event-faithful, non-publishing rehearsal of the release job's inventory and manifest checks on the candidate's bundles                   | PENDING |
| Upgrade paths                        | 1.29.5 → 1.29.6 on Linux (deb), Windows (NSIS, MSI) and macOS (dmg), on an evidence branch that is never merged                          | PENDING |
| Read-only release preflight          | Main SHA, tag rulesets, release identity and signing key, versions, verifier pins, OSV, GHCR baseline, updater endpoint, container gate  | PENDING |

Only the tag run can prove the following. Dispatch builds never sign, so they are checked after
publication:

- updater signing on Intel and the seven signed `latest.json` entries with `version:1.29.6`;
- the release inventory: v1.29.5 had 20 assets, and Intel adds the DMG, the updater payload and its
  signature, the notices and the SBOM;
- the GHCR digest and its bundle check.

## Known limitations

- **OS code signing:** Apple Developer ID, notarization and Windows Authenticode are unavailable and
  deferred by maintainer decision (#574). It is not a release blocker. The README explains how to
  verify a download (signed tag, SHA-256 digests, version-bound updater signatures) and how to
  allow one launch.
- **Installed-app automation (#1217):** WebDriver sessions on the installed release app are proven
  on Linux (WebKitWebDriver) and on Windows (WebView2 with a runner-side policy for the
  debugging port). macOS has no WebDriver path and remains a documented gap. A UI session is not
  proof of the native install path.
- **Local AI on the WASM backend (#556):** the real Whisper download fails when ONNX Runtime loads
  its WASM from `cdn.jsdelivr.net`, which the CSP blocks. This predates 1.29.6 and is not fixed by
  it.
- **Accepted risks:** four npm and five Rust advisories remain time-bounded waivers until
  2027-01-31 (#1163, #1164).
