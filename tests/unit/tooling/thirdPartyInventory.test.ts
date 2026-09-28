// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  CargoMetadata,
  InventoryComponent,
  InventoryContext,
} from '../../../scripts/generate-third-party-inventory.d.mts';
import {
  classifyComponents,
  collectJsComponents,
  collectRustComponents,
  isAutoAccepted,
  licenseEntry,
  normalizeLicenseExpression,
  packageUrl,
  renderNotices,
  renderSbom,
} from '../../../scripts/generate-third-party-inventory.mjs';

const context: InventoryContext = {
  version: '1.29.0',
  commit: 'a'.repeat(40),
  target: 'x86_64-unknown-linux-gnu',
  timestamp: '2026-09-29T00:00:00.000Z',
};

function component(overrides: Partial<InventoryComponent>): InventoryComponent {
  return {
    ecosystem: 'npm',
    name: 'demo',
    version: '1.0.0',
    license: 'MIT',
    homepage: null,
    texts: [{ file: 'LICENSE', text: 'MIT text' }],
    ...overrides,
  };
}

describe('license expressions', () => {
  it('normalizes legacy slash syntax and a wrapping parenthesis pair only', () => {
    expect(normalizeLicenseExpression('MIT/Apache-2.0')).toBe('MIT OR Apache-2.0');
    expect(normalizeLicenseExpression('(MPL-2.0 OR Apache-2.0)')).toBe('MPL-2.0 OR Apache-2.0');
    expect(normalizeLicenseExpression('(MIT OR Apache-2.0) AND Unicode-3.0')).toBe(
      '(MIT OR Apache-2.0) AND Unicode-3.0',
    );
    expect(normalizeLicenseExpression('(MIT) AND (ISC)')).toBe('(MIT) AND (ISC)');
  });

  it('treats absent, unknown and UNLICENSED metadata as unclassified', () => {
    expect(normalizeLicenseExpression(undefined)).toBeNull();
    expect(normalizeLicenseExpression('  ')).toBeNull();
    expect(normalizeLicenseExpression('UNLICENSED')).toBeNull();
    expect(normalizeLicenseExpression('SEE LICENSE IN LICENSE.md')).toBeNull();
  });

  it('auto-accepts only expressions satisfiable with permissive licenses', () => {
    expect(isAutoAccepted('MIT OR GPL-3.0-or-later')).toBe(true);
    expect(isAutoAccepted('(MIT OR Apache-2.0) AND Unicode-3.0')).toBe(true);
    expect(isAutoAccepted('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(isAutoAccepted('MIT AND LGPL-3.0-or-later')).toBe(false);
    expect(isAutoAccepted('MPL-2.0')).toBe(false);
    expect(isAutoAccepted('BSD')).toBe(false);
  });

  it('emits SPDX ids only for known identifiers', () => {
    expect(licenseEntry('MIT')).toEqual([{ license: { id: 'MIT' } }]);
    expect(licenseEntry('OFL-1.1')).toEqual([{ license: { id: 'OFL-1.1' } }]);
    expect(licenseEntry('BSD')).toEqual([{ license: { name: 'BSD' } }]);
    expect(licenseEntry('MIT OR Apache-2.0')).toEqual([{ expression: 'MIT OR Apache-2.0' }]);
  });

  it('encodes scoped npm package URLs', () => {
    expect(packageUrl('npm', '@ai-sdk/gateway', '4.0.81')).toBe('pkg:npm/%40ai-sdk/gateway@4.0.81');
    expect(packageUrl('cargo', 'serde', '1.0.0')).toBe('pkg:cargo/serde@1.0.0');
  });
});

describe('component collection', () => {
  it('follows only normal edges, never through a proc-macro, and skips first-party crates', () => {
    const pkg = (id: string, overrides: Partial<CargoMetadata['packages'][number]> = {}) => ({
      id,
      name: id,
      version: '1.0.0',
      source: 'registry+https://github.com/rust-lang/crates.io-index',
      license: 'MIT',
      manifest_path: `/registry/${id}/Cargo.toml`,
      targets: [{ kind: ['lib'] }],
      ...overrides,
    });
    const normal = [{ kind: null }];
    const metadata: CargoMetadata = {
      packages: [
        pkg('app', { source: null }),
        pkg('linked'),
        pkg('transitive', { license: 'MIT/Apache-2.0' }),
        pkg('macro', { targets: [{ kind: ['proc-macro'] }] }),
        pkg('macro-helper'),
        pkg('shared'),
        pkg('dev-only'),
        pkg('build-only'),
        pkg('first-party', { source: null }),
      ],
      resolve: {
        root: 'app',
        nodes: [
          {
            id: 'app',
            deps: [
              { pkg: 'linked', dep_kinds: normal },
              { pkg: 'macro', dep_kinds: normal },
              { pkg: 'first-party', dep_kinds: normal },
              { pkg: 'dev-only', dep_kinds: [{ kind: 'dev' }] },
              { pkg: 'build-only', dep_kinds: [{ kind: 'build' }] },
            ],
          },
          {
            id: 'linked',
            deps: [
              { pkg: 'transitive', dep_kinds: normal },
              { pkg: 'shared', dep_kinds: normal },
            ],
          },
          { id: 'transitive', deps: [] },
          {
            id: 'macro',
            deps: [
              { pkg: 'macro-helper', dep_kinds: normal },
              { pkg: 'shared', dep_kinds: normal },
            ],
          },
          { id: 'macro-helper', deps: [] },
          { id: 'shared', deps: [] },
          { id: 'dev-only', deps: [] },
          { id: 'build-only', deps: [] },
          { id: 'first-party', deps: [] },
        ],
      },
    };
    const seen: Array<string | undefined> = [];
    const result = collectRustComponents(metadata, (directory) => {
      seen.push(directory);
      return [];
    });
    // macro-helper is reachable only through the proc-macro; shared is also linked via `linked`.
    expect(result.map((entry) => entry.name).sort()).toEqual(['linked', 'shared', 'transitive']);
    expect(result.find((entry) => entry.name === 'transitive')?.license).toBe('MIT OR Apache-2.0');
    expect(seen.sort()).toEqual(['/registry/linked', '/registry/shared', '/registry/transitive']);
  });

  it('reads each npm version from its own store directory', () => {
    const read: Array<string | undefined> = [];
    const result = collectJsComponents(
      {
        MIT: [
          {
            name: '@scope/pkg',
            versions: ['1.0.0', '2.0.0'],
            paths: [
              '/nm/.pnpm/@scope+pkg@1.0.0-beta/node_modules/@scope/pkg',
              '/nm/.pnpm/@scope+pkg@2.0.0_peer/node_modules/@scope/pkg',
              '/nm/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg',
            ],
            license: 'MIT',
          },
        ],
      },
      (directory) => {
        read.push(directory);
        return [];
      },
    );
    expect(result.map((entry) => entry.version)).toEqual(['1.0.0', '2.0.0']);
    expect(read).toEqual([
      '/nm/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg',
      '/nm/.pnpm/@scope+pkg@2.0.0_peer/node_modules/@scope/pkg',
    ]);
  });
});

describe('classification and rendering', () => {
  const components = [
    component({ name: 'zeta', texts: [{ file: 'LICENSE', text: 'shared text' }] }),
    component({ name: 'alpha', texts: [{ file: 'LICENSE', text: 'shared text' }] }),
    component({ name: 'lib', ecosystem: 'cargo', license: 'LGPL-3.0-or-later', texts: [] }),
  ];

  it('separates unclassified, review and missing-text components', () => {
    expect(classifyComponents([...components, component({ name: 'bare', license: null })])).toEqual(
      {
        unclassified: ['npm:bare@1.0.0'],
        review: ['cargo:lib@1.0.0 (LGPL-3.0-or-later)'],
        missingText: ['cargo:lib@1.0.0 (LGPL-3.0-or-later)'],
      },
    );
  });

  it('renders sorted notices with each identical license text printed once', () => {
    const notices = renderNotices(components, context);
    expect(notices.indexOf('npm:alpha@1.0.0')).toBeLessThan(notices.indexOf('npm:zeta@1.0.0'));
    expect(notices.match(/shared text/g)).toHaveLength(1);
    expect(notices).toContain('[LICENSE: identical to the text printed for npm:alpha@1.0.0]');
    expect(notices).toContain('not a legal opinion');
    expect(renderNotices([...components].reverse(), context)).toBe(notices);
  });

  it('renders a deterministic CycloneDX document bound to commit and target', () => {
    const sbom = JSON.parse(renderSbom(components, context));
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.metadata.timestamp).toBe(context.timestamp);
    expect(sbom.metadata.properties).toContainEqual({
      name: 'worldscript:commit',
      value: context.commit,
    });
    expect(sbom.components.map((entry: { purl: string }) => entry.purl)).toEqual([
      'pkg:cargo/lib@1.0.0',
      'pkg:npm/alpha@1.0.0',
      'pkg:npm/zeta@1.0.0',
    ]);
    expect(renderSbom([...components].reverse(), context)).toBe(renderSbom(components, context));
    expect(
      JSON.parse(renderSbom(components, { ...context, target: 'aarch64-apple-darwin' }))
        .serialNumber,
    ).not.toBe(sbom.serialNumber);
  });
});
