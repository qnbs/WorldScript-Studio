# Vendor Fork Baseline — `@domain/collab-transport`

This package is a **vendored fork** of `y-webrtc`. Renovate/Dependabot cannot
update it automatically, so its security deltas are tracked here and enforced by
[`scripts/verify-vendor-fork.mjs`](../../scripts/verify-vendor-fork.mjs) in CI.

Audit log & checklist: [issue #60](https://github.com/qnbs/StoryCraft-Studio/issues/60).

## Baseline

| Field | Value |
|-------|-------|
| Upstream | [`y-webrtc` v10.3.0](https://github.com/yjs/y-webrtc) (npm tag `v10.3.0`) |
| Vendored package | `@domain/collab-transport` **`10.3.0-sc1`** |
| Vendored on | 2026-05-28 (commit `63afa69`) |
| Patched files | `src/crypto.js`, `src/y-webrtc.js` |

The `-sc1` suffix marks the first StoryCraft patch revision on top of upstream
`10.3.0`. On any new upstream release, diff `crypto.js` + `y-webrtc.js` against the
new tag, cherry-pick fixes, re-apply the C-1 patches below, and bump to
`<upstream>-sc1`.

## C-1 security patches (vs upstream `crypto.js`)

These are the **only** intentional security deviations from upstream. Each is
asserted by `verify-vendor-fork.mjs`; a regression fails CI.

| # | Patch | Location | Rationale |
|---|-------|----------|-----------|
| 1 | PBKDF2 iterations `100000` → `600000` | `crypto.js` `deriveKey` (`iterations: 600000`) | OWASP 2024 minimum for PBKDF2-SHA-256. |
| 2 | Derived AES-GCM key `extractable: false` | `crypto.js` `deriveKey` (4th arg after `{name:'AES-GCM',length:256}`) | Prevents key export via `crypto.subtle.exportKey` (SEC-RULE-5). |
| 3 | `return` before `promise.reject(...)` on unknown algorithm | `crypto.js` `decrypt()` | Upstream swallowed the rejection silently; the `return` makes `decrypt()` actually abort on a tampered/unknown algorithm header. |

## Maintenance

1. Pull the new upstream tag and `diff` it against `src/crypto.js` + `src/y-webrtc.js`.
2. Re-apply patches 1–3; verify all imports referenced by `y-webrtc.js` exist under `src/`
   (missing relative imports break Vercel builds — `UNRESOLVED_IMPORT`).
3. Bump `package.json` `version` to `<upstream>-sc1` and update the **Baseline** table.
4. Update `EXPECTED_VERSION` in `scripts/verify-vendor-fork.mjs`.
5. Run `pnpm run verify:vendor` and `pnpm exec vitest run tests/unit/collaborationService.test.ts`.
