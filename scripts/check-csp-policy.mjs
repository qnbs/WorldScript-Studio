#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP_CONNECT_SRC, CSP_CONNECT_SRC_DIRECTIVE } from './csp-policy.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const surfaces = [
  'index.html',
  'nginx.conf',
  'public/_headers',
  'vercel.json',
  'src-tauri/tauri.conf.json',
];
const expected = new Set(CSP_CONNECT_SRC);
const failures = [];

function tokens(source, relativePath) {
  const matches = [...source.matchAll(/connect-src\s+([^;]+);/g)];
  if (matches.length === 0) failures.push(`${relativePath}: missing connect-src directive`);
  return matches.map((match) => (match[1] ?? '').trim().split(/\s+/).filter(Boolean));
}

for (const relativePath of surfaces) {
  const source = readFileSync(join(root, relativePath), 'utf8');
  const directives = tokens(source, relativePath);
  for (const actual of directives) {
    const actualSet = new Set(actual);
    if (actualSet.size !== expected.size || actual.some((token) => !expected.has(token))) {
      failures.push(`${relativePath}: connect-src differs from config/csp-connect-src.json`);
    }
    for (const wildcard of ['https:', 'http:', 'ws:']) {
      if (actualSet.has(wildcard)) failures.push(`${relativePath}: forbidden ${wildcard} wildcard`);
    }
  }
  if (/(?:^|;)\s*upgrade-insecure-requests/.test(source)) {
    failures.push(
      `${relativePath}: upgrade-insecure-requests conflicts with the explicit HTTP-loopback exception policy`,
    );
  }
}

if (failures.length > 0) {
  console.error(`[csp] FAIL\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log(`[csp] OK — ${surfaces.length} surfaces use ${CSP_CONNECT_SRC_DIRECTIVE}`);
