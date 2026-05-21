#!/usr/bin/env node
/**
 * Cloudflare Pages deploy — static `dist/` only (NOT `wrangler deploy` / Workers).
 * Dashboard: leave "Deploy command" empty, OR set: pnpm run deploy:cloudflare
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

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
