// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkDockerfilePnpm,
  findDockerfilePnpmBypasses,
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
  const assertion =
    'RUN test "$(pnpm --version)" = "$(node -p "require(\'./package.json\').packageManager.split(\'@\')[1].split(\'+\')[0]")" && pnpm install --frozen-lockfile';

  it('keeps the repository Dockerfile on packageManager via corepack install and the version assertion', () => {
    expect(checkDockerfilePnpm(readFileSync('Dockerfile', 'utf8'), expected)).toEqual({
      ok: true,
      mismatched: [],
      bypasses: [],
      corepackInstall: true,
      versionAssertion: true,
    });
  });

  it('reproduces the v1.29.2-era drift (corepack prepare pnpm@11.5.2 under a pnpm 12 pin)', () => {
    const drifted = 'RUN corepack enable && corepack prepare pnpm@11.5.2 --activate';
    expect(checkDockerfilePnpm(`${drifted}\n`, '12.13.0')).toEqual({
      ok: false,
      mismatched: ['11.5.2'],
      bypasses: [drifted],
      corepackInstall: false,
      versionAssertion: false,
    });
  });

  // #1225 review: an unversioned installer has no pin to compare, so every installer outside packageManager is rejected.
  it.each([
    ['a Corepack prepare with the project pin', 'RUN corepack prepare pnpm@12.13.0 --activate'],
    ['an unversioned global npm install', 'RUN npm install -g pnpm'],
    ['a pinned global npm install', 'RUN npm i -g "pnpm@12.13.0"'],
    ['a global yarn install', 'RUN yarn global add pnpm'],
    ['an npm exec of pnpm', 'RUN npm exec --yes --package=pnpm -- pnpm install'],
    ['an npx run of pnpm', 'RUN npx --yes pnpm install'],
    ['the standalone installer', 'RUN wget -qO- https://get.pnpm.io/install.sh | sh -'],
  ])('rejects %s even next to corepack install and the assertion', (_name, line) => {
    const result = checkDockerfilePnpm(`RUN corepack install\n${line}\n${assertion}\n`, '12.13.0');

    expect(result.ok).toBe(false);
    expect(result.bypasses).toEqual([line]);
  });

  // #1225 review: parse instructions like Docker (case-insensitive keyword, continuations joined, command position).
  it('accepts a lowercase run keyword for corepack install', () => {
    expect(
      checkDockerfilePnpm('run corepack enable && corepack install\n', '12.13.0').corepackInstall,
    ).toBe(true);
  });

  it('does not count corepack install that is only echoed', () => {
    expect(checkDockerfilePnpm('RUN echo corepack install\n', '12.13.0').corepackInstall).toBe(
      false,
    );
  });

  it('does not count corepack install inside a shell comment', () => {
    expect(
      checkDockerfilePnpm('RUN echo ok # && corepack install\n', '12.13.0').corepackInstall,
    ).toBe(false);
  });

  it('rejects an installer that is split across a backslash continuation', () => {
    const result = checkDockerfilePnpm(
      `RUN corepack install\nRUN npm install -g \\\n    pnpm\n${assertion}\n`,
      '12.13.0',
    );

    expect(result.ok).toBe(false);
    expect(result.bypasses).toHaveLength(1);
  });

  it('requires the in-build pnpm version assertion before the install', () => {
    const result = checkDockerfilePnpm(
      'RUN corepack install\nRUN pnpm install --frozen-lockfile\n',
      '12.13.0',
    );

    expect(result).toEqual({
      ok: false,
      mismatched: [],
      bypasses: [],
      corepackInstall: true,
      versionAssertion: false,
    });
  });

  // #1225 review: every install must be the asserted one, not just one of them.
  it('rejects a bare pnpm install next to the asserted install', () => {
    const result = checkDockerfilePnpm(
      `RUN corepack install\nRUN pnpm install\n${assertion}\n`,
      '12.13.0',
    );

    expect(result.ok).toBe(false);
    expect(result.versionAssertion).toBe(false);
  });

  it('requires a corepack install step', () => {
    expect(checkDockerfilePnpm(`RUN corepack enable\n${assertion}\n`, '12.13.0')).toEqual({
      ok: false,
      mismatched: [],
      bypasses: [],
      corepackInstall: false,
      versionAssertion: true,
    });
  });

  it('ignores comments and finds every pin on a line', () => {
    const text = '# was pnpm@9.0.0\n# RUN npm install -g pnpm\nRUN a pnpm@1.0.0 && b pnpm@2.0.0';
    expect(findDockerfilePnpmPins(text)).toEqual(['1.0.0', '2.0.0']);
    expect(findDockerfilePnpmBypasses('# RUN npm install -g pnpm\nRUN pnpm install')).toEqual([]);
  });
});
