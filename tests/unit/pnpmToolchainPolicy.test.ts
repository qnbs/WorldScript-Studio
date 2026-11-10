// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkDockerfilePnpm,
  findDockerfilePnpmPins,
  isVersionAtLeast,
} from '../../scripts/pnpm-version-policy.mjs';

// QNBS-v3: Compare semantic version components left-to-right so a lower major cannot pass on a higher minor.
describe('pnpm version policy', () => {
  it.each([
    ['11.11.0', '11.11.0', true],
    ['11.12.0', '11.11.0', true],
    ['12.0.0', '11.11.0', true],
    ['11.10.9', '11.11.0', false],
    ['10.99.0', '11.0.0', false],
    ['11.22.0', '11.11.0', true],
  ])('%s >= %s is %s', (version, minimum, expected) => {
    expect(isVersionAtLeast(version, minimum)).toBe(expected);
  });

  it('rejects malformed versions instead of treating them as secure', () => {
    expect(isVersionAtLeast('11.22', '11.11.0')).toBe(false);
    expect(isVersionAtLeast('11.22.0-beta.1', '11.11.0')).toBe(false);
  });
});

describe('Dockerfile pnpm pin (#1223)', () => {
  const packageManager = JSON.parse(readFileSync('package.json', 'utf8')).packageManager as string;
  const expected = packageManager.replace(/^pnpm@/, '');

  it('keeps the repository Dockerfile on the packageManager pin', () => {
    expect(checkDockerfilePnpm(readFileSync('Dockerfile', 'utf8'), expected)).toEqual({
      ok: true,
      mismatched: [],
    });
  });

  it('reproduces the v1.29.2-era drift (corepack prepare pnpm@11.5.2 under a pnpm 12 pin)', () => {
    const drifted = 'RUN corepack enable && corepack prepare pnpm@11.5.2 --activate\n';
    expect(checkDockerfilePnpm(drifted, '12.13.0')).toEqual({ ok: false, mismatched: ['11.5.2'] });
  });

  it('accepts an explicit pin only when it equals the project pin', () => {
    expect(checkDockerfilePnpm('RUN corepack prepare pnpm@12.13.0 --activate', '12.13.0').ok).toBe(
      true,
    );
    expect(checkDockerfilePnpm('RUN npm i -g "pnpm@12.12.0"', '12.13.0').mismatched).toEqual([
      '12.12.0',
    ]);
  });

  it('ignores comments and finds every pin on a line', () => {
    const text = '# was pnpm@9.0.0\nRUN a pnpm@1.0.0 && b pnpm@2.0.0';
    expect(findDockerfilePnpmPins(text)).toEqual(['1.0.0', '2.0.0']);
  });
});
