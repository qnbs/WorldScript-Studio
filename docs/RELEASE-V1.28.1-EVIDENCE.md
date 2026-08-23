# v1.28.1 release evidence ledger

Status: release candidate; this ledger is intentionally incomplete until the protected release
PR is merged, the annotated tag is independently verified, and the tag-triggered desktop workflow
publishes its actual assets.

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
| `pnpm run docs:check` | passed; 19 locales, 2925 keys, latest tag v1.28.0 |
| `pnpm run build` | passed; Vite production build completed |
| `pnpm run ci:prepush` | passed sequentially |
| Release PR | pending creation |
| Release PR head / merge SHA / merge tree | pending protected merge |

## Publication evidence to fill after protected merge

- [ ] Re-fetch `origin`; confirm local `main` equals the verified release-PR squash SHA and its
  reviewed tree before tag creation.
- [ ] Confirm no local or remote `v1.28.1` tag collision.
- [ ] Record annotated tag object SHA and target SHA.
- [ ] Independently verify tag object and target commit through GitHub (`verified=true`,
  `reason=valid` for each).
- [ ] Record tag-gate, main CI, security/CodeQL, and Tauri workflow run IDs and conclusions.
- [ ] Record actual `.deb`, AppImage, RPM, Windows, macOS ARM, updater, and `.sig` asset inventory.
- [ ] Validate every `latest.json` URL/signature/version/platform mapping; do not add a
  `darwin-x86_64` entry without an actual Intel artifact.
- [ ] Record official Tauri/minisign-compatible artifact verification, or the exact installed
  tool/version and documented limitation if no official verifier is exposed.
- [ ] Record the published release URL, deterministic changelog-note comparison, and fallback
  `latest.json` URL if one is part of publication.

The source-signing control (every introduced source commit GitHub Verified) and release-tag
signing control (the annotated tag object plus its target commit) are separate evidence items.
Neither one substitutes for the other. Issue #332 packaged Linux lifecycle/Alt+Tab/persistence
and Issue #341 packaged dark/sepia/readability validation remain pending regardless of CI or
publication.
