import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type PackageManifest = {
  dependencies?: Record<string, string>;
};

type WorkspaceConfig = {
  overrides?: Record<string, string>;
  patchedDependencies?: Record<string, string>;
};

type Lockfile = {
  packages?: Record<string, unknown>;
  snapshots?: Record<string, { dependencies?: Record<string, string> }>;
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

function resolvedVersions(packageName: string): string[] {
  return Object.keys(lockfile.packages ?? {})
    .filter((key) => key.startsWith(`${packageName}@`))
    .map((key) => key.slice(packageName.length + 1));
}

function referencesResolvedVersion(reference: string, versions: string[]): boolean {
  return versions.some((version) => reference === version || reference.startsWith(`${version}(`));
}

const projectRoot = process.cwd();
const packageManifest = JSON.parse(
  readFileSync(resolve(projectRoot, 'package.json'), 'utf8'),
) as PackageManifest;
const workspace = parse(
  readFileSync(resolve(projectRoot, 'pnpm-workspace.yaml'), 'utf8'),
) as WorkspaceConfig;
const lockfile = parse(readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'), 'utf8')) as Lockfile;

const fixedFloors = [
  { name: 'undici', minimumVersion: '7.30.1', major: '7', override: '>=7.30.1 <8' },
  { name: 'body-parser', minimumVersion: '1.20.9', major: '1', override: '>=1.20.9 <2' },
  { name: 'fast-uri', minimumVersion: '3.1.9', major: '3', override: '>=3.1.9 <4' },
  { name: 'qs', minimumVersion: '6.16.1', major: '6', override: '>=6.16.1 <7' },
  { name: 'serialize-javascript', minimumVersion: '7.1.3', major: '7', override: '>=7.1.3 <8' },
];

describe('OSV npm dependency floors', () => {
  it('keeps each patched package at its fixed floor within a bounded major', () => {
    for (const { name, minimumVersion, major, override } of fixedFloors) {
      expect(workspace.overrides?.[name]).toBe(override);
      const resolved = resolvedVersions(name);
      expect(resolved.length).toBeGreaterThan(0);
      for (const version of resolved) {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(version.split('.')[0]).toBe(major);
        expect(compareNumericVersionTriples(version, minimumVersion)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps shipped AI SDK provider snapshots on the patched undici release', () => {
    expect(packageManifest.dependencies?.['@ai-sdk/google']).toBeDefined();
    expect(packageManifest.dependencies?.['@ai-sdk/openai']).toBeDefined();
    const providers = Object.entries(lockfile.snapshots ?? {}).filter(([key]) =>
      key.startsWith('@ai-sdk/provider-utils@'),
    );
    const undiciVersions = resolvedVersions('undici');
    expect(providers.length).toBeGreaterThan(0);
    expect(undiciVersions.length).toBeGreaterThan(0);
    expect(
      providers.every(([, snapshot]) => {
        const reference = snapshot.dependencies?.['undici'];
        return (
          typeof reference === 'string' && referencesResolvedVersion(reference, undiciVersions)
        );
      }),
    ).toBe(true);
  });

  it('patches the vulnerable Zod 4 line without overriding Zod 3 tooling peers', () => {
    expect(workspace.overrides?.['zod@^4']).toBe('>=4.6.6 <5');
    const resolved = resolvedVersions('zod');
    const zod3Versions = resolved.filter((version) => version.startsWith('3.'));
    const zod4Versions = resolved.filter((version) => version.startsWith('4.'));
    expect(zod3Versions.length).toBeGreaterThan(0);
    expect(zod4Versions.length).toBeGreaterThan(0);
    expect(
      zod4Versions.every((version) => compareNumericVersionTriples(version, '4.6.6') >= 0),
    ).toBe(true);
    expect(workspace.patchedDependencies ?? {}).not.toHaveProperty('zod@4.4.3');
  });

  it('keeps Lighthouse on its supported Puppeteer range with a Zod 4 BiDi parent', () => {
    expect(workspace.overrides?.['puppeteer-core']).toBe('>=25.16.0 <26');
    const puppeteerVersions = resolvedVersions('puppeteer-core');
    const chromiumBidiVersions = resolvedVersions('chromium-bidi');
    const zod4Versions = resolvedVersions('zod').filter((version) => version.startsWith('4.'));
    expect(puppeteerVersions.length).toBeGreaterThan(0);
    expect(
      puppeteerVersions.every(
        (version) =>
          version.startsWith('25.') && compareNumericVersionTriples(version, '25.16.0') >= 0,
      ),
    ).toBe(true);
    expect(chromiumBidiVersions.length).toBeGreaterThan(0);
    const puppeteerSnapshots = Object.entries(lockfile.snapshots ?? {}).filter(([key]) =>
      puppeteerVersions.some((version) => key.startsWith(`puppeteer-core@${version}(`)),
    );
    expect(puppeteerSnapshots.length).toBeGreaterThan(0);
    expect(
      puppeteerSnapshots.every(([, snapshot]) => {
        const reference = snapshot.dependencies?.['chromium-bidi'];
        return (
          typeof reference === 'string' &&
          referencesResolvedVersion(reference, chromiumBidiVersions)
        );
      }),
    ).toBe(true);

    const bidiSnapshots = Object.entries(lockfile.snapshots ?? {}).filter(([key]) =>
      chromiumBidiVersions.some((version) => key.startsWith(`chromium-bidi@${version}(`)),
    );
    expect(bidiSnapshots.length).toBeGreaterThan(0);
    expect(
      bidiSnapshots.every(([, snapshot]) => {
        const reference = snapshot.dependencies?.['zod'];
        return typeof reference === 'string' && referencesResolvedVersion(reference, zod4Versions);
      }),
    ).toBe(true);
  });
});
