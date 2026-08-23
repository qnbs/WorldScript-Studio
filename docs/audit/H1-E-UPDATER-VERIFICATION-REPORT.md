# H1-E updater artifact verification report

Status: `PASS` — the historical updater artifacts independently verify with the same
`minisign-verify 0.2.5` library used by the production Tauri updater path.

## Scope and immutable release boundary

This report evaluates the published, immutable `v1.28.1` release only. It does not modify the tag,
release assets, `latest.json`, or any private signing material. The target artifacts are the three
updater payloads represented in the published manifest:

| Platform | Payload | Signature |
| --- | --- | --- |
| `linux-x86_64` | `WorldScript.Studio_1.28.1_amd64.AppImage` | matching `.sig` |
| `windows-x86_64` | `WorldScript.Studio_1.28.1_x64-setup.exe` | matching `.sig` |
| `darwin-aarch64` | `WorldScript.Studio.app.tar.gz` | matching `.sig` |

The release has no `darwin-x86_64` entry and no Intel artifact is inferred or added.

## Evidence established

The existing release ledger establishes that:

- the immutable versioned release URLs resolve to the expected `v1.28.1` assets;
- `latest.json` has the expected version and platform mappings;
- each listed updater payload has a matching non-empty `.sig` asset;
- the updater public key configured in `src-tauri/tauri.conf.json` is recorded without exposing a
  private key;
- source commit verification, the annotated release tag, and the tag target were independently
  verified by GitHub.

Those facts establish asset identity and publication structure. They do not establish that the
payload bytes verify against the updater public key until the verification evidence below is
considered.

## Verifier capability audit

The authorized verification environment was checked against the installed repository toolchain:

| Capability | Result |
| --- | --- |
| Tauri CLI | `tauri-cli 2.11.4`; exposes signer generation/signing, not artifact verification |
| `minisign` executable | Not installed |
| `signify` executable | Not installed |
| Production-compatible verifier | `minisign-verify 0.2.5`, already locked transitively through `tauri-plugin-updater 2.10.1` |
| Private signing key access | Not performed |
| Independent public-key verification | Completed with the production-compatible library |

The audit harness in `src-tauri/examples/verify-updater-artifact.rs` follows the production updater
implementation: it Base64-decodes the configured public-key text, decodes the Minisign public key,
Base64-decodes the release signature text, decodes the Minisign signature, and calls
`PublicKey::verify(..., true)`. The `true` value preserves the production plugin's legacy-signature
compatibility behavior. The harness reads `plugins.updater.pubkey` directly from the checked-in
`src-tauri/tauri.conf.json`; the positive path cannot be pointed at an arbitrary public key. The
unrelated key is available only through the explicit `--wrong-key` negative-test option. Negative
mode accepts only an explicit cryptographic rejection (`Ok(false)`); artifact-read, signature-decode,
public-key-decode, and other setup errors fail the test. The verifier is a development-only audit
dependency; it does not change runtime updater behavior or access private signing material.

## Immutable asset acquisition and digest evidence

The verification inputs were fetched from the immutable `v1.28.1` release with the following
command. `$VERIFY_DIR` was a newly created temporary directory and is shown as
`/tmp/worldscript-h1e-verify.AgLQxd` below for reproducibility:

```bash
VERIFY_DIR=/tmp/worldscript-h1e-verify.AgLQxd
gh release download v1.28.1 --repo qnbs/WorldScript-Studio \
  --pattern 'WorldScript.Studio_1.28.1_amd64.AppImage' \
  --pattern 'WorldScript.Studio_1.28.1_amd64.AppImage.sig' \
  --pattern 'WorldScript.Studio_1.28.1_x64-setup.exe' \
  --pattern 'WorldScript.Studio_1.28.1_x64-setup.exe.sig' \
  --pattern 'WorldScript.Studio.app.tar.gz' \
  --pattern 'WorldScript.Studio.app.tar.gz.sig' \
  --pattern 'latest.json' \
  --dir "$VERIFY_DIR"
sha256sum "$VERIFY_DIR"/*
```

The local hashes matched the GitHub Release API `digest` for every input. The GitHub asset IDs,
published sizes, and matched SHA-256 digests are retained here as immutable external anchors:

| Asset | GitHub asset ID | Size | SHA-256 |
| --- | --- | ---: | --- |
| `latest.json` | `RA_kwDOQOeAgc4fVw-x` | 1,928 | `06527480219279919002825c631b78d48e35e725f4981d984f0dec02f5643d09` |
| `WorldScript.Studio.app.tar.gz` | `RA_kwDOQOeAgc4fVw9N` | 84,781,830 | `dd5366e0d47c69c0c3fdbc9351211ebf5d9d59c94bc0ed1bc866155afcda51a3` |
| `WorldScript.Studio.app.tar.gz.sig` | `RA_kwDOQOeAgc4fVw9J` | 420 | `6d465c73c66585eb548a5d8ab7c7e512d8a05771c001b5635bea73bfd1fa0e32` |
| `WorldScript.Studio_1.28.1_amd64.AppImage` | `RA_kwDOQOeAgc4fVw9I` | 162,765,304 | `db1a4f7269dd0579ea61824adfd386a107ee286525301e00d4568216ab1a32ee` |
| `WorldScript.Studio_1.28.1_amd64.AppImage.sig` | `RA_kwDOQOeAgc4fVw9K` | 436 | `87bdbe1f2f66ddff8975634d94e607af8b97564bdf5d57e201a806f3125845fb` |
| `WorldScript.Studio_1.28.1_x64-setup.exe` | `RA_kwDOQOeAgc4fVw9H` | 83,189,573 | `1582b8979cf9006f07fb2a43ed861658994c525f7498738181487c80ab4c132e` |
| `WorldScript.Studio_1.28.1_x64-setup.exe.sig` | `RA_kwDOQOeAgc4fVw9F` | 432 | `38a7b896fb292dfbcdba0f0b3798f54387001b34afb47f42936eaf296feca4f7` |

The exact harness invocations were:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage" \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage.sig"
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_x64-setup.exe" \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_x64-setup.exe.sig"
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio.app.tar.gz" \
  "$VERIFY_DIR/WorldScript.Studio.app.tar.gz.sig"
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage" \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage.sig" --expect-failure --tamper
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage" \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage.sig" --expect-failure --wrong-key
cargo run --manifest-path src-tauri/Cargo.toml --locked --example verify-updater-artifact -- \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_amd64.AppImage" \
  "$VERIFY_DIR/WorldScript.Studio_1.28.1_x64-setup.exe.sig" --expect-failure
```

## Verification results

The harness was run against the immutable release assets represented by `latest.json`:

| Test | Result |
| --- | --- |
| Linux AppImage + matching signature | `PASS` |
| Windows setup executable + matching signature | `PASS` |
| macOS ARM updater `app.tar.gz` + matching signature | `PASS` |
| Tampered Linux artifact | `PASS` — rejected |
| Linux artifact with unrelated public key | `PASS` — rejected |
| Linux artifact with Windows signature | `PASS` — rejected |

No release tag, asset, manifest, or private key was modified or accessed.

## Negative-test status

The negative tests reject altered bytes, an unrelated public key, and a signature belonging to a
different artifact. This is independent updater-payload cryptographic evidence; it is not evidence
of Apple Developer ID signing, notarization, Windows Authenticode, source-commit signing, or tag
signing.

## Decision and next gate

H1-E is `PASS` for the scoped updater-payload verification requirement. The repository may claim
independent cryptographic verification of these three historical updater payloads using the
configured public key and production-compatible verifier, while retaining the separate platform
code-signing and notarization limitations.

This does not block unrelated H1 evidence work. Claims beyond updater-payload verification, such as
platform code signing or notarization, still require their own evidence and must not be inferred
from this result.
