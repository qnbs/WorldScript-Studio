# Tauri auto-update & signing (v1.2.1+)

The desktop app ships with [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/) registered in [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs). Configuration lives in [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) under `plugins.updater`.

**v1.9 frontend:** Settings → **About** shows `TauriUpdaterBanner` when running inside Tauri (`hooks/useTauriUpdater.ts`). Users can check for updates and install without leaving the app (calls `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` for relaunch).

> **Documentation:** Full `.md` index → [`README.md`](../README.md#-documentation-hub) § Documentation Hub.

## Enable updates for end users

1. **Generate a minisign key pair** (once per product line — store the private key as a GitHub secret; never commit it):

   ```bash
   pnpm exec tauri signer generate -- -w ~/.worldscript-tauri.key
   ```

   Paste the **public** key string into `tauri.conf.json` → `plugins.updater.pubkey` (replace the placeholder).

2. **Set `plugins.updater.active` to `true`** after you publish signed update metadata (`latest.json`) with each release.

3. **CI signing** — the Tauri workflow passes optional secrets (see [`.github/workflows/tauri-build.yml`](../.github/workflows/tauri-build.yml)):

   - `TAURI_SIGNING_PRIVATE_KEY` — private key material for signing bundles / updater artifacts.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password for the key file, if used.

4. **Endpoints** — default endpoint points at the GitHub Releases static URL pattern for `latest.json`. Adjust if you host updates elsewhere (must be HTTPS in production).

## GitHub Secrets checklist

Set these in **Settings → Secrets and variables → Actions** before the first signed release:

### Required for all platforms

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | Output of `pnpm exec tauri signer generate` — the private key string (starts with `untrusted comment:`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key, or empty string if none |

### macOS code signing & notarization

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `APPLE_SIGNING_IDENTITY` | Certificate Common Name, e.g. `Developer ID Application: Acme Corp (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | App-specific password generated at appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character Apple team ID shown in the Developer portal |

macOS signing is skipped automatically if `APPLE_CERTIFICATE` is not set (the workflow uses `if: env.APPLE_CERTIFICATE != ''`). Add the conditional to the workflow step when ready.

### Windows Authenticode signing (optional)

Windows signing requires an Authenticode certificate from a CA (e.g. DigiCert, Sectigo). The exact secret names depend on the signing tool configured in the workflow. Common pattern with `signtool`:

| Secret | Value |
|--------|-------|
| `WINDOWS_CERTIFICATE` | Base64-encoded `.pfx` certificate file |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the `.pfx` file |

Add the signing step to the Windows matrix leg in `.github/workflows/tauri-build.yml` when you have a certificate.

## Code signing (Windows / macOS)

- **Windows**: Authenticode signing in CI (certificate in secrets) — configure via environment variables expected by your signing tool / Tauri bundler; document the exact variable names your certificate provider uses.
- **macOS**: Apple Developer ID + `codesign` + notarization — typically requires `APPLE_*` secrets and is configured outside this repo's defaults.

See also [`docs/TAURI-CI.md`](TAURI-CI.md) for the release artifact pipeline and first-release checklist.
