# v1.28.1 release evidence ledger

Status: published release checkpoint with structural, asset, and independent updater-payload
cryptographic verification; platform code-signing and notarization remain separate claims.

## Verified release base

| Evidence | Value |
| --- | --- |
| Previous release tag target | `v1.28.0` → `34b83a22841d0afd58675eb5f563f5bb63bb0bc4` |
| Release-base branch | `main` → `332b643c686b2a43e6c632a5cc2e34515c6e1675` |
| Release-base tree | `0400d5155e0301354a16f0c29a796c06261aeda8` |
| Dynamic range count | `git rev-list --count v1.28.0..main` → **16** |
| Baseline GitHub verification | `verified=true`, `reason=valid` |
| Main required signatures | enabled |
| Main required status | exactly `✅ CI Success` |
| Main force-push/deletion allowance | disabled / disabled |

The release branch was created from the verified release-base SHA. The range was audited without
assuming a preselected commit count:

| Commit | Parent | Authored | Subject | GitHub | Merged PR |
| --- | --- | --- | --- | --- | --- |
| `d62ac38a325800d5f33b9c03519a37c25034516c` | `34b83a22841d0afd58675eb5f563f5bb63bb0bc4` | 2026-08-22T02:26:58+02:00 | docs: reconcile post-v1.28 release truth (#451) | verified / valid | #451 |
| `70040aba2f6864549f841a83c1256089e8d1af0b` | `d62ac38a325800d5f33b9c03519a37c25034516c` | 2026-08-22T04:26:13+02:00 | feat(project): wire first shadow caller for worldscript_project_validate (Wave 2) (#452) | verified / valid | #452 |
| `faadfbbb76ff53120f6c12dc670a2fa1fc1fef73` | `70040aba2f6864549f841a83c1256089e8d1af0b` | 2026-08-22T08:00:50+02:00 | fix(ci): make required job authority explicit (#453) | verified / valid | #453 |
| `87764570e0487c8de3fde99800291f3e79e3f81c` | `faadfbbb76ff53120f6c12dc670a2fa1fc1fef73` | 2026-08-22T09:14:30+02:00 | fix(security): schedule daily OSV scan (#454) | verified / valid | #454 |
| `6be4ff96cd9ffd50a28bcad459501f0070200c62` | `87764570e0487c8de3fde99800291f3e79e3f81c` | 2026-08-22T10:25:28+02:00 | fix(security): harden pnpm bootstrap and version pin (#455) | verified / valid | #455 |
| `9156eba08e2db4fcd99f36ed889e70d753cb65ad` | `6be4ff96cd9ffd50a28bcad459501f0070200c62` | 2026-08-22T11:56:26+02:00 | test(mutation): bind copilot shard to direct tests (#456) | verified / valid | #456 |
| `9a56f9052f14b29837e1d19dadaabb3fecc440ce` | `9156eba08e2db4fcd99f36ed889e70d753cb65ad` | 2026-08-22T12:40:16+02:00 | test(mutation): bind services-commands shard to direct tests (#457) | verified / valid | #457 |
| `fded1e22fd4d4b9140cde5fede0df758ba574ad2` | `9a56f9052f14b29837e1d19dadaabb3fecc440ce` | 2026-08-22T13:19:40+02:00 | test(mutation): bind ai-core shard to direct tests (#458) | verified / valid | #458 |
| `060c85b6d4f8790101aeab794075bf3f3b98551d` | `fded1e22fd4d4b9140cde5fede0df758ba574ad2` | 2026-08-22T15:22:40+02:00 | test(desktop): harden packaged editor readability oracle (#460) | verified / valid | #460 |
| `511037eb02c9e5df6ab3e6a8c6ea8de3e74f5ef4` | `060c85b6d4f8790101aeab794075bf3f3b98551d` | 2026-08-22T16:23:00+02:00 | test(mutation): harden AI-core survivor oracles (#459) | verified / valid | #459 |
| `a6e22e536240f8500d8ce976aa9d1c3dc96e522b` | `511037eb02c9e5df6ab3e6a8c6ea8de3e74f5ef4` | 2026-08-22T18:31:48+02:00 | test(project): strengthen selector mutation oracles (#461) | verified / valid | #461 |
| `287e964bdf3fd58e67a185ef92ec36e251c427d6` | `a6e22e536240f8500d8ce976aa9d1c3dc96e522b` | 2026-08-22T19:22:40+02:00 | fix(332): make writing overlay feedback immediate (#463) | verified / valid | #463 |
| `4086080333622abcf8cfa33aa5699207965e1ab5` | `287e964bdf3fd58e67a185ef92ec36e251c427d6` | 2026-08-22T19:39:26+02:00 | docs(native): harden #332 lifecycle and Qt killer gates (#462) | verified / valid | #462 |
| `e298f56b0ae13c4b16f8a2f5003ae4ac93474a61` | `4086080333622abcf8cfa33aa5699207965e1ab5` | 2026-08-22T20:21:11+02:00 | fix(332): serialize overlapping persistence writes (#464) | verified / valid | #464 |
| `a945907784929b16210432fc3462073d585693a7` | `e298f56b0ae13c4b16f8a2f5003ae4ac93474a61` | 2026-08-23T00:43:13+02:00 | feat(scenario): add canonical projection workspace | verified / valid | #465 |
| `332b643c686b2a43e6c632a5cc2e34515c6e1675` | `a945907784929b16210432fc3462073d585693a7` | 2026-08-23T03:17:11+02:00 | feat(security): enforce verified signing | verified / valid | #466 |

The merged PR association set is deduplicated as **#451–#466**, and each association above was
validated with `merged_at` and a merge commit equal to the corresponding range commit.

## Release-branch evidence

| Gate | Result |
| --- | --- |
| `pnpm run signing:doctor` | passed with SSH signing probe |
| Focused policy/signing/version tests | 72/72 passed (`workflowPolicy`, `checkDocMetrics`, `signing`) |
| `pnpm run docs:check` | passed; 19 locales, 2925 keys, latest tag v1.28.1 |
| `pnpm run build` | passed; Vite production build completed |
| `pnpm run ci:prepush` | passed sequentially |
| Release PR | [#467](https://github.com/qnbs/WorldScript-Studio/pull/467), merged normally by protected squash merge |
| Release PR head | `9af3fa5b46ff129c2b3e9abfbe6552fac816621c` (GitHub Verified) |
| Release merge SHA / tree | `b6c40aa322d56a7e8c337d02394b52962f1e6ef6` / `f622a0804ae5a78bdd46e0f965eea6068ab2ecfa` (GitHub Verified) |
| Post-merge main CI | run `32614783075`, conclusion `success`; `✅ CI Success` job `97136128385` |

## Publication evidence

| Evidence | Result |
| --- | --- |
| Final target before tag creation | `main == origin/main == b6c40aa322d56a7e8c337d02394b52962f1e6ef6`; tree `f622a0804ae5a78bdd46e0f965eea6068ab2ecfa`; GitHub `verified=true`, `reason=valid` |
| Pre-existing `v1.28.1` collision | none locally or remotely before creation |
| Annotated tag object / target | `78e6e19168b86b810952f3db7fe092a8dfed168b` / `b6c40aa322d56a7e8c337d02394b52962f1e6ef6` |
| Tag object verification | GitHub `verified=true`, `reason=valid`; object type `tag` |
| Tag target verification | GitHub `verified=true`, `reason=valid`; tree matches reviewed release tree |
| Tauri workflow | run `32616003394`, conclusion `success` |
| Release-tag gate | job `97136729353`, conclusion `success` |
| Ubuntu bundle | job `97136760231`, conclusion `success`, 18m36s |
| Windows bundle | job `97136760230`, conclusion `success`, 15m51s |
| macOS ARM bundle | job `97136760252`, conclusion `success`, 9m11s |
| GitHub Release publication | job `97138727477`, conclusion `success`; published `2026-08-23T04:01:28Z` |
| GitHub Release | [v1.28.1](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.28.1), published, non-draft, non-prerelease |

The release contains these non-empty assets (sizes are the published byte sizes):

| Asset | Size |
| --- | ---: |
| `latest.json` | 1,928 |
| `WorldScript.Studio_1.28.1_amd64.AppImage` | 162,765,304 |
| `WorldScript.Studio_1.28.1_amd64.AppImage.sig` | 436 |
| `WorldScript.Studio_1.28.1_amd64.deb` | 85,249,438 |
| `WorldScript.Studio_1.28.1_amd64.deb.sig` | 428 |
| `WorldScript.Studio-1.28.1-1.x86_64.rpm` | 85,250,694 |
| `WorldScript.Studio-1.28.1-1.x86_64.rpm.sig` | 432 |
| `WorldScript.Studio_1.28.1_x64-setup.exe` | 83,189,573 |
| `WorldScript.Studio_1.28.1_x64-setup.exe.sig` | 432 |
| `WorldScript.Studio_1.28.1_x64_en-US.msi` | 84,484,096 |
| `WorldScript.Studio_1.28.1_x64_en-US.msi.sig` | 432 |
| `WorldScript.Studio_1.28.1_aarch64.dmg` | 84,745,084 |
| `WorldScript.Studio.app.tar.gz` | 84,781,830 |
| `WorldScript.Studio.app.tar.gz.sig` | 420 |

The immutable versioned URL
`https://github.com/qnbs/WorldScript-Studio/releases/download/v1.28.1/latest.json`
was fetched successfully and is the primary historical updater evidence. Its `version` is
`1.28.1`, its publication timestamp is valid, and its three platform mappings are structurally
complete. The public fallback URL
`https://github.com/qnbs/WorldScript-Studio/releases/latest/download/latest.json` was also fetched
successfully as a separate time-of-check fallback probe; it resolved to the same `1.28.1` metadata.

| Platform key | Updater artifact | Signature asset | URL / asset check |
| --- | --- | --- | --- |
| `linux-x86_64` | `WorldScript.Studio_1.28.1_amd64.AppImage` | matching `.sig` (436 bytes) | versioned release URL, HTTP 200 |
| `windows-x86_64` | `WorldScript.Studio_1.28.1_x64-setup.exe` | matching `.sig` (432 bytes) | versioned release URL, HTTP 200 |
| `darwin-aarch64` | `WorldScript.Studio.app.tar.gz` | matching `.sig` (420 bytes) | versioned release URL, HTTP 200 |

No `darwin-x86_64` entry exists because no Intel macOS artifact was produced or claimed. The
corresponding updater artifact and signature URLs were each matched to actual non-empty GitHub
Release assets; `.deb`, AppImage, RPM, Windows `.exe`/`.msi`, and macOS ARM `.dmg` assets are also
present.

Deterministic release notes were extracted from the committed `v1.28.1` changelog section with
`generate_release_notes: false` and match the published release body. The notes retain the
pending status of #332 and #341 and make no unsupported macOS Intel claim.

The installed official toolchain is `tauri-cli 2.11.4`. It exposes `tauri signer sign` and
`tauri signer generate`, but no standalone artifact verification command; neither `minisign` nor
`signify` is installed. H1-E therefore uses the production-compatible `minisign-verify 0.2.5`
library already selected by `tauri-plugin-updater 2.10.1`, through the development-only audit
harness documented in [`H1-E-UPDATER-VERIFICATION-REPORT.md`](audit/H1-E-UPDATER-VERIFICATION-REPORT.md).
The Linux, Windows, and macOS ARM updater payloads each verified successfully; tampered bytes,
an unrelated public key, and cross-substituted signatures were rejected. No private key material
was accessed or exposed.

The source-signing control (every introduced source commit GitHub Verified) and release-tag
signing control (the annotated tag object plus its target commit) are separate evidence items.
Neither one substitutes for the other. Final branch protection remains unchanged: required
signatures enabled, required status exactly `✅ CI Success`, force-pushes disabled, deletions
disabled, and required conversation resolution enabled. No admin bypass, force-update, unsigned
fallback, or hook bypass was used. Issue #332 packaged Linux lifecycle/Alt+Tab/persistence and
Issue #341 packaged dark/sepia/readability validation remain pending regardless of CI or
publication.
