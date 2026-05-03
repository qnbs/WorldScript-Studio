# Tauri desktop CI

Workflow: [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)

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

## Follow-ups (not automated here)

- Production code signing (especially macOS notarization) and publishing `latest.json` for each release remain maintainer-specific; track progress in [`ROADMAP.md`](../ROADMAP.md) / [`TODO.md`](../TODO.md).
