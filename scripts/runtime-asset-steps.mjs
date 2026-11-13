import { join } from 'node:path';

/**
 * Build preparation shared by npm hooks and direct edge builds. `build:edge` calls Vite directly
 * and skips `prebuild`, so it must synchronize the service-worker cache version as well as create
 * the gitignored runtime assets before Vite copies public files.
 * Single list for package.json build hooks and scripts/build-edge.mjs.
 */
export const EDGE_PREP_SCRIPTS = [
  'sync-sw-version.mjs',
  'copy-duckdb-assets.mjs',
  'copy-third-party-licenses.mjs',
];

/** Runs after every production build (npm `postbuild`, and the edge build below): no worker may ship as raw TypeScript. */
export const WORKER_BUNDLE_GUARD = 'check-worker-bundles.mjs';

/**
 * The edge build: every preparation step, then `vite build`, then the worker-bundle guard on `dist`.
 * A failed step (nonzero status or a signal) stops the sequence and returns a nonzero exit code.
 * `spawn` is node:child_process `spawnSync`, injected so tests can run the sequence without building.
 */
export function runEdgeBuild({ spawn, scriptsDir, env, log = console.error }) {
  for (const script of EDGE_PREP_SCRIPTS) {
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
  if (vite.status !== 0) return vite.status ?? 1;
  // QNBS-v3 (#1272): calling vite directly skips npm's postbuild, so the edge artifact gets the same worker-bundle guard here.
  const guard = spawn(process.execPath, [join(scriptsDir, WORKER_BUNDLE_GUARD), 'dist'], {
    stdio: 'inherit',
  });
  if (guard.status !== 0) log(`[build-edge] ${WORKER_BUNDLE_GUARD} failed`);
  return guard.status ?? 1;
}
