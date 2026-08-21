#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP_CONNECT_SRC_DIRECTIVE } from './csp-policy.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const surfaces = [
  'index.html',
  'nginx.conf',
  'public/_headers',
  'vercel.json',
  'src-tauri/tauri.conf.json',
];

for (const relativePath of surfaces) {
  const path = join(root, relativePath);
  const before = readFileSync(path, 'utf8');
  const after = before
    .replace(/connect-src\s+[^;]+;/g, CSP_CONNECT_SRC_DIRECTIVE)
    .replace(/;\s*upgrade-insecure-requests;?/g, ';')
    .replace(/upgrade-insecure-requests;\s*/g, '')
    .replace(/frame-ancestors 'none'(?!;)/g, "frame-ancestors 'none';");
  if (!after.includes(CSP_CONNECT_SRC_DIRECTIVE)) {
    throw new Error(`${relativePath}: no connect-src directive was replaced`);
  }
  if (after !== before) writeFileSync(path, after);
}

console.log(`[csp] synchronized ${surfaces.length} deployment surfaces`);
