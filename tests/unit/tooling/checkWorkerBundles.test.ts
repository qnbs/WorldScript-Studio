// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkerBundleProblems } from '../../../scripts/check-worker-bundles.mjs';

// #1272: the deployed build shipped every WorkerBus worker as raw TypeScript (.ts assets and data:video/mp2t URLs).
const roots: string[] = [];

function dist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'worker-bundles-'));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('worker bundle guard (#1272)', () => {
  it('accepts a build whose workers are bundled JavaScript', () => {
    const root = dist({
      'index.html': '<script type="module" src="/assets/index.js"></script>',
      'assets/index.js':
        'new Worker(new URL("/assets/worker-duckdb.worker-abc.js", import.meta.url))',
      'assets/worker-duckdb.worker-abc.js': 'self.onmessage = () => {};',
    });
    expect(findWorkerBundleProblems(root)).toEqual([]);
  });

  it('rejects a worker shipped as a TypeScript asset', () => {
    const root = dist({ 'assets/duckdb.worker-DjDfAIwc.ts': '/// <reference lib="webworker" />' });
    expect(findWorkerBundleProblems(root)).toEqual([
      expect.stringContaining('duckdb.worker-DjDfAIwc.ts: TypeScript source shipped as an asset'),
    ]);
  });

  it('rejects a worker inlined as a data:video/mp2t URL', () => {
    const root = dist({
      'assets/workerBusManager-9rr91Q7J.js':
        'const u = "data:video/mp2t;base64,Ly8vIDxyZWZlcmVuY2U+";',
    });
    expect(findWorkerBundleProblems(root)).toEqual([
      expect.stringContaining('workerBusManager-9rr91Q7J.js: TypeScript source inlined'),
    ]);
  });

  // postbuild runs after every `pnpm run build`: the CI build job, the Docker build and Tauri's beforeBuildCommand.
  it('runs after every production build', () => {
    const scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts['build']).toBe('vite build');
    expect(scripts['postbuild']).toBe('node scripts/check-worker-bundles.mjs dist');
  });
});

// The factory shape is what makes Vite bundle a worker; a standalone new URL(...) of a .ts file ships it raw.
describe('WorkerBus pool registrations (#1272)', () => {
  const manager = readFileSync('services/workerBusManager.ts', 'utf8');

  it.each(['duckdb', 'inference', 'webllm', 'plugin'])(
    'creates the %s worker with the literal Vite pattern',
    (name) => {
      const pattern = new RegExp(
        String.raw`new Worker\(new URL\('\.\./workers/(?:v2/)?${name}\.worker\.ts', import\.meta\.url\), \{ type: 'module' \}\)`,
      );
      expect(manager).toMatch(pattern);
    },
  );

  it('never builds a worker URL outside new Worker(...)', () => {
    const standalone = manager.match(/(?<!new Worker\()new URL\('[^']*\.worker\.ts'/g) ?? [];
    expect(standalone).toEqual([]);
  });
});
