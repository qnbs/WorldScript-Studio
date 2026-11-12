// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  NODE_SECURITY_FLOORS,
  nodeBelowSecurityFloor,
} from '../../../scripts/node-security-floor.mjs';

describe('Node security floors (#1245)', () => {
  it('name the 2026-11-11 security releases of the supported lines', () => {
    expect(NODE_SECURITY_FLOORS).toEqual({ 22: '22.23.5', 24: '24.22.3', 26: '26.13.1' });
  });

  it.each([
    ['22.23.4', '22.23.5'],
    ['22.22.3', '22.23.5'],
    ['24.22.2', '24.22.3'],
    ['26.12.1', '26.13.1'],
  ])('reports %s as below its floor', (version, floor) => {
    expect(nodeBelowSecurityFloor(version)).toBe(floor);
  });

  it.each(['22.23.5', '22.24.0', '24.22.3', '26.13.1', '25.9.0', '27.0.0'])(
    'accepts %s, at or above its floor or on a line without one',
    (version) => {
      expect(nodeBelowSecurityFloor(version)).toBeNull();
    },
  );

  // Every case sets the ref and event itself, so a run of this test on a real tag build cannot leak into it.
  const runToolchainCheck = (version: string, ref: string, eventName = 'push') => {
    const preload = `data:text/javascript,Object.defineProperty(process.versions,'node',{value:'${version}'})`;
    return spawnSync(process.execPath, ['--import', preload, 'scripts/check-pnpm-toolchain.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_REF: ref,
        GITHUB_REF_TYPE: ref.startsWith('refs/tags/') ? 'tag' : 'branch',
        GITHUB_EVENT_NAME: eventName,
        npm_config_user_agent: 'pnpm/12.13.0',
      },
    });
  };

  it('only warns for a manual dispatch on a tag ref, which builds no release artifacts', () => {
    const result = runToolchainCheck('22.23.4', 'refs/tags/v1.29.6', 'workflow_dispatch');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('::warning::Node 22.23.4');
  });

  it('stops a release tag build below the floor and lets one at the floor through', () => {
    const below = runToolchainCheck('22.23.4', 'refs/tags/v1.29.6');
    expect(below.status).toBe(1);
    expect(below.stderr).toContain('::error::Node 22.23.4 is below the 22.23.5 security release');
    const atFloor = runToolchainCheck('22.23.5', 'refs/tags/v1.29.6');
    expect(atFloor.status, atFloor.stderr).toBe(0);
    expect(atFloor.stderr).not.toContain('security release');
  });

  it('only warns for a push of a non-release tag, which builds no release artifacts', () => {
    const result = runToolchainCheck('22.23.4', 'refs/tags/nightly-2026-11-12');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('::warning::Node 22.23.4');
  });

  it('makes the toolchain check warn on CI, without failing, when Node is below its floor', () => {
    const result = runToolchainCheck('22.23.4', 'refs/heads/main');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      '::warning::Node 22.23.4 is below the 22.23.5 security release',
    );
  });
});
