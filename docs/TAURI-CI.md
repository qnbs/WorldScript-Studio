# Tauri desktop CI

Workflow: [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)

## Triggers

- **Manual:** Actions → “Tauri desktop build” → Run workflow  
- **Tags:** pushing `v*` (e.g. `v1.2.0`) starts a build on Ubuntu, Windows, and macOS in parallel.

## Outputs

Each matrix job uploads **`tauri-bundle-<os>`** containing `src-tauri/target/release/bundle/` (`.deb`, `.msi`/`.exe`, `.dmg`/`.app` depending on OS).

This workflow is **independent** of the web PWA pipeline ([`docs/CI.md`](CI.md)); it does not gate GitHub Pages deploy.

## Local parity

```bash
pnpm install --frozen-lockfile
pnpm run build          # frontend — also runs via Tauri beforeBuildCommand
pnpm exec tauri build
```

Linux dev deps match the Ubuntu job (WebKitGTK 4.1, AppIndicator, librsvg, patchelf).

## Follow-ups (not automated here)

- Code signing (Windows/macOS), `tauri-plugin-updater`, and attaching artifacts to a GitHub Release are tracked in [`ROADMAP.md`](../ROADMAP.md) / [`TODO.md`](../TODO.md).
