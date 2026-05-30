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
