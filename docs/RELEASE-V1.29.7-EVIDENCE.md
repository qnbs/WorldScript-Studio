# v1.29.7 release evidence

**Status: in preparation (version-preparation PR #1289 open).** `PREPARED` is reached only when #1289 is merged and the
resulting-main gates pass; its merge commit is the release candidate. Gate results for that exact SHA are collected on
#1277 and written into this record by the post-release truth PR, as for v1.29.6, because any later change to this file
would change the candidate. Nothing is tagged or published. The tag `v1.29.7` is created only after a GO/NO-GO report
and separate maintainer authorization (#1277).

## Why 1.29.7

- **Background workers in the published app (#1272, #1278):** the WorkerBus workers shipped as raw
  TypeScript, failed to start and were respawned without limit. They are now bundled as JavaScript,
  and the respawn is bounded; the crash count resets only when a worker answers (#1273, #1281).
- **Desktop saving after a crash (#831):** a project lock left behind by a crash blocked saving.
  The desktop app now recovers it through an app-data instance lock (#1270).
- **Voice privacy (#1261, #556, #1265):**
  - browser speech recognition (Web Speech), which sends audio to the browser vendor, checks the
    stored consent before every start and asks only when none is stored (#1276, #1279);
  - the Local and Eco AI modes block Web Speech whatever consent is stored (#1284);
  - an explicit offline engine choice is honoured, and Kokoro is reported as unavailable (#1279);
  - local Whisper dictation works in the published app: ONNX Runtime loads its WASM from the app
    itself instead of a CDN the CSP blocks (#1257, #1260, #1242);
  - dictation and listening sessions no longer take over each other's state or microphone (#1285).
- **DuckDB analytics (#716):** their start-up never finished in the published app while the worker
  still touched OPFS. By maintainer decision they are switched off in a controlled way for this
  version (#1286).
- **Security advisories:** basic-ftp override floor (#1275) and the QUIC stack of the desktop app,
  `quinn-proto` 0.11.19 and `quinn-udp` 0.5.16 (#1287).
- **Provider boundaries:** OpenRouter model catalogs are bound to their key (#1259); LanguageTool
  results are bound to their endpoint and AI mode (#1258).

## Scope

- **Web app and container:** the changes above; the container image is rebuilt from the same
  commit. The build gate, the in-image DOMPurify check and the tag-time container precheck from
  1.29.5 apply unchanged.
- **Desktop:** the same web bundle plus the instance lock (#1270) and the QUIC advisory fix
  (#1287). The release matrix, updater configuration and release guard are unchanged from 1.29.6.
- **CI:** the Rust gates stay on Rust 1.99.1 until the artifact lookup reads cargo's JSON (#1274,
  #1283); Vercel stays on a Node major the CI matrix tests (#1280).
- **Storage:** no storage format change and no migration. Existing DuckDB/OPFS files in the browser
  are left untouched.
- **Not included (documented deferrals):**
  - voice error localization #1282 / #1288 (maintainer priority decision of 2026-11-13);
  - the follow-ups F1–F6 of the dictation races on #1265;
  - DuckDB re-enablement and an OPFS persistence design (#716);
  - the Cargo-JSON artifact harness (#1274) and the Node 26 adoption;
  - Dependabot #1241 (npm minor/patch group); the RTK hold stays;
  - Kokoro restoration (after R-15) and all R-15 work; Gate 4 stays `PAUSED_BY_OWNER`.

## State ladder

| State       | Required evidence                                                                                                   | Status  |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete                  | PENDING |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention              | PENDING |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 4-leg packaging, arch checks, release rehearsal, upgrade checks      | PENDING |
| `TAGGED`    | Signed annotated `v1.29.7` tag verified against the qualified SHA (maintainer action after authorization)           | PENDING |
| `PUBLISHED` | All three tag workflows succeed: Tauri (desktop assets), Docker (GHCR image) and tag CI/CD                          | PENDING |
| `VERIFIED`  | Release inventory, `latest.json` (7 entries) and signatures, checksums, both macOS architectures, GHCR bundle check | PENDING |

## Candidate and release gates

Results are recorded here for the exact candidate (the merge commit of #1289) once they exist.

| Gate                                 | Required evidence                                                                                                                        | Status  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Resulting-main CI/CD and CodeQL      | Push runs on the candidate                                                                                                               | PENDING |
| Vercel Production and retention      | Production and Pages deployments, HTTP 200, exact-main retention receipt (#627)                                                          | PENDING |
| No-push image build of the candidate | `docker-build-check.yml` push run: pnpm assertion, DOMPurify ≥ 3.4.17 in the image                                                       | PENDING |
| Container precheck                   | `node scripts/release-container-precheck.mjs <candidate>` on a complete run list                                                         | PENDING |
| Exact-ref OSV                        | Fresh `security-scheduled.yml` dispatch; the nine waivers expire 2027-01-31                                                              | PENDING |
| 4-leg candidate builds               | Non-publishing Tauri dispatch: Linux, Windows, macOS arm64 and macOS x86_64 bundles; `lipo`/DMG checks per arch; Node 22.23.5 in the log | PENDING |
| Desktop instance lock on 3 OSes      | `instance-lock-platforms.yml` on the candidate (#1270)                                                                                   | PENDING |
| Release rehearsal (#1219)            | Event-faithful, non-publishing rehearsal of the release job's inventory and manifest checks on the candidate's bundles                   | PENDING |
| Upgrade paths                        | 1.29.6 → 1.29.7 on Linux (deb), Windows (NSIS, MSI) and macOS (dmg), on an evidence branch that is never merged                          | PENDING |
| Read-only release preflight          | Main SHA, tag rulesets, release identity and signing key, versions, verifier pins, OSV, GHCR baseline, updater endpoint, container gate  | PENDING |

Only the tag run can prove the following. Dispatch builds never sign, so they are checked after
publication:

- updater signing and the seven signed `latest.json` entries with `version:1.29.7`;
- the release inventory against the 25 assets of v1.29.6;
- the GHCR digest and its bundle check.

## Known limitations

- **OS code signing:** Apple Developer ID, notarization and Windows Authenticode are unavailable and
  deferred by maintainer decision (#574). It is not a release blocker. The README explains how to
  verify a download (signed tag, SHA-256 digests, version-bound updater signatures) and how to
  allow one launch.
- **Installed-app automation (#1217):** WebDriver sessions on the installed release app are proven
  on Linux and Windows; macOS has no WebDriver path and remains a documented gap.
- **DuckDB analytics (#716):** unavailable in this version; the settings toggle and the help article
  are hidden, and local RAG ranks from the IndexedDB index.
- **Voice:** off by default. Voice error messages are still English (#1282). The dictation-race
  follow-ups F1–F6 on #1265 are open; none is a regression from 1.29.6. Kokoro remains unavailable.
- **Accepted risks:** four npm and five Rust advisories remain time-bounded waivers until
  2027-01-31 (#1163, #1164).
