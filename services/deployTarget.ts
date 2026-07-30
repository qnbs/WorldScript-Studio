// QNBS-v3 (ADR-0016 Track B): the app's three web deploy targets differ in whether a serverless
// function can exist at all — Vercel and Cloudflare Pages can host api/claude-proxy.ts /
// functions/api/claude-proxy.ts, GitHub Pages is pure static hosting and never can (see
// docs/adr/0016). Desktop (Tauri) doesn't need this at all — Track A's native-HTTP path bypasses
// CORS directly; callers must check isTauriRuntime() first.
import { GITHUB_PAGES_BASE } from '../config/resolveViteBase';

/**
 * True when the current web build is served from a host that can run a serverless function
 * (Vercel, Cloudflare Pages, or local dev), false on the static-only GitHub Pages mirror.
 *
 * Signal: `import.meta.env.BASE_URL` is Vite's build-time-injected base path — already this
 * codebase's canonical GitHub-Pages-vs-edge marker (see config/resolveViteBase.ts, which computes
 * it from the same GITHUB_PAGES_BASE constant). GitHub Pages project pages are always served from
 * the '/WorldScript-Studio/' subpath; Vercel, Cloudflare Pages, and custom domains serve from '/'.
 */
export function isServerlessProxyCapable(): boolean {
  return import.meta.env.BASE_URL !== GITHUB_PAGES_BASE;
}
