# Tauri desktop CI

Workflow: [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)

> **Documentation:** Full `.md` index → [`README.md`](../README.md#-documentation-hub) § Documentation Hub; [`AUDIT.md`](../AUDIT.md) lists all 15 maintainer guides.

## Triggers

- **Manual:** Actions → “Tauri desktop build” → Run workflow  
- **Tags:** pushing `v*` (e.g. `v1.2.0`) starts a build on Ubuntu, Windows, and macOS in parallel.

## Outputs

Each matrix job uploads **`tauri-bundle-<os>`** containing `src-tauri/target/release/bundle/` (`.deb`, `.msi`/`.exe`, `.dmg`/`.app` depending on OS).

### GitHub Releases (tags only)

When the workflow runs on a **`v*`** tag (not on manual `workflow_dispatch` alone), a follow-up **`release`** job downloads all `tauri-bundle-*` artifacts, collects `.deb`, `.AppImage`, `.rpm`, `.msi`, `.exe`, and `.dmg` files, and publishes them on a **GitHub Release** for that tag (`softprops/action-gh-release`). If no matching bundle files are found, the release step is skipped with a warning.

This workflow is **independent** of the web PWA pipeline ([`docs/CI.md`](CI.md)); it does not gate GitHub Pages deploy.

## Local parity

```bash
pnpm install --frozen-lockfile
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

| Issue | Status |
|-------|--------|
| `src-tauri/Cargo.toml` — unused `specta = "2"` / `tauri-specta = "2"` | **Fixed** — both removed |
| `src-tauri/src/lora.rs` — `LoraEnvReport` missing `Deserialize` | **Fixed** — `Deserialize` added |
| `src-tauri/src/lib.rs` — obsolete `Builder::on_event()` + `RunEvent::Opened`/`SecondInstance` | **Fixed** — handlers removed; single-instance plugin handles deep links |
| Ubuntu/macOS/Windows bundle jobs | **Green** on `workflow_dispatch` |

**Remaining non-code blocker for a fully signed release:**

- **Updater signing secret** — for `v*` tag releases, `TAURI_SIGNING_PRIVATE_KEY` must be a valid minisign key. `workflow_dispatch` test builds unset the secret and disable updater artifacts (`createUpdaterArtifacts = false`), so they build without signing. Regenerate per *First-release checklist* when ready to publish.

## Desktop UX (v1.9)

| Feature | Implementation |
|---------|----------------|
| **Native menu** | `src-tauri/src/lib.rs` — File (Export, Settings, Quit), Help → emits `menu-action` |
| **Frontend bridge** | `services/tauriMenuService.ts` + `App.tsx` maps to `nav-export`, `nav-settings`, `nav-help` |
| **Window state** | `tauri-plugin-window-state` restores size/position between sessions |
| **Data folder** | Settings → Data → “Open data folder” (`services/tauriRuntime.ts`) |

## Auto-update & signing

- Updater plugin is wired in Rust + `tauri.conf.json`; full operational steps (keys, `latest.json`, CI secrets) are in [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md).
- The **Tauri desktop build** workflow passes `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when configured in repository secrets (optional — omit until keys exist).

## First-release checklist

Complete these steps once before pushing the first signed release tag:

```
1. pnpm exec tauri signer generate -- -w ~/.storycraft-tauri.key
   # Copy the public key → tauri.conf.json → plugins.updater.pubkey
   # Copy the private key material → GitHub repo secret TAURI_SIGNING_PRIVATE_KEY

2. Set GitHub repo secrets (Settings → Secrets → Actions):
   - TAURI_SIGNING_PRIVATE_KEY      (private key from step 1)
   - TAURI_SIGNING_PRIVATE_KEY_PASSWORD  (key password or empty string)

3. Push a v*.* tag  (e.g. git tag v1.6.0 && git push --tags)
   → All 3 matrix jobs build and sign bundles
   → release job uploads installers + latest.json to GitHub Release

4. Verify release-assets in the GitHub Release:
   - tauri-bundle-ubuntu-22.04  → .deb, .AppImage + .sig files
   - tauri-bundle-windows-latest → .msi/.exe + .sig files
   - tauri-bundle-macos-latest  → .dmg + .sig files
   - latest.json  (auto-updater manifest with signatures)

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
| File Associations | `.storycraft` and `.scst` extensions registered; double-click opens project |
| Single-Instance | Second instance focuses main window + opens file via `RunEvent::SecondInstance` |

## Native File Associations (v1.20)

StoryCraft Studio registers `.storycraft` and `.scst` file extensions for native project opening.

### Configuration

- `tauri.conf.json` → `bundle.fileAssociations` registers both extensions with `role: "Editor"`
- `tauri.conf.json` → `app.deepLink.protocols` enables `storycraft://` protocol
- `src-tauri/src/lib.rs` → `RunEvent::Opened` and `RunEvent::SecondInstance` handlers
- `services/tauriDeepLink.ts` → Frontend event listener for `open-project-file`

### Behavior

1. **Double-click** a `.storycraft` or `.scst` file → App opens (or activates existing instance) and loads the project
2. **Drag-drop** file onto app icon → Same behavior as double-click
3. **Second instance** → Main window focused, file opened in existing instance
4. **Error handling** → Toast notification with error details if file cannot be loaded

### Icon Preparation

Create icons in `icons/` directory:
- `icons/storycraft-16x16.png` - File icon for Windows/Linux
- `icons/storycraft-32x32.png` - File icon for Windows/Linux
- `icons/storycraft-48x48.png` - File icon for Windows/Linux
- `icons/storycraft-256x256.png` - File icon for Windows/Linux

macOS uses the existing `icons/icon.icns` for file associations.

**Post-release (updater):**

6. Set `plugins.updater.active = true` in `tauri.conf.json` (commit + push).
7. Push a patch tag (`v*.*.+1`) to test auto-update — installed app should prompt to update.
8. Verify the version shown in Settings matches the tag.

See [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) for full secrets reference and platform code-signing details.

## Follow-ups (not automated here)

- macOS notarization requires `APPLE_*` secrets — see [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) § macOS code signing.
- Windows Authenticode signing requires a CA-issued Authenticode certificate — track in [`TODO.md`](../TODO.md).
