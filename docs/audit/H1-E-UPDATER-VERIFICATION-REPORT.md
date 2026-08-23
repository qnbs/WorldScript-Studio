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
compatibility behavior. The verifier is a development-only audit dependency; it does not change
runtime updater behavior or access private signing material.

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
