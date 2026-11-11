import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  type AffectedRule,
  compareNumericVersionTriples,
  isAffected,
  type Lockfile,
  parentPackages,
  parseKey,
  productionReachable,
} from './lockfileGraph';

type PackageManifest = {
  dependencies?: Record<string, string>;
};

type WorkspaceConfig = {
  overrides?: Record<string, string>;
  patchedDependencies?: Record<string, string>;
};

function resolvedVersions(packageName: string): string[] {
  return Object.keys(lockfile.packages ?? {})
    .filter((key) => key.startsWith(`${packageName}@`))
    .map((key) => key.slice(packageName.length + 1));
}

function referencesResolvedVersion(reference: string, versions: string[]): boolean {
  return versions.some((version) => reference === version || reference.startsWith(`${version}(`));
}

// The expiry every OSV waiver was requalified for on 2026-11-11 (#1163, #1164).
const WAIVER_EXPIRY = '2027-01-31T00:00:00Z';

// Active `ignoreUntil` values of one [[IgnoredVulns]] block. OSV reads only uncommented keys, so a commented-out line must not satisfy the expiry check.
// The waiver file uses single-line strings only. A multi-line string (""" or ''') could hide a key-like line or an escaped delimiter, so the guard fails closed instead of parsing TOML string escapes.
const MULTILINE_STRING = /"""|'''/;

function activeIgnoreUntil(block: string): string[] {
  if (MULTILINE_STRING.test(block)) {
    throw new Error('multi-line TOML strings are not supported in OSV waiver blocks');
  }
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .flatMap((line) => {
      const value = /^ignoreUntil\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line)?.[1];
      return value === undefined ? [] : [value];
    });
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
  { name: 'follow-redirects', minimumVersion: '1.16.2', major: '1', override: '>=1.16.2 <2' },
  { name: 'joi', minimumVersion: '18.3.1', major: '18', override: '>=18.3.1 <19' },
  { name: 'qs', minimumVersion: '6.16.1', major: '6', override: '>=6.16.1 <7' },
  { name: 'serialize-javascript', minimumVersion: '7.1.3', major: '7', override: '>=7.1.3 <8' },
];

// Reviewed 2026-11-05 (#1146). OSV filters an IgnoredVulns entry for the whole advisory, not per
// version or lockfile; these records are the fail-closed guard around that wider waiver.
const waivedAdvisories: Array<
  AffectedRule & {
    id: string;
    reviewedCopies: string[];
    reviewedParents: Record<string, string[]>;
    affectedSamples: string[];
    unaffectedSamples: string[];
  }
> = [
  {
    id: 'GHSA-gcqx-w48m-w2h4',
    name: 'deepmerge',
    introduced: '4.2.0',
    lastAffected: '4.3.1',
    reviewedCopies: ['4.3.1'],
    reviewedParents: { '4.3.1': ['@rollup/plugin-node-resolve', 'jest-config'] },
    affectedSamples: ['4.2.0', '4.3.1'],
    unaffectedSamples: ['4.1.2', '4.3.2'],
  },
  {
    id: 'GHSA-mrhx-c7xc-m3w5',
    name: 'zod',
    introduced: '0.0.0',
    fixed: '4.6.6',
    reviewedCopies: ['3.25.76'],
    reviewedParents: { '3.25.76': ['@codecov/bundler-plugin-core'] },
    affectedSamples: ['3.25.76', '4.6.5'],
    unaffectedSamples: ['4.6.6', '4.6.7'],
  },
  {
    id: 'GHSA-3g3m-2fjr-6pw4',
    name: 'glob',
    introduced: '9.0.0',
    fixed: '14.0.2',
    reviewedCopies: ['10.5.0', '11.1.0', '13.0.6'],
    reviewedParents: {
      '10.5.0': ['test-exclude'],
      '11.1.0': ['workbox-build'],
      '13.0.6': [
        '@jest/reporters',
        '@joshwooding/vite-plugin-react-docgen-typescript',
        'jest-config',
        'jest-runtime',
      ],
    },
    affectedSamples: ['9.0.0', '10.5.0', '13.0.6', '14.0.1'],
    unaffectedSamples: ['7.2.3', '8.1.0', '14.0.2', '14.0.3'],
  },
  {
    id: 'GHSA-g3hv-75wg-m249',
    name: 'minimatch',
    introduced: '7.0.0',
    fixed: '11.0.1',
    reviewedCopies: ['10.2.6', '9.0.9'],
    reviewedParents: {
      '10.2.6': ['@stryker-mutator/core', 'glob', 'test-exclude'],
      '9.0.9': ['glob'],
    },
    affectedSamples: ['7.0.0', '9.0.9', '10.2.6', '11.0.0'],
    unaffectedSamples: ['3.1.5', '5.1.9', '6.2.0', '11.0.1', '11.0.4'],
  },
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

  it('classifies versions against the exact affected range of each waived advisory', () => {
    for (const rule of waivedAdvisories) {
      for (const version of rule.affectedSamples) {
        expect(isAffected(version, rule), `${rule.name}@${version} must be affected`).toBe(true);
      }
      for (const version of rule.unaffectedSamples) {
        expect(isAffected(version, rule), `${rule.name}@${version} must be unaffected`).toBe(false);
      }
    }
  });

  it('keeps every waived advisory tied to its affected copies and parent packages', () => {
    const toml = readFileSync(resolve(projectRoot, 'src-tauri/osv-scanner.toml'), 'utf8');
    for (const rule of waivedAdvisories) {
      const block = toml
        .split('[[IgnoredVulns]]')
        .find((part) => part.includes(`id = "${rule.id}"`));
      expect(block, `${rule.id} needs its ignore entry`).toBeDefined();
      expect(activeIgnoreUntil(block ?? ''), `${rule.id} expiry`).toEqual([WAIVER_EXPIRY]);

      // Fail-closed: the waiver is advisory-wide for OSV, so the test pins what it was reviewed for.
      // A stale waiver (no affected copy left) or a new affected copy / parent must re-open it.
      const affected = resolvedVersions(rule.name).filter((version) => isAffected(version, rule));
      expect(affected.sort(), `${rule.id} affected copies`).toEqual(
        [...rule.reviewedCopies].sort(),
      );
      for (const version of affected) {
        expect(
          parentPackages(lockfile, { name: rule.name, version }),
          `${rule.name}@${version} parents`,
        ).toEqual(rule.reviewedParents[version]);
      }
    }
  });

  // #1233 review: every waiver, Rust ones included, carries exactly one active expiry.
  it('gives every OSV waiver exactly one active expiry, the requalified date', () => {
    const toml = readFileSync(resolve(projectRoot, 'src-tauri/osv-scanner.toml'), 'utf8');
    const blocks = toml.split('[[IgnoredVulns]]').slice(1);
    expect(blocks).toHaveLength(9);
    for (const block of blocks) {
      const id = /^id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
      expect(activeIgnoreUntil(block), `${id} expiry`).toEqual([WAIVER_EXPIRY]);
    }
  });

  it('does not count a commented-out ignoreUntil as an active expiry', () => {
    const commented = `\nid = "GHSA-test"\n# ignoreUntil = "${WAIVER_EXPIRY}"\nreason = "fixture"\n`;
    expect(activeIgnoreUntil(commented)).toEqual([]);
    expect(activeIgnoreUntil(`${commented}ignoreUntil = "${WAIVER_EXPIRY}" # reviewed\n`)).toEqual([
      WAIVER_EXPIRY,
    ]);
    expect(activeIgnoreUntil(`${commented}ignoreUntil = 2027-01-31T00:00:00Z\n`)).toEqual([]);
  });

  // #1233 review: a key-like line or an escaped delimiter inside a multi-line string must not pass; the guard refuses multi-line strings.
  it.each([
    [
      'a """ string with a key-like line',
      `reason = """first\nignoreUntil = "${WAIVER_EXPIRY}"\n"""`,
    ],
    [
      "a ''' string with a key-like line",
      `reason = '''first\nignoreUntil = "${WAIVER_EXPIRY}"\n'''`,
    ],
    [
      'an escaped delimiter inside a """ string',
      `reason = """a \\""" b\nignoreUntil = "${WAIVER_EXPIRY}"\n"""`,
    ],
    ['a one-line """ string', `reason = """one line"""\nignoreUntil = "${WAIVER_EXPIRY}"`],
  ])('fails closed on %s', (_name, body) => {
    expect(() => activeIgnoreUntil(`\nid = "GHSA-test"\n${body}\n`)).toThrow(
      'multi-line TOML strings are not supported',
    );
  });

  it('keeps the shipped waiver file free of multi-line strings', () => {
    const toml = readFileSync(resolve(projectRoot, 'src-tauri/osv-scanner.toml'), 'utf8');
    expect(toml).not.toMatch(MULTILINE_STRING);
  });

  it('keeps every waived package out of the production dependency graph', () => {
    // Lockfile-graph evidence only. It follows dependencies and optionalDependencies from every
    // workspace importer. It does not inspect the built bundle and does not prove that no
    // attacker-controlled pattern or file tree reaches a development-time caller; that boundary is
    // argued in AUDIT.md.
    const reachable = productionReachable(lockfile);
    for (const rule of waivedAdvisories) {
      const hits = [...reachable].filter((key) => {
        const { name, version } = parseKey(key);
        return name === rule.name && isAffected(version, rule);
      });
      expect(hits, `${rule.name} reachable from production roots`).toEqual([]);
    }
    expect([...reachable].some((key) => key.startsWith('zod@4.'))).toBe(true);

    // pnpm records resolved peer dependencies inside the snapshot's own dependencies, which the
    // walk follows. Pin that assumption on a known peer relationship (react-dom -> react).
    const reactDom = Object.entries(lockfile.snapshots ?? {}).find(([key]) =>
      key.startsWith('react-dom@'),
    );
    expect(reactDom?.[1].dependencies?.['react']).toBeDefined();
  });
});
