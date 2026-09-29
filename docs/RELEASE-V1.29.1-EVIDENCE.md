# v1.29.1 release evidence record

This record tracks v1.29.1 from preparation to verified publication. Each row names the exact
SHA or run it applies to. A row stays `PENDING` until evidence exists, and nothing here claims a
published release before the tag and GitHub Release actually exist. Owner: #872.

v1.29.1 is the successor of the signed `v1.29.0` tag, which was never published as a desktop
release (outcome in `docs/RELEASE-V1.29.0-EVIDENCE.md`). It carries all v1.29.0 content plus the
`joi` fix #909. The tag `v1.29.0` is kept and never moved or reused.

## State ladder

| State | Meaning | Status |
|---|---|---|
| `PREPARED` | Release-prep PR merged; version 1.29.1 in all five sync authorities | PENDING |
| `CANDIDATE` | Exact candidate SHA frozen on `main` after resulting-main CI/CD (including the Security Audit) + CodeQL + Production | PENDING |
| `QUALIFIED` | Every pre-tag gate below is terminal on that exact SHA | PENDING |
| `TAGGED` | Signed `v1.29.1` tag pushed only with `RELEASE_READY=YES` | PENDING |
| `PUBLISHED` | Every tag-triggered workflow green, including the CI/CD Security Audit; GitHub Release with the expected asset set | PENDING |
| `VERIFIED` | Published assets, `latest.json`, signatures, version identity and GHCR tags re-checked; post-release truth sync merged | PENDING |

## Anti-regression origin

The gates and their origins are those of v1.29.0 (`docs/RELEASE-V1.29.0-EVIDENCE.md`), plus one
lesson from the v1.29.0 tag:

- **v1.29.0:** a new advisory against a development-only dependency appeared between the
  candidate's resulting-main run and the tag. The tag-triggered CI/CD then failed while the
  desktop release job, which does not depend on CI/CD, would still have published. **Gate:** the
  Security Audit is re-checked on the exact candidate immediately before tagging. At tag time,
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
| Resulting-main CI/CD + CodeQL | push-triggered runs on the candidate SHA, including the Security Audit | run IDs | PENDING |
| Security Audit freshness | re-run or re-check of the OSV scan on the candidate right before the tag; at tag time, watch the tag's audit and cancel the Tauri run if it is red (procedural, #911) | run IDs | PENDING |
| Production truth | Vercel production deployment READY on the candidate SHA, canonical HTTP 200 | deployment ID | PENDING |
| Tauri plugin parity | `pnpm run tauri-plugins:check` on the candidate | output | PENDING |
| 3-OS native build | `tauri-build.yml` `workflow_dispatch` on the candidate: Linux, Windows, macOS ARM | run ID, per-OS result | PENDING |
| Notices + SBOM | notices inside each installer (byte-identical to the generated file), one `*.cdx.json` per target bound to the candidate SHA | per-target hashes and component counts | PENDING |
| Release-job dry run | `release` collect logic and the exactly-3 notices/SBOM count against the dispatch artifacts; release-notes `awk` extraction for `1.29.1` | command output | PENDING |
| Packaged: v1.28.8 profile first boot + fresh-install save | protocol E | hashes, screenshots | PENDING |
| Packaged state: FUTURE | protocol A | hashes, marker, screenshots | PENDING |
| Packaged state: UNSUPPORTED_OLDER | protocol B | hashes, marker, screenshots | PENDING |
| Packaged state: legacy migration + reopen | protocol C | before/after content, snapshot, hashes | PENDING |
| Stale writer / second instance | unit harnesses plus the packaged second-launch check (protocol D) | test output, process evidence | PENDING |
| #743 Release invariant | invariant list re-verified on the candidate | checklist | PENDING |

## `TAG_ONLY_PENDING`

These cannot be produced before the tag:

- updater `.sig` files and the signed macOS `.app.tar.gz` updater bundle;
- `latest.json` generation (version, platform keys without Intel macOS, asset URLs, signatures);
- GitHub Release publication and the attached asset set, including the three notices/SBOM pairs;
- the tag-triggered `docker.yml` run, which moves GHCR `:1.29` and `:latest` from the v1.29.0
  image to the v1.29.1 image;
- `verify-release-tag` on the signed tag.

## Known limitations of the v1.29.1 candidate

Unchanged from v1.29.0 (`docs/RELEASE-V1.29.0-EVIDENCE.md`): #614, #602, #518, no OS-native code
signing or notarization (#574), Intel macOS is not claimed (#507), and the JavaScript inventory is
the pnpm production graph (#575). Deferred dependencies are dispositioned on each PR and #872.
