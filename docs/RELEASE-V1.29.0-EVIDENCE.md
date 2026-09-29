# v1.29.0 release evidence record

This record tracks v1.29.0 from preparation to verified publication. Each row names the exact
SHA or run it applies to. Owner: #872.

> **Outcome: `TAGGED`, never `PUBLISHED`.** v1.29.0 passed every pre-tag gate on `cf72dc6d` and
> was tagged, but the tag-triggered CI/CD run failed the enforced OSV scan. The desktop release
> was cancelled before publication, and the release continues as v1.29.1
> (`docs/RELEASE-V1.29.1-EVIDENCE.md`). The tag is kept and never moved.

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.0 in all five sync authorities | DONE: #905 (`e130d7e8`) |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD + CodeQL + Production | DONE: `cf72dc6d` (after #908; the first candidate `e130d7e8` was invalidated by P0 #907) |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA | DONE: readiness record on #872, `RELEASE_READY=YES` |
| `TAGGED` | Signed `v1.29.0` tag pushed under the recorded conditional release authorization | DONE: annotated SSH-signed tag object `e0739537` → `cf72dc6d`; `verify-release-tag` passed |
| `PUBLISHED` | Tag-triggered workflows green; GitHub Release with the expected asset set | **NOT REACHED**: see the tag-time outcome below |
| `VERIFIED` | Published assets, `latest.json`, signatures and version identity re-checked; post-release truth sync merged | **NOT REACHED** |

## Tag-time outcome

| Tag-triggered run | Result |
|---|---|
| CI/CD 36618279795 | **Failed**: Security Audit, OSV scan: GHSA-6h2x-m376-mqjq (CVE-2026-92599, high), `joi` 18.2.5, fixed 18.2.6, via the root devDependency `wait-on` 9.1.0. It was not reported on the same SHA's resulting-main run 36605871138, so the advisory appeared in between. |
| Tauri desktop build 36618279797 | `verify-release-tag` and plugin parity passed. The run was **cancelled** during the bundle jobs, because its `release` job does not depend on CI/CD and would otherwise have published over a red enforced gate. The `GitHub Release` job is `cancelled`, so no GitHub Release, installers or updater assets exist. |
| Docker 36618279810 | Succeeded **and published** `ghcr.io/qnbs/worldscript-studio:1.29.0`, `:1.29` and `:latest` to `sha256:1f463bc6ba1e2544b9d8c2191814c3eff50c9add81cd81d3d3927be736b3fe2d` (OCI revision `cf72dc6d`). The runtime stage is nginx plus the static `dist/` only, without `joi`. v1.29.1 moves `:1.29` and `:latest`; `:1.29.0` stays. |

Exposure: `joi` is a development-only dependency. The three v1.29.0 CycloneDX SBOMs, built from the
production dependency graph of `cf72dc6d`, contain no `joi` or `wait-on` component.
Remediation: #909 (lockfile `joi` 18.2.9; override floor `>=18.2.6 <19`), with no scanner ignore.

## Anti-regression origin

The gates come from the release precedent audit on #872:

- **v1.28.5:** the tag was the first real 3-OS Tauri build and failed on Rust/npm plugin drift.
  **Gate:** plugin parity plus an exact-candidate 3-OS dispatch build, both before any tag.
- **v1.28.7:** CI and the build were green, but a real AppImage with persisted state from an older
  build dead-ended at startup. **Gate:** real-artifact packaged-state qualification
  (`docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`).
- **v1.28.7/v1.28.8:** post-release truth had to be reconstructed after the fact. **Gate:** this
  record exists before the tag, and a post-release truth-sync PR is planned.

## Pre-tag gates (exact candidate SHA `cf72dc6d`; full record on #872)

| Gate | Method | Evidence | Status |
|---|---|---|---|
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA | run IDs | PASS: CI/CD 36605871138, CodeQL 36605871179 on `cf72dc6d` |
| Production truth | Vercel production deployment READY on the candidate SHA, canonical HTTP 200 | deployment ID | PASS: `dpl_7JDhyrnQGmrBz4XGVdZpmhfEg67i` READY on `cf72dc6d`, HTTP 200 |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate (resolved lockfile versions) | output | PASS |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | run ID, per-OS result | PASS: dispatch 36609152182 (Linux, Windows, macOS ARM) |
| Notices + SBOM | `THIRD_PARTY_NOTICES.txt` inside each installer (byte-identical to the generated file) and one `*.cdx.json` per target, bound to the candidate SHA | per-target hashes and component counts | PASS: notices byte-identical in all 7 installer formats; SBOMs with 665/589/607 components |
| Release-job dry run | Replay `tauri-build.yml` `release` collect logic and the exactly-3 notices/SBOM count against the dispatch artifacts; run the release-notes `awk` extraction against the candidate `CHANGELOG.md` | command output | PASS: 6 installers + 3 SBOM + 3 notices; fail-closed negatives; notes 48,618 chars |
| Packaged state: FUTURE | real candidate AppImage, see qualification protocol A | hashes, marker, screenshots | PASS |
| Packaged state: UNSUPPORTED_OLDER | protocol B (own fixture) | hashes, marker, screenshots | PASS |
| Packaged state: legacy migration + reopen | protocol C | before/after content, snapshot, hashes | PASS |
| Stale writer / second instance | existing unit harnesses plus packaged second-launch check (protocol D) | test output, process evidence | PASS: 367/367 harness tests; the second instance exits |
| #743 Release invariant | invariant list re-verified on the candidate; AI changes since v1.28.8 are #900/#895 (dependency-only, qualified with 1,039 targeted AI tests) | checklist | PASS: no AI source changes since v1.28.8 |
| Target environment (maintainer) | protocol part 2 on the maintainer's Linux system | returned hashes/logs/screenshots | OPEN (additional evidence, not a gate) |

## `TAG_ONLY_PENDING`

These cannot be produced before the tag: `workflow_dispatch` builds run with
`createUpdaterArtifacts=false` and without signing secrets, and publishing jobs are tag-restricted.
They are not pre-tag failures as long as the logic has been dry-run where possible:

- updater `.sig` files and the signed macOS `.app.tar.gz` updater bundle;
- `latest.json` generation (version, platform keys without Intel macOS, asset URLs, signatures);
- GitHub Release publication and the attached asset set, including the three notices/SBOM pairs;
- the tag-triggered `docker.yml` run, which is the first execution of the #894/#898 action bumps
  and affects only the container image;
- `verify-release-tag` on the signed tag.

## Known limitations shipped in v1.29.0

- #614: one self-healing second-tab reload on a first-ever PWA install, inside a window of about
  300 ms (P2, reproduced; no loop; data-loss path not exercised).
- #602: local-first residuals behind the opt-in experimental `enableLocalFirstSync` (P2).
- #518: shared service-worker reload-flush residual (pre-existing).
- No OS-native code signing, notarization or Authenticode yet (#574); only updater signatures.
- Intel macOS is not built or claimed (#507).
- Third-party inventory for JavaScript is the pnpm production graph, a documented superset of the
  bundled modules (#575).
- Deferred dependencies: #883–#888, #891, #893, #901 (dispositions on each PR and #872).
