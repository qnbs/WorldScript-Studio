# v1.29.0 release evidence record

This record tracks v1.29.0 from preparation to verified publication. Each row names the exact
SHA or run it applies to. A row stays `PENDING` until evidence exists, and nothing here claims a
published release before the tag and GitHub Release actually exist. Owner: #872.

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.0 in all five sync authorities | PENDING |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD + CodeQL + Production | PENDING |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA | PENDING |
| `TAGGED` | Signed `v1.29.0` tag pushed **after explicit maintainer authorization** | PENDING |
| `PUBLISHED` | Tag-triggered workflows green; GitHub Release with the expected asset set | PENDING |
| `VERIFIED` | Published assets, `latest.json`, signatures and version identity re-checked; post-release truth sync merged | PENDING |

## Anti-regression origin

The gates come from the release precedent audit on #872:

- **v1.28.5:** the tag was the first real 3-OS Tauri build and failed on Rust/npm plugin drift.
  **Gate:** plugin parity plus an exact-candidate 3-OS dispatch build, both before any tag.
- **v1.28.7:** CI and the build were green, but a real AppImage with persisted state from an older
  build dead-ended at startup. **Gate:** real-artifact packaged-state qualification
  (`docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`).
- **v1.28.7/v1.28.8:** post-release truth had to be reconstructed after the fact. **Gate:** this
  record exists before the tag, and a post-release truth-sync PR is planned.

## Pre-tag gates (exact candidate SHA)

| Gate | Method | Evidence | Status |
|---|---|---|---|
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA | run IDs | PENDING |
| Production truth | Vercel production deployment READY on the candidate SHA, canonical HTTP 200 | deployment ID | PENDING |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate (resolved lockfile versions) | output | PENDING |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | run ID, per-OS result | PENDING |
| Notices + SBOM | `THIRD_PARTY_NOTICES.txt` inside each installer (byte-identical to the generated file) and one `*.cdx.json` per target, bound to the candidate SHA | per-target hashes and component counts | PENDING |
| Release-job dry run | Replay `tauri-build.yml` `release` collect logic and the exactly-3 notices/SBOM count against the dispatch artifacts; run the release-notes `awk` extraction against the candidate `CHANGELOG.md` | command output | PENDING |
| Packaged state: FUTURE | real candidate AppImage, see qualification protocol A | hashes, marker, screenshots | PENDING |
| Packaged state: UNSUPPORTED_OLDER | protocol B (own fixture) | hashes, marker, screenshots | PENDING |
| Packaged state: legacy migration + reopen | protocol C | before/after content, snapshot, hashes | PENDING |
| Stale writer / second instance | existing unit harnesses plus packaged second-launch check (protocol D) | test output, process evidence | PENDING |
| #743 Release invariant | invariant list re-verified on the candidate; AI changes since v1.28.8 are #900/#895 (dependency-only, qualified with 1,039 targeted AI tests) | checklist | PENDING |
| Target environment (maintainer) | protocol part 2 on the maintainer's Linux system | returned hashes/logs/screenshots | PENDING (additional evidence, not a substitute) |

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
