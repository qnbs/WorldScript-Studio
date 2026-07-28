// QNBS-v3: Single source for Vite `base`. Extracted from vite.config.ts so the Tauri-detection
// regression is permanently unit-tested: a desktop build that fell through to the GitHub Pages base
// ('/WorldScript-Studio/') 404'd every hashed asset under tauri://localhost/ → blank webview (only the
// native file/help menu rendered). Root cause was checking the Tauri 1.x env var name.

export const GITHUB_PAGES_BASE = '/WorldScript-Studio/';

/**
 * True when the active `vite build` is the one Tauri's `beforeBuildCommand` hook invokes to
 * produce the desktop bundle, as opposed to the web/PWA build.
 *
 * QNBS-v3: Tauri 2.x sets TAURI_ENV_PLATFORM for hook commands; the legacy Tauri 1.x name was
 * TAURI_PLATFORM. Accept both so a CLI downgrade/upgrade can't silently reintroduce a
 * platform-detection regression. Single source of truth — reused by both the `base` resolution
 * below and `vite.config.ts`'s `rollupOptions.external` (a desktop build that externalized
 * `@tauri-apps/*` left an unresolvable bare module specifier in the shipped bundle; see
 * docs/adr/0012-local-server-connectivity-tauri-http.md).
 */
export function isTauriBuild(env: Record<string, string | undefined> = process.env): boolean {
  return env['TAURI_ENV_PLATFORM'] !== undefined || env['TAURI_PLATFORM'] !== undefined;
}

/**
 * Resolve the Vite `base` for the active build target.
 * - Tauri desktop  → './'  (relative; assets must load from tauri://localhost/ root)
 * - explicit VITE_BASE → normalised with a trailing slash
 * - edge (Vercel/Cloudflare root domain) → '/'
 * - default (GitHub Pages project page) → '/WorldScript-Studio/'
 */
export function resolveViteBase(env: Record<string, string | undefined> = process.env): string {
  if (isTauriBuild(env)) {
    return './';
  }
  const viteBase = env['VITE_BASE']?.trim();
  if (viteBase) {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  if (env['DEPLOY_TARGET'] === 'edge') {
    return '/';
  }
  return GITHUB_PAGES_BASE;
}
