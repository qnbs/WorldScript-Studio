import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/**
 * Production (Vercel) builds via scripts/build-edge.mjs, which calls `vite build` directly and so
 * skips npm's prebuild hook. Both paths must produce the gitignored runtime assets, or production
 * serves index.html for /duckdb/*.wasm.
 */
describe('runtime asset steps', () => {
  const list =
    /RUNTIME_ASSET_SCRIPTS = \[([^\]]*)\]/.exec(read('scripts/runtime-asset-steps.mjs'))?.[1] ?? '';
  const scripts = [...list.matchAll(/'([^']+)'/g)].map(([, name = '']) => name);

  it('lists at least the self-hosted DuckDB assets', () => {
    expect(scripts).toContain('copy-duckdb-assets.mjs');
  });

  it('runs every step in prebuild and predev', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of scripts) {
      expect(pkg.scripts['prebuild']).toContain(`node scripts/${script}`);
      expect(pkg.scripts['predev']).toContain(`node scripts/${script}`);
    }
  });

  it('runs every step in the edge build before vite build', () => {
    const edge = read('scripts/build-edge.mjs');
    expect(edge).toContain("from './runtime-asset-steps.mjs'");
    const loop = edge.indexOf('for (const script of RUNTIME_ASSET_SCRIPTS)');
    expect(loop).toBeGreaterThan(-1);
    expect(loop).toBeLessThan(edge.indexOf("'vite', 'build'"));
  });
});
