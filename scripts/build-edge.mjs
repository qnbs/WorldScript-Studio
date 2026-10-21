#!/usr/bin/env node
/** Vercel / Cloudflare Pages production build (root base `/`). */
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEdgeBuild } from './runtime-asset-steps.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

process.env.DEPLOY_TARGET = 'edge';

try {
  await import('./sync-deploy-base.mjs');
} catch (err) {
  console.error('[build-edge] sync-deploy-base failed:', err.message);
  process.exit(1);
}

// QNBS-v3: `vite build` skips npm's prebuild hook, so the gitignored runtime assets (self-hosted DuckDB WASM) are produced here.
process.exit(runEdgeBuild({ spawn: spawnSync, scriptsDir, env: process.env }));
