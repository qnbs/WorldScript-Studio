# Deployment — GitHub Pages, Vercel & Cloudflare Pages

WorldScript Studio is a **static SPA** (Vite → `dist/`). API keys stay **client-side** in IndexedDB; do **not** put Gemini/OpenAI secrets in host **environment variables** for inference.

## Base path matrix

| Target | Build command | Vite `base` | Typical URL |
|--------|---------------|-------------|---------------|
| **GitHub Pages** (default CI) | `pnpm run build` | `/WorldScript-Studio/` | `https://<user>.github.io/WorldScript-Studio/` |
| **Vercel** | `pnpm run build:edge` | `/` | `https://<project>.vercel.app/` |
| **Cloudflare Pages** | `pnpm run build:edge` | `/` | `https://<project>.pages.dev/` |

Edge builds run [`scripts/build-edge.mjs`](../scripts/build-edge.mjs): sets `DEPLOY_TARGET=edge`, patches `public/manifest.json`, `offline.html`, `404.html`, then `vite build`.

---

## GitHub Pages (canonical upstream)

1. Repo **Settings → Pages → Build and deployment**: source **GitHub Actions**.
2. Push to `main`; workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs **build** + **e2e**, then **deploy** uploads `dist/` (built with `pnpm run build`, subpath base).
3. Environment **github-pages** must exist (created on first successful deploy).

### Health check after push

```bash
# Pages enabled?
gh api repos/:owner/:repo/pages 2>/dev/null || echo "Pages API: not configured or billing/plan blocked"

# Latest deploy workflow
gh run list --workflow="CI / CD" --limit 3
gh run view <run-id> --log-failed
```

**Billing / availability:** If the **deploy** job is skipped or fails with `Resource not accessible`, check **Settings → Billing** (Actions minutes, Pages for private repos). Public forks get Pages on the fork owner’s plan. The app remains buildable locally with `pnpm run build && pnpm run preview`.

---

## Vercel

1. **Import** the Git repository; **Root Directory** = repo root.
2. Framework: **Other** (or Vite). Settings are overridden by [`vercel.json`](../vercel.json):
   - **Install:** `pnpm install --frozen-lockfile`
   - **Build:** `pnpm run build:edge`
   - **Output:** `dist`
3. **Node.js** ≥ 22 (Project Settings → General).
4. **Environment variables (optional):** `DEPLOY_TARGET=edge` — redundant if using `build:edge`; do **not** add AI API keys for end users.
5. SPA routing: `rewrites` in `vercel.json` → `index.html`.
6. **Preview deployments:** enabled per branch/PR by default.

---

## Cloudflare Pages

### Dashboard (recommended — no Wrangler in CI)

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Pages** → Connect Git.
2. **Build command:** `pnpm install && pnpm run build:edge`
3. **Build output directory:** `dist`
4. **Deploy command:** **leave completely empty** — Cloudflare uploads `dist` after a successful build.
5. **Do not use** `npx wrangler deploy` (Workers) nor `wrangler pages deploy` in the deploy step — redundant and often fails on API token scope in the build container.
6. If the UI forces a deploy command, use: `pnpm run deploy:cloudflare` — it **exits 0** on Cloudflare (`CF_PAGES=1`) without calling Wrangler.
7. Remove **`CLOUDFLARE_API_TOKEN`** from Pages **build** environment variables unless you have a dedicated manual deploy workflow; it is not needed for Git-based Pages.
8. **Environment variables (build):** `NODE_VERSION=22`, `PNPM_VERSION=10` (or Corepack).
9. **Root:** repository root; **Package manager:** pnpm.

> **Status:** Optional GitHub workflow [`.github/workflows/deploy-cloudflare-pages.yml`](../.github/workflows/deploy-cloudflare-pages.yml) is **paused** (`if: false`). Prefer dashboard-only Pages deploy.

Static extras in `public/`:

- [`_redirects`](../public/_redirects) — SPA fallback `/* → /index.html`
- [`_headers`](../public/_headers) — cache + security headers

Local preview with Wrangler (optional):

```bash
pnpm run build:edge
pnpm exec wrangler pages dev dist
```

Config: [`wrangler.toml`](../wrangler.toml).

### GitHub Actions (optional)

Workflow [`.github/workflows/deploy-cloudflare-pages.yml`](../.github/workflows/deploy-cloudflare-pages.yml) runs only when secrets are set:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Pages deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from dashboard |

Without secrets the job is **skipped** (fork-safe).

### Tag-triggered deploy (optional)

Workflow [`.github/workflows/deploy-cloudflare-pages.yml`](../.github/workflows/deploy-cloudflare-pages.yml) can run on `v*` tags when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. Prefer dashboard Git integration for day-to-day deploys; use tags for release snapshots.

```bash
pnpm run build:edge
pnpm run deploy:cloudflare   # exits 0 on CF_PAGES=1; otherwise wrangler pages deploy dist
```

---

## Local parity

```bash
# GitHub Pages-shaped build
pnpm run build && pnpm run preview

# Vercel / Cloudflare-shaped build (root base)
pnpm run build:edge && pnpm exec vite preview --base /
```

---

## Security notes

- No server-side storage of manuscripts or API keys.
- CSP in [`index.html`](../index.html) / Tauri [`tauri.conf.json`](../src-tauri/tauri.conf.json) — extend `connect-src` only when adding new AI hosts.
- Service worker: AI hosts are **network-only** ([`public/sw.js`](../public/sw.js)); WASM/ONNX not precached.

---

**Pricing / SLAs:** Vendor pricing changes frequently — verify current Pages, Vercel, and Cloudflare plans before production commitments.
