# Tauri desktop CI

Workflow: [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)

> **Documentation:** Full `.md` index → [`README.md`](../README.md#-documentation-hub) § Documentation Hub; [`AUDIT.md`](../AUDIT.md) lists all 15 maintainer guides.

## Triggers

- **Manual:** Actions → “Tauri desktop build” → Run workflow
- **Tags:** pushing `v*` (e.g. `v1.2.0`) starts a build on Ubuntu, Windows, macOS Apple Silicon and macOS Intel in parallel.

### Build matrix

| Runner           | Target arch                              | Updater platform key |
| ---------------- | ---------------------------------------- | -------------------- |
| `ubuntu-22.04`   | x86_64 (AppImage / deb / rpm)            | `linux-x86_64`       |
| `windows-latest` | x86_64 (NSIS `-setup.exe`, MSI fallback) | `windows-x86_64`     |
| `macos-latest`   | **aarch64** (Apple Silicon)              | `darwin-aarch64`     |
| `macos-26-intel` | **x86_64** (Intel)                       | `darwin-x86_64`      |

**Intel Macs (x86_64) are built natively on `macos-26-intel` (#507, from v1.29.6).**

- **History:** `macos-13`, the last Intel runner under that label, left the matrix on 2026-07-28. Its jobs sat in GitHub's queue and never started, and because `release` waits for every bundle leg, that blocked the whole release for about 24 hours. `macos-15-intel` later provisioned, but pnpm 11 had no darwin-x64 binary.
- **Now:** `macos-26-intel` is GitHub's standard x64 macOS 26 label, and pnpm 12.13.0 ships a darwin-x64 binary. Dispatch 43107697907 built a native x86_64 bundle there.
- **Asset names:** Tauri names the macOS updater payload `WorldScript Studio.app.tar.gz` on both architectures, so the Intel leg renames its payload and `.sig` to `WorldScript Studio_x64.app.tar.gz` before upload. The Apple Silicon names stay unchanged.
- **Release guard:** `scripts/release-assets-guard.mjs` requires the x64 DMG, the Intel updater payload and its signature, and the `x86_64-apple-darwin` notices and SBOM. It writes `darwin-x86_64` into `latest.json` with the same signed-version check as the other platforms.
- **Release dependency:** the release needs both macOS legs. Every macOS leg checks its native architecture with `lipo` and verifies, mounts and inspects its DMG before upload. The installers are not notarized or Developer-ID-signed (#574).

## Outputs

Each matrix job uploads **`tauri-bundle-<os>`** containing `src-tauri/target/release/bundle/` (`.deb`, `.msi`/`.exe`, `.dmg`/`.app` depending on OS) plus its `third-party/` inventory.

### Third-party notices and SBOM (#871)

Before `tauri build`, each matrix job runs `node scripts/generate-third-party-inventory.mjs` for its Rust host target and writes:

- `worldscript-studio-<version>-<target>.third-party-notices.txt`, bundled into the installer as `THIRD_PARTY_NOTICES.txt` through a build-only `--config` merge of `bundle.resources` (so local `tauri dev`/`build` never needs the generated file);
- `worldscript-studio-<version>-<target>.cdx.json`, a CycloneDX 1.5 SBOM bound to the exact commit and target.

Scope: Rust crates reachable from the desktop crate through normal dependency edges for that target (first-party path crates and compile-time-only proc-macro crates excluded), and, for JavaScript, the production dependency graph in `pnpm-lock.yaml`: `dependencies` and `optionalDependencies` of the app and of the workspace packages it links, followed transitively, as installed on the build host. License metadata comes from `pnpm -r licenses list`; pnpm 12's `--prod` filter is not used because it drops optional and workspace-package dependencies. The JavaScript part is a documented superset of what Vite bundles. Outputs are deterministic for a given commit, lockfiles, and target. The step fails when a component has no license metadata. Licenses outside the permissive auto-accepted set, non-SPDX identifiers, and packages that ship no license text are listed at the top of the notices and in the job summary for human review. The inventory is not a legal opinion; the durable compliance policy (including future Qt admission) is owned by #575.

### GitHub Releases (tags only)

For a **`workflow_dispatch` on protected `main`**, the workflow also signs a deterministic throwaway payload with the configured updater secret, verifies it against the public key in `tauri.conf.json`, and proves tampered-payload and wrong-key signatures are rejected. This preflight publishes no assets. Manual matrix builds continue to disable updater bundle signing.

On a **`v*` tag**, each matrix job cryptographically verifies every updater-signed target package against the public key in `tauri.conf.json` before uploading its bundle. After the annotated tag and exact-ref OSV gates pass, the `release` job requires every matrix installer, required sidecar signature, four per-target SBOMs and four notices files. It preserves separate bundle directories so duplicate basenames cannot be overwritten during collection, and generates and validates all four `latest.json` updater entries before any public release is created. GitHub first receives the complete set as a **draft**; the job reads the uploaded asset inventory and SHA-256 digests back and publishes the draft only when they exactly match the validated local files. It then reads back the published tag state and final inventory. Missing, extra, mislabeled, empty, mismatched, or cryptographically invalid assets fail closed and leave the release unpublished.

This workflow is **independent** of the web PWA pipeline ([`docs/CI.md`](CI.md)); it does not gate GitHub Pages deploy.

## Local parity

```bash
node scripts/dependency-state.mjs reconcile
pnpm run build          # frontend — also runs via Tauri beforeBuildCommand
pnpm exec tauri build
```

Linux dev deps match the Ubuntu job (WebKitGTK 4.1, AppIndicator, librsvg, patchelf).

## Verifying native (Rust) changes — there is no PR-CI gate

The web `ci.yml` pipeline **never compiles `src-tauri/`**. This workflow only runs on
`workflow_dispatch` / `v*` tags, and the full crate often will not build on constrained dev hardware
(huge dep tree, WebKitGTK system libs, possible OOM). So a Rust change can merge through a green
web-CI while never having been compiled.

**The gate for any `src-tauri/` change is to dispatch this workflow on the branch:**

```bash
git push -u origin <branch>
gh workflow run tauri-build.yml --ref <branch>
gh run watch "$(gh run list --workflow=tauri-build.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

A run that reaches `Finished release profile … target(s)` and `Finished N bundles at:` has compiled
and packaged successfully. The **ubuntu** and **macOS** jobs are the meaningful Rust signal; the
**Windows** job currently fails earlier in the `./.github/actions/setup` composite (self-installer
exit `3221226505`) — an environment/infra issue, not Rust.

## Build health & known blockers (2026-06-12)

`tauri-build.yml` history:

- **2026-05-30 → 2026-06-03:** Red due to two compile-stage blockers (see [`AUDIT.md`](../AUDIT.md) § WorkerBus v2 Phase 3).
- **2026-06-03 → 2026-06-12:** Ubuntu bundles `.deb` / `.rpm` / `.AppImage` successfully; macOS/Windows still failed on `Builder::on_event()` / `RunEvent::Opened`/`SecondInstance`.
- **2026-06-12:** `src-tauri/src/lib.rs` updated — removed obsolete `Builder::on_event()` and `RunEvent::Opened`/`SecondInstance` handlers that conflicted with `tauri_plugin_single_instance`. The plugin already emits `"deep-link://new-url"` for second-instance/file-open events.
- **2026-06-12 (post-fix):** Full workflow dispatch run green on **Ubuntu** (`.deb`, `.rpm`, `.AppImage`), **macOS** (`.dmg`), and **Windows** (`.msi`, `.exe`).

| Issue                                                                                         | Status                                                                  |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src-tauri/Cargo.toml` — unused `specta = "2"` / `tauri-specta = "2"`                         | **Fixed** — both removed                                                |
| `src-tauri/src/lora.rs` — `LoraEnvReport` missing `Deserialize`                               | **Fixed** — `Deserialize` added                                         |
| `src-tauri/src/lib.rs` — obsolete `Builder::on_event()` + `RunEvent::Opened`/`SecondInstance` | **Fixed** — handlers removed; single-instance plugin handles deep links |
| Ubuntu/macOS/Windows bundle jobs                                                              | **Green** on `workflow_dispatch`                                        |

**Remaining non-code blocker for a fully signed release:**

- **Updater signing secret** — for `v*` tag releases, `TAURI_SIGNING_PRIVATE_KEY` must be a valid minisign key. `workflow_dispatch` test builds unset the secret and disable updater artifacts (`createUpdaterArtifacts = false`), so they build without signing. Regenerate per _First-release checklist_ when ready to publish.

## Desktop UX (v1.9)

| Feature             | Implementation                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **Native menu**     | `src-tauri/src/lib.rs` — File (Export, Settings, Quit), Help → emits `menu-action`          |
| **Frontend bridge** | `services/tauriMenuService.ts` + `App.tsx` maps to `nav-export`, `nav-settings`, `nav-help` |
| **Window state**    | `tauri-plugin-window-state` restores size/position between sessions                         |
| **Data folder**     | Settings → Data → “Open data folder” (`services/tauriRuntime.ts`)                           |

## Auto-update & signing

- Updater plugin is wired in Rust + `tauri.conf.json`; full operational steps (keys, `latest.json`, CI secrets) are in [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md).
- The **Tauri desktop build** workflow passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when configured in repository secrets (optional — omit until keys exist).

## First-release checklist

Complete these steps once before pushing the first signed release tag:

```
1. pnpm exec tauri signer generate -- -w ~/.worldscript-tauri.key
   # Copy the public key → tauri.conf.json → plugins.updater.pubkey
   # Copy the private key material → GitHub repo secret TAURI_SIGNING_PRIVATE_KEY

2. Set GitHub repo secrets (Settings → Secrets → Actions):
   - TAURI_SIGNING_PRIVATE_KEY      (private key from step 1)
   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (key password or empty string)

3. Push a v*.* tag  (e.g. git tag v1.6.0 && git push --tags)
   → All 4 matrix jobs build and sign bundles
   → security-audit runs the exact-ref OSV audit of the tagged commit (#911)
   → release job uploads installers + latest.json to GitHub Release, only if
     security-audit succeeded for that same SHA (otherwise it never runs)

4. Verify release-assets in the GitHub Release:
   - tauri-bundle-ubuntu-22.04  → .deb, .AppImage + .sig files
   - tauri-bundle-windows-latest → .msi/.exe + .sig files
   - tauri-bundle-macos-latest  → `_aarch64.dmg` + `WorldScript Studio.app.tar.gz` + .sig
   - tauri-bundle-macos-26-intel → `_x64.dmg` + `WorldScript Studio_x64.app.tar.gz` + .sig
   - latest.json  (auto-updater manifest with linux-x86_64, windows-x86_64, darwin-aarch64 and
     darwin-x86_64 entries; the release guard requires all four)

5. Download the installer for your OS, install the app, open it.

## Desktop audit checklist (v1.8)

| Area | Check |
|------|--------|
| CSP `connect-src` | OpenAI-compatible URLs, Ollama, WebRTC signaling — no DuckDB network |
| FS parity | Import/export via `storageService`; no direct `@tauri-apps/api` in UI atoms |
| Window / state | Single-window; close saves via listener middleware |
| Pandoc EPUB | `pandoc_markdown_to_epub` optional; JS fallback when unavailable |
| Updater | `docs/TAURI-UPDATER.md` when publishing signed tags |
| Local CI | Heavy builds optional — `infra/low-end-ci/` act + native `pnpm run ci:quick` |
| Version UI | Settings shows app version; matches release tag after install |
| File Associations | `.worldscript` and `.wsst` extensions registered; double-click opens project |
| Single-Instance | Second instance focuses main window + opens file via `RunEvent::SecondInstance` |

## Native File Associations (v1.20)

WorldScript Studio registers `.worldscript` and `.wsst` file extensions for native project opening.

### Configuration

- `tauri.conf.json` → `bundle.fileAssociations` registers both extensions with `role: "Editor"`
- `tauri.conf.json` → `plugins.deep-link.desktop.schemes` enables `worldscript://` (and legacy `storycraft://`) protocol
- `src-tauri/src/lib.rs` → `RunEvent::Opened` and `RunEvent::SecondInstance` handlers
- `services/tauriDeepLink.ts` → Frontend event listener for `open-project-file`

### Behavior

1. **Double-click** a `.worldscript` or `.wsst` file → App opens (or activates existing instance) and loads the project
2. **Drag-drop** file onto app icon → Same behavior as double-click
3. **Second instance** → Main window focused, file opened in existing instance
4. **Error handling** → Toast notification with error details if file cannot be loaded

### Icon Preparation

Create icons in `icons/` directory:
- `icons/worldscript-16x16.png` - File icon for Windows/Linux
- `icons/worldscript-32x32.png` - File icon for Windows/Linux
- `icons/worldscript-48x48.png` - File icon for Windows/Linux
- `icons/worldscript-256x256.png` - File icon for Windows/Linux

macOS uses the existing `icons/icon.icns` for file associations.

**Post-release (updater):**

6. Set `plugins.updater.active = true` in `tauri.conf.json` (commit + push).
7. Push a patch tag (`v*.*.+1`) to test auto-update — installed app should prompt to update.
8. Verify the version shown in Settings matches the tag.

See [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) for full secrets reference and platform code-signing details.

## Follow-ups (not automated here)

- macOS notarization and Windows Authenticode are **deferred**: the credentials are unavailable, and this is not a release blocker (#574). See [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) § Code signing.
- `tauri-intel-qualification.yml` remains a dispatch-only Intel lane for checks between releases; the release itself builds Intel in the `bundle` matrix. See `docs/native/INTEL-MACOS-QUALIFICATION.md`.
```
