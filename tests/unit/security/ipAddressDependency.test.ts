import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type WorkspaceConfig = { overrides?: Record<string, string> };

type Lockfile = {
  packages?: Record<string, unknown>;
  snapshots?: {
    'socks@2.8.7'?: { dependencies?: Record<string, string> };
  };
};

function compareNumericVersionTriples(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

// QNBS-v3: Vitest transforms import.meta.url to a non-file scheme, so fixtures resolve from its project cwd.
const projectRoot = process.cwd();
const packageManifest = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const workspace = parse(
  readFileSync(resolve(projectRoot, 'pnpm-workspace.yaml'), 'utf8'),
) as WorkspaceConfig;
const lockfile = parse(readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'), 'utf8')) as Lockfile;

describe('ip-address security dependency floor', () => {
  it('keeps socks on a patched, bounded 10.x lockfile release', () => {
    expect(workspace.overrides?.['ip-address']).toBe('>=10.7.4 <11');

    const resolvedVersions = Object.keys(lockfile.packages ?? {})
      .filter((key) => key.startsWith('ip-address@'))
      .map((key) => key.slice('ip-address@'.length));
    expect(resolvedVersions).toHaveLength(1);

    const version = resolvedVersions[0] ?? '';
    expect(version).toMatch(/^10\.\d+\.\d+$/);
    expect(compareNumericVersionTriples(version, '10.7.4')).toBeGreaterThanOrEqual(0);
    expect(lockfile.snapshots?.['socks@2.8.7']?.dependencies?.['ip-address']).toBe(version);
  });

  it('keeps the transitive package path in Lighthouse CI developer tooling', () => {
    expect(packageManifest.devDependencies?.['@lhci/cli']).toBeDefined();
    expect(packageManifest.dependencies?.['@lhci/cli']).toBeUndefined();
  });
});
