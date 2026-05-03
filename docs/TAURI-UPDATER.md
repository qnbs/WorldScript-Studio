# Tauri auto-update & signing (v1.2.1+)

The desktop app ships with [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) registered in [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs). Configuration lives in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) under `plugins.updater`.

## Enable updates for end users

1. **Generate a minisign key pair** (once per product line — store the private key as a GitHub secret; never commit it):

   ```bash
   pnpm exec tauri signer generate -- -w ~/.storycraft-tauri.key
   ```

   Paste the **public** key string into `tauri.conf.json` → `plugins.updater.pubkey` (replace the placeholder).

2. **Set `plugins.updater.active` to `true`** after you publish signed update metadata (`latest.json`) with each release.

3. **CI signing** — the Tauri workflow passes optional secrets (see [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)):

   - `TAURI_SIGNING_PRIVATE_KEY` — private key material for signing bundles / updater artifacts.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the key file, if used.

4. **Endpoints** — default endpoint points at the GitHub Releases static URL pattern for `latest.json`. Adjust if you host updates elsewhere (must be HTTPS in production).

## Code signing (Windows / macOS)

- **Windows**: Authenticode signing in CI (certificate in secrets) — configure via environment variables expected by your signing tool / Tauri bundler; document the exact variable names your certificate provider uses.
- **macOS**: Apple Developer ID + `codesign` + notarization — typically requires `APPLE_*` secrets and is configured outside this repo’s defaults.

See also [`docs/TAURI-CI.md`](TAURI-CI.md) for the release artifact pipeline.
