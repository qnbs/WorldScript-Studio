import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type EdgeBuildSpawn,
  RUNTIME_ASSET_SCRIPTS,
  runEdgeBuild,
} from '../../scripts/runtime-asset-steps.mjs';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const scriptsDir = resolve(root, 'scripts');

/** A spawnSync stand-in that records each command and answers with the status `statusFor` picks. */
function recordingSpawn(statusFor: (args: readonly string[]) => number | null = () => 0) {
  const calls: {
    command: string;
    args: readonly string[];
    env: Record<string, string | undefined> | undefined;
  }[] = [];
  const spawn: EdgeBuildSpawn = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return { status: statusFor(args) };
  };
  return { spawn, calls };
}

const isVite = (args: readonly string[]) => args.join(' ') === 'exec vite build';

/**
 * Production (Vercel) builds via scripts/build-edge.mjs, which calls `vite build` directly and so
 * skips npm's prebuild hook. Both paths must produce the gitignored runtime assets, or production
 * serves index.html for /duckdb/*.wasm.
 */
describe('runtime asset steps', () => {
  it('lists at least the self-hosted DuckDB assets', () => {
    expect(RUNTIME_ASSET_SCRIPTS).toContain('copy-duckdb-assets.mjs');
  });

  it('runs every step in prebuild and predev', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of RUNTIME_ASSET_SCRIPTS) {
      expect(pkg.scripts['prebuild']).toContain(`node scripts/${script}`);
      expect(pkg.scripts['predev']).toContain(`node scripts/${script}`);
    }
  });

  it('the edge build entry point delegates to runEdgeBuild', () => {
    expect(read('scripts/build-edge.mjs')).toContain(
      'process.exit(runEdgeBuild({ spawn: spawnSync, scriptsDir, env: process.env }))',
    );
  });
});

describe('runEdgeBuild', () => {
  it('runs every asset step with node, then vite build in production mode', () => {
    const { spawn, calls } = recordingSpawn();
    const code = runEdgeBuild({ spawn, scriptsDir, env: { DEPLOY_TARGET: 'edge' }, log: vi.fn() });

    expect(code).toBe(0);
    expect(calls.map((call) => call.args.join(' '))).toEqual([
      ...RUNTIME_ASSET_SCRIPTS.map((script) => resolve(scriptsDir, script)),
      'exec vite build',
    ]);
    for (const step of calls.slice(0, -1)) expect(step.command).toBe(process.execPath);
    expect(calls.at(-1)).toMatchObject({
      command: 'pnpm',
      env: { DEPLOY_TARGET: 'edge', NODE_ENV: 'production' },
    });
  });

  it('a failed asset step stops before vite and returns its status', () => {
    const { spawn, calls } = recordingSpawn((args) => (isVite(args) ? 0 : 3));
    const log = vi.fn();

    expect(runEdgeBuild({ spawn, scriptsDir, env: {}, log })).toBe(3);
    expect(calls.some((call) => isVite(call.args))).toBe(false);
    expect(log).toHaveBeenCalledWith(`[build-edge] ${RUNTIME_ASSET_SCRIPTS[0]} failed`);
  });

  it('an asset step killed by a signal (status null) also stops before vite', () => {
    const { spawn, calls } = recordingSpawn((args) => (isVite(args) ? 0 : null));

    expect(runEdgeBuild({ spawn, scriptsDir, env: {}, log: vi.fn() })).toBe(1);
    expect(calls.some((call) => isVite(call.args))).toBe(false);
  });

  it('returns the vite exit code, and 1 when vite was killed by a signal', () => {
    const failing = recordingSpawn((args) => (isVite(args) ? 2 : 0));
    expect(runEdgeBuild({ spawn: failing.spawn, scriptsDir, env: {}, log: vi.fn() })).toBe(2);

    const killed = recordingSpawn((args) => (isVite(args) ? null : 0));
    expect(runEdgeBuild({ spawn: killed.spawn, scriptsDir, env: {}, log: vi.fn() })).toBe(1);
  });
});
