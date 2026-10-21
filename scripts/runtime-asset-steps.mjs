import { join } from 'node:path';

/**
 * Build steps that produce gitignored, self-hosted runtime assets from pinned dependencies. npm runs
 * them through `prebuild`, but `build:edge` (Vercel) calls `vite build` directly and skips that
 * hook — without them production served index.html (SPA rewrite) for /duckdb/*.wasm.
 * Single list for both paths: package.json `prebuild` and scripts/build-edge.mjs.
 */
export const RUNTIME_ASSET_SCRIPTS = ['copy-duckdb-assets.mjs'];

/**
 * The edge build: every runtime asset step, then `vite build`. A failed step (nonzero status or a
 * signal) stops before vite and returns a nonzero exit code. `spawn` is node:child_process
 * `spawnSync`, injected so tests can run the sequence without building.
 */
export function runEdgeBuild({ spawn, scriptsDir, env, log = console.error }) {
  for (const script of RUNTIME_ASSET_SCRIPTS) {
    const step = spawn(process.execPath, [join(scriptsDir, script)], { stdio: 'inherit' });
    if (step.status !== 0) {
      log(`[build-edge] ${script} failed`);
      return step.status ?? 1;
    }
  }
  const vite = spawn('pnpm', ['exec', 'vite', 'build'], {
    stdio: 'inherit',
    env: { ...env, NODE_ENV: 'production' },
  });
  return vite.status ?? 1;
}
