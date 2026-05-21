#!/usr/bin/env node
/**
 * Cloudflare Pages — deploy helper.
 *
 * On Cloudflare's Git-connected Pages builder (CF_PAGES=1), `dist/` is published
 * automatically after the build. Wrangler must NOT run again (token/permission errors).
 *
 * Dashboard:
 *   Build command:     pnpm install && pnpm run build:edge
 *   Build output dir:  dist
 *   Deploy command:    (empty) OR pnpm run deploy:cloudflare  ← no-op on CF Pages CI
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

// QNBS-v3: Native Cloudflare Pages pipeline already uploads `dist` — skip wrangler entirely.
if (process.env.CF_PAGES === '1' || process.env.CF_PAGES_SKIP_WRANGLER === '1') {
  console.log(
    '[cf-pages-deploy] Skipping wrangler — Cloudflare Pages publishes build output automatically.',
  );
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.warn('[cf-pages-deploy] Warning: dist/index.html not found; check build:edge step.');
  }
  process.exit(0);
}

// Manual / GitHub Actions only (set CLOUDFLARE_MANUAL_DEPLOY=1).
if (process.env.CLOUDFLARE_MANUAL_DEPLOY !== '1') {
  console.log(
    '[cf-pages-deploy] No-op (set CLOUDFLARE_MANUAL_DEPLOY=1 for local wrangler pages deploy).',
  );
  process.exit(0);
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[cf-pages-deploy] dist/index.html missing — run pnpm run build:edge first');
  process.exit(1);
}

const project = process.env.CLOUDFLARE_PAGES_PROJECT ?? 'storycraft-studio';
const args = [
  'pages',
  'deploy',
  'dist',
  '--project-name',
  project,
  '--branch',
  process.env.CF_PAGES_BRANCH ?? 'main',
  '--commit-dirty=true',
];

const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
