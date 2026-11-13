#!/usr/bin/env node
/**
 * #1272: a production build must never ship a worker as raw TypeScript. A standalone
 * `new URL('./x.worker.ts', import.meta.url)` makes Vite treat the file as an asset: it is copied verbatim as `.ts`
 * (served as video/mp2t) or, under the inline limit, embedded as a `data:video/mp2t;base64,…` URL. Neither can start.
 *
 * Usage: node scripts/check-worker-bundles.mjs [distDir]   (default: dist)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPESCRIPT_FILE = /\.(?:ts|tsx|mts|cts)$/;
const TEXT_FILE = /\.(?:js|mjs|cjs|html)$/;
const INLINED_TYPESCRIPT = 'data:video/mp2t';

/** Lists every shipped TypeScript asset and every text file that inlines one; empty when the build is clean. */
export function findWorkerBundleProblems(distDir) {
  const problems = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const shown = relative(distDir, path);
      if (TYPESCRIPT_FILE.test(entry.name)) {
        problems.push(`${shown}: TypeScript source shipped as an asset`);
      } else if (
        TEXT_FILE.test(entry.name) &&
        readFileSync(path, 'utf8').includes(INLINED_TYPESCRIPT)
      ) {
        problems.push(`${shown}: TypeScript source inlined as a ${INLINED_TYPESCRIPT} URL`);
      }
    }
  };
  visit(distDir);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const distDir = process.argv[2] ?? 'dist';
  const problems = findWorkerBundleProblems(distDir);
  if (problems.length > 0) {
    console.error(
      `[worker-bundles] FAIL — ${problems.length} raw TypeScript worker artifact(s) in ${distDir}:`,
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "Create workers with new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }) so Vite bundles them.",
    );
    process.exit(1);
  }
  console.log(`[worker-bundles] OK — no raw TypeScript worker artifact in ${distDir}.`);
}
