#!/usr/bin/env node
/**
 * Resolves Vite `base` for static hosting targets.
 * - GitHub Pages (default): /StoryCraft-Studio/
 * - Vercel / Cloudflare Pages (root domain): set VITE_BASE=/ or DEPLOY_TARGET=edge
 */
function resolveDeployBase() {
  const viteBase = process.env.VITE_BASE?.trim();
  if (viteBase) {
    return viteBase.endsWith('/') ? viteBase : `${viteBase}/`;
  }
  if (process.env.DEPLOY_TARGET === 'edge') {
    return '/';
  }
  return '/StoryCraft-Studio/';
}

export const deployBase = resolveDeployBase();

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(deployBase);
}
