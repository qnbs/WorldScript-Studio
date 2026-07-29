#!/usr/bin/env node
/**
 * Self-hosts the DuckDB-WASM runtime assets (F-09): copies the mvp/eh WASM binaries and their
 * worker scripts from the pinned `@duckdb/duckdb-wasm` npm dependency into `public/duckdb/`, so
 * `workers/duckdbWorker.ts` / `workers/v2/duckdb.worker.ts` fetch them same-origin instead of an
 * unpinned `cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/...` URL (floating "latest", decoupled
 * from the locked `@duckdb/duckdb-wasm@^1.32.0` version, and already blocked by `worker-src 'self'
 * blob:'` CSP with no jsdelivr allowance — this was already-dead code, not just a supply-chain risk).
 * Run via predev/prebuild — idempotent, only copies when missing or the source content changed.
 * `public/duckdb/` is gitignored: these are build artifacts of the pinned dependency, not source.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// QNBS-v3 (CodeRabbit): equal byte length doesn't prove equal content — a dependency bump that
// happens to keep the same asset size would leave a stale WASM/worker file in public/duckdb/ with
// this check alone, so content is hashed once sizes already match.
function fileHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const destDir = join(root, 'public', 'duckdb');

const ASSETS = [
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
];

if (!existsSync(srcDir)) {
  process.stderr.write(
    `[copy-duckdb-assets] SKIP — ${srcDir} not found (dependency not installed yet)\n`,
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

let copied = 0;
for (const name of ASSETS) {
  const src = join(srcDir, name);
  const dest = join(destDir, name);
  if (!existsSync(src)) {
    process.stderr.write(`[copy-duckdb-assets] ERROR — missing source asset: ${src}\n`);
    process.exitCode = 1;
    continue;
  }
  const alreadyCurrent =
    existsSync(dest) &&
    statSync(dest).size === statSync(src).size &&
    fileHash(dest) === fileHash(src);
  if (!alreadyCurrent) {
    copyFileSync(src, dest);
    copied += 1;
  }
}

process.stdout.write(
  `[copy-duckdb-assets] ${copied} of ${ASSETS.length} asset(s) (re)copied to public/duckdb/\n`,
);
