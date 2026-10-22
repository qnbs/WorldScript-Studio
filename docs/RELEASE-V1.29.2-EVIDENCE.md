# v1.29.2 release evidence record

This record tracks v1.29.2 from preparation to verified publication. Each row names the exact
SHA or run it applies to. Owner: #1139 (release-first order: v1.29.2 before the deferred
Dependabot groups #1106/#1108/#1104).

> **Outcome: `VERIFIED`.** `v1.29.2` is published from `54835103` (signed tag object `79c1a253`,
> GitHub Release 2026-10-22, Latest). Full pre-tag record: #1139 comment 6343487405.

v1.29.2 is an interim maintenance release on top of v1.29.1 (`f255d767`, signed tag object
`bbeca28c`). It changes no storage format and makes no encrypted desktop project storage claim
(R-15 belongs to v1.30).

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.2 in all five sync authorities | PASS: #1141 → `1839cd1e` |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD (including the Security Audit), CodeQL and Production | PASS: `548351036415cbd918e91066919bd0cdfa6db116` (#1143). Two earlier candidates were invalidated by the gates below: `1839cd1e` (#743 instance, fixed by #1142) and `1b053070` (incomplete notices/SBOM under pnpm 12, fixed by #1143) |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA, and #911 has its owner read-back | PASS: `RELEASE_READY = YES` (#1139 comment 6343487405) |
| `TAGGED` | Signed `v1.29.2` tag pushed only with `RELEASE_READY=YES` | PASS: annotated, SSH-signed tag object `79c1a25354ea8ab1a21cc0452f3a760f020176a1` → `54835103` (verified with `ls-remote`, peeled) |
| `PUBLISHED` | Every tag-triggered workflow green, including the exact-ref release security audit in `tauri-build.yml` and `docker.yml`; GitHub Release with the expected asset set | PASS: Tauri 39797957025 (verify-release-tag, exact-ref audit, 3 bundles, GitHub Release), CI/CD 39797957092, Docker 39797957134 (exact-ref audit, then build-push) |
| `VERIFIED` | Published assets, `latest.json`, signatures, version identity and GHCR tags re-checked; Production and retention read back; post-release truth sync merged | PASS: see the read-back below; this record is the truth sync |

## What changed since v1.29.1 in the release mechanics

Since #1137 (#911), Tauri `release` and GHCR `build-push` need a successful `security-audit` job
for the identical `github.sha`. That job is an exact-ref OSV scan of all three lockfiles.
Live proof on `main` `d614f098`:

- run 39738212434 was admitted;
- run 39738222454 had a wrong SHA, and publishing was skipped;
- run 39738231759 had an invalid SHA, the audit failed and publishing was skipped.

The owner read back the gate independently and gave a terminal verdict: PASS, #911 comment
6341204152. The read-back ran on main `1b053070`, which was later invalidated as a candidate for
a different reason (the inventory, #1143). Its verdict is scoped to "the candidate SHA recorded in
#1139" and still holds for the final candidate `54835103`. The read-back covers only the gate
itself, and every file of that gate is byte-identical across `d614f098`, `1b053070` and
`54835103`. #1142 and #1143 touched none of these files, which was checked before the tag.

| Gate file | Blob in `d614f098` = `1b053070` = `54835103` |
|---|---|
| `.github/workflows/tauri-build.yml` | `c0092173a9cc` |
| `.github/workflows/docker.yml` | `7b1b3b3fa5d3` |
| `scripts/release-security-gate.mjs` | `3d8604aff9ee` |
| `tests/unit/tooling/releaseSecurityGate.test.ts` | `959b132a35fb` |

The tag-triggered runs also exercised the gate on `54835103` itself. Tauri 39797957025 published
only after its exact-ref audit succeeded for that SHA. Docker 39797957134 started `build-push`
only after its audit's last step.

At the tag, the Docker audit's job record stayed `in_progress` in the GitHub API, although every
step, including "Complete job", had finished `success` at 14:42:24Z. `build-push` started only
at 14:42:28Z. The order was correct; the stale status is a GitHub API anomaly.

## Pre-tag gates (exact candidate SHA `54835103`)

Protocols: `docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`, applied to the exact v1.29.2
candidate.

| Gate | Method | Evidence | Status |
|---|---|---|---|
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA, including the Security Audit | CI/CD 39786476747, CodeQL 39786476870 | PASS |
| Security Audit freshness | newly execute the OSV scan on the frozen candidate right before the tag; an earlier run is not freshness evidence | `security-scheduled.yml` dispatch 39796232431, job 119884027879, 2026-10-22T14:30:30Z–14:30:49Z, headSha = candidate | PASS |
| #911 owner read-back | independent owner verdict on the mechanical publish gate | #911 comment 6341204152 (run on `1b053070`; gate files byte-identical on `54835103`, see above) | PASS |
| Production truth | Vercel Production READY on the candidate SHA; canonical aliases; `/duckdb/duckdb-eh.wasm` is `application/wasm` with magic `00 61 73 6d`; `/licenses/*.txt` served as text | Production `dpl_BXUNNrNrSXy3K5jpU6SDgki788fA` (retention anchor `54835103`); `sw.js` 1.29.2; bundle carries the curated WebLLM catalogue | PASS |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate | 6 importers aligned | PASS |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | dispatch 39786513756 | PASS |
| Notices + SBOM | notices inside each installer; one `*.cdx.json` per target bound to the candidate SHA; compared with the published v1.29.1 SBOMs; font and app license texts present in the packaged web assets | notices byte-identical in `.deb`, `.rpm`, `.AppImage`, NSIS, `.msi`, `.app` and `.dmg`; SBOMs Linux 666 / Windows 591 / macOS 610 (v1.29.1: 665 / 589 / 607), every delta traced to #901, #1030 or #1093; license texts and DuckDB WASM embedded in all three binaries | PASS |
| Release-job dry run | `release` collect logic against the dispatch artifacts; release-notes `awk` extraction for `1.29.2` with the guard phrases | 12 assets; inventory-only gives `has_assets=false`; a missing SBOM gives rc=1; notes 94,652 chars, equal to the published body | PASS |
| Packaged state protocols A–E | `docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`, fixtures rebuilt from the published v1.28.8 AppImage (`7dc8f5a9…`) | E1–E3, A, B, C and D all pass (detail in #1139); harnesses 367/367; real user data unchanged (29/29) | PASS (`PACKAGED_CANDIDATE_HEADLESS`) |
| #743 release invariant | the per-release invariant list re-verified on the candidate | 4/4 offered WebLLM models in the installed runtime's model list (the three unloadable ones were removed by #1142); every recommendation offered; the cloud boundary was tightened (#1122, #1135); no persisted-model migration | PASS |
| Settings behavior | defaults; Restore Defaults preserve-first; AI-mode cloud authority, so no cloud request in Local or Eco mode, including connection tests | 13 targeted files / 319 tests, plus the full CI unit suite on the SHA | PASS |

## Tag-time read-back

- **GitHub Release `v1.29.2`:** published 2026-10-22T14:53:15Z. It is not a draft or prerelease
  and is the Latest release. It has 20 assets:
  - Linux `.deb`, `.rpm` and `.AppImage`, each with its `.sig`;
  - Windows NSIS and `.msi`, each with its `.sig`;
  - the macOS ARM `.dmg`, and the updater `.app.tar.gz` with its `.sig`;
  - three CycloneDX SBOMs and three notices files, byte-identical to the qualified dispatch;
  - `latest.json`.
- **`latest.json`:** version 1.29.2, with platforms `linux-x86_64`, `windows-x86_64` and
  `darwin-aarch64`; Intel macOS is not claimed. Each platform's Ed25519 signature verifies
  cryptographically against the updater public key shipped in `tauri.conf.json` (key id
  `ea092c5fb1c8996a`), both over the BLAKE2b-512 hash of the published file and over its trusted
  comment.
- **GHCR:** `1.29.2`, `1.29` and `latest` are the same OCI index `sha256:a04d387e…`. The image
  labels give `revision = 548351036415cbd918e91066919bd0cdfa6db116` and `version = 1.29.2`.
  `1.29.1` is unchanged (`sha256:070206da…`).
- **Retention:** after the tag, a SAFE dry-run on anchor `54835103` reported 0 SAFE and
  0 UNKNOWN deployments, with 16 Production and 42 Preview deployments protected. Earlier the
  same day, a reconcile on `1b053070` deleted 2 SAFE previews, and every postproof check passed
  (#627).

## Known limitations shipped in v1.29.2

These are unchanged from v1.29.1:

- #614, #602 and #518;
- no OS-native code signing or notarization (#574);
- Intel macOS is not claimed (#507);
- the JavaScript inventory is the pnpm production graph (#575). Since #1143 it is read from
  `pnpm-lock.yaml` and includes the optional dependencies and those of linked workspace packages.

Packaged runtime on macOS and Windows was not executed. The maintainer's own-environment
protocol (Part 2) is still open; it is additional evidence, not a gate. The deferred Dependabot
groups #1106, #1108, #1104 and #1140 resume after this release (#1139).
