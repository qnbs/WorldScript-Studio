# Deployment — GitHub Pages & Vercel

StoryCraft Studio is a **static SPA** (Vite → `dist/`). API keys stay **client-side** in IndexedDB; do **not** put Gemini/OpenAI secrets in Vercel/GitHub **environment variables** for inference — optional `VITE_*` build-time flags only if the project introduces them.

## GitHub Pages (canonical upstream)

1. Fork or use the repo; enable **Pages** → Source: **GitHub Actions**.
2. Push to `main`; the **deploy** workflow runs after **build** + **e2e** succeed.
3. Default live URL pattern: `https://<user>.github.io/StoryCraft-Studio/` — matches `vite.config.ts` **`base: '/StoryCraft-Studio/'`**.
4. Custom domain: see **Custom Domain Setup** in [`README.md`](../README.md); `base` becomes `/` when a `public/CNAME` is present.

## Vercel (equal deployment path)

Use this when you prefer Vercel previews and hosting instead of (or alongside) Pages.

1. **Import** the Git repository in Vercel; **Root Directory** = repo root.
2. **Framework preset:** Vite (or Other). **Build Command:** `pnpm run build` (runs `prebuild` → i18n bundle + `vite build`). **Output Directory:** `dist`.
3. **Production branch:** usually `main`; enable **Preview Deployments** for PRs.
4. **`base` / asset paths:**
   - **Custom domain at apex or subdomain (recommended on Vercel):** set Vite `base` to **`/`** for that deployment (or maintain a branch/env-specific config). Vercel serves the SPA from the domain root; [`vercel.json`](../vercel.json) includes SPA **rewrites** so client-side routing works.
   - **Under a subpath:** rarely needed on Vercel; if you mirror the GitHub Pages path, align `base` with that path and asset URLs.
5. **Security / privacy:** No AI keys in project Settings → Environment Variables for end-user inference. Keys remain **entered in the app** and encrypted locally — consistent with [`.github/SECURITY.md`](../.github/SECURITY.md).

### Optional `vercel.json`

The repo root [`vercel.json`](../vercel.json) documents the intended build/output and SPA fallback. Adjust only if your team uses a monorepo root or different output folder.

---

**Pricing / SLAs:** Cloud provider pricing changes frequently — treat any numeric claims as **“as of May 2026; check vendor pricing pages.”**
