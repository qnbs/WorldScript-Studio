#!/usr/bin/env node
/** Vercel / Cloudflare Pages production build (root base `/`). */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_ASSET_SCRIPTS } from './runtime-asset-steps.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

process.env.DEPLOY_TARGET = 'edge';

try {
  await import('./sync-deploy-base.mjs');
} catch (err) {
  console.error('[build-edge] sync-deploy-base failed:', err.message);
  process.exit(1);
}

// QNBS-v3: `vite build` skips npm's prebuild hook, so the gitignored runtime assets (self-hosted DuckDB WASM) are produced here.
for (const script of RUNTIME_ASSET_SCRIPTS) {
  const step = spawnSync(process.execPath, [join(scriptsDir, script)], { stdio: 'inherit' });
  if (step.status !== 0) {
    console.error(`[build-edge] ${script} failed`);
    process.exit(step.status ?? 1);
  }
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

process.exit(result.status ?? 1);
