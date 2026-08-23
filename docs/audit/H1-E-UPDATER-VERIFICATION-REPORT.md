# H1-E updater artifact verification report

Status: `PARTIAL / RESIDUAL RISK` — structural release evidence is complete, but independent
cryptographic verification of the historical updater artifacts is not established.

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
payload bytes verify against the updater public key.

## Verifier capability audit

The authorized verification environment was checked against the installed repository toolchain:

| Capability | Result |
| --- | --- |
| Tauri CLI | `tauri-cli 2.11.4`; exposes signer generation/signing, not artifact verification |
| `minisign` executable | Not installed |
| `signify` executable | Not installed |
| Private signing key access | Not performed |
| Independent public-key verification | Not completed |

No compatible, trustworthy verifier already available in the repository or authorized environment
was identified. Implementing a verifier here would risk inventing or misapplying cryptography; adding
an unreviewed replacement is outside this evidence correction.

## Negative-test status

The required tampered-artifact, wrong-key, and cross-substitution tests are `PENDING` because no
trustworthy compatible verifier is available to execute them. They must be run together with the
positive checks if H1-E later admits a verifier. No successful signature claim is inferred from a
non-empty `.sig` file, the presence of a public key, or GitHub commit/tag verification.

## Decision and next gate

H1-E remains `PARTIAL / RESIDUAL RISK`, not `PASS`. The repository must not claim independent
cryptographic updater verification until a trustworthy compatible public-key verifier is selected
and the three positive plus three negative artifact tests pass without private-key access.

This does not block unrelated H1 evidence work. It does block any documentation or release claim
that calls the historical updater artifacts independently cryptographically verified.
