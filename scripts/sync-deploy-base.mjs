#!/usr/bin/env node
/**
 * Patches public assets that hardcode /WorldScript-Studio/ for edge (root) deploys.
 * GitHub Pages CI leaves defaults; Vercel/Cloudflare set DEPLOY_TARGET=edge or VITE_BASE=/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployBase } from './resolve-deploy-base.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const GITHUB_PAGES_BASE = '/WorldScript-Studio/';

if (deployBase === GITHUB_PAGES_BASE) {
  console.log('[sync-deploy-base] GitHub Pages base — no public patches');
  process.exit(0);
}

const files = ['public/manifest.json', 'public/offline.html', 'public/404.html'];

for (const rel of files) {
  const file = path.join(root, rel);
  try {
    const text = fs.readFileSync(file, 'utf8');
    const patched = text.split(GITHUB_PAGES_BASE).join(deployBase);
    if (patched === text) {
      console.warn(`[sync-deploy-base] WARNING: ${rel} — pattern not found, skipping`);
      continue;
    }
    fs.writeFileSync(file, patched);
    console.log(`[sync-deploy-base] ${rel} → base ${deployBase}`);
  } catch (err) {
    console.error(`[sync-deploy-base] FATAL: failed to patch ${rel}:`, err.message);
    process.exit(1);
  }
}
