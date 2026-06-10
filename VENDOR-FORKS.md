# Vendor Forks — Maintenance Log

This document tracks all vendored / forked dependencies that require manual
upstream monitoring and patch porting.

## `packages/collab-transport` (y-webrtc fork)

| Attribute | Value |
|-----------|-------|
| **Upstream** | `y-webrtc@10.3.0` |
| **Fork version** | `10.3.0-sc1` |
| **Reason for fork** | E2E encryption (AES-256-GCM via Web Crypto) is not available upstream. The fork adds PBKDF2 key derivation, non-extractable CryptoKeys, and encrypted WebRTC DataChannels compatible with the y-webrtc signalling protocol. |
| **Critical invariants** | 1. PBKDF2 iterations must remain **600,000** (OWASP 2024 SHA-256 minimum).<br>2. All derived `CryptoKey` instances must have `extractable: false`.<br>3. `promise.reject()` in `decrypt()` must be prefixed with `return`. |
| **Update protocol** | 1. Watch upstream releases via GitHub API or Renovate (excluded in config).<br>2. On new upstream release, create a diff branch `vendor/y-webrtc-<version>`.<br>3. Port the three encryption patches manually; run `packages/collab-transport` test suite.<br>4. Update `VENDOR-DIFF.md` baseline and bump the `-scN` suffix. |
| **Owner** | qnbs |
| **Issue tracker** | #60 |

## `patches/y-webrtc@10.3.0.patch`

| Attribute | Value |
|-----------|-------|
| **Status** | **DEPRECATED** — the vendor fork above supersedes this patch. |
| **Action** | Safe to remove once the fork is confirmed stable in production (v1.19.0+). |

## Audit automation

`scripts/verify-vendor-fork.mjs` performs a static invariant guard:
- Asserts PBKDF2 iterations == 600k
- Asserts `extractable: false`
- Asserts `return promise.reject(...)`
- Asserts version string matches expected `-scN` suffix

Wired into CI security job as `verify:vendor`.

## CVE / advisory monitoring (audit finding F-7)

**Coverage boundary — read this before assuming OSV protects the fork.** The CI security job
(`.github/workflows/ci.yml` → *OSV vulnerability scan*) runs
`google/osv-scanner-action` against `--lockfile=pnpm-lock.yaml` and `--lockfile=src-tauri/Cargo.lock`
(`src-tauri/osv-scanner.toml` is only the Rust *ignore* list, not a scan-path config).

| Surface | Scanned by OSV? | How |
|---------|-----------------|-----|
| Fork's transitive npm deps (`lib0`, `simple-peer`, `y-protocols`, `yjs`) | ✅ Yes | They resolve into the root `pnpm-lock.yaml`, which OSV scans. |
| Vendored **y-webrtc source** (`packages/collab-transport/src/*.js`) | ❌ **No** | The fork removed `y-webrtc` from the dependency graph, so OSV has no package@version to match advisories against. A CVE filed against upstream `y-webrtc@10.3.0` would **not** be flagged automatically. |

**Manual process (the gap above):** because the upstream code is now first-party source, OSV cannot
see advisories against it. Therefore, on every fork-maintenance review (and at minimum quarterly):

1. Check the upstream advisory feeds directly — npm `npm audit`/advisories for `y-webrtc`, the
   [GitHub Security Advisories for `yjs/y-webrtc`](https://github.com/yjs/y-webrtc/security/advisories),
   and the project's release notes — for anything at or below our base `10.3.0`.
2. If a relevant advisory exists, port the upstream fix into the vendored `src/` alongside the three
   encryption patches, run the `packages/collab-transport` test suite + `pnpm run verify:vendor`,
   bump the `-scN` suffix, and record it in `VENDOR-DIFF.md`.
3. The fork's npm dependencies need no manual step — rely on the OSV `pnpm-lock.yaml` scan + Dependabot.

> Coverage policy for unit tests lives in [`docs/COVERAGE-POLICY.md`](docs/COVERAGE-POLICY.md).
