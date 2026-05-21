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

**Post-release (updater):**

6. Set `plugins.updater.active = true` in `tauri.conf.json` (commit + push).
7. Push a patch tag (`v*.*.+1`) to test auto-update — installed app should prompt to update.
8. Verify the version shown in Settings matches the tag.

See [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) for full secrets reference and platform code-signing details.

## Follow-ups (not automated here)

- macOS notarization requires `APPLE_*` secrets — see [`docs/TAURI-UPDATER.md`](TAURI-UPDATER.md) § macOS code signing.
- Windows Authenticode signing requires a CA-issued Authenticode certificate — track in [`TODO.md`](../TODO.md).
