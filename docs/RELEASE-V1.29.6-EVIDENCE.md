# v1.29.6 release evidence

**Status: VERIFIED — desktop, updater and container image published on 2026-11-12.** The signed annotated tag
`v1.29.6` (tag object `495da06303a130fec7994f75ca9be634f2dfc7a6` → `40dbb95e2dc54c072bbdd1bdf49b064fea534a27`) was
pushed once on 2026-11-12. The [GitHub Release](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.6) is
`Latest` with 25 assets. GHCR `1.29.6`, `1.29` and `latest` point to
`sha256:ce7ea14869f8c82478f9220ec638a2e10ef3167647796c0a8a14954ebfdf2917`; `1.29.5` is unchanged. Readback record: #1250.

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

| State       | Required evidence                                                                                                   | Status                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete                  | REACHED 2026-11-12 05:47Z |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention              | REACHED 2026-11-12 06:16Z |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 4-leg packaging, arch checks, release rehearsal, upgrade checks      | REACHED 2026-11-12 06:24Z |
| `TAGGED`    | Signed annotated `v1.29.6` tag verified against the qualified SHA                                                   | REACHED 2026-11-12 06:27Z |
| `PUBLISHED` | All three tag workflows succeed: Tauri (desktop assets), Docker (GHCR image) and tag CI/CD                          | REACHED 2026-11-12 07:47Z |
| `VERIFIED`  | Release inventory, `latest.json` (7 entries) and signatures, checksums, both macOS architectures, GHCR bundle check | REACHED 2026-11-12 07:56Z |

## Candidate gates

All results are for the candidate `40dbb95e2dc54c072bbdd1bdf49b064fea534a27`, the merge of #1254.

| Gate                                 | Evidence                                                                                                                                                                                                                                                                                                                                | Status |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Resulting-main CI/CD and CodeQL      | Push CI/CD [43163690215](https://github.com/qnbs/WorldScript-Studio/actions/runs/43163690215) and CodeQL [43163690312](https://github.com/qnbs/WorldScript-Studio/actions/runs/43163690312)                                                                                                                                             | PASS   |
| Vercel Production and retention      | Production deployment 7729566315 and Pages deployment 7729869421 succeeded; HTTP 200 on both sites. Exact-main retention: `SAFE=0`, 0 writes, postproof 29/29, `RETENTION_COMPLETE=YES` (#627)                                                                                                                                          | PASS   |
| No-push image build of the candidate | `docker-build-check.yml` push run [43163690264](https://github.com/qnbs/WorldScript-Studio/actions/runs/43163690264): pnpm assertion, DOMPurify ≥ 3.4.17 in the image                                                                                                                                                                   | PASS   |
| Container precheck                   | `node scripts/release-container-precheck.mjs 40dbb95e…` PASS on a complete run list                                                                                                                                                                                                                                                     | PASS   |
| Exact-ref OSV                        | Scheduled-scan dispatch [43163711419](https://github.com/qnbs/WorldScript-Studio/actions/runs/43163711419) over `pnpm-lock.yaml` (1659 packages), `src-tauri/Cargo.lock` (571) and `crates/Cargo.lock` (175); 16 waived findings; earliest waiver expiry 2027-01-31                                                                     | PASS   |
| 4-leg candidate builds               | Non-publishing Tauri dispatch [43163707813](https://github.com/qnbs/WorldScript-Studio/actions/runs/43163707813), all legs on Node 22.23.5: Linux, Windows, macOS arm64 (`archs=arm64`, `_aarch64.dmg` verified and mounted) and macOS Intel (`archs=x86_64`, `_x64.dmg` verified and mounted); stored updater signing key verified     | PASS   |
| Release rehearsal (#1219)            | Release-notes step with real bash and GNU grep for `v1.29.6`: exit 0, 19 entries. Release-guard inventory (simulated) on the candidate's real installer names: the 24-asset set is accepted; without Intel, or with an unrenamed Intel payload, it is rejected                                                                          | PASS   |
| Upgrade paths                        | 1.29.5 → candidate [43166321228](https://github.com/qnbs/WorldScript-Studio/actions/runs/43166321228): deb 25/25 user files and 3 IndexedDB databases with identical metadata; dmg 3 identical; NSIS one entry at 1.29.6; MSI major upgrade with a new ProductCode. This proves that files survive, not that the app reads them (#1217) | PASS   |
| Read-only release preflight          | 64 PASS / 0 FAIL at 06:20Z and again at 06:24Z, directly before the tag                                                                                                                                                                                                                                                                 | PASS   |

## Publication and readback

| Gate                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Signed annotated tag     | Tag object `495da063…` → `40dbb95e…`; `git tag -v` reports a good ED25519 signature; GitHub `verified=true`; pushed once under the tag-creation ruleset's maintainer bypass                                                                                                                                                                                                                                                | PASS   |
| Tag CI                   | CI / CD [43168295725](https://github.com/qnbs/WorldScript-Studio/actions/runs/43168295725)                                                                                                                                                                                                                                                                                                                                 | PASS   |
| GHCR publication         | Docker [43168295592](https://github.com/qnbs/WorldScript-Studio/actions/runs/43168295592): the in-job check reported `DOMPurify 3.4.17 (>= 3.4.17)` before the push. `1.29.6`, `1.29` and `latest` = `sha256:ce7ea148…`; labels `revision=40dbb95e…`, `version=1.29.6`                                                                                                                                                     | PASS   |
| Published image check    | Anonymous pull of the linux/amd64 manifest `sha256:d96dceae…`; web layer `sha256:220c8a13…`, digest verified, 186 JavaScript files; `DOMPurify 3.4.17 (>= 3.4.17) in assets/purify.es-Ccsbm8NY.js`                                                                                                                                                                                                                         | PASS   |
| Tauri publication        | [43168295696](https://github.com/qnbs/WorldScript-Studio/actions/runs/43168295696), attempt 2 (see below). Release published 07:47:43Z, `Latest`, 25 assets                                                                                                                                                                                                                                                                | PASS   |
| Updater manifest         | `latest.json` is 1.29.6 with 7 entries (`linux-x86_64`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, `windows-x86_64-msi`, `darwin-aarch64`, `darwin-x86_64`). For each, the asset's SHA-256 equals GitHub's digest; the minisign file and trusted-comment signatures verify against the shipped key (`ea092c5f…`); the trusted comment binds `version:1.29.6`; the entry's signature and URL equal the asset | PASS   |
| Both macOS architectures | The published `WorldScript.Studio.app.tar.gz` contains a thin arm64 Mach-O and `WorldScript.Studio_x64.app.tar.gz` a thin x86_64 Mach-O, both `CFBundleShortVersionString 1.29.6`                                                                                                                                                                                                                                          | PASS   |

### Windows verify-step retry

- **Attempt 1:** the Windows job stopped in "Cryptographically verify signed bundle artifacts" after 2.0 s with exit code 1 and no output. The `GitHub Release` job was skipped, so nothing was published for the desktop.
- **What the missing output excludes:** with no output, every error path of the script that prints is excluded. Only the silent statements remain, because `find_bundle_asset` reports its error inside `$(…)`.
- **Same inputs as v1.29.5:** the step text, the build step and the runner image were the same as in the successful v1.29.5 run. The restored rust-cache holds no `bundle/` directory.
- **Two reproductions** used the unchanged release code at the candidate:
  - unsigned: [43172785515](https://github.com/qnbs/WorldScript-Studio/actions/runs/43172785515);
  - with Tauri-written sidecars and a throwaway key: [43174133235](https://github.com/qnbs/WorldScript-Studio/actions/runs/43174133235).
  - Both found exactly one setup and one MSI, and both failed visibly where expected.
- **Attempt 2:** on maintainer decision, only the failed job was re-run, unchanged. It compiled and ran the verifier for both installers and passed. The release job then published.
- **Root cause:** not determinable from the logs (UNKNOWN). It is not reproducible in the release code.
- **Follow-up:** make a failed `find_bundle_asset` visible.

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
- **Per-installer self-update:** the `.deb`, `.rpm` and MSI entries are published and verified, but
  a real installed copy updating itself through them has not been observed yet (#1217).
- **Accepted risks:** four npm and five Rust advisories remain time-bounded waivers until
  2027-01-31 (#1163, #1164).
