# v1.29.4 release evidence

**Status: PARTIAL — desktop PUBLISHED and VERIFIED; container image NOT PUBLISHED.** The signed
annotated tag `v1.29.4` (tag object `5bc6dff16dc0476e4068c3552e24f579d903e0a3` →
`baba33f12262e6503c094eb0097446d422742da0`) was pushed once on 2026-11-10T20:39:31Z. The Tauri run
published the [GitHub Release](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.4) with
the desktop installers and the updater. The Docker run failed at the image build on the stale
`COPY patches/` line (#1223), so nothing was pushed and GHCR `latest`, `1.29` and `1.29.2` still serve
1.29.2. By this ladder, `PUBLISHED` means every tag-triggered workflow succeeded, so 1.29.4 is a
partial publication. The container image follows with 1.29.5 (`docs/RELEASE-V1.29.5-EVIDENCE.md`).
`v1.29.3` was tagged but never published (below).

## Result per channel

| Channel   | Run                                                                                        | Result                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop   | Tauri [42897616548](https://github.com/qnbs/WorldScript-Studio/actions/runs/42897616548)   | Published 2026-11-10T20:55:35Z, Latest, 20 assets. Verified: 16 downloaded files equal GitHub's digests; 5 signed installers and 3 updater payloads verify against the shipped key with trusted comment `version:1.29.4`; `latest.json` valid. |
| Container | Docker [42897616305](https://github.com/qnbs/WorldScript-Studio/actions/runs/42897616305)  | Failed at `Build and push` (`"/patches": not found`); nothing pushed. GHCR `1.29.4` returns 404.                                                                                                                                               |
| Tag CI    | CI / CD [42897616241](https://github.com/qnbs/WorldScript-Studio/actions/runs/42897616241) | Success; `Verify release tag` passed in all three tag workflows.                                                                                                                                                                               |

Known gaps: the secondary updater endpoint returns 404 (#1214), and the updater client end-to-end
upgrade is not tested on an installed app (#1217).

## The v1.29.3 attempt (tagged, never published)

- Signed annotated tag `v1.29.3`: tag object `b9ec53dc53feea11c8c942769c77d62873b60c93` pointing at
  `62ad48d3b76e32084267782eeac3801906302321`, pushed once on 2026-11-10T16:38:32Z, GitHub-Verified
  (`verified=true`, `reason=valid`). It is immutable under the tag rulesets, unpublished, and stays
  unchanged.
- Tauri run [42856755037](https://github.com/qnbs/WorldScript-Studio/actions/runs/42856755037) and Docker
  run [42856755012](https://github.com/qnbs/WorldScript-Studio/actions/runs/42856755012) stopped at
  `Verify release tag` with `signature gate failed: push event target does not match github.sha`; the
  `Verified Signatures` job of the CI run on the tag failed the same way. Nothing was built or
  published: no GitHub Release, GHCR `1.29.3` returned 404, `latest` and `1.29` stayed at
  `sha256:a04d387ececcc84081051c3b1b2c306c13326e85befda618129cb8954235a13f`, and the updater kept
  serving 1.29.2.
- Cause: the tag verifier compared the push event's `after` with `github.sha`, which cannot be equal for
  an annotated tag (a tag object is not the commit it points to), while it also requires an annotated
  tag. Fixed by #1218 (merge commit `d46ae7969b6a8034de0c998ac3376e4fb7474f4a`); the workflows, the
  policy checker and the proof workflow were re-pinned to that commit by #1220 (merge commit
  `eb5e957c5e6c4a26b3d5d9f3c8ea1825c839cf8c`).
- What was not observable: the exact `after` value of a real tag push (the Events API does not list it
  and `event.json` stays on the runner). A real push event can only be observed with a real tag push, so
  the first real tag run after this fix is the first full proof of the event path; the gate prints the
  event object, the live tag object and the expected commit if the modelled shape is wrong.

## State ladder

| State       | Required evidence                                                                                  | Status                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete | DONE: #1221 merged as `baba33f1`                                   |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, and retention proof   | DONE: `baba33f1`                                                   |
| `QUALIFIED` | Fresh exact-candidate OSV, 3-OS packaging, asset inventory, updater and recovery checks terminal   | PARTIAL: the container build was not exercised by any pre-tag gate |
| `TAGGED`    | Signed annotated `v1.29.4` tag verified against the qualified SHA                                  | DONE: tag object `5bc6dff1`, `verified=true`                       |
| `PUBLISHED` | Exact-tag Tauri and GHCR workflows publish the complete signed asset set                           | PARTIAL: desktop published, container not                          |
| `VERIFIED`  | Release, updater manifest/signatures, checksums, GHCR, and post-release truth sync read back       | DONE for desktop; container not applicable                         |

A skipped job is not a pass: the 1.29.4 qualification exercised the desktop path and the container audit, but no gate ran the real image build, so the stale `COPY patches/` first failed at the tag. Since #1225, a no-push image build with an in-image DOMPurify check runs on every pull request and every push to `main`, and the publishing job runs the same check before its push.

## Candidate and release gates

For each gate, append the exact SHA, workflow/job URL, artifact name and digest, result, and any
limitation only after a terminal result exists. A result from another SHA does not qualify the
candidate. Simulated, read-only production and real publish evidence stay separate; a real tag push that
has not happened is never recorded as proven.

| Gate                            | Evidence to record                                                                                        | Status                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Resulting-main CI/CD and CodeQL | Exact push run IDs and SHA                                                                                | DONE: CI/CD 42889554750, CodeQL 42889554807                   |
| Vercel Production and retention | READY deployment, three aliases, exact-main SAFE/PROTECTED/UNKNOWN and postproof                          | DONE: Production deployment 7692623065 success                |
| Exact-ref OSV                   | Fresh scan of `pnpm-lock.yaml`, `src-tauri/Cargo.lock`, and `crates/Cargo.lock`                           | DONE: exact-ref audit job of Docker dispatch 42889665843      |
| 3-OS candidate builds           | Exact-SHA non-publishing workflow dispatch; Linux, Windows, and macOS Apple Silicon                       | DONE: Tauri dispatch 42889659684                              |
| Complete release assets         | All expected installers, signatures, three SBOMs, three notices, and `latest.json`                        | DONE: 20 assets in Release 440899211                          |
| Verifier pin closure            | Every pin and `TAG_VERIFIER_SOURCE_SHA` names the merged fix commit; verifier files at the pin match      | DONE: pin `d46ae796` (#1218, #1220)                           |
| Read-only release preflight     | Main SHA, tag rulesets, release identity and signing key, versions, waivers, GHCR baseline, updater state | DONE: 54 PASS / 0 FAIL                                        |
| Signed annotated tag            | Tag-object and target-commit verification                                                                 | DONE: `git tag -v` good                                       |
| Tauri/GHCR publication          | Exact-tag runs, complete assets, manifest and immutable image digest                                      | PARTIAL: Tauri 42897616548 success; Docker 42897616305 failed |

## Scope and known limitations

- Version `1.29.4` ships the `1.29.3` content unchanged plus the corrected tag verifier and its pins. No
  v1.30/R-15 storage-authority change is included.
- Supported desktop targets: Linux x86_64, Windows x64, and macOS Apple Silicon. Intel macOS is not claimed.
- Apple Developer ID/notarization and Windows Authenticode are not implemented in this release lane (#574).
- The secondary updater endpoint returns 404; the GitHub `releases/latest` endpoint is the only working
  update source (#1214). The signed version is not bound by the updater client configuration (#1215).
- A tag push moves three image tags (`X.Y.Z`, `X.Y` and `latest`); the GHCR recovery path and its scopes are
  documented in #1201 and tracked in #1216. The packaged-UI upgrade round trip is not covered (#1217).
- Prevention work for tag-publish failures is tracked in #1219 and is separate from this release.
- Four npm and ten Rust advisories remain accepted risks tracked by #1163 and #1164, with waiver expiry
  2026-11-30. A successful scan with those waivers is not evidence that the vulnerabilities are fixed.
- RTK 2.13.0 remains held (#1204).
