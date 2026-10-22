# v1.29.2 release evidence record

This record tracks v1.29.2 from preparation to verified publication. Each row names the exact
SHA or run it applies to. Owner: #1139 (release-first order: v1.29.2 before the deferred
Dependabot groups #1106/#1108/#1104).

> **Outcome: `PENDING`.** Nothing below counts until its row names exact evidence.

v1.29.2 is an interim maintenance release on top of the published v1.29.1 (`f255d767`, signed tag
object `bbeca28c`). It adds no storage format change and makes no encrypted desktop project
storage claim (R-15 belongs to v1.30).

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.2 in all five sync authorities | PENDING |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD (including the Security Audit) + CodeQL + Production | PENDING |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA, and #911 has its owner read-back | PENDING |
| `TAGGED` | Signed `v1.29.2` tag pushed only with `RELEASE_READY=YES` | PENDING |
| `PUBLISHED` | Every tag-triggered workflow green, including the exact-ref release security audit in `tauri-build.yml` and `docker.yml`; GitHub Release with the expected asset set | PENDING |
| `VERIFIED` | Published assets, `latest.json`, signatures, version identity and GHCR tags re-checked; Production and retention read back; post-release truth sync merged | PENDING |

## What changed since v1.29.1 in the release mechanics

Since #1137 (#911), Tauri `release` and GHCR `build-push` need a successful `security-audit` job
for the identical `github.sha`. That job is an exact-ref OSV scan of all three lockfiles. The
v1.29.1 procedure, where someone watched the tag's audit and cancelled the Tauri run if it was
red, is replaced by this mechanical gate. Live proof on `main` `d614f098`: runs 39738212434
(admitted), 39738222454 (wrong SHA, publish skipped) and 39738231759 (invalid SHA, audit failed,
publish skipped).

## Pre-tag gates (exact candidate SHA)

Protocols: `docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`, applied to the exact v1.29.2
candidate.

| Gate | Method | Evidence | Status |
|---|---|---|---|
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA, including the Security Audit | run IDs | PENDING |
| Security Audit freshness | newly execute the `🔒 Security Audit` job of the candidate's resulting-main CI/CD run right before the tag; an earlier run is not freshness evidence | run ID, attempt, job databaseId, timestamp | PENDING |
| #911 owner read-back | independent owner verdict on the mechanical publish gate | #911 comment | PENDING |
| Production truth | Vercel Production READY on the candidate SHA; canonical aliases; `/duckdb/duckdb-eh.wasm` is `application/wasm` with magic `00 61 73 6d`; `/licenses/*.txt` served as text | deployment ID, probe output | PENDING |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate | output | PENDING |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | run ID, per-OS result | PENDING |
| Notices + SBOM | notices inside each installer, one `*.cdx.json` per target bound to the candidate SHA; font and app license texts present in the packaged web assets | per-target hashes | PENDING |
| Release-job dry run | `release` collect logic against the dispatch artifacts; release-notes `awk` extraction for `1.29.2` with the guard phrases | command output | PENDING |
| Packaged state protocols A–E | `docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md` | hashes, markers, screenshots | PENDING |
| #743 release invariant | the per-release invariant list re-verified on the candidate | checklist | PENDING |
| Settings behavior | defaults, Restore Defaults preserve-first, AI-mode cloud authority (no cloud request in Local/Eco, including connection tests) | test output, manual check | PENDING |

## `TAG_ONLY_PENDING`

These can only be produced at or after the tag:

- the tag-triggered exact-ref security audit in `tauri-build.yml` and `docker.yml`;
- updater `.sig` files and the signed macOS `.app.tar.gz` updater bundle;
- `latest.json` (version, platform keys without Intel macOS, asset URLs, signatures);
- GitHub Release publication and the attached asset set;
- GHCR `1.29.2`, `1.29` and `latest`, built from the tagged commit;
- `verify-release-tag` on the signed tag.

## Known limitations shipped in v1.29.2

Unchanged from v1.29.1: #614, #602, #518, no OS-native code signing or notarization (#574),
Intel macOS is not claimed (#507), and the JavaScript inventory is the pnpm production graph
(#575). The Dependabot groups #1106, #1108 and #1104 are deferred to after this release (#1139).
