/**
 * Build steps that produce gitignored, self-hosted runtime assets from pinned dependencies. npm runs
 * them through `prebuild`, but `build:edge` (Vercel) calls `vite build` directly and skips that
 * hook — without them production served index.html (SPA rewrite) for /duckdb/*.wasm.
 * Single list for both paths: package.json `prebuild` and scripts/build-edge.mjs.
 */
export const RUNTIME_ASSET_SCRIPTS = ['copy-duckdb-assets.mjs'];
