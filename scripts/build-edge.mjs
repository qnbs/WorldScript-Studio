#!/usr/bin/env node
/** Vercel / Cloudflare Pages production build (root base `/`). */
import { spawnSync } from 'node:child_process';

process.env.DEPLOY_TARGET = 'edge';

try {
  await import('./sync-deploy-base.mjs');
} catch (err) {
  console.error('[build-edge] sync-deploy-base failed:', err.message);
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

process.exit(result.status ?? 1);
