#!/usr/bin/env node
/** Vercel / Cloudflare Pages production build (root base `/`). */
import { spawnSync } from 'node:child_process';

process.env.DEPLOY_TARGET = 'edge';

await import('./sync-deploy-base.mjs');

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

process.exit(result.status ?? 1);
