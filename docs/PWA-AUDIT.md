# PWA Audit — WorldScript Studio (v1.8)

Baseline from [ROADMAP.md](../ROADMAP.md) UX/PWA section. Status: **2026-05-21**.

## Manifest ([public/manifest.json](../public/manifest.json))

| Check | Status |
|-------|--------|
| `display_override` (standalone + minimal-ui) | Done |
| Shortcuts (templates, manuscript, writer, scene board, session) | Done |
| `share_target` GET params | Done |
| `launch_handler` navigate-existing | Done |
| `handle_links` preferred | Done (v1.8) |
| Maskable + any icons | SVG `favicon.svg` |
| `protocol_handlers` web+worldscript | Done |

Optional later: PNG 192/512 for store listings; `screenshots` for install UI.

## Service Worker ([public/sw.js](../public/sw.js))

| Check | Status |
|-------|--------|
| Version sync via `scripts/sync-sw-version.mjs` | Done (`predev` / `prebuild`) |
| Precache via Workbox `__WB_MANIFEST` only | Done |
| Network-only for AI / inference hosts | Verify in `sw.js` route rules |
| No precache of DuckDB-WASM / large ONNX | Do not add to precache |

## Runtime ([App.tsx](../App.tsx))

| Check | Status |
|-------|--------|
| `?view=` validated on boot | Done |
| Share target → toast + sessionStorage + URL clean | Done |
| `document.documentElement.lang` from i18n | Done |

## Install UX (optional)

- `beforeinstallprompt` deferred banner — feature-flagged future work
- Offline fallback copy via `useAnnounce` on failed navigation

## Local verification

```bash
pnpm run build && pnpm run preview
# Lighthouse PWA category (CI or powerful machine)
pnpm exec lhci autorun
```

See also [docs/CI.md](CI.md) and [infra/low-end-ci/DAILY-DRIVER.md](../infra/low-end-ci/DAILY-DRIVER.md).
