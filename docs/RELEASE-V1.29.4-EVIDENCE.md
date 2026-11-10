# v1.29.4 release evidence

**Status: PREPARATION IN PROGRESS — NOT RELEASED.** The latest published release remains
[v1.29.2](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.2). `v1.29.3` was tagged but
never published (below). No `v1.29.4` tag, GitHub Release, or GHCR publication has been created.

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

| State       | Required evidence                                                                                  | Status  |
| ----------- | -------------------------------------------------------------------------------------------------- | ------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete | PENDING |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, and retention proof   | PENDING |
| `QUALIFIED` | Fresh exact-candidate OSV, 3-OS packaging, asset inventory, updater and recovery checks terminal   | PENDING |
| `TAGGED`    | Signed annotated `v1.29.4` tag verified against the qualified SHA                                  | PENDING |
| `PUBLISHED` | Exact-tag Tauri and GHCR workflows publish the complete signed asset set                           | PENDING |
| `VERIFIED`  | Release, updater manifest/signatures, checksums, GHCR, and post-release truth sync read back       | PENDING |

## Candidate and release gates

For each gate, append the exact SHA, workflow/job URL, artifact name and digest, result, and any
limitation only after a terminal result exists. A result from another SHA does not qualify the
candidate. Simulated, read-only production and real publish evidence stay separate; a real tag push that
has not happened is never recorded as proven.

| Gate                            | Evidence to record                                                                                        | Status  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| Resulting-main CI/CD and CodeQL | Exact push run IDs and SHA                                                                                | PENDING |
| Vercel Production and retention | READY deployment, three aliases, exact-main SAFE/PROTECTED/UNKNOWN and postproof                          | PENDING |
| Exact-ref OSV                   | Fresh scan of `pnpm-lock.yaml`, `src-tauri/Cargo.lock`, and `crates/Cargo.lock`                           | PENDING |
| 3-OS candidate builds           | Exact-SHA non-publishing workflow dispatch; Linux, Windows, and macOS Apple Silicon                       | PENDING |
| Complete release assets         | All expected installers, signatures, three SBOMs, three notices, and `latest.json`                        | PENDING |
| Verifier pin closure            | Every pin and `TAG_VERIFIER_SOURCE_SHA` names the merged fix commit; verifier files at the pin match      | PENDING |
| Read-only release preflight     | Main SHA, tag rulesets, release identity and signing key, versions, waivers, GHCR baseline, updater state | PENDING |
| Signed annotated tag            | Tag-object and target-commit verification                                                                 | PENDING |
| Tauri/GHCR publication          | Exact-tag runs, complete assets, manifest and immutable image digest                                      | PENDING |

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
