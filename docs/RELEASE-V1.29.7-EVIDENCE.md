# v1.29.7 release evidence

**Status: VERIFIED — desktop, updater and container image published on 2026-11-14.** The signed annotated tag
`v1.29.7` (tag object `64725463a9acbab7c3cdd171578e1afe6ef1f8cf` → `80e1119069e5e7daadeaa3272622ad28f7cf5590`) was
pushed once on 2026-11-14. The [GitHub Release](https://github.com/qnbs/WorldScript-Studio/releases/tag/v1.29.7) is
`Latest` with 25 assets. GHCR `1.29.7`, `1.29` and `latest` point to
`sha256:c15a909d2ebaff24be6215f65f4b64cc8a5a128f85452e939a9c0f648f7ebd1f`; `1.29.6` is unchanged. Readback record:
#1277 (post-publish receipt, comment 6870708655).

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
  - Dependabot #1241 / #1290 (npm minor/patch group); the RTK hold stays;
  - Kokoro restoration (after R-15) and all R-15 work; Gate 4 stays `PAUSED_BY_OWNER`.

## State ladder

| State       | Required evidence                                                                                                   | Status                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `PREPARED`  | Signed version-preparation PR merged; version metadata synchronized; resulting-main gates complete                  | REACHED 2026-11-14 01:47Z |
| `CANDIDATE` | Exact protected main SHA frozen after push CI/CD, CodeQL, Pages, Production, build check and retention              | REACHED 2026-11-14 01:50Z |
| `QUALIFIED` | Container precheck, fresh exact-candidate OSV, 4-leg packaging, arch checks, release rehearsal, upgrade checks      | REACHED 2026-11-14 02:16Z |
| `TAGGED`    | Signed annotated `v1.29.7` tag verified against the qualified SHA                                                   | REACHED 2026-11-14 02:32Z |
| `PUBLISHED` | All three tag workflows succeed: Tauri (desktop assets), Docker (GHCR image) and tag CI/CD                          | REACHED 2026-11-14 02:52Z |
| `VERIFIED`  | Release inventory, `latest.json` (7 entries) and signatures, checksums, both macOS architectures, GHCR bundle check | REACHED 2026-11-14 03:05Z |

## Candidate gates

All results are for the candidate `80e1119069e5e7daadeaa3272622ad28f7cf5590`, the merge of #1289. The GO/NO-GO
report is #1277 comment 6870082077.

| Gate                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Resulting-main CI/CD and CodeQL      | Push CI/CD [43540606757](https://github.com/qnbs/WorldScript-Studio/actions/runs/43540606757) (build provenance attestation included) and CodeQL [43540606755](https://github.com/qnbs/WorldScript-Studio/actions/runs/43540606755)                                                                                                                                                                                                                                                       | PASS   |
| Vercel Production and retention      | Production deployment 7780563461 and Pages deployment 7780788708 succeeded; HTTP 200 on both sites. Exact-main retention: `SAFE=0`, 0 writes, postproof 20/20, `RETENTION_COMPLETE=YES` (#627)                                                                                                                                                                                                                                                                                            | PASS   |
| No-push image build of the candidate | `docker-build-check.yml` push run [43540606781](https://github.com/qnbs/WorldScript-Studio/actions/runs/43540606781): DOMPurify 3.4.17 (≥ 3.4.17) in the image                                                                                                                                                                                                                                                                                                                            | PASS   |
| Container precheck                   | `node scripts/release-container-precheck.mjs 80e11190…` PASS on a complete run list                                                                                                                                                                                                                                                                                                                                                                                                       | PASS   |
| Exact-ref OSV                        | Scheduled-scan dispatch [43540674982](https://github.com/qnbs/WorldScript-Studio/actions/runs/43540674982) over `pnpm-lock.yaml` (1659 packages), `src-tauri/Cargo.lock` (571) and `crates/Cargo.lock` (175); 16 waived findings, 0 unwaived; earliest waiver expiry 2027-01-31                                                                                                                                                                                                           | PASS   |
| 4-leg candidate builds               | Non-publishing Tauri dispatch [43540678169](https://github.com/qnbs/WorldScript-Studio/actions/runs/43540678169), all legs on Node 22.23.5 and rustc 1.100.0: Linux, Windows, macOS arm64 (`archs=arm64`, DMG checksum valid) and macOS Intel (`archs=x86_64`, DMG checksum valid); stored updater signing key verified                                                                                                                                                                   | PASS   |
| Desktop instance lock                | The 3-OS run [43373658805](https://github.com/qnbs/WorldScript-Studio/actions/runs/43373658805) on `0bbed1ec` used rustc 1.99.1, the bundles use 1.100.0, and the lock lives in `std`. Re-proven on the unchanged `instance_lock.rs` with rustc 1.100.0 on Linux, Windows, macOS arm64 and macOS Intel: [43544741678](https://github.com/qnbs/WorldScript-Studio/actions/runs/43544741678) (evidence branch, never merged). This proves the lock implementation, not the installed bundle | PASS   |
| Release rehearsal (#1219)            | Release-notes step with real bash and GNU grep for `v1.29.7`: exit 0, 19 entries. Release guard on the candidate's real artifact names plus the tag-only names: the 24-asset set is accepted; without Intel, or with an unrenamed Intel payload, it is rejected                                                                                                                                                                                                                           | PASS   |
| Upgrade paths                        | 1.29.6 → candidate [43543831878](https://github.com/qnbs/WorldScript-Studio/actions/runs/43543831878): deb 24/24 user files and 3 IndexedDB databases with identical metadata; dmg 3 identical; NSIS one entry at 1.29.7; MSI major upgrade with one 1.29.7 entry. This proves that files survive, not that the app reads them (#1217)                                                                                                                                                    | PASS   |
| Read-only release preflight          | 63 PASS / 0 FAIL during qualification and again from 02:25:08Z to 02:26:43Z, directly before the tag                                                                                                                                                                                                                                                                                                                                                                                      | PASS   |

## Publication and readback

| Gate                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Signed annotated tag     | Tag object `64725463…` → `80e11190…`; `git tag -v` reports a good ED25519 signature (the key that signed v1.29.6); GitHub `verified=true`; pushed once under the tag-creation ruleset's maintainer bypass                                                                                                                                                                                                                                                       | PASS   |
| Tag CI                   | CI / CD [43546827272](https://github.com/qnbs/WorldScript-Studio/actions/runs/43546827272), attempt 1. Skipped by design: PR size governance (pull requests only), Pages deploy and build attestation (`main` only)                                                                                                                                                                                                                                             | PASS   |
| GHCR publication         | Docker [43546827155](https://github.com/qnbs/WorldScript-Studio/actions/runs/43546827155), attempt 1. `1.29.7`, `1.29` and `latest` = `sha256:c15a909d…`; labels `revision=80e11190…`, `version=1.29.7`; SLSA v1 provenance in the registry with this run as builder                                                                                                                                                                                            | PASS   |
| Published image check    | Anonymous pull of the linux/amd64 manifest `sha256:492b64e8…`; all 11 layer digests verified; web layer `sha256:f356e5e1…` with 216 JavaScript files; `DOMPurify 3.4.17 (>= 3.4.17) in assets/purify.es-Ccsbm8NY.js`                                                                                                                                                                                                                                            | PASS   |
| Tauri publication        | [43546827252](https://github.com/qnbs/WorldScript-Studio/actions/runs/43546827252), attempt 1. Release published 02:47:17Z, `Latest`, 25 assets. The release guard passed on collect, before publishing and after publishing. Every asset's SHA-256 equals GitHub's digest, and its size and CRC32 equal the file produced by the tag run                                                                                                                       | PASS   |
| Updater manifest         | `latest.json` is 1.29.7 with 7 entries (`linux-x86_64`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, `windows-x86_64-msi`, `darwin-aarch64`, `darwin-x86_64`). The served endpoint `releases/latest/download/latest.json` is byte-identical to the asset. For each entry, the URL downloads with the asset's size, the minisign file and trusted-comment signatures verify against the shipped key, and the trusted comment binds `version:1.29.7` | PASS   |
| Both macOS architectures | The published `WorldScript.Studio.app.tar.gz` contains a thin arm64 Mach-O and `WorldScript.Studio_x64.app.tar.gz` a thin x86_64 Mach-O, both `CFBundleShortVersionString 1.29.7`                                                                                                                                                                                                                                                                               | PASS   |

## Known limitations

- **OS code signing:** Apple Developer ID, notarization and Windows Authenticode are unavailable and
  deferred by maintainer decision (#574). It is not a release blocker. The README explains how to
  verify a download (signed tag, SHA-256 digests, version-bound updater signatures) and how to
  allow one launch.
- **Installed-app checks (#1217):** no installed app was updated through the updater end to end,
  and the upgrade paths prove file survival, not that the app reads the data. WebDriver sessions on
  the installed app are proven on Linux and Windows; macOS has no WebDriver path.
- **DuckDB analytics (#716):** unavailable in this version; the settings toggle and the help article
  are hidden, and local RAG ranks from the IndexedDB index.
- **Voice:** off by default. Voice error messages are still English (#1282 / #1288). The
  dictation-race follow-ups F1–F6 on #1265 are open; none is a regression from 1.29.6. Kokoro
  remains unavailable.
- **CI:** `instance-lock-platforms.yml` compiles with the runner's rustc; pinning it is tracked on
  #1274.
- **Accepted risks:** four npm and five Rust advisories remain time-bounded waivers until
  2027-01-31 (#1163, #1164); requalification is due by 2027-01-15.
