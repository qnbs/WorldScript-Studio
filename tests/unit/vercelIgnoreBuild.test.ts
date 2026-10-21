import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedSince, decideBuild } from '../../scripts/vercel-ignore-build.mjs';

const root = resolve(__dirname, '../..');
const script = resolve(root, 'scripts/vercel-ignore-build.mjs');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: 'abc1234' };

/** Runs the real ignore step the way Vercel does: exit 1 builds, exit 0 skips. */
function run(env: Record<string, string>) {
  const {
    VERCEL_ENV: _e,
    VERCEL_GIT_PREVIOUS_SHA: _p,
    VERCEL_GIT_COMMIT_MESSAGE: _m,
    ...rest
  } = process.env;
  return spawnSync(process.execPath, [script], { cwd: root, env: { ...rest, ...env } }).status;
}

describe('Vercel ignored build step (previews on demand)', () => {
  it('is wired as the ignoreCommand', () => {
    const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
      ignoreCommand?: string;
    };
    expect(config.ignoreCommand).toBe('node scripts/vercel-ignore-build.mjs');
  });

  it('always builds production and anything that is not a preview', () => {
    expect(decideBuild({ env: { VERCEL_ENV: 'production' }, changedFiles: [] }).build).toBe(true);
    expect(decideBuild({ env: {}, changedFiles: [] }).build).toBe(true);
  });

  it('builds a preview on request, on the first deployment and when the diff is unknown', () => {
    const marker = { ...preview, VERCEL_GIT_COMMIT_MESSAGE: 'fix: thing [Preview]' };
    expect(decideBuild({ env: marker, changedFiles: ['README.md'] })).toEqual({
      build: true,
      reason: 'preview-requested',
    });
    expect(decideBuild({ env: { VERCEL_ENV: 'preview' }, changedFiles: null }).reason).toBe(
      'first-deployment',
    );
    expect(decideBuild({ env: preview, changedFiles: null }).reason).toBe('diff-unavailable');
  });

  it('builds a preview when a deployment input changed', () => {
    for (const file of [
      'vercel.json',
      'vite.config.ts',
      'package.json',
      'pnpm-lock.yaml',
      'scripts/build-edge.mjs',
      'scripts/runtime-asset-steps.mjs',
      'scripts/copy-duckdb-assets.mjs',
      'api/claude-proxy.ts',
      '.nvmrc',
      'packages/ui/package.json',
      'patches/some-dep@1.0.0.patch',
    ]) {
      expect(decideBuild({ env: preview, changedFiles: ['README.md', file] })).toEqual({
        build: true,
        reason: `build-file-changed:${file}`,
      });
    }
  });

  it('skips a preview when only app, test, docs or CI files changed', () => {
    const changedFiles = [
      'components/settings/DataSection.tsx',
      'locales/de/help.json',
      'tests/unit/x.test.ts',
      'CHANGELOG.md',
      '.github/workflows/ci.yml',
      'scripts/check-pr-size.mjs',
      'packages/ui/src/tokens.ts',
    ];
    expect(decideBuild({ env: preview, changedFiles })).toEqual({
      build: false,
      reason: 'no-build-file-changed',
    });
  });

  it('reads no diff for a value that is not a commit SHA', () => {
    expect(changedSince('--output=/tmp/x')).toBeNull();
    expect(changedSince(undefined)).toBeNull();
    expect(changedSince(head)).toEqual([]);
  });

  it('the script exits 1 (build) or 0 (skip) as Vercel expects', () => {
    expect(run({ VERCEL_ENV: 'production' })).toBe(1);
    expect(run({ VERCEL_ENV: 'preview' })).toBe(1);
    expect(run({ VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: 'not-a-sha' })).toBe(1);
    expect(run({ VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: head })).toBe(0);
    expect(
      run({
        VERCEL_ENV: 'preview',
        VERCEL_GIT_PREVIOUS_SHA: head,
        VERCEL_GIT_COMMIT_MESSAGE: 'docs: x [preview]',
      }),
    ).toBe(1);
  });
});
