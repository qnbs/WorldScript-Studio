#!/usr/bin/env node
/**
 * bundle-report.mjs
 * Generates a JSON summary of the production JS bundle sizes under dist/assets.
 * Intended to be run after `pnpm run build` and consumed by CI trends / dashboards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'dist', 'assets');
const outFile = process.argv[2] ?? path.join(__dirname, '..', 'dist', 'bundle-report.json');

if (!fs.existsSync(assetsDir)) {
  console.error('[bundle-report] dist/assets not found — run pnpm run build first.');
  process.exit(1);
}

const files = fs
  .readdirSync(assetsDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => {
    const stat = fs.statSync(path.join(assetsDir, f));
    return {
      name: f,
      bytes: stat.size,
      kb: Number((stat.size / 1024).toFixed(2)),
      isEntry: /^index-/.test(f),
    };
  })
  .sort((a, b) => b.bytes - a.bytes);

const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
const entry = files.find((f) => f.isEntry);
const largest = files[0] ?? null;

const report = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalJsKb: Number((totalBytes / 1024).toFixed(2)),
    chunkCount: files.length,
    largestChunkKb: largest?.kb ?? 0,
    largestChunkName: largest?.name ?? null,
    entryChunkKb: entry?.kb ?? 0,
    entryChunkName: entry?.name ?? null,
  },
  chunks: files,
};

fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[bundle-report] Wrote ${outFile}`);
console.log(
  `[bundle-report] ${report.summary.chunkCount} chunks, ${report.summary.totalJsKb} KB total, entry ${report.summary.entryChunkKb} KB, largest ${report.summary.largestChunkKb} KB`,
);
