# Vendor-Fork Audit — `@domain/collab-transport` (y-webrtc)

- **Audit date:** 2026-07-25 · **Auditor:** Kimi Code · **Tracker:** issue #60
- **Baseline:** npm tarball `y-webrtc@10.3.0` (`npm pack y-webrtc@10.3.0`, sha-pinned registry)
- **Fork state at audit:** `10.3.0-sc1` → bumped to **`10.3.0-sc2`** (audit marker, no behavioural change)

## Method

Full-file `diff -u` of upstream `src/crypto.js` and `src/y-webrtc.js` against the vendored copies.
Upstream 10.3.0 ships exactly these two source files; the fork adds `index.ts` + `*.d.ts`
(TypeScript shims — fork-only additions, no upstream counterpart to diff).

## Result: fork matches upstream except for the three documented SC patches

### `src/crypto.js` (3 intentional deviations)

| # | Location | Deviation | Status |
|---|----------|-----------|--------|
| 1 | Fork header comment (lines 1–16) | Documents upstream tag, patch list, maintenance protocol, issue #60 link | ✅ expected |
| 2 | `deriveKey` | PBKDF2 iterations `100000` → **`600000`** (OWASP 2024 SHA-256 minimum) | ✅ invariant holds |
| 3 | `deriveKey` | `extractable` `true` → **`false`** (no `subtle.exportKey` leak) | ✅ invariant holds |
| 4 | `decrypt` error branch | added **`return`** before `promise.reject(...)` (silent-swallow fix) | ✅ invariant holds |

### `src/y-webrtc.js` (1 intentional deviation, 3 call sites)

RTCDataChannel payloads are now E2E-encrypted when `room.key` is set (upstream encrypts only
signaling-layer messages):

| Site | Change | Status |
|------|--------|--------|
| `sendWebrtcConn` | `cryptoutils.encrypt(data, room.key)` before `peer.send`; plaintext fallback when no key | ✅ expected |
| `broadcastWebrtcConn` | same encryption wrap for room broadcasts | ✅ expected |
| `WebrtcConn` `peer.on('data')` | `cryptoutils.decrypt(data, room.key)` before `readPeerMessage`; plaintext fallback | ✅ expected |

No other hunks. No upstream logic removed, no unexpected additions. `import * as cryptoutils from
'./crypto.js'` is present and used at the three sites (+ BroadcastChannel path, as upstream).

## Housekeeping findings (fixed in this audit)

| Finding | Resolution |
|---------|-----------|
| `patches/y-webrtc@10.3.0.patch` still present though deprecated since v1.19.0 | **removed** |
| Root `package.json` listed dead dependency `y-webrtc@^10.3.0` (zero imports) | **removed** + lockfile refreshed |
| `VENDOR-FORKS.md` referenced `scripts/verify-vendor-fork.mjs` + `verify:vendor` — neither existed | **created**, wired into package.json + CI `security` job |
| `VENDOR-DIFF.md` referenced by maintenance protocol — never existed | superseded by **this file** (`AUDIT.md`); protocol updated |

## Invariant guard

`pnpm run verify:vendor` (`scripts/verify-vendor-fork.mjs`) asserts: PBKDF2 600k iterations,
`extractable: false`, `return promise.reject(`, DataChannel encrypt/decrypt presence, `-scN`
version suffix, and absence of the dead upstream dependency/patch. Runs in the CI `security` job.

## Next audit trigger

Any upstream release `> 10.3.0`: diff `crypto.js` + `y-webrtc.js` against the new tag, port
security fixes, re-apply SC patches 1–3, bump `-scN`, record here and in `VENDOR-FORKS.md`.
