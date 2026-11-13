import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EDGE_PREP_SCRIPTS,
  type EdgeBuildSpawn,
  runEdgeBuild,
  WORKER_BUNDLE_GUARD,
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
const guardArgs = () => [resolve(scriptsDir, WORKER_BUNDLE_GUARD), 'dist'];
const isGuard = (args: readonly string[]) => args.join(' ') === guardArgs().join(' ');

/**
 * Edge builds call Vite directly, so their explicit prep sequence must sync the service worker
 * version and produce the gitignored runtime assets normally prepared by lifecycle hooks.
 */
describe('edge build preparation', () => {
  it('lists at least the self-hosted DuckDB assets', () => {
    expect(EDGE_PREP_SCRIPTS).toContain('copy-duckdb-assets.mjs');
  });

  it('runs every preparation step in prebuild, predev and prebuild:pages', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    for (const script of EDGE_PREP_SCRIPTS) {
      expect(pkg.scripts['prebuild']).toContain(`node scripts/${script}`);
      expect(pkg.scripts['predev']).toContain(`node scripts/${script}`);
      // QNBS-v3: build:pages calls vite directly, so its own pre-hook must produce the same assets.
      expect(pkg.scripts['prebuild:pages']).toContain(`node scripts/${script}`);
    }
  });

  // #1272: Vercel and Cloudflare build through build:edge, which never reaches npm's postbuild hook.
  it('runs the same worker-bundle guard as the npm postbuild hook', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['postbuild']).toBe(`node scripts/${WORKER_BUNDLE_GUARD} dist`);
  });

  it('the edge build entry point delegates to runEdgeBuild', () => {
    expect(read('scripts/build-edge.mjs')).toContain(
      'process.exit(runEdgeBuild({ spawn: spawnSync, scriptsDir, env: process.env }))',
    );
  });
});

describe('runEdgeBuild', () => {
  it('runs every preparation step with node, then vite build in production mode, then the worker guard', () => {
    const { spawn, calls } = recordingSpawn();
    const code = runEdgeBuild({ spawn, scriptsDir, env: { DEPLOY_TARGET: 'edge' }, log: vi.fn() });

    expect(code).toBe(0);
    expect(calls.map((call) => call.args.join(' '))).toEqual([
      ...EDGE_PREP_SCRIPTS.map((script) => resolve(scriptsDir, script)),
      'exec vite build',
      guardArgs().join(' '),
    ]);
    for (const step of calls.filter((call) => !isVite(call.args))) {
      expect(step.command).toBe(process.execPath);
    }
    expect(calls.find((call) => isVite(call.args))).toMatchObject({
      command: 'pnpm',
      env: { DEPLOY_TARGET: 'edge', NODE_ENV: 'production' },
    });
  });

  it('a worker shipped as raw TypeScript fails the edge build', () => {
    const { spawn } = recordingSpawn((args) => (isGuard(args) ? 1 : 0));
    const log = vi.fn();

    expect(runEdgeBuild({ spawn, scriptsDir, env: {}, log })).toBe(1);
    expect(log).toHaveBeenCalledWith(`[build-edge] ${WORKER_BUNDLE_GUARD} failed`);
  });

  it('a failed vite build skips the worker guard', () => {
    const { spawn, calls } = recordingSpawn((args) => (isVite(args) ? 2 : 0));

    expect(runEdgeBuild({ spawn, scriptsDir, env: {}, log: vi.fn() })).toBe(2);
    expect(calls.some((call) => isGuard(call.args))).toBe(false);
  });

  it('a failed preparation step stops before vite and returns its status', () => {
    const { spawn, calls } = recordingSpawn((args) => (isVite(args) ? 0 : 3));
    const log = vi.fn();

    expect(runEdgeBuild({ spawn, scriptsDir, env: {}, log })).toBe(3);
    expect(calls.some((call) => isVite(call.args))).toBe(false);
    expect(log).toHaveBeenCalledWith(`[build-edge] ${EDGE_PREP_SCRIPTS[0]} failed`);
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
