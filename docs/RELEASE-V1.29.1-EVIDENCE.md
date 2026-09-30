# v1.29.1 release evidence record

This record tracks v1.29.1 from preparation to verified publication. Each row names the exact
SHA or run it applies to. Owner: #872.

> **Outcome: `VERIFIED`.** v1.29.1 was released on 2026-09-30 from `f255d767` (signed tag object
> `bbeca28c`). Full readiness record and publication evidence: #872.

v1.29.1 is the successor of the signed `v1.29.0` tag, which was never published as a desktop
release (outcome in `docs/RELEASE-V1.29.0-EVIDENCE.md`). It carries all v1.29.0 content plus the
`joi` fix #909. The tag `v1.29.0` is kept and never moved or reused.

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.1 in all five sync authorities | DONE: #910 (`99a664c5`) |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD (including the Security Audit) + CodeQL + Production | DONE: `f255d767` (after #912; the first candidate `99a664c5` was stopped by the Security Audit freshness gate) |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA | DONE: readiness record on #872, `RELEASE_READY=YES` |
| `TAGGED` | Signed `v1.29.1` tag pushed only with `RELEASE_READY=YES` | DONE: annotated SSH-signed tag `bbeca28c` → `f255d767`; `verify-release-tag` passed |
| `PUBLISHED` | Every tag-triggered workflow green, including the CI/CD Security Audit; GitHub Release with the expected asset set | DONE: CI/CD 36659040740 (Security Audit green before the release job), Tauri 36659040643, Docker 36659040644; GitHub Release 2026-09-30T02:32:41Z, Latest, 21 assets |
| `VERIFIED` | Published assets, `latest.json`, signatures, version identity and GHCR tags re-checked; post-release truth sync merged | DONE: assets, `latest.json`, signatures, version identity and GHCR tags re-checked (#872); this truth sync |

## Anti-regression origin

The gates and their origins are those of v1.29.0 (`docs/RELEASE-V1.29.0-EVIDENCE.md`), plus one
lesson from the v1.29.0 tag:

- **v1.29.0:** a new advisory against a development-only dependency appeared between the
  candidate's resulting-main run and the tag. The tag-triggered CI/CD then failed while the
  desktop release job, which does not depend on CI/CD, would still have published. **Gate:** the
  Security Audit is newly executed on the exact candidate immediately before tagging (see the
  "Security Audit freshness" gate below). At tag time,
  the maintainer or agent watches the tag's Security Audit (about 1–2 minutes) and cancels the
  Tauri release run if it is red, before `release` can start after the bundles (at least 12
  minutes). This is a **procedural** guard: `tauri-build.yml` `release` still has
  `needs: [bundle]` only, and `docker.yml` publishes GHCR tags independently, so neither is
  mechanically blocked by the audit. Mechanical enforcement is tracked in #911.

## Pre-tag gates (exact candidate SHA)

Protocols: `docs/RELEASE-V1.29.0-PACKAGED-QUALIFICATION.md`, applied to the exact v1.29.1 candidate
with results recorded here (see its "Reused for v1.29.1" note).

| Gate | Method | Evidence | Status |
|---|---|---|---|
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA, including the Security Audit | run IDs | PASS: CI/CD 36654478104, CodeQL 36654477836 on `f255d767` |
| Security Audit freshness | After the candidate is frozen and immediately before the tag, **newly execute** the OSV scan on the exact candidate SHA by re-running the `🔒 Security Audit` job of the candidate's resulting-main CI/CD run (`gh run rerun <run-id> --job <job-databaseId>`, with the job's `databaseId` from `gh run view <run-id> --json jobs`; this creates a new attempt of the same run), so the scan queries the current OSV database. An earlier successful run is **not** freshness evidence. `RELEASE_READY=YES` requires this new execution to be green. At tag time, the tag's own audit is still watched separately, and the Tauri run is cancelled if it is red (procedural; mechanical enforcement is #911) | run ID, rerun attempt, job databaseId, start timestamp, SHA, result | PASS: run 36654478104, rerun attempt 2, job databaseId 109706461668, 2026-09-30T02:03:23Z–02:04:03Z, OSV step green. The same gate on `99a664c5` (run 36646497949, attempt 2, job databaseId 109687225748) FAILED on six new development-only advisories, fixed by #912 |
| Production truth | Vercel production deployment READY on the candidate SHA, canonical HTTP 200 | deployment ID | PASS: Vercel Production and GitHub Pages success on `f255d767`, HTTP 200 |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate | output | PASS |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | run ID, per-OS result | PASS: dispatch 36654489793 (Linux, Windows, macOS ARM) |
| Notices + SBOM | notices inside each installer (byte-identical to the generated file), one `*.cdx.json` per target bound to the candidate SHA | per-target hashes and component counts | PASS: byte-identical in all 7 formats; SBOMs 665/589/607 components bound to `f255d767`; published digests identical |
| Release-job dry run | `release` collect logic and the exactly-3 notices/SBOM count against the dispatch artifacts; release-notes `awk` extraction for `1.29.1` | command output | PASS: 12 assets; fail-closed negatives; notes 2,059 chars = published body |
| Packaged: v1.28.8 profile first boot + fresh-install save | protocol E | hashes, screenshots | PASS (E1–E3) |
| Packaged state: FUTURE | protocol A | hashes, marker, screenshots | PASS |
| Packaged state: UNSUPPORTED_OLDER | protocol B | hashes, marker, screenshots | PASS |
| Packaged state: legacy migration + reopen | protocol C | before/after content, snapshot, hashes | PASS |
| Stale writer / second instance | unit harnesses plus the packaged second-launch check (protocol D) | test output, process evidence | PASS: 367/367; the second instance exits |
| #743 Release invariant | invariant list re-verified on the candidate | checklist | PASS: no AI source changes since v1.28.8 |

## `TAG_ONLY_PENDING` (outcome at the v1.29.1 tag)

These could not be produced before the tag; all were produced and verified on 2026-09-30 (#872):

- updater `.sig` files and the signed macOS `.app.tar.gz` updater bundle;
- `latest.json` generation (version, platform keys without Intel macOS, asset URLs, signatures);
- GitHub Release publication and the attached asset set, including the three notices/SBOM pairs;
- the tag-triggered `docker.yml` run, which moves GHCR `:1.29` and `:latest` from the v1.29.0
  image to the v1.29.1 image;
- `verify-release-tag` on the signed tag.

## Known limitations shipped in v1.29.1

Unchanged from v1.29.0 (`docs/RELEASE-V1.29.0-EVIDENCE.md`): #614, #602, #518, no OS-native code
signing or notarization (#574), Intel macOS is not claimed (#507), and the JavaScript inventory is
the pnpm production graph (#575). Deferred dependencies are dispositioned on each PR and #872.
